"""
TrackIt — Order & Audit Agent (Agent 6).
Builds the fields for the Order row and the human-readable summaries shown
in the UI. Pure functions only — the router owns the actual DB write,
matching the same division of labor as CartUp/GreenLight (agents contain
domain logic, routers own persistence). No LLM.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from backend.models.checkout import CheckoutObject
from backend.models.payment import PaymentResult
from backend.observability.tracing import get_tracer

tracer = get_tracer(__name__)

DEFAULT_DELIVERY_DAYS = 5
# Threshold below which an order still reads as "processing" rather than
# "shipped" — an order placed moments ago in a live demo should honestly
# show as just-placed, not already in transit.
PROCESSING_WINDOW_DAYS = 0.25


def confirm_order(
    checkout: CheckoutObject, payment_result: PaymentResult, user_id: str = "USR001"
) -> dict:
    """Fields for a confirmed (paid) Order row."""
    with tracer.start_as_current_span("trackit.confirm_order") as span:
        span.set_attribute("order_id", checkout.checkout_id)
        return {
            "order_id": checkout.checkout_id,
            "user_id": user_id,
            "merchant_id": checkout.merchant_id,
            "product_id": checkout.product_id,
            "amount": payment_result.amount,
            "currency": payment_result.currency,
            "status": "confirmed",
            "transaction_id": payment_result.transaction_id,
            "tracking_number": f"TRK{uuid.uuid4().hex[:10].upper()}",
        }


def record_incomplete_order(
    checkout: CheckoutObject, outcome: str, user_id: str = "USR001"
) -> dict:
    """Fields for a blocked/declined Order row. outcome: 'blocked' | 'declined'."""
    return {
        "order_id": checkout.checkout_id,
        "user_id": user_id,
        "merchant_id": checkout.merchant_id,
        "product_id": checkout.product_id,
        "amount": checkout.total,
        "currency": checkout.currency,
        "status": outcome,
        "transaction_id": None,
        "tracking_number": None,
    }


def compute_delivery_status(created_at: datetime, delivery_days: Optional[int]) -> dict:
    """
    Deterministic, time-based delivery simulation — no carrier integration,
    no background job. Status advances purely from wall-clock time elapsed
    since the order was placed, relative to the product's own delivery_days
    estimate, so an order placed moments ago in a live demo honestly shows
    "processing" rather than a fabricated "delivered".
    """
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    days = delivery_days or DEFAULT_DELIVERY_DAYS
    estimated_delivery = created_at + timedelta(days=days)
    elapsed_days = (datetime.now(timezone.utc) - created_at).total_seconds() / 86400

    if elapsed_days >= days:
        status = "delivered"
    elif elapsed_days >= PROCESSING_WINDOW_DAYS:
        status = "shipped"
    else:
        status = "processing"

    return {"status": status, "estimated_delivery": estimated_delivery.isoformat()}


def summarize_order(checkout: CheckoutObject, payment_result: PaymentResult) -> str:
    """Deterministic order-confirmation template — no LLM."""
    return (
        f"Order {checkout.checkout_id} confirmed at {checkout.merchant_name}. "
        f"Charged ${payment_result.amount:.2f}. Transaction {payment_result.transaction_id}."
    )


def summarize_decline(checkout_id: str, reason: str) -> str:
    """Deterministic decline/block template — no LLM."""
    return (
        f"Order {checkout_id} was not completed ({reason}). "
        f"No funds were moved. Event logged to audit."
    )
