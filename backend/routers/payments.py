"""
Payment Execution Service — deterministic FastAPI router.
No LLM in any endpoint. Runs after /api/authorizations/approve has
already issued a DPAT token; this is where money actually moves.

Endpoints:
  POST /api/payments/execute   — PayIt validates (12 checks) + charges; TrackIt records the order
  GET  /api/orders             — order list for the Dashboard
  GET  /api/orders/{order_id}  — single order detail
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update

from backend.agents import payit, trackit
from backend.auth.dependencies import CurrentUser, get_current_user
from backend.config.agents import PAYIT, TRACKIT
from backend.db.schema import AuditEvent, DelegatedToken, Merchant, Order, PaymentAuthorization
from backend.db.session_utils import get_session, now_utc, write_audit_event
from backend.models.checkout import CheckoutObject
from backend.models.payment import PaymentRequest
from backend.observability.tracing import get_tracer
from backend.payment.token_lookup import load_token_context

router = APIRouter()
tracer = get_tracer(__name__)


class ExecutePaymentRequest(BaseModel):
    token_id: str
    checkout_id: str
    checkout_hash: str
    merchant_id: str
    merchant_name: str
    total: float
    currency: str = "USD"
    product_id: str
    product_title: str
    subtotal: float
    tax: float
    shipping: float


class ExecutePaymentResponse(BaseModel):
    status: str  # "success" | "blocked"
    order_id: str
    amount: float
    merchant: str
    summary: str
    transaction_id: Optional[str] = None
    blocked_reason: Optional[str] = None


def _insert_order_if_absent(session, fields: dict):
    """
    The first execute call for an order_id is authoritative. A later replay
    (already blocked by the guardrail engine before this is ever reached)
    must never overwrite a prior confirmed/declined outcome.
    """
    existing = session.query(Order).filter(Order.order_id == fields["order_id"]).first()
    if not existing:
        session.add(Order(**fields))


@router.post("/api/payments/execute", response_model=ExecutePaymentResponse)
async def execute_payment_endpoint(
    req: ExecutePaymentRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    PayIt runs the 12-check guardrail engine, then charges via the mock
    processor. TrackIt records the resulting Order row + audit trail.
    """
    with tracer.start_as_current_span("payments.execute") as span:
        span.set_attribute("order_id", req.checkout_id)

        checkout = CheckoutObject(
            checkout_id=req.checkout_id,
            merchant_id=req.merchant_id,
            merchant_name=req.merchant_name,
            product_id=req.product_id,
            product_title=req.product_title,
            quantity=1,
            subtotal=req.subtotal,
            tax=req.tax,
            shipping=req.shipping,
            total=req.total,
            currency=req.currency,
            checkout_hash=req.checkout_hash,
        )
        payment_request = PaymentRequest(
            token_id=req.token_id,
            agent_id=PAYIT.agent_id,
            merchant_id=req.merchant_id,
            order_id=req.checkout_id,
            amount=req.total,
            currency=req.currency,
        )

        with get_session() as session:
            token_dict, consent_exists, sig_error = load_token_context(
                session, req.checkout_id, req.token_id
            )

            if sig_error:
                write_audit_event(session, "PAYMENT_BLOCKED", user_id=current_user.user_id,
                                   order_id=req.checkout_id,
                                   metadata={"reason": sig_error})
                _insert_order_if_absent(session, trackit.record_incomplete_order(checkout, "blocked", current_user.user_id))
                session.commit()
                return ExecutePaymentResponse(
                    status="blocked", order_id=req.checkout_id, amount=req.total,
                    merchant=req.merchant_name,
                    summary=trackit.summarize_decline(req.checkout_id, sig_error),
                    blocked_reason=sig_error,
                )

            # Atomically claim single-use consumption before charging — closes the
            # race where two concurrent execute calls for the same token (two tabs,
            # or a fast replay) could both read consumed_at=None and both charge.
            # Losing the race is reported the same way check 4 would report it.
            # This also means any execute attempt burns the token even if a later
            # guardrail check fails — a single-use token gets a single attempt,
            # which closes a tamper-probing vector (repeated retries against the
            # same token with different tampered fields) that a "consume only on
            # success" policy would otherwise leave open.
            if token_dict is not None and token_dict.get("consumed_at") is None:
                claim = session.execute(
                    update(DelegatedToken)
                    .where(DelegatedToken.token_id == req.token_id,
                           DelegatedToken.consumed_at.is_(None))
                    .values(consumed_at=now_utc())
                )
                if claim.rowcount == 0:
                    write_audit_event(session, "PAYMENT_BLOCKED", user_id=current_user.user_id,
                                       agent_id=PAYIT.agent_id, order_id=req.checkout_id,
                                       metadata={"reason": "TOKEN_ALREADY_CONSUMED"})
                    _insert_order_if_absent(session, trackit.record_incomplete_order(checkout, "blocked", current_user.user_id))
                    session.commit()
                    return ExecutePaymentResponse(
                        status="blocked", order_id=req.checkout_id, amount=req.total,
                        merchant=req.merchant_name,
                        summary=trackit.summarize_decline(req.checkout_id, "TOKEN_ALREADY_CONSUMED"),
                        blocked_reason="TOKEN_ALREADY_CONSUMED",
                    )
                session.commit()  # persist the claim immediately so a concurrent request sees it

            result, events, blocked_reason = await payit.execute_payment(
                payment_request, token_dict, req.total, req.checkout_hash, consent_exists,
            )

            # One of the other 11 guardrail checks failed — no charge was attempted,
            # but the token is already consumed (claimed above), by design.
            if blocked_reason is not None:
                write_audit_event(session, "PAYMENT_BLOCKED", user_id=current_user.user_id,
                                   agent_id=PAYIT.agent_id, order_id=req.checkout_id,
                                   metadata={"reason": blocked_reason})
                _insert_order_if_absent(session, trackit.record_incomplete_order(checkout, "blocked", current_user.user_id))
                session.commit()
                return ExecutePaymentResponse(
                    status="blocked", order_id=req.checkout_id, amount=req.total,
                    merchant=req.merchant_name,
                    summary=trackit.summarize_decline(req.checkout_id, blocked_reason),
                    blocked_reason=blocked_reason,
                )

            if result.status == "declined":
                auth = session.query(PaymentAuthorization).filter(
                    PaymentAuthorization.order_id == req.checkout_id
                ).order_by(PaymentAuthorization.approved_at.desc()).first()
                if auth:
                    auth.status = "declined"
                write_audit_event(session, "PAYMENT_DECLINED", user_id=current_user.user_id,
                                   agent_id=PAYIT.agent_id, order_id=req.checkout_id,
                                   metadata={"reason": result.decline_reason})
                _insert_order_if_absent(session, trackit.record_incomplete_order(checkout, "declined", current_user.user_id))
                session.commit()
                return ExecutePaymentResponse(
                    status="blocked", order_id=req.checkout_id, amount=req.total,
                    merchant=req.merchant_name,
                    summary=trackit.summarize_decline(req.checkout_id, result.decline_reason),
                    blocked_reason=result.decline_reason,
                )

            auth = session.query(PaymentAuthorization).filter(
                PaymentAuthorization.order_id == req.checkout_id
            ).order_by(PaymentAuthorization.approved_at.desc()).first()
            if auth:
                auth.status = "completed"

            order_fields = trackit.confirm_order(checkout, result, current_user.user_id)
            _insert_order_if_absent(session, order_fields)

            write_audit_event(session, "PAYMENT_EXECUTED", user_id=current_user.user_id,
                               agent_id=PAYIT.agent_id, order_id=req.checkout_id,
                               metadata={"transaction_id": result.transaction_id, "amount": result.amount})
            write_audit_event(session, "ORDER_CONFIRMED", user_id=current_user.user_id,
                               agent_id=TRACKIT.agent_id, order_id=req.checkout_id,
                               metadata={"transaction_id": result.transaction_id})
            session.commit()

            return ExecutePaymentResponse(
                status="success", order_id=req.checkout_id, amount=result.amount,
                merchant=req.merchant_name, transaction_id=result.transaction_id,
                summary=trackit.summarize_order(checkout, result),
            )


def _block_reason(session, order_id: str) -> Optional[str]:
    """Most recent block/decline reason for an order, from the audit trail."""
    event = (
        session.query(AuditEvent)
        .filter(AuditEvent.order_id == order_id)
        .filter(AuditEvent.event_type.in_(["PAYMENT_BLOCKED", "PAYMENT_DECLINED"]))
        .order_by(AuditEvent.event_timestamp.desc())
        .first()
    )
    if event and event.metadata_json:
        return json.loads(event.metadata_json).get("reason")
    return None


@router.get("/api/orders")
async def list_orders(current_user: CurrentUser = Depends(get_current_user)):
    """Order list for the Dashboard — collapses status to 'paid' | 'blocked'."""
    with get_session() as session:
        rows = (
            session.query(Order, Merchant)
            .join(Merchant, Order.merchant_id == Merchant.merchant_id)
            .filter(Order.user_id == current_user.user_id)
            .order_by(Order.created_at.desc())
            .all()
        )
        results = []
        for order, merchant in rows:
            is_paid = order.status == "confirmed"
            results.append({
                "order_id": order.order_id,
                "merchant": merchant.merchant_name,
                "amount": order.amount,
                "status": "paid" if is_paid else "blocked",
                "reason": None if is_paid else _block_reason(session, order.order_id),
            })
        return results


@router.get("/api/orders/{order_id}")
async def get_order(order_id: str):
    with get_session() as session:
        row = (
            session.query(Order, Merchant)
            .join(Merchant, Order.merchant_id == Merchant.merchant_id)
            .filter(Order.order_id == order_id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Order not found")
        order, merchant = row
        is_confirmed = order.status == "confirmed"
        return {
            "order_id": order.order_id,
            "merchant_id": order.merchant_id,
            "merchant_name": merchant.merchant_name,
            "product_id": order.product_id,
            "amount": order.amount,
            "currency": order.currency,
            "status": order.status,
            "transaction_id": order.transaction_id,
            "reason": None if is_confirmed else _block_reason(session, order.order_id),
            "created_at": order.created_at.isoformat() if order.created_at else None,
        }
