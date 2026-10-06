"""
Talkshop's tools — thin wrappers over ShopSphere's merchant services
(backend/shop). The LLM chooses *which* of LLM_TOOLS should run; this code
runs it and returns exactly what the service returned.

confirm_and_pay is deliberately NOT in LLM_TOOLS: the orchestrator calls it
only for the shopper's GO AHEAD action, never from model output.
"""
from typing import Optional

from sqlalchemy.orm import Session

from backend.auth.dependencies import CurrentUser
from backend.db.init_db import get_engine
from backend.shop import cart as cart_service
from backend.shop import catalog
from backend.shop import checkout as checkout_service
from backend.shop import payment as payment_service

# Shown to the LLM so it can pick an action (orchestrator enforces stage rules).
LLM_TOOLS = {
    "search": "Search the ShopSphere catalog for products matching the shopper's request.",
    "select_product": "The shopper picked one of the products shown (or named a product).",
    "choose_option": "The shopper answered the size/option or colour question.",
    "checkout": "The shopper wants to proceed to checkout with the item(s) Talkshop added.",
    "keep_shopping": "The shopper doesn't want to check out yet.",
    "update_checkout": "Change delivery (standard/express), quantity, address or card on the review screen.",
    "cancel_checkout": "The shopper doesn't want to place this order.",
    "answer": "Answer a question or comment without changing anything.",
}


def _db() -> Session:
    return Session(get_engine())


# Department words the shopper might use, mapped to catalog filters.
_DEPARTMENTS = {"shoes": "shoes", "clothing": "clothing", "electronics": "electronics", "accessories": "accessories"}


def search_products(*, query: str, category: Optional[str] = None, brand: Optional[str] = None,
                    max_price: Optional[float] = None, gender: Optional[str] = None,
                    color: Optional[str] = None, limit: int = 3) -> dict:
    """Returns {"products": [...summaries], "brand_missing": bool, "relaxed": [...]}."""
    filters = {}
    if category in _DEPARTMENTS:
        filters["department"] = _DEPARTMENTS[category]
    elif category and category not in ("general", "chitchat"):
        filters["category"] = category
    with _db() as db:
        brand_missing = False
        if brand and not catalog.search(db, brand=brand):
            brand_missing, brand = True, None              # "we don't carry X — here are similar ones"
        products = catalog.search(db, q=query, brand=brand, max_price=max_price, gender=gender,
                                  color=color, limit=limit, **filters)
        relaxed = []
        if not products and color:                        # relax one filter at a time, say which
            products = catalog.search(db, q=query, brand=brand, max_price=max_price, gender=gender, limit=limit, **filters)
            if products:
                relaxed.append("color")
        if not products and max_price is not None:
            products = catalog.search(db, q=query, brand=brand, gender=gender, limit=limit, **filters)
            if products:
                relaxed.append("max_price")
        return {"products": [catalog.product_summary(p) for p in products],
                "brand_missing": brand_missing, "relaxed": relaxed}


def get_product(product_id: str) -> Optional[dict]:
    with _db() as db:
        p = catalog.get_product(db, product_id)
        return catalog.product_detail(p) if p else None


def check_variant(product_id: str, size: Optional[str] = None, color: Optional[str] = None) -> dict:
    with _db() as db:
        return catalog.availability(catalog.get_product(db, product_id), size=size, color=color)


def add_to_cart(user_id: str, sku: str, quantity: int = 1) -> tuple[dict, str]:
    with _db() as db:
        return cart_service.add_line(db, user_id, sku, quantity)


def get_cart(user_id: str) -> dict:
    with _db() as db:
        return cart_service.get_cart(db, user_id)


def create_checkout(user_id: str, line_ids: list[str], quantities: Optional[dict[str, int]] = None) -> dict:
    with _db() as db:
        return checkout_service.snapshot(db, checkout_service.create_checkout(db, user_id, line_ids, quantities))


def get_checkout(user_id: str, checkout_id: str) -> dict:
    with _db() as db:
        return checkout_service.snapshot(db, checkout_service.get_checkout(db, user_id, checkout_id))


def update_checkout(user_id: str, checkout_id: str, **changes) -> dict:
    with _db() as db:
        return checkout_service.snapshot(db, checkout_service.update_checkout(db, user_id, checkout_id, **changes))


def cancel_checkout(user_id: str, checkout_id: str) -> dict:
    with _db() as db:
        return checkout_service.snapshot(db, checkout_service.cancel_checkout(db, user_id, checkout_id))


async def confirm_and_pay(user: CurrentUser, checkout_id: str) -> dict:
    """Only ever called for the shopper's explicit GO AHEAD action."""
    return await payment_service.confirm(user, checkout_id, consent=True)
