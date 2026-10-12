"""
Confirm & pay — the consent gate between "review your order" and money moving.

Only an explicit approval gets here. From this point it's deterministic code:
re-check stock and prices, then the secure path:

  GreenLight   consent recorded + single-use DPAT scoped to this exact checkout
  PayIt        12-check guardrail engine on the DPAT
  then, by payment path (backend/shop/vic.py, decided by the server):
    vic        VIC-inspired controls on the member's AUTHENTICATED instruction
               → purchase-specific credential → gateway → simulated Visa
               network → simulated Chase issuer → commerce signal
    standard   card-on-file token → gateway → simulated card network → issuer
    wallet     ShopSphere Wallet balance (internal; no gateway)
  TrackIt      order created only after authorization (once), email, tracking

Amounts always come from the server-held checkout, never from the caller.
Each attempt gets its own payment reference (CHK_…-1, -2 …) so a declined
card can be swapped and retried on the same checkout.
"""
import logging
from typing import Optional

from fastapi import HTTPException

from backend.auth.dependencies import CurrentUser
from backend.db.schema import Checkout, Order, PaymentAuthorization, PaymentInstruction, PaymentMethod, SimScenario
from backend.db.session_utils import get_session, write_audit_event
from backend.gateway.adapter import get_adapter
from backend.models.payment import PaymentRequest, PaymentResult
from backend.payment import processor_route
from backend.shop import checkout as checkout_service
from backend.shop import orders as order_service
from backend.shop import vic as vic_paths
from backend.vic import credentials, signals
from backend.vic.common import ALLOWED, MERCHANT_ID, MERCHANT_NAME, short, transition

log = logging.getLogger(__name__)

DECLINE_MESSAGES = {
    "INSUFFICIENT_BALANCE": "Your wallet balance isn't enough for this order. Choose a card instead.",
    "CARD_DECLINED": "Your card was declined by the issuer. Try a different card.",
    "CARD_EXPIRED": "That card has expired. Try a different card.",
    "NO_ACTIVE_PAYMENT_METHOD": "That card isn't available. Choose another card.",
    "INSUFFICIENT_CREDIT": "That card doesn't have enough available credit. Try a different card.",
    "PAYMENT_TIMEOUT": "The payment network didn't answer in time. Nothing was charged; please try again.",
    "GATEWAY_UNAVAILABLE": "We couldn't reach the payment gateway. Nothing was charged; please try again.",
    "GATEWAY_ERROR": "The payment gateway had a problem. Nothing was charged; please try again.",
}
CONTROL_MESSAGES = {
    "CHECKOUT_MISMATCH": "Your order changed after you approved it, so it wasn't paid. Please approve it again.",
    "AMOUNT_MISMATCH": "The total changed after you approved it, so it wasn't paid. Please approve it again.",
    "INSTRUCTION_EXPIRED": "Your approval expired, so nothing was paid. Please approve the order again.",
    "INSTRUCTION_NOT_AUTHENTICATED": "Please confirm with your passkey before paying.",
    "AGENT_TOKEN_INACTIVE": "Agent payments aren't active for this card, so nothing was paid.",
    "INSTRUCTION_CLOSED": "That approval was cancelled or already used. Please approve the order again.",
    "DUPLICATE_ATTEMPT": "That approval was already used for a payment attempt. Please approve the order again.",
}


def _pop_scenario(db, user_id: str) -> Optional[str]:
    row = db.query(SimScenario).filter_by(user_id=user_id).first()
    if not row:
        return None
    outcome = row.outcome
    db.delete(row)
    return outcome


async def confirm(user: CurrentUser, checkout_id: str, consent: bool, consent_mode: str = "button",
                  instruction_id: Optional[str] = None) -> dict:
    """consent_mode: "button" (Approve and pay / Place order tapped), "typed" (GO AHEAD
    typed in Talkshop) or "auto_countdown" (standard path only). The Visa path also
    needs the member's AUTHENTICATED payment instruction (simulated passkey)."""
    # Imported here: the routers import this module's callers.
    from backend.routers.authorizations import ApproveRequest, approve_authorization
    from backend.routers.payments import ExecutePaymentRequest, execute_payment_endpoint

    if consent is not True:
        raise checkout_service.CheckoutError(
            "CONSENT_REQUIRED", "Payment needs your explicit go-ahead.", 400)

    with get_session() as db:
        from backend.shop import eligibility       # second line of defence: only eligible cardmembers pay
        code = eligibility.check(db, user)
        if code:
            raise checkout_service.CheckoutError(code, eligibility.MESSAGES[code], 403)
        co = checkout_service.get_checkout(db, user.user_id, checkout_id)
        if user.is_visitor and not co.guest_email:      # (guests can't reach the marketplace in Part 2)
            raise checkout_service.CheckoutError(
                "GUEST_DETAILS_REQUIRED", "Add your name, email and shipping address first.", 403)
        if co.status != "open":
            raise checkout_service.CheckoutError(
                "CHECKOUT_CLOSED", f"This checkout is {co.status}.", 409)
        path = vic_paths.payment_path(db, co)
        if path["path"] == "vic_setup_required":
            raise checkout_service.CheckoutError(
                "AGENT_PAY_NOT_ENROLLED", "Set up Visa agent payments for this card first (a quick simulated "
                "passkey step), or choose another card.", 409, {"card_account_id": path.get("card_account_id")})
        if path["path"] == "vic":
            if not instruction_id:
                raise checkout_service.CheckoutError(
                    "INSTRUCTION_REQUIRED", "Approve the order and confirm with your passkey first.", 409)
            if not db.query(PaymentInstruction).filter_by(instruction_id=instruction_id, user_id=user.user_id,
                                                          checkout_id=checkout_id).first():
                raise checkout_service.CheckoutError(
                    "UNKNOWN_INSTRUCTION", "That approval doesn't belong to this order.", 404)
        issues = checkout_service.refresh(db, co)      # live stock + prices, right before paying
        db.commit()
        snap = checkout_service.snapshot(db, co, issues)
        if not snap["ready"]:
            raise checkout_service.CheckoutError(
                "NOT_READY", "This order can't be placed yet.", 409, {"issues": snap["issues"]})
        attempt = db.query(PaymentAuthorization).filter(
            PaymentAuthorization.order_id.like(f"{checkout_id}-%")).count() + 1
        payment_ref = f"{checkout_id}-{attempt}"
        first = snap["lines"][0]
        title = first["name"] if len(snap["lines"]) == 1 else f"{first['name']} + {len(snap['lines']) - 1} more"
        amounts = dict(total=co.total, subtotal=co.subtotal, tax=co.tax, shipping=co.shipping,
                       currency=co.currency, checkout_hash=co.checkout_hash)
        pay_with = "wallet" if co.pay_with == "wallet" else "card"
        payment_method_id = co.payment_method_id if pay_with == "card" else None
        mode = consent_mode if consent_mode in ("button", "typed", "auto_countdown") else "button"
        co.status = "consented"
        write_audit_event(db, "CHECKOUT_CONSENT", user_id=user.user_id, order_id=payment_ref,
                          metadata={"mode": mode, "checkout_hash": co.checkout_hash, "total": co.total,
                                    "payment_path": path["path"],
                                    "instruction": short(instruction_id) if instruction_id else None})
        if path["path"] == "vic":
            instr = db.query(PaymentInstruction).filter_by(instruction_id=instruction_id).one()
            instr.payment_ref = payment_ref
        db.commit()

    # Live trace (info view). Real backend steps only; no secrets: references are
    # shortened and no card data ever appears here.
    trace: list[dict] = [
        {"agent": "GreenLight", "check": "Consent gate", "result": "pass", "protocol": "AP2-style consent",
         "detail": {"auto_countdown": "Automatic after the 3-second countdown", "typed": "GO AHEAD typed"}
                   .get(mode, "Approve and pay tapped") + f" for checkout {checkout_id}, total ${amounts['total']:.2f}"},
        {"agent": "GreenLight", "check": "Live stock + price refresh", "result": "pass", "protocol": "ACP-style checkout",
         "detail": "Re-checked against the catalog right before paying; order fingerprint (SHA-256) recomputed"},
    ]
    if path["path"] == "vic":
        trace.append({"agent": "GreenLight", "check": "Payment instruction", "result": "pass",
                      "protocol": "VIC-inspired", "layer": "local",
                      "detail": f"Instruction {short(instruction_id)} found for this checkout (authentication checked "
                                "by the VIC controls below)"})

    def reopen(outcome: str, reason: str, message: str) -> dict:
        with get_session() as db:
            co = db.query(Checkout).filter_by(checkout_id=checkout_id).one()
            co.status = "open"                         # change card / retry on the same checkout
            # Spec: no order is created unless payment is authorized. The audit
            # trail and authorization records keep the attempt's full history.
            db.query(Order).filter_by(order_id=payment_ref).delete()
            db.commit()
            return {"status": outcome, "reason": reason, "message": message, "payment_path": path["path"],
                    "checkout": checkout_service.snapshot(db, co), "trace": trace}

    # 1. Consent recorded + single-use scoped token (GreenLight)
    try:
        approval = await approve_authorization(ApproveRequest(
            checkout_id=payment_ref, merchant_id=MERCHANT_ID, merchant_name=MERCHANT_NAME,
            product_id=first["product_id"], product_title=title, **amounts,
        ), user)
    except HTTPException as exc:                       # policy refused before any token existed
        trace.append({"agent": "GreenLight", "check": "Spending policy", "result": "blocked", "protocol": "AP2-style",
                      "detail": str(exc.detail)[:160]})
        return reopen("blocked", "POLICY_DENIED", str(exc.detail))
    trace += [
        {"agent": "GreenLight", "check": "Spending policy", "result": "pass", "protocol": "AP2-style",
         "detail": f"Approved merchant, {amounts['currency']}, ${amounts['total']:.2f} within the $2,500 limit"},
        {"agent": "GreenLight", "check": "DPAT issued", "result": "pass", "protocol": "AP2-style scoped token",
         "detail": f"Internal delegated-payment token …{approval.token_id[-6:]}: HMAC-SHA256 signed, single use, "
                   "15 min, bound to PayIt + ShopSphere + this amount + checkout fingerprint"},
    ]

    # 2. PayIt's 12 DPAT checks, then the charge step through the gateway route
    gateway_info: dict = {}
    if pay_with == "card":
        processor = _gateway_route(user, checkout_id, payment_ref, path, instruction_id, trace, gateway_info)
        route_token = processor_route.ACTIVE.set(processor)
    try:
        result = await execute_payment_endpoint(ExecutePaymentRequest(
            token_id=approval.token_id, checkout_id=payment_ref, merchant_id=MERCHANT_ID,
            merchant_name=MERCHANT_NAME, product_id=first["product_id"], product_title=title,
            payment_method=pay_with, payment_method_id=payment_method_id, **amounts,
        ), user)
    finally:
        if pay_with == "card":
            processor_route.ACTIVE.reset(route_token)

    names = {"token_exists": "Token exists", "token_active": "Token is active", "token_not_expired": "Token not expired",
             "token_not_consumed": "Token not used before", "agent_id_match": "Right agent (PayIt)",
             "merchant_id_match": "Right merchant", "order_id_match": "Right order", "currency_match": "Right currency",
             "amount_within_limit": "Amount within authorized limit", "amount_matches_checkout": "Amount = checkout total",
             "checkout_hash_match": "Order fingerprint unchanged", "consent_exists": "Consent record exists"}
    checks = [{"agent": "PayIt", "check": f"DPAT check {c['n']}/12 · {names.get(c['name'], c['name'])}",
               "result": "pass" if c["passed"] else "blocked", "protocol": "AP2-style verification", "layer": "local",
               "detail": None if c["passed"] else c.get("reason")} for c in result.guardrail_checks]
    # The gateway steps were recorded while PayIt charged; the 12 checks ran before them.
    at = gateway_info.get("trace_start", len(trace))
    trace[at:at] = checks
    if pay_with == "wallet" and result.status == "success":
        trace.append({"agent": "PayIt", "check": "Charge", "result": "pass", "protocol": "Internal stored value",
                      "detail": f"ShopSphere Wallet charged ${amounts['total']:.2f} (no card network involved)"})

    if result.status != "success":
        reason = result.blocked_reason or "PAYMENT_FAILED"
        if reason.startswith("VIC_CONTROL:"):
            code = reason.split(":", 1)[1]
            return reopen("blocked", code, CONTROL_MESSAGES.get(code, "Payment wasn't authorized by the "
                                                                    "agent-payment controls. Nothing was charged."))
        outcome = "declined" if reason in DECLINE_MESSAGES else "blocked"
        return reopen(outcome, reason, DECLINE_MESSAGES.get(reason, "Payment wasn't authorized."))

    # 3. Authorized → create the order (once). If that fails, void the
    # authorization so the member is never charged for an order that doesn't exist.
    try:
        with get_session() as db:
            co = db.query(Checkout).filter_by(checkout_id=checkout_id).one()
            order = order_service.finalize(db, co, payment_ref, payment_path=path["path"])
            outcome = {"status": "authorized", "order": order_service.order_dict(db, order),
                       "transaction_id": result.transaction_id, "payment_path": path["path"], "trace": trace}
            if path["path"] == "vic":
                instr = db.query(PaymentInstruction).filter_by(instruction_id=instruction_id).one()
                instr.status = "CONSUMED"
                transition(db, instr, "ORDER_CONFIRMED", f"Order {order.display_id}")
                for sig in signals.for_instruction(db, instruction_id):
                    sig.order_id = order.display_id
                db.commit()
            o = outcome["order"]
            extras = [f"{o['points']['used']:,} points redeemed" if o["points"]["used"] else "",
                      f"offer {o['offer']['title']} −${o['offer']['discount']:.2f}" if o.get("offer") else "",
                      f"+{o['points']['earned']:,} points" if o["points"]["earned"] else "",
                      f"${o['cashback']:.2f} cashback (simulated statement credit)" if o.get("cashback") else ""]
            trace.append({"agent": "TrackIt", "check": "Order confirmed", "result": "pass",
                          "protocol": "ACP-style complete checkout", "layer": "local",
                          "detail": f"{order.display_id}: created once, after authorization; stock committed (guarded); "
                                    + "; ".join(x for x in extras if x)})
    except Exception:
        log.exception("order creation failed after authorization (%s); voiding", payment_ref)
        trace.append({"agent": "TrackIt", "check": "Order created", "result": "blocked", "protocol": "ACP-style",
                      "detail": "Order couldn't be created, so the authorization was voided: nothing charged"})
        await _void(result.transaction_id, pay_with)
        if path["path"] == "vic":
            with get_session() as db:
                instr = db.query(PaymentInstruction).filter_by(instruction_id=instruction_id).first()
                if instr and instr.lifecycle_state == "SIGNAL_RECORDED":
                    instr.status = "FAILED"
                    transition(db, instr, "ORDER_FAILED", "Authorization voided")
                    db.commit()
        return reopen("order_failed", "ORDER_CREATION_FAILED",
                      "Your payment was approved, but ShopSphere couldn't create the order, so the payment "
                      "was released and you haven't been charged. Please try again.")

    # 4. Confirmation email (outbox / SMTP). The order already exists, so a
    # problem here never undoes the payment.
    try:
        from backend.shop import notifications
        with get_session() as db:
            order = db.query(Order).filter_by(order_id=payment_ref).one()
            outcome["confirmation_email"] = notifications.send_order_confirmation(db, order)
            mail = notifications.confirmation_for(db, order) or {}
            how = {"sending": "Queued for real delivery over SMTP (TLS); sent in the background",
                   "outbox": "Kept in the demo outbox (no SMTP set, or a made-up address like .demo)"}
            trace.append({"agent": "TrackIt", "check": "Confirmation email", "result": "pass",
                          "protocol": "Order updates", "layer": "local",
                          "detail": f"{how.get(mail.get('delivery'), 'Recorded')}. Contains Order ID, items, total, "
                                    "tracking link; no card data"})
    except Exception:
        log.exception("confirmation email failed for %s", payment_ref)
        outcome["confirmation_email"] = None
    return outcome


async def _void(transaction_id: Optional[str], pay_with: str) -> None:
    if pay_with == "card" and transaction_id and transaction_id.startswith("gw_"):
        await get_adapter().void(transaction_id)
    else:
        from backend.payment.mock_processor import void_authorization
        void_authorization(transaction_id)


def _gateway_route(user: CurrentUser, checkout_id: str, payment_ref: str, path: dict,
                   instruction_id: Optional[str], trace: list[dict], info: dict):
    """PayIt's charge step for card payments: runs after the 12 DPAT checks pass."""

    async def charge(request: PaymentRequest) -> PaymentResult:
        info["trace_start"] = len(trace)
        adapter = get_adapter()

        def result(status: str, reason: Optional[str] = None, txn: Optional[str] = None,
                   code: Optional[str] = None) -> PaymentResult:
            return PaymentResult(status=status, decline_reason=reason, transaction_id=txn,
                                 authorization_code=code, amount=request.amount, currency=request.currency)

        with get_session() as db:
            co = db.query(Checkout).filter_by(checkout_id=checkout_id).one()
            instr, cred_ref = None, None
            if path["path"] == "vic":
                instr = db.query(PaymentInstruction).filter_by(instruction_id=instruction_id).one()
                ok, controls = credentials.run_controls(db, user, instr, co, snapshot_ready=True)
                for c in controls:
                    trace.append({"agent": "VIC simulator", "check": f"VIC control {c['n']}/12 · {c['name']}",
                                  "result": "pass" if c["passed"] else "blocked", "protocol": "VIC-inspired controls",
                                  "layer": "simulated", "detail": c["reason"]})
                if not ok:
                    failed = controls[-1]["reason"]
                    if instr.status in ("PENDING_AUTHENTICATION", "AUTHENTICATED"):
                        instr.status, instr.status_reason = "FAILED", failed
                    if "CONTROLS_FAILED" in ALLOWED.get(instr.lifecycle_state, set()):
                        transition(db, instr, "CONTROLS_FAILED", failed)
                    db.commit()
                    return result("declined", f"VIC_CONTROL:{failed}")
                cred = credentials.issue(db, instr)
                db.commit()
                cred_ref = cred.credential_ref
                trace.append({"agent": "VIC simulator", "check": "Purchase credential issued", "result": "pass",
                              "protocol": "VIC-inspired credential", "layer": "simulated",
                              "detail": f"{short(cred_ref)}: single use, 5 min, bound to ShopSphere + "
                                        f"{checkout_id} + ${cred.amount:.2f} (opaque; the simulated cryptogram stays "
                                        "server-side)"})
                instrument = {"type": "vic_credential", "credential_ref": cred_ref}
                idem_key = f"{instr.instruction_id}:1"     # one transaction per instruction
            else:
                card = db.query(PaymentMethod).filter_by(payment_method_id=co.payment_method_id,
                                                         user_id=user.user_id).first()
                if not card:
                    return result("declined", "NO_ACTIVE_PAYMENT_METHOD")
                instrument = {"type": "card_on_file", "token_ref": card.token_ref}
                idem_key = payment_ref
                cred_ref = None
            scenario = _pop_scenario(db, user.user_id)
            db.commit()

        body = {"merchant_id": MERCHANT_ID, "amount": request.amount, "currency": request.currency,
                "order_ref": payment_ref, "checkout_id": checkout_id, "customer_ref": user.user_id,
                "instrument": instrument}
        trace.append({"agent": "PayIt", "check": "Gateway request sent", "result": "info",
                      "protocol": "PaymentGatewayAdapter", "layer": "local",
                      "detail": f"{adapter.transport_label}; idempotency key …{idem_key[-6:]}; "
                                + ("VIC credential reference only" if instrument["type"] == "vic_credential"
                                   else "PSP card token only") + " (no card number)"})
        gw = await adapter.authorize(body, idem_key, scenario)
        if scenario == "duplicate":                     # demo: the same request submitted twice
            again = await adapter.authorize(body, idem_key, None)
            trace.append({"agent": "PayIt", "check": "Duplicate submission", "result": "pass",
                          "protocol": "Idempotency", "layer": "simulated",
                          "detail": f"Second request with the same key returned the original result "
                                    f"({'same' if again.gateway_ref == gw.gateway_ref else 'DIFFERENT'} reference, "
                                    f"duplicate={again.duplicate}); not authorized twice"})
        for step in gw.steps:
            trace.append({"agent": step["actor"], "check": step["actor"],
                          "result": {"approved": "pass", "declined": "blocked", "timeout": "blocked"}
                          .get(step["result"], step["result"]),
                          "protocol": "SIMULATED", "layer": "simulated", "detail": step.get("detail")})

        outcome_map = {"approved": "APPROVED", "declined": "DECLINED", "timeout": "TIMEOUT"}
        with get_session() as db:
            if instr is not None:
                instr = db.query(PaymentInstruction).filter_by(instruction_id=instruction_id).one()
                state = {"approved": "PAYMENT_AUTHORIZED", "timeout": "PAYMENT_TIMEOUT"}.get(gw.status, "PAYMENT_DECLINED")
                transition(db, instr, state, f"{gw.status}{' · ' + gw.decline_reason if gw.decline_reason else ''}")
                signals.record(db, instr, outcome=outcome_map.get(gw.status, "ERROR"), amount=request.amount,
                               currency=request.currency, checkout_id=checkout_id, merchant_id=MERCHANT_ID,
                               credential_ref=cred_ref, gateway_ref=gw.gateway_ref,
                               reason=gw.decline_reason)
                if gw.status == "approved":
                    transition(db, instr, "SIGNAL_RECORDED", "Outcome linked to the member's instruction")
                else:
                    instr.status, instr.status_reason = "FAILED", gw.decline_reason
                    if cred_ref and gw.status != "declined":       # never reached the network
                        credentials.revoke(db, cred_ref)
                db.commit()
                trace.append({"agent": "VIC simulator", "check": "Commerce signal recorded", "result": "pass",
                              "protocol": "VIC-inspired commerce signal", "layer": "simulated",
                              "detail": f"{outcome_map.get(gw.status, 'ERROR')} linked to instruction "
                                        f"{short(instruction_id)} (local record; no Visa API called)"})
        if gw.status == "approved":
            return result("success", txn=gw.gateway_ref, code=gw.auth_code)
        return result("declined", gw.decline_reason or "CARD_DECLINED")

    return charge
