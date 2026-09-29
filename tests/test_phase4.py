"""
Phase 4 tests — payment execution, orders, and the mock processor.
All tests are deterministic: no LLM calls, no external APIs, no network.
Run: pytest tests/test_phase4.py -v
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.config.agents import PAYIT
from backend.models.checkout import CheckoutObject
from backend.models.payment import PaymentRequest, PaymentResult
from backend.payment import mock_processor


# ── Helpers ───────────────────────────────────────────────────────────────────

def _checkout(
    checkout_id: str = "CHK_TEST100",
    merchant_id: str = "MERCHANT_A",
    total: float = 89.99,
    checkout_hash: str = "abc123",
) -> CheckoutObject:
    return CheckoutObject(
        checkout_id=checkout_id,
        merchant_id=merchant_id,
        merchant_name="Test Merchant",
        product_id="PROD001",
        product_title="Test Product",
        quantity=1,
        subtotal=82.0,
        tax=7.99,
        shipping=0.0,
        total=total,
        currency="USD",
        checkout_hash=checkout_hash,
    )


def _token(
    status: str = "active",
    agent_id: str = PAYIT.agent_id,
    merchant_id: str = "MERCHANT_A",
    order_id: str = "CHK_TEST100",
    max_amount: float = 89.99,
    checkout_hash: str = "abc123",
    consumed_at=None,
    expires_at=None,
) -> dict:
    if expires_at is None:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    return {
        "token_id": "DPAT_TEST0001",
        "status": status,
        "agent_id": agent_id,
        "merchant_id": merchant_id,
        "order_id": order_id,
        "currency": "USD",
        "max_amount": max_amount,
        "checkout_hash": checkout_hash,
        "consumed_at": consumed_at,
        "expires_at": expires_at,
    }


def _request(
    token_id: str = "DPAT_TEST0001",
    agent_id: str = PAYIT.agent_id,
    merchant_id: str = "MERCHANT_A",
    order_id: str = "CHK_TEST100",
    amount: float = 89.99,
    currency: str = "USD",
) -> PaymentRequest:
    return PaymentRequest(
        token_id=token_id,
        agent_id=agent_id,
        merchant_id=merchant_id,
        order_id=order_id,
        amount=amount,
        currency=currency,
    )


ACTIVE_WALLET = {
    "payment_methods": [
        {"is_default": True, "status": "active", "expiry_month": 12, "expiry_year": 2099}
    ]
}
EXPIRED_WALLET = {
    "payment_methods": [
        {"is_default": True, "status": "active", "expiry_month": 1, "expiry_year": 2000}
    ]
}
NO_ACTIVE_WALLET = {"payment_methods": []}


# ── 1. Mock payment processor ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_processor_succeeds_with_active_wallet():
    result = await mock_processor.process_payment(_request(), wallet=ACTIVE_WALLET)
    assert result.status == "success"
    assert result.transaction_id is not None
    assert result.transaction_id.startswith("TXN_")


@pytest.mark.asyncio
async def test_processor_declines_expired_card():
    result = await mock_processor.process_payment(_request(), wallet=EXPIRED_WALLET)
    assert result.status == "declined"
    assert result.decline_reason == "CARD_EXPIRED"


@pytest.mark.asyncio
async def test_processor_declines_no_active_method():
    result = await mock_processor.process_payment(_request(), wallet=NO_ACTIVE_WALLET)
    assert result.status == "declined"
    assert result.decline_reason == "NO_ACTIVE_PAYMENT_METHOD"


@pytest.mark.asyncio
async def test_processor_echoes_amount_and_currency():
    result = await mock_processor.process_payment(
        _request(amount=42.50, currency="USD"), wallet=ACTIVE_WALLET
    )
    assert result.amount == 42.50
    assert result.currency == "USD"


# ── 2. PayIt agent ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_payit_blocks_on_missing_token():
    from backend.agents.payit import execute_payment
    result, events, reason = await execute_payment(_request(), None, 89.99, "abc123", True)
    assert result is None
    assert reason == "TOKEN_NOT_FOUND"


@pytest.mark.asyncio
async def test_payit_blocks_on_consumed_token():
    from backend.agents.payit import execute_payment
    token = _token(consumed_at=datetime.now(timezone.utc))
    result, events, reason = await execute_payment(_request(), token, 89.99, "abc123", True)
    assert result is None
    assert reason == "TOKEN_ALREADY_CONSUMED"


@pytest.mark.asyncio
async def test_payit_succeeds_when_guardrails_pass():
    from backend.agents.payit import execute_payment
    token = _token()
    with patch("backend.agents.payit.mock_processor.process_payment",
               AsyncMock(return_value=PaymentResult(
                   status="success", transaction_id="TXN_TEST1", amount=89.99, currency="USD"
               ))):
        result, events, reason = await execute_payment(_request(), token, 89.99, "abc123", True)
    assert reason is None
    assert result.status == "success"
    assert result.transaction_id == "TXN_TEST1"


@pytest.mark.asyncio
async def test_payit_processor_decline_is_not_a_guardrail_block():
    from backend.agents.payit import execute_payment
    token = _token()
    with patch("backend.agents.payit.mock_processor.process_payment",
               AsyncMock(return_value=PaymentResult(
                   status="declined", decline_reason="CARD_EXPIRED", amount=89.99, currency="USD"
               ))):
        result, events, reason = await execute_payment(_request(), token, 89.99, "abc123", True)
    assert reason is None  # not a guardrail block
    assert result.status == "declined"
    assert result.decline_reason == "CARD_EXPIRED"


# ── 3. GreenLight regression — token scoped to PayIt ────────────────────────────

@pytest.mark.asyncio
async def test_greenlight_token_is_scoped_to_payit():
    checkout = _checkout(merchant_id="MERCHANT_A", total=89.99)
    from backend.agents.greenlight import request_dpat
    _, token_dict, error = await request_dpat(checkout, "USR001", "AUTH_P4_001")
    assert error is None
    assert token_dict["agent_id"] == PAYIT.agent_id


# ── 4. TrackIt agent ─────────────────────────────────────────────────────────────

def test_trackit_confirm_order_fields():
    from backend.agents import trackit
    checkout = _checkout()
    result = PaymentResult(status="success", transaction_id="TXN_ABC", amount=89.99, currency="USD")
    fields = trackit.confirm_order(checkout, result, "USR001")
    assert fields["status"] == "confirmed"
    assert fields["transaction_id"] == "TXN_ABC"
    assert fields["order_id"] == checkout.checkout_id


def test_trackit_record_incomplete_order_fields():
    from backend.agents import trackit
    checkout = _checkout()
    fields = trackit.record_incomplete_order(checkout, "blocked", "USR001")
    assert fields["status"] == "blocked"
    assert fields["transaction_id"] is None


def test_trackit_summarize_decline_mentions_no_funds_moved():
    from backend.agents import trackit
    summary = trackit.summarize_decline("CHK_TEST100", "TOKEN_ALREADY_CONSUMED")
    assert "no funds" in summary.lower()


# ── 5. REST API endpoints ─────────────────────────────────────────────────────

@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def _create_and_approve(client, product_id="RW001", merchant_id="MERCHANT_A"):
    resp = client.post("/api/checkout/create", json={
        "product_id": product_id, "merchant_id": merchant_id, "quantity": 1,
    })
    assert resp.status_code == 200
    co = resp.json()

    resp = client.post("/api/authorizations/approve", json={
        "checkout_id": co["checkout_id"],
        "checkout_hash": co["checkout_hash"],
        "merchant_id": co["merchant_id"],
        "total": co["total"],
        "currency": co["currency"],
        "user_id": "USR001",
        "product_id": co["product_id"],
        "product_title": co["product_title"],
        "merchant_name": co["merchant_name"],
        "subtotal": co["subtotal"],
        "tax": co["tax"],
        "shipping": co["shipping"],
    })
    assert resp.status_code == 200
    auth = resp.json()
    return co, auth


def _execute_body(co, auth, **overrides):
    body = {
        "token_id": auth["token_id"],
        "checkout_id": co["checkout_id"],
        "checkout_hash": co["checkout_hash"],
        "merchant_id": co["merchant_id"],
        "merchant_name": co["merchant_name"],
        "total": co["total"],
        "currency": co["currency"],
        "user_id": "USR001",
        "product_id": co["product_id"],
        "product_title": co["product_title"],
        "subtotal": co["subtotal"],
        "tax": co["tax"],
        "shipping": co["shipping"],
    }
    body.update(overrides)
    return body


def test_execute_payment_success(client):
    co, auth = _create_and_approve(client)
    resp = client.post("/api/payments/execute", json=_execute_body(co, auth))
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["transaction_id"] is not None
    assert data["order_id"] == co["checkout_id"]


def test_execute_payment_blocks_replayed_token(client):
    co, auth = _create_and_approve(client)
    first = client.post("/api/payments/execute", json=_execute_body(co, auth))
    assert first.json()["status"] == "success"

    second = client.post("/api/payments/execute", json=_execute_body(co, auth))
    assert second.status_code == 200
    data = second.json()
    assert data["status"] == "blocked"
    assert data["blocked_reason"] == "TOKEN_ALREADY_CONSUMED"


def test_execute_payment_blocks_tampered_checkout_hash(client):
    co, auth = _create_and_approve(client)
    resp = client.post("/api/payments/execute", json=_execute_body(co, auth, checkout_hash="TAMPERED"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "blocked"
    assert data["blocked_reason"] == "CHECKOUT_HASH_MISMATCH"


def test_get_orders_lists_paid_order(client):
    co, auth = _create_and_approve(client)
    client.post("/api/payments/execute", json=_execute_body(co, auth))

    resp = client.get("/api/orders?user_id=USR001")
    assert resp.status_code == 200
    orders = resp.json()
    match = next((o for o in orders if o["order_id"] == co["checkout_id"]), None)
    assert match is not None
    assert match["status"] == "paid"


def test_get_order_detail_404_for_unknown(client):
    resp = client.get("/api/orders/NOT_A_REAL_ORDER")
    assert resp.status_code == 404


def test_audit_trail_includes_execution_events(client):
    co, auth = _create_and_approve(client)
    client.post("/api/payments/execute", json=_execute_body(co, auth))

    resp = client.get(f"/api/audit/{co['checkout_id']}")
    assert resp.status_code == 200
    types = [e["event_type"] for e in resp.json()]
    assert "PAYMENT_EXECUTED" in types
    assert "ORDER_CONFIRMED" in types


# ── 6. MCP get_order_status ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_order_status_returns_real_data_after_execution(client):
    co, auth = _create_and_approve(client)
    client.post("/api/payments/execute", json=_execute_body(co, auth))

    from backend.mcp.server import get_order_status
    status = await get_order_status(co["checkout_id"])
    assert status["status"] == "confirmed"
    assert status["transaction_id"] is not None


@pytest.mark.asyncio
async def test_get_order_status_not_found_for_unknown_order():
    from backend.mcp.server import get_order_status
    status = await get_order_status("NOT_A_REAL_ORDER")
    assert status["status"] == "not_found"


# ── 7. Observability ──────────────────────────────────────────────────────────

def test_init_tracing_never_raises():
    from backend.observability.tracing import init_tracing
    enabled, endpoint = init_tracing()
    assert isinstance(enabled, bool)
