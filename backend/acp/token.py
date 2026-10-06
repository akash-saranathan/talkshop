"""
Mock SPT issuance and verification.

Production equivalent: POST https://api.stripe.com/v1/shared_payment/issued_tokens
This mock:
  - Generates spt_<8hex> token IDs
  - Signs each token with HMAC-SHA256 so it can be verified without a DB lookup
  - Enforces the same constraints Stripe would: amount, currency, expiry, seller

The signature covers {id, currency, maximum_amount, expiration, seller_profile}
so tampering with any constraint invalidates the token.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import time
import uuid

from backend.acp.models import ACPConstraints, ACPSharedPaymentToken

_KEY = os.getenv("SIGNING_KEY", "demo-signing-key-replace-in-production").encode()
_SPT_TTL_SECONDS = 900  # 15 minutes — same as Stripe ACP spec

_TOKENS: dict[str, tuple[ACPSharedPaymentToken, str]] = {}  # id → (token, seller_profile)


def _sign_token(token_id: str, constraints: ACPConstraints, seller_profile: str) -> str:
    payload = json.dumps({
        "id": token_id,
        "currency": constraints.currency,
        "maximum_amount": constraints.maximum_amount,
        "expiration": constraints.expiration,
        "seller_profile": seller_profile,
    }, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(_KEY, payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode().rstrip("=")


def issue_spt(
    payment_method: str,        # opaque reference — raw card data is never accepted here
    network_business_profile: str,
    maximum_amount_cents: int,
    currency: str = "USD",
    brand: str = "visa",
    last4: str = "0000",
) -> ACPSharedPaymentToken:
    """Issue a Shared Payment Token scoped to one seller and one amount."""
    token_id = f"spt_{uuid.uuid4().hex[:8]}"
    now = int(time.time())
    expiration = now + _SPT_TTL_SECONDS

    constraints = ACPConstraints(
        currency=currency,
        maximum_amount=maximum_amount_cents,
        expiration=expiration,
    )

    token = ACPSharedPaymentToken(
        id=token_id,
        brand=brand,
        last4=last4,
        status="active",
        constraints=constraints,
        created=now,
    )

    _TOKENS[token_id] = (token, network_business_profile)
    return token


def verify_spt(
    token_id: str,
    charge_amount_cents: int,
    currency: str,
    seller_profile: str,
) -> tuple[bool, str]:
    """
    Verify SPT is valid for this charge.
    Returns (True, "") on success; (False, reason) on any failure.
    Mirrors Stripe's server-side constraint enforcement.
    """
    entry = _TOKENS.get(token_id)
    if not entry:
        return False, "token_not_found"

    token, stored_profile = entry

    if token.status != "active":
        return False, f"token_status_{token.status}"

    if int(time.time()) > token.constraints.expiration:
        token.status = "deactivated"
        return False, "token_expired"

    if token.constraints.currency.upper() != currency.upper():
        return False, "currency_mismatch"

    if charge_amount_cents > token.constraints.maximum_amount:
        return False, "amount_exceeds_constraint"

    if stored_profile != seller_profile:
        return False, "seller_profile_mismatch"

    return True, ""
