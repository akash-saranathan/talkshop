"""
HMAC-SHA256 signing for authorization objects.
Signature is computed over the canonicalized authorization JSON and stored
alongside the record. Verification at payment execution detects any tampering.
"""
import hashlib
import hmac
import json
import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

# Signing key — loaded from env; falls back to a demo key (never use in prod)
_SIGNING_KEY = os.getenv("SIGNING_KEY", "demo-signing-key-replace-in-production").encode()


def _canonical(data: dict) -> bytes:
    """Stable JSON serialization — sorted keys, no whitespace."""
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode()


def sign_authorization(auth_data: dict[str, Any]) -> str:
    """
    Compute HMAC-SHA256 over the authorization object.
    Returns hex digest to store alongside the record.
    """
    payload = _canonical(auth_data)
    return hmac.new(_SIGNING_KEY, payload, hashlib.sha256).hexdigest()


def verify_authorization(auth_data: dict[str, Any], signature: str) -> bool:
    """
    Verify that auth_data has not been tampered with.
    Returns False on any mismatch — caller must block payment.
    """
    expected = sign_authorization(auth_data)
    return hmac.compare_digest(expected, signature)
