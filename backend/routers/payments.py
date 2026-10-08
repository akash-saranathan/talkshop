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
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update

from backend.agents import payit, trackit
from backend.auth.dependencies import CurrentUser, get_current_user, require_customer
from backend.config.agents import PAYIT, TRACKIT
from backend.db.schema import AuditEvent, CartItem, DelegatedToken, LoyaltyPoints, LoyaltyTransaction, Merchant, Order, PaymentAuthorization, Product, Wallet
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
    payment_method: str = "wallet"  # "wallet" | "card"
    payment_method_id: Optional[str] = None  # Demo 1: which saved card to charge


class ExecutePaymentResponse(BaseModel):
    status: str  # "success" | "blocked"
    order_id: str
    amount: float
    merchant: str
    summary: str
    transaction_id: Optional[str] = None
    blocked_reason: Optional[str] = None
    wallet_balance: Optional[float] = None
    points_earned: Optional[int] = None
    loyalty_balance: Optional[int] = None


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
    current_user: CurrentUser = Depends(require_customer),
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
            payment_method_id=req.payment_method_id,
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

            # Wallet balance check + deduction — only when paying from wallet.
            # Card payments are processed by the mock processor and bypass this
            # so a card purchase never drains or checks the wallet balance.
            wallet = session.query(Wallet).filter(Wallet.user_id == current_user.user_id).first()
            if req.payment_method != "card":
                if wallet is None or wallet.balance < result.amount:
                    auth = session.query(PaymentAuthorization).filter(
                        PaymentAuthorization.order_id == req.checkout_id
                    ).order_by(PaymentAuthorization.approved_at.desc()).first()
                    if auth:
                        auth.status = "declined"
                    write_audit_event(session, "PAYMENT_DECLINED", user_id=current_user.user_id,
                                       agent_id=PAYIT.agent_id, order_id=req.checkout_id,
                                       metadata={"reason": "INSUFFICIENT_BALANCE"})
                    _insert_order_if_absent(session, trackit.record_incomplete_order(checkout, "declined", current_user.user_id))
                    session.commit()
                    return ExecutePaymentResponse(
                        status="blocked", order_id=req.checkout_id, amount=req.total,
                        merchant=req.merchant_name,
                        summary=trackit.summarize_decline(req.checkout_id, "INSUFFICIENT_BALANCE"),
                        blocked_reason="INSUFFICIENT_BALANCE",
                        wallet_balance=wallet.balance if wallet else 0.0,
                    )
                wallet.balance -= result.amount

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

            # Award 1 loyalty point per $1 spent (rounded down)
            points_earned = int(result.amount)
            lp = session.query(LoyaltyPoints).filter(LoyaltyPoints.user_id == current_user.user_id).first()
            if not lp:
                lp = LoyaltyPoints(user_id=current_user.user_id, balance=points_earned, lifetime_points=points_earned)
                session.add(lp)
            else:
                lp.balance += points_earned
                lp.lifetime_points += points_earned
            session.add(LoyaltyTransaction(
                transaction_id=uuid.uuid4().hex,
                user_id=current_user.user_id,
                order_id=req.checkout_id,
                points_earned=points_earned,
                reason="purchase",
            ))
            session.commit()

            return ExecutePaymentResponse(
                status="success", order_id=req.checkout_id, amount=result.amount,
                merchant=req.merchant_name, transaction_id=result.transaction_id,
                summary=trackit.summarize_order(checkout, result),
                wallet_balance=wallet.balance if wallet else None,
                points_earned=points_earned,
                loyalty_balance=lp.balance,
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


def _shop_fields(session, order: Order) -> dict:
    """Demo 1 order detail, under keys that don't clash with the older ones."""
    from backend.shop.orders import order_dict
    d = order_dict(session, order)
    return {"display_id": d["order_id"], "lines": d["lines"], "subtotal": d["subtotal"], "tax": d["tax"],
            "shipping": d["shipping"], "delivery_method": d["delivery_method"],
            "delivery_date": d["delivery_date"], "ship_to": d["ship_to"], "payment": d["payment"],
            "payment_status": d["payment_status"]}


def _delivery_fields(order: Order, product: Optional[Product], cart_fallback: Optional[CartItem] = None) -> dict:
    """Product info + time-based delivery simulation, shared by both order endpoints.
    cart_fallback is a CartItem snapshot used when the Product row is missing (e.g. external product IDs)."""
    fb = cart_fallback
    if order.display_id:                       # ShopSphere order: the (simulated) shipment is the source
        from backend.shop import shipping
        confirmed = order.status == "confirmed"
        return {
            "product_title": product.name if product else None,
            "product_category": product.category if product else None,
            "product_image_url": product.image_url if product else None,
            "tracking_number": order.tracking_number,
            "delivery_status": shipping.summary(order) if confirmed else None,
            "estimated_delivery": order.delivery_date.isoformat() if confirmed and order.delivery_date else None,
            "shipment": shipping.view(order) if confirmed else None,
        }
    delivery = trackit.compute_delivery_status(
        order.created_at,
        product.delivery_days if product else (fb.delivery_days if fb else None),
    )
    return {
        "product_title":     (product.name      if product else None) or (fb.title     if fb else None),
        "product_category":  (product.category  if product else None) or (fb.category  if fb else None),
        "product_image_url": (product.image_url if product else None) or (fb.image_url if fb else None),
        "tracking_number": order.tracking_number,
        "delivery_status": delivery["status"] if order.status == "confirmed" else None,
        "estimated_delivery": delivery["estimated_delivery"] if order.status == "confirmed" else None,
    }


@router.get("/api/orders")
async def list_orders(current_user: CurrentUser = Depends(require_customer)):
    """Order list for the Dashboard — collapses status to 'paid' | 'blocked'."""
    with get_session() as session:
        rows = (
            session.query(Order, Merchant, Product)
            .join(Merchant, Order.merchant_id == Merchant.merchant_id)
            .outerjoin(Product, Order.product_id == Product.product_id)
            .filter(Order.user_id == current_user.user_id)
            .order_by(Order.created_at.desc())
            .all()
        )
        results = []
        for order, merchant, product in rows:
            is_paid = order.status == "confirmed"
            # When the product isn't in the catalog (e.g. external/DummyJSON IDs),
            # fall back to the CartItem snapshot which was saved at add-to-cart time.
            cart_fallback = None
            if product is None:
                cart_fallback = (
                    session.query(CartItem)
                    .filter(CartItem.product_id == order.product_id, CartItem.user_id == order.user_id)
                    .order_by(CartItem.added_at.desc())
                    .first()
                )
            results.append({
                "order_id": order.order_id,
                "merchant": merchant.merchant_name,
                "amount": order.amount,
                "status": "paid" if is_paid else "blocked",
                "reason": None if is_paid else _block_reason(session, order.order_id),
                "created_at": order.created_at.isoformat() if order.created_at else None,
                **_delivery_fields(order, product, cart_fallback),
                # ShopSphere (Demo 1) order detail: public SS-##### id, lines, delivery, masked card
                **(_shop_fields(session, order) if order.display_id else {}),
            })
        return results


@router.get("/api/orders/{order_id}")
async def get_order(order_id: str, current_user: CurrentUser = Depends(require_customer)):
    """One of the caller's own orders, by internal id or public id (SS-48291)."""
    with get_session() as session:
        row = (
            session.query(Order, Merchant, Product)
            .join(Merchant, Order.merchant_id == Merchant.merchant_id)
            .outerjoin(Product, Order.product_id == Product.product_id)
            .filter((Order.order_id == order_id) | (Order.display_id == order_id))
            .filter(Order.user_id == current_user.user_id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Order not found")
        order, merchant, product = row
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
            **_delivery_fields(order, product),
            **(_shop_fields(session, order) if order.display_id else {}),
        }


@router.get("/api/wallet")
async def get_wallet(current_user: CurrentUser = Depends(require_customer)):
    """Current wallet balance for the Dashboard's hero card."""
    with get_session() as session:
        wallet = session.query(Wallet).filter(Wallet.user_id == current_user.user_id).first()
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        return {"balance": wallet.balance, "currency": wallet.currency}
