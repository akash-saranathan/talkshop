"""
Checkout — builds the one canonical checkout snapshot the customer reviews.

Everything that decides the charge lives here on the server: lines at live
catalog prices, the shipping address, delivery option and date, tax, total,
and the saved card. The browser or Talkshop can ask for changes (quantity,
delivery, address, card) but never sends amounts; confirm() charges exactly
what this module last calculated and hashed.
"""
import hashlib
import re
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import Address, CartItem, Checkout, PaymentMethod, Product, ProductVariant, User, Wallet
from backend.payment.policy import TAX_RATE
from backend.shop.profile import address_dict, card_dict, list_addresses, list_cards

EXPRESS_PRICE = 9.99
EXPRESS_DAYS = 2
DELIVERY_LABELS = {"standard": "Standard", "express": "Express"}


class CheckoutError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, detail: Optional[dict] = None):
        super().__init__(message)
        self.code, self.message, self.status, self.detail = code, message, status, detail or {}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def delivery_dates(standard_days: int) -> dict[str, date]:
    today = _today()
    express_days = max(1, min(EXPRESS_DAYS, standard_days - 1))
    return {"standard": today + timedelta(days=standard_days), "express": today + timedelta(days=express_days)}


def _lines(co: Checkout) -> list[dict]:
    return json.loads(co.lines_json)


def _hash(co: Checkout, lines: list[dict]) -> str:
    canonical = {
        "checkout_id": co.checkout_id, "user_id": co.user_id,
        "lines": [[ln["sku"], ln["quantity"], ln["unit_price"]] for ln in lines],
        "address_id": co.address_id, "delivery_method": co.delivery_method,
        "payment_method_id": co.payment_method_id, "pay_with": co.pay_with or "card",
        "guest_email": co.guest_email,
        "subtotal": co.subtotal, "tax": co.tax, "shipping": co.shipping, "total": co.total, "currency": co.currency,
    }
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


def _recalculate(db: Session, co: Checkout) -> list[dict]:
    """Refresh lines from the live catalog and recompute every amount + the hash.
    Returns the stock issues found (empty list = all lines can be fulfilled)."""
    lines, issues = _lines(co), []
    for ln in lines:
        product = db.query(Product).filter_by(product_id=ln["product_id"]).first()
        variant = db.query(ProductVariant).filter_by(sku=ln["sku"]).first()
        if product:
            ln["unit_price"] = product.price
            ln["delivery_days"] = product.delivery_days
        ln["line_total"] = round(ln["unit_price"] * ln["quantity"], 2)
        ln["stock"] = variant.stock if variant else 0
        if ln["stock"] < ln["quantity"]:
            issues.append({"code": "OUT_OF_STOCK", "sku": ln["sku"], "name": ln["name"],
                           "requested": ln["quantity"], "available": ln["stock"]})
    co.lines_json = json.dumps(lines)
    co.subtotal = round(sum(ln["line_total"] for ln in lines), 2)
    co.tax = round(co.subtotal * TAX_RATE, 2)
    co.shipping = EXPRESS_PRICE if co.delivery_method == "express" else 0.0
    co.total = round(co.subtotal + co.tax + co.shipping, 2)
    std_days = max((ln.get("delivery_days") or 5) for ln in lines)
    co.delivery_date = datetime.combine(delivery_dates(std_days)[co.delivery_method], datetime.min.time())
    co.checkout_hash = _hash(co, lines)
    return issues


def is_guest_owner(db: Session, user_id: str) -> bool:
    """A checkout owned by an anonymous visitor session is a guest checkout."""
    u = db.query(User).filter_by(user_id=user_id).first()
    return bool(u and u.is_guest)


def create_checkout(db: Session, user_id: str, line_ids: list[str],
                    quantities: Optional[dict[str, int]] = None) -> Checkout:
    """A checkout for the chosen cart lines (the website's selected items, or
    the item(s) Talkshop added in this conversation). `quantities` buys fewer
    than the cart holds — Talkshop buys what it added in this chat, even if
    the same item was already in the cart."""
    if not line_ids:
        raise CheckoutError("NO_ITEMS", "Choose at least one item to check out.")
    items = db.query(CartItem).filter(CartItem.user_id == user_id, CartItem.cart_item_id.in_(line_ids)).all()
    if len(items) != len(set(line_ids)):
        raise CheckoutError("UNKNOWN_LINE", "Some of those items aren't in your cart.", 404)
    if any(it.sku is None for it in items):
        raise CheckoutError("NO_SKU", "Pick a size and colour for every item before checkout.")
    lines = []
    for it in items:
        product = db.query(Product).filter_by(product_id=it.product_id).first()
        variant = db.query(ProductVariant).filter_by(sku=it.sku).first()
        lines.append({
            "line_id": it.cart_item_id, "sku": it.sku, "product_id": it.product_id,
            "name": product.name if product else it.title, "brand": it.brand,
            "size": it.size, "color": it.color,
            "option_label": (product.option_label if product else None) or "Size",
            "quantity": max(1, min(it.quantity, (quantities or {}).get(it.cart_item_id, it.quantity))),
            "unit_price": product.price if product else it.price,
            "image_url": (variant.image_url if variant else None) or it.image_url,
            "delivery_days": product.delivery_days if product else it.delivery_days,
        })
    addresses, cards = list_addresses(db, user_id), list_cards(db, user_id)
    co = Checkout(
        checkout_id=f"CHK_{uuid.uuid4().hex[:10].upper()}", user_id=user_id, status="open",
        lines_json=json.dumps(lines), cart_item_ids=",".join(it.cart_item_id for it in items),
        address_id=addresses[0].address_id if addresses else None,
        payment_method_id=cards[0].payment_method_id if cards else None,
        delivery_method="standard", currency="USD", pay_with="card",
    )
    _recalculate(db, co)
    db.add(co)
    db.commit()
    return co


def get_checkout(db: Session, user_id: str, checkout_id: str) -> Checkout:
    co = db.query(Checkout).filter_by(checkout_id=checkout_id, user_id=user_id).first()
    if not co:
        raise CheckoutError("UNKNOWN_CHECKOUT", "Checkout not found.", 404)
    return co


def update_checkout(db: Session, user_id: str, checkout_id: str, *, delivery_method: Optional[str] = None,
                    address_id: Optional[str] = None, payment_method_id: Optional[str] = None,
                    pay_with: Optional[str] = None,
                    quantities: Optional[dict[str, int]] = None) -> Checkout:
    """Changes made on the review screen. Only an open checkout can change."""
    co = get_checkout(db, user_id, checkout_id)
    if co.status != "open":
        raise CheckoutError("CHECKOUT_CLOSED", f"This checkout is {co.status} and can't be changed.", 409)
    if delivery_method is not None:
        if delivery_method not in DELIVERY_LABELS:
            raise CheckoutError("INVALID_DELIVERY", "Delivery must be standard or express.")
        co.delivery_method = delivery_method
    if address_id is not None:
        if not db.query(Address).filter_by(address_id=address_id, user_id=user_id).first():
            raise CheckoutError("UNKNOWN_ADDRESS", "That address isn't saved on your account.", 404)
        co.address_id = address_id
    if payment_method_id is not None:
        if not db.query(PaymentMethod).filter_by(payment_method_id=payment_method_id, user_id=user_id).first():
            raise CheckoutError("UNKNOWN_CARD", "That card isn't saved on your account.", 404)
        co.payment_method_id = payment_method_id
        co.pay_with = "card"
    if pay_with is not None:
        if pay_with not in ("card", "wallet"):
            raise CheckoutError("INVALID_PAYMENT", "Pay with a card or your ShopSphere Wallet.")
        if pay_with == "wallet" and (is_guest_owner(db, user_id)
                                     or not db.query(Wallet).filter_by(user_id=user_id).first()):
            raise CheckoutError("WALLET_UNAVAILABLE", "The ShopSphere Wallet is for customers with an account.", 403)
        co.pay_with = pay_with
    if quantities:
        lines = _lines(co)
        by_id = {ln["line_id"]: ln for ln in lines}
        for line_id, qty in quantities.items():
            if line_id not in by_id:
                raise CheckoutError("UNKNOWN_LINE", "That item isn't part of this checkout.", 404)
            if qty < 1:
                raise CheckoutError("INVALID_QUANTITY", "Quantity must be at least 1.")
            by_id[line_id]["quantity"] = qty
        co.lines_json = json.dumps(lines)
    _recalculate(db, co)
    db.commit()
    return co


def reassign(db: Session, user_id: str, field: str, old_id: str, new_id: Optional[str]) -> None:
    """A saved address/card was deleted: open checkouts that used it switch to
    the customer's default (or to none, so checkout asks for one again)."""
    for co in db.query(Checkout).filter_by(user_id=user_id, status="open").filter(getattr(Checkout, field) == old_id):
        setattr(co, field, new_id)
        _recalculate(db, co)
    db.commit()


_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")


def set_guest_details(db: Session, user_id: str, checkout_id: str, *, full_name: str, email: str, line1: str,
                      city: str, state: str, postal_code: str, line2: Optional[str] = None) -> Checkout:
    """Guest checkout: who to ship to and where to send the confirmation. The
    address is kept for this order only; no customer account is created."""
    from backend.shop import profile
    co = get_checkout(db, user_id, checkout_id)
    if co.status != "open":
        raise CheckoutError("CHECKOUT_CLOSED", f"This checkout is {co.status} and can't be changed.", 409)
    if not is_guest_owner(db, user_id):
        raise CheckoutError("NOT_GUEST", "You're logged in, so this order uses your account details.", 400)
    email = (email or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 255:
        raise CheckoutError("INVALID_EMAIL", "Please enter a valid email address, like you@example.com.")
    try:
        address = profile.add_address(db, user_id, full_name=full_name, line1=line1, line2=line2, city=city,
                                      state=state, postal_code=postal_code, label="Shipping", make_default=True)
    except profile.ProfileError as exc:
        raise CheckoutError(exc.code, exc.message, exc.status)
    co.address_id, co.guest_email, co.guest_name = address.address_id, email, address.full_name
    _recalculate(db, co)
    db.commit()
    return co


def cancel_checkout(db: Session, user_id: str, checkout_id: str) -> Checkout:
    co = get_checkout(db, user_id, checkout_id)
    if co.status in ("open", "consented"):
        co.status = "cancelled"
        db.commit()
    return co


def refresh(db: Session, co: Checkout) -> list[dict]:
    """Re-check prices and stock right before payment (no commit)."""
    return _recalculate(db, co)


def snapshot(db: Session, co: Checkout, issues: Optional[list[dict]] = None) -> dict:
    """The full review-screen view of a checkout."""
    lines = _lines(co)
    if issues is None:
        issues = [{"code": "OUT_OF_STOCK", "sku": ln["sku"], "name": ln["name"],
                   "requested": ln["quantity"], "available": ln.get("stock", 0)}
                  for ln in lines if ln.get("stock", 0) < ln["quantity"]]
    address = db.query(Address).filter_by(address_id=co.address_id).first() if co.address_id else None
    card = db.query(PaymentMethod).filter_by(payment_method_id=co.payment_method_id).first() if co.payment_method_id else None
    guest = is_guest_owner(db, co.user_id)
    wallet = None if guest else db.query(Wallet).filter_by(user_id=co.user_id).first()
    on_wallet = (co.pay_with == "wallet") and wallet is not None
    problems = list(issues)
    if guest and not co.guest_email:
        problems.append({"code": "NO_GUEST_DETAILS", "message": "Add your name, email and shipping address."})
    if not address:
        problems.append({"code": "NO_ADDRESS", "message": "Add a shipping address."})
    if on_wallet:
        if wallet.balance < co.total:
            problems.append({"code": "INSUFFICIENT_WALLET", "message": "Your wallet balance doesn't cover this order."})
    elif not card:
        problems.append({"code": "NO_PAYMENT_METHOD", "message": "Add a payment card."})
    wallet_view = ({"payment_method_id": "wallet", "type": "wallet", "display": "ShopSphere Wallet",
                    "balance": round(wallet.balance, 2), "enough": wallet.balance >= co.total} if wallet else None)
    std_days = max((ln.get("delivery_days") or 5) for ln in lines)
    dates = delivery_dates(std_days)
    return {
        "checkout_id": co.checkout_id,
        "status": co.status,
        "lines": [{k: v for k, v in ln.items() if k != "stock"} | {"in_stock": ln.get("stock", 0) >= ln["quantity"]}
                  for ln in lines],
        "item_count": sum(ln["quantity"] for ln in lines),
        "subtotal": co.subtotal, "tax": co.tax, "tax_rate": TAX_RATE, "shipping": co.shipping,
        "total": co.total, "currency": co.currency,
        "delivery": {
            "method": co.delivery_method,
            "date": co.delivery_date.date().isoformat() if co.delivery_date else None,
            "options": [
                {"method": "standard", "label": "Standard", "price": 0.0, "date": dates["standard"].isoformat()},
                {"method": "express", "label": "Express", "price": EXPRESS_PRICE, "date": dates["express"].isoformat()},
            ],
        },
        "address": address_dict(address) if address else None,
        "payment_method": wallet_view if on_wallet else (card_dict(card) if card else None),
        "pay_with": "wallet" if on_wallet else "card",
        "wallet": wallet_view,
        "guest": {"email": co.guest_email, "name": co.guest_name} if guest else None,
        "saved_addresses": [] if guest else [address_dict(a) for a in list_addresses(db, co.user_id)],
        "saved_payment_methods": [] if guest else [card_dict(c) for c in list_cards(db, co.user_id)],
        "issues": problems,
        "ready": not problems,
        "checkout_hash": co.checkout_hash,
    }
