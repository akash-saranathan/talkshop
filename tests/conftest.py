"""
Shared pytest fixtures. auth_headers registers (or logs into) one test user
once per session and returns a ready-to-use Authorization header, since most
endpoints now require a real logged-in user.
"""
import pytest
from fastapi.testclient import TestClient

TEST_EMAIL = "pytest-user@example.com"
TEST_PASSWORD = "pytest1234"


@pytest.fixture(scope="session")
def _test_user_token() -> str:
    from backend.main import app
    client = TestClient(app)

    resp = client.post("/api/auth/register", json={
        "name": "Pytest User", "email": TEST_EMAIL, "password": TEST_PASSWORD,
    })
    if resp.status_code == 409:
        resp = client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def auth_headers(_test_user_token) -> dict:
    return {"Authorization": f"Bearer {_test_user_token}"}
