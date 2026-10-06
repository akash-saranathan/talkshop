"""
Shared pytest fixtures. auth_headers registers a fresh, isolated test user
(own $1000 wallet) for every test that requests it — most endpoints now
require a real logged-in user. Deliberately function-scoped, not session-
scoped: tests that execute real purchases deduct from the wallet, and a
shared session-scoped user would eventually hit INSUFFICIENT_BALANCE
partway through the suite depending on run order.
"""
import os
import tempfile
import uuid
from pathlib import Path

# Point the whole suite at its own throwaway database BEFORE any backend
# module is imported (they read COMMERCE_DB_PATH at import time), then seed
# it — so tests run against a fresh ShopSphere catalog and never touch the
# app's real backend/db/commerce.db.
_TEST_DB = Path(tempfile.mkdtemp(prefix="talkshop-tests-")) / "test.db"
os.environ["COMMERCE_DB_PATH"] = str(_TEST_DB)

from backend.db import init_db  # noqa: E402

init_db.run(_TEST_DB)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


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
