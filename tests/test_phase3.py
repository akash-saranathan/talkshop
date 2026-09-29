"""
Phase 3 tests — checkout, authorization, payment guardrails.
All tests are deterministic: no LLM calls, no external APIs, no network.
Run: pytest tests/test_phase3.py -v
"""
import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.models.checkout import CheckoutObject
from backend.models.payment import GuardrailEvent, PaymentRequest
from backend.models.product import NormalizedProduct
from backend.payment.policy import (
    evaluate_purchase, MAX_PURCHASE_AMOUNT, ALLOWED_MERCHANTS
)
from backend.payment.signing import sign_authorization, verify_authorization
from backend.payment.guardrail_engine import run_guardrails


# ── Helpers ───────────────────────────────────────────────────────────────────

def _checkout(
    merchant_id: str = "MERCHANT_A",
    total: float = 89.99,
    checkout_hash: str = "abc123",
) -> CheckoutObject:
    return CheckoutObject(
        checkout_id="CHK_TEST001",
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
    agent_id: str = "AGENT_GREENLIGHT_V1",
    merchant_id: str = "MERCHANT_A",
    order_id: str = "CHK_TEST001",
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
    agent_id: str = "AGENT_GREENLIGHT_V1",
    merchant_id: str = "MERCHANT_A",
    order_id: str = "CHK_TEST001",
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


# ── 1. Policy engine ──────────────────────────────────────────────────────────

def test_policy_allows_valid_purchase():
    result = evaluate_purchase("MERCHANT_A", 99.99, "USD")
    assert result.decision == "ALLOW"
    assert result.reason_code == "POLICY_PASSED"


def test_policy_denies_unknown_merchant():
    result = evaluate_purchase("EVIL_SHOP", 10.00, "USD")
    assert result.decision == "DENY"
    assert result.reason_code == "MERCHANT_NOT_ALLOWED"


def test_policy_denies_unsupported_currency():
    result = evaluate_purchase("MERCHANT_A", 50.00, "EUR")
    assert result.decision == "DENY"
    assert result.reason_code == "CURRENCY_NOT_SUPPORTED"


def test_policy_denies_zero_amount():
    result = evaluate_purchase("MERCHANT_A", 0.0, "USD")
    assert result.decision == "DENY"
    assert result.reason_code == "INVALID_AMOUNT"


def test_policy_requires_step_up_at_limit():
    result = evaluate_purchase("MERCHANT_A", MAX_PURCHASE_AMOUNT + 0.01, "USD")
    assert result.decision == "REQUIRE_STEP_UP"
    assert result.reason_code == "AMOUNT_EXCEEDS_LIMIT"


def test_policy_allows_exact_limit():
    result = evaluate_purchase("MERCHANT_A", MAX_PURCHASE_AMOUNT, "USD")
    assert result.decision == "ALLOW"


def test_all_merchants_are_in_allowed_set():
    for mid in ALLOWED_MERCHANTS:
        result = evaluate_purchase(mid, 50.0, "USD")
        assert result.decision == "ALLOW", f"{mid} should be allowed"


# ── 2. HMAC signing ───────────────────────────────────────────────────────────

def test_sign_and_verify_roundtrip():
    data = {"merchant_id": "MERCHANT_A", "amount": 99.99, "order_id": "ORD001"}
    sig = sign_authorization(data)
    assert verify_authorization(data, sig) is True


def test_tampered_data_fails_verification():
    data = {"merchant_id": "MERCHANT_A", "amount": 99.99, "order_id": "ORD001"}
    sig = sign_authorization(data)
    tampered = {**data, "amount": 1000.00}
    assert verify_authorization(tampered, sig) is False


def test_wrong_signature_fails():
    data = {"merchant_id": "MERCHANT_A", "amount": 10.00}
    assert verify_authorization(data, "deadbeef" * 8) is False


def test_sign_is_deterministic():
    data = {"merchant_id": "MERCHANT_A", "amount": 50.00}
    assert sign_authorization(data) == sign_authorization(data)


def test_sign_key_order_invariant():
    data_a = {"a": 1, "b": 2}
    data_b = {"b": 2, "a": 1}
    assert sign_authorization(data_a) == sign_authorization(data_b)


# ── 3. Guardrail engine ───────────────────────────────────────────────────────

def test_all_12_checks_pass():
    token = _token()
    req = _request()
    passed, events = run_guardrails(req, token, 89.99, "abc123", consent_exists=True)
    assert passed is True
    assert len(events) == 12
    assert all(e.passed for e in events)


def test_check1_fails_when_no_token():
    passed, events = run_guardrails(_request(), None, 89.99, "abc123", True)
    assert passed is False
    assert events[0].reason_code == "TOKEN_NOT_FOUND"
    assert len(events) == 1  # stops at first failure


def test_check2_fails_when_token_revoked():
    token = _token(status="revoked")
    passed, events = run_guardrails(_request(), token, 89.99, "abc123", True)
    assert passed is False
    assert events[1].reason_code == "TOKEN_NOT_ACTIVE"


def test_check3_fails_when_token_expired():
    token = _token(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    passed, events = run_guardrails(_request(), token, 89.99, "abc123", True)
    assert passed is False
    assert events[2].reason_code == "AUTHORIZATION_EXPIRED"


def test_check4_fails_when_token_consumed():
    token = _token(consumed_at=datetime.now(timezone.utc))
    passed, events = run_guardrails(_request(), token, 89.99, "abc123", True)
    assert passed is False
    assert events[3].reason_code == "TOKEN_ALREADY_CONSUMED"


def test_check5_fails_on_agent_mismatch():
    token = _token(agent_id="DIFFERENT_AGENT")
    passed, events = run_guardrails(_request(), token, 89.99, "abc123", True)
    assert passed is False
    assert events[4].reason_code == "AGENT_NOT_AUTHORIZED"


def test_check6_fails_on_merchant_mismatch():
    token = _token(merchant_id="MERCHANT_B")
    req = _request(merchant_id="MERCHANT_A")
    passed, events = run_guardrails(req, token, 89.99, "abc123", True)
    assert passed is False
    assert events[5].reason_code == "MERCHANT_NOT_AUTHORIZED"


def test_check7_fails_on_order_mismatch():
    token = _token(order_id="CHK_DIFFERENT")
    passed, events = run_guardrails(_request(), token, 89.99, "abc123", True)
    assert passed is False
    assert events[6].reason_code == "ORDER_MISMATCH"


def test_check8_fails_on_currency_mismatch():
    token = _token()
    req = _request(currency="GBP")
    # Token currency is USD by default
    token["currency"] = "USD"
    passed, events = run_guardrails(req, token, 89.99, "abc123", True)
    assert passed is False
    assert events[7].reason_code == "CURRENCY_MISMATCH"


def test_check9_fails_when_amount_exceeds_max():
    token = _token(max_amount=89.99)
    req = _request(amount=200.00)
    passed, events = run_guardrails(req, token, 200.00, "abc123", True)
    assert passed is False
    assert events[8].reason_code == "AMOUNT_EXCEEDS_AUTHORIZED_LIMIT"


def test_check10_fails_on_amount_checkout_mismatch():
    token = _token()
    req = _request(amount=89.99)
    passed, events = run_guardrails(req, token, 99.99, "abc123", True)
    assert passed is False
    assert events[9].reason_code == "AMOUNT_CHECKOUT_MISMATCH"


def test_check10_passes_within_penny_tolerance():
    token = _token(max_amount=90.00)
    req = _request(amount=89.99)
    passed, events = run_guardrails(req, token, 89.995, "abc123", True)
    # $0.005 diff < $0.01 tolerance — check 10 should pass (blocked by hash later)
    assert events[9].passed is True


def test_check11_fails_on_hash_mismatch():
    token = _token(checkout_hash="legitimate_hash")
    req = _request()
    passed, events = run_guardrails(req, token, 89.99, "TAMPERED_HASH", True)
    assert passed is False
    assert events[10].reason_code == "CHECKOUT_HASH_MISMATCH"


def test_check12_fails_when_no_consent():
    token = _token()
    passed, events = run_guardrails(_request(), token, 89.99, "abc123", consent_exists=False)
    assert passed is False
    assert events[11].reason_code == "CONSENT_RECORD_MISSING"


# ── 4. CartUp build_checkout ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cartup_builds_checkout_with_mocked_mcp():
    product = NormalizedProduct(
        merchant_id="MERCHANT_A",
        merchant_name="Test Merchant",
        product_id="PROD001",
        title="Test Shoe",
        brand="TestBrand",
        category="running_shoes",
        price=79.99,
        available=True,
        inventory=10,
        delivery_days=3,
        rating=4.5,
    )

    inv_resp = {"available": True, "quantity": 10, "product_id": "PROD001"}
    price_resp = {"price": 79.99, "product_id": "PROD001", "currency": "USD"}
    ship_resp = {"shipping_cost": 0.0, "carrier": "Standard"}

    with patch("backend.mcp.server.check_inventory", AsyncMock(return_value=inv_resp)), \
         patch("backend.mcp.server.get_price", AsyncMock(return_value=price_resp)), \
         patch("backend.mcp.server.calculate_shipping", AsyncMock(return_value=ship_resp)):
        from backend.agents.cartup import build_checkout
        checkout, error = await build_checkout(product, quantity=1)

    assert error is None
    assert checkout is not None
    assert checkout.product_id == "PROD001"
    assert checkout.merchant_id == "MERCHANT_A"
    assert checkout.subtotal == 79.99
    assert checkout.total == round(79.99 + round(79.99 * 0.082, 2), 2)
    assert len(checkout.checkout_hash) == 64  # SHA-256 hex


@pytest.mark.asyncio
async def test_cartup_returns_error_when_out_of_stock():
    product = NormalizedProduct(
        merchant_id="MERCHANT_A",
        merchant_name="Test Merchant",
        product_id="PROD002",
        title="Sold Out Shoe",
        brand="TestBrand",
        category="running_shoes",
        price=99.99,
        available=False,
        inventory=0,
        delivery_days=3,
        rating=4.0,
    )

    inv_resp = {"available": False, "quantity": 0, "product_id": "PROD002"}

    with patch("backend.mcp.server.check_inventory", AsyncMock(return_value=inv_resp)):
        from backend.agents.cartup import build_checkout
        checkout, error = await build_checkout(product, quantity=1)

    assert checkout is None
    assert "OUT_OF_STOCK" in error


@pytest.mark.asyncio
async def test_cartup_checkout_hash_is_deterministic():
    product = NormalizedProduct(
        merchant_id="MERCHANT_A",
        merchant_name="Test Merchant",
        product_id="PROD001",
        title="Test Shoe",
        brand="TestBrand",
        category="running_shoes",
        price=79.99,
        available=True,
        inventory=10,
        delivery_days=3,
        rating=4.5,
    )

    inv_resp = {"available": True, "quantity": 10, "product_id": "PROD001"}
    price_resp = {"price": 79.99, "product_id": "PROD001", "currency": "USD"}
    ship_resp = {"shipping_cost": 0.0, "carrier": "Standard"}

    with patch("backend.mcp.server.check_inventory", AsyncMock(return_value=inv_resp)), \
         patch("backend.mcp.server.get_price", AsyncMock(return_value=price_resp)), \
         patch("backend.mcp.server.calculate_shipping", AsyncMock(return_value=ship_resp)):
        from backend.agents.cartup import build_checkout
        co1, _ = await build_checkout(product, quantity=1)
        co2, _ = await build_checkout(product, quantity=1)

    # Same product + same quantity = same hash (different checkout_id is ok)
    assert co1.checkout_hash == co2.checkout_hash


# ── 5. GreenLight request_dpat ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_greenlight_issues_token_for_valid_checkout():
    checkout = _checkout(merchant_id="MERCHANT_A", total=89.99)
    from backend.agents.greenlight import request_dpat
    token_id, token_dict, error = await request_dpat(checkout, "USR001", "AUTH_001")

    assert error is None
    assert token_id.startswith("DPAT_")
    assert token_dict is not None
    assert token_dict["status"] == "active"
    assert token_dict["max_amount"] == 89.99
    assert "signature" in token_dict
    assert token_dict["merchant_id"] == "MERCHANT_A"


@pytest.mark.asyncio
async def test_greenlight_denies_unknown_merchant():
    checkout = _checkout(merchant_id="UNKNOWN_SHOP", total=50.00)
    from backend.agents.greenlight import request_dpat
    token_id, token_dict, error = await request_dpat(checkout, "USR001", "AUTH_002")

    assert token_id is None
    assert token_dict is None
    assert "MERCHANT_NOT_ALLOWED" in error


@pytest.mark.asyncio
async def test_greenlight_denies_over_limit():
    checkout = _checkout(merchant_id="MERCHANT_A", total=MAX_PURCHASE_AMOUNT + 1)
    from backend.agents.greenlight import request_dpat
    token_id, _, error = await request_dpat(checkout, "USR001", "AUTH_003")

    assert token_id is None
    assert "AMOUNT_EXCEEDS_LIMIT" in error


@pytest.mark.asyncio
async def test_greenlight_token_signature_verifies():
    checkout = _checkout(merchant_id="MERCHANT_A", total=89.99)
    from backend.agents.greenlight import request_dpat
    _, token_dict, _ = await request_dpat(checkout, "USR001", "AUTH_004")

    sig = token_dict.pop("signature")
    # issued_at is excluded from signing
    verify_data = {k: v for k, v in token_dict.items() if k != "issued_at"}
    assert verify_authorization(verify_data, sig) is True


# ── 6. REST API endpoints ─────────────────────────────────────────────────────

@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def test_health_endpoint(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_checkout_create_for_known_product(client, auth_headers):
    resp = client.post("/api/checkout/create", json={
        "product_id": "RW001",
        "merchant_id": "MERCHANT_A",
        "quantity": 1,
    }, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "checkout_id" in data
    assert "checkout_hash" in data
    assert data["product_id"] == "RW001"
    assert data["total"] > 0


def test_checkout_create_unknown_product(client, auth_headers):
    resp = client.post("/api/checkout/create", json={
        "product_id": "NONEXISTENT_999",
        "merchant_id": "MERCHANT_A",
        "quantity": 1,
    }, headers=auth_headers)
    assert resp.status_code == 404


def test_checkout_create_requires_auth(client):
    resp = client.post("/api/checkout/create", json={
        "product_id": "RW001",
        "merchant_id": "MERCHANT_A",
        "quantity": 1,
    })
    assert resp.status_code == 401


def test_approve_then_revoke(client, auth_headers):
    # First create a checkout
    resp = client.post("/api/checkout/create", json={
        "product_id": "RW001",
        "merchant_id": "MERCHANT_A",
        "quantity": 1,
    }, headers=auth_headers)
    assert resp.status_code == 200
    co = resp.json()

    # Approve it
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
    auth = resp.json()
    assert auth["token_id"].startswith("DPAT_")
    assert "expires_at" in auth

    # Revoke it
    resp = client.post("/api/authorizations/revoke", json={
        "token_id": auth["token_id"],
        "reason": "test_revocation",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "revoked"


def test_revoke_already_revoked_is_idempotent(client, auth_headers):
    resp = client.post("/api/checkout/create", json={
        "product_id": "RW001",
        "merchant_id": "MERCHANT_A",
        "quantity": 1,
    }, headers=auth_headers)
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
    token_id = resp.json()["token_id"]

    client.post("/api/authorizations/revoke", json={"token_id": token_id})
    resp2 = client.post("/api/authorizations/revoke", json={"token_id": token_id})
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "already_revoked"


def test_audit_trail_returns_events(client, auth_headers):
    resp = client.post("/api/checkout/create", json={
        "product_id": "RW001",
        "merchant_id": "MERCHANT_A",
        "quantity": 1,
    }, headers=auth_headers)
    co = resp.json()
    client.post("/api/authorizations/approve", json={
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
    resp = client.get(f"/api/audit/{co['checkout_id']}")
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) >= 2
    types = [e["event_type"] for e in events]
    assert "USER_APPROVED_PURCHASE" in types
    assert "DPAT_CREATED" in types
