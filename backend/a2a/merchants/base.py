"""
Base merchant agent — shared catalog loading and product search logic.
All 6 merchant agents inherit from this.
"""
from __future__ import annotations
import copy
import json
import uuid
import zlib
from functools import lru_cache
from pathlib import Path

from backend.a2a.models import (
    AgentCard, AgentCapabilities, AgentSkill,
    A2ARequest, A2AResponse, TaskResult, TaskStatus, Artifact, DataPart,
    ShoppingIntent,
)

DATA_DIR = Path(__file__).parent.parent.parent / "data"


def colour_image_url(slug: str, colour: str) -> str:
    """Public URL of a product colour photo (made by scripts/fetch_catalog_photos.py)."""
    return f"/catalog/{slug}/" + "-".join(colour.lower().replace("/", " ").split()) + ".webp"


def _stock(product_id: str, size: str, colour: str) -> int:
    """Deterministic demo stock level (3-15) so inventory looks varied but never changes between runs."""
    return 3 + zlib.crc32(f"{product_id}|{size}|{colour}".encode()) % 13


def _expand(product: dict, size_ranges: dict) -> dict:
    sizes = size_ranges[product["sizes"]]
    sold_out = product.get("out_of_stock", [])

    def in_stock(size: str, colour: str) -> bool:
        return not any(o.get("size", size) == size and o.get("color", colour) == colour for o in sold_out)

    variants = []
    for c in product["colors"]:
        for size in sizes:
            ok = in_stock(size, c["name"])
            variants.append({
                "size": size,
                "color": c["name"],
                "available": ok,
                "inventory": _stock(product["product_id"], size, c["name"]) if ok else 0,
            })
    return {
        "id": product["product_id"],
        "sku": product["product_id"],
        "slug": product["slug"],
        "title": product["name"],
        "brand": product["brand"],
        "department": product["department"],
        "category": product["category"],
        "subcategory": product["subcategory"],
        "gender": product["gender"],
        "price": product["price"],
        "currency": product.get("currency", "USD"),
        "rating": product["rating"],
        "review_count": product["review_count"],
        "shipping_days": product["delivery_days"],
        "is_new": product.get("is_new", False),
        "option_label": product.get("option_label", "Size"),
        "description": product["description"],
        "tags": product.get("tags", []),
        "colors": [{"name": c["name"], "hex": c["hex"]} for c in product["colors"]],
        "images": {c["name"]: colour_image_url(product["slug"], c["name"]) for c in product["colors"]},
        "variants": variants,
    }


@lru_cache(maxsize=None)
def _read_catalog(path: Path, mtime: float) -> tuple[dict, ...]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    return tuple(_expand(p, doc["size_ranges"]) for p in doc["products"])


def _load_catalog_file(path: Path) -> list[dict]:
    # Cached per file version; callers get fresh copies so they can't mutate the cache.
    return copy.deepcopy(list(_read_catalog(path, path.stat().st_mtime)))


class BaseMerchantAgent:
    merchant_id: str
    merchant_name: str
    categories: list[str]
    catalog_file: str
    base_url: str = "http://localhost:8000"

    # ── Agent Card ────────────────────────────────────────────────────────

    def agent_card(self) -> AgentCard:
        return AgentCard(
            name=f"{self.merchant_name} Merchant Agent",
            description=f"{self.merchant_name} commerce agent — search products and checkout",
            url=f"{self.base_url}/a2a/{self.merchant_id}",
            capabilities=AgentCapabilities(streaming=True),
            skills=[
                AgentSkill(
                    id="product_search",
                    name="Product Search",
                    description=f"Search {self.merchant_name} catalog by category, size, color, price",
                    inputModes=["text"],
                    outputModes=["text", "data"],
                ),
                AgentSkill(
                    id="checkout",
                    name="Checkout",
                    description="Create a UCP checkout session for a selected SKU",
                    inputModes=["data"],
                    outputModes=["data"],
                ),
            ],
        )

    # ── Catalog loading ───────────────────────────────────────────────────

    def _load_catalog(self) -> list[dict]:
        """Read the merchant catalog and expand it into one dict per product with a
        full variants list (every size x colour), which search and checkout use."""
        return _load_catalog_file(DATA_DIR / self.catalog_file)

    # ── Product search ────────────────────────────────────────────────────

    def search(self, intent: ShoppingIntent) -> list[dict]:
        catalog = self._load_catalog()
        results = []
        for product in catalog:
            # category / subcategory filter — bidirectional word-overlap so LLM categories
            # like "running_shoes" match catalog categories like "running" or "sneakers"
            if intent.category:
                cat = intent.category.lower().replace("_", " ").replace("-", " ")
                # department lets broad asks ("clothing", "shoes") reach every product in it, dresses included
                prod_cat = " ".join([product["category"], product.get("subcategory", ""),
                                     product.get("department", "")]).lower()
                cat_words = {w for w in cat.split() if len(w) > 2}
                prod_words = {w for w in prod_cat.split() if len(w) > 2}
                # Pass if: direct substring OR any word overlap in either direction
                if not (cat in prod_cat or prod_cat.strip() in cat or
                        cat_words & prod_words or
                        any(pw in cat for pw in prod_words) or
                        any(cw in prod_cat for cw in cat_words)):
                    continue

            # price filter
            if intent.max_price and product["price"] > intent.max_price:
                continue

            # keyword filter (title / description / tags)
            if intent.keywords:
                text = " ".join([product["title"], product.get("description", ""), *product.get("tags", [])]).lower()
                if not any(kw.lower() in text for kw in intent.keywords):
                    continue

            # variant filter (size / color / availability)
            matching_variants = self._filter_variants(product["variants"], intent)
            if not matching_variants:
                continue

            results.append({**product, "variants": matching_variants, "merchant_id": self.merchant_id, "merchant_name": self.merchant_name})

        # sort by rating desc, then price asc
        results.sort(key=lambda p: (-p["rating"], p["price"]))
        return results

    def _filter_variants(self, variants: list[dict], intent: ShoppingIntent) -> list[dict]:
        filtered = []
        for v in variants:
            if intent.size and v["size"].lower() != intent.size.lower():
                continue
            if intent.color and intent.color.lower() not in v["color"].lower():
                continue
            filtered.append(v)
        # if no variants pass the filter but no filters were applied, return all
        return filtered if filtered else variants

    # ── A2A message/send handler ──────────────────────────────────────────

    def handle_message(self, request: A2ARequest, intent: ShoppingIntent) -> A2AResponse:
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        context_id = request.params.get("message", {}).get("contextId", f"ctx_{uuid.uuid4().hex[:8]}")

        products = self.search(intent)

        artifact = Artifact(
            artifactId=f"artifact_{uuid.uuid4().hex[:8]}",
            name="product_results",
            parts=[DataPart(type="data", data={"products": products, "total_found": len(products)})],
        )

        return A2AResponse(
            jsonrpc="2.0",
            id=request.id,
            result=TaskResult(
                id=task_id,
                contextId=context_id,
                status=TaskStatus(state="completed"),
                artifacts=[artifact],
            ),
        )
