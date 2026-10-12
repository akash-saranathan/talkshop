"""
Demo 1, Phase 8 — visitor sessions. Part 2 made ShopSphere a cardmember-only
marketplace: a visitor session still exists (so the gate page can explain why
it can't enter), but browsing, the cart and Talkshop now need an eligible
cardmember sign-in. Visitor accounts still store nothing personal.
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.db.init_db import get_engine
from backend.db.schema import User
from backend.main import app
from backend.talkshop import brain

DEMO = {"email": "kaajal@shopsphere.demo", "password": "demo1234"}


@pytest.fixture
def client():
    return TestClient(app)


def visitor(client):
    r = client.post("/api/auth/visitor")
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["is_visitor"] is True
    return {"Authorization": f"Bearer {body['access_token']}"}, body["user"]["user_id"]


def new_customer(client, headers=None):
    email = f"cust-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/auth/register", json={"name": "New Customer", "email": email, "password": "customer123"},
                    headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json(), email


def events(r):
    return [json.loads(l[6:]) for b in r.text.split("\n\n") for l in b.splitlines() if l.startswith("data: ")]


# ── Browsing and the cart are open ───────────────────────────────────────────



@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/checkouts", {"line_ids": ["X"]}),
    ("get", "/api/me/addresses", None),
    ("get", "/api/me/payment-methods", None),
    ("get", "/api/orders", None),
    ("get", "/api/wallet", None),
])
def test_checkout_details_and_orders_need_login(client, method, path, body):
    h, _ = visitor(client)
    r = getattr(client, method)(path, headers=h, **({"json": body} if body else {}))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "LOGIN_REQUIRED"


def test_visitor_record_stores_no_personal_details(client):
    _, vid = visitor(client)
    with Session(get_engine()) as s:
        u = s.query(User).filter_by(user_id=vid).one()
    assert u.is_guest and u.name == "Visitor" and u.email.endswith("@visitor.invalid")


def test_visitor_accounts_cannot_be_logged_in_to(client):
    _, vid = visitor(client)
    r = client.post("/api/auth/login", json={"email": f"{vid.lower()}@visitor.invalid", "password": "anything"})
    assert r.status_code == 401 or r.status_code == 422


# ── Logging in / signing up brings the cart along ────────────────────────────





def test_plain_login_without_a_visitor_changes_nothing(client):
    r = client.post("/api/auth/login", json=DEMO)
    assert r.status_code == 200 and r.json()["merged_lines"] == {}


# ── Talkshop: chat freely, sign in to check out, carry on ────────────────────

@pytest.fixture
def fake_llm(monkeypatch):
    async def decide(message, **_):
        return {"action": "search", "args": {"query": "everyday running", "category": "running_shoes", "max_price": 150.0}, "reply": ""}

    async def recommend(request, products):
        return {"intro": "Three options:", "reasons": brain.fallback_reasons(products)}
    monkeypatch.setattr(brain, "decide", decide)
    monkeypatch.setattr(brain, "recommend", recommend)


def test_visitor_can_browse_but_not_fill_a_cart(client):
    """Part 2: a visitor browses the catalog (no member extras) and can chat with
    Talkshop, but the cart and checkout are for eligible cardmembers."""
    h, _ = visitor(client)
    assert client.get("/api/products", headers=h).status_code == 200
    assert client.post("/api/talkshop/turn", json={"session_id": "vis12345", "text": "hi"}, headers=h).status_code == 200
    for r in (client.get("/api/cart/lines", headers=h),
              client.post("/api/cart/lines", json={"sku": "SSP002-ORANGE-9"}, headers=h)):
        assert r.status_code == 403 and r.json()["detail"]["code"] == "LOGIN_REQUIRED"

