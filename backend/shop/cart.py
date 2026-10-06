"""
ShopSphere cart — owned by the merchant backend, never by the chat.
Lines are SKU-based (an exact size + colour). Every change returns the full
cart with live catalog prices and stock, so the website badge, the cart page
and Talkshop all show the same thing.
"""
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import CartItem, Merchant, Product, ProductVariant


class CartError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _line(item: CartItem, variant: Optional[ProductVariant], product: Optional[Product]) -> dict:
    price = product.price if product else item.price          # live ShopSphere price
    stock = variant.stock if variant else 0
    return {
        "line_id": item.cart_item_id,
        "sku": item.sku,
        "product_id": item.product_id,
        "name": product.name if product else item.title,
        "brand": product.brand if product else item.brand,
        "size": item.size,
        "color": item.color,
        "option_label": (product.option_label if product else None) or "Size",
        "quantity": item.quantity,
        "unit_price": price,
        "line_total": round(price * item.quantity, 2),
        "image_url": (variant.image_url if variant else None) or item.image_url,
        "delivery_days": product.delivery_days if product else item.delivery_days,
        "stock": stock,
        "in_stock": stock >= item.quantity,
    }


def get_cart(db: Session, user_id: str) -> dict:
    items = (db.query(CartItem).filter(CartItem.user_id == user_id, CartItem.sku.isnot(None))
             .order_by(CartItem.added_at.asc(), CartItem.id.asc()).all())
    lines = []
    for it in items:
        variant = db.query(ProductVariant).filter_by(sku=it.sku).first()
        product = db.query(Product).filter_by(product_id=it.product_id).first()
        lines.append(_line(it, variant, product))
    return {
        "lines": lines,
        "item_count": sum(line["quantity"] for line in lines),
        "subtotal": round(sum(line["line_total"] for line in lines), 2),
        "currency": "USD",
    }


def add_line(db: Session, user_id: str, sku: str, quantity: int = 1) -> tuple[dict, str]:
    """Add a SKU (merging with an existing line for it). Returns (cart, line_id)."""
    if quantity < 1:
        raise CartError("INVALID_QUANTITY", "Quantity must be at least 1.")
    variant = db.query(ProductVariant).filter_by(sku=sku).first()
    if not variant:
        raise CartError("UNKNOWN_SKU", f"No product variant {sku}.", 404)
    product = db.query(Product).filter_by(product_id=variant.product_id).first()
    existing = db.query(CartItem).filter_by(user_id=user_id, sku=sku).first()
    wanted = quantity + (existing.quantity if existing else 0)
    if variant.stock < wanted:
        raise CartError("OUT_OF_STOCK",
                        f"Only {variant.stock} left of {product.name} ({variant.size or 'one size'}, {variant.color}).", 409)
    if existing:
        existing.quantity = wanted
        line_id = existing.cart_item_id
    else:
        merchant = db.query(Merchant).filter_by(merchant_id=product.merchant_id).first()
        line_id = f"CART_{uuid.uuid4().hex[:10].upper()}"
        db.add(CartItem(
            cart_item_id=line_id, user_id=user_id, sku=sku,
            product_id=product.product_id, merchant_id=product.merchant_id,
            merchant_name=merchant.merchant_name if merchant else product.merchant_id,
            title=product.name, brand=product.brand, category=product.category,
            price=product.price, currency=product.currency or "USD",
            size=variant.size, color=variant.color, image_url=variant.image_url,
            rating=product.rating, delivery_days=product.delivery_days, quantity=quantity,
        ))
    db.commit()
    return get_cart(db, user_id), line_id


def _own_line(db: Session, user_id: str, line_id: str) -> CartItem:
    item = db.query(CartItem).filter_by(cart_item_id=line_id, user_id=user_id).first()
    if not item:
        raise CartError("UNKNOWN_LINE", "That item isn't in your cart.", 404)
    return item


def set_quantity(db: Session, user_id: str, line_id: str, quantity: int) -> dict:
    item = _own_line(db, user_id, line_id)
    if quantity < 1:
        db.delete(item)
    else:
        variant = db.query(ProductVariant).filter_by(sku=item.sku).first() if item.sku else None
        if variant is not None and variant.stock < quantity:
            raise CartError("OUT_OF_STOCK", f"Only {variant.stock} left in that size and colour.", 409)
        item.quantity = quantity
    db.commit()
    return get_cart(db, user_id)


def remove_line(db: Session, user_id: str, line_id: str) -> dict:
    db.delete(_own_line(db, user_id, line_id))
    db.commit()
    return get_cart(db, user_id)


def merge_carts(db: Session, from_user: str, to_user: str) -> dict[str, str]:
    """Move a visitor's cart into a customer's (no commit). Same SKU → the
    quantities add up, capped by stock. Returns old line id → new line id."""
    mapping: dict[str, str] = {}
    for item in db.query(CartItem).filter(CartItem.user_id == from_user).all():
        existing = (db.query(CartItem).filter_by(user_id=to_user, sku=item.sku).first()
                    if item.sku else None)
        if existing:
            variant = db.query(ProductVariant).filter_by(sku=item.sku).first()
            cap = variant.stock if variant else existing.quantity + item.quantity
            existing.quantity = max(existing.quantity, min(existing.quantity + item.quantity, cap))
            mapping[item.cart_item_id] = existing.cart_item_id
            db.delete(item)
        else:
            item.user_id = to_user
            mapping[item.cart_item_id] = item.cart_item_id
    return mapping
