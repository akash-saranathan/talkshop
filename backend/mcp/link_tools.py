"""
Merchant account linking and points, for Claude.

Linking connects the customer's TalkShop account to a store account (for example Nike), so
store points and the store's saved card can be used. It takes two steps the customer
completes in the chat: the email on the store account, then the one-time code.

  * my_merchant_links: which stores are linked, and the points at each.
  * start_merchant_link: sends the one-time code to the store email.
  * confirm_merchant_link: checks the code and links the account. Saved for next time.

Registered on the same card provider as backend/mcp/cards.py.
"""
import asyncio

from fastmcp.exceptions import ToolError

from backend.mcp.cards import cards
from backend.mcp.identity import current_user_id
from backend.merchants import account_link
from backend.routers.merchant_link import MERCHANT_IDS


def _check_store(merchant_id: str) -> str:
    if merchant_id not in MERCHANT_IDS:
        raise ToolError(f"Unknown store. Choose one of: {', '.join(MERCHANT_IDS)}.")
    return account_link.merchant_name(merchant_id)


@cards.tool(model=True)
async def my_merchant_links() -> list[dict]:
    """
    For each TalkShop store, whether the customer's account is linked to it, and how many
    points they have there. Use this before checkout to see whether a store's points or saved
    card can be used. Ask the customer to link a store that isn't linked yet.
    """
    user_id = current_user_id()

    def _load() -> list[dict]:
        out = []
        for merchant_id in MERCHANT_IDS:
            status = account_link.status(user_id, merchant_id)
            entry = {"store": account_link.merchant_name(merchant_id), "store_id": merchant_id,
                     "linked": status["linked"]}
            if status["linked"]:
                points = account_link.points_status(user_id, merchant_id)
                if points:
                    entry["points_available"] = points["available"]
                    entry["points_pending"] = points["pending"]
            out.append(entry)
        return out

    return await asyncio.to_thread(_load)


@cards.tool()
async def start_merchant_link(merchant_id: str, email: str) -> dict:
    """
    Start linking the customer's account to a store. Asks the store to send a one-time code to
    the email the customer uses with that store. Then ask the customer for the code and call
    confirm_merchant_link. Ask for the store's email first if you don't have it.
    """
    store = _check_store(merchant_id)
    user_id = current_user_id()  # the customer must be signed in
    ok, message = await asyncio.to_thread(account_link.start, merchant_id, email)
    if not ok:
        raise ToolError(f"{store}: {message}")
    return {"store": store, "message": message, "next": "Ask the customer for the 6-digit code."}


@cards.tool()
async def confirm_merchant_link(merchant_id: str, email: str, code: str) -> dict:
    """
    Check the one-time code and link the customer's account to the store. The link is saved to
    their TalkShop account, so they don't need to link again. Only call this with the code the
    customer typed.
    """
    store = _check_store(merchant_id)
    user_id = current_user_id()
    result = await asyncio.to_thread(account_link.approve, user_id, merchant_id, email, code)
    if not result.get("ok"):
        raise ToolError(f"{store}: {result.get('message', 'The code did not match.')}")
    return {"store": store, "linked": True, "message": f"Linked your {store} account."}
