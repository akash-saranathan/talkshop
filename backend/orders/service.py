"""
Merchant order service — records a paid order. Shared by the legacy execute
endpoint and the Demo 2 purchase flow so both write the same rows.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.agents import trackit
from backend.config.agents import PAYIT, TRACKIT
from backend.db.schema import LoyaltyPoints, LoyaltyTransaction, Order, PaymentAuthorization
from backend.db.session_utils import write_audit_event
from backend.models.checkout import CheckoutObject
from backend.models.payment import PaymentResult


def insert_order_if_absent(session: Session, fields: dict) -> None:
    """The first outcome recorded for an order id is authoritative; replays never overwrite it."""
    if not session.query(Order).filter(Order.order_id == fields["order_id"]).first():
        session.add(Order(**fields))


def confirm_paid_order(session: Session, checkout: CheckoutObject, result: PaymentResult, user_id: str) -> dict:
    """Create the order, mark the authorization completed, audit it and award loyalty points."""
    auth = session.query(PaymentAuthorization).filter(
        PaymentAuthorization.order_id == checkout.checkout_id
    ).order_by(PaymentAuthorization.approved_at.desc()).first()
    if auth:
        auth.status = "completed"

    fields = trackit.confirm_order(checkout, result, user_id)
    insert_order_if_absent(session, fields)

    write_audit_event(session, "PAYMENT_EXECUTED", user_id=user_id, agent_id=PAYIT.agent_id,
                      order_id=checkout.checkout_id,
                      metadata={"transaction_id": result.transaction_id, "amount": result.amount})
    write_audit_event(session, "ORDER_CONFIRMED", user_id=user_id, agent_id=TRACKIT.agent_id,
                      order_id=checkout.checkout_id, metadata={"transaction_id": result.transaction_id})

    # Loyalty is merchant-scoped and members-only: a guest purchase earns nothing
    # (buying as a guest doesn't silently create a loyalty membership).
    merchant_id = checkout.merchant_id
    from backend.trust.credentials import customer_ref
    from backend.trust.verifier import merchant_relationship
    is_member = merchant_relationship(merchant_id, customer_ref(user_id)) == "merchant_member"
    if not is_member:
        return {"points_earned": 0, "loyalty_balance": 0, "points_redeemed": 0,
                "tracking_number": fields.get("tracking_number")}

    # Earn on the cash actually paid (1 pt per $1); redeem (deduct) the points
    # applied to this order. Both hit this merchant's balance only. Committed
    # here, inside the same success transaction — a declined/cancelled payment
    # never reaches this function, so points are never lost on a failure.
    points_earned = int(result.amount)
    points_redeemed = int(getattr(checkout, "loyalty_points_redeemed", 0) or 0)
    lp = session.query(LoyaltyPoints).filter(
        LoyaltyPoints.user_id == user_id, LoyaltyPoints.merchant_id == merchant_id
    ).first()
    if not lp:
        lp = LoyaltyPoints(user_id=user_id, merchant_id=merchant_id, balance=0, lifetime_points=0)
        session.add(lp)
    lp.balance += points_earned - points_redeemed
    lp.lifetime_points += points_earned
    if points_earned:
        session.add(LoyaltyTransaction(transaction_id=uuid.uuid4().hex, user_id=user_id, merchant_id=merchant_id,
                                       order_id=checkout.checkout_id, points_earned=points_earned, reason="purchase"))
    if points_redeemed:
        session.add(LoyaltyTransaction(transaction_id=uuid.uuid4().hex, user_id=user_id, merchant_id=merchant_id,
                                       order_id=checkout.checkout_id, points_earned=-points_redeemed, reason="redemption"))
    return {"points_earned": points_earned, "loyalty_balance": lp.balance, "points_redeemed": points_redeemed,
            "tracking_number": fields.get("tracking_number")}
