"""
PaymentAuthorizationAdapter — maps an external, already-verified authorization
(the ACP-style delegated token backed by AP2 evidence) onto the internal DPAT.

DPAT is not an industry protocol. It is this system's internal single-use
enforcement token: the payment service runs its 12 deterministic checks against
it before the mock processor is allowed to charge.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.agents.greenlight import request_dpat
from backend.db.schema import DelegatedToken, PaymentAuthorization
from backend.db.session_utils import now_utc
from backend.models.checkout import CheckoutObject
from backend.payment.signing import sign_authorization


def persist_dpat(session: Session, *, token_id: str, token_dict: dict, authorization_id: str,
                 user_id: str, checkout: CheckoutObject) -> None:
    """Store the DPAT and its authorization record exactly as the 12-check engine reads them back."""
    now = now_utc()
    expires_at = datetime.fromisoformat(token_dict["expires_at"].replace("Z", "+00:00"))
    # Signed over exactly the persisted columns, so payment/token_lookup can rebuild
    # and verify the payload byte-for-byte after a database round trip.
    storage_signature = sign_authorization({
        "token_id": token_id,
        "agent_id": token_dict["agent_id"],
        "merchant_id": checkout.merchant_id,
        "order_id": checkout.checkout_id,
        "currency": checkout.currency,
        "max_amount": checkout.total,
        "checkout_hash": checkout.checkout_hash,
    })
    session.add(PaymentAuthorization(
        authorization_id=authorization_id,
        user_id=user_id,
        agent_id=token_dict["agent_id"],
        merchant_id=checkout.merchant_id,
        order_id=checkout.checkout_id,
        max_amount=checkout.total,
        currency=checkout.currency,
        checkout_hash=checkout.checkout_hash,
        signature=storage_signature,
        approved_at=now,
        expires_at=expires_at,
        status="active",
    ))
    session.add(DelegatedToken(
        token_id=token_id,
        authorization_id=authorization_id,
        single_use=True,
        issued_at=now,
        expires_at=expires_at,
        status="active",
    ))


class PaymentAuthorizationAdapter:

    async def to_internal_dpat(
        self, session: Session, *, checkout: CheckoutObject, user_id: str,
    ) -> tuple[Optional[str], Optional[dict], Optional[str], Optional[str]]:
        """
        Issue and store the internal DPAT for this checkout.
        Returns (dpat_token_id, token_dict, authorization_id, error).
        """
        authorization_id = f"AUTH_{uuid.uuid4().hex[:10].upper()}"
        token_id, token_dict, error = await request_dpat(checkout, user_id, authorization_id)
        if error:
            return None, None, None, error
        persist_dpat(session, token_id=token_id, token_dict=token_dict, authorization_id=authorization_id,
                     user_id=user_id, checkout=checkout)
        return token_id, token_dict, authorization_id, None


authorization_adapter = PaymentAuthorizationAdapter()
