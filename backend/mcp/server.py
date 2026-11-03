"""
FastMCP Commerce Server — exposes 7 tools to agents.
Agents call these tools; tools return NormalizedProduct lists.
Raw merchant JSON never reaches the LLM — only normalized schemas pass through.
"""
import asyncio
import json
import os
from typing import Optional

from fastmcp import FastMCP
from fastmcp.utilities.types import Image

from backend.models.product import NormalizedProduct
from backend.models.checkout import CheckoutObject
from backend.merchants import catalog as merchant_catalog

mcp = FastMCP(
    "commerce-server",
    instructions=(
        "TalkShop is a shopping service that only sells its own catalog. If a search finds no "
        "matching TalkShop product, say so plainly, then search the web yourself with your own "
        "web search if you have it, and show what you find as web results. Never present web "
        "results as TalkShop products, and never offer to buy them through TalkShop. "
        "Whenever the customer wants to find, show, browse "
        "or look at any products, use the card tool (search_cards) and never list products "
        "as plain text. To compare products, use compare_cards with the product IDs. Use text tools only for a direct factual question "
        "such as a single price or stock level. To buy, call open_merchant_session and then "
        "propose_purchase, then show_purchase_card. Never claim a purchase is made until the "
        "customer presses Approve on the card. After a purchase, use show_order_card for the "
        "summary and tracking. Before checkout, call my_merchant_links. If a store is not "
        "linked, call link_store_card for that store. The customer types the email and code "
        "into the card, so never ask for them in the chat. A store's saved card and points only "
        "apply after it is linked. Ask the customer only for things the cards can't collect, "
        "such as which product or quantity they want. When the customer picks a model from a "
        "store, call product_options for it, then ask in the chat which size and colour they want, "
        "naming any out-of-stock sizes, and only then call add_to_cart with that product ID. "
        "Once the store is linked, before you show "
        "the purchase card, ask the customer in the chat, one question at a time: first whether "
        "to use store points, and if so how many (never more than the available points from "
        "my_merchant_links); then which saved card to pay with, listing the cards from "
        "my_payment_methods. Then call apply_points if they chose points, and call "
        "show_purchase_card with the checkout ID and the chosen payment_method_id."
    ),
)


@mcp.tool()
async def search_products(
    query: str,
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    size: Optional[str] = None,
) -> list[dict]:
    """
    Searches the six demo merchant catalogs via their merchant agents, for text answers
    about products (names, prices, stock). To show products to the customer, use
    search_cards instead.
    Returns normalized product list — financial fields come from the catalog, not LLM.
    """
    products = await asyncio.to_thread(
        merchant_catalog.search,
        query=query,
        category=category,
        brand=brand,
        max_price=max_price,
        size=size,
    )
    return [p.model_dump() for p in products]


@mcp.tool()
async def get_product(product_id: str) -> Optional[dict]:
    """Fetch a single product by ID. Checks local DB first."""
    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
    if product:
        return product.model_dump()
    return None


@mcp.tool()
async def check_inventory(product_id: str, size: Optional[str] = None) -> dict:
    """Return stock level and delivery estimate for a product."""
    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
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
    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
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
    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
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
) -> dict:
    """
    Build a CheckoutObject for the selected product.
    Checkout hash binds the DPAT token to this exact cart in Phase 3.
    """
    import hashlib, json, uuid

    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
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


@mcp.tool()
async def get_me() -> dict:
    """Return the TalkShop account the connector is signed in as."""
    from backend.db.schema import User
    from backend.db.session_utils import get_session
    from backend.mcp.identity import current_user_id

    user_id = current_user_id()

    def _query() -> dict:
        with get_session() as session:
            user = session.query(User).filter(User.user_id == user_id).first()
            if not user:
                return {"error": "account_not_found"}
            # First name only: no email or internal ID goes to the chat.
            return {"name": (user.name or "").split(" ")[0]}

    return await asyncio.to_thread(_query)


def _is_guest(user_id: str) -> bool:
    from backend.db.schema import User
    from backend.db.session_utils import get_session

    with get_session() as session:
        user = session.query(User).filter(User.user_id == user_id).first()
        return bool(user and user.is_guest)


@mcp.tool()
async def open_merchant_session(merchant_id: str) -> dict:
    """
    Open a trusted session with one merchant for the signed-in customer. Needed
    before propose_purchase. Opening a session does not buy anything.
    """
    from fastmcp.exceptions import ToolError
    from backend.mcp.identity import current_user_id
    from backend.trust import credentials, sessions
    from backend.trust.models import SCOPE_CATALOG

    user_id = current_user_id()

    def _open() -> dict:
        credential = credentials.issue_customer_agent_credential(user_id, is_talkshop_guest=_is_guest(user_id))
        decision, trusted = sessions.establish(credential, merchant_id, "mcp", SCOPE_CATALOG)
        if not decision.verified or trusted is None:
            raise ToolError(f"Could not open a session with {merchant_id}: {decision.reason}")
        return {"trusted_session_id": trusted.session_id, "merchant_id": merchant_id}

    return await asyncio.to_thread(_open)


@mcp.tool()
async def propose_purchase(
    product_id: str,
    quantity: int = 1,
    payment_method_id: Optional[str] = None,
    trusted_session_id: Optional[str] = None,
) -> dict:
    """
    Build a purchase proposal for the signed-in customer. Nothing is charged here.
    The customer must approve it with GO AHEAD on TalkShop; this tool cannot do that.
    """
    from fastmcp.exceptions import ToolError
    from backend.mcp.identity import current_user_id
    from backend.purchase import service

    user_id = current_user_id()
    result = await service.create_proposal(
        user_id=user_id,
        is_talkshop_guest=await asyncio.to_thread(_is_guest, user_id),
        product_id=product_id,
        quantity=quantity,
        trusted_session_id=trusted_session_id,
        payment_method_id=payment_method_id,
    )
    if result["status"] != "proposed":
        raise ToolError(f"{result['reason']}: {result['message']}")

    proposal = result["proposal"]
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    return {
        "status": "proposed",
        "approval_url": f"{frontend_url}/approve/{proposal['checkout_id']}",
        "not_paid": "No payment has been made. Show the purchase card with show_purchase_card, or open approval_url in TalkShop, and press Approve to pay.",
        "checkout_id": proposal["checkout_id"],
        "summary": {
            "merchant_name": proposal.get("merchant_name"),
            "product_title": proposal.get("product_title"),
            "quantity": proposal.get("quantity"),
            "subtotal": proposal.get("subtotal"),
            "shipping": proposal.get("shipping"),
            "tax": proposal.get("tax"),
            "total": proposal.get("total"),
            "currency": proposal.get("currency"),
            "payment_method": (proposal.get("payment_method") or {}).get("display"),
        },
    }


@mcp.tool()
async def show_product_image(product_id: str) -> dict | Image:
    """Return the product's photo so the chat can display it."""
    from io import BytesIO

    from PIL import Image as PILImage
    from backend.merchants.catalog import _PUBLIC_DIR

    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
    if product is None:
        return {"error": "product_not_found"}
    if not product.image_url:
        return {"error": "no_image", "product_id": product_id}

    def _png() -> bytes:
        buf = BytesIO()
        with PILImage.open(_PUBLIC_DIR / product.image_url.lstrip("/")) as photo:
            photo = photo.convert("RGB")
            photo.thumbnail((512, 512))
            photo.save(buf, format="PNG")
        return buf.getvalue()

    return Image(data=await asyncio.to_thread(_png), format="png")


@mcp.tool()
async def get_checkout_status(checkout_id: str) -> dict:
    """
    Status of one checkout the signed-in customer made: proposed (waiting for GO AHEAD
    on TalkShop), approved or paid, or another state. Use after the customer approves.
    """
    from fastmcp.exceptions import ToolError
    from backend.db.schema import MerchantCheckout
    from backend.db.session_utils import get_session
    from backend.mcp.identity import current_user_id

    user_id = current_user_id()

    def _query() -> dict:
        with get_session() as session:
            row = (session.query(MerchantCheckout)
                   .filter(MerchantCheckout.checkout_id == checkout_id,
                           MerchantCheckout.user_id == user_id)
                   .first())
            if row is None:
                raise ToolError("No checkout with that ID on this TalkShop account.")
            checkout = json.loads(row.document)
            return {
                "checkout_id": row.checkout_id,
                "status": row.status,
                "merchant_name": checkout.get("merchant_name"),
                "product_title": checkout.get("product_title"),
                "quantity": checkout.get("quantity"),
                "total": checkout.get("total"),
                "currency": checkout.get("currency"),
            }

    return await asyncio.to_thread(_query)


@mcp.tool()
async def list_my_orders(limit: int = 5) -> list[dict]:
    """The signed-in customer's most recent orders, newest first."""
    from backend.db.schema import Order
    from backend.db.session_utils import get_session
    from backend.mcp.identity import current_user_id

    user_id = current_user_id()
    limit = max(1, min(limit, 20))

    def _query() -> list[dict]:
        with get_session() as session:
            rows = (session.query(Order)
                    .filter(Order.user_id == user_id)
                    .order_by(Order.created_at.desc())
                    .limit(limit)
                    .all())
            return [{
                "order_id": o.order_id,
                "merchant_id": o.merchant_id,
                "product_id": o.product_id,
                "amount": o.amount,
                "currency": o.currency,
                "status": o.status,
                "tracking_number": o.tracking_number,
            } for o in rows]

    return await asyncio.to_thread(_query)


# Purchase card (MCP Apps). Its confirm_purchase tool is app-only, so Claude can't call it.
from backend.mcp.cards import cards as purchase_cards  # noqa: E402

from backend.mcp import cart_cards  # noqa: E402,F401  registers the cart, checkout start and orders tools
from backend.mcp import cart_edit  # noqa: E402,F401  registers remove, clear and update cart tools
from backend.mcp import link_tools  # noqa: E402,F401  registers merchant linking and points tools
from backend.mcp import link_cards  # noqa: E402,F401  registers the linking card and its buttons
from backend.mcp import checkout_options  # noqa: E402,F401  registers payment-card and points choices
from backend.mcp import product_options  # noqa: E402,F401  registers size and colour choices

mcp.add_provider(purchase_cards)
