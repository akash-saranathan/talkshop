"""
FastMCP Commerce Server — exposes 7 tools to agents.
Agents call these tools; tools return NormalizedProduct lists.
Raw merchant JSON never reaches the LLM — only normalized schemas pass through.
"""
import asyncio
from typing import Optional

from fastmcp import FastMCP

from backend.models.product import NormalizedProduct
from backend.models.checkout import CheckoutObject
from backend.merchants import local as local_adapter
from backend.merchants import shopify as shopify_adapter
from backend.merchants import bestbuy as bestbuy_adapter

mcp = FastMCP("commerce-server")


@mcp.tool()
async def search_products(
    query: str,
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    size: Optional[str] = None,
) -> list[dict]:
    """
    Fan-out search across all merchant adapters in parallel.
    Returns normalized product list — financial fields come from DB, not LLM.
    """
    local_task = asyncio.to_thread(
        local_adapter.search_products,
        category=category,
        brand=brand,
        max_price=max_price,
        size=size,
    )
    shopify_task = shopify_adapter.search_products(
        category=category, brand=brand, max_price=max_price, size=size
    )
    bestbuy_task = bestbuy_adapter.search_products(
        category=category, brand=brand, max_price=max_price, query=query
    )

    local_results, shopify_results, bestbuy_results = await asyncio.gather(
        local_task, shopify_task, bestbuy_task, return_exceptions=True
    )

    combined: list[NormalizedProduct] = []
    for batch in (local_results, shopify_results, bestbuy_results):
        if isinstance(batch, list):
            combined.extend(batch)

    # Always fall back to local if external adapters returned nothing useful
    if not combined:
        combined = await asyncio.to_thread(local_adapter.search_products, category=category)

    return [p.model_dump() for p in combined]


@mcp.tool()
async def get_product(product_id: str) -> Optional[dict]:
    """Fetch a single product by ID. Checks local DB first."""
    product = await asyncio.to_thread(local_adapter.get_product, product_id)
    if product:
        return product.model_dump()
    return None


@mcp.tool()
async def check_inventory(product_id: str, size: Optional[str] = None) -> dict:
    """Return stock level and delivery estimate for a product."""
    product = await asyncio.to_thread(local_adapter.get_product, product_id)
    if not product:
        return {"available": False, "inventory": 0, "delivery_days": None, "error": "product_not_found"}
    return {
        "product_id": product_id,
        "available": product.available,
        "inventory": product.inventory,
        "delivery_days": product.delivery_days,
    }


@mcp.tool()
async def get_price(product_id: str, size: Optional[str] = None) -> dict:
    """Return current price for a product variant."""
    product = await asyncio.to_thread(local_adapter.get_product, product_id)
    if not product:
        return {"error": "product_not_found"}
    return {
        "product_id": product_id,
        "price": product.price,
        "currency": product.currency,
        "size": product.size,
    }


@mcp.tool()
async def calculate_shipping(
    product_id: str,
    merchant_id: str,
    quantity: int = 1,
) -> dict:
    """Calculate shipping cost for a cart item."""
    product = await asyncio.to_thread(local_adapter.get_product, product_id)
    if not product:
        return {"error": "product_not_found"}
    # Free shipping on orders over $50, else $5.99 flat
    shipping = 0.0 if (product.price * quantity) >= 50 else 5.99
    return {
        "product_id": product_id,
        "quantity": quantity,
        "shipping_cost": shipping,
        "currency": "USD",
        "estimated_days": product.delivery_days,
    }


@mcp.tool()
async def create_checkout(
    product_id: str,
    merchant_id: str,
    quantity: int = 1,
    user_id: str = "USR001",
) -> dict:
    """
    Build a CheckoutObject for the selected product.
    Checkout hash binds the DPAT token to this exact cart in Phase 3.
    """
    import hashlib, json, uuid

    product = await asyncio.to_thread(local_adapter.get_product, product_id)
    if not product:
        return {"error": "product_not_found"}

    subtotal = round(product.price * quantity, 2)
    tax = round(subtotal * 0.082, 2)
    shipping = 0.0 if subtotal >= 50 else 5.99
    total = round(subtotal + tax + shipping, 2)

    checkout_data = {
        "product_id": product_id,
        "merchant_id": merchant_id,
        "quantity": quantity,
        "subtotal": subtotal,
        "tax": tax,
        "shipping": shipping,
        "total": total,
        "currency": "USD",
    }
    checkout_hash = hashlib.sha256(
        json.dumps(checkout_data, sort_keys=True).encode()
    ).hexdigest()

    checkout = CheckoutObject(
        checkout_id=f"CHK_{uuid.uuid4().hex[:8].upper()}",
        merchant_id=merchant_id,
        product_id=product_id,
        product_title=product.title,
        merchant_name=product.merchant_name,
        quantity=quantity,
        subtotal=subtotal,
        tax=tax,
        shipping=shipping,
        total=total,
        currency="USD",
        checkout_hash=checkout_hash,
    )
    return checkout.model_dump()


@mcp.tool()
async def get_order_status(order_id: str) -> dict:
    """Return current status of an order from the DB."""
    def _query() -> dict:
        from backend.db.schema import Order
        from backend.db.session_utils import get_session

        with get_session() as session:
            order = session.query(Order).filter(Order.order_id == order_id).first()
            if not order:
                return {"order_id": order_id, "status": "not_found"}
            return {
                "order_id": order.order_id,
                "status": order.status,
                "amount": order.amount,
                "currency": order.currency,
                "merchant_id": order.merchant_id,
                "transaction_id": order.transaction_id,
            }

    return await asyncio.to_thread(_query)
