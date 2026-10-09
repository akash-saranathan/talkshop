"""
Customer side: Talkshop issues a signed credential for the logged-in customer's
shopping agent. The merchant verifies it in backend/trust/verifier.py.

The signature is real ECDSA (P-256/SHA-256, via the `cryptography` package):
Talkshop signs with a private key generated fresh for this process, and
publishes only the public key for merchants to verify with. Demo-only in that
the keypair is generated in memory per run rather than issued by a real CA/HSM
— the sign → publish-public-key → verify flow itself is the real mechanism.
"""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey, EllipticCurvePublicKey

from backend.trust.models import ALL_SCOPES, AgentCredential, AgentIdentity, DelegationGrant

PLATFORM_ID = "talkshop.platform"
CUSTOMER_AGENT_ID = "talkshop.customer-agent"
KEY_ID = "talkshop-demo-key-1"
CREDENTIAL_TTL_MINUTES = 30

# VIC-inspired agent spending guardrail: the single dollar cap the shopping
# agent is delegated to spend per checkout, independent of any one merchant's
# own limits. Demo-only — mirrors a stored "agent transaction control" a real
# Visa Intelligent Commerce style rollout would configure per card/agent.
AGENT_SPENDING_LIMIT = 700.0

# Talkshop platform's ECDSA keypair — generated once for this process and held
# only in memory (never written to disk, env, or a log). A real platform would
# keep the private key in an HSM/KMS and publish only the public key; here
# both halves live in this process for the life of the demo run, which is all
# a sign-then-verify demo needs.
_PLATFORM_PRIVATE_KEY: EllipticCurvePrivateKey = ec.generate_private_key(ec.SECP256R1())
_PLATFORM_PUBLIC_KEYS: dict[str, EllipticCurvePublicKey] = {KEY_ID: _PLATFORM_PRIVATE_KEY.public_key()}


def platform_key(key_id: str) -> Optional[EllipticCurvePublicKey]:
    """The platform's PUBLIC key a merchant uses to verify a credential's signature."""
    return _PLATFORM_PUBLIC_KEYS.get(key_id)


def _signable(identity: AgentIdentity, delegation: DelegationGrant) -> bytes:
    return json.dumps(
        {"identity": identity.model_dump(), "delegation": delegation.model_dump()},
        sort_keys=True, separators=(",", ":"),
    ).encode()


def _b64_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(identity: AgentIdentity, delegation: DelegationGrant,
         private_key: Optional[EllipticCurvePrivateKey] = None) -> str:
    """ECDSA-sign with the platform's private key. `private_key` is overridable
    only by the bad-credential demo scenario, to produce a signature that will
    not verify against the published public key."""
    key = private_key or _PLATFORM_PRIVATE_KEY
    signature = key.sign(_signable(identity, delegation), ec.ECDSA(hashes.SHA256()))
    return base64.urlsafe_b64encode(signature).decode().rstrip("=")


def verify_signature(identity: AgentIdentity, delegation: DelegationGrant,
                      signature_b64: str, public_key: EllipticCurvePublicKey) -> bool:
    """Verify an ECDSA signature against the platform's public key. False on
    any mismatch, tampering or malformed signature — never raises."""
    try:
        public_key.verify(_b64_decode(signature_b64), _signable(identity, delegation), ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError):
        return False


def customer_ref(user_id: str) -> str:
    """Stable pseudonymous id for this customer, so merchants never see Talkshop's user id."""
    return "cust_" + hashlib.sha256(f"{PLATFORM_ID}:{user_id}".encode()).hexdigest()[:12]


def issue_customer_agent_credential(
    user_id: str,
    is_talkshop_guest: bool = False,
    merchant_scope: Optional[list[str]] = None,
    scopes: Optional[list[str]] = None,
    max_amount: Optional[float] = AGENT_SPENDING_LIMIT,
    simulate: Optional[str] = None,
) -> AgentCredential:
    """
    Credential the customer agent presents to merchants. `simulate` exists only
    for the demo's failure scenarios (e.g. "bad_agent_credential").
    """
    now = datetime.now(timezone.utc)
    identity = AgentIdentity(agent_id=CUSTOMER_AGENT_ID, platform_id=PLATFORM_ID, public_key_hint=KEY_ID)
    delegation = DelegationGrant(
        grant_id=f"grant_{uuid.uuid4().hex[:10]}",
        user_id=user_id,
        customer_ref=customer_ref(user_id),
        agent_id=CUSTOMER_AGENT_ID,
        talkshop_account="talkshop_guest" if is_talkshop_guest else "authenticated",
        scopes=scopes or list(ALL_SCOPES),
        merchant_scope=merchant_scope or ["*"],
        max_amount=max_amount,
        issued_at=now.isoformat(),
        expires_at=(now + timedelta(minutes=CREDENTIAL_TTL_MINUTES)).isoformat(),
    )
    signature = sign(identity, delegation)
    if simulate == "bad_agent_credential":
        # Signed with a different, freshly generated private key — not Talkshop's.
        # The merchant's verify against the published public key must refuse it.
        signature = sign(identity, delegation, ec.generate_private_key(ec.SECP256R1()))
    return AgentCredential(
        credential_id=f"cred_{uuid.uuid4().hex[:10]}",
        identity=identity,
        delegation=delegation,
        signature=signature,
    )


def public_view(credential: AgentCredential) -> dict:
    """What is safe to show in the trace: no signature, no Talkshop user id."""
    d = credential.delegation
    return {
        "credential_id": credential.credential_id,
        "agent_id": credential.identity.agent_id,
        "platform_id": credential.identity.platform_id,
        "public_key_hint": credential.identity.public_key_hint,
        "customer_ref": d.customer_ref,
        "talkshop_account": d.talkshop_account,
        "scopes": d.scopes,
        "merchant_scope": d.merchant_scope,
        "max_amount": d.max_amount,
        "expires_at": d.expires_at,
    }
