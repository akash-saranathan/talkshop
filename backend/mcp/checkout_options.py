"""
Choices Claude can offer the customer before paying, asked in the chat:

  * my_payment_methods: the saved cards the customer can pay with, for one store.
  * apply_points: use some of the store points on a waiting checkout. Claude asks how many.

After applying points or choosing a card, Claude calls show_purchase_card again with the
checkout ID (and the chosen card) so the customer sees the updated total before approving.

Registered on the same card provider as backend/mcp/cards.py.
"""
import asyncio

from fastmcp.exceptions import ToolError

from backend.mcp.cards import cards
from backend.mcp.identity import current_user_id


@cards.tool(model=True)
async def my_payment_methods(merchant_id: str) -> list[dict]:
    """
    The saved cards the customer can pay with at this store. Show the choices in your reply
    and ask which one to use. Pass the chosen payment_method_id to show_purchase_card.
    """
    from backend.payment import methods

    user_id = current_user_id()
    found = await asyncio.to_thread(methods.list_methods, user_id, merchant_id)
    return [{"payment_method_id": m["payment_method_id"], "card": m["display"],
             "default": m["is_default"]} for m in found]


@cards.tool(model=True)
async def apply_points(checkout_id: str, points: int) -> dict:
    """
    Use some of the customer's points from this store on a waiting checkout. Ask the customer
    how many points to use before calling this, and check the points with my_merchant_links.
    """
    from backend.db.schema import MerchantCheckout, User
    from backend.db.session_utils import get_session
    from backend.purchase import service

    user_id = current_user_id()

    def _load() -> dict | None:
        with get_session() as session:
            row = (session.query(MerchantCheckout)
                   .filter(MerchantCheckout.checkout_id == checkout_id,
                           MerchantCheckout.user_id == user_id)
                   .first())
            if row is None:
                return None
            user = session.query(User).filter(User.user_id == user_id).first()
            return {"checkout_hash": row.checkout_hash, "status": row.status,
                    "is_guest": bool(user and user.is_guest)}

    details = await asyncio.to_thread(_load)
    if details is None:
        raise ToolError("No checkout with that ID on this TalkShop account.")
    if details["status"] != "proposed":
        raise ToolError("This checkout can no longer be changed.")

    result = await service.apply_loyalty(
        user_id=user_id, is_talkshop_guest=details["is_guest"], checkout_id=checkout_id,
        checkout_hash=details["checkout_hash"], points_to_redeem=max(0, points),
    )
    if result.get("status") == "rejected":
        raise ToolError(f"{result.get('reason')}: {result.get('message')}")
    return {"checkout_id": checkout_id, "points_applied": points,
            "next": "Call show_purchase_card with this checkout_id to show the new total."}
