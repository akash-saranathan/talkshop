"""
UCP (Universal Commerce Protocol) router — a real HTTP endpoint for the
checkout-session total calculation UCP's spec defines. backend/agents/cartup.py
calls this over HTTP for the "lock totals" step instead of computing
subtotal/tax/shipping/total in-process — using the exact same tax/shipping
rules as the rest of the app (backend/payment/policy.py), so the numbers
never drift from what AP2/ACP/guardrails already bind against.

Wire format: ucp.dev/specification/checkout-rest/ (2026-01-23) —
POST /checkout-sessions, returning the locked totals every downstream
authorization (AP2 cart mandate, ACP token) is capped to.
"""
import uuid
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.payment.policy import FLAT_SHIPPING_COST, FREE_SHIPPING_THRESHOLD, TAX_RATE
from backend.ucp.models import UCPCheckoutSession, UCPItem, UCPLineItemResponse, UCPTotalEntry

router = APIRouter(prefix="/ucp", tags=["ucp"])


class CheckoutItem(BaseModel):
    product_id: str
    title: str
    unit_price: float
    quantity: int = 1
    image_url: Optional[str] = None


class CheckoutSessionRequest(BaseModel):
    # A cart is sent as `items` (one checkout, one set of totals). The single-product
    # fields are still accepted for callers that send one product.
    items: Optional[list[CheckoutItem]] = None
    product_id: Optional[str] = None
    title: Optional[str] = None
    unit_price: Optional[float] = None
    quantity: int = 1
    currency: str = "USD"
    image_url: Optional[str] = None


@router.post("/checkout-sessions", response_model=UCPCheckoutSession)
def create_checkout_session(req: CheckoutSessionRequest) -> UCPCheckoutSession:
    items = req.items or [CheckoutItem(product_id=req.product_id or "", title=req.title or "",
                                       unit_price=req.unit_price or 0.0, quantity=req.quantity,
                                       image_url=req.image_url)]

    line_items: list[UCPLineItemResponse] = []
    subtotal = 0.0
    for item in items:
        line_total = round(item.unit_price * item.quantity, 2)
        subtotal += line_total
        line_items.append(UCPLineItemResponse(
            id=f"li_{uuid.uuid4().hex[:8]}",
            item=UCPItem(id=item.product_id, title=item.title, price=item.unit_price, image_url=item.image_url),
            quantity=item.quantity,
            totals=[UCPTotalEntry(type="subtotal", display_text="Subtotal", amount=line_total)],
        ))
    subtotal = round(subtotal, 2)
    shipping = 0.0 if subtotal >= FREE_SHIPPING_THRESHOLD else FLAT_SHIPPING_COST
    tax = round(subtotal * TAX_RATE, 2)
    total = round(subtotal + shipping + tax, 2)

    totals = [
        UCPTotalEntry(type="subtotal", display_text="Subtotal", amount=subtotal),
        UCPTotalEntry(type="fulfillment", display_text="Shipping", amount=shipping),
        UCPTotalEntry(type="tax", display_text="Tax", amount=tax),
        UCPTotalEntry(type="total", display_text="Total", amount=total),
    ]
    return UCPCheckoutSession(
        id=f"ucp_{uuid.uuid4().hex[:12]}",
        status="ready_for_complete",
        currency=req.currency,
        line_items=line_items,
        totals=totals,
    )
