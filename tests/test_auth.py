"""
Authentication tests — register, login, and token-gated access.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _unique_email() -> str:
    return f"test-{uuid.uuid4().hex[:8]}@example.com"


# ── Register ──────────────────────────────────────────────────────────────────

def test_register_creates_account_and_returns_token(client):
    email = _unique_email()
    resp = client.post("/api/auth/register", json={
        "name": "New User", "email": email, "password": "testpass123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["access_token"]
    assert data["user"]["email"] == email
    assert data["user"]["user_id"].startswith("USR")


def test_register_rejects_duplicate_email(client):
    email = _unique_email()
    body = {"name": "Dup User", "email": email, "password": "testpass123"}
    assert client.post("/api/auth/register", json=body).status_code == 200
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_register_rejects_short_password(client):
    resp = client.post("/api/auth/register", json={
        "name": "Short Pass", "email": _unique_email(), "password": "short",
    })
    assert resp.status_code == 422


# ── Login ─────────────────────────────────────────────────────────────────────

def test_login_succeeds_with_correct_password(client):
    email = _unique_email()
    client.post("/api/auth/register", json={"name": "Login User", "email": email, "password": "correcthorse"})
    resp = client.post("/api/auth/login", json={"email": email, "password": "correcthorse"})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_login_rejects_wrong_password(client):
    email = _unique_email()
    client.post("/api/auth/register", json={"name": "Wrong Pass", "email": email, "password": "correcthorse"})
    resp = client.post("/api/auth/login", json={"email": email, "password": "wrongpassword"})
    assert resp.status_code == 401


def test_login_rejects_unknown_email(client):
    resp = client.post("/api/auth/login", json={"email": _unique_email(), "password": "whatever123"})
    assert resp.status_code == 401


# ── Protected route (get_current_user) ──────────────────────────────────────────

def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_rejects_garbage_token(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_me_returns_current_user_with_valid_token(client):
    email = _unique_email()
    reg = client.post("/api/auth/register", json={"name": "Me User", "email": email, "password": "testpass123"})
    token = reg.json()["access_token"]
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == email


def test_get_current_user_accepts_query_param_token(client):
    """The chat SSE endpoint authenticates via ?token= since EventSource can't set headers."""
    email = _unique_email()
    reg = client.post("/api/auth/register", json={"name": "Query User", "email": email, "password": "testpass123"})
    token = reg.json()["access_token"]
    resp = client.get(f"/api/auth/me?token={token}")
    assert resp.status_code == 200
    assert resp.json()["email"] == email


# ── security.py unit tests ───────────────────────────────────────────────────────

def test_password_is_hashed_not_stored_plaintext():
    from backend.auth.security import hash_password
    hashed = hash_password("supersecret")
    assert hashed != "supersecret"
    assert hashed.startswith("$2b$") or hashed.startswith("$2a$")


def test_verify_password_roundtrip():
    from backend.auth.security import hash_password, verify_password
    hashed = hash_password("mypassword")
    assert verify_password("mypassword", hashed) is True
    assert verify_password("wrongpassword", hashed) is False


def test_decode_access_token_rejects_garbage():
    from backend.auth.security import decode_access_token
    assert decode_access_token("not.a.valid.jwt") is None


def test_create_and_decode_access_token_roundtrip():
    from backend.auth.security import create_access_token, decode_access_token
    token = create_access_token("USR999")
    assert decode_access_token(token) == "USR999"


# ── Guest sessions ────────────────────────────────────────────────────────────

def test_guest_creates_session_for_new_email(client):
    email = _unique_email()
    resp = client.post("/api/auth/guest", json={"name": "Guest User", "email": email})
    assert resp.status_code == 200
    assert resp.json()["access_token"]
    assert resp.json()["user"]["email"] == email


def test_guest_email_and_name_are_not_stored(client):
    from backend.db.schema import User
    from backend.db.session_utils import get_session
    email = _unique_email()
    data = client.post("/api/auth/guest", json={"name": "Private Guest", "email": email}).json()
    # Echoed back for the UI...
    assert data["user"]["email"] == email
    assert data["user"]["name"] == "Private Guest"
    # ...but never persisted.
    with get_session() as session:
        assert session.query(User).filter(User.email == email).first() is None
        row = session.query(User).filter(User.user_id == data["user"]["user_id"]).first()
        assert row.is_guest and row.name == "Guest" and row.email.endswith("@guest.invalid")


def test_guest_email_can_register_later(client):
    email = _unique_email()
    client.post("/api/auth/guest", json={"name": "Guest First", "email": email})
    resp = client.post("/api/auth/register", json={"name": "Now Customer", "email": email, "password": "customer123"})
    assert resp.status_code == 200


def test_guest_refuses_registered_customer_email(client):
    email = _unique_email()
    client.post("/api/auth/register", json={"name": "Real Customer", "email": email, "password": "customer123"})
    resp = client.post("/api/auth/guest", json={"name": "Someone Else", "email": email})
    assert resp.status_code == 409
    assert "already a customer" in resp.json()["detail"]


def test_guest_attempt_does_not_change_customer_password(client):
    email = _unique_email()
    client.post("/api/auth/register", json={"name": "Real Customer", "email": email, "password": "customer123"})
    client.post("/api/auth/guest", json={"name": "Someone Else", "email": email})
    resp = client.post("/api/auth/login", json={"email": email, "password": "customer123"})
    assert resp.status_code == 200
