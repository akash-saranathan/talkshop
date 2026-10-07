"""
Agent trust models — who the incoming customer agent is, what the customer
delegated to it, and the trusted session a merchant opens once both check out.

Two different relationships are kept apart on purpose:
  talkshop_account       does Talkshop (the customer-side platform) know this person?
                         "authenticated" | "talkshop_guest"
  merchant_relationship  does the merchant (e.g. Nike) know this person?
                         "merchant_guest" | "merchant_member"
The primary Demo 2 scenario is authenticated to Talkshop and a guest to Nike.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# Actions a merchant can be asked to perform for a customer agent.
SCOPE_CATALOG = "catalog:read"
SCOPE_CHECKOUT = "checkout:create"
SCOPE_PAYMENT = "payment:execute"
ALL_SCOPES = [SCOPE_CATALOG, SCOPE_CHECKOUT, SCOPE_PAYMENT]

TalkshopAccount = Literal["authenticated", "talkshop_guest"]
MerchantRelationship = Literal["merchant_guest", "merchant_member"]


class AgentIdentity(BaseModel):
    """The customer agent as it presents itself to a merchant."""
    agent_id: str
    platform_id: str
    public_key_hint: str = Field(description="Key id the merchant uses to pick the verification key")


class DelegationGrant(BaseModel):
    """What the customer allowed their agent to do, and where."""
    grant_id: str
    user_id: str                       # the customer, as known to Talkshop
    customer_ref: str                  # pseudonymous id the merchant sees instead of Talkshop's user id
    agent_id: str
    talkshop_account: TalkshopAccount
    scopes: list[str]
    merchant_scope: list[str]          # merchant ids, or ["*"] for any merchant
    max_amount: Optional[float] = None
    currency: str = "USD"
    issued_at: str
    expires_at: str


class AgentCredential(BaseModel):
    """Identity + delegation, signed by the customer-side platform."""
    credential_id: str
    identity: AgentIdentity
    delegation: DelegationGrant
    signature: str


class TrustCheck(BaseModel):
    check: str
    status: Literal["pass", "fail", "n/a"]
    reason: Optional[str] = None


class TrustDecision(BaseModel):
    verified: bool
    checks: list[TrustCheck]
    failed_check: Optional[str] = None
    reason: Optional[str] = None


class TrustedAgentSession(BaseModel):
    session_id: str
    chat_session_id: str
    customer_agent: str
    merchant_id: str
    customer_ref: str
    merchant_relationship: MerchantRelationship
    talkshop_account: TalkshopAccount
    scopes: list[str]
    max_amount: Optional[float] = None
    verified: bool = True
    expires_at: str
