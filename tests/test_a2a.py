"""
Phase 1 — A2A layer tests.
Covers: agent cards, product search filtering, multi-merchant routing.
"""
import uuid
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

MERCHANTS = ["nike", "adidas", "zara", "hm", "fossil", "casio"]


# ── Agent Card ────────────────────────────────────────────────────────────────

class TestAgentCards:
    def test_all_agent_cards_return_200(self):
        for merchant in MERCHANTS:
            resp = client.get(f"/a2a/{merchant}/.well-known/agent.json")
            assert resp.status_code == 200, f"{merchant} agent card failed: {resp.text}"

    def test_agent_card_shape(self):
        resp = client.get("/a2a/nike/.well-known/agent.json")
        card = resp.json()
        assert card["name"] == "Nike Merchant Agent"
        assert "url" in card
        assert len(card["skills"]) >= 2
        skill_ids = [s["id"] for s in card["skills"]]
        assert "product_search" in skill_ids
        assert "checkout" in skill_ids

    def test_unknown_merchant_returns_404(self):
        resp = client.get("/a2a/unknownbrand/.well-known/agent.json")
        assert resp.status_code == 404


# ── message/send ─────────────────────────────────────────────────────────────

def _send(merchant: str, intent: dict) -> dict:
    payload = {
        "jsonrpc": "2.0",
        "method": "message/send",
        "id": f"req_{uuid.uuid4().hex[:8]}",
        "params": {
            "message": {
                "role": "user",
                "messageId": uuid.uuid4().hex,
                "contextId": uuid.uuid4().hex,
                "parts": [{"type": "text", "text": intent.get("raw_query", "find products")}],
            },
            "intent": intent,
        },
    }
    resp = client.post(f"/a2a/{merchant}", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestProductSearch:
    def test_nike_returns_products(self):
        data = _send("nike", {"raw_query": "shoes", "category": "running"})
        assert data["result"]["status"]["state"] == "completed"
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        assert len(products) > 0

    def test_price_filter(self):
        data = _send("nike", {"raw_query": "cheap shoes", "category": "running", "max_price": 95.0})
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        for p in products:
            assert p["price"] <= 95.0, f"Price {p['price']} exceeds max_price 95.0"

    def test_price_filter_excludes_expensive(self):
        # All Nike shoes cost > $20 so max_price=20 should return nothing
        data = _send("nike", {"raw_query": "shoes", "max_price": 20.0})
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        assert len(products) == 0

    def test_zara_dresses(self):
        data = _send("zara", {"raw_query": "dress", "category": "dresses"})
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        assert len(products) > 0
        for p in products:
            assert p["merchant_id"] == "zara"

    def test_watches_fossil(self):
        data = _send("fossil", {"raw_query": "watch", "category": "watches"})
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        assert len(products) > 0

    def test_watches_casio_under_100(self):
        data = _send("casio", {"raw_query": "cheap watch", "category": "watches", "max_price": 100.0})
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        assert len(products) > 0
        for p in products:
            assert p["price"] <= 100.0

    def test_results_sorted_by_rating(self):
        data = _send("nike", {"raw_query": "shoes"})
        products = data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        ratings = [p["rating"] for p in products]
        assert ratings == sorted(ratings, reverse=True), "Results not sorted by rating desc"

    def test_wrong_method_returns_error(self):
        payload = {
            "jsonrpc": "2.0",
            "method": "unknown/method",
            "id": "req_err",
            "params": {},
        }
        data = client.post("/a2a/nike", json=payload).json()
        assert data["error"] is not None
        assert data["error"]["code"] == -32601

    def test_each_merchant_has_its_own_products(self):
        nike_data = _send("nike", {"raw_query": "sportswear"})
        adidas_data = _send("adidas", {"raw_query": "sportswear"})
        nike_products = nike_data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        adidas_products = adidas_data["result"]["artifacts"][0]["parts"][0]["data"]["products"]
        nike_ids = {p["id"] for p in nike_products}
        adidas_ids = {p["id"] for p in adidas_products}
        # No product ID should appear in both catalogs
        assert nike_ids.isdisjoint(adidas_ids), "Nike and Adidas share product IDs"
