"""
Phase 2 — protocol layer tests.
Covers: UCP checkout sessions, ACP SPT issuance/verification, AP2 mandate chain,
intent parsing, and merchant routing.
"""
import pytest
import time

from backend.ucp.adapter import UCPAdapter
from backend.acp.adapter import ACPAdapter
from backend.acp.token import issue_spt, verify_spt
from backend.ap2.adapter import AP2Adapter
from backend.agents.generic_shopping_agent import parse_intent, route_merchants


# ── Sample product (mimics what A2A search returns) ───────────────────────────

_PRODUCT = {
    "id": "nike_001",
    "title": "Nike Air Max 2024",
    "price": 109.99,
    "category": "shoes",
    "rating": 4.7,
    "merchant_id": "nike",
    "merchant_name": "Nike",
}


# ── UCP ───────────────────────────────────────────────────────────────────────

class TestUCP:
    def setup_method(self):
        self.ucp = UCPAdapter()

    def test_create_session_returns_ready(self):
        s = self.ucp.create_session(_PRODUCT, quantity=1)
        assert s.status == "ready_for_complete"
        assert s.id.startswith("ucp_")
        assert s.currency == "USD"

    def test_totals_structure(self):
        s = self.ucp.create_session(_PRODUCT, quantity=1)
        types = {t.type for t in s.totals}
        assert types == {"subtotal", "fulfillment", "tax", "total"}

    def test_subtotal_correct(self):
        s = self.ucp.create_session(_PRODUCT, quantity=2)
        t = self.ucp.totals_dict(s)
        assert t["subtotal"] == round(109.99 * 2, 2)

    def test_free_shipping_over_threshold(self):
        expensive = {**_PRODUCT, "price": 150.0}
        s = self.ucp.create_session(expensive, quantity=1)
        t = self.ucp.totals_dict(s)
        assert t["fulfillment"] == 0.0

    def test_flat_shipping_under_threshold(self):
        cheap = {**_PRODUCT, "price": 49.99}
        s = self.ucp.create_session(cheap, quantity=1)
        t = self.ucp.totals_dict(s)
        assert t["fulfillment"] == 9.99

    def test_tax_is_eight_percent(self):
        s = self.ucp.create_session(_PRODUCT, quantity=1)
        t = self.ucp.totals_dict(s)
        assert abs(t["tax"] - round(t["subtotal"] * 0.08, 2)) < 0.01

    def test_total_equals_sum(self):
        s = self.ucp.create_session(_PRODUCT, quantity=1)
        t = self.ucp.totals_dict(s)
        expected = round(t["subtotal"] + t["fulfillment"] + t["tax"], 2)
        assert abs(t["total"] - expected) < 0.01

    def test_complete_session_returns_order(self):
        s = self.ucp.create_session(_PRODUCT)
        result = self.ucp.complete_session(s.id, "spt_testtoken", "visa", "4242")
        assert result.status == "completed"
        assert result.order is not None
        assert result.order.id.startswith("order_")

    def test_complete_unknown_session_raises(self):
        with pytest.raises(ValueError, match="not found"):
            self.ucp.complete_session("ucp_nonexistent", "tok", "visa", "0000")

    def test_complete_updates_session_status(self):
        s = self.ucp.create_session(_PRODUCT)
        self.ucp.complete_session(s.id, "spt_x", "visa", "4242")
        stored = self.ucp.get_session(s.id)
        assert stored.status == "completed"

    def test_ucp_version_in_response(self):
        s = self.ucp.create_session(_PRODUCT)
        assert s.ucp.version == "2026-01-23"

    def test_line_items_have_correct_product(self):
        s = self.ucp.create_session(_PRODUCT, quantity=3)
        assert len(s.line_items) == 1
        li = s.line_items[0]
        assert li.item.id == _PRODUCT["id"]
        assert li.item.title == _PRODUCT["title"]
        assert li.quantity == 3

    def test_fulfillment_has_shipping_method(self):
        s = self.ucp.create_session(_PRODUCT)
        assert s.fulfillment is not None
        assert len(s.fulfillment.methods) == 1
        assert s.fulfillment.methods[0].type == "shipping"


# ── ACP ───────────────────────────────────────────────────────────────────────

class TestACP:
    def setup_method(self):
        self.acp = ACPAdapter()

    def test_issue_returns_spt(self):
        tok = self.acp.issue("mock_pm_4242", "nike", 11661, "visa", "4242")
        assert tok.id.startswith("spt_")
        assert tok.status == "active"
        assert tok.brand == "visa"
        assert tok.last4 == "4242"

    def test_spt_constraints_match_requested_amount(self):
        tok = self.acp.issue("mock_pm_4242", "nike", 9999, "visa", "4242")
        assert tok.constraints.maximum_amount == 9999
        assert tok.constraints.currency == "USD"

    def test_verify_active_token_succeeds(self):
        tok = self.acp.issue("mock_pm_4242", "nike", 11661, "visa", "4242")
        ok, reason = self.acp.verify(tok.id, "nike", 11661)
        assert ok is True
        assert reason == ""

    def test_verify_amount_over_limit_fails(self):
        tok = self.acp.issue("mock_pm_4242", "nike", 10000, "visa", "4242")
        ok, reason = self.acp.verify(tok.id, "nike", 10001)
        assert ok is False
        assert "amount" in reason

    def test_verify_wrong_seller_fails(self):
        tok = self.acp.issue("mock_pm_4242", "nike", 10000, "visa", "4242")
        ok, reason = self.acp.verify(tok.id, "adidas", 10000)
        assert ok is False
        assert "seller" in reason

    def test_verify_unknown_token_fails(self):
        ok, reason = self.acp.verify("spt_nonexistent", "nike", 100)
        assert ok is False
        assert "not_found" in reason

    def test_spt_has_expiry(self):
        tok = self.acp.issue("mock_pm_4242", "nike", 10000)
        assert tok.constraints.expiration > int(time.time())
        assert tok.constraints.expiration <= int(time.time()) + 901  # ≤ 15 min


# ── AP2 ───────────────────────────────────────────────────────────────────────

class TestAP2:
    def setup_method(self):
        self.ap2 = AP2Adapter()
        self.ucp = UCPAdapter()

    def _make_session(self):
        return self.ucp.create_session(_PRODUCT, quantity=1)

    def test_intent_mandate_shape(self):
        m = self.ap2.create_intent_mandate("shoes", "user_abc", ["nike"])
        assert m.id.startswith("urn:ap2:mandate:intent:")
        assert "IntentMandate" in m.type
        assert m.issuer.startswith("did:demo:user:")
        assert "natural_language_description" in m.credentialSubject

    def test_cart_mandate_shape(self):
        s = self._make_session()
        totals = self.ucp.totals_dict(s)
        m = self.ap2.create_cart_mandate(_PRODUCT, 1, totals, s.id, "urn:ap2:mandate:intent:abc")
        assert m.id.startswith("urn:ap2:mandate:cart:")
        assert "CartMandate" in m.type
        assert "checkout_hash" in m.credentialSubject
        assert m.credentialSubject["intent_mandate_id"] == "urn:ap2:mandate:intent:abc"

    def test_payment_mandate_shape(self):
        s = self._make_session()
        totals = self.ucp.totals_dict(s)
        cart_m = self.ap2.create_cart_mandate(_PRODUCT, 1, totals, s.id, "urn:ap2:intent:abc")
        pay_m = self.ap2.create_payment_mandate(cart_m, "order_test", "spt_abc", "user_abc")
        assert pay_m.id.startswith("urn:ap2:mandate:payment:")
        assert "PaymentMandate" in pay_m.type
        assert pay_m.credentialSubject["cart_mandate_id"] == cart_m.id
        assert pay_m.credentialSubject["checkout_hash"] == cart_m.credentialSubject["checkout_hash"]
        assert pay_m.credentialSubject["payment_ref"] == "spt_abc"

    def test_intent_mandate_verifies(self):
        m = self.ap2.create_intent_mandate("shoes", "user_abc", ["nike"])
        assert self.ap2.verify_mandate(m) is True

    def test_cart_mandate_verifies(self):
        s = self._make_session()
        totals = self.ucp.totals_dict(s)
        m = self.ap2.create_cart_mandate(_PRODUCT, 1, totals, s.id, "urn:ap2:intent:abc")
        assert self.ap2.verify_mandate(m) is True

    def test_payment_mandate_verifies(self):
        s = self._make_session()
        totals = self.ucp.totals_dict(s)
        cart_m = self.ap2.create_cart_mandate(_PRODUCT, 1, totals, s.id, "urn:ap2:intent:abc")
        pay_m = self.ap2.create_payment_mandate(cart_m, "order_x", "spt_test", "user_abc")
        assert self.ap2.verify_mandate(pay_m) is True

    def test_tampered_mandate_fails_verification(self):
        m = self.ap2.create_intent_mandate("shoes", "user_abc", ["nike"])
        m.credentialSubject["natural_language_description"] = "watches"  # tamper
        assert self.ap2.verify_mandate(m) is False

    def test_checkout_hash_consistent(self):
        s = self._make_session()
        totals = self.ucp.totals_dict(s)
        intent_id = "urn:ap2:mandate:intent:abc"
        cart_m = self.ap2.create_cart_mandate(_PRODUCT, 1, totals, s.id, intent_id)
        pay_m = self.ap2.create_payment_mandate(cart_m, "order_x", "spt_x", "user_x")
        assert cart_m.credentialSubject["checkout_hash"] == pay_m.credentialSubject["checkout_hash"]

    def test_payment_ref_never_contains_raw_card(self):
        s = self._make_session()
        totals = self.ucp.totals_dict(s)
        cart_m = self.ap2.create_cart_mandate(_PRODUCT, 1, totals, s.id, "urn:ap2:intent:x")
        pay_m = self.ap2.create_payment_mandate(cart_m, "order_x", "spt_abc12345", "user_x")
        ref = pay_m.credentialSubject["payment_ref"]
        assert ref.startswith("spt_") or ref.startswith("mock_card_")
        # Must never look like a real PAN (16 digits in a row)
        import re
        assert not re.search(r"\d{12,}", ref), "payment_ref must not contain raw card-like digits"

    def test_w3c_context_present(self):
        m = self.ap2.create_intent_mandate("shoes", "user_abc", ["nike"])
        assert "https://www.w3.org/2018/credentials/v1" in m.context
        assert "https://ap2-protocol.org/context/v1" in m.context

    def test_proof_has_required_fields(self):
        m = self.ap2.create_intent_mandate("shoes", "user_abc", ["nike"])
        assert m.proof.type == "DataIntegrityProof"
        assert m.proof.verificationMethod is not None
        assert m.proof.jws is not None
        assert m.proof.created is not None


# ── Intent parsing + routing ──────────────────────────────────────────────────

class TestIntentParsing:
    def test_brand_nike(self):
        i = parse_intent("I want Nike running shoes")
        assert i.brand == "nike"

    def test_brand_hm_variants(self):
        for q in ["H&M dress", "hm tops", "h and m clothing"]:
            i = parse_intent(q)
            assert i.brand == "hm", f"Failed for query: {q}"

    def test_max_price_extraction(self):
        for q in ["under $100", "less than 80", "max 120", "up to $90"]:
            i = parse_intent(q)
            assert i.max_price is not None, f"Failed for: {q}"

    def test_category_dress(self):
        i = parse_intent("show me dresses")
        assert i.category in ("dress", "dresses")

    def test_category_watch(self):
        i = parse_intent("I need a watch")
        assert i.category == "watch"

    def test_color_extracted(self):
        i = parse_intent("black nike sneakers")
        assert i.color == "black"


class TestMerchantRouting:
    def test_brand_routes_single_merchant(self):
        i = parse_intent("Nike shoes")
        assert route_merchants(i) == ["nike"]

    def test_dress_routes_to_fashion_merchants(self):
        i = parse_intent("summer dress")
        merchants = route_merchants(i)
        assert set(merchants) == {"zara", "hm"}

    def test_watch_routes_to_watch_merchants(self):
        i = parse_intent("watch under 100")
        merchants = route_merchants(i)
        assert set(merchants) == {"fossil", "casio"}

    def test_no_hint_broadcasts_all(self):
        i = parse_intent("gift idea")
        merchants = route_merchants(i)
        assert len(merchants) == 6

    def test_casio_g_shock_direct(self):
        i = parse_intent("casio g-shock")
        merchants = route_merchants(i)
        assert "casio" in merchants
