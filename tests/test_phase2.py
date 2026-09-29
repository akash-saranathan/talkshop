"""
Phase 2 smoke tests.
Covers: merchant adapters, MCP tools, deterministic filter/ranking,
guardrails validators, LLM config, SSE endpoint structure.
No LLM calls — all tests are deterministic.
Run: pytest tests/test_phase2.py -v
"""
import asyncio
import pytest
from pathlib import Path


# ── 1. Merchant adapters ──────────────────────────────────────────────────────

def test_local_adapter_returns_products():
    from backend.merchants.local import search_products
    results = search_products(category="running_shoes")
    assert len(results) > 0
    assert all(p.category == "running_shoes" for p in results)


def test_local_adapter_price_filter():
    from backend.merchants.local import search_products
    results = search_products(category="running_shoes", max_price=90.0)
    assert all(p.price <= 90.0 for p in results)


def test_local_adapter_out_of_stock_included():
    from backend.merchants.local import search_products
    results = search_products(category="running_shoes")
    statuses = [p.available for p in results]
    assert True in statuses  # at least one in stock
    assert False in statuses  # at least one out of stock (seeded)


def test_local_adapter_get_product_found():
    from backend.merchants.local import get_product
    p = get_product("RW001")
    assert p is not None
    assert p.product_id == "RW001"
    assert p.price > 0


def test_local_adapter_get_product_missing():
    from backend.merchants.local import get_product
    p = get_product("DOES_NOT_EXIST")
    assert p is None


def test_shopify_adapter_no_credentials_returns_empty():
    """Shopify adapter must return [] when no credentials set."""
    import os
    # Ensure no credentials in env for this test
    orig_domain = os.environ.pop("SHOPIFY_STORE_DOMAIN", None)
    orig_token = os.environ.pop("SHOPIFY_STOREFRONT_ACCESS_TOKEN", None)
    try:
        from backend.merchants import shopify
        shopify.STORE_DOMAIN = ""
        shopify.ACCESS_TOKEN = ""
        result = asyncio.get_event_loop().run_until_complete(
            shopify.search_products(category="running_shoes")
        )
        assert result == []
    finally:
        if orig_domain:
            os.environ["SHOPIFY_STORE_DOMAIN"] = orig_domain
        if orig_token:
            os.environ["SHOPIFY_STOREFRONT_ACCESS_TOKEN"] = orig_token


def test_bestbuy_adapter_no_credentials_returns_empty():
    """Best Buy adapter must return [] when no key set."""
    import os
    orig_key = os.environ.pop("BESTBUY_API_KEY", None)
    try:
        from backend.merchants import bestbuy
        bestbuy.API_KEY = ""
        result = asyncio.get_event_loop().run_until_complete(
            bestbuy.search_products(category="electronics")
        )
        assert result == []
    finally:
        if orig_key:
            os.environ["BESTBUY_API_KEY"] = orig_key


# ── 2. Deterministic filter ───────────────────────────────────────────────────

def test_filter_removes_out_of_stock():
    from backend.agents.sneakpeek import filter_products
    from backend.models.intent import ShoppingIntent
    from backend.models.product import NormalizedProduct

    products = [
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P1",
                          title="Shoe A", category="running_shoes", price=80.0, inventory=5),
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P2",
                          title="Shoe B", category="running_shoes", price=80.0,
                          inventory=0, available=False),
    ]
    intent = ShoppingIntent(category="running_shoes")
    filtered = filter_products(products, intent)
    assert len(filtered) == 1
    assert filtered[0].product_id == "P1"


def test_filter_applies_price_ceiling():
    from backend.agents.sneakpeek import filter_products
    from backend.models.intent import ShoppingIntent
    from backend.models.product import NormalizedProduct

    products = [
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P1",
                          title="Cheap", category="running_shoes", price=50.0, inventory=5),
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P2",
                          title="Expensive", category="running_shoes", price=150.0, inventory=5),
    ]
    intent = ShoppingIntent(category="running_shoes", max_price=100.0)
    filtered = filter_products(products, intent)
    assert len(filtered) == 1
    assert filtered[0].product_id == "P1"


def test_filter_size_match():
    from backend.agents.sneakpeek import filter_products
    from backend.models.intent import ShoppingIntent
    from backend.models.product import NormalizedProduct

    products = [
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P1",
                          title="Shoe", category="running_shoes", price=80.0, inventory=5, size="10"),
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P2",
                          title="Shoe", category="running_shoes", price=80.0, inventory=5, size="11"),
    ]
    intent = ShoppingIntent(category="running_shoes", size="10")
    filtered = filter_products(products, intent)
    assert len(filtered) == 1
    assert filtered[0].size == "10"


# ── 3. Deterministic ranking ──────────────────────────────────────────────────

def test_ranking_sets_rank_score():
    from backend.agents.sneakpeek import rank_products
    from backend.models.intent import ShoppingIntent
    from backend.models.product import NormalizedProduct

    products = [
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P1",
                          title="Lightweight Shoe", category="running_shoes",
                          price=80.0, inventory=5, rating=4.8, review_count=100),
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P2",
                          title="Basic Shoe", category="running_shoes",
                          price=90.0, inventory=5, rating=3.5, review_count=10),
    ]
    intent = ShoppingIntent(category="running_shoes", max_price=100.0, preferences=["lightweight"])
    ranked = rank_products(products, intent)
    assert ranked[0].rank_score > ranked[1].rank_score
    assert ranked[0].product_id == "P1"


def test_ranking_respects_brand_preference():
    from backend.agents.sneakpeek import rank_products
    from backend.models.intent import ShoppingIntent
    from backend.models.product import NormalizedProduct

    products = [
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P1",
                          title="Nike Shoe", category="running_shoes",
                          price=80.0, inventory=5, brand="Nike", rating=4.0),
        NormalizedProduct(merchant_id="M", merchant_name="X", product_id="P2",
                          title="Generic Shoe", category="running_shoes",
                          price=80.0, inventory=5, brand="Generic", rating=4.0),
    ]
    intent = ShoppingIntent(category="running_shoes", brand="Nike")
    ranked = rank_products(products, intent)
    assert ranked[0].product_id == "P1"


# ── 4. Guardrails validators ──────────────────────────────────────────────────

def test_validate_intent_valid_json():
    from backend.guardrails.validators import validate_shopping_intent
    raw = '{"category": "running_shoes", "max_price": 100.0, "size": "10"}'
    valid, intent, err = validate_shopping_intent(raw)
    assert valid
    assert intent is not None
    assert intent.category == "running_shoes"
    assert intent.max_price == 100.0


def test_validate_intent_string_price_fails():
    from backend.guardrails.validators import validate_shopping_intent
    raw = '{"category": "running_shoes", "max_price": "under a hundred"}'
    valid, intent, err = validate_shopping_intent(raw)
    assert not valid
    assert err is not None


def test_validate_intent_missing_category_fails():
    from backend.guardrails.validators import validate_shopping_intent
    raw = '{"brand": "Nike", "size": "10"}'
    valid, intent, err = validate_shopping_intent(raw)
    assert not valid


def test_extract_json_strips_markdown():
    from backend.guardrails.validators import extract_json_from_llm
    raw = '```json\n{"category": "running_shoes"}\n```'
    cleaned = extract_json_from_llm(raw)
    assert cleaned == '{"category": "running_shoes"}'


# ── 5. LLM config ─────────────────────────────────────────────────────────────

def test_llm_model_name():
    from backend.config.llm import MODEL_NAME
    assert MODEL_NAME == "gemini-3.5-flash-lite"


def test_llm_resolve_requires_api_key(monkeypatch):
    import os
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    # Reset cached state
    import backend.config.llm as llm_module
    llm_module._resolved = None
    with pytest.raises(SystemExit):
        llm_module.resolve_llm()
    llm_module._resolved = None  # reset for subsequent tests


# ── 6. MCP server tools ───────────────────────────────────────────────────────

def test_mcp_check_inventory_found():
    result = asyncio.get_event_loop().run_until_complete(
        _mcp_check_inventory("RW001")
    )
    assert result["available"] is not None
    assert "delivery_days" in result


def test_mcp_check_inventory_not_found():
    result = asyncio.get_event_loop().run_until_complete(
        _mcp_check_inventory("DOES_NOT_EXIST")
    )
    assert result.get("error") == "product_not_found"


def test_mcp_get_price():
    result = asyncio.get_event_loop().run_until_complete(
        _mcp_get_price("RW001")
    )
    assert "price" in result
    assert result["price"] > 0


async def _mcp_check_inventory(product_id: str):
    from backend.mcp.server import check_inventory
    return await check_inventory(product_id)


async def _mcp_get_price(product_id: str):
    from backend.mcp.server import get_price
    return await get_price(product_id)


# ── 7. SSE endpoint ───────────────────────────────────────────────────────────

def test_chat_stream_endpoint_exists():
    """Verify the chat router is mounted and endpoint responds."""
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as client:
        # We don't have an API key in test env so we just verify routing
        # A GET without a message param should return 422 (validation error), not 404
        r = client.get("/api/chat/stream")
        assert r.status_code in (422, 200)  # 422 = missing required param


def test_chat_stream_requires_message_param():
    from fastapi.testclient import TestClient
    from backend.main import app
    with TestClient(app) as client:
        r = client.get("/api/chat/stream")
        assert r.status_code == 422
