"""
Shared pytest fixtures. auth_headers registers a fresh, isolated test user
(own $1000 wallet) for every test that requests it — most endpoints now
require a real logged-in user. Deliberately function-scoped, not session-
scoped: tests that execute real purchases deduct from the wallet, and a
shared session-scoped user would eventually hit INSUFFICIENT_BALANCE
partway through the suite depending on run order.
"""
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def auth_headers() -> dict:
    from backend.main import app
    client = TestClient(app)
    email = f"pytest-{uuid.uuid4().hex[:10]}@example.com"
    resp = client.post("/api/auth/register", json={
        "name": "Pytest User", "email": email, "password": "pytest1234",
    })
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
