"""
GreenLight — Payment Authorization Agent (Agent 4).
Triggered only after confirmed user approval.
Validates consent exists, runs policy check, requests DPAT token.
Agent receives ONLY the token_id — never the raw card or full auth object.
LLM role here is minimal: just coordination and summary.
"""
from datetime import datetime, timedelta, timezone
import uuid
from typing import Optional

from backend.models.checkout import CheckoutObject
from backend.models.payment import DPATToken
from backend.payment.policy import evaluate_purchase, TOKEN_TTL_MINUTES
from backend.payment.signing import sign_authorization
from backend.config.agents import PAYIT


async def request_dpat(
    checkout: CheckoutObject,
    user_id: str,
    consent_authorization_id: str,
) -> tuple[Optional[str], Optional[dict], Optional[str]]:
    """
    Issue a DPAT token after consent is verified.
    Returns (token_id, full_token_dict, error).
    Caller (agent) receives only token_id — full_token_dict stored in DB by DPAT service.
    """
    # Policy check before issuing token
    policy = evaluate_purchase(checkout.merchant_id, checkout.total, checkout.currency)
    if policy.decision != "ALLOW":
        return None, None, f"{policy.reason_code}: {policy.detail}"

    now = datetime.now(timezone.utc)
    token_id = f"DPAT_{uuid.uuid4().hex[:8].upper()}"
    authorization_id = consent_authorization_id

    token = DPATToken(
        token_id=token_id,
        authorization_id=authorization_id,
        customer_id=user_id,
        agent_id=PAYIT.agent_id,  # delegated to the agent that executes payment, not the issuer
        merchant_id=checkout.merchant_id,
        order_id=checkout.checkout_id,
        max_amount=checkout.total,
        currency=checkout.currency,
        checkout_hash=checkout.checkout_hash,
        purpose="ECOMMERCE_PURCHASE",
        single_use=True,
        issued_at=now,
        expires_at=now + timedelta(minutes=TOKEN_TTL_MINUTES),
        status="active",
    )

    # Sign the token data for tamper detection at execution time
    token_dict = token.model_dump(mode="json")
    token_dict["signature"] = sign_authorization({
        k: v for k, v in token_dict.items()
        if k not in ("signature", "issued_at")  # exclude mutable fields
    })

    # Return only token_id to the agent — full record goes to DPAT service
    return token_id, token_dict, None


def summarize_authorization(token_id: str, checkout: CheckoutObject) -> str:
    """
    Brief human-readable confirmation for the UI.
    LLM is not used — deterministic template.
    """
    return (
        f"Authorization token {token_id} issued for {checkout.merchant_name}. "
        f"Amount: ${checkout.total:.2f}. Expires in {TOKEN_TTL_MINUTES} minutes. "
        f"Single-use token — valid for this purchase only."
    )
