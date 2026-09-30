"""
Local SQLite merchant adapter — Tier 1, always available.
Reads from the seeded products table. Never fails.
"""
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.db.schema import Product, Merchant
from backend.models.product import NormalizedProduct

DB_PATH = Path(__file__).parent.parent / "db" / "commerce.db"


def _get_session() -> Session:
    engine = create_engine(f"sqlite:///{DB_PATH}")
    return Session(engine)


def search_products(
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    size: Optional[str] = None,
    merchant_id: Optional[str] = None,
) -> list[NormalizedProduct]:
    """Search the local catalog. Returns NormalizedProduct list."""
    with _get_session() as session:
        query = session.query(Product, Merchant).join(
            Merchant, Product.merchant_id == Merchant.merchant_id
        )
        if category:
            query = query.filter(Product.category == category)
        if brand:
            query = query.filter(Product.brand.ilike(f"%{brand}%"))
        if max_price is not None:
            query = query.filter(Product.price <= max_price)
        if size:
            query = query.filter(Product.size == size)
        if merchant_id:
            query = query.filter(Product.merchant_id == merchant_id)

        rows = query.all()
        results = []
        for product, merchant in rows:
            results.append(NormalizedProduct(
                merchant_id=product.merchant_id,
                merchant_name=merchant.merchant_name,
                product_id=product.product_id,
                title=product.name,
                brand=product.brand,
                category=product.category,
                price=product.price,
                currency=product.currency or "USD",
                size=product.size,
                color=product.color,
                available=product.inventory > 0,
                inventory=product.inventory,
                delivery_days=product.delivery_days or 5,
                weight_grams=product.weight_grams,
                cushioning=product.cushioning,
                rating=product.rating or 0.0,
                review_count=product.review_count or 0,
                shipping_cost=0.0,
                image_url=product.image_url,
                source="local",
            ))
        return results


def get_product(product_id: str) -> Optional[NormalizedProduct]:
    """Fetch a single product by ID."""
    with _get_session() as session:
        row = (
            session.query(Product, Merchant)
            .join(Merchant, Product.merchant_id == Merchant.merchant_id)
            .filter(Product.product_id == product_id)
            .first()
        )
        if not row:
            return None
        product, merchant = row
        return NormalizedProduct(
            merchant_id=product.merchant_id,
            merchant_name=merchant.merchant_name,
            product_id=product.product_id,
            title=product.name,
            brand=product.brand,
            category=product.category,
            price=product.price,
            currency=product.currency or "USD",
            size=product.size,
            color=product.color,
            available=product.inventory > 0,
            inventory=product.inventory,
            delivery_days=product.delivery_days or 5,
            weight_grams=product.weight_grams,
            cushioning=product.cushioning,
            rating=product.rating or 0.0,
            review_count=product.review_count or 0,
            shipping_cost=0.0,
            image_url=product.image_url,
            source="local",
        )
