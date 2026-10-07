"""Main purchase chain: AP2 cart → approval (DPAT) → AP2 payment mandate → ACP token → PayIt."""
import json

from fastapi.testclient import TestClient

from backend.db.schema import AcpSharedToken
from backend.db.session_utils import get_session
from backend.graph import session_state
from backend.main import app
from backend.merchants import catalog as merchant_catalog

FIELDS = ["checkout_id", "checkout_hash", "merchant_id", "total", "currency", "product_id",
          "product_title", "merchant_name", "subtotal", "tax", "shipping"]


def _nike_product():
    return merchant_catalog.search("Nike running shoes", "running_shoes", "Nike", None, None)[0]


def _checkout(client, headers, session_id=None):
    product = _nike_product()
    body = {"product_id": product.product_id, "merchant_id": product.merchant_id, "quantity": 1}
    if session_id:
        body["session_id"] = session_id
    resp = client.post("/api/checkout/create", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _approve(client, headers, checkout):
    body = {k: checkout[k] for k in FIELDS}
    body.update({"card_brand": "Visa", "card_last4": "4242"})
    resp = client.post("/api/authorizations/approve", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _execute(client, headers, checkout, approval, **overrides):
    body = {
        "token_id": approval["token_id"], "checkout_id": checkout["checkout_id"],
        "checkout_hash": checkout["checkout_hash"], "merchant_id": checkout["merchant_id"],
        "merchant_name": checkout["merchant_name"], "total": checkout["total"],
        "currency": checkout["currency"], "product_id": checkout["product_id"],
        "product_title": checkout["product_title"], "subtotal": checkout["subtotal"],
        "tax": checkout["tax"], "shipping": checkout["shipping"], "payment_method": "card",
    }
    body.update(overrides)
    resp = client.post("/api/payments/execute", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_full_chain_executes_with_session_intent(auth_headers):
    client = TestClient(app)
    session_id = "chain-" + auth_headers["Authorization"][-8:]
    session_state.save_context(session_id, {"raw_query": "Nike running shoes", "brand": "Nike", "category": "running_shoes"})

    checkout = _checkout(client, auth_headers, session_id)
    assert checkout["ap2"]["intent_mandate_id"].startswith("urn:ap2:mandate:intent:")
    assert checkout["ap2"]["cart_mandate_id"].startswith("urn:ap2:mandate:cart:")
    assert checkout["ap2"]["cart_verified"] is True

    approval = _approve(client, auth_headers, checkout)
    assert approval["protocols"]["ap2_payment_mandate_id"].startswith("urn:ap2:mandate:payment:")
    assert approval["protocols"]["acp_spt_id"].startswith("spt_")
    assert approval["protocols"]["dpat_token_id"] == approval["token_id"]

    executed = _execute(client, auth_headers, checkout, approval)
    assert executed["status"] == "success"
    assert executed["protocols"]["ap2_cart_verified"] is True
    assert executed["protocols"]["acp_verified"] is True
    assert len(executed["guardrail_events"]) == 12


def test_checkout_without_session_has_no_intent(auth_headers):
    client = TestClient(app)
    checkout = _checkout(client, auth_headers)
    assert checkout["ap2"]["intent_mandate_id"] is None
    assert checkout["ap2"]["cart_verified"] is True


def test_tampered_checkout_hash_blocked_before_payit_and_token_survives(auth_headers):
    client = TestClient(app)
    checkout = _checkout(client, auth_headers)
    approval = _approve(client, auth_headers, checkout)

    blocked = _execute(client, auth_headers, checkout, approval, checkout_hash="0" * 64)
    assert blocked["status"] == "blocked"
    assert blocked["blocked_reason"] == "cart_mandate_checkout_hash_mismatch"

    # The token was not consumed by the blocked attempt, so the genuine payment still succeeds.
    genuine = _execute(client, auth_headers, checkout, approval)
    assert genuine["status"] == "success"


def test_tampered_acp_token_blocked(auth_headers):
    client = TestClient(app)
    checkout = _checkout(client, auth_headers)
    approval = _approve(client, auth_headers, checkout)

    with get_session() as session:
        row = session.query(AcpSharedToken).filter(AcpSharedToken.dpat_token_id == approval["token_id"]).one()
        doc = json.loads(row.document)
        doc["token"]["constraints"]["maximum_amount"] = 999999999
        row.document = json.dumps(doc)
        session.commit()

    blocked = _execute(client, auth_headers, checkout, approval)
    assert blocked["status"] == "blocked"
    assert blocked["blocked_reason"] == "acp_signature_mismatch"
