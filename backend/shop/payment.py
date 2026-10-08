"""
Confirm & pay — the consent gate between "review your order" and money moving.

Only an explicit consent (the customer's GO AHEAD / Place order click) gets
here. From this point it's deterministic code: re-check stock and prices,
then the existing secure path — GreenLight records consent and issues a
single-use signed token scoped to this exact checkout, PayIt runs the
12-check guardrail engine, the processor charges the chosen saved card —
and only then does the order service create the order.

Amounts always come from the server-held checkout, never from the caller.
Each attempt gets its own payment reference (CHK_…-1, -2 …) so a declined
card can be swapped and retried on the same checkout.
"""
import logging

from fastapi import HTTPException

from backend.auth.dependencies import CurrentUser
from backend.db.schema import Checkout, Order, PaymentAuthorization
from backend.db.session_utils import get_session
from backend.shop import checkout as checkout_service
from backend.shop import orders as order_service

MERCHANT_ID, MERCHANT_NAME = "SHOPSPHERE", "ShopSphere"

log = logging.getLogger(__name__)

DECLINE_MESSAGES = {
    "INSUFFICIENT_BALANCE": "Your wallet balance isn't enough for this order. Choose a card instead.",
    "CARD_DECLINED": "Your card was declined. Try a different card.",
    "CARD_EXPIRED": "That card has expired. Try a different card.",
    "NO_ACTIVE_PAYMENT_METHOD": "That card isn't available. Choose another card.",
}


async def confirm(user: CurrentUser, checkout_id: str, consent: bool) -> dict:
    # Imported here: the routers import this module's callers.
    from backend.routers.authorizations import ApproveRequest, approve_authorization
    from backend.routers.payments import ExecutePaymentRequest, execute_payment_endpoint

    if consent is not True:
        raise checkout_service.CheckoutError(
            "CONSENT_REQUIRED", "Payment needs your explicit go-ahead.", 400)

    with get_session() as db:
        co = checkout_service.get_checkout(db, user.user_id, checkout_id)
        if user.is_visitor and not co.guest_email:      # guest checkout needs the guest's details first
            raise checkout_service.CheckoutError(
                "GUEST_DETAILS_REQUIRED", "Add your name, email and shipping address first.", 403)
        if co.status != "open":
            raise checkout_service.CheckoutError(
                "CHECKOUT_CLOSED", f"This checkout is {co.status}.", 409)
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
        co.status = "consented"
        db.commit()

    def reopen(outcome: str, reason: str, message: str) -> dict:
        with get_session() as db:
            co = db.query(Checkout).filter_by(checkout_id=checkout_id).one()
            co.status = "open"                         # change card / retry on the same checkout
            # Spec: no order is created unless payment is authorized. The audit
            # trail and authorization records keep the attempt's full history.
            db.query(Order).filter_by(order_id=payment_ref).delete()
            db.commit()
            return {"status": outcome, "reason": reason, "message": message,
                    "checkout": checkout_service.snapshot(db, co)}

    # 1. Consent recorded + single-use scoped token (GreenLight)
    try:
        approval = await approve_authorization(ApproveRequest(
            checkout_id=payment_ref, merchant_id=MERCHANT_ID, merchant_name=MERCHANT_NAME,
            product_id=first["product_id"], product_title=title, **amounts,
        ), user)
    except HTTPException as exc:                       # policy refused before any token existed
        return reopen("blocked", "POLICY_DENIED", str(exc.detail))

    # 2. 12-check guardrails + charge (PayIt → processor)
    result = await execute_payment_endpoint(ExecutePaymentRequest(
        token_id=approval.token_id, checkout_id=payment_ref, merchant_id=MERCHANT_ID,
        merchant_name=MERCHANT_NAME, product_id=first["product_id"], product_title=title,
        payment_method=pay_with, payment_method_id=payment_method_id, **amounts,
    ), user)

    if result.status != "success":
        reason = result.blocked_reason or "PAYMENT_FAILED"
        outcome = "declined" if reason in DECLINE_MESSAGES else "blocked"
        return reopen(outcome, reason, DECLINE_MESSAGES.get(reason, "Payment wasn't authorized."))

    # 3. Authorized → create the order. If that fails, release the payment so
    # the shopper is never charged for an order that doesn't exist.
    try:
        with get_session() as db:
            co = db.query(Checkout).filter_by(checkout_id=checkout_id).one()
            order = order_service.finalize(db, co, payment_ref)
            outcome = {"status": "authorized", "order": order_service.order_dict(db, order),
                       "transaction_id": result.transaction_id}
    except Exception:
        log.exception("order creation failed after authorization (%s); voiding", payment_ref)
        from backend.payment.mock_processor import void_authorization
        void_authorization(result.transaction_id)
        return reopen("order_failed", "ORDER_CREATION_FAILED",
                      "Your payment was approved, but ShopSphere couldn't create the order, so the payment "
                      "was released and you haven't been charged. Please try again.")

    # 4. Confirmation email (demo outbox). The order already exists, so a
    # problem here never undoes the payment.
    try:
        from backend.shop import notifications
        with get_session() as db:
            order = db.query(Order).filter_by(order_id=payment_ref).one()
            outcome["confirmation_email"] = notifications.send_order_confirmation(db, order)
    except Exception:
        log.exception("confirmation email failed for %s", payment_ref)
        outcome["confirmation_email"] = None
    return outcome
