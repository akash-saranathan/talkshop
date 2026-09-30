"""
Dashboard tests — wallet balance and delivery tracking.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _create_and_approve(client, auth_headers, product_id="RW001", merchant_id="MERCHANT_A"):
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


# ── Wallet ────────────────────────────────────────────────────────────────────

def test_new_user_starts_with_seeded_wallet_balance(client, auth_headers):
    resp = client.get("/api/wallet", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["balance"] == 1000.0
    assert data["currency"] == "USD"


def test_wallet_requires_auth(client):
    assert client.get("/api/wallet").status_code == 401


def test_successful_purchase_deducts_exact_amount_from_wallet(client, auth_headers):
    before = client.get("/api/wallet", headers=auth_headers).json()["balance"]

    co, auth = _create_and_approve(client, auth_headers)
    resp = client.post("/api/payments/execute", json=_execute_body(co, auth), headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"

    after = client.get("/api/wallet", headers=auth_headers).json()["balance"]
    assert after == pytest.approx(before - data["amount"])
    assert data["wallet_balance"] == pytest.approx(after)


def test_guardrail_blocked_purchase_does_not_touch_wallet(client, auth_headers):
    before = client.get("/api/wallet", headers=auth_headers).json()["balance"]

    co, auth = _create_and_approve(client, auth_headers)
    resp = client.post(
        "/api/payments/execute",
        json=_execute_body(co, auth, checkout_hash="TAMPERED"),
        headers=auth_headers,
    )
    assert resp.json()["blocked_reason"] == "CHECKOUT_HASH_MISMATCH"

    after = client.get("/api/wallet", headers=auth_headers).json()["balance"]
    assert after == before


def test_insufficient_balance_blocks_without_double_charging(client, auth_headers):
    """
    A purchase larger than the wallet balance is declined cleanly, the
    wallet is untouched, and the order is recorded as declined — not
    silently charged for a partial amount.
    """
    from backend.db.schema import Wallet
    from backend.db.session_utils import get_session

    user_id = client.get("/api/auth/me", headers=auth_headers).json()["user_id"]
    with get_session() as session:
        wallet = session.query(Wallet).filter(Wallet.user_id == user_id).first()
        wallet.balance = 10.0  # too little for any real seeded product
        session.commit()

    co, auth = _create_and_approve(client, auth_headers)
    resp = client.post("/api/payments/execute", json=_execute_body(co, auth), headers=auth_headers)
    data = resp.json()
    assert data["status"] == "blocked"
    assert data["blocked_reason"] == "INSUFFICIENT_BALANCE"

    after = client.get("/api/wallet", headers=auth_headers).json()["balance"]
    assert after == 10.0  # untouched by the declined attempt


# ── Delivery tracking ────────────────────────────────────────────────────────

def test_compute_delivery_status_just_placed_is_processing():
    from backend.agents.trackit import compute_delivery_status
    now = datetime.now(timezone.utc)
    result = compute_delivery_status(now, delivery_days=5)
    assert result["status"] == "processing"


def test_compute_delivery_status_mid_transit_is_shipped():
    from backend.agents.trackit import compute_delivery_status
    placed = datetime.now(timezone.utc) - timedelta(days=2)
    result = compute_delivery_status(placed, delivery_days=5)
    assert result["status"] == "shipped"


def test_compute_delivery_status_past_estimate_is_delivered():
    from backend.agents.trackit import compute_delivery_status
    placed = datetime.now(timezone.utc) - timedelta(days=10)
    result = compute_delivery_status(placed, delivery_days=5)
    assert result["status"] == "delivered"


def test_compute_delivery_status_handles_naive_datetime():
    from backend.agents.trackit import compute_delivery_status
    naive_now = datetime.now()
    result = compute_delivery_status(naive_now, delivery_days=3)
    assert result["status"] == "processing"


def test_confirmed_order_includes_tracking_and_delivery_fields(client, auth_headers):
    co, auth = _create_and_approve(client, auth_headers)
    client.post("/api/payments/execute", json=_execute_body(co, auth), headers=auth_headers)

    resp = client.get("/api/orders", headers=auth_headers)
    match = next(o for o in resp.json() if o["order_id"] == co["checkout_id"])
    assert match["tracking_number"].startswith("TRK")
    assert match["delivery_status"] == "processing"
    assert match["estimated_delivery"] is not None
    assert match["product_title"] == co["product_title"]
    assert match["product_category"] == "running_shoes"


def test_blocked_order_has_no_delivery_status(client, auth_headers):
    co, auth = _create_and_approve(client, auth_headers)
    client.post(
        "/api/payments/execute",
        json=_execute_body(co, auth, checkout_hash="TAMPERED"),
        headers=auth_headers,
    )

    resp = client.get("/api/orders", headers=auth_headers)
    match = next(o for o in resp.json() if o["order_id"] == co["checkout_id"])
    assert match["delivery_status"] is None
    assert match["tracking_number"] is None
