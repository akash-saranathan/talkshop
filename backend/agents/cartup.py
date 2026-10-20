"""
CartUp — Merchant/Seller Agent (Agent 3).
Triggered after the user selects one or more products from the same merchant.
Calls MCP tools to verify inventory and get current price for each item, then
locks the cart's totals via a real HTTP call to the UCP checkout-session endpoint
(backend/routers/ucp.py) instead of computing them in-process — the UCP spec's
canonical "lock the total" step. LLM is NOT used here — all values come from
merchant tool responses / the UCP endpoint, never from LLM reasoning.

One checkout per merchant: a cart with several items from the same merchant
becomes one CheckoutObject with one CheckoutLine per item.
"""
import hashlib
import json
import uuid
from datetime import date, timedelta
from typing import Optional

import httpx

from backend.models.checkout import CheckoutLine, CheckoutObject
from backend.models.product import NormalizedProduct

UCP_CHECKOUT_SESSIONS_URL = "http://localhost:8000/ucp/checkout-sessions"


async def _lock_totals_via_ucp(lines: list[dict], merchant_id: str, member_token: Optional[str]) -> Optional[dict]:
    """Real HTTP POST to the UCP checkout-session endpoint. Returns the
    {type: amount} totals map, or None if the merchant's checkout service
    didn't respond (connection error, timeout, bad response). The member token,
    when the customer is linked, goes with the request; the merchant checks it."""
    payload = {"items": lines, "currency": "USD", "merchant_id": merchant_id, "member_token": member_token}
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(UCP_CHECKOUT_SESSIONS_URL, json=payload)
        resp.raise_for_status()
        session = resp.json()
        return {t["type"]: t["amount"] for t in session["totals"]}
    except (httpx.HTTPError, KeyError, TypeError):
        return None


async def build_cart_checkout(
    items: list[tuple[NormalizedProduct, int]],
    user_id: str = "USR001",
) -> tuple[Optional[CheckoutObject], Optional[str]]:
    """
    Build one CheckoutObject for a cart of (product, quantity) items from one merchant.
    Returns (checkout, error). All financial values sourced from the merchant — no LLM.
    """
    from backend.mcp.client import check_inventory, get_price

    if not items:
        return None, "EMPTY_CART"
    merchant_ids = {product.merchant_id for product, _ in items}
    if len(merchant_ids) != 1:
        return None, "MIXED_MERCHANTS"

    lines: list[CheckoutLine] = []
    delivery_days_per_line: list[int] = []
    for product, quantity in items:
        # Verify inventory for this item
        inv = await check_inventory(product.product_id, product.size)
        if inv.get("error"):
            return None, f"inventory_check_failed: {inv['error']}"
        if not inv.get("available", False):
            return None, "PRODUCT_OUT_OF_STOCK"

        # Get authoritative price for this item
        price_data = await get_price(product.product_id, product.size)
        if price_data.get("error"):
            return None, f"price_check_failed: {price_data['error']}"

        unit_price = float(price_data["price"])
        lines.append(CheckoutLine(
            product_id=product.product_id,
            product_title=product.title,
            size=product.size,
            color=product.color,
            quantity=quantity,
            unit_price=unit_price,
            line_total=round(unit_price * quantity, 2),
            image_url=product.image_url,
        ))
        delivery_days_per_line.append(inv.get("delivery_days") or product.delivery_days or 5)

    # Lock totals — real UCP checkout-session call, not an in-process calc.
    from backend.merchants import account_link
    merchant_id = next(iter(merchant_ids))
    totals = await _lock_totals_via_ucp([
        {"product_id": line.product_id, "title": line.product_title, "unit_price": line.unit_price,
         "quantity": line.quantity, "image_url": line.image_url}
        for line in lines
    ], merchant_id, account_link.member_token(user_id, merchant_id))
    if totals is None:
        return None, "ucp_checkout_session_failed"
    subtotal, shipping, tax, total = totals["subtotal"], totals["fulfillment"], totals["tax"], totals["total"]

    # The merchant's delivery promise is part of what the customer agrees to:
    # the cart is ready when its slowest item is ready.
    delivery_days = max(delivery_days_per_line)
    delivery_date = (date.today() + timedelta(days=delivery_days)).isoformat()

    first = lines[0]
    total_units = sum(line.quantity for line in lines)
    title = first.product_title if len(lines) == 1 else f"{first.product_title} + {len(lines) - 1} more"
    checkout = CheckoutObject(
        checkout_id=f"CHK_{uuid.uuid4().hex[:8].upper()}",
        merchant_id=items[0][0].merchant_id,
        merchant_name=items[0][0].merchant_name,
        product_id=first.product_id,
        product_title=title,
        quantity=total_units,
        size=first.size,
        color=first.color,
        lines=lines,
        subtotal=subtotal,
        shipping=shipping,
        tax=tax,
        total=total,
        amount_due=total,
        currency="USD",
        delivery_date=delivery_date,
        checkout_hash="",  # set below
    )
    checkout.checkout_hash = checkout_hash_for(checkout)
    return checkout, None


async def build_checkout(
    product: NormalizedProduct,
    quantity: int = 1,
    user_id: str = "USR001",
) -> tuple[Optional[CheckoutObject], Optional[str]]:
    """Single-product checkout: the same as a one-item cart."""
    return await build_cart_checkout([(product, quantity)], user_id)


def checkout_hash_for(checkout: CheckoutObject) -> str:
    """Hash the checkout. Binds every line, the totals, the loyalty redemption and the
    amount due, so tampering with any of them invalidates it. Recomputed after any change."""
    canonical = {
        "merchant_id": checkout.merchant_id,
        "lines": [
            {"product_id": line.product_id, "quantity": line.quantity,
             "unit_price": line.unit_price, "line_total": line.line_total,
             "size": line.size, "color": line.color}
            for line in checkout.lines
        ] or [{"product_id": checkout.product_id, "quantity": checkout.quantity}],
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
