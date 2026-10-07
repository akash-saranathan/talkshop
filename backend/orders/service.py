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

    points_earned = int(result.amount)  # 1 point per $1, rounded down
    lp = session.query(LoyaltyPoints).filter(LoyaltyPoints.user_id == user_id).first()
    if not lp:
        lp = LoyaltyPoints(user_id=user_id, balance=points_earned, lifetime_points=points_earned)
        session.add(lp)
    else:
        lp.balance += points_earned
        lp.lifetime_points += points_earned
    session.add(LoyaltyTransaction(transaction_id=uuid.uuid4().hex, user_id=user_id,
                                   order_id=checkout.checkout_id, points_earned=points_earned, reason="purchase"))
    return {"points_earned": points_earned, "loyalty_balance": lp.balance,
            "tracking_number": fields.get("tracking_number")}
