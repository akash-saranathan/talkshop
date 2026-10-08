"""
Demo 2 purchase orchestration — runs entirely on the server, in this order:

  checkout (trusted session required) → AP2 cart evidence → order proposal
  → GO AHEAD consent bound to the exact checkout
  → AP2 payment authorization evidence → ACP-style delegated token
  → merchant verifies trust, token and evidence → merchant re-checks its terms
  → internal DPAT → 12 deterministic payment checks → mock processor
  → merchant order → A2A-style order confirmation

Rules:
  * A search or a product selection never authorizes payment. Nothing payment-related
    exists until GO AHEAD.
  * Payment uses the merchant's stored checkout, never totals sent by the browser.
  * Any failed check stops the flow: no charge and no order, with a structured reason.
  * No raw card data anywhere: only a payment_method_id plus brand and last4.
  * No LLM in this module.

Every step appends a protocol event; callers return them so the trace shows what
the server actually did.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import update

from backend.acp import delegated
from backend.agents import payit
from backend.agents.cartup import build_checkout, checkout_hash_for
from backend.config.demo_profile import REWARD_PREFERENCE
from backend.payment.loyalty_policy import decide_redemption
from backend.ap2.adapter import AP2Adapter
from backend.ap2.models import AP2CartMandate, AP2PaymentMandate
from backend.config.agents import PAYIT
from backend.db.schema import (CustomerConsent, DelegatedPaymentToken, DelegatedToken, LoyaltyPoints, MerchantCheckout)
from backend.db.session_utils import get_session, now_utc, write_audit_event
from backend.merchants import catalog as merchant_catalog
from backend.models.checkout import CheckoutObject
from backend.models.payment import PaymentRequest, PaymentResult
from backend.observability.redact import redact
from backend.orders.service import confirm_paid_order
from backend.payment import methods
from backend.payment.authorization_adapter import authorization_adapter
from backend.payment.token_lookup import load_token_context
from backend.routers.authorizations import _issue_checkout_mandates, _load_mandate, _store_mandate, _verify_cart
from backend.trust import sessions as trust_sessions
from backend.trust.models import SCOPE_CHECKOUT, SCOPE_PAYMENT

_ap2 = AP2Adapter()

# Demo-only scenarios a GO AHEAD can ask for. Anything else is ignored.
DEMO_SCENARIOS = {"delivery_change", "tampered_amount"}
DELIVERY_SLIP_DAYS = 2


class Trace:
    """Collects protocol events in the same shape the chat stream uses."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def add(self, source: str, target: str, protocol: str, label: str, detail: dict, direction: str = "out") -> None:
        self.events.append({
            "type": "protocol_event", "ts": datetime.now(timezone.utc).isoformat(),
            "source": source, "target": target, "protocol": protocol, "direction": direction,
            "label": label, "detail": redact(detail),
        })


def _agent(merchant_id: str) -> str:
    return f"{merchant_catalog_name(merchant_id)}Agent"


def _merchant_loyalty(user_id: str, merchant_id: str) -> int:
    """This customer's loyalty balance at this merchant (0 if none/guest)."""
    with get_session() as db:
        lp = db.query(LoyaltyPoints).filter(
            LoyaltyPoints.user_id == user_id, LoyaltyPoints.merchant_id == merchant_id
        ).first()
        return lp.balance if lp else 0


def merchant_catalog_name(merchant_id: str) -> str:
    for ag in merchant_catalog._AGENTS:
        if ag.merchant_id == merchant_id:
            return ag.merchant_name
    return merchant_id


def _pretty_date(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    d = date.fromisoformat(iso)
    return f"{d.strftime('%A, %B')} {d.day}"


def _load_checkout(db, user_id: str, checkout_id: str) -> tuple[Optional[MerchantCheckout], Optional[CheckoutObject]]:
    row = db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id,
                                            MerchantCheckout.user_id == user_id).first()
    if row is None:
        return None, None
    return row, CheckoutObject.model_validate(json.loads(row.document))


def _result(status: str, trace: Trace, **fields) -> dict:
    return {"status": status, "events": trace.events, **fields}


def _reject(trace: Trace, reason: str, message: str, **fields) -> dict:
    return _result("rejected", trace, reason=reason, message=message, **fields)


# ── 1. Checkout + order proposal ─────────────────────────────────────────────

async def create_proposal(
    *, user_id: str, is_talkshop_guest: bool, product_id: str, quantity: int = 1,
    chat_session_id: Optional[str] = None, trusted_session_id: Optional[str] = None,
    payment_method_id: Optional[str] = None,
) -> dict:
    trace = Trace()
    product = merchant_catalog.get_product(product_id)
    if product is None:
        return _reject(trace, "PRODUCT_NOT_FOUND", "That product is no longer available.")
    agent = _agent(product.merchant_id)

    trusted, decision = trust_sessions.require(user_id, product.merchant_id, SCOPE_CHECKOUT,
                                               chat_session_id=chat_session_id,
                                               trusted_session_id=trusted_session_id)
    if trusted is None:
        trace.add(agent, "CustomerAgent", "TRUST", "trusted_session_rejected",
                  {"action": SCOPE_CHECKOUT, "failed_check": decision.failed_check, "reason": decision.reason},
                  direction="in")
        return _reject(trace, "TRUST_VALIDATION_FAILED",
                       f"{merchant_catalog_name(product.merchant_id)} could not verify this shopping agent's credentials, so the checkout was not authorized. Nothing was charged.")
    trace.add(agent, "CustomerAgent", "TRUST", "trusted_session_verified",
              {"action": SCOPE_CHECKOUT, "trusted_session_id": trusted.session_id,
               "merchant_relationship": trusted.merchant_relationship}, direction="in")

    # Merchant-scoped loyalty: a member merchant returns this customer's balance.
    # Loyalty is a merchant benefit, not a payment protocol.
    loyalty_balance = _merchant_loyalty(user_id, product.merchant_id)
    is_member = trusted.merchant_relationship == "merchant_member"
    if is_member:
        trace.add(agent, "CustomerAgent", "A2A", "loyalty_balance", {
            "merchant": product.merchant_id, "balance": loyalty_balance,
            "note": "Merchant returned this customer's loyalty balance. A merchant reward, not a payment protocol.",
        }, direction="in")

    checkout, error = await build_checkout(product, quantity, user_id)
    if error:
        return _reject(trace, error, "The merchant could not create a checkout for this item.")

    # Zero-click loyalty redemption: the agent applies the customer's standing
    # reward preference automatically. Points are settled by the merchant's own
    # ledger; only amount_due is charged to the card. Re-hash so the redemption
    # is bound into the checkout (tamper-proof) before it is stored or mandated.
    redemption = None
    if is_member and loyalty_balance > 0:
        decision = decide_redemption(loyalty_balance, checkout.total, REWARD_PREFERENCE)
        if decision.points_redeemed > 0:
            checkout.loyalty_points_redeemed = decision.points_redeemed
            checkout.loyalty_value = decision.value_redeemed
            checkout.amount_due = decision.amount_due
            unit_price = round(checkout.subtotal / checkout.quantity, 2)
            checkout.checkout_hash = checkout_hash_for(checkout, unit_price)
            redemption = decision
            trace.add(agent, "CustomerAgent", "A2A", "loyalty_redemption_applied", {
                "merchant": product.merchant_id, "points_redeemed": decision.points_redeemed,
                "value_redeemed": decision.value_redeemed, "order_total": checkout.total,
                "amount_due": decision.amount_due, "preference": REWARD_PREFERENCE,
                "note": "Merchant redeemed the customer's points against this order. Settled by the merchant's loyalty ledger, not the card rails.",
            }, direction="in")

    with get_session() as db:
        db.add(MerchantCheckout(checkout_id=checkout.checkout_id, user_id=user_id,
                                merchant_id=checkout.merchant_id, trusted_session_id=trusted.session_id,
                                checkout_hash=checkout.checkout_hash,
                                document=checkout.model_dump_json(), status="proposed"))
        db.commit()
    trace.add("CustomerAgent", agent, "UCP", "checkout_created", {
        "mode": "real HTTP — totals locked via a UCP checkout-session POST", "checkout_id": checkout.checkout_id, "merchant": checkout.merchant_id,
        "totals": {"subtotal": checkout.subtotal, "shipping": checkout.shipping, "tax": checkout.tax,
                   "total": checkout.total, "loyalty_points_redeemed": checkout.loyalty_points_redeemed,
                   "loyalty_value": checkout.loyalty_value, "amount_due": checkout.payable,
                   "currency": checkout.currency},
        "delivery_date": checkout.delivery_date, "delivery_display": _pretty_date(checkout.delivery_date),
        "checkout_hash": checkout.checkout_hash,
    })

    ap2 = _issue_checkout_mandates(checkout, product, None, user_id)
    trace.add("CustomerAgent", "AP2 evidence", "AP2", "ap2_checkout_bound", {
        "cart_mandate_id": ap2["cart_mandate_id"], "checkout_hash": checkout.checkout_hash,
        "verified": ap2["cart_verified"], "note": "Binds product, quantity, merchant and total. Not a spending authorization.",
    })

    # Saved card is merchant-scoped: a member merchant has one; a merchant the
    # customer is a guest to returns None, which the UI turns into secure entry.
    pm = (methods.get_method(user_id, payment_method_id) if payment_method_id
          else methods.default_method(user_id, product.merchant_id))
    proposal = {
        **checkout.model_dump(mode="json"),
        "delivery_display": _pretty_date(checkout.delivery_date),
        "image_url": product.image_url,
        "trusted_session_id": trusted.session_id,
        "merchant_relationship": trusted.merchant_relationship,
        "talkshop_account": "talkshop_guest" if is_talkshop_guest else "authenticated",
        "payment_method": pm,
        "loyalty": {
            "balance": loyalty_balance, "is_member": is_member, "merchant_name": checkout.merchant_name,
            "points_redeemed": checkout.loyalty_points_redeemed, "value_redeemed": checkout.loyalty_value,
            "amount_due": checkout.payable, "fully_covered": bool(redemption and redemption.fully_covered),
        } if is_member else None,
        "ap2": ap2,
    }
    trace.add("CustomerAgent", "Customer", "internal", "order_proposal", {
        "checkout_id": checkout.checkout_id, "total": checkout.total, "delivery_date": checkout.delivery_date,
        "payment_method": pm["display"] if pm else None, "awaiting": "GO AHEAD",
    })
    return _result("proposed", trace, proposal=proposal)


# ── 2. GO AHEAD ──────────────────────────────────────────────────────────────

async def go_ahead(
    *, user_id: str, checkout_id: str, checkout_hash: str, total: float, currency: str,
    payment_method_id: str, demo: Optional[str] = None, consent_mode: str = "click",
) -> dict:
    trace = Trace()
    demo = demo if demo in DEMO_SCENARIOS else None
    consent_mode = consent_mode if consent_mode in ("click", "auto_countdown") else "click"
    with get_session() as db:
        row, checkout = _load_checkout(db, user_id, checkout_id)
    if row is None:
        return _reject(trace, "CHECKOUT_NOT_FOUND", "That checkout no longer exists.")
    if row.status != "proposed":
        return _reject(trace, f"CHECKOUT_{row.status.upper()}", f"This checkout is already {row.status.replace('_', ' ')}.")

    pm = methods.get_method(user_id, payment_method_id)
    mismatches = [name for name, ok in (
        ("checkout_hash", checkout_hash == checkout.checkout_hash),
        ("total", abs(total - checkout.total) < 0.005),
        ("currency", currency.upper() == checkout.currency.upper()),
        ("payment_method", pm is not None),
    ) if not ok]
    if mismatches:
        trace.add("Customer", "CustomerAgent", "internal", "customer_consent_rejected",
                  {"checkout_id": checkout_id, "mismatched": mismatches,
                   "authorized_total": checkout.total, "requested_total": total})
        return _reject(trace, "CONSENT_DOES_NOT_MATCH_CHECKOUT",
                       "The approval did not match the merchant's checkout, so nothing was authorized.",
                       mismatched=mismatches)

    # Claim the checkout so a double-click can't authorize it twice.
    with get_session() as db:
        claimed = db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id,
                                                    MerchantCheckout.status == "proposed")             .update({"status": "authorizing"}, synchronize_session=False)
        db.commit()
    if not claimed:
        return _reject(trace, "CHECKOUT_ALREADY_AUTHORIZING", "This checkout is already being paid.")
    consent = _record_consent(user_id, checkout, pm, kind="go_ahead", mode=consent_mode)
    trace.add("Customer", "CustomerAgent", "HUMAN", "customer_consent_received", {
        "consent_id": consent, "checkout_id": checkout.checkout_id, "checkout_hash": checkout.checkout_hash,
        "total": checkout.total, "currency": checkout.currency, "merchant": checkout.merchant_id,
        "payment_method": pm["display"], "consent_mode": consent_mode,
        "meaning": ("GO AHEAD clicked: I authorize this exact checkout." if consent_mode == "click" else
                    "Auto GO AHEAD: the visible 10-second countdown on this exact proposal ran out "
                    "without the customer pausing or cancelling."),
    }, direction="in")
    return await _authorize_and_execute(trace, user_id, row.trusted_session_id, checkout, pm, consent, demo)


def _record_consent(user_id: str, checkout: CheckoutObject, pm: dict, kind: str, mode: str = "click") -> str:
    consent_id = f"cns_{uuid.uuid4().hex[:12]}"
    with get_session() as db:
        db.add(CustomerConsent(consent_id=consent_id, user_id=user_id, checkout_id=checkout.checkout_id,
                               merchant_id=checkout.merchant_id, checkout_hash=checkout.checkout_hash,
                               total=checkout.total, currency=checkout.currency,
                               payment_method_id=pm["payment_method_id"], kind=kind))
        write_audit_event(db, "USER_APPROVED_PURCHASE", user_id=user_id, order_id=checkout.checkout_id,
                          metadata={"consent_id": consent_id, "checkout_hash": checkout.checkout_hash,
                                    "total": checkout.total, "kind": kind, "mode": mode})
        db.commit()
    return consent_id


def _order_payload(checkout: CheckoutObject, result: PaymentResult, order: dict, pm_display: Optional[str]) -> dict:
    """The confirmed-order dict returned to the UI. `result.amount` is the cash
    charged (0 when fully covered by points); loyalty fields show the split."""
    return {
        "order_id": checkout.checkout_id, "merchant_id": checkout.merchant_id,
        "merchant_name": checkout.merchant_name, "product_id": checkout.product_id,
        "product_title": checkout.product_title, "size": checkout.size, "color": checkout.color,
        "quantity": checkout.quantity, "subtotal": checkout.subtotal, "tax": checkout.tax,
        "shipping": checkout.shipping, "total": checkout.total, "amount_paid": result.amount,
        "loyalty_points_redeemed": checkout.loyalty_points_redeemed, "loyalty_value": checkout.loyalty_value,
        "currency": checkout.currency,
        "delivery_date": checkout.delivery_date, "delivery_display": _pretty_date(checkout.delivery_date),
        "transaction_id": result.transaction_id, "tracking_number": order["tracking_number"],
        "payment_method": pm_display,
        "points_earned": order["points_earned"], "loyalty_balance": order["loyalty_balance"],
    }


async def _authorize_and_execute(trace: Trace, user_id: str, trusted_session_id: str, checkout: CheckoutObject,
                                 pm: dict, consent_id: str, demo: Optional[str]) -> dict:
    # AP2: payment authorization evidence, created only now, after consent.
    with get_session() as db:
        cart_doc = _load_mandate(db, checkout.checkout_id, "cart")
        cart_ok, cart_reason = _verify_cart(cart_doc, checkout.checkout_hash)
        if not cart_ok:
            return _reject(trace, "CHECKOUT_HASH_MISMATCH" if "hash" in cart_reason else cart_reason,
                           "The checkout evidence did not verify, so nothing was authorized.")
        mandate = _ap2.create_payment_mandate(cart_mandate=AP2CartMandate(**cart_doc), order_id=checkout.checkout_id,
                                              payment_ref=pm["payment_method_id"], user_id=user_id,
                                              consent_id=consent_id)
        _store_mandate(db, mandate, "payment", checkout.checkout_id, user_id)
        db.commit()
    trace.add("CustomerAgent", "AP2 evidence", "AP2", "ap2_payment_authorization", {
        "payment_mandate_id": mandate.id, "cart_mandate_id": cart_doc["id"], "consent_id": consent_id,
        "checkout_hash": checkout.checkout_hash, "payment_ref": pm["payment_method_id"],
        "note": "Evidence that the customer approved this exact checkout and amount.",
    })

    payable = checkout.payable
    merchant = _agent(checkout.merchant_id)

    # Points-only: the merchant's loyalty ledger settles the whole order, so there
    # is no cash slice to authorize on the card rails — no ACP token, no PSP.
    if payable <= 0.005:
        trace.add(merchant, "CustomerAgent", "internal", "loyalty_settlement", {
            "points_redeemed": checkout.loyalty_points_redeemed, "value_redeemed": checkout.loyalty_value,
            "amount_due": 0.0,
            "note": "Order settled entirely with loyalty points — the merchant's reward ledger covers it. No card charge, no ACP token, no PSP.",
        }, direction="in")
        result = PaymentResult(status="success", transaction_id=f"LOYALTY_{uuid.uuid4().hex[:10].upper()}",
                               authorization_code="LOYALTY", amount=0.0, currency=checkout.currency)
        with get_session() as db:
            order = confirm_paid_order(db, checkout, result, user_id)
            db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout.checkout_id).update(
                {"status": "paid"}, synchronize_session=False)
            db.commit()
        trace.add(f"{merchant_catalog_name(checkout.merchant_id)} Order Service", merchant, "internal", "order_created", {
            "order_id": checkout.checkout_id, "tracking_number": order["tracking_number"],
            "delivery_date": checkout.delivery_date, "amount": 0.0,
        })
        trace.add(merchant, "CustomerAgent", "A2A", "order_confirmed", {
            "message": "ORDER_CONFIRMED", "order_id": checkout.checkout_id, "amount": 0.0,
            "delivery_date": checkout.delivery_date,
        }, direction="in")
        return _result("approved", trace, order=_order_payload(checkout, result, order, "Loyalty points"))

    # ACP: the scoped, single-use payment credential that crosses to the merchant,
    # scoped to the cash slice (amount_due), not the full order total.
    token = delegated.issue(merchant_id=checkout.merchant_id, checkout_id=checkout.checkout_id,
                            checkout_hash=checkout.checkout_hash, total=payable, currency=checkout.currency,
                            payment_method=pm, consent_id=consent_id, ap2_payment_mandate_id=mandate.id)
    with get_session() as db:
        db.add(DelegatedPaymentToken(
            token_id=token["token_id"], checkout_id=checkout.checkout_id, user_id=user_id,
            merchant_id=checkout.merchant_id, consent_id=consent_id, ap2_payment_mandate_id=mandate.id,
            payment_method_id=pm["payment_method_id"], max_amount_cents=token["max_amount_cents"],
            currency=checkout.currency, document=json.dumps(token),
            expires_at=datetime.fromtimestamp(token["expires_at"], tz=timezone.utc)))
        db.commit()
    trace.add("CustomerAgent", _agent(checkout.merchant_id), "ACP", "acp_token_issued", {
        "mode": "ACP-style scoped token", **delegated.public_view(token)})

    amount = payable + 20 if demo == "tampered_amount" else payable
    if demo == "tampered_amount":
        trace.add("CustomerAgent", _agent(checkout.merchant_id), "internal", "demo_tampered_charge",
                  {"authorized_total": payable, "attempted_charge": amount})
    result = await merchant_charge(user_id=user_id, token_id=token["token_id"], checkout_id=checkout.checkout_id,
                                   amount=amount, currency=checkout.currency, demo=demo, trace=trace)
    return result


# ── 3. Merchant side: verify and charge ─────────────────────────────────────

def _revoke_token(token_id: str) -> None:
    with get_session() as db:
        db.execute(update(DelegatedPaymentToken)
                   .where(DelegatedPaymentToken.token_id == token_id, DelegatedPaymentToken.status == "active")
                   .values(status="revoked", revoked_at=now_utc()))
        db.commit()


def _block(trace: Trace, user_id: str, checkout_id: str, token_id: str, reason: str, message: str,
           revoke: bool = True, **fields) -> dict:
    """Stop the payment: no charge, no order. A token that failed verification can't be retried."""
    if revoke:
        _revoke_token(token_id)
    with get_session() as db:
        write_audit_event(db, "PAYMENT_BLOCKED", user_id=user_id, agent_id=PAYIT.agent_id, order_id=checkout_id,
                          metadata={"reason": reason, "token_id": token_id})
        db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id,
                                          MerchantCheckout.status.in_(["proposed", "authorizing"])) \
            .update({"status": "payment_rejected"}, synchronize_session=False)
        db.commit()
    trace.add("PaymentService", "CustomerAgent", "PAYMENT", "payment_rejected",
              {"reason": reason, "order_created": False, "charged": False}, direction="in")
    return _reject(trace, reason, message, **fields)


async def merchant_charge(
    *, user_id: str, token_id: str, checkout_id: str, amount: float, currency: str,
    demo: Optional[str] = None, trace: Optional[Trace] = None,
) -> dict:
    """
    The merchant presents the delegated token to charge. Also exposed as an endpoint,
    which is how the replay and tampering acceptance tests call it directly.
    """
    trace = trace or Trace()
    with get_session() as db:
        token_row = db.query(DelegatedPaymentToken).filter(DelegatedPaymentToken.token_id == token_id,
                                                           DelegatedPaymentToken.user_id == user_id).first()
        row, checkout = _load_checkout(db, user_id, checkout_id)
        token_status = token_row.status if token_row else None
        token = json.loads(token_row.document) if token_row else None
    if token_row is None or row is None:
        return _reject(trace, "TOKEN_NOT_FOUND", "No payment authorization exists for this checkout.")
    merchant = _agent(checkout.merchant_id)

    trusted, decision = trust_sessions.require(user_id, checkout.merchant_id, SCOPE_PAYMENT,
                                               trusted_session_id=row.trusted_session_id, amount=amount)
    if trusted is None:
        trace.add(merchant, "CustomerAgent", "TRUST", "trusted_session_rejected",
                  {"action": SCOPE_PAYMENT, "failed_check": decision.failed_check, "reason": decision.reason},
                  direction="in")
        return _block(trace, user_id, checkout_id, token_id, "TRUST_VALIDATION_FAILED",
                      f"{merchant_catalog_name(checkout.merchant_id)} could not verify this shopping agent for payment, so no charge was authorized.")
    trace.add(merchant, "CustomerAgent", "TRUST", "trusted_session_verified",
              {"action": SCOPE_PAYMENT, "trusted_session_id": trusted.session_id, "amount": amount}, direction="in")

    if token_status == "consumed":
        return _block(trace, user_id, checkout_id, token_id, "TOKEN_ALREADY_CONSUMED",
                      "This payment token was already used. Nothing was charged.", revoke=False)
    if token_status == "revoked":
        return _block(trace, user_id, checkout_id, token_id, "TOKEN_REVOKED",
                      "This payment token was cancelled. Nothing was charged.", revoke=False)

    ok, reason, checks = delegated.verify(token, merchant_id=checkout.merchant_id, checkout_id=checkout.checkout_id,
                                          checkout_hash=checkout.checkout_hash, amount_cents=round(amount * 100),
                                          currency=currency)
    trace.add(merchant, "CustomerAgent", "ACP", "acp_token_verified" if ok else "acp_token_rejected",
              {"token_id": token_id, "charge_cents": round(amount * 100), "checks": checks}, direction="in")
    if not ok:
        return _block(trace, user_id, checkout_id, token_id, reason,
                      "The payment amount or scope did not match what you authorized for this exact order, so nothing was charged.")

    with get_session() as db:
        cart_doc = _load_mandate(db, checkout.checkout_id, "cart")
        pay_doc = _load_mandate(db, checkout.checkout_id, "payment")
    ap2_checks = []
    cart_ok, _ = _verify_cart(cart_doc, checkout.checkout_hash)
    ap2_checks.append({"check": "cart_evidence_matches_checkout", "status": "pass" if cart_ok else "fail"})
    pay_ok = False
    if pay_doc is not None:
        pay = AP2PaymentMandate(**pay_doc)
        subject = pay.credentialSubject
        pay_ok = (_ap2.verify_mandate(pay) and subject.get("checkout_hash") == checkout.checkout_hash
                  and subject.get("customer_consent_id") == token["consent_id"]
                  and subject.get("payment_ref") == token["payment_method_id"])
    ap2_checks.append({"check": "payment_authorization_matches_token", "status": "pass" if pay_ok else "fail"})
    trace.add(merchant, "AP2 evidence", "AP2", "ap2_evidence_verified" if cart_ok and pay_ok else "ap2_evidence_rejected",
              {"checks": ap2_checks}, direction="in")
    if not (cart_ok and pay_ok):
        return _block(trace, user_id, checkout_id, token_id, "AUTHORIZATION_EVIDENCE_INVALID",
                      "The authorization evidence did not match this checkout. Nothing was charged.")

    # The merchant re-checks its own terms before money moves. A material change pauses for the customer.
    if demo == "delivery_change":
        new_date = (date.fromisoformat(checkout.delivery_date) + timedelta(days=DELIVERY_SLIP_DAYS)).isoformat()
        with get_session() as db:
            db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id).update(
                {"status": "reconsent_required",
                 "document": json.dumps({**json.loads(checkout.model_dump_json()), "pending_delivery_date": new_date})},
                synchronize_session=False)
            write_audit_event(db, "CONDITION_CHANGED", user_id=user_id, order_id=checkout_id,
                              metadata={"field": "delivery_date", "from": checkout.delivery_date, "to": new_date})
            db.commit()
        trace.add(merchant, "CustomerAgent", "A2A", "condition_changed",
                  {"field": "delivery_date", "previous": checkout.delivery_date, "new": new_date,
                   "previous_display": _pretty_date(checkout.delivery_date), "new_display": _pretty_date(new_date)},
                  direction="in")
        trace.add("CustomerAgent", "Customer", "HUMAN", "reconsent_required",
                  {"checkout_id": checkout_id, "payment": "paused, token unused", "token_id": token_id})
        name = merchant_catalog_name(checkout.merchant_id)
        return _result("reconsent_required", trace, reason="DELIVERY_CHANGED",
                       message=(f"Delivery on {_pretty_date(checkout.delivery_date)} is no longer available. "
                                f"{name} can deliver on {_pretty_date(new_date)} instead. Would you like to continue?"),
                       checkout_id=checkout_id, previous_delivery_date=checkout.delivery_date,
                       new_delivery_date=new_date, new_delivery_display=_pretty_date(new_date))

    # Single use: claim the token atomically before any money moves.
    with get_session() as db:
        claim = db.execute(update(DelegatedPaymentToken)
                           .where(DelegatedPaymentToken.token_id == token_id, DelegatedPaymentToken.status == "active")
                           .values(status="consumed", consumed_at=now_utc()))
        db.commit()
    if claim.rowcount == 0:
        return _block(trace, user_id, checkout_id, token_id, "TOKEN_ALREADY_CONSUMED",
                      "This payment token was already used. Nothing was charged.", revoke=False)

    # Internal enforcement: map the verified delegated authorization onto a DPAT, then run the 12 checks.
    pm = methods.get_method(user_id, token["payment_method_id"])
    with get_session() as db:
        dpat_id, token_dict, authorization_id, error = await authorization_adapter.to_internal_dpat(
            db, checkout=checkout, user_id=user_id)
        if error:
            db.rollback()
            return _block(trace, user_id, checkout_id, token_id, "POLICY_DENIED", error, revoke=False)
        db.query(DelegatedPaymentToken).filter(DelegatedPaymentToken.token_id == token_id).update(
            {"dpat_token_id": dpat_id}, synchronize_session=False)
        write_audit_event(db, "DPAT_CREATED", user_id=user_id, order_id=checkout_id, authorization_id=authorization_id,
                          metadata={"token_id": dpat_id, "from_delegated_token": token_id})
        db.commit()
    trace.add("PaymentAuthorizationAdapter", "PaymentService", "PAYMENT", "internal_dpat_issued", {
        "dpat_token_id": dpat_id, "from_delegated_token": token_id, "max_amount": checkout.total,
        "note": "Internal single-use enforcement token, not an industry protocol.",
    })

    request = PaymentRequest(token_id=dpat_id, agent_id=PAYIT.agent_id, merchant_id=checkout.merchant_id,
                             order_id=checkout.checkout_id, amount=amount, currency=currency)
    with get_session() as db:
        token_ctx, consent_exists, sig_error = load_token_context(db, checkout.checkout_id, dpat_id)
        if sig_error:
            return _block(trace, user_id, checkout_id, token_id, sig_error, "The internal authorization failed its signature check.", revoke=False)
        db.execute(update(DelegatedToken).where(DelegatedToken.token_id == dpat_id, DelegatedToken.consumed_at.is_(None))
                   .values(consumed_at=now_utc()))
        db.commit()

    result, events, blocked_reason = await payit.execute_payment(
        request, token_ctx, checkout.payable, checkout.checkout_hash, consent_exists,
        processor_wallet=methods.processor_wallet(pm) if pm else None)
    passed = sum(1 for e in events if e.passed)
    trace.add("PaymentService", "PaymentService", "PAYMENT", "payment_checks", {
        "passed": passed, "total": len(events), "dpat_token_id": dpat_id,
        "checks": [{"n": e.check_number, "check": e.check_name, "status": "pass" if e.passed else "fail",
                    "reason_code": e.reason_code} for e in events],
    })
    if blocked_reason:
        return _block(trace, user_id, checkout_id, token_id, blocked_reason,
                      "A payment check failed, so nothing was charged.", revoke=False)

    trace.add("PaymentService", "MockPSP", "PAYMENT", "psp_result", {
        "status": result.status, "transaction_id": result.transaction_id,
        "decline_reason": result.decline_reason, "payment_method": pm["display"] if pm else None,
    })
    if result.status != "success":
        _reasons = {
            "NO_ACTIVE_PAYMENT_METHOD": "there was no active payment method on file",
            "CARD_EXPIRED": "the card on file has expired",
        }
        why = _reasons.get(result.decline_reason or "", "the card was declined")
        return _block(trace, user_id, checkout_id, token_id, result.decline_reason or "DECLINED",
                      f"{merchant_catalog_name(checkout.merchant_id)}'s payment processor declined the payment because {why}. No charge was made.", revoke=False)

    with get_session() as db:
        order = confirm_paid_order(db, checkout, result, user_id)
        db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id).update(
            {"status": "paid"}, synchronize_session=False)
        db.commit()
    trace.add(f"{merchant_catalog_name(checkout.merchant_id)} Order Service", merchant, "internal", "order_created", {
        "order_id": checkout.checkout_id, "tracking_number": order["tracking_number"],
        "delivery_date": checkout.delivery_date, "amount": result.amount,
    })
    trace.add(merchant, "CustomerAgent", "A2A", "order_confirmed", {
        "message": "ORDER_CONFIRMED", "order_id": checkout.checkout_id, "amount": result.amount,
        "delivery_date": checkout.delivery_date,
    }, direction="in")
    return _result("approved", trace,
                   order=_order_payload(checkout, result, order, pm["display"] if pm else None),
                   delegated_token_id=token_id)


# ── 4. Re-consent after the merchant changed a term ─────────────────────────

async def reconsent(*, user_id: str, checkout_id: str, decision: str) -> dict:
    trace = Trace()
    with get_session() as db:
        row, checkout = _load_checkout(db, user_id, checkout_id)
        if row is None:
            return _reject(trace, "CHECKOUT_NOT_FOUND", "That checkout no longer exists.")
        doc = json.loads(row.document)
        pending = db.query(DelegatedPaymentToken).filter(DelegatedPaymentToken.checkout_id == checkout_id,
                                                         DelegatedPaymentToken.status == "active").all()
        pm_id = pending[-1].payment_method_id if pending else None
    if row.status != "reconsent_required":
        return _reject(trace, f"CHECKOUT_{row.status.upper()}", "There is no pending change to confirm.")

    # The unused token was bound to the old terms, so it is invalidated either way.
    for t in pending:
        _revoke_token(t.token_id)
        trace.add("CustomerAgent", "ACP", "ACP", "delegated_token_invalidated",
                  {"token_id": t.token_id, "reason": "checkout terms changed"})

    if decision != "yes":
        with get_session() as db:
            db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id).update(
                {"status": "cancelled"}, synchronize_session=False)
            write_audit_event(db, "CHECKOUT_CANCELLED", user_id=user_id, order_id=checkout_id,
                              metadata={"reason": "customer declined changed delivery date"})
            db.commit()
        trace.add("Customer", "CustomerAgent", "HUMAN", "checkout_cancelled",
                  {"checkout_id": checkout_id, "charged": False, "order_created": False}, direction="in")
        return _result("cancelled", trace, message="Okay, I cancelled that checkout. Nothing was charged.",
                       checkout_id=checkout_id)

    # YES: apply the new delivery date, re-bind the checkout, then authorize again from fresh consent.
    new_date = doc.get("pending_delivery_date")
    updated = checkout.model_copy(update={"delivery_date": new_date})
    unit_price = round(updated.subtotal / updated.quantity, 2)
    updated = updated.model_copy(update={"checkout_hash": checkout_hash_for(updated, unit_price)})
    with get_session() as db:
        db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id).update(
            {"status": "proposed", "checkout_hash": updated.checkout_hash, "document": updated.model_dump_json()},
            synchronize_session=False)
        db.commit()
    product = merchant_catalog.get_product(updated.product_id)
    ap2 = _issue_checkout_mandates(updated, product, None, user_id)
    trace.add("CustomerAgent", "AP2 evidence", "AP2", "ap2_checkout_bound", {
        "cart_mandate_id": ap2["cart_mandate_id"], "checkout_hash": updated.checkout_hash,
        "verified": ap2["cart_verified"], "delivery_date": new_date, "note": "Re-bound to the new delivery date.",
    })
    pm = methods.get_method(user_id, pm_id) if pm_id else methods.default_method(user_id, updated.merchant_id)
    consent = _record_consent(user_id, updated, pm, kind="reconsent")
    trace.add("Customer", "CustomerAgent", "HUMAN", "reconsent_received", {
        "consent_id": consent, "checkout_id": checkout_id, "checkout_hash": updated.checkout_hash,
        "delivery_date": new_date, "total": updated.total,
    }, direction="in")
    with get_session() as db:
        db.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id).update(
            {"status": "authorizing"}, synchronize_session=False)
        db.commit()
    return await _authorize_and_execute(trace, user_id, row.trusted_session_id, updated, pm, consent, None)
