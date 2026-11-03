"""
Account linking as a card in Claude: the store email, then the one-time code, then linked.

The typed values go straight from the card's inputs to the server (through the button's
tool call). They are not written into the chat.

  * link_store_card (visible to Claude): opens the linking card for one store.
  * start_link_code / finish_link (app-only): the card's Send code and Link account buttons.
"""
import asyncio

from fastmcp.exceptions import ToolError
from prefab_ui.actions import SetState, ShowToast
from prefab_ui.actions.mcp import CallTool
from prefab_ui.app import PrefabApp
from prefab_ui.components import H3, Button, Card, CardContent, CardFooter, CardHeader, Column, Input, Muted, Text
from prefab_ui.components.control_flow import If

from backend.mcp.cards import cards
from backend.mcp.identity import current_user_id
from backend.merchants import account_link
from backend.routers.merchant_link import MERCHANT_IDS


def _store(merchant_id: str) -> str:
    if merchant_id not in MERCHANT_IDS:
        raise ToolError(f"Unknown store. Choose one of: {', '.join(MERCHANT_IDS)}.")
    return account_link.merchant_name(merchant_id)


@cards.tool()
async def start_link_code(merchant_id: str, email: str) -> dict:
    """Send the one-time code to the store email. App-only: called by the Send code button."""
    store = _store(merchant_id)
    current_user_id()
    ok, message = await asyncio.to_thread(account_link.start, merchant_id, email)
    if not ok:
        raise ToolError(f"{store}: {message}")
    return {"sent": True}


@cards.tool()
async def finish_link(merchant_id: str, email: str, code: str) -> dict:
    """Check the code and link the account. App-only: called by the Link account button."""
    store = _store(merchant_id)
    user_id = current_user_id()
    result = await asyncio.to_thread(account_link.approve, user_id, merchant_id, email, code)
    if not result.get("ok"):
        raise ToolError(f"{store}: {result.get('message', 'The code did not match.')}")
    return {"linked": True}


@cards.ui()
async def link_store_card(merchant_id: str) -> PrefabApp:
    """
    Open the card that links the customer's TalkShop account to a store: the store email,
    then the one-time code. Use this whenever a store must be linked before checkout, or when
    the customer asks to link an account. The customer types into the card, not the chat.
    """
    user_id = current_user_id()
    store = _store(merchant_id)

    def _status() -> tuple[bool, dict | None]:
        status = account_link.status(user_id, merchant_id)
        points = account_link.points_status(user_id, merchant_id) if status["linked"] else None
        return status["linked"], points

    linked, points = await asyncio.to_thread(_status)

    sent = _sent_flag(merchant_id)

    with Card(css_class="max-w-md mx-auto") as view:
        with CardHeader():
            H3(f"Link your {store} account")
        with CardContent(), Column(gap=3):
            if linked:
                Text(f"Your {store} account is linked.", css_class="font-medium")
                if points:
                    Text(f"Points: {points['available']} available, {points['pending']} pending")
                Muted("Your saved card and points for this store can be used at checkout.")
            else:
                Muted(f"Enter the email you use with {store}. We'll send a one-time code.")
                email = Input(name=f"link_email_{merchant_id}", input_type="email", placeholder="you@example.com")
                code = Input(name=f"link_code_{merchant_id}", placeholder="6-digit code")
                with If(sent):
                    Muted("Enter the 6-digit code we sent.")
        with CardFooter():
            if linked:
                Muted("Linked")
            else:
                with If(~sent):
                    Button("Send code", on_click=CallTool(
                        "start_link_code", arguments={"merchant_id": merchant_id, "email": email.rx},
                        on_success=SetState(f"sent_{merchant_id}", True),
                        on_error=ShowToast(message="Could not send the code. Check the email for this store.",
                                           variant="error"),
                    ))
                with If(sent):
                    Button("Link account", variant="success", on_click=CallTool(
                        "finish_link", arguments={"merchant_id": merchant_id, "email": email.rx, "code": code.rx},
                        on_success=SetState(f"linked_{merchant_id}", True),
                        on_error=ShowToast(message="That code did not match. Try again.", variant="error"),
                    ))
    return PrefabApp(view=view, state={f"sent_{merchant_id}": False})


def _sent_flag(merchant_id: str):
    from prefab_ui.rx import STATE
    return getattr(STATE, f"sent_{merchant_id}")
