"""
Demo 2 acceptance tests: authenticated to Talkshop, guest to Nike.

T1 happy path · T2 trust failure · T3 tampering · T4 replay · T5/T6 delivery change
T7 card-data boundary · T8 search is not consent · T9 Talkshop-guest path
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app

PRODUCT = "nike_zoom_fly_6-9-black"
TEST_CARD = "4111111111111111"


@pytest.fixture
def client():
    return TestClient(app)


def _trust(client, headers, demo=None, chat_session_id=None):
    return client.post("/api/trust/session", json={
        "merchant_id": "nike", "chat_session_id": chat_session_id or uuid.uuid4().hex, "demo": demo,
    }, headers=headers)


def _propose(client, headers):
    trust = _trust(client, headers)
    assert trust.status_code == 200, trust.text
    resp = client.post("/api/purchase/checkout", json={
        "product_id": PRODUCT, "trusted_session_id": trust.json()["trusted_session"]["session_id"],
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _go_ahead(client, headers, proposal, **overrides):
    body = {
        "checkout_id": proposal["checkout_id"], "checkout_hash": proposal["checkout_hash"],
        "total": proposal["total"], "currency": proposal["currency"],
        "payment_method_id": proposal["payment_method"]["payment_method_id"],
    }
    body.update(overrides)
    return client.post("/api/purchase/go-ahead", json=body, headers=headers).json()


def _labels(result):
    return [e["label"] for e in result["events"]]


def _order_status(client, headers, order_id):
    orders = client.get("/api/orders", headers=headers).json()
    return next((o["status"] for o in orders if o["order_id"] == order_id), None)


# ── T1 ────────────────────────────────────────────────────────────────────────

def test_t1_happy_path_customer_is_known_to_talkshop_and_a_guest_to_nike(client, auth_headers):
    result = _propose(client, auth_headers)
    p = result["proposal"]
    assert p["talkshop_account"] == "authenticated"
    assert p["merchant_relationship"] == "merchant_guest"
    assert p["payment_method"]["display"].startswith("Visa ••••")
    assert p["delivery_date"] and p["checkout_hash"]
    assert _labels(result) == ["trusted_session_verified", "checkout_created", "ap2_checkout_bound", "order_proposal"]

    done = _go_ahead(client, auth_headers, p)
    assert done["status"] == "approved", done
    assert _labels(done) == [
        "customer_consent_received", "ap2_payment_authorization", "acp_token_issued",
        "trusted_session_verified", "acp_token_verified", "ap2_evidence_verified",
        "internal_dpat_issued", "payment_checks", "psp_result", "order_created", "order_confirmed",
    ]
    checks = next(e for e in done["events"] if e["label"] == "payment_checks")["detail"]
    assert (checks["passed"], checks["total"]) == (12, 12)
    order = done["order"]
    assert order["total"] == p["total"] and order["delivery_date"] == p["delivery_date"]
    assert _order_status(client, auth_headers, order["order_id"]) == "paid"


# ── T2 ────────────────────────────────────────────────────────────────────────

def test_t2_invalid_agent_credential_stops_before_checkout(client, auth_headers):
    chat = uuid.uuid4().hex
    trust = _trust(client, auth_headers, demo="bad_agent_credential", chat_session_id=chat)
    assert trust.status_code == 403
    assert trust.json()["failed_check"] == "credential_signature_valid"

    resp = client.post("/api/purchase/checkout", json={"product_id": PRODUCT, "chat_session_id": chat},
                       headers=auth_headers)
    assert resp.status_code == 403
    assert resp.json()["reason"] == "TRUST_VALIDATION_FAILED"
    assert client.get("/api/orders", headers=auth_headers).json() == []


def test_t2_checkout_without_any_trusted_session_is_refused(client, auth_headers):
    resp = client.post("/api/purchase/checkout", json={"product_id": PRODUCT, "chat_session_id": "never-connected"},
                       headers=auth_headers)
    assert resp.status_code == 403


# ── T3 ────────────────────────────────────────────────────────────────────────

def test_t3_consent_for_a_different_amount_is_rejected(client, auth_headers):
    p = _propose(client, auth_headers)["proposal"]
    result = _go_ahead(client, auth_headers, p, total=round(p["total"] + 20, 2))
    assert result["status"] == "rejected"
    assert result["reason"] == "CONSENT_DOES_NOT_MATCH_CHECKOUT"
    assert "acp_token_issued" not in _labels(result)
    assert _order_status(client, auth_headers, p["checkout_id"]) is None


def test_t3_charge_above_the_token_scope_is_rejected(client, auth_headers):
    p = _propose(client, auth_headers)["proposal"]
    result = _go_ahead(client, auth_headers, p, demo="tampered_amount")
    assert result["status"] == "rejected"
    assert result["reason"] == "AMOUNT_EXCEEDS_TOKEN_SCOPE"
    labels = _labels(result)
    assert "acp_token_rejected" in labels and "psp_result" not in labels and "order_created" not in labels
    assert _order_status(client, auth_headers, p["checkout_id"]) is None


# ── T4 ────────────────────────────────────────────────────────────────────────

def test_t4_replaying_a_used_token_is_rejected(client, auth_headers):
    p = _propose(client, auth_headers)["proposal"]
    first = _go_ahead(client, auth_headers, p)
    assert first["status"] == "approved"
    replay = client.post("/api/merchant/payments", json={
        "token_id": first["delegated_token_id"], "checkout_id": p["checkout_id"],
        "amount": p["total"], "currency": p["currency"],
    }, headers=auth_headers).json()
    assert replay["status"] == "rejected"
    assert replay["reason"] == "TOKEN_ALREADY_CONSUMED"
    assert _order_status(client, auth_headers, p["checkout_id"]) == "paid"  # the first outcome stands


# ── T5 / T6 ───────────────────────────────────────────────────────────────────

def test_t5_delivery_change_yes_reconsents_and_pays_with_new_date(client, auth_headers):
    p = _propose(client, auth_headers)["proposal"]
    paused = _go_ahead(client, auth_headers, p, demo="delivery_change")
    assert paused["status"] == "reconsent_required"
    assert paused["previous_delivery_date"] == p["delivery_date"]
    assert "psp_result" not in _labels(paused)
    assert _order_status(client, auth_headers, p["checkout_id"]) is None

    done = client.post("/api/purchase/reconsent", json={"checkout_id": p["checkout_id"], "decision": "yes"},
                       headers=auth_headers).json()
    assert done["status"] == "approved", done
    labels = _labels(done)
    assert labels[0] == "delegated_token_invalidated" and "reconsent_received" in labels
    assert done["order"]["delivery_date"] == paused["new_delivery_date"]


def test_t6_delivery_change_no_cancels_without_payment(client, auth_headers):
    p = _propose(client, auth_headers)["proposal"]
    paused = _go_ahead(client, auth_headers, p, demo="delivery_change")
    token_id = next(e for e in paused["events"] if e["label"] == "acp_token_issued")["detail"]["token_id"]

    done = client.post("/api/purchase/reconsent", json={"checkout_id": p["checkout_id"], "decision": "no"},
                       headers=auth_headers).json()
    assert done["status"] == "cancelled"
    assert _order_status(client, auth_headers, p["checkout_id"]) is None
    reuse = client.post("/api/merchant/payments", json={
        "token_id": token_id, "checkout_id": p["checkout_id"], "amount": p["total"], "currency": "USD",
    }, headers=auth_headers).json()
    assert reuse["status"] == "rejected" and reuse["reason"] == "TOKEN_REVOKED"


# ── T7 ────────────────────────────────────────────────────────────────────────

def test_t7_card_number_never_appears_in_responses_or_database(client, auth_headers):
    tok = client.post("/api/psp/tokenize", json={"number": TEST_CARD, "exp_month": 12, "exp_year": 2030,
                                                 "cvc": "987"}, headers=auth_headers)
    assert tok.status_code == 200
    pm = tok.json()["payment_method"]
    assert pm["last4"] == "1111" and TEST_CARD not in json.dumps(pm)

    trust = _trust(client, auth_headers).json()["trusted_session"]["session_id"]
    proposal = client.post("/api/purchase/checkout", json={"product_id": PRODUCT, "trusted_session_id": trust,
                                                          "payment_method_id": pm["payment_method_id"]},
                           headers=auth_headers).json()
    result = _go_ahead(client, auth_headers, proposal["proposal"])
    assert result["status"] == "approved"
    blob = json.dumps(proposal) + json.dumps(result)
    assert TEST_CARD not in blob and "987" not in json.dumps([e["detail"] for e in result["events"]])

    import sqlite3
    from backend.db.session_utils import DB_PATH
    con = sqlite3.connect(DB_PATH)
    for (table,) in con.execute("select name from sqlite_master where type='table'"):
        for row in con.execute(f"select * from {table}"):
            assert TEST_CARD not in json.dumps(row, default=str), f"card number found in {table}"


# ── T8 ────────────────────────────────────────────────────────────────────────

def test_t8_selection_creates_no_payment_authorization(client, auth_headers):
    p = _propose(client, auth_headers)["proposal"]
    from backend.db.schema import CustomerConsent, DelegatedPaymentToken, PaymentAuthorization, ProtocolMandate
    from backend.db.session_utils import get_session
    with get_session() as db:
        cid = p["checkout_id"]
        assert db.query(CustomerConsent).filter_by(checkout_id=cid).count() == 0
        assert db.query(DelegatedPaymentToken).filter_by(checkout_id=cid).count() == 0
        assert db.query(PaymentAuthorization).filter_by(order_id=cid).count() == 0
        types = {m.mandate_type for m in db.query(ProtocolMandate).filter_by(checkout_id=cid)}
        assert types == {"cart"}  # checkout evidence only: no intent-as-consent, no payment mandate


# ── T9 ────────────────────────────────────────────────────────────────────────

def test_t9_talkshop_guest_adds_a_card_by_reference_and_completes(client):
    guest = client.post("/api/auth/guest", json={"name": "Pat", "email": f"pat-{uuid.uuid4().hex[:6]}@example.com"})
    assert guest.status_code == 200, guest.text
    headers = {"Authorization": f"Bearer {guest.json()['access_token']}"}
    listing = client.get("/api/payment-methods", headers=headers).json()
    assert listing["talkshop_account"] == "talkshop_guest" and listing["payment_methods"] == []
    client.post("/api/psp/tokenize", json={"number": TEST_CARD, "exp_month": 1, "exp_year": 31, "cvc": "123"},
                headers=headers)
    p = _propose(client, headers)["proposal"]
    assert p["talkshop_account"] == "talkshop_guest" and p["merchant_relationship"] == "merchant_guest"
    assert _go_ahead(client, headers, p)["status"] == "approved"
