"""
Browsing for everyone (Oct 11): guests and customers without an eligible card
can browse the catalog and use Talkshop to find products. Adding to cart,
checkout, offers, points and payment stay for eligible cardmembers — Talkshop
asks them to sign in (or verify a card) and continues afterwards.
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.talkshop import brain
from tests.conftest import register_member


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def quiet_llm(monkeypatch):
    async def decide(message, *, stage, allowed, context, history):
        return {"action": "answer", "args": {}, "reply": "Happy to help!"}

    async def recommend(request, products):
        return {"intro": "Here you go:", "reasons": brain.fallback_reasons(products), "wants": {}}
    monkeypatch.setattr(brain, "decide", decide)
    monkeypatch.setattr(brain, "recommend", recommend)


def turn(client, h, sid, *, text=None, action=None):
    r = client.post("/api/talkshop/turn", json={"session_id": sid, "text": text, "action": action}, headers=h)
    assert r.status_code == 200, r.text
    return [json.loads(l[6:]) for b in r.text.split("\n\n") for l in b.splitlines() if l.startswith("data: ")]


def of(events, kind):
    return [e for e in events if e["type"] == kind]


def choose_flexrun(client, h, sid):
    turn(client, h, sid, text="I need running shoes under $150 for everyday running.")
    turn(client, h, sid, action={"type": "select", "product_id": "SSP002"})
    turn(client, h, sid, text="9")
    return turn(client, h, sid, text="orange")


def test_guest_finds_with_talkshop_but_must_sign_in_to_add(client):
    vis = client.post("/api/auth/visitor").json()
    h = {"Authorization": f"Bearer {vis['access_token']}"}
    sid = f"g-{uuid.uuid4().hex[:8]}"
    ev = turn(client, h, sid, text="I need running shoes under $150 for everyday running.")
    recs = of(ev, "recommendations")[0]["products"]
    assert recs and all(p.get("member") in (None, {}) or p["member"] is None for p in recs)
    turn(client, h, sid, action={"type": "select", "product_id": "SSP002"})
    turn(client, h, sid, text="9")
    ev = turn(client, h, sid, text="orange")
    assert of(ev, "login_required")[0]["reason"] == "sign_in" and not of(ev, "cart_updated")
    assert "sign in as a Chase credit-card member" in of(ev, "message")[-1]["text"]
    ev = turn(client, h, sid, action={"type": "checkout"})                  # can't sneak into checkout either
    assert not of(ev, "checkout_ready") and not of(ev, "cart_updated")


def test_after_signing_in_the_chosen_item_is_added(client):
    vis = client.post("/api/auth/visitor").json()
    vh = {"Authorization": f"Bearer {vis['access_token']}"}
    sid = f"g-{uuid.uuid4().hex[:8]}"
    choose_flexrun(client, vh, sid)
    r = client.post("/api/auth/login", json={"email": "marcus@shopsphere.demo", "password": "demo1234"}, headers=vh)
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}             # the conversation moves to Marcus
    ev = turn(client, h, sid, action={"type": "add_to_cart"})
    assert of(ev, "cart_updated") and of(ev, "offer_checkout")
    client.delete(f"/api/cart/lines/{of(ev, 'cart_updated')[0]['added_line_id']}", headers=h)


def test_signed_in_without_a_card_is_asked_to_verify(client):
    h, _ = register_member(account_type="checking")
    sid = f"c-{uuid.uuid4().hex[:8]}"
    ev = choose_flexrun(client, h, sid)
    assert of(ev, "login_required")[0]["reason"] == "not_eligible" and not of(ev, "cart_updated")
    assert "Verify your card" in of(ev, "message")[-1]["text"]


def test_members_still_add_straight_away(client):
    h, _ = register_member()
    sid = f"m-{uuid.uuid4().hex[:8]}"
    ev = choose_flexrun(client, h, sid)
    assert of(ev, "cart_updated") and not of(ev, "login_required")


def test_member_extras_only_for_members(client):
    vis = client.post("/api/auth/visitor").json()
    guest = client.get("/api/products/SSP002", headers={"Authorization": f"Bearer {vis['access_token']}"}).json()
    assert guest["member"] is None and guest["price"] == 139.0
    h, _ = register_member()
    member = client.get("/api/products/SSP002", headers=h).json()
    assert member["member"]["offers"][0]["offer_id"] == "OFF_RUN15"
