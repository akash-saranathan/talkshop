"""
Purchase card shown inside Claude (MCP Apps).

  * show_purchase_card(checkout_id): a card with the items, total and saved card,
    and an "Approve and pay" button. Claude can show it; it only displays.
  * confirm_purchase(...): the button's action. It is an app-only tool, so Claude
    cannot call it; only the card can. Pressing the button is the customer's
    approval, and it runs the same GO AHEAD path as the TalkShop approval page.
"""
import asyncio
import base64
import json

from fastmcp.apps.app import FastMCPApp
from fastmcp.exceptions import ToolError
from prefab_ui.actions import SetState, ShowToast
from prefab_ui.actions.mcp import CallTool, SendMessage
from prefab_ui.app import PrefabApp
from prefab_ui.components import (
    H3,
    Button,
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    Column,
    Grid,
    Image,
    Muted,
    Row,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Text,
)
from prefab_ui.components.control_flow import If
from prefab_ui.rx import STATE

from backend.mcp.identity import current_user_id
from backend.merchants import catalog as merchant_catalog

cards = FastMCPApp("TalkShop")


def _load_checkout(user_id: str, checkout_id: str) -> dict | None:
    from backend.db.schema import MerchantCheckout
    from backend.db.session_utils import get_session

    with get_session() as session:
        row = (session.query(MerchantCheckout)
               .filter(MerchantCheckout.checkout_id == checkout_id,
                       MerchantCheckout.user_id == user_id)
               .first())
        if row is None:
            return None
        checkout = json.loads(row.document)
        checkout["status"] = row.status
        checkout["merchant_id"] = row.merchant_id
        return checkout


@cards.ui()
async def show_purchase_card(checkout_id: str, payment_method_id: str | None = None) -> PrefabApp:
    """
    Show the purchase card for one of the customer's checkouts: the items, the total and
    the saved card, with an Approve and pay button. Use this after propose_purchase. The
    customer presses the button to pay; nothing is charged until they do.
    """
    from backend.payment import methods

    user_id = current_user_id()

    def _build() -> tuple[dict | None, dict | None]:
        checkout = _load_checkout(user_id, checkout_id)
        if checkout and payment_method_id:
            pm = methods.get_method(user_id, payment_method_id)
        else:
            pm = methods.default_method(user_id, checkout["merchant_id"]) if checkout else None
        return checkout, pm

    checkout, pm = await asyncio.to_thread(_build)
    if checkout is None:
        raise ToolError("No checkout with that ID on this TalkShop account.")

    proposed = checkout["status"] == "proposed"
    with Card(css_class="max-w-lg mx-auto") as view:
        with CardHeader():
            H3("Approve purchase")
        with CardContent(), Column(gap=2):
            Text(f"{checkout['product_title']} × {checkout['quantity']}", css_class="font-medium")
            Muted(checkout["merchant_name"])
            Text(f"Subtotal {checkout['subtotal']:.2f} · Shipping {checkout['shipping']:.2f} · Tax {checkout['tax']:.2f}")
            Text(f"Total {checkout['total']:.2f} {checkout['currency']}", css_class="font-medium")
            if pm:
                Muted(f"Pays with {pm['display']}")
            else:
                Muted("No saved card for this merchant. Add one in TalkShop first.")
        with CardFooter():
            if not proposed:
                Muted(f"This checkout is already {checkout['status'].replace('_', ' ')}.")
            elif pm is None:
                Muted("Add a saved card in TalkShop before approving.")
            else:
                with If(STATE.decided):
                    # Shown straight after Approve and pay, from the details already on this card.
                    Text("Payment submitted.", css_class="font-medium")
                    Muted(f"{checkout['product_title']} × {checkout['quantity']}")
                    Muted(f"Total {checkout['total']:.2f} {checkout['currency']} · paid with {pm['display']}")
                    Muted("Tracking: not assigned yet. Ask for your orders to check tracking later.")
                with If(~STATE.decided):  # noqa: SIM117
                    Button(
                        "Approve and pay",
                        variant="success",
                        on_click=CallTool(
                            "confirm_purchase",
                            arguments={"checkout_id": checkout_id, "payment_method_id": pm["payment_method_id"]},
                            on_success=SetState("decided", True),
                            on_error=ShowToast(message="Payment was not completed. Check the card and try again.",
                                               variant="error"),
                        ),
                    )
    return PrefabApp(view=view, state={"decided": False})


@cards.tool()
async def confirm_purchase(checkout_id: str, payment_method_id: str) -> dict:
    """Pay for a checkout the customer approved on the purchase card. App-only: not for the model."""
    from backend.purchase import service

    user_id = current_user_id()

    def _load() -> dict | None:
        checkout = _load_checkout(user_id, checkout_id)
        if checkout is None:
            return None
        return {
            "checkout_hash": checkout["checkout_hash"],
            "total": checkout["total"],
            "currency": checkout["currency"],
        }

    details = await asyncio.to_thread(_load)
    if details is None:
        raise ToolError("No checkout with that ID on this TalkShop account.")

    # The customer's click on the card is the consent, recorded as a click on this checkout.
    result = await service.go_ahead(
        user_id=user_id, checkout_id=checkout_id, checkout_hash=details["checkout_hash"],
        total=details["total"], currency=details["currency"],
        payment_method_id=payment_method_id, consent_mode="click",
    )
    if result.get("status") == "approved":
        # The store's items are bought, so take them out of the cart.
        from backend.db.schema import CartItem, MerchantCheckout
        from backend.db.session_utils import get_session

        def _clear_cart() -> None:
            with get_session() as session:
                row = session.query(MerchantCheckout).filter(MerchantCheckout.checkout_id == checkout_id).first()
                if row is not None:
                    (session.query(CartItem)
                     .filter(CartItem.user_id == user_id, CartItem.merchant_id == row.merchant_id)
                     .delete(synchronize_session=False))
                    session.commit()

        await asyncio.to_thread(_clear_cart)
    return {key: result.get(key) for key in ("status", "reason", "message", "order") if key in result}


def _matching(products: list, query: str) -> list:
    """Keep products that contain every word the customer typed (store, brand, name, colour, category).
    If none match every word, keep the ones that match any word. The catalog search doesn't filter by words."""
    words = [w for w in query.lower().replace("-", " ").split() if w]
    if not words:
        return products

    def _text(p) -> str:
        parts = [p.title, p.merchant_name, p.merchant_id, p.category or "", p.color or "", p.brand or ""]
        return " ".join(parts).lower()

    everything = [p for p in products if all(w in _text(p) for w in words)]
    if everything:
        return everything
    return [p for p in products if any(w in _text(p) for w in words)]


def _one_per_model(products: list) -> list:
    """One card per shoe model and colour, not one per size. Stores take turns, so one brand
    doesn't fill the whole grid when the search doesn't name a brand."""
    seen: set = set()
    unique = []
    for p in products:
        key = (p.merchant_id, p.title, p.color)
        if key not in seen:
            seen.add(key)
            unique.append(p)
    by_store: dict[str, list] = {}
    for p in unique:
        by_store.setdefault(p.merchant_id, []).append(p)
    mixed = []
    while any(by_store.values()):
        for store in list(by_store):
            if by_store[store]:
                mixed.append(by_store[store].pop(0))
    return mixed


def _thumbnail_uri(image_url: str | None) -> str | None:
    """A small JPEG of the product photo, embedded in the card so it needs no network access."""
    from io import BytesIO

    from PIL import Image as PILImage
    from backend.merchants.catalog import _PUBLIC_DIR

    if not image_url:
        return None
    try:
        with PILImage.open(_PUBLIC_DIR / image_url.lstrip("/")) as photo:
            photo = photo.convert("RGB")
            photo.thumbnail((320, 320))
            buf = BytesIO()
            photo.save(buf, format="JPEG", quality=80)
    except OSError:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@cards.ui()
async def search_cards(query: str, max_price: float | None = None) -> PrefabApp:
    """
    Show TalkShop products as clickable cards with photos, prices and a Buy button.
    Use this whenever the customer asks to show, see, find, browse or look at products
    (for example "show me nike running shoes" or "find me a watch"). Prefer this over
    search_products for any request to see products. If the result has no products, or the
    customer asks for something TalkShop doesn't sell (for example a 50 inch TV), search the
    web right away with your own web search, without asking first, and show the results as
    web results. Pressing Add to cart only adds TalkShop products.
    """
    user_id = current_user_id()  # the customer must be signed in

    products = await asyncio.to_thread(
        merchant_catalog.search, query=query, category=None, brand=None, max_price=max_price, size=None)
    products = _one_per_model(_matching(products, query))[:6]

    thumbs = await asyncio.to_thread(lambda: [_thumbnail_uri(p.image_url) for p in products])
    in_cart = await asyncio.to_thread(_cart_quantities, user_id)

    # Each card counts its own presses: q0, q1, ... start from what is already in the cart.
    state = {}
    for i, p in enumerate(products):
        state[f"q{i}"] = in_cart.get(p.product_id, 0)
        state[f"inc{i}"] = in_cart.get(p.product_id, 0) > 0

    with Column(gap=4, css_class="max-w-4xl mx-auto") as view:
        H3(f"Results for “{query}”")
        if not products:
            Muted("No products found. Try a different search.")
        with Grid(columns=3, gap=3):
            for i, (p, thumb) in enumerate(zip(products, thumbs)):
                key = f"q{i}"
                flag = f"inc{i}"
                with Card():
                    if thumb:
                        Image(src=thumb, alt=p.title, css_class="w-full h-40 object-cover")
                    with CardContent(), Column(gap=1):
                        Text(p.title, css_class="font-medium")
                        Muted(" · ".join(x for x in (p.merchant_name, getattr(p, "color", None), getattr(p, "size", None)) if x))
                        Text(f"{p.price:.2f} {p.currency}", css_class="font-medium")
                        Muted(f"In cart: {getattr(STATE, key)}")
                    with CardFooter():
                        # Before adding: an Add to cart button. After: minus, the quantity, and plus.
                        with If(~getattr(STATE, flag)):
                            Button("Add to cart", on_click=[
                                CallTool("add_to_cart", arguments={"product_id": p.product_id, "quantity": 1}),
                                SetState(flag, True),
                                SetState(key, 1),
                            ])
                        with If(getattr(STATE, flag)):
                            with Row(gap=3, align="center"):
                                Button("−", variant="outline", on_click=[
                                    CallTool("remove_one_from_cart", arguments={"product_id": p.product_id}),
                                    SetState(key, getattr(STATE, key) - 1),
                                ])
                                Text(f"{getattr(STATE, key)}", css_class="font-medium")
                                Button("+", variant="outline", on_click=[
                                    CallTool("add_to_cart", arguments={"product_id": p.product_id, "quantity": 1}),
                                    SetState(key, getattr(STATE, key) + 1),
                                ])
    return PrefabApp(view=view, state=state)


def _cart_quantities(user_id: str) -> dict[str, int]:
    from backend.db.schema import CartItem
    from backend.db.session_utils import get_session

    with get_session() as session:
        rows = session.query(CartItem).filter(CartItem.user_id == user_id).all()
        totals: dict[str, int] = {}
        for r in rows:
            totals[r.product_id] = totals.get(r.product_id, 0) + r.quantity
        return totals


@cards.ui()
async def show_order_card(checkout_id: str) -> PrefabApp:
    """
    Show the order summary and tracking for a checkout the customer made: the items, the
    total, the payment status and the tracking number once one is assigned.
    """
    from backend.db.schema import MerchantCheckout, Order
    from backend.db.session_utils import get_session

    user_id = current_user_id()

    def _build() -> tuple[dict | None, dict | None]:
        checkout = _load_checkout(user_id, checkout_id)
        if checkout is None:
            return None, None
        with get_session() as session:
            row = (session.query(Order)
                   .filter(Order.order_id == checkout_id, Order.user_id == user_id)
                   .first())
            order = None if row is None else {
                "status": row.status,
                "tracking_number": row.tracking_number,
            }
        return checkout, order

    checkout, order = await asyncio.to_thread(_build)
    if checkout is None:
        raise ToolError("No checkout with that ID on this TalkShop account.")

    with Card(css_class="max-w-lg mx-auto") as view:
        with CardHeader():
            H3("Order summary")
        with CardContent(), Column(gap=2):
            Text(f"{checkout['product_title']} × {checkout['quantity']}", css_class="font-medium")
            Muted(checkout["merchant_name"])
            Text(f"Total {checkout['total']:.2f} {checkout['currency']}", css_class="font-medium")
            if order is None:
                Muted(f"Not paid yet. Checkout status: {checkout['status'].replace('_', ' ')}.")
            else:
                Text(f"Payment status: {order['status']}")
                Text(f"Tracking: {order['tracking_number'] or 'not assigned yet'}")
    return PrefabApp(view=view)


@cards.ui()
async def compare_cards(product_ids: list[str]) -> PrefabApp:
    """
    Show a side-by-side table of 2 to 4 TalkShop products: price, rating, delivery, stock
    and shipping. Use this whenever the customer asks to compare products. The table is
    built from catalog data only, so no AI writes it; add any recommendation in your reply.
    """
    current_user_id()  # the customer must be signed in

    def _load() -> list:
        found = []
        for pid in product_ids[:4]:
            product = merchant_catalog.get_product(pid)
            if product is not None:
                found.append(product)
        return found

    products = await asyncio.to_thread(_load)
    if len(products) < 2:
        raise ToolError("Choose at least two products to compare.")

    def _cell(text: str) -> None:
        with TableCell():
            Text(text)

    with Column(gap=3, css_class="max-w-3xl mx-auto") as view:
        H3("Compare")
        with Table():
            with TableHeader(), TableRow():
                with TableHead():
                    Muted("")
                for p in products:
                    with TableHead():
                        Text(p.title, css_class="font-medium")
            with TableBody():
                with TableRow():
                    _cell("Price")
                    for p in products:
                        _cell(f"{p.price:.2f} {p.currency}")
                with TableRow():
                    _cell("Rating")
                    for p in products:
                        rating = getattr(p, "rating", None)
                        reviews = getattr(p, "review_count", None)
                        _cell(f"{rating:.1f} ({reviews:,} reviews)" if rating else "No rating")
                with TableRow():
                    _cell("Delivery")
                    for p in products:
                        _cell(f"{p.delivery_days} days" if p.delivery_days is not None else "Unknown")
                with TableRow():
                    _cell("Shipping")
                    for p in products:
                        shipping = getattr(p, "shipping_cost", None)
                        _cell("Free" if not shipping else f"{shipping:.2f} {p.currency}")
                with TableRow():
                    _cell("In stock")
                    for p in products:
                        _cell("Yes" if p.available and (p.inventory or 0) > 0 else "No")
                with TableRow():
                    _cell("Color / size")
                    for p in products:
                        _cell(" · ".join(x for x in (p.color, p.size) if x) or "-")
        cheapest = min(products, key=lambda p: p.price)
        Muted(f"Lowest price: {cheapest.title} at {cheapest.price:.2f} {cheapest.currency}.")
    return PrefabApp(view=view)
