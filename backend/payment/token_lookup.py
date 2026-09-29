"""
Shared DPAT token/signature assembly — used by both
/api/authorizations/validate (Phase 3) and /api/payments/execute (Phase 4)
so the two never drift out of sync.
"""
from typing import Optional
from sqlalchemy.orm import Session

from backend.db.schema import DelegatedToken, PaymentAuthorization
from backend.payment.signing import verify_authorization


def load_token_context(
    session: Session, order_id: str, token_id: str
) -> tuple[Optional[dict], bool, Optional[str]]:
    """
    Fetch the token + its authorization record and verify the HMAC signature.
    Returns (token_dict_or_None, consent_exists, signature_error_or_None).
    token_dict is None if the auth/token pair can't be assembled.
    signature_error is set (and token_dict is dropped) if the signature is invalid.
    """
    auth = (
        session.query(PaymentAuthorization)
        .filter(PaymentAuthorization.order_id == order_id)
        .order_by(PaymentAuthorization.approved_at.desc())
        .first()
    )
    token = (
        session.query(DelegatedToken)
        .filter(DelegatedToken.token_id == token_id)
        .first()
    )
    consent_exists = auth is not None and auth.approved_at is not None

    if not (token and auth):
        return None, consent_exists, None

    # Same field set + value types approve_authorization signed (backend/routers/
    # authorizations.py) — strings and a float only, so it reconstructs identically
    # from DB columns with no datetime-serialization ambiguity.
    if auth.signature:
        signable = {
            "token_id": token.token_id,
            "agent_id": auth.agent_id,
            "merchant_id": auth.merchant_id,
            "order_id": auth.order_id,
            "currency": auth.currency,
            "max_amount": auth.max_amount,
            "checkout_hash": auth.checkout_hash,
        }
        if not verify_authorization(signable, auth.signature):
            return None, consent_exists, "SIGNATURE_INVALID"

    token_dict = {
        "token_id": token.token_id,
        "status": token.status,
        "expires_at": token.expires_at,
        "consumed_at": token.consumed_at,
        "agent_id": auth.agent_id,
        "merchant_id": auth.merchant_id,
        "order_id": auth.order_id,
        "currency": auth.currency,
        "max_amount": auth.max_amount,
        "checkout_hash": auth.checkout_hash,
    }
    return token_dict, consent_exists, None
