"""Merchant-side agent trust: every failure reason is deterministic and refuses the action."""
import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.trust import credentials
from backend.trust.models import AgentIdentity, SCOPE_CATALOG, SCOPE_CHECKOUT, SCOPE_PAYMENT
from backend.trust.verifier import merchant_relationship, trust_service


def _resign(cred, identity=None, **grant_changes):
    identity = identity or cred.identity
    grant = cred.delegation.model_copy(update=grant_changes)
    return cred.model_copy(update={"identity": identity, "delegation": grant,
                                   "signature": credentials.sign(identity, grant)})


def test_valid_credential_passes_every_check():
    d = trust_service.verify(credentials.issue_customer_agent_credential("u1"), "nike", SCOPE_CATALOG)
    assert d.verified and d.failed_check is None
    assert {c.check for c in d.checks} == {
        "agent_identity_registered", "platform_expected", "credential_signature_valid", "delegation_bound_to_agent",
        "credential_not_expired", "action_in_scope", "merchant_in_scope", "amount_within_scope"}


def test_forged_signature():
    bad = credentials.issue_customer_agent_credential("u1", simulate="bad_agent_credential")
    assert trust_service.verify(bad, "nike", SCOPE_CATALOG).failed_check == "credential_signature_valid"


def test_tampered_delegation_breaks_the_signature():
    cred = credentials.issue_customer_agent_credential("u1", max_amount=50)
    tampered = cred.model_copy(update={"delegation": cred.delegation.model_copy(update={"max_amount": 5000})})
    assert trust_service.verify(tampered, "nike", SCOPE_PAYMENT, 100).failed_check == "credential_signature_valid"


def test_unknown_agent():
    cred = credentials.issue_customer_agent_credential("u1")
    other = AgentIdentity(agent_id="someone.else", platform_id=credentials.PLATFORM_ID, public_key_hint=credentials.KEY_ID)
    assert trust_service.verify(_resign(cred, identity=other, agent_id="someone.else"), "nike",
                                SCOPE_CATALOG).failed_check == "agent_identity_registered"


def test_wrong_platform():
    cred = credentials.issue_customer_agent_credential("u1")
    other = cred.identity.model_copy(update={"platform_id": "evil.platform"})
    assert trust_service.verify(_resign(cred, identity=other), "nike", SCOPE_CATALOG).failed_check == "platform_expected"


def test_expired_credential():
    cred = _resign(credentials.issue_customer_agent_credential("u1"),
                   expires_at=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())
    assert trust_service.verify(cred, "nike", SCOPE_CATALOG).failed_check == "credential_not_expired"


def test_action_not_delegated():
    cred = credentials.issue_customer_agent_credential("u1", scopes=[SCOPE_CATALOG])
    assert trust_service.verify(cred, "nike", SCOPE_CHECKOUT).failed_check == "action_in_scope"


def test_merchant_outside_scope():
    cred = credentials.issue_customer_agent_credential("u1", merchant_scope=["adidas"])
    assert trust_service.verify(cred, "nike", SCOPE_CATALOG).failed_check == "merchant_in_scope"


def test_amount_above_delegated_limit():
    cred = credentials.issue_customer_agent_credential("u1", max_amount=100)
    assert trust_service.verify(cred, "nike", SCOPE_PAYMENT, 151.47).failed_check == "amount_within_scope"
    assert trust_service.verify(cred, "nike", SCOPE_PAYMENT, 99.0).verified


def test_customer_is_a_guest_to_nike_by_default():
    cred = credentials.issue_customer_agent_credential("u1")
    assert merchant_relationship("nike", cred.delegation.customer_ref) == "merchant_guest"
    assert cred.delegation.talkshop_account == "authenticated"
    assert "u1" not in str(credentials.public_view(cred))  # the merchant sees a pseudonymous ref only


def test_ecdsa_signature_verifies_against_the_published_public_key():
    cred = credentials.issue_customer_agent_credential("u1")
    pub = credentials.platform_key(cred.identity.public_key_hint)
    assert credentials.verify_signature(cred.identity, cred.delegation, cred.signature, pub)


def test_ecdsa_signature_tampering_fails_verification():
    cred = credentials.issue_customer_agent_credential("u1")
    pub = credentials.platform_key(cred.identity.public_key_hint)
    tampered = cred.signature[:-1] + ("A" if cred.signature[-1] != "A" else "B")
    assert not credentials.verify_signature(cred.identity, cred.delegation, tampered, pub)
    assert not credentials.verify_signature(cred.identity, cred.delegation, "not-a-real-signature", pub)


def test_trust_decision_code_never_calls_an_llm():
    for name in ("verifier.py", "credentials.py", "sessions.py", "models.py"):
        tree = ast.parse(Path("backend/trust", name).read_text(encoding="utf-8"))
        imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names} | \
                   {n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        assert not any(m and ("llm" in m or "langchain" in m or "genai" in m) for m in imported), name
