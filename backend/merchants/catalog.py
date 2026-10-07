"""
Product source for Talk Shop search: the six demo merchant catalogs.
Each catalog variant becomes one NormalizedProduct so cards, cart and checkout keep their existing shape.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from backend.a2a.merchants import adidas, casio, fossil, hm, nike, zara
from backend.a2a.models import ShoppingIntent as A2AIntent
from backend.guardrails.agent_checks import check_merchant_response
from backend.models.product import NormalizedProduct

_AGENTS = [nike.agent, adidas.agent, zara.agent, hm.agent, fossil.agent, casio.agent]


def _category(product: dict) -> str:
    cat = product["category"]
    if cat == "running":
        return "running_shoes"
    if cat == "sneakers":
        return "sneakers"
    if cat == "watches":
        return "watches"
    return "clothing"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PUBLIC_DIR = _BACKEND_DIR.parent / "frontend" / "public"


@lru_cache(maxsize=1)
def _image_sources() -> dict:
    path = _BACKEND_DIR / "data" / "merchant_image_sources.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _image_url(product_base_id: str) -> str | None:
    entry = _image_sources().get(product_base_id)
    if not entry or not (_PUBLIC_DIR / entry["file"].lstrip("/")).exists():
        return None
    return entry["file"]


def _to_products(agent, product: dict, variants: list[dict]) -> list[NormalizedProduct]:
    base_id = product.get("sku") or product["id"]
    return [
        NormalizedProduct(
            merchant_id=agent.merchant_id,
            merchant_name=agent.merchant_name,
            product_id=f"{base_id}-{v['size']}-{_slug(v['color'])}",
            title=product["title"],
            brand=product.get("brand"),
            category=_category(product),
            price=product["price"],
            currency=product.get("currency", "USD"),
            size=str(v["size"]),
            color=v["color"],
            available=v["available"],
            inventory=v["inventory"],
            delivery_days=product.get("shipping_days", 5),
            rating=product.get("rating", 0.0),
            review_count=product.get("review_count", 0),
            image_url=_image_url(base_id),
            source="merchant_catalog",
        )
        for v in variants
    ]


def _select_agents(brand: str | None, category: str | None) -> list:
    if brand:
        key = brand.lower()
        for agent in _AGENTS:
            if key in (agent.merchant_id, agent.merchant_name.lower()):
                return [agent]
    if category:
        words = [w for w in category.lower().replace("_", " ").split() if len(w) > 2]
        relevant = [a for a in _AGENTS if any(w in " ".join(a.categories) for w in words)]
        if relevant:
            return relevant
    return _AGENTS


def search_agent_checked(agent, intent: A2AIntent) -> tuple[list[NormalizedProduct], list[dict]]:
    matches = agent.search(intent)
    if not matches and intent.category:
        matches = agent.search(A2AIntent(raw_query=intent.raw_query, brand=intent.brand,
                                         max_price=intent.max_price, size=intent.size))
    products = [p for product in matches for p in _to_products(agent, product, product["variants"])]
    return check_merchant_response(agent.merchant_id, products)


def search(
    query: str | None,
    category: str | None,
    brand: str | None,
    max_price: float | None,
    size: str | None,
) -> list[NormalizedProduct]:
    results: list[NormalizedProduct] = []
    for agent in _select_agents(brand, category):
        intent = A2AIntent(raw_query=query or "", brand=brand, category=category, max_price=max_price, size=size)
        products, _ = search_agent_checked(agent, intent)
        results.extend(products)
    return results


@lru_cache(maxsize=1)
def _all_products() -> tuple[NormalizedProduct, ...]:
    return tuple(
        p
        for agent in _AGENTS
        for product in agent._load_catalog()
        for p in _to_products(agent, product, product["variants"])
    )


def get_product(product_id: str) -> NormalizedProduct | None:
    return next((p for p in _all_products() if p.product_id == product_id), None)
