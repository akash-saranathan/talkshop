"""
Cart, checkout start, and orders for the Claude purchase flow.

  * add_to_cart (app-only): the Add to cart button on a product card.
  * show_cart_card: the customer's cart, with a Proceed button.
  * start_checkout: builds the purchase proposal for one store's cart. Claude then shows
    the purchase card (show_purchase_card) so the customer approves it.
  * show_orders_card: recent orders with payment status and tracking.

Registered on the same card provider as backend/mcp/cards.py.
"""
import asyncio
import uuid

from fastmcp.exceptions import ToolError
from prefab_ui.actions import SetState, ShowToast
from prefab_ui.actions.mcp import CallTool, SendMessage
from prefab_ui.app import PrefabApp
from prefab_ui.components.control_flow import If
from prefab_ui.rx import RESULT, STATE
from prefab_ui.components import H3, Button, Card, CardContent, CardFooter, CardHeader, Column, Muted, Text

from backend.mcp.cards import cards
from backend.mcp.identity import current_user_id
from backend.merchants import catalog as merchant_catalog
from backend.trust.models import SCOPE_CATALOG, SCOPE_CHECKOUT


@cards.tool(model=True)
async def add_to_cart(product_id: str, quantity: int = 1) -> dict:
    """
    Add a product to the customer's TalkShop cart. Use this when the customer asks to add,
    buy or take a product, for example "add the Nike Zoom Fly 6 black size 10 to my cart".
    Use the product ID from search_cards or search_products.
    """
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    user_id = current_user_id()
    product = await asyncio.to_thread(merchant_catalog.get_product, product_id)
    if product is None:
        raise ToolError("That product is no longer available.")
    quantity = max(1, min(quantity, 10))

    def _add() -> None:
        with get_session() as session:
            # Adding a product already in the cart raises its quantity, instead of a new row.
            existing = (session.query(CartItem)
                        .filter(CartItem.user_id == user_id, CartItem.product_id == product_id)
                        .first())
            if existing is not None:
                existing.quantity = min(existing.quantity + quantity, 10)
                session.commit()
                return
            session.add(CartItem(
                cart_item_id=f"CART_{uuid.uuid4().hex[:10].upper()}", user_id=user_id,
                product_id=product_id, merchant_id=product.merchant_id, merchant_name=product.merchant_name,
                title=product.title, brand=product.brand, category=product.category,
                price=product.price, currency=product.currency, size=product.size, color=product.color,
                image_url=product.image_url, rating=product.rating or 0.0,
                delivery_days=product.delivery_days or 5, quantity=quantity,
            ))
            session.commit()

    await asyncio.to_thread(_add)
    return {"added": product.title, "quantity": quantity}


def _cart_rows(user_id: str) -> list[dict]:
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    with get_session() as session:
        rows = session.query(CartItem).filter(CartItem.user_id == user_id).order_by(CartItem.id).all()
        return [{
            "cart_item_id": r.cart_item_id,
            "merchant_id": r.merchant_id, "merchant_name": r.merchant_name, "title": r.title,
            "product_id": r.product_id, "quantity": r.quantity, "price": r.price, "currency": r.currency,
        } for r in rows]


async def cart_data(user_id: str) -> tuple[list, list, dict]:
    """The cart rows, the stores in it, and each store's default saved card."""
    rows = await asyncio.to_thread(_cart_rows, user_id)

    stores: list[dict] = []
    for r in rows:
        if not any(s["id"] == r["merchant_id"] for s in stores):
            stores.append({"id": r["merchant_id"], "name": r["merchant_name"], "currency": r["currency"]})

    def _saved_cards() -> dict:
        from backend.payment import methods
        return {s["id"]: methods.default_method(user_id, s["id"]) for s in stores}

    saved = await asyncio.to_thread(_saved_cards)
    return rows, stores, saved


def render_cart(rows: list, stores: list, saved: dict) -> dict:
    """Draws the cart contents into the current container and returns the state they need.
    The caller provides the Card (or another container) around it."""
    total = sum(r["price"] * r["quantity"] for r in rows)

    state: dict = {}
    for i in range(len(stores)):
        state[f"ready{i}"] = False
        state[f"paid{i}"] = False
        state[f"checkout_id{i}"] = ""
        state[f"checkout_total{i}"] = ""

    # A removed line disappears straight away: each line has its own "gone" flag.
    for j in range(len(rows)):
        state[f"gone{j}"] = False

    def _start(i: int, store_id: str) -> CallTool:
        return CallTool(
            "start_checkout", arguments={"merchant_id": store_id},
            on_success=[SetState(f"checkout_id{i}", RESULT.checkout_id),
                        SetState(f"checkout_total{i}", RESULT.total),
                        SetState(f"ready{i}", True)],
            on_error=ShowToast(message="Could not start checkout. Check the cart.", variant="error"),
        )

    with CardHeader():
        H3("Your cart")
    with CardContent(), Column(gap=2):
        if not rows:
            Muted("Your cart is empty. Search for a product and press Add to cart.")
        for j, r in enumerate(rows):
            with If(~getattr(STATE, f"gone{j}")), Column(gap=1):
                Text(f"{r['title']} × {r['quantity']} — {r['price'] * r['quantity']:.2f} {r['currency']}")
                Muted(f"From {r['merchant_name']}")
                Button("Remove", variant="outline", on_click=[
                    CallTool("remove_from_cart", arguments={"cart_item_id": r["cart_item_id"]}),
                    SetState(f"gone{j}", True),
                ])
        if rows:
            Text(f"Total {total:.2f} {rows[0]['currency']}", css_class="font-medium")
    with CardFooter():
        if rows:
            Button("Clear cart", variant="outline", on_click=[
                CallTool("clear_cart", arguments={}),
                *[SetState(f"gone{j}", True) for j in range(len(rows))],
            ])
            if len(stores) > 1:
                Button("Proceed with all stores", variant="success",
                       on_click=[_start(i, s["id"]) for i, s in enumerate(stores)])
            for i, s in enumerate(stores):
                Button(f"Proceed with {s['name']}", variant="success", on_click=_start(i, s["id"]))

    # One approval block per store. Each store is paid separately, so each has its own button.
    for i, s in enumerate(stores):
        pm = saved.get(s["id"])
        with If(getattr(STATE, f"ready{i}")):
            with CardContent(), Column(gap=2):
                Text(f"{s['name']} checkout ready. Total {getattr(STATE, f'checkout_total{i}')} {s['currency']}",
                     css_class="font-medium")
                if pm:
                    Muted(f"Pays with {pm['display']}")
                else:
                    Muted(f"Add a saved card for {s['name']} in TalkShop first.")
            with CardFooter():
                if pm:
                    with If(~getattr(STATE, f"paid{i}")):  # noqa: SIM117
                        Button("Approve and pay", variant="success", on_click=CallTool(
                            "confirm_purchase",
                            arguments={"checkout_id": getattr(STATE, f"checkout_id{i}"),
                                       "payment_method_id": pm["payment_method_id"]},
                            on_success=SetState(f"paid{i}", True),
                            on_error=ShowToast(message="Payment was not completed. Check the card and try again.",
                                               variant="error"),
                        ))
                    with If(getattr(STATE, f"paid{i}")):
                        Muted(f"{s['name']} payment submitted. Ask for your orders to see tracking.")
    return state


@cards.ui()
async def show_cart_card() -> PrefabApp:
    """
    Show the customer's TalkShop cart: each item with quantity and price, the total, and a
    Proceed button for each store (or one for all stores). Each store is its own purchase,
    so each one gets its own Approve and pay button. Use this when the customer asks to see
    their cart, or after they add items.
    """
    user_id = current_user_id()
    rows, stores, saved = await cart_data(user_id)
    with Card(css_class="max-w-2xl mx-auto") as view:
        state = render_cart(rows, stores, saved)
    return PrefabApp(view=view, state=state)


@cards.tool(model=True)
async def start_checkout(merchant_id: str) -> dict:
    """
    Build the purchase proposal for the customer's cart items from one store. Returns the
    checkout ID. Then call show_purchase_card with that checkout ID so the customer can approve.
    Nothing is charged here.
    """
    from backend.db.schema import CartItem, User
    from backend.db.session_utils import get_session
    from backend.purchase import service
    from backend.trust import credentials, sessions as trust_sessions

    user_id = current_user_id()

    def _load() -> tuple[list[tuple[str, int]], bool]:
        with get_session() as session:
            rows = (session.query(CartItem)
                    .filter(CartItem.user_id == user_id, CartItem.merchant_id == merchant_id)
                    .order_by(CartItem.id).all())
            items = [(r.product_id, r.quantity) for r in rows]
            user = session.query(User).filter(User.user_id == user_id).first()
            return items, bool(user and user.is_guest)

    items, is_guest = await asyncio.to_thread(_load)
    if not items:
        raise ToolError("There are no items from that store in the cart.")

    trusted, _ = await asyncio.to_thread(trust_sessions.require, user_id, merchant_id, SCOPE_CHECKOUT)
    if trusted is None:
        def _open() -> None:
            credential = credentials.issue_customer_agent_credential(user_id, is_talkshop_guest=is_guest)
            trust_sessions.establish(credential, merchant_id, "mcp", SCOPE_CATALOG)
        await asyncio.to_thread(_open)

    result = await service.create_proposal(user_id=user_id, is_talkshop_guest=is_guest, items=items)
    if result["status"] != "proposed":
        raise ToolError(f"{result['reason']}: {result['message']}")

    proposal = result["proposal"]
    return {
        "checkout_id": proposal["checkout_id"],
        "total": proposal.get("total"),
        "currency": proposal.get("currency"),
        "next": "Call show_purchase_card with this checkout_id so the customer can approve.",
    }


@cards.ui()
async def show_orders_card(limit: int = 5) -> PrefabApp:
    """
    Show the customer's recent TalkShop orders with payment status and tracking numbers.
    Use this when the customer asks about their orders, tracking or purchase history.
    """
    from backend.db.schema import Order
    from backend.db.session_utils import get_session

    user_id = current_user_id()
    limit = max(1, min(limit, 20))

    def _orders() -> list[dict]:
        with get_session() as session:
            rows = (session.query(Order).filter(Order.user_id == user_id)
                    .order_by(Order.created_at.desc()).limit(limit).all())
            out = []
            for o in rows:
                product = merchant_catalog.get_product(o.product_id)
                out.append({
                    "title": product.title if product else o.product_id,
                    "amount": o.amount, "currency": o.currency,
                    "status": o.status, "tracking_number": o.tracking_number,
                })
            return out

    orders = await asyncio.to_thread(_orders)

    with Column(gap=3, css_class="max-w-2xl mx-auto") as view:
        H3("Your orders")
        if not orders:
            Muted("You have no orders yet.")
        for o in orders:
            with Card():
                with CardContent(), Column(gap=1):
                    Text(o["title"], css_class="font-medium")
                    Muted(f"Payment: {o['status']} · {o['amount']:.2f} {o['currency']}")
                    Text(f"Tracking: {o['tracking_number'] or 'not assigned yet'}")
    return PrefabApp(view=view)


@cards.tool(model=True)
async def my_cart() -> list[dict]:
    """
    The items in the customer's TalkShop cart, with product ID, store, quantity and price.
    Use this to read the cart before checkout, or to answer questions about it.
    """
    user_id = current_user_id()
    rows = await asyncio.to_thread(_cart_rows, user_id)
    return [{"product_id": r["product_id"], "product": r["title"], "store": r["merchant_name"],
             "store_id": r["merchant_id"], "quantity": r["quantity"], "price": r["price"],
             "currency": r["currency"]} for r in rows]
