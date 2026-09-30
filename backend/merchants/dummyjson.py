"""
DummyJSON product adapter — free public API, no key required.
https://dummyjson.com/docs/products

Used as a supplementary source to widen the catalog beyond the local seed
data. Returns at most 20 results per call; tolerates all failure modes
silently so a network issue never breaks the shopping flow.
"""
import asyncio
from typing import Optional

import httpx

from backend.models.product import NormalizedProduct

_BASE = "https://dummyjson.com"
_TIMEOUT = 5.0

# Maps DummyJSON categories → canonical categories used in this app.
# DummyJSON uses its own lowercase-kebab category names.
_CAT_MAP: dict[str, str] = {
    "smartphones":          "phones",
    "laptops":              "laptops",
    "fragrances":           "accessories",
    "skincare":             "accessories",
    "groceries":            "general",
    "home-decoration":      "accessories",
    "furniture":            "accessories",
    "tops":                 "clothing",
    "womens-dresses":       "clothing",
    "womens-shoes":         "sneakers",
    "mens-shirts":          "clothing",
    "mens-shoes":           "sneakers",
    "mens-watches":         "watches",
    "womens-watches":       "watches",
    "womens-bags":          "bags",
    "womens-jewellery":     "accessories",
    "sunglasses":           "sunglasses",
    "automotive":           "general",
    "motorcycle":           "general",
    "lighting":             "electronics",
}

_CANONICAL_TO_DUMMYJSON: dict[str, list[str]] = {}
for dj, canon in _CAT_MAP.items():
    _CANONICAL_TO_DUMMYJSON.setdefault(canon, []).append(dj)


async def search_products(
    category: Optional[str] = None,
    brand: Optional[str] = None,
    max_price: Optional[float] = None,
    query: Optional[str] = None,
) -> list[NormalizedProduct]:
    """
    Search DummyJSON. Falls back to [] on any error so callers never break.
    Runs concurrently when multiple DummyJSON categories map to one canonical.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            raw = await _fetch(client, category=category, query=query)
        return _normalize(raw, max_price=max_price)
    except Exception:
        return []


async def _fetch(client: httpx.AsyncClient, *, category: Optional[str], query: Optional[str]) -> list[dict]:
    """Determine which DummyJSON endpoints to call and merge results."""
    dj_cats = _CANONICAL_TO_DUMMYJSON.get(category or "", []) if category else []

    tasks: list[asyncio.Task] = []

    if query and not dj_cats:
        # Text search when no category mapping
        tasks.append(asyncio.create_task(_search_text(client, query)))
    elif dj_cats:
        for dj_cat in dj_cats[:2]:  # at most 2 sub-categories per call
            tasks.append(asyncio.create_task(_search_category(client, dj_cat)))
    else:
        tasks.append(asyncio.create_task(_search_text(client, query or "product")))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    combined: list[dict] = []
    for r in results:
        if isinstance(r, list):
            combined.extend(r)
    return combined


async def _search_text(client: httpx.AsyncClient, q: str) -> list[dict]:
    res = await client.get(f"{_BASE}/products/search", params={"q": q, "limit": 20})
    res.raise_for_status()
    return res.json().get("products", [])


async def _search_category(client: httpx.AsyncClient, cat: str) -> list[dict]:
    res = await client.get(f"{_BASE}/products/category/{cat}", params={"limit": 20})
    res.raise_for_status()
    return res.json().get("products", [])


def _normalize(raw: list[dict], *, max_price: Optional[float]) -> list[NormalizedProduct]:
    results: list[NormalizedProduct] = []
    for item in raw:
        try:
            price = float(item.get("price", 0))
            if max_price is not None and price > max_price:
                continue
            stock = int(item.get("stock", 0))
            dj_cat = item.get("category", "general")
            canonical_cat = _CAT_MAP.get(dj_cat, "general")
            images: list[str] = item.get("images", [])
            thumbnail: str = item.get("thumbnail", images[0] if images else "")
            results.append(NormalizedProduct(
                merchant_id="MERCHANT_B",
                merchant_name="DummyJSON Store",
                product_id=f"DJ{item['id']}",
                title=item.get("title", ""),
                brand=item.get("brand"),
                category=canonical_cat,
                price=round(price, 2),
                currency="USD",
                size=None,
                color=None,
                available=stock > 0,
                inventory=stock,
                delivery_days=3,
                weight_grams=None,
                cushioning=None,
                rating=float(item.get("rating", 0.0)),
                review_count=0,
                shipping_cost=0.0,
                image_url=thumbnail or None,
                source="dummyjson",
            ))
        except Exception:
            continue
    return results
