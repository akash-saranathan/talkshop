"""
Base merchant agent — shared catalog loading and product search logic.
All 6 merchant agents inherit from this.
"""
from __future__ import annotations
import json
import uuid
from pathlib import Path

from backend.a2a.models import (
    AgentCard, AgentCapabilities, AgentSkill,
    A2ARequest, A2AResponse, TaskResult, TaskStatus, Artifact, DataPart,
    ShoppingIntent,
)

DATA_DIR = Path(__file__).parent.parent.parent / "data"


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
        path = DATA_DIR / self.catalog_file
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    # ── Product search ────────────────────────────────────────────────────

    def search(self, intent: ShoppingIntent) -> list[dict]:
        catalog = self._load_catalog()
        results = []
        for product in catalog:
            # category / subcategory filter
            if intent.category:
                cat = intent.category.lower()
                if cat not in product["category"].lower() and cat not in product.get("subcategory", "").lower():
                    continue

            # price filter
            if intent.max_price and product["price"] > intent.max_price:
                continue

            # keyword filter (title / description)
            if intent.keywords:
                text = (product["title"] + " " + product.get("description", "")).lower()
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
