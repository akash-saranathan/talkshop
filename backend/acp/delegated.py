"""
ACP-style delegated payment token for the main purchase flow.

Issued only after the customer says GO AHEAD and the AP2 authorization evidence
exists. It is the one payment credential that crosses from the customer agent to
the merchant. It carries a payment-method reference (brand + last4), never a card.

It is bound to: merchant, checkout_id, checkout_hash, exact amount, currency,
expiry and single use. The signature covers every bound field, so changing any
of them invalidates the token. Single use is enforced by the database row.

Signed with real ECDSA (P-256/SHA-256, via the `cryptography` package) — the
issuing agent's private key signs, the merchant verifies with the matching
public key. Demo-only in that the keypair is generated in memory per process
rather than issued by a real CA/HSM.

This is an ACP-style token, not Stripe's Shared Payment Token wire format.
"""
from __future__ import annotations

import base64
import json
import time
import uuid
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey

# The issuing agent's ECDSA keypair for ACP tokens — generated once for this
# process, held only in memory. Independent of AP2's keypair (backend/ap2/adapter.py),
# matching how each signing surface already held its own key before this swap.
_SIGNING_PRIVATE_KEY: EllipticCurvePrivateKey = ec.generate_private_key(ec.SECP256R1())
_SIGNING_PUBLIC_KEY = _SIGNING_PRIVATE_KEY.public_key()

TOKEN_TTL_SECONDS = 900  # 15 minutes

_BOUND_FIELDS = ("token_id", "merchant_id", "checkout_id", "checkout_hash", "max_amount_cents",
                 "currency", "expires_at", "single_use", "payment_method_id", "consent_id",
                 "ap2_payment_mandate_id")


def _sign(token: dict) -> str:
    payload = json.dumps({k: token[k] for k in _BOUND_FIELDS}, sort_keys=True, separators=(",", ":")).encode()
    signature = _SIGNING_PRIVATE_KEY.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.urlsafe_b64encode(signature).decode().rstrip("=")


def _verify_signature(token: dict, signature_b64: str) -> bool:
    try:
        payload = json.dumps({k: token[k] for k in _BOUND_FIELDS}, sort_keys=True, separators=(",", ":")).encode()
        raw = base64.urlsafe_b64decode(signature_b64 + "=" * (-len(signature_b64) % 4))
        _SIGNING_PUBLIC_KEY.verify(raw, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, KeyError):
        return False


def issue(
    *, merchant_id: str, checkout_id: str, checkout_hash: str, total: float, currency: str,
    payment_method: dict, consent_id: str, ap2_payment_mandate_id: str,
) -> dict:
    token = {
        "token_id": f"spt_{uuid.uuid4().hex[:12]}",
        "merchant_id": merchant_id,
        "checkout_id": checkout_id,
        "checkout_hash": checkout_hash,
        "max_amount_cents": round(total * 100),
        "currency": currency,
        "expires_at": int(time.time()) + TOKEN_TTL_SECONDS,
        "single_use": True,
        "payment_method_id": payment_method["payment_method_id"],
        "payment_method": {"brand": payment_method["brand"], "last4": payment_method["last4"]},
        "consent_id": consent_id,
        "ap2_payment_mandate_id": ap2_payment_mandate_id,
    }
    token["signature"] = _sign(token)
    return token


def public_view(token: dict) -> dict:
    """Safe for the trace: no signature."""
    return {k: v for k, v in token.items() if k != "signature"}


def verify(
    token: dict, *, merchant_id: str, checkout_id: str, checkout_hash: str,
    amount_cents: int, currency: str,
) -> tuple[bool, Optional[str], list[dict]]:
    """
    Merchant-side verification. Returns (ok, reason_code, checks). The reason codes
    match the internal payment checks so a rejection reads the same wherever it is caught.
    """
    checks: list[dict] = []

    def add(name: str, ok: bool, code: str) -> None:
        checks.append({"check": name, "status": "pass" if ok else "fail", "reason_code": None if ok else code})

    add("token_signature_valid", _verify_signature(token, token.get("signature", "")), "TOKEN_SIGNATURE_INVALID")
    add("merchant_matches", token["merchant_id"] == merchant_id, "MERCHANT_MISMATCH")
    add("checkout_bound", token["checkout_id"] == checkout_id, "ORDER_ID_MISMATCH")
    add("checkout_hash_bound", token["checkout_hash"] == checkout_hash, "CHECKOUT_HASH_MISMATCH")
    add("amount_within_token_scope", amount_cents <= token["max_amount_cents"], "AMOUNT_EXCEEDS_TOKEN_SCOPE")
    add("amount_matches_checkout", amount_cents == token["max_amount_cents"], "AMOUNT_MISMATCH")
    add("currency_matches", token["currency"].upper() == currency.upper(), "CURRENCY_MISMATCH")
    add("token_not_expired", int(time.time()) < token["expires_at"], "TOKEN_EXPIRED")
    failed = next((c for c in checks if c["status"] == "fail"), None)
    return failed is None, (failed["reason_code"] if failed else None), checks
