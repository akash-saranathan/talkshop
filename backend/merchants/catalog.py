"""
Product source for Talk Shop search: the six demo merchant catalogs.
Each catalog variant becomes one NormalizedProduct so cards, cart and checkout keep their existing shape.
"""
import re
import uuid
from functools import lru_cache
from pathlib import Path

import httpx

from backend.a2a.merchants import adidas, casio, fossil, hm, nike, zara
from backend.a2a.models import ShoppingIntent as A2AIntent
from backend.guardrails.agent_checks import check_merchant_response
from backend.models.product import NormalizedProduct

A2A_REQUEST_TIMEOUT_SECONDS = 6.0

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


def _image_url(product: dict, colour: str) -> str | None:
    """The studio photo for this colour, if scripts/fetch_catalog_photos.py has made it."""
    url = product.get("images", {}).get(colour)
    if not url or not (_PUBLIC_DIR / url.lstrip("/")).exists():
        return None
    return url


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
            image_url=_image_url(product, v["color"]),
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


async def _a2a_message_send(agent, intent: A2AIntent) -> list[dict]:
    """One real JSON-RPC 2.0 message/send call to the merchant's own A2A HTTP
    endpoint (POST /a2a/{merchant}) — the same endpoint backend/routers/a2a.py
    serves and backend/a2a/merchants/*.py's handle_message() answers. Returns
    the raw product dicts from the response artifact, or [] on any failure
    (connection error, timeout, or a JSON-RPC error) so a merchant being
    unreachable never crashes the caller."""
    payload = {
        "jsonrpc": "2.0", "method": "message/send", "id": f"req_{uuid.uuid4().hex[:10]}",
        "params": {"intent": intent.model_dump(), "message": {"contextId": f"ctx_{uuid.uuid4().hex[:8]}"}},
    }
    try:
        async with httpx.AsyncClient(timeout=A2A_REQUEST_TIMEOUT_SECONDS) as client:
            resp = await client.post(f"{agent.base_url}/a2a/{agent.merchant_id}", json=payload)
        resp.raise_for_status()
        body = resp.json()
        if body.get("error"):
            return []
        artifacts = body.get("result", {}).get("artifacts") or []
        return artifacts[0]["parts"][0]["data"].get("products", []) if artifacts else []
    except (httpx.HTTPError, KeyError, IndexError, TypeError):
        return []


async def search_agent_over_a2a(agent, intent: A2AIntent) -> tuple[list[NormalizedProduct], list[dict]]:
    """Same contract and result shape as search_agent_checked, but the actual
    merchant search travels over a real HTTP request to that merchant's A2A
    endpoint instead of an in-process agent.search() call."""
    matches = await _a2a_message_send(agent, intent)
    if not matches and intent.category:
        matches = await _a2a_message_send(agent, A2AIntent(raw_query=intent.raw_query, brand=intent.brand,
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
