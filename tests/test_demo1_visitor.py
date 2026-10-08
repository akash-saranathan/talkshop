"""
Demo 1, Phase 8 — shop without logging in. Visitors can browse, fill a cart
and chat with Talkshop; checkout, saved details and orders need an account.
Logging in or signing up brings the visitor's cart and conversation along.
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

def test_visitor_can_browse_and_fill_a_cart(client):
    h, _ = visitor(client)
    assert client.get("/api/products?department=shoes").status_code == 200
    r = client.post("/api/cart/lines", json={"sku": "SSP001-BLACK-8"}, headers=h)
    assert r.status_code == 200 and r.json()["item_count"] == 1
    assert client.get("/api/auth/me", headers=h).json()["is_visitor"] is True


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

def test_sign_up_moves_the_visitors_cart_into_the_new_account(client):
    h, vid = visitor(client)
    line = client.post("/api/cart/lines", json={"sku": "SSP059-BLACK"}, headers=h).json()["added_line_id"]
    body, _ = new_customer(client, h)
    assert body["user"]["is_visitor"] is False and body["merged_lines"] == {line: line}
    ch = {"Authorization": f"Bearer {body['access_token']}"}
    assert [l["sku"] for l in client.get("/api/cart/lines", headers=ch).json()["lines"]] == ["SSP059-BLACK"]
    with Session(get_engine()) as s:
        assert s.query(User).filter_by(user_id=vid).first() is None      # visitor removed


def test_login_merges_same_item_quantities(client):
    body, email = new_customer(client)
    ch = {"Authorization": f"Bearer {body['access_token']}"}
    kept = client.post("/api/cart/lines", json={"sku": "SSP003-BLUE-9"}, headers=ch).json()["added_line_id"]
    h, _ = visitor(client)
    vline = client.post("/api/cart/lines", json={"sku": "SSP003-BLUE-9"}, headers=h).json()["added_line_id"]
    other = client.post("/api/cart/lines", json={"sku": "SSP046-BLACK"}, headers=h).json()["added_line_id"]
    r = client.post("/api/auth/login", json={"email": email, "password": "customer123"}, headers=h).json()
    assert r["merged_lines"] == {vline: kept, other: other}
    lines = {l["sku"]: l["quantity"] for l in client.get("/api/cart/lines", headers=ch).json()["lines"]}
    assert lines == {"SSP003-BLUE-9": 2, "SSP046-BLACK": 1}


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


def test_visitor_chats_then_signs_in_at_checkout_and_continues(client, fake_llm):
    h, _ = visitor(client)
    sid = f"v-{uuid.uuid4().hex[:8]}"

    def turn(headers, **kw):
        r = client.post("/api/talkshop/turn", json={"session_id": sid, **kw}, headers=headers)
        assert r.status_code == 200
        return events(r)

    greet = turn(h, action={"type": "greet"})
    assert any(e["type"] == "message" and e["text"].startswith("Hi there") for e in greet)
    turn(h, text="I need running shoes under $150 for everyday running.")
    turn(h, action={"type": "select", "product_id": "SSP001"})
    turn(h, text="8")
    ev = turn(h, text="black")
    assert any(e["type"] == "cart_updated" for e in ev)              # visitors can add to the cart
    ev = turn(h, text="yes")
    assert any(e["type"] == "login_required" for e in ev)            # …but checking out needs an account
    assert not any(e["type"] == "checkout_ready" for e in ev)

    body, _ = new_customer(client, h)                                # signs up from the chat
    ch = {"Authorization": f"Bearer {body['access_token']}"}
    ev = turn(ch, action={"type": "checkout"})                       # the panel resumes
    need = next(e for e in ev if e["type"] == "checkout_details_needed")   # a new account has no address/card yet
    assert need["needs"] == {"guest": False, "address": True, "payment": True}
    addr = client.post("/api/me/addresses", headers=ch, json={
        "full_name": "New Shopper", "line1": "1 Main St", "city": "Austin", "state": "TX", "postal_code": "78701"}).json()
    turn(ch, action={"type": "details_added", "address_id": addr["address_id"]})
    card = client.post("/api/me/payment-methods", headers=ch, json={
        "number": "4242 4242 4242 4242", "exp_month": 12, "exp_year": 2030, "cvc": "123", "cardholder_name": "New"}).json()
    ev = turn(ch, action={"type": "details_added", "payment_method_id": card["payment_method_id"]})
    co = next(e for e in ev if e["type"] == "checkout_ready")["checkout"]
    assert [l["sku"] for l in co["lines"]] == ["SSP001-BLACK-8"] and co["total"] == 139.64
    snap = client.get(f"/api/talkshop/sessions/{sid}", headers=ch).json()
    assert snap["stage"] == "AWAITING_CONSENT" and snap["transcript"]   # conversation carried over
