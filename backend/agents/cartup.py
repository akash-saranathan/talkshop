"""
CartUp — Merchant/Seller Agent (Agent 3).
Triggered after the user selects a product.
Calls MCP tools to verify inventory and get current price, then locks the
cart's totals via a real HTTP call to the UCP checkout-session endpoint
(backend/routers/ucp.py) instead of computing them in-process — the UCP
spec's canonical "lock the total" step. LLM is NOT used here — all values
come from merchant tool responses / the UCP endpoint, never from LLM reasoning.
"""
import hashlib
import json
import uuid
from datetime import date, timedelta
from typing import Optional

import httpx

from backend.models.checkout import CheckoutObject
from backend.models.product import NormalizedProduct

UCP_CHECKOUT_SESSIONS_URL = "http://localhost:8000/ucp/checkout-sessions"


async def _lock_totals_via_ucp(product: NormalizedProduct, unit_price: float, quantity: int) -> Optional[dict]:
    """Real HTTP POST to the UCP checkout-session endpoint. Returns the
    {type: amount} totals map, or None if the merchant's checkout service
    didn't respond (connection error, timeout, bad response)."""
    payload = {"product_id": product.product_id, "title": product.title, "unit_price": unit_price,
              "quantity": quantity, "currency": "USD", "image_url": product.image_url}
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(UCP_CHECKOUT_SESSIONS_URL, json=payload)
        resp.raise_for_status()
        session = resp.json()
        return {t["type"]: t["amount"] for t in session["totals"]}
    except (httpx.HTTPError, KeyError, TypeError):
        return None


async def build_checkout(
    product: NormalizedProduct,
    quantity: int = 1,
    user_id: str = "USR001",
) -> tuple[Optional[CheckoutObject], Optional[str]]:
    """
    Build a CheckoutObject for the selected product.
    Returns (checkout, error). All financial values sourced from DB — no LLM.
    """
    from backend.mcp.client import check_inventory, get_price

    # Verify inventory
    inv = await check_inventory(product.product_id, product.size)
    if inv.get("error"):
        return None, f"inventory_check_failed: {inv['error']}"
    if not inv.get("available", False):
        return None, "PRODUCT_OUT_OF_STOCK"

    # Get authoritative price
    price_data = await get_price(product.product_id, product.size)
    if price_data.get("error"):
        return None, f"price_check_failed: {price_data['error']}"

    unit_price = float(price_data["price"])

    # Lock totals — real UCP checkout-session call, not an in-process calc.
    totals = await _lock_totals_via_ucp(product, unit_price, quantity)
    if totals is None:
        return None, "ucp_checkout_session_failed"
    subtotal, shipping, tax, total = totals["subtotal"], totals["fulfillment"], totals["tax"], totals["total"]

    # The merchant's delivery promise is part of what the customer agrees to.
    delivery_days = inv.get("delivery_days") or product.delivery_days or 5
    delivery_date = (date.today() + timedelta(days=delivery_days)).isoformat()

    # Compute checkout hash — binds DPAT token to this exact cart
    checkout = CheckoutObject(
        checkout_id=f"CHK_{uuid.uuid4().hex[:8].upper()}",
        merchant_id=product.merchant_id,
        merchant_name=product.merchant_name,
        product_id=product.product_id,
        product_title=product.title,
        quantity=quantity,
        size=product.size,
        color=product.color,
        subtotal=subtotal,
        shipping=shipping,
        tax=tax,
        total=total,
        amount_due=total,
        currency="USD",
        delivery_date=delivery_date,
        checkout_hash="",  # set below
    )
    checkout.checkout_hash = checkout_hash_for(checkout, unit_price)
    return checkout, None


def checkout_hash_for(checkout: CheckoutObject, unit_price: float) -> str:
    """Hash the checkout. Binds the cart AND the loyalty redemption / amount due,
    so tampering with either invalidates it. Recomputed after any merchant change."""
    canonical = {
        "product_id": checkout.product_id,
        "merchant_id": checkout.merchant_id,
        "quantity": checkout.quantity,
        "unit_price": unit_price,
        "subtotal": checkout.subtotal,
        "tax": checkout.tax,
        "shipping": checkout.shipping,
        "total": checkout.total,
        "loyalty_points_redeemed": checkout.loyalty_points_redeemed,
        "loyalty_value": checkout.loyalty_value,
        "amount_due": checkout.payable,
        "currency": checkout.currency,
        "delivery_date": checkout.delivery_date,
    }
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
