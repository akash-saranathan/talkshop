"""
Merchant side: AgentTrustService decides whether an incoming customer agent may
perform a commerce action. Every check is deterministic code. No LLM is
consulted, and a single failed check refuses the action.
"""
from __future__ import annotations

import hmac
from datetime import datetime, timezone
from typing import Optional

from backend.trust import credentials
from backend.trust.models import AgentCredential, MerchantRelationship, TrustCheck, TrustDecision

# Customer agents this merchant network accepts, and the platform each must come from.
# The key id selects the platform's verification key.
REGISTERED_AGENTS = {
    credentials.CUSTOMER_AGENT_ID: {"platform_id": credentials.PLATFORM_ID, "key_ids": [credentials.KEY_ID]},
}

# Customers each merchant already has an account for, by the pseudonymous customer_ref
# the platform shares. Empty for the demo: every Talkshop customer is a guest to Nike.
MERCHANT_MEMBERS: dict[str, set[str]] = {}


def merchant_relationship(merchant_id: str, customer_ref: str) -> MerchantRelationship:
    return "merchant_member" if customer_ref in MERCHANT_MEMBERS.get(merchant_id, set()) else "merchant_guest"


class AgentTrustService:

    def verify(
        self,
        credential: AgentCredential,
        merchant_id: str,
        action: str,
        amount: Optional[float] = None,
    ) -> TrustDecision:
        identity, grant = credential.identity, credential.delegation
        checks: list[TrustCheck] = []

        def add(name: str, ok: bool, reason: str = "", applicable: bool = True) -> None:
            if not applicable:
                checks.append(TrustCheck(check=name, status="n/a"))
            else:
                checks.append(TrustCheck(check=name, status="pass" if ok else "fail", reason=None if ok else reason))

        registered = REGISTERED_AGENTS.get(identity.agent_id)
        add("agent_identity_registered", registered is not None, f"unknown agent {identity.agent_id}")

        platform_ok = bool(registered) and identity.platform_id == registered["platform_id"] \
            and identity.public_key_hint in registered["key_ids"]
        add("platform_expected", platform_ok, "agent is not from the expected customer platform")

        key = credentials.platform_key(identity.public_key_hint)
        sig_ok = key is not None and hmac.compare_digest(
            credentials.sign(identity, grant, key), credential.signature)
        add("credential_signature_valid", sig_ok, "credential signature does not verify")

        add("delegation_bound_to_agent", grant.agent_id == identity.agent_id and bool(grant.user_id),
            "delegation was not granted to this agent")

        try:
            expired = datetime.fromisoformat(grant.expires_at) <= datetime.now(timezone.utc)
        except ValueError:
            expired = True
        add("credential_not_expired", not expired, "credential has expired")

        add("action_in_scope", action in grant.scopes, f"{action} was not delegated")

        add("merchant_in_scope", "*" in grant.merchant_scope or merchant_id in grant.merchant_scope,
            f"delegation does not cover merchant {merchant_id}")

        amount_applies = amount is not None and grant.max_amount is not None
        add("amount_within_scope", amount_applies and amount <= grant.max_amount,
            f"amount {amount} exceeds delegated limit {grant.max_amount}", applicable=amount_applies)

        failed = next((c for c in checks if c.status == "fail"), None)
        return TrustDecision(
            verified=failed is None,
            checks=checks,
            failed_check=failed.check if failed else None,
            reason=failed.reason if failed else None,
        )


trust_service = AgentTrustService()
