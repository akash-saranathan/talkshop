"""
Talkshop orchestrator — runs one conversational turn and yields structured
events for the panel (plan §9.4). Inputs are either typed text or a button
action (Select, a size/colour chip, Yes-checkout, GO AHEAD …).

Flow (spec §3): search → top 3 → select → size → colour → in stock → add to
ShopSphere cart → offer checkout → checkout snapshot → review → GO AHEAD →
authorized → order confirmed.

Typed text is read deterministically where the answer is predictable
(parse.py), otherwise the LLM chooses an action (brain.decide) from those the
current stage allows (state.ALLOWED). Payment happens ONLY for the explicit
{"type": "go_ahead"} action — typed "go ahead" just re-shows the review card.
"""
import asyncio
import logging
from typing import AsyncIterator, Optional

from backend.auth.dependencies import CurrentUser
from backend.shop.cart import CartError
from backend.shop.checkout import CheckoutError
from backend.talkshop import brain, parse, state, tools
from backend.talkshop.state import STEPPER, Session, Stage

log = logging.getLogger(__name__)

SUGGESTIONS = {
    "home": ["Running shoes under $150", "A gift under $50", "Noise-cancelling headphones"],
    "women": ["A summer dress", "Women's running shoes", "Leather handbag"],
    "men": ["Men's crew tee", "Leather Chelsea boots", "A classic watch"],
    "new": ["What's new in shoes?", "New tech under $100", "New arrivals for women"],
    "shoes": ["Everyday running shoes", "White sneakers", "Waterproof hiking boots"],
    "clothing": ["A summer dress", "Men's crew tee", "Denim jacket"],
    "accessories": ["Leather handbag", "Sunglasses for summer", "Classic watch"],
    "electronics": ["Noise-cancelling headphones", "A new phone", "Bluetooth speaker"],
}


class Turn:
    """Collects the events of one turn; every non-status event is also kept in
    the session transcript so the panel can rebuild after a page change."""

    def __init__(self, s: Session):
        self.s, self.events = s, []
        self.queue: asyncio.Queue = asyncio.Queue()   # streamed to the panel as they happen

    def emit(self, type_: str, **data) -> dict:
        ev = {"type": type_, **data}
        self.events.append(ev)
        self.queue.put_nowait(ev)
        if type_ != "status":
            self.s.transcript.append(ev)
        return ev

    def say(self, text: str, **extra) -> dict:
        self.s.history.append({"role": "assistant", "text": text})
        return self.emit("message", role="assistant", text=text, **extra)

    def stage(self, stage: Stage) -> Optional[dict]:
        if self.s.stage == stage:
            return None
        self.s.stage = stage
        return self.emit("stage", stage=stage.value, step=STEPPER[stage])

    def status(self, agent: str, message: str) -> dict:
        return self.emit("status", agent=agent, message=message)


# ── helpers ──────────────────────────────────────────────────────────────────

def _shown_products(s: Session) -> list[dict]:
    return [p for p in (tools.get_product(pid) for pid in s.shown) if p]


def _context(s: Session) -> dict:
    ctx: dict = {"page": s.page}
    if s.page.get("product_id") and s.page.get("product_id") != s.product_id:
        p = tools.get_product(s.page["product_id"])
        if p:   # the product page the shopper is looking at ("does this come in 9?")
            ctx["page_product"] = {"product_id": p["product_id"], "name": p["name"], "brand": p["brand"],
                                   "price": p["price"], "rating": p["rating"], "tags": p["tags"],
                                   "description": p["description"], "sizes": p["sizes"],
                                   "colors": [c["name"] for c in p["colors"]]}
    if s.shown:
        ctx["shown_products"] = [
            {"index": i, "product_id": p["product_id"], "name": p["name"], "brand": p["brand"], "price": p["price"],
             "rating": p["rating"], "tags": p["tags"], "description": p["description"]}
            for i, p in enumerate(_shown_products(s))]
    if s.product_id:
        p = tools.get_product(s.product_id)
        avail = tools.check_variant(s.product_id, size=s.size)
        ctx["selected_product"] = {
            "product_id": p["product_id"], "name": p["name"], "brand": p["brand"], "price": p["price"],
            "rating": p["rating"], "description": p["description"], "tags": p["tags"],
            "option_label": avail["option_label"],
            "sizes_in_stock": [x["size"] for x in avail["sizes"] if x["available"]],
            "colors_in_stock": [c["name"] for c in avail["colors"] if c["available"]],
            "chosen": {"size": s.size, "color": s.color},
        }
    if s.checkout_id:
        co = tools.get_checkout(s.user_id, s.checkout_id)
        ctx["checkout"] = {"total": co["total"], "delivery": co["delivery"]["method"],
                           "payment": (co["payment_method"] or {}).get("display")}
    return ctx


# ── steps ────────────────────────────────────────────────────────────────────

NOT_SOLD_TAIL = "ShopSphere sells clothing, shoes, accessories and electronics. Is there something from those I can find for you?"


async def _search(t: Turn, text: str, args: dict, note: str = "") -> None:
    s = t.s
    t.stage(Stage.SEARCHING)
    t.status("SneakPeek", "Searching ShopSphere…")
    query = " ".join(x for x in (text, args.get("query")) if x)
    result = tools.search_products(
        query=query, category=args.get("category"), brand=args.get("brand"), max_price=args.get("max_price"),
        gender=args.get("gender") or parse.gender_of(text), color=args.get("color"))
    products = result["products"]
    s.reset_selection()
    if not products:
        s.shown = []
        t.stage(Stage.GREETING)
        hint = f" under ${args['max_price']:.0f}" if args.get("max_price") else ""
        t.say(f"I couldn't find anything matching that{hint} at ShopSphere right now. "
              "Could you tell me a bit more, or try a different style?")
        return
    t.status("VibeCheck", "Picking the best matches…")
    copy = await brain.recommend(text, products)
    # The LLM: none of these is the kind of thing asked for. (Skipped when the
    # blocker already split off the part ShopSphere doesn't sell.)
    if copy.get("fits") is False and not note:
        s.shown = []
        t.stage(Stage.GREETING)
        asked = copy.get("asked_for") or "that"
        t.say(f"Sorry, ShopSphere doesn't sell {asked}, so I won't show you unrelated products. {NOT_SOLD_TAIL}")
        return
    notes = [note] if note else []
    if result["brand_missing"] and args.get("brand"):
        notes.append(f"ShopSphere doesn't carry {args['brand']}, but here are similar options.")
    if "max_price" in result["relaxed"]:
        notes.append(f"Nothing was under ${args['max_price']:.0f}, so here are the closest options.")
    if "color" in result["relaxed"]:
        notes.append(f"None came in {args['color']}, so here are other colours.")
    intro = " ".join(notes) or copy["intro"]
    s.shown = [p["product_id"] for p in products]
    s.last_query = text
    _remember_wants(s, text, args, products, copy.get("wants") or {})
    t.say(intro)
    t.emit("recommendations", intro=intro,
           products=[{**_in_colour(p, s.wants.get("color")), "reason": copy["reasons"].get(p["product_id"])}
                     for p in products])
    t.stage(Stage.RECOMMENDED)


async def _select(t: Turn, product_id: str, *, from_page: bool = False) -> None:
    s = t.s
    product = tools.get_product(product_id)
    if not product:
        t.say("Sorry, I couldn't find that product.")
        return
    s.reset_selection()
    s.product_id = product_id
    t.emit("product_selected", product=product, from_page=from_page)
    t.stage(Stage.PRODUCT_SELECTED)
    lead = (f"Let's get you the {product['name']}." if from_page else "Great choice.")
    await _next_option(t, " ".join(x for x in (lead, _apply_wants(s)) if x))


def _remember_wants(s: Session, text: str, args: dict, products: list[dict], understood: dict) -> None:
    """Keep the size/colour named in a request ("teal nike shoes of size 10") so
    the shopper isn't asked again after picking. `understood` is what the LLM
    read from the request (typos, shades); the parser covers a model outage.
    A request for a different kind of product starts afresh; a follow-up in the
    same kind keeps what wasn't restated."""
    vocab = sorted({c["name"] for p in products for c in p["colors"]})
    color = (understood.get("color")
             or parse.pick_color(" ".join(x for x in (text, args.get("color")) if x), vocab))
    size = (parse.asked_size(text) or understood.get("size")
            or (str(args["size"]) if args.get("size") else None))
    category = args.get("category")
    keep = {} if category and category != s.wants.get("category") else s.wants
    s.wants = {**keep, **{k: v for k, v in (("size", size), ("color", color)) if v},
               "category": category or keep.get("category")}


def _in_colour(product: dict, color: Optional[str]) -> dict:
    """Show a recommendation card in the colour the shopper asked for."""
    match = next((c for c in product["colors"] if color and c["name"].lower() == color.lower()), None)
    return {**product, "image_url": match["image_url"]} if match and match.get("image_url") else product


def _apply_wants(s: Session) -> str:
    """Pre-fill the size/colour asked for while searching, where this product has
    them in stock. Returns what to tell the shopper (applied, or why not)."""
    want_size, want_color = s.wants.get("size"), s.wants.get("color")
    if not (want_size or want_color):
        return ""
    avail = tools.check_variant(s.product_id)
    label = avail["option_label"]
    notes = []
    color = parse.pick_color(want_color, [c["name"] for c in avail["colors"]]) if want_color else None
    if want_color and not color:
        notes.append(f"It doesn't come in {want_color.lower()}.")
    if want_size and avail["has_sizes"]:
        size = parse.pick_size(want_size, [x["size"] for x in avail["sizes"]])
        if size and any(x["size"] == size and x["available"] for x in avail["sizes"]):
            s.size = size
        else:
            notes.append(f"{label} {size or want_size.upper()} isn't available in this one.")
    if color:
        if any(c["name"] == color and c["available"] for c in tools.check_variant(s.product_id, size=s.size)["colors"]):
            s.color = color
        else:
            notes.append(f"{color} isn't available{f' in {label.lower()} {s.size}' if s.size else ''}.")
    done = s.color and (s.size or not avail["has_sizes"])
    if (s.size or s.color) and not done:  # the confirmation line shows both when nothing is left to ask
        notes.insert(0, f"I've set {f'{label.lower()} {s.size}' if s.size else f'the colour to {s.color}'}, as you asked.")
    return " ".join(notes)


async def _next_option(t: Turn, lead: str = "") -> None:
    """Ask only for what's still missing (skip options with a single in-stock value)."""
    s = t.s
    avail = tools.check_variant(s.product_id, size=s.size)
    label = avail["option_label"]
    if avail["has_sizes"] and s.size is None:
        in_stock = [x["size"] for x in avail["sizes"] if x["available"]]
        if len(in_stock) == 1:
            s.size = in_stock[0]
            return await _next_option(t, lead)
        if not in_stock:
            t.say(f"{lead} Unfortunately it's sold out in every {label.lower()} right now.".strip())
            return
        t.say(f"{lead} What {label.lower()} would you like?".strip())
        t.emit("ask_option", option="size", label=label,
               choices=[{"value": x["size"], "available": x["available"]} for x in avail["sizes"]])
        t.stage(Stage.ASK_SIZE)
        return
    if s.color is not None and not any(c["name"] == s.color and c["available"] for c in avail["colors"]):
        lead = f"{lead} {s.color} isn't available in {label.lower()} {s.size}.".strip()
        s.color = None
    if s.color is None:
        colors = [c for c in avail["colors"] if c["available"]]
        if len(colors) == 1:
            s.color = colors[0]["name"]
            return await _confirm_variant(t, lead)
        if not colors:
            t.say(f"{lead} That {label.lower()} just sold out in every colour.".strip())
            return
        t.say(f"{lead} Which colour would you prefer?".strip())
        t.emit("ask_option", option="color", label="Colour",
               choices=[{"value": c["name"], "hex": c["hex"], "image_url": c["image_url"], "available": c["available"]}
                        for c in avail["colors"]])
        t.stage(Stage.ASK_COLOR)
        return
    await _confirm_variant(t, lead)


async def _choose_size(t: Turn, value: str) -> None:
    s = t.s
    avail = tools.check_variant(s.product_id)
    label = avail["option_label"].lower()
    offered = {x["size"]: x["available"] for x in avail["sizes"]}
    if value not in offered:
        t.say(f"That {label} isn't offered for this product. Options: {', '.join(offered)}.")
        return
    name = tools.get_product(s.product_id)["name"]
    if not offered[value]:
        others = [k for k, ok in offered.items() if ok]
        t.say(f"{label.capitalize()} {value} is out of stock in {name}. Available: {', '.join(others)}.")
        t.emit("ask_option", option="size", label=avail["option_label"],
               choices=[{"value": k, "available": ok} for k, ok in offered.items()])
        return
    s.size = value
    await _next_option(t, f"{avail['option_label']} {value} is available.")


async def _choose_color(t: Turn, value: str) -> None:
    s = t.s
    check = tools.check_variant(s.product_id, size=s.size, color=value)
    names = {c["name"]: c for c in check["colors"]}
    if value not in names:
        t.say(f"That colour isn't offered. Options: {', '.join(names)}.")
        return
    if not names[value]["available"]:
        ok = [n for n, c in names.items() if c["available"]]
        where = f" in {check['option_label'].lower()} {s.size}" if s.size else ""
        t.say(f"{value} isn't available{where}. Available colours: {', '.join(ok)}.")
        t.emit("ask_option", option="color", label="Colour",
               choices=[{"value": c["name"], "hex": c["hex"], "image_url": c["image_url"], "available": c["available"]}
                        for c in check["colors"]])
        return
    s.color = value
    await _confirm_variant(t)


async def _confirm_variant(t: Turn, lead: str = "") -> None:
    """Validate the exact SKU, add it to the ShopSphere cart, offer checkout."""
    s = t.s
    t.status("SneakPeek", "Checking stock…")
    check = tools.check_variant(s.product_id, size=s.size, color=s.color)
    sel = check["selected"]
    product = tools.get_product(s.product_id)
    if not sel or not sel["available"]:
        s.color = None
        t.say("Sorry — that combination just sold out. Please pick another colour.")
        return await _next_option(t)
    s.sku = sel["sku"]
    parts = [product["name"]] + ([f"{check['option_label']} {s.size}"] if s.size else []) + [s.color]
    t.emit("variant_confirmed", sku=s.sku, product_id=s.product_id, name=product["name"], size=s.size,
           color=s.color, option_label=check["option_label"], image_url=sel["image_url"], price=product["price"])
    t.stage(Stage.VARIANT_CONFIRMED)
    t.status("CartUp", "Adding to your ShopSphere cart…")
    try:
        cart, line_id = tools.add_to_cart(s.user_id, s.sku)
    except CartError as exc:
        # Never a dead end: explain, then let the shopper pick another colour.
        msg = exc.message
        if exc.code == "OUT_OF_STOCK":
            msg = (f"Your cart already holds every pair we have of {product['name']} in that "
                   f"{check['option_label'].lower()} and colour.")
        s.color, s.sku = None, None
        t.stage(Stage.ASK_COLOR if check["has_sizes"] else Stage.PRODUCT_SELECTED)
        return await _next_option(t, f"{msg} Want a different colour?")
    if line_id not in s.line_ids:
        s.line_ids.append(line_id)
    s.added_qty[line_id] = s.added_qty.get(line_id, 0) + 1
    t.say(f"{(lead + ' ') if lead else ''}✓ {' · '.join(parts)} is in stock. Added to your ShopSphere cart.")
    t.emit("cart_updated", cart=cart, added_line_id=line_id)
    t.stage(Stage.IN_CART)
    t.say("Would you like me to proceed with checkout?")
    t.emit("offer_checkout", choices=[{"value": "checkout", "label": "Yes, checkout"},
                                      {"value": "keep_shopping", "label": "Keep shopping"}])
    t.stage(Stage.OFFER_CHECKOUT)


async def _checkout(t: Turn) -> None:
    s = t.s
    if s.is_visitor:
        # Browsing and the cart are open to everyone; checking out needs an
        # account. The panel shows a sign-in card and resumes here afterwards.
        t.say("To check out, please log in or create a ShopSphere account. Your cart comes with you.")
        t.emit("login_required", reason="checkout")
        t.stage(Stage.OFFER_CHECKOUT)
        return
    cart_ids = {ln["line_id"] for ln in tools.get_cart(s.user_id)["lines"]}
    lines = [lid for lid in s.line_ids if lid in cart_ids]   # only what Talkshop added in this chat
    if not lines:
        t.say("There's nothing from our chat in your cart right now. What would you like to find?")
        t.stage(Stage.GREETING)
        return
    t.status("CartUp", "Preparing your order…")
    try:
        co = tools.create_checkout(s.user_id, lines, {lid: s.added_qty.get(lid, 1) for lid in lines})
    except CheckoutError as exc:
        t.say(exc.message)
        return
    s.checkout_id = co["checkout_id"]
    if _missing(co):
        return _ask_for_details(t, co)
    t.say("Here's your order. Review it, then tap GO AHEAD to place it.")
    t.emit("checkout_ready", checkout=co)
    t.stage(Stage.AWAITING_CONSENT)


def _missing(co: dict) -> dict:
    """What ShopSphere still needs before this order can be reviewed."""
    need = {"address": not co.get("address"), "payment": not co.get("payment_method")}
    return need if any(need.values()) else {}


def _ask_for_details(t: Turn, co: dict, lead: str = "") -> None:
    """Missing address/card: the panel shows ShopSphere's secure forms. They post
    straight to ShopSphere (profile API / card tokenization) and hand Talkshop
    back only ids — the details never pass through the chat or the LLM."""
    need = _missing(co)
    if need["address"]:
        what = "a shipping address and a payment card" if need["payment"] else "a shipping address"
        t.say(f"{lead} Almost there: ShopSphere needs {what} for this order. Please add the address in the "
              "secure form below. It goes straight to ShopSphere checkout, not into our chat.".strip())
    else:
        t.say(f"{lead} Last step: please add a card in the Secure Payment form below. Card details go straight "
              "to ShopSphere's payment partner. I only ever see the card type and last 4 digits.".strip())
    t.emit("checkout_details_needed", checkout_id=co["checkout_id"], needs=need)
    t.stage(Stage.CHECKOUT_DETAILS)


async def _details_added(t: Turn, action: dict) -> None:
    """A secure form saved an address or card on ShopSphere: attach it by id,
    recalculate the order on the merchant side, and resume checkout."""
    s = t.s
    changes = {k: str(action[k]) for k in ("address_id", "payment_method_id") if action.get(k)}
    before = tools.get_checkout(s.user_id, s.checkout_id)
    try:
        co = tools.update_checkout(s.user_id, s.checkout_id, **changes)   # ownership checked by ShopSphere
    except CheckoutError as exc:
        t.say(exc.message)
        return _ask_for_details(t, before)
    if _missing(co):
        return _ask_for_details(t, co, "✓ Address saved." if "address_id" in changes else "")
    lead = "Thanks, ShopSphere has everything it needs."
    if co["total"] != before["total"]:
        lead += f" Your total was recalculated to ${co['total']:.2f}."
    t.say(f"{lead} Review your order, then tap GO AHEAD to place it.")
    t.emit("checkout_ready", checkout=co)
    t.stage(Stage.AWAITING_CONSENT)


async def _update_checkout(t: Turn, changes: dict) -> None:
    s = t.s
    changes = {k: v for k, v in changes.items()
               if k in ("delivery_method", "address_id", "payment_method_id", "quantities") and v is not None}
    try:
        co = tools.update_checkout(s.user_id, s.checkout_id, **changes)
    except CheckoutError as exc:
        t.say(exc.message)
        return
    t.emit("checkout_updated", checkout=co)


async def _cancel_checkout(t: Turn) -> None:
    s = t.s
    if s.checkout_id:
        tools.cancel_checkout(s.user_id, s.checkout_id)
    s.checkout_id = None
    t.say("No problem — nothing was charged. Your item is still in your ShopSphere cart.")
    t.stage(Stage.IN_CART)


async def _go_ahead(t: Turn, user: CurrentUser, checkout_id: Optional[str]) -> None:
    """The consent gate. Reachable only from the explicit GO AHEAD action."""
    s = t.s
    if s.stage != Stage.AWAITING_CONSENT or not s.checkout_id or checkout_id != s.checkout_id:
        t.say("There's no order waiting for your go-ahead right now.")
        return
    co = tools.get_checkout(s.user_id, s.checkout_id)
    card = (co.get("payment_method") or {}).get("display")
    t.stage(Stage.PAYING)
    t.emit("payment_status", state="processing", payment=card)
    t.status("GreenLight", "Recording your consent and issuing a one-time payment token…")
    t.emit("payment_status", state="authorizing", payment=card)
    t.status("PayIt", "Running 12 security checks and authorizing payment…")
    try:
        result = await tools.confirm_and_pay(user, s.checkout_id)
    except CheckoutError as exc:
        t.emit("payment_status", state="failed", payment=card, reason=exc.code, message=exc.message)
        t.say(exc.message)
        t.emit("checkout_updated", checkout=tools.get_checkout(s.user_id, s.checkout_id))
        t.stage(Stage.AWAITING_CONSENT)
        return
    if result["status"] == "order_failed":           # authorized, then ShopSphere couldn't create the order
        t.emit("payment_status", state="failed", payment=card, reason=result["reason"], message=result["message"])
        t.say(result["message"])
        t.emit("checkout_updated", checkout=result["checkout"])
        t.stage(Stage.AWAITING_CONSENT)
        return
    if result["status"] != "authorized":
        t.emit("payment_status", state="declined", payment=card, reason=result["reason"], message=result["message"])
        t.say(f"Payment wasn't authorized: {result['message']} No order was created.")
        t.emit("checkout_updated", checkout=result["checkout"])
        t.stage(Stage.AWAITING_CONSENT)
        return
    order = result["order"]
    t.emit("payment_status", state="authorized", payment=card)
    t.status("TrackIt", f"Order {order['order_id']} confirmed.")
    bought = {ln["line_id"] for ln in co["lines"]}
    s.line_ids = [lid for lid in s.line_ids if lid not in bought]
    s.added_qty = {lid: q for lid, q in s.added_qty.items() if lid not in bought}
    s.checkout_id, s.order_id = None, order["order_id"]
    t.say(f"Your order is confirmed! Order {order['order_id']} arrives {order['delivery_date']}.")
    t.emit("order_confirmed", order=order)
    t.stage(Stage.ORDER_CONFIRMED)


# ── entry point ──────────────────────────────────────────────────────────────

PAGE_LEADS = {
    "women": "Browsing women's styles?", "men": "Browsing men's styles?", "shoes": "Looking for shoes?",
    "clothing": "Looking for clothing?", "accessories": "Looking for accessories?",
    "electronics": "Looking for electronics?", "new": "Checking out what's new?",
}


def greeting(s: Session, name: str) -> tuple[str, list[str], dict]:
    """A greeting that fits the page the shopper is on. Returns (text, chips,
    chip_actions) — a chip with an action triggers it instead of sending text."""
    page = s.page or {}
    if page.get("product_id"):
        product = tools.get_product(page["product_id"])
        if product:
            help_chip = "Help me choose a size & colour" if product["sizes"] else "Help me choose a colour"
            return (f"Hi {name} 👋 Looking at the {product['name']}? I can help you pick and add it to your cart.",
                    [help_chip, f"Is the {product['name']} good for everyday use?"],
                    {help_chip: {"type": "ask_about", "product_id": product["product_id"]}})
    if page.get("type") == "cart":
        return f"Hi {name} 👋 Need a hand with your cart?", SUGGESTIONS["home"], {}
    if page.get("type") == "orders":
        return f"Hi {name} 👋 Anything else I can find for you?", SUGGESTIONS["home"], {}
    dept = page.get("department")
    if dept in PAGE_LEADS:
        return f"Hi {name} 👋 {PAGE_LEADS[dept]} Tell me what you need.", SUGGESTIONS.get(dept, SUGGESTIONS["home"]), {}
    if page.get("query"):
        return f"Hi {name} 👋 Want help narrowing down “{page['query']}”?", SUGGESTIONS["home"], {}
    return f"Hi {name} 👋 How can I help you shop today?", SUGGESTIONS["home"], {}


async def run_turn(user: CurrentUser, session_id: str, *, text: Optional[str] = None,
                   action: Optional[dict] = None, page: Optional[dict] = None,
                   image_base64: Optional[str] = None) -> AsyncIterator[dict]:
    s = state.get(user.user_id, session_id)
    s.is_visitor = user.is_visitor
    if page is not None:
        s.page = page
    t = Turn(s)
    end = object()

    async def work():
        try:
            if action:
                await _handle_action(t, user, action)
            elif image_base64:
                await _handle_image(t, image_base64, (text or "").strip())
            elif text and text.strip():
                await _handle_text(t, text.strip())
        except Exception:  # never leave the panel hanging
            log.exception("talkshop turn failed")
            t.say("Sorry, something went wrong on my side. Please try again.")
        finally:
            t.queue.put_nowait(end)

    task = asyncio.create_task(work())
    try:
        while (ev := await t.queue.get()) is not end:
            yield ev
    finally:
        if not task.done():
            task.cancel()
    yield {"type": "done", "stage": s.stage.value, "step": STEPPER[s.stage]}


async def _handle_action(t: Turn, user: CurrentUser, action: dict) -> None:
    s, kind = t.s, action.get("type")
    if action.get("label"):          # what the shopper tapped, shown as their reply
        t.emit("user_message", text=str(action["label"])[:120])
        s.history.append({"role": "user", "text": str(action["label"])[:120]})
    if kind == "greet":
        name = "there" if user.is_visitor or not user.name else user.name.split()[0]
        text, chips, chip_actions = greeting(s, name)
        t.say(text)
        t.emit("suggestions", chips=chips, chip_actions=chip_actions)
    elif kind in ("select", "ask_about"):
        await _select(t, action.get("product_id", ""), from_page=(kind == "ask_about"))
    elif kind == "choose_size" and s.product_id:
        await _choose_size(t, str(action.get("value")))
    elif kind == "choose_color" and s.product_id:
        await _choose_color(t, str(action.get("value")))
    elif kind == "checkout" and s.allows("checkout"):
        await _checkout(t)
    elif kind == "keep_shopping":
        t.say("No problem — it's saved in your ShopSphere cart. What else can I find for you?")
        t.stage(Stage.IN_CART)
    elif kind == "update_checkout" and s.stage == Stage.AWAITING_CONSENT:
        await _update_checkout(t, action)
    elif kind == "details_added" and s.stage == Stage.CHECKOUT_DETAILS and s.checkout_id:
        await _details_added(t, action)
    elif kind == "cancel_checkout" and s.stage in (Stage.AWAITING_CONSENT, Stage.CHECKOUT_DETAILS):
        await _cancel_checkout(t)
    elif kind == "go_ahead":
        await _go_ahead(t, user, action.get("checkout_id"))
    else:
        t.say("That isn't available right now.")


async def _handle_image(t: Turn, image_base64: str, note: str) -> None:
    """A pasted photo: the LLM describes it, then a normal ShopSphere search."""
    s = t.s
    t.emit("user_message", text=note or "(photo)", image=True)
    s.history.append({"role": "user", "text": f"[photo] {note}".strip()})
    if s.stage == Stage.PAYING:
        return
    t.status("VibeCheck", "Looking at your photo…")
    args = await brain.describe_image(image_base64, note)
    if not args:
        t.say("I couldn't make out a product in that photo. Could you describe what you're looking for?")
        return
    args["gender"] = parse.gender_of(note)
    await _search(t, f"{args['query']} {note}".strip(), args)


async def _handle_text(t: Turn, text: str) -> None:
    s = t.s
    # Card details never enter the conversation: masked before the message is
    # shown, stored, guard-railed or read by the LLM.
    text, had_card = parse.redact_payment_data(text)
    if had_card:
        t.emit("user_message", text=text)
        s.history.append({"role": "user", "text": "[card details withheld]"})
        t.say("For your security I didn't keep that. Please never type card details in the chat.")
        if s.stage == Stage.CHECKOUT_DETAILS and s.checkout_id:
            return _ask_for_details(t, tools.get_checkout(s.user_id, s.checkout_id))
        t.say("When you check out, the Secure Payment form sends your card straight to ShopSphere's payment partner.")
        return
    if s.stage == Stage.CHECKOUT_DETAILS and s.checkout_id and parse.looks_like_address(text):
        t.emit("user_message", text="📍 (address hidden)")
        s.history.append({"role": "user", "text": "[address withheld]"})
        t.say("Thanks! To keep it safe, I don't take addresses in the chat.")
        return _ask_for_details(t, tools.get_checkout(s.user_id, s.checkout_id))
    t.emit("user_message", text=text)
    s.history.append({"role": "user", "text": text})

    from backend.guardrails.nemo import check_input
    allowed_input, block_msg = await check_input(text)
    if not allowed_input:
        t.say(block_msg or "I can only help with shopping at ShopSphere.")
        return

    # Fast, exact paths for predictable replies
    if s.stage == Stage.AWAITING_CONSENT and parse.sounds_like_payment(text):
        t.say("To place the order, tap GO AHEAD on the review card — I never charge from a typed message.")
        t.emit("checkout_ready", checkout=tools.get_checkout(s.user_id, s.checkout_id))
        return
    if s.stage in (Stage.OFFER_CHECKOUT, Stage.IN_CART):
        if parse.is_yes(text):
            return await _checkout(t)
        if parse.is_no(text):
            t.say("No problem — it's saved in your ShopSphere cart. What else can I find for you?")
            t.stage(Stage.IN_CART)
            return
    # Things ShopSphere doesn't sell at all: say so plainly — no unrelated
    # product cards. A mixed request still searches for the part we do sell.
    blocked = parse.not_sold(text) if s.allows("search") else None
    if blocked:
        label, word = blocked
        wanted = parse.search_intent(text)
        if not wanted:
            t.say(f"Sorry, ShopSphere doesn't sell {label}, so I can't find {word} for you. {NOT_SOLD_TAIL}")
            return
        t.status("VibeCheck", "Understanding your request…")
        return await _search(t, text, wanted, note=f"ShopSphere doesn't sell {label} like {word}, but here's the rest.")

    # Short replies ("10", "teal", "the first one") are read exactly. A message
    # that names a kind of product ("…can I get nike shoes in size 10") is never
    # taken as a quick answer to the question on screen.
    intent = parse.search_intent(text)
    if s.stage == Stage.RECOMMENDED and s.shown and not intent:
        idx = parse.pick_shown(text, [p["name"] for p in _shown_products(s)])
        if idx is not None:
            return await _select(t, s.shown[idx])
    if s.stage == Stage.ASK_SIZE and s.product_id and not intent:
        avail = tools.check_variant(s.product_id)
        size = parse.pick_size(text, [x["size"] for x in avail["sizes"]])
        if size:
            color = parse.pick_color(text, [c["name"] for c in avail["colors"]])
            await _choose_size(t, size)
            if color and s.stage == Stage.ASK_COLOR:      # "8 in black" answers both
                await _choose_color(t, color)
            return
    if s.stage == Stage.ASK_COLOR and s.product_id and not intent:
        color = parse.pick_color(text, [c["name"] for c in tools.check_variant(s.product_id)["colors"]])
        if color:
            return await _choose_color(t, color)

    # A clear product request needs no LLM round-trip to start searching. Mid-
    # question, only an unmistakable request skips the LLM; anything in between
    # ("size 10 shoes please") is the LLM's call — answer or new search.
    mid_question = s.stage in (Stage.RECOMMENDED, Stage.ASK_SIZE, Stage.ASK_COLOR)
    if s.allows("search") and intent and (not mid_question or parse.is_new_request(text)):
        t.status("VibeCheck", "Understanding your request…")
        return await _search(t, text, intent)

    # Everything else: the LLM chooses an action the stage allows
    t.status("VibeCheck", "Understanding your request…")
    allowed = sorted(state.ALLOWED[s.stage])
    decision = await brain.decide(text, stage=s.stage.value, allowed=allowed, context=_context(s), history=s.history)
    act, args = decision["action"], decision["args"]
    if act == "search":
        await _search(t, text, args)
    elif act == "select_product":
        idx = args.get("product_index")
        if isinstance(idx, int) and 0 <= idx < len(s.shown):
            await _select(t, s.shown[idx])
        elif s.page.get("product_id"):        # "I'll take this one" on a product page
            await _select(t, s.page["product_id"], from_page=True)
        else:
            t.say("Which one would you like? Tap Select on a card or say “the first one”.")
    elif act == "choose_option" and s.product_id:
        if args.get("size"):
            await _choose_size(t, str(args["size"]))
        if args.get("color_choice") and s.stage in (Stage.ASK_COLOR, Stage.PRODUCT_SELECTED):
            await _choose_color(t, str(args["color_choice"]))
    elif act == "checkout":
        await _checkout(t)
    elif act == "keep_shopping":
        t.say("No problem — it's saved in your ShopSphere cart. What else can I find for you?")
        t.stage(Stage.IN_CART)
    elif act == "update_checkout" and s.checkout_id:
        changes = {"delivery_method": args.get("delivery_method")}
        if args.get("quantity"):
            changes["quantities"] = {lid: int(args["quantity"]) for lid in s.line_ids[:1]}
        await _update_checkout(t, changes)
    elif act == "cancel_checkout":
        await _cancel_checkout(t)
    else:
        t.say(decision["reply"] or "Happy to help! What are you shopping for today?")
