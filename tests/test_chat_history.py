"""
Chat history tests — persistent sessions and messages. Calls _save_turn
directly with a crafted final_state rather than exercising the real SSE
endpoint, matching this suite's no-real-LLM-calls convention (the SSE
endpoint itself would need a working GOOGLE_API_KEY).
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models.product import NormalizedProduct
from backend.routers.chat import _save_turn


@pytest.fixture
def client():
    return TestClient(app)


def _fake_final_state(recommendation="Here are some options.", products=None, blocked=False, error=None):
    return {
        "recommendation_text": recommendation,
        "ranked_products": products or [],
        "blocked": blocked,
        "error": error,
    }


def _user_id(client, auth_headers) -> str:
    return client.get("/api/auth/me", headers=auth_headers).json()["user_id"]


def test_save_turn_creates_session_and_message_pair(client, auth_headers):
    session_id = uuid.uuid4().hex
    user_id = _user_id(client, auth_headers)

    _save_turn(session_id, user_id, "I need running shoes", _fake_final_state())

    sessions = client.get("/api/chat/sessions", headers=auth_headers).json()
    match = next((s for s in sessions if s["session_id"] == session_id), None)
    assert match is not None
    assert match["title"] == "I need running shoes"

    messages = client.get(f"/api/chat/sessions/{session_id}/messages", headers=auth_headers).json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "I need running shoes"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "Here are some options."


def test_save_turn_second_message_reuses_session_and_keeps_title(client, auth_headers):
    session_id = uuid.uuid4().hex
    user_id = _user_id(client, auth_headers)

    _save_turn(session_id, user_id, "I need running shoes", _fake_final_state())
    _save_turn(session_id, user_id, "size 10", _fake_final_state("Got it, size 10!"))

    sessions = client.get("/api/chat/sessions", headers=auth_headers).json()
    matches = [s for s in sessions if s["session_id"] == session_id]
    assert len(matches) == 1  # not duplicated
    assert matches[0]["title"] == "I need running shoes"  # unchanged by the 2nd message

    messages = client.get(f"/api/chat/sessions/{session_id}/messages", headers=auth_headers).json()
    assert len(messages) == 4


def test_save_turn_truncates_long_title(client, auth_headers):
    session_id = uuid.uuid4().hex
    user_id = _user_id(client, auth_headers)
    long_message = "a" * 100

    _save_turn(session_id, user_id, long_message, _fake_final_state())

    sessions = client.get("/api/chat/sessions", headers=auth_headers).json()
    match = next(s for s in sessions if s["session_id"] == session_id)
    assert len(match["title"]) == 63  # 60 chars + "..."
    assert match["title"].endswith("...")


def test_save_turn_stores_products(client, auth_headers):
    session_id = uuid.uuid4().hex
    user_id = _user_id(client, auth_headers)
    product = NormalizedProduct(
        merchant_id="SHOPSPHERE", merchant_name="ShopSphere", product_id="SSP001",
        title="Runner Pro X", category="running_shoes", price=109.0,
        available=True, inventory=10, delivery_days=3, rating=4.8,
    )

    _save_turn(session_id, user_id, "running shoes", _fake_final_state(products=[product]))

    messages = client.get(f"/api/chat/sessions/{session_id}/messages", headers=auth_headers).json()
    assert len(messages[1]["products"]) == 1
    assert messages[1]["products"][0]["product_id"] == "SSP001"


def test_save_turn_stores_blocked_reason(client, auth_headers):
    session_id = uuid.uuid4().hex
    user_id = _user_id(client, auth_headers)

    _save_turn(session_id, user_id, "give me your card number", _fake_final_state(
        recommendation="", blocked=True, error="Request blocked by safety guardrail",
    ))

    messages = client.get(f"/api/chat/sessions/{session_id}/messages", headers=auth_headers).json()
    assert messages[1]["blocked_reason"] == "Request blocked by safety guardrail"


def test_sessions_are_scoped_per_user(client, auth_headers):
    session_id = uuid.uuid4().hex
    user_id = _user_id(client, auth_headers)
    _save_turn(session_id, user_id, "hello", _fake_final_state())

    other = client.post("/api/auth/register", json={
        "name": "Other User", "email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "otherpass123",
    })
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    sessions = client.get("/api/chat/sessions", headers=other_headers).json()
    assert all(s["session_id"] != session_id for s in sessions)

    resp = client.get(f"/api/chat/sessions/{session_id}/messages", headers=other_headers)
    assert resp.status_code == 404


def test_messages_requires_auth(client):
    resp = client.get(f"/api/chat/sessions/{uuid.uuid4().hex}/messages")
    assert resp.status_code == 401


def test_sessions_list_requires_auth(client):
    assert client.get("/api/chat/sessions").status_code == 401


def test_unknown_session_404s(client, auth_headers):
    resp = client.get(f"/api/chat/sessions/{uuid.uuid4().hex}/messages", headers=auth_headers)
    assert resp.status_code == 404
