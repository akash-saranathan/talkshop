"""
ACP (Agentic Commerce Protocol) models — OpenAI + Stripe, Sep 2025.

ACP solves the payment-delegation problem: how can an AI agent pay on behalf
of a user without ever handling raw card data?

The answer is the Shared Payment Token (SPT) — a single-use, time-bounded
token issued by the buyer's payment provider, scoped to:
  - one seller (network_business_profile)
  - one currency
  - one maximum_amount (set exactly to the UCP-computed cart total)
  - one expiration window (15 minutes)

The agent receives only the SPT id (spt_xxx) — it never sees the PAN, CVV,
or expiry. The merchant charges against the SPT; if any constraint is violated
(wrong seller, wrong amount, expired), the charge fails before money moves.

Wire format mirrors the Stripe ACP spec:
  POST /shared_payment/issued_tokens → issue SPT
  Response: {id, brand, last4, status, constraints, created}
"""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class ACPConstraints(BaseModel):
    currency: str = "USD"
    maximum_amount: int     # cents — e.g. 11661 = $116.61 (the exact UCP total)
    expiration: int         # Unix timestamp — 15 min from issuance


class ACPSharedPaymentToken(BaseModel):
    id: str                 # "spt_<8hex>" — the only thing the agent ever passes downstream
    brand: str              # "visa" | "mastercard" | ... — display only
    last4: str              # last 4 digits — display only, not usable for charging
    status: Literal["active", "requires_action", "deactivated"] = "active"
    constraints: ACPConstraints
    created: int            # Unix timestamp


class ACPIssueTokenRequest(BaseModel):
    """POST /shared_payment/issued_tokens request body."""
    payment_method: str             # opaque PM id from the frontend — never raw card
    network_business_profile: str   # merchant's ACP seller profile id (nbp_<merchant>)
    constraints: ACPConstraints
