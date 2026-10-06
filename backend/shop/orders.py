"""
Order service — finalizes a purchase only after payment is authorized:
public order id (SS-#####), order lines, address and masked-card snapshots,
delivery date, stock committed, purchased lines removed from the cart.
"""
import json
import random
from typing import Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from backend.db.schema import Address, CartItem, Checkout, Order, OrderLine, PaymentMethod, Product, ProductVariant
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
    order.payment_brand, order.payment_last4 = (card.brand, card.last4) if card else (None, None)
    order.payment_status = "authorized"

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

    bought = [i for i in (co.cart_item_ids or "").split(",") if i]
    if bought:
        db.query(CartItem).filter(CartItem.user_id == co.user_id,
                                  CartItem.cart_item_id.in_(bought)).delete(synchronize_session=False)
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
        "payment": ({"brand": order.payment_brand, "last4": order.payment_last4,
                     "display": f"{order.payment_brand} •••• {order.payment_last4}"}
                    if order.payment_last4 else None),
        "tracking_number": order.tracking_number,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


def find_order(db: Session, user_id: str, order_id: str) -> Optional[Order]:
    """Look up by public id (SS-48291) or internal id."""
    return (db.query(Order).filter(Order.user_id == user_id)
            .filter((Order.display_id == order_id) | (Order.order_id == order_id)).first())
