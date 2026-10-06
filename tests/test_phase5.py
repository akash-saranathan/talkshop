"""
Phase 5 tests — failure-scenario hardening.
All tests are deterministic: no real LLM calls, no external APIs, no network.
Run: pytest tests/test_phase5.py -v
"""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.models.intent import ShoppingIntent


# ── 1. VibeCheck recommendation fallback ────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_recommendation_falls_back_on_llm_error():
    from backend.agents.vibecheck import generate_recommendation_text

    intent = ShoppingIntent(category="running_shoes", raw_query="fast shoes")
    products = [{
        "title": "Runner Pro X", "price": 117.94, "rating": 4.5,
        "merchant_name": "ShopSphere", "available": True,
    }]

    broken_llm = AsyncMock()
    broken_llm.ainvoke = AsyncMock(side_effect=RuntimeError("rate limited"))

    with patch("backend.agents.vibecheck.get_llm", return_value=broken_llm):
        text, _ = await generate_recommendation_text(intent, products)

    assert "Runner Pro X" in text
    assert "117.94" in text
    assert "ShopSphere" in text


@pytest.mark.asyncio
async def test_generate_recommendation_empty_products_unaffected():
    from backend.agents.vibecheck import generate_recommendation_text
    intent = ShoppingIntent(category="running_shoes", raw_query="fast shoes")
    text, suggestion = await generate_recommendation_text(intent, [])
    assert "found right now" in text.lower()


# ── VibeCheck: LLM content can be str OR list[str|dict] (LangChain typing) ──────
# Found by actually running the app with a real Gemini key — every existing
# test mocks response.content as a plain string, so this shape was never
# exercised: `extract_json_from_llm(response.content)` and
# `response.content.strip()` both crashed with "'list' object has no
# attribute 'strip'" on a real response, breaking chat search entirely.

def test_content_text_handles_plain_string():
    from backend.agents.vibecheck import _content_text
    assert _content_text("hello") == "hello"


def test_content_text_handles_list_of_dicts():
    from backend.agents.vibecheck import _content_text
    content = [{"type": "text", "text": "hel"}, {"type": "text", "text": "lo"}]
    assert _content_text(content) == "hello"


def test_content_text_handles_list_of_strings():
    from backend.agents.vibecheck import _content_text
    assert _content_text(["hel", "lo"]) == "hello"


@pytest.mark.asyncio
async def test_generate_recommendation_handles_list_shaped_content():
    from backend.agents.vibecheck import generate_recommendation_text

    intent = ShoppingIntent(category="running_shoes", raw_query="fast shoes")
    products = [{
        "title": "Runner Pro X", "price": 117.94, "rating": 4.5,
        "merchant_name": "ShopSphere", "available": True,
    }]

    fake_response = AsyncMock()
    fake_response.content = [{"type": "text", "text": "Great pick for you."}]
    llm = AsyncMock()
    llm.ainvoke = AsyncMock(return_value=fake_response)

    with patch("backend.agents.vibecheck.get_llm", return_value=llm):
        text, _ = await generate_recommendation_text(intent, products)

    assert text == "Great pick for you."


@pytest.mark.asyncio
async def test_extract_intent_handles_list_shaped_content():
    from backend.agents.vibecheck import extract_intent

    fake_response = AsyncMock()
    fake_response.content = [{"type": "text", "text": (
        '{"category": "running_shoes", "brand": null, "size": null, "color": null, '
        '"max_price": 100.0, "delivery_days": null, "preferences": [], '
        '"use_case": null, "currency": "USD", "raw_query": null}'
    )}]
    llm = AsyncMock()
    llm.ainvoke = AsyncMock(return_value=fake_response)

    with patch("backend.agents.vibecheck.get_llm", return_value=llm), \
         patch("backend.guardrails.nemo.check_input", AsyncMock(return_value=(True, None))):
        intent, error = await extract_intent("find running shoes under 100")

    assert error is None
    assert intent is not None
    assert intent.category == "running_shoes"
    assert intent.max_price == 100.0


# ── 2. Discovery graph surfaces failures immediately, no 60s hang ───────────────

@pytest.mark.asyncio
async def test_run_discovery_emits_error_event_on_node_exception():
    from backend.graph import workflow

    queue: asyncio.Queue = asyncio.Queue()
    with patch.object(
        workflow.commerce_graph, "ainvoke", AsyncMock(side_effect=RuntimeError("graph exploded"))
    ):
        await workflow.run_discovery("find shoes", "sess-test", queue)

    events = []
    while not queue.empty():
        events.append(queue.get_nowait())

    assert events[-1] is None  # sentinel still sent so the SSE consumer stops
    error_events = [e for e in events if e is not None and e.get("type") == "error"]
    assert len(error_events) == 1
    assert "graph exploded" in error_events[0]["message"]


# ── 3. Payment execution hardening: token burns on any attempt ─────────────────

@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def _create_and_approve(client, auth_headers, product_id="SSP001", merchant_id="SHOPSPHERE"):
    resp = client.post("/api/checkout/create", json={
        "product_id": product_id, "merchant_id": merchant_id, "quantity": 1,
    }, headers=auth_headers)
    assert resp.status_code == 200
    co = resp.json()

    resp = client.post("/api/authorizations/approve", json={
        "checkout_id": co["checkout_id"],
        "checkout_hash": co["checkout_hash"],
        "merchant_id": co["merchant_id"],
        "total": co["total"],
        "currency": co["currency"],
        "product_id": co["product_id"],
        "product_title": co["product_title"],
        "merchant_name": co["merchant_name"],
        "subtotal": co["subtotal"],
        "tax": co["tax"],
        "shipping": co["shipping"],
    }, headers=auth_headers)
    assert resp.status_code == 200
    return co, resp.json()


def _execute_body(co, auth, **overrides):
    body = {
        "token_id": auth["token_id"],
        "checkout_id": co["checkout_id"],
        "checkout_hash": co["checkout_hash"],
        "merchant_id": co["merchant_id"],
        "merchant_name": co["merchant_name"],
        "total": co["total"],
        "currency": co["currency"],
        "product_id": co["product_id"],
        "product_title": co["product_title"],
        "subtotal": co["subtotal"],
        "tax": co["tax"],
        "shipping": co["shipping"],
    }
    body.update(overrides)
    return body


def test_failed_attempt_still_consumes_token(client, auth_headers):
    """
    A guardrail-blocked attempt (e.g. tampered hash) now burns the token —
    closing a tamper-probing vector where the same token could otherwise be
    retried indefinitely with different values until one slipped through.
    """
    co, auth = _create_and_approve(client, auth_headers)

    first = client.post("/api/payments/execute", json=_execute_body(co, auth, checkout_hash="TAMPERED"), headers=auth_headers)
    assert first.json()["blocked_reason"] == "CHECKOUT_HASH_MISMATCH"

    second = client.post("/api/payments/execute", json=_execute_body(co, auth), headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["blocked_reason"] == "TOKEN_ALREADY_CONSUMED"


def test_execute_payment_still_succeeds_on_first_clean_attempt(client, auth_headers):
    """Regression: the new atomic claim must not block the normal happy path."""
    co, auth = _create_and_approve(client, auth_headers)
    resp = client.post("/api/payments/execute", json=_execute_body(co, auth), headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"


# ── 4. GET /api/orders/{id} now includes merchant_name + reason ────────────────

def test_get_order_detail_includes_merchant_name_and_reason(client, auth_headers):
    co, auth = _create_and_approve(client, auth_headers)
    client.post("/api/payments/execute", json=_execute_body(co, auth, checkout_hash="TAMPERED"), headers=auth_headers)

    resp = client.get(f"/api/orders/{co['checkout_id']}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["merchant_name"] == co["merchant_name"]
    assert data["reason"] == "CHECKOUT_HASH_MISMATCH"
