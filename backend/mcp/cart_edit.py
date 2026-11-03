"""
Changing the cart from Claude: remove one line, clear everything, or set a quantity.

  * remove_from_cart / clear_cart (app-only): the Remove and Clear cart buttons on the cart card.
  * update_cart (visible to Claude): for requests such as "keep only the first two items".
    A quantity of 0 removes the product.

Registered on the same card provider as backend/mcp/cards.py.
"""
import asyncio

from fastmcp.exceptions import ToolError

from backend.mcp.cards import cards
from backend.mcp.identity import current_user_id


@cards.tool()
async def remove_from_cart(cart_item_id: str) -> dict:
    """Remove one line from the customer's cart. App-only: called by the Remove button."""
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    user_id = current_user_id()

    def _remove() -> int:
        with get_session() as session:
            deleted = (session.query(CartItem)
                       .filter(CartItem.user_id == user_id, CartItem.cart_item_id == cart_item_id)
                       .delete(synchronize_session=False))
            session.commit()
            return deleted

    deleted = await asyncio.to_thread(_remove)
    if not deleted:
        raise ToolError("That item is no longer in the cart.")
    return {"removed": cart_item_id}


@cards.tool()
async def clear_cart() -> dict:
    """Remove every item from the customer's cart. App-only: called by the Clear cart button."""
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    user_id = current_user_id()

    def _clear() -> int:
        with get_session() as session:
            deleted = session.query(CartItem).filter(CartItem.user_id == user_id).delete(synchronize_session=False)
            session.commit()
            return deleted

    return {"removed_lines": await asyncio.to_thread(_clear)}


@cards.tool(model=True)
async def update_cart(product_id: str, quantity: int) -> dict:
    """
    Set the quantity of one product in the customer's TalkShop cart. Use quantity 0 to remove
    it. Use this when the customer asks to remove items, keep only some items, or change a
    quantity. Call show_cart_card afterwards so the customer can see the result.
    """
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    user_id = current_user_id()
    quantity = max(0, min(quantity, 10))

    def _update() -> int:
        with get_session() as session:
            rows = (session.query(CartItem)
                    .filter(CartItem.user_id == user_id, CartItem.product_id == product_id)
                    .all())
            if quantity == 0:
                for row in rows:
                    session.delete(row)
            elif rows:
                rows[0].quantity = quantity
                for extra in rows[1:]:
                    session.delete(extra)
            session.commit()
            return len(rows)

    found = await asyncio.to_thread(_update)
    if not found and quantity > 0:
        raise ToolError("That product is not in the cart. Add it first.")
    return {"product_id": product_id, "quantity": quantity}


@cards.tool()
async def remove_one_from_cart(product_id: str) -> dict:
    """Take one unit of a product out of the cart. App-only: called by the minus button."""
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    user_id = current_user_id()

    def _remove_one() -> int:
        with get_session() as session:
            row = (session.query(CartItem)
                   .filter(CartItem.user_id == user_id, CartItem.product_id == product_id)
                   .order_by(CartItem.id).first())
            if row is None:
                return -1
            if row.quantity > 1:
                row.quantity -= 1
            else:
                session.delete(row)
            session.commit()
            return 0

    if await asyncio.to_thread(_remove_one) < 0:
        raise ToolError("That product is not in the cart.")
    return {"product_id": product_id}
