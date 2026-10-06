"""
AP2 (Agent Payments Protocol) models — Google, Sep 2025.

AP2 answers: "how do we prove, after the fact, that a real user authorized
this AI agent to make this specific purchase?"

Answer: three W3C Verifiable Credential mandates, each signed, each linking
to the previous, forming an auditable chain of authorization:

  1. IntentMandate  — user signs at session start
     "I want to buy [natural language description] from [merchants]"
     Issuer: user wallet / did:demo:user

  2. CartMandate    — agent signs after product selection
     "This exact cart (product, quantity, totals, checkout_hash) was confirmed"
     Links back to IntentMandate via intent_mandate_id
     Issuer: did:demo:agent:generic-shopping-agent

  3. PaymentMandate — agent signs on APPROVE & PAY
     "Payment authorized for this cart, using this payment reference"
     payment_ref is spt_xxx or mock_card_XXXX — NEVER raw card data
     Links back to CartMandate via cart_mandate_id
     Issuer: did:demo:agent:generic-shopping-agent

Wire format: W3C Verifiable Credential (JSON-LD) with DataIntegrityProof.
Real AP2 uses ECDSA-P256 (or SD-JWT with vct: mandate.checkout.1 / mandate.payment.1).
This demo uses HMAC-SHA256 and marks cryptosuite accordingly.
"""
from __future__ import annotations
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class AP2Proof(BaseModel):
    type: str = "DataIntegrityProof"
    cryptosuite: str = "hmac-sha256-2024-demo"  # production: "ecdsa-2019"
    created: str                                 # ISO 8601 UTC
    verificationMethod: str                      # DID key reference
    jws: str                                     # base64url-encoded HMAC digest


_AP2_CONTEXT = [
    "https://www.w3.org/2018/credentials/v1",
    "https://ap2-protocol.org/context/v1",
]


class AP2IntentMandate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    context: list[str] = Field(default_factory=lambda: list(_AP2_CONTEXT), alias="@context")
    type: list[str] = ["VerifiableCredential", "IntentMandate"]
    id: str                              # "urn:ap2:mandate:intent:<uuid>"
    issuer: str                          # "did:demo:user:<user_id_prefix>"
    issuanceDate: str                    # ISO 8601
    credentialSubject: dict[str, Any]    # see AP2Adapter.create_intent_mandate for shape
    proof: AP2Proof


class AP2CartMandate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    context: list[str] = Field(default_factory=lambda: list(_AP2_CONTEXT), alias="@context")
    type: list[str] = ["VerifiableCredential", "CartMandate"]
    id: str                              # "urn:ap2:mandate:cart:<uuid>"
    issuer: str                          # "did:demo:agent:generic-shopping-agent"
    issuanceDate: str
    credentialSubject: dict[str, Any]    # cart_id, intent_mandate_id, line_items, totals, checkout_hash
    proof: AP2Proof


class AP2PaymentMandate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    context: list[str] = Field(default_factory=lambda: list(_AP2_CONTEXT), alias="@context")
    type: list[str] = ["VerifiableCredential", "PaymentMandate"]
    id: str                              # "urn:ap2:mandate:payment:<uuid>"
    issuer: str                          # "did:demo:agent:generic-shopping-agent"
    issuanceDate: str
    credentialSubject: dict[str, Any]    # payment_mandate_id, cart_mandate_id, checkout_hash, payment_ref
    proof: AP2Proof
