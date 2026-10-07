"""
Customer side: Talkshop issues a signed credential for the logged-in customer's
shopping agent. The merchant verifies it in backend/trust/verifier.py.

The signature is a demo HMAC with a platform key from the environment. A
production system would sign with the platform's private key and publish the
public key; the credential shape and the checks stay the same.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from backend.trust.models import ALL_SCOPES, AgentCredential, AgentIdentity, DelegationGrant

PLATFORM_ID = "talkshop.platform"
CUSTOMER_AGENT_ID = "talkshop.customer-agent"
KEY_ID = "talkshop-demo-key-1"
CREDENTIAL_TTL_MINUTES = 30

_PLATFORM_KEYS = {KEY_ID: os.getenv("TALKSHOP_PLATFORM_KEY", "demo-platform-key-replace-in-production").encode()}


def platform_key(key_id: str) -> Optional[bytes]:
    return _PLATFORM_KEYS.get(key_id)


def _signable(identity: AgentIdentity, delegation: DelegationGrant) -> bytes:
    return json.dumps(
        {"identity": identity.model_dump(), "delegation": delegation.model_dump()},
        sort_keys=True, separators=(",", ":"),
    ).encode()


def sign(identity: AgentIdentity, delegation: DelegationGrant, key: bytes) -> str:
    digest = hmac.new(key, _signable(identity, delegation), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def customer_ref(user_id: str) -> str:
    """Stable pseudonymous id for this customer, so merchants never see Talkshop's user id."""
    return "cust_" + hashlib.sha256(f"{PLATFORM_ID}:{user_id}".encode()).hexdigest()[:12]


def issue_customer_agent_credential(
    user_id: str,
    is_talkshop_guest: bool = False,
    merchant_scope: Optional[list[str]] = None,
    scopes: Optional[list[str]] = None,
    max_amount: Optional[float] = 500.0,
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
    signature = sign(identity, delegation, _PLATFORM_KEYS[KEY_ID])
    if simulate == "bad_agent_credential":
        # A credential that wasn't signed by Talkshop's key: the merchant must refuse it.
        signature = sign(identity, delegation, b"not-the-talkshop-platform-key")
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
