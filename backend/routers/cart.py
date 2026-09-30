"""
Cart router — lets a user collect products from chat before checking out.
Each row is a snapshot of the product at add-time (see CartItem in schema.py
for why), not a live join against the products table.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.db.schema import CartItem
from backend.db.session_utils import get_session

router = APIRouter()


class AddCartItemRequest(BaseModel):
    product_id: str
    merchant_id: str
    merchant_name: str
    title: str
    brand: str | None = None
    category: str
    price: float
    currency: str = "USD"
    size: str | None = None
    color: str | None = None
    image_url: str | None = None
    rating: float = 0.0
    delivery_days: int = 5
    quantity: int = 1


class UpdateCartItemRequest(BaseModel):
    quantity: int


def _serialize(item: CartItem) -> dict:
    return {
        "cart_item_id": item.cart_item_id,
        "product_id": item.product_id,
        "merchant_id": item.merchant_id,
        "merchant_name": item.merchant_name,
        "title": item.title,
        "brand": item.brand,
        "category": item.category,
        "price": item.price,
        "currency": item.currency,
        "size": item.size,
        "color": item.color,
        "image_url": item.image_url,
        "rating": item.rating,
        "delivery_days": item.delivery_days,
        "quantity": item.quantity,
        "added_at": item.added_at.isoformat() if item.added_at else None,
    }


@router.post("/api/cart/items")
async def add_cart_item(req: AddCartItemRequest, current_user: CurrentUser = Depends(get_current_user)):
    """Adds a product to the cart, or bumps quantity if it's already there."""
    with get_session() as session:
        existing = (
            session.query(CartItem)
            .filter(
                CartItem.user_id == current_user.user_id,
                CartItem.product_id == req.product_id,
                CartItem.merchant_id == req.merchant_id,
            )
            .first()
        )
        if existing:
            existing.quantity += req.quantity
            session.commit()
            return _serialize(existing)

        item = CartItem(
            cart_item_id=f"CART_{uuid.uuid4().hex[:10].upper()}",
            user_id=current_user.user_id,
            product_id=req.product_id,
            merchant_id=req.merchant_id,
            merchant_name=req.merchant_name,
            title=req.title,
            brand=req.brand,
            category=req.category,
            price=req.price,
            currency=req.currency,
            size=req.size,
            color=req.color,
            image_url=req.image_url,
            rating=req.rating,
            delivery_days=req.delivery_days,
            quantity=req.quantity,
        )
        session.add(item)
        session.commit()
        return _serialize(item)


@router.get("/api/cart")
async def list_cart_items(current_user: CurrentUser = Depends(get_current_user)):
    with get_session() as session:
        items = (
            session.query(CartItem)
            .filter(CartItem.user_id == current_user.user_id)
            .order_by(CartItem.added_at.desc())
            .all()
        )
        return [_serialize(i) for i in items]


@router.patch("/api/cart/items/{cart_item_id}")
async def update_cart_item(
    cart_item_id: str,
    req: UpdateCartItemRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    if req.quantity < 1:
        raise HTTPException(status_code=422, detail="Quantity must be at least 1")
    with get_session() as session:
        item = (
            session.query(CartItem)
            .filter(CartItem.cart_item_id == cart_item_id, CartItem.user_id == current_user.user_id)
            .first()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Cart item not found")
        item.quantity = req.quantity
        session.commit()
        return _serialize(item)


@router.delete("/api/cart/items/{cart_item_id}")
async def delete_cart_item(cart_item_id: str, current_user: CurrentUser = Depends(get_current_user)):
    with get_session() as session:
        item = (
            session.query(CartItem)
            .filter(CartItem.cart_item_id == cart_item_id, CartItem.user_id == current_user.user_id)
            .first()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Cart item not found")
        session.delete(item)
        session.commit()
        return {"ok": True}
