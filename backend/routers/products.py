from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.db.init_db import get_engine
from backend.db.schema import Product

router = APIRouter(prefix="/api/products", tags=["products"])


def get_db():
    engine = get_engine()
    with Session(engine) as session:
        yield session


def _product_to_dict(p: Product) -> dict:
    return {
        "product_id": p.product_id,
        "merchant_id": p.merchant_id,
        "name": p.name,
        "brand": p.brand,
        "category": p.category,
        "size": p.size,
        "color": p.color,
        "price": p.price,
        "currency": p.currency,
        "inventory": p.inventory,
        "available": p.inventory > 0,
        "delivery_days": p.delivery_days,
        "weight_grams": p.weight_grams,
        "cushioning": p.cushioning,
        "rating": p.rating,
        "review_count": p.review_count,
    }


@router.get("")
def list_products(
    category: Optional[str] = Query(None),
    merchant_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Product)
    if category:
        q = q.filter(Product.category == category)
    if merchant_id:
        q = q.filter(Product.merchant_id == merchant_id)
    return [_product_to_dict(p) for p in q.all()]


@router.get("/{product_id}")
def get_product(product_id: str, db: Session = Depends(get_db)):
    p = db.query(Product).filter_by(product_id=product_id).first()
    if not p:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_to_dict(p)
