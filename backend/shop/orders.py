"""
Order service — finalizes a purchase only after payment is authorized:
public order id (SS-#####), order lines, address and masked-card snapshots,
delivery date, stock committed, purchased lines removed from the cart.
"""
import hmac
import json
import random
from typing import Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from backend.db.schema import Address, CartItem, Checkout, Order, OrderLine, PaymentMethod, Product, ProductVariant, User
from backend.shop import shipping
from backend.shop.profile import address_dict


def new_display_id(db: Session) -> str:
    while True:
        candidate = f"SS-{random.randint(10000, 99999)}"
        if not db.query(Order).filter_by(display_id=candidate).first():
            return candidate


def finalize(db: Session, co: Checkout, payment_ref: str) -> Order:
    """Turn the authorized payment's order row into the full ShopSphere order."""
    order = db.query(Order).filter_by(order_id=payment_ref).one()
    lines = json.loads(co.lines_json)
    address = db.query(Address).filter_by(address_id=co.address_id).first()
    card = db.query(PaymentMethod).filter_by(payment_method_id=co.payment_method_id).first()

    order.display_id = new_display_id(db)
    order.checkout_id = co.checkout_id
    order.subtotal, order.tax, order.shipping = co.subtotal, co.tax, co.shipping
    order.amount = co.total
    order.delivery_method, order.delivery_date = co.delivery_method, co.delivery_date
    order.ship_to_json = json.dumps(address_dict(address)) if address else None
    order.payment_method_type = co.pay_with or "card"
    if order.payment_method_type == "wallet":
        order.payment_brand, order.payment_last4 = "ShopSphere Wallet", None
    else:
        order.payment_brand, order.payment_last4 = (card.brand, card.last4) if card else (None, None)
    order.payment_status = "authorized"
    # Guest order: the checkout email/name, never a customer account (Phase 10)
    order.guest_email, order.guest_name = co.guest_email, co.guest_name
    shipping.start(order)

    for ln in lines:
        db.add(OrderLine(
            order_id=order.order_id, sku=ln["sku"], product_id=ln["product_id"], product_name=ln["name"],
            size=ln.get("size"), color=ln.get("color"), quantity=ln["quantity"],
            unit_price=ln["unit_price"], line_total=round(ln["unit_price"] * ln["quantity"], 2),
            image_url=ln.get("image_url"),
        ))
        # Commit stock: guarded decrement so a concurrent sale can't push it negative.
        db.execute(update(ProductVariant)
                   .where(ProductVariant.sku == ln["sku"], ProductVariant.stock >= ln["quantity"])
                   .values(stock=ProductVariant.stock - ln["quantity"]))
        product = db.query(Product).filter_by(product_id=ln["product_id"]).first()
        if product:
            product.inventory = max(0, (product.inventory or 0) - ln["quantity"])

    # Take what was bought out of the cart: the line goes if all of it was
    # bought, otherwise it keeps the remainder (e.g. one of two pairs).
    for ln in lines:
        item = db.query(CartItem).filter_by(cart_item_id=ln.get("line_id"), user_id=co.user_id).first()
        if item:
            if item.quantity > ln["quantity"]:
                item.quantity -= ln["quantity"]
            else:
                db.delete(item)
    co.status = "paid"
    db.commit()
    return order


def order_dict(db: Session, order: Order) -> dict:
    lines = db.query(OrderLine).filter_by(order_id=order.order_id).order_by(OrderLine.id).all()
    return {
        "order_id": order.display_id or order.order_id,
        "internal_order_id": order.order_id,
        "status": "confirmed" if order.status == "confirmed" else order.status,
        "payment_status": order.payment_status,
        "lines": [{"sku": ln.sku, "product_id": ln.product_id, "name": ln.product_name, "size": ln.size,
                   "color": ln.color, "quantity": ln.quantity, "unit_price": ln.unit_price,
                   "line_total": ln.line_total, "image_url": ln.image_url} for ln in lines],
        "subtotal": order.subtotal, "tax": order.tax, "shipping": order.shipping, "total": order.amount,
        "currency": order.currency,
        "delivery_method": order.delivery_method,
        "delivery_date": order.delivery_date.date().isoformat() if order.delivery_date else None,
        "ship_to": json.loads(order.ship_to_json) if order.ship_to_json else None,
        "payment": _payment_view(order),
        "payment_method_type": order.payment_method_type or "card",
        "guest": bool(order.guest_email),
        "guest_email": order.guest_email,
        "shipment": shipping.view(order),
        "tracking_number": order.tracking_number,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


def _payment_view(order: Order) -> Optional[dict]:
    if order.payment_method_type == "wallet":
        return {"brand": "ShopSphere Wallet", "last4": None, "display": "ShopSphere Wallet"}
    if order.payment_last4:
        return {"brand": order.payment_brand, "last4": order.payment_last4,
                "display": f"{order.payment_brand} •••• {order.payment_last4}"}
    return None


NOT_FOUND = "We could not find an order matching the provided Order ID and email address."


def find_for_tracking(db: Session, order_id: str, email: str) -> Optional[Order]:
    """Order ID + the email used for it (guest checkout email, or the customer's
    account email). Any mismatch looks the same as a missing order."""
    order = db.query(Order).filter(Order.display_id == (order_id or "").strip().upper()).first()
    given = (email or "").strip().lower()
    expected = ""
    if order is not None:
        if order.guest_email:
            expected = order.guest_email.lower()
        else:
            owner = db.query(User).filter_by(user_id=order.user_id).first()
            expected = (owner.email or "").lower() if owner and not owner.is_guest else ""
    ok = hmac.compare_digest(given.encode(), expected.encode()) if expected else False
    return order if (order is not None and given and ok) else None


def tracking_view(db: Session, order: Order) -> dict:
    """What Track Order shows: no full address, no card details, no internal ids."""
    d = order_dict(db, order)
    ship_to = d["ship_to"] or {}
    return {
        "order_id": d["order_id"], "status": d["status"], "payment_status": d["payment_status"],
        "lines": [{k: ln[k] for k in ("name", "size", "color", "quantity", "line_total", "image_url")}
                  for ln in d["lines"]],
        "subtotal": d["subtotal"], "tax": d["tax"], "shipping": d["shipping"], "total": d["total"],
        "delivery_method": d["delivery_method"], "delivery_date": d["delivery_date"],
        "ship_to": {"city": ship_to.get("city"), "state": ship_to.get("state")},
        "payment": d["payment"], "guest": d["guest"], "shipment": d["shipment"],
        "created_at": d["created_at"],
    }


def find_order(db: Session, user_id: str, order_id: str) -> Optional[Order]:
    """Look up by public id (SS-48291) or internal id."""
    return (db.query(Order).filter(Order.user_id == user_id)
            .filter((Order.display_id == order_id) | (Order.order_id == order_id)).first())
