"""
Sizes and colours of one shoe model, so Claude can ask the customer which one they want.

  * product_options (visible to Claude): every size and colour of one model at one store,
    with its product ID, price and stock. Claude asks the customer for the size and colour,
    then adds the matching product ID to the cart with add_to_cart.

Registered on the same card provider as backend/mcp/cards.py.
"""
import asyncio

from fastmcp.exceptions import ToolError

from backend.mcp.cards import cards
from backend.mcp.identity import current_user_id
from backend.merchants import catalog as merchant_catalog


@cards.tool(model=True)
async def product_options(store_id: str, product_title: str) -> list[dict]:
    """
    Every size and colour of one shoe model at one store, with its product ID, price and stock.
    Use this after the customer picks a brand and model. Ask the customer which size and colour
    they want (and say which sizes are out of stock), then add that product ID with add_to_cart.
    """
    current_user_id()  # the customer must be signed in

    def _load() -> list[dict]:
        wanted = product_title.strip().lower()
        rows = []
        for p in merchant_catalog.search(query=product_title, category=None, brand=None, max_price=None, size=None):
            if p.merchant_id == store_id and p.title.lower() == wanted:
                rows.append({
                    "product_id": p.product_id,
                    "size": p.size,
                    "color": p.color,
                    "price": p.price,
                    "currency": p.currency,
                    "in_stock": bool(p.available and (p.inventory or 0) > 0),
                })
        return sorted(rows, key=lambda r: (str(r["color"]), str(r["size"])))

    rows = await asyncio.to_thread(_load)
    if not rows:
        raise ToolError("No product with that name at that store. Search again.")
    return rows
