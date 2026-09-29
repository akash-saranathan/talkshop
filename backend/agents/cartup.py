"""
CartUp — Merchant/Seller Agent (Agent 3).
Triggered after the user selects a product.
Calls MCP tools to verify inventory, get current price, calculate shipping,
and produce a CheckoutObject. LLM is NOT used here — all values come from
merchant tool responses, never from LLM reasoning.
"""
import hashlib
import json
import uuid
from typing import Optional

from backend.models.checkout import CheckoutObject
from backend.models.product import NormalizedProduct
from backend.payment.policy import TAX_RATE, FREE_SHIPPING_THRESHOLD, FLAT_SHIPPING_COST


async def build_checkout(
    product: NormalizedProduct,
    quantity: int = 1,
    user_id: str = "USR001",
) -> tuple[Optional[CheckoutObject], Optional[str]]:
    """
    Build a CheckoutObject for the selected product.
    Returns (checkout, error). All financial values sourced from DB — no LLM.
    """
    from backend.mcp.server import check_inventory, get_price, calculate_shipping

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
    subtotal = round(unit_price * quantity, 2)
    tax = round(subtotal * TAX_RATE, 2)
    shipping = 0.0 if subtotal >= FREE_SHIPPING_THRESHOLD else FLAT_SHIPPING_COST
    total = round(subtotal + tax + shipping, 2)

    # Compute checkout hash — binds DPAT token to this exact cart
    canonical = {
        "product_id": product.product_id,
        "merchant_id": product.merchant_id,
        "quantity": quantity,
        "unit_price": unit_price,
        "subtotal": subtotal,
        "tax": tax,
        "shipping": shipping,
        "total": total,
        "currency": "USD",
    }
    checkout_hash = hashlib.sha256(
        json.dumps(canonical, sort_keys=True).encode()
    ).hexdigest()

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
        currency="USD",
        checkout_hash=checkout_hash,
    )
    return checkout, None
