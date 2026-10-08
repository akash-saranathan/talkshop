"""
Demo 1, Phase 10: every shopper can buy, and every order can be tracked.

The four checkout scenarios (existing customer with a saved card or wallet,
customer without a saved card, new customer, guest), the guest's data
boundary (no account, one-time card), the confirmation email (demo outbox),
and Track Order (Order ID + email), mapped to the 15 cases in the brief.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.db.init_db import get_engine
from backend.db.schema import EmailOutbox, Order, PaymentMethod, User, Wallet
from backend.main import app

HOME = {"full_name": "Test Shopper", "line1": "1 Main St", "city": "Austin", "state": "TX", "postal_code": "78701"}
CARD = {"number": "4242 4242 4242 4242", "exp_month": 12, "exp_year": 2030, "cvc": "123", "cardholder_name": "Test"}
NOT_FOUND = "We could not find an order matching the provided Order ID and email address."
SKU = "SSP002-ORANGE-9"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def restore_stock():
    """These tests buy the same shoe again and again: put its stock back after
    each one so other test modules still find it in stock."""
    from backend.db.schema import ProductVariant
    with Session(get_engine()) as db:
        before = {v.sku: v.stock for v in db.query(ProductVariant).filter(ProductVariant.product_id == "SSP002")}
    yield
    with Session(get_engine()) as db:
        for sku, stock in before.items():
            db.query(ProductVariant).filter_by(sku=sku).update({"stock": stock})
        db.commit()


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def customer(client):
    email = f"c-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/auth/register", json={"name": "Casey Customer", "email": email, "password": "customer123"})
    assert r.status_code == 200, r.text
    return bearer(r.json()["access_token"]), email


def visitor(client):
    r = client.post("/api/auth/visitor")
    return bearer(r.json()["access_token"]), r.json()["user"]["user_id"]


def add_line(client, h, sku=SKU):
    r = client.post("/api/cart/lines", json={"sku": sku, "quantity": 1}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["added_line_id"]


def checkout(client, h, guest=False):
    r = client.post("/api/checkouts", json={"line_ids": [add_line(client, h)], "guest": guest}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def confirm(client, h, co_id):
    r = client.post(f"/api/checkouts/{co_id}/confirm", json={"consent": True}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def guest_buys(client):
    """Visitor → Continue as guest → details → one-time card → order."""
    h, vid = visitor(client)
    co = checkout(client, h, guest=True)
    email = f"guest-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"/api/checkouts/{co['checkout_id']}/guest-details",
                    json={**HOME, "full_name": "Gita Guest", "email": email}, headers=h)
    assert r.status_code == 200, r.text
    card = client.post("/api/me/payment-methods", json=CARD, headers=h).json()
    client.patch(f"/api/checkouts/{co['checkout_id']}", json={"payment_method_id": card["payment_method_id"]}, headers=h)
    return h, vid, email, co["checkout_id"], confirm(client, h, co["checkout_id"])


def track(client, order_id, email, path=""):
    return client.post(f"/api/orders/track{path}", json={"order_id": order_id, "email": email})


# ── 1. Existing customer + saved card ────────────────────────────────────────

def test_1_customer_with_saved_card(client):
    h, email = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    client.post("/api/me/payment-methods", json=CARD, headers=h)
    co = checkout(client, h)
    assert co["ready"] and co["payment_method"]["display"] == "Visa •••• 4242"   # no card re-entry
    res = confirm(client, h, co["checkout_id"])
    order = res["order"]
    assert res["status"] == "authorized" and order["order_id"].startswith("SS-")
    assert order["payment_method_type"] == "card" and not order["guest"]
    assert res["confirmation_email"] == email
    assert any(o.get("display_id") == order["order_id"] for o in client.get("/api/orders", headers=h).json())


# ── 2. Existing customer + wallet ────────────────────────────────────────────

def test_2_customer_pays_with_wallet(client):
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    before = client.get("/api/wallet", headers=h).json()["balance"]
    co = checkout(client, h)
    co = client.patch(f"/api/checkouts/{co['checkout_id']}", json={"pay_with": "wallet"}, headers=h).json()
    assert co["ready"] and co["pay_with"] == "wallet" and co["payment_method"]["display"] == "ShopSphere Wallet"
    res = confirm(client, h, co["checkout_id"])
    assert res["status"] == "authorized" and res["order"]["payment"]["display"] == "ShopSphere Wallet"
    assert client.get("/api/wallet", headers=h).json()["balance"] == pytest.approx(before - co["total"])


def test_2b_wallet_too_low_is_declined_without_an_order(client):
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    me = client.get("/api/auth/me", headers=h).json()
    with Session(get_engine()) as db:
        db.query(Wallet).filter_by(user_id=me["user_id"]).update({"balance": 5.0})
        db.commit()
    co = checkout(client, h)
    co = client.patch(f"/api/checkouts/{co['checkout_id']}", json={"pay_with": "wallet"}, headers=h).json()
    assert not co["ready"] and any(i["code"] == "INSUFFICIENT_WALLET" for i in co["issues"])


# ── 3. Existing customer without a saved card ────────────────────────────────

def test_3_no_saved_card_uses_secure_payment_and_saves_only_if_asked(client):
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    co = checkout(client, h)
    assert any(i["code"] == "NO_PAYMENT_METHOD" for i in co["issues"])        # doesn't fail: asks for a card
    once = client.post("/api/me/payment-methods", json={**CARD, "save": False}, headers=h).json()
    assert once["saved"] is False and client.get("/api/me/payment-methods", headers=h).json() == []
    client.patch(f"/api/checkouts/{co['checkout_id']}", json={"payment_method_id": once["payment_method_id"]}, headers=h)
    assert confirm(client, h, co["checkout_id"])["status"] == "authorized"
    kept = client.post("/api/me/payment-methods", json={**CARD, "save": True}, headers=h).json()
    assert [c["payment_method_id"] for c in client.get("/api/me/payment-methods", headers=h).json()] == [kept["payment_method_id"]]


# ── 4. New customer (sign up) ────────────────────────────────────────────────

def test_4_new_customer_signs_up_and_buys(client):
    h, email = customer(client)
    co = checkout(client, h)
    assert {i["code"] for i in co["issues"]} >= {"NO_ADDRESS", "NO_PAYMENT_METHOD"}
    addr = client.post("/api/me/addresses", json=HOME, headers=h).json()       # the secure forms attach what they save
    card = client.post("/api/me/payment-methods", json=CARD, headers=h).json()
    client.patch(f"/api/checkouts/{co['checkout_id']}", headers=h,
                 json={"address_id": addr["address_id"], "payment_method_id": card["payment_method_id"]})
    res = confirm(client, h, co["checkout_id"])
    assert res["status"] == "authorized" and not res["order"]["guest"]
    assert any(o.get("display_id") == res["order"]["order_id"] for o in client.get("/api/orders", headers=h).json())


# ── 5–8. Guest checkout ──────────────────────────────────────────────────────

def test_5_guest_checkout_creates_no_account(client):
    h, vid = visitor(client)
    r = client.post("/api/checkouts", json={"line_ids": [add_line(client, h)]}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "LOGIN_REQUIRED"   # must pick log in / sign up / guest
    co = checkout(client, h, guest=True)
    assert co["guest"] == {"email": None, "name": None} and not co["ready"]
    r = client.post(f"/api/checkouts/{co['checkout_id']}/confirm", json={"consent": True}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "GUEST_DETAILS_REQUIRED"
    _, vid, email, _, res = guest_buys(client)
    assert res["status"] == "authorized" and res["order"]["guest"] is True
    with Session(get_engine()) as db:
        assert db.query(User).filter(User.email == email).count() == 0           # no customer account
        assert db.query(User).filter_by(user_id=vid).one().is_guest              # still an anonymous visitor
        card = db.query(PaymentMethod).filter_by(user_id=vid).one()
        assert card.saved is False                                               # guest cards are one-time


def test_5b_guest_details_are_validated(client):
    h, _ = visitor(client)
    co = checkout(client, h, guest=True)
    bad = client.post(f"/api/checkouts/{co['checkout_id']}/guest-details",
                      json={**HOME, "email": "not-an-email"}, headers=h)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "INVALID_EMAIL"
    bad = client.post(f"/api/checkouts/{co['checkout_id']}/guest-details",
                      json={**HOME, "email": "g@example.com", "state": "Texas"}, headers=h)
    assert bad.json()["detail"]["code"] == "INVALID_STATE"
    r = client.patch(f"/api/checkouts/{co['checkout_id']}", json={"pay_with": "wallet"}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "WALLET_UNAVAILABLE"   # wallet is for customers


def test_6_and_8_guest_order_id_and_confirmation(client):
    _, _, email, _, res = guest_buys(client)
    order_id = res["order"]["order_id"]
    assert order_id.startswith("SS-") and res["confirmation_email"] == email
    mail = track(client, order_id, email, "/email").json()
    assert mail["to"] == email and order_id in mail["subject"] and order_id in mail["body"]
    assert "Track order" in mail["body"] and "4242" not in mail["body"]          # no card details in email


def test_7_guest_payment_failure_creates_no_order(client):
    h, vid = visitor(client)
    co = checkout(client, h, guest=True)
    email = f"fail-{uuid.uuid4().hex[:6]}@example.com"
    client.post(f"/api/checkouts/{co['checkout_id']}/guest-details", json={**HOME, "email": email}, headers=h)
    card = client.post("/api/me/payment-methods", json=CARD, headers=h).json()
    with Session(get_engine()) as db:                                           # the processor will decline it
        db.query(PaymentMethod).filter_by(payment_method_id=card["payment_method_id"]).update({"behaviour": "decline"})
        db.commit()
    client.patch(f"/api/checkouts/{co['checkout_id']}", json={"payment_method_id": card["payment_method_id"]}, headers=h)
    res = confirm(client, h, co["checkout_id"])
    assert res["status"] == "declined"
    with Session(get_engine()) as db:
        assert db.query(Order).filter(Order.guest_email == email, Order.display_id.isnot(None)).count() == 0
        assert db.query(EmailOutbox).filter_by(to_email=email).count() == 0


# ── 9–11. Tracking by Order ID + email ───────────────────────────────────────

def test_9_10_11_guest_tracking(client):
    _, _, email, _, res = guest_buys(client)
    order_id = res["order"]["order_id"]
    r = track(client, order_id, email.upper())                                  # email match ignores case
    assert r.status_code == 200
    view = r.json()
    assert view["order_id"] == order_id and view["shipment"]["status"] == "processing"
    assert view["ship_to"] == {"city": "Austin", "state": "TX"}                 # no street address
    assert "guest_email" not in view and "internal_order_id" not in view
    wrong_email = track(client, order_id, "someone@else.com")
    wrong_id = track(client, "SS-00000", email)
    assert wrong_email.status_code == wrong_id.status_code == 404
    assert wrong_email.json() == wrong_id.json() == {"detail": {"code": "ORDER_NOT_FOUND", "message": NOT_FOUND}}


# ── 12–13. Registered history unchanged; guest orders stay separate ─────────

def test_12_13_registered_history_and_guest_separation(client):
    h, email = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    client.post("/api/me/payment-methods", json=CARD, headers=h)
    mine = confirm(client, h, checkout(client, h)["checkout_id"])["order"]["order_id"]
    gh, _, gemail, _, gres = guest_buys(client)
    guest_order = gres["order"]["order_id"]
    ids = [o.get("display_id") for o in client.get("/api/orders", headers=h).json()]
    assert mine in ids and guest_order not in ids
    assert track(client, mine, email).status_code == 200                        # customers can track by email too
    # the same browser later signs up: the guest order still belongs to no account
    r = client.post("/api/auth/register", headers=gh,
                    json={"name": "Later", "email": f"l-{uuid.uuid4().hex[:6]}@example.com", "password": "later1234"})
    nh = bearer(r.json()["access_token"])
    assert guest_order not in [o.get("display_id") for o in client.get("/api/orders", headers=nh).json()]
    assert track(client, guest_order, gemail).status_code == 200


# ── 14–15. Shipment lifecycle ────────────────────────────────────────────────

def test_14_15_shipment_lifecycle(client):
    _, _, email, _, res = guest_buys(client)
    order_id = res["order"]["order_id"]
    view = track(client, order_id, email).json()["shipment"]
    assert view["status"] == "processing" and view["tracking_number"] is None and view["simulated"]
    assert [s["done"] for s in view["steps"]] == [True, True, True, False, False, False, False]
    view = track(client, order_id, email, "/advance").json()["shipment"]        # packed
    assert view["status"] == "packed" and view["tracking_number"] is None
    view = track(client, order_id, email, "/advance").json()["shipment"]        # shipped → tracking ID
    assert view["status"] == "shipped" and view["tracking_number"].startswith("TRK") and len(view["tracking_number"]) == 9
    assert "simulated" in view["carrier"]
    for _ in range(4):
        view = track(client, order_id, email, "/advance").json()["shipment"]
    assert view["status"] == "delivered" and all(s["done"] for s in view["steps"])
    assert track(client, order_id, "x@y.com", "/advance").status_code == 404    # demo control needs ID + email too


# ── Talkshop: the same flows inside the chat ─────────────────────────────────

import json as _json

from backend.talkshop import brain


@pytest.fixture
def quiet_llm(monkeypatch):
    async def recommend(request, products):
        return {"intro": "Here you go:", "reasons": brain.fallback_reasons(products), "wants": {}}
    monkeypatch.setattr(brain, "recommend", recommend)


def say(client, h, sid, **kw):
    r = client.post("/api/talkshop/turn", json={"session_id": sid, **kw}, headers=h)
    assert r.status_code == 200, r.text
    return [_json.loads(l[6:]) for b in r.text.split("\n\n") for l in b.splitlines() if l.startswith("data: ")]


def first(ev, kind):
    return next(e for e in ev if e["type"] == kind)


def to_offer(client, h):
    sid = f"p10-{uuid.uuid4().hex[:8]}"
    say(client, h, sid, text="I need running shoes under $150 for everyday running.")
    say(client, h, sid, action={"type": "select", "product_id": "SSP002"})
    say(client, h, sid, text="9")
    say(client, h, sid, text="orange")
    return sid


def test_talkshop_guest_checkout_end_to_end(client, quiet_llm):
    h, vid = visitor(client)
    sid = to_offer(client, h)
    ev = say(client, h, sid, action={"type": "checkout"})
    assert first(ev, "login_required") and "continue as a guest" in first(ev, "message")["text"]
    ev = say(client, h, sid, action={"type": "checkout", "guest": True, "label": "Continue as guest"})
    need = first(ev, "checkout_details_needed")
    assert need["needs"]["guest"] and need["guest"] and need["wallet"] is None
    email = f"chat-guest-{uuid.uuid4().hex[:6]}@example.com"
    r = client.post(f"/api/checkouts/{need['checkout_id']}/guest-details", json={**HOME, "email": email}, headers=h)
    assert r.status_code == 200
    ev = say(client, h, sid, action={"type": "details_added", "label": "Details added"})
    assert first(ev, "checkout_details_needed")["needs"] == {"guest": False, "address": False, "payment": True}
    card = client.post("/api/me/payment-methods", json=CARD, headers=h).json()
    ev = say(client, h, sid, action={"type": "details_added", "payment_method_id": card["payment_method_id"]})
    co = first(ev, "checkout_ready")["checkout"]
    assert co["guest"]["email"] == email and co["payment_method"]["display"] == "Visa •••• 4242"
    ev = say(client, h, sid, action={"type": "go_ahead", "checkout_id": co["checkout_id"]})
    done = first(ev, "order_confirmed")
    assert done["order"]["guest"] and done["email"] == email
    assert email in [e["text"] for e in ev if e["type"] == "message"][-1]
    assert track(client, done["order"]["order_id"], email).status_code == 200
    with Session(get_engine()) as db:
        assert db.query(User).filter(User.email == email).count() == 0


def test_talkshop_customer_without_card_can_use_wallet(client, quiet_llm):
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    sid = to_offer(client, h)
    ev = say(client, h, sid, action={"type": "checkout"})
    need = first(ev, "checkout_details_needed")
    assert need["needs"]["payment"] and need["wallet"]["balance"] > 0 and not need["guest"]
    ev = say(client, h, sid, action={"type": "details_added", "pay_with": "wallet", "label": "Pay with wallet"})
    co = first(ev, "checkout_ready")["checkout"]
    assert co["pay_with"] == "wallet"
    ev = say(client, h, sid, action={"type": "go_ahead", "checkout_id": co["checkout_id"]})
    assert first(ev, "order_confirmed")["order"]["payment"]["display"] == "ShopSphere Wallet"


# ── Phase 11: tracking in Talkshop ───────────────────────────────────────────

from backend.talkshop import state as talk_state


def test_chat_tracks_an_order_with_id_and_email(client, quiet_llm):
    _, _, email, _, res = guest_buys(client)
    order_id = res["order"]["order_id"]
    h, vid = visitor(client)                                     # someone new, not logged in
    sid = f"trk-{uuid.uuid4().hex[:8]}"
    ev = say(client, h, sid, text=f"hey i have placed an order with this order id {order_id}, show me the order details and tracking")
    form = first(ev, "track_order_form")
    assert form["order_id"] == order_id and not [e for e in ev if e["type"] == "order_tracking"]
    ev = say(client, h, sid, action={"type": "track_order", "order_id": order_id, "email": "wrong@example.com",
                                     "label": f"Track order {order_id}"})
    assert "could not find an order" in first(ev, "message")["text"] and first(ev, "track_order_form")
    ev = say(client, h, sid, action={"type": "track_order", "order_id": order_id, "email": email,
                                     "label": f"Track order {order_id}"})
    shown = first(ev, "order_tracking")["order"]
    assert shown["order_id"] == order_id and shown["shipment"]["status"] == "processing"
    assert shown["ship_to"] == {"city": "Austin", "state": "TX"}
    s = talk_state.peek(vid, sid)
    assert email not in str(s.history)                           # the email never enters the LLM history


def test_chat_tracking_with_the_email_typed_in(client, quiet_llm):
    _, _, email, _, res = guest_buys(client)
    order_id = res["order"]["order_id"]
    h, vid = visitor(client)
    sid = f"trk-{uuid.uuid4().hex[:8]}"
    ev = say(client, h, sid, text=f"where is my order {order_id}? my email is {email}")
    assert first(ev, "order_tracking")["order"]["order_id"] == order_id
    assert email not in str(talk_state.peek(vid, sid).history)


def test_chat_shows_a_customers_own_order_without_email(client, quiet_llm):
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    client.post("/api/me/payment-methods", json=CARD, headers=h)
    order_id = confirm(client, h, checkout(client, h)["checkout_id"])["order"]["order_id"]
    ev = say(client, h, f"trk-{uuid.uuid4().hex[:8]}", text=f"track my order {order_id}")
    assert first(ev, "order_tracking")["order"]["order_id"] == order_id
    other, _ = customer(client)                                  # someone else's order still needs the email
    ev = say(client, other, f"trk-{uuid.uuid4().hex[:8]}", text=f"track order {order_id}")
    assert first(ev, "track_order_form") and not [e for e in ev if e["type"] == "order_tracking"]


def test_chat_where_is_my_order_asks_for_the_id(client, quiet_llm):
    h, _ = visitor(client)
    ev = say(client, h, f"trk-{uuid.uuid4().hex[:8]}", text="where is my order?")
    assert first(ev, "track_order_form")["order_id"] is None and "SS-12345" in first(ev, "message")["text"]


# ── Phase 11: real email delivery (fake SMTP server) ─────────────────────────

class FakeSMTP:
    sent: list = []
    fail = False

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        self.user = user

    def send_message(self, msg):
        if FakeSMTP.fail:
            raise OSError("mail server unreachable")
        FakeSMTP.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    from backend.shop import mailer, notifications
    for k, v in {"SMTP_HOST": "smtp.example.com", "SMTP_PORT": "587", "SMTP_USERNAME": "shop@example.com",
                 "SMTP_PASSWORD": "app-password", "SMTP_SECURITY": "starttls"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(notifications, "_dispatch", lambda job: job())          # send inline in tests
    FakeSMTP.sent, FakeSMTP.fail = [], False
    return FakeSMTP


def test_confirmation_email_is_really_sent(client, smtp, monkeypatch):
    from backend.shop import mailer
    monkeypatch.setattr(mailer, "deliverable", lambda a: True)               # test addresses use example.com
    _, _, email, _, res = guest_buys(client)
    order_id = res["order"]["order_id"]
    assert len(smtp.sent) == 1
    msg = smtp.sent[0]
    assert msg["To"] == email and order_id in msg["Subject"] and "shop@example.com" in msg["From"]
    body = msg.get_content()
    assert order_id in body and "/track?order=" + order_id in body and "4242424242424242" not in body
    assert track(client, order_id, email, "/email").json()["delivery"] == "sent"


def test_email_failure_never_undoes_the_order(client, smtp, monkeypatch):
    from backend.shop import mailer
    monkeypatch.setattr(mailer, "deliverable", lambda a: True)
    smtp.fail = True
    _, _, email, _, res = guest_buys(client)
    assert res["status"] == "authorized"
    mail = track(client, res["order"]["order_id"], email, "/email").json()
    assert mail["delivery"] == "failed"


# ── Automatic payment after the review countdown ─────────────────────────────

def test_auto_countdown_payment_records_how_consent_was_given(client, quiet_llm):
    import json as _j
    from backend.db.schema import AuditEvent
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    client.post("/api/me/payment-methods", json=CARD, headers=h)
    modes = []
    for consent in ("auto_countdown", None):
        sid = to_offer(client, h)
        co = first(say(client, h, sid, action={"type": "checkout"}), "checkout_ready")["checkout"]
        action = {"type": "go_ahead", "checkout_id": co["checkout_id"], **({"consent": consent} if consent else {})}
        assert first(say(client, h, sid, action=action), "order_confirmed")
        with Session(get_engine()) as db:
            ev = (db.query(AuditEvent).filter(AuditEvent.event_type == "CHECKOUT_CONSENT",
                                              AuditEvent.order_id.like(f"{co['checkout_id']}-%")).one())
            modes.append(_j.loads(ev.metadata_json)["mode"])
    assert modes == ["auto_countdown", "button"]


def test_made_up_addresses_are_not_mailed(client, smtp):
    """kaajal@shopsphere.demo, example.com… would only bounce: they stay in the outbox."""
    from backend.shop.mailer import deliverable
    assert not deliverable("kaajal@shopsphere.demo") and not deliverable("a@example.com") and deliverable("a@gmail.com")
    _, _, email, _, res = guest_buys(client)                                    # guest email is @example.com
    assert smtp.sent == [] and track(client, res["order"]["order_id"], email, "/email").json()["delivery"] == "outbox"


# ── Logged-in customers track their own orders without ID or email ───────────

def _buy(client, h, sku):
    line = add_line(client, h, sku)
    co = client.post("/api/checkouts", json={"line_ids": [line]}, headers=h).json()
    return confirm(client, h, co["checkout_id"])["order"]["order_id"]


def test_logged_in_customer_asks_by_product_name(client, quiet_llm):
    h, _ = customer(client)
    client.post("/api/me/addresses", json=HOME, headers=h)
    client.post("/api/me/payment-methods", json=CARD, headers=h)
    shoes = _buy(client, h, "SSP004-TEAL-10")          # Nike Pegasus 41
    wallet = _buy(client, h, "SSP046-BLACK")            # newer order
    ev = say(client, h, f"own-{uuid.uuid4().hex[:6]}", text="hey i placed an order of nike shoes, where is it?")
    assert first(ev, "order_tracking")["order"]["order_id"] == shoes            # matched by product, not newest
    assert not [e for e in ev if e["type"] in ("track_order_form", "recommendations")]
    ev = say(client, h, f"own-{uuid.uuid4().hex[:6]}", text="where is my order?")
    assert first(ev, "order_tracking")["order"]["order_id"] == wallet           # newest when nothing named
    assert f"Track {shoes}" in first(ev, "suggestions")["chips"]                # the others offered as buttons


def test_logged_in_customer_with_no_orders(client, quiet_llm):
    h, _ = customer(client)
    ev = say(client, h, f"own-{uuid.uuid4().hex[:6]}", text="where is my order?")
    assert "haven't placed any orders" in first(ev, "message")["text"]


def test_guest_still_needs_id_and_email(client, quiet_llm):
    h, _ = visitor(client)
    ev = say(client, h, f"own-{uuid.uuid4().hex[:6]}", text="hey i placed an order of nike shoes, where is it?")
    assert first(ev, "track_order_form") and not [e for e in ev if e["type"] == "order_tracking"]
