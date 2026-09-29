"""
TrackIt — Order & Audit Agent (Agent 6).
Builds the fields for the Order row and the human-readable summaries shown
in the UI. Pure functions only — the router owns the actual DB write,
matching the same division of labor as CartUp/GreenLight (agents contain
domain logic, routers own persistence). No LLM.
"""
from backend.models.checkout import CheckoutObject
from backend.models.payment import PaymentResult
from backend.observability.tracing import get_tracer

tracer = get_tracer(__name__)


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
    }


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
