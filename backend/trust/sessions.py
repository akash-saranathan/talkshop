"""
Trusted agent sessions — the merchant's record that a customer agent passed
trust validation. Checkout and payment refuse to run without one, and they
re-verify the stored credential for their own action and amount.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.db.schema import TrustedAgentSessionRow
from backend.db.session_utils import get_session
from backend.trust.models import AgentCredential, TrustDecision, TrustedAgentSession
from backend.trust.verifier import merchant_relationship, trust_service


def establish(
    credential: AgentCredential,
    merchant_id: str,
    chat_session_id: str,
    action: str,
) -> tuple[TrustDecision, Optional[TrustedAgentSession]]:
    """Verify the agent for `action` at this merchant and, if it passes, open a trusted session."""
    decision = trust_service.verify(credential, merchant_id, action)
    if not decision.verified:
        return decision, None

    grant = credential.delegation
    session = TrustedAgentSession(
        session_id=f"tas_{uuid.uuid4().hex[:12]}",
        chat_session_id=chat_session_id,
        customer_agent=credential.identity.agent_id,
        merchant_id=merchant_id,
        customer_ref=grant.customer_ref,
        merchant_relationship=merchant_relationship(merchant_id, grant.customer_ref),
        talkshop_account=grant.talkshop_account,
        scopes=grant.scopes,
        max_amount=grant.max_amount,
        expires_at=grant.expires_at,
    )
    with get_session() as db:
        db.add(TrustedAgentSessionRow(
            session_id=session.session_id,
            chat_session_id=chat_session_id,
            user_id=grant.user_id,
            merchant_id=merchant_id,
            agent_id=session.customer_agent,
            customer_ref=session.customer_ref,
            merchant_relationship=session.merchant_relationship,
            talkshop_account=session.talkshop_account,
            scopes=json.dumps(session.scopes),
            max_amount=session.max_amount,
            credential=credential.model_dump_json(),
            expires_at=datetime.fromisoformat(grant.expires_at),
        ))
        db.commit()
    return decision, session


def _to_model(row: TrustedAgentSessionRow) -> TrustedAgentSession:
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    return TrustedAgentSession(
        session_id=row.session_id,
        chat_session_id=row.chat_session_id,
        customer_agent=row.agent_id,
        merchant_id=row.merchant_id,
        customer_ref=row.customer_ref,
        merchant_relationship=row.merchant_relationship,
        talkshop_account=row.talkshop_account,
        scopes=json.loads(row.scopes),
        max_amount=row.max_amount,
        expires_at=expires.isoformat(),
    )


def require(
    user_id: str,
    merchant_id: str,
    action: str,
    *,
    chat_session_id: Optional[str] = None,
    trusted_session_id: Optional[str] = None,
    amount: Optional[float] = None,
) -> tuple[Optional[TrustedAgentSession], TrustDecision]:
    """
    Find this user's active trusted session with the merchant and re-verify its
    credential for `action` (and `amount`). Returns (session or None, decision).
    """
    with get_session() as db:
        q = db.query(TrustedAgentSessionRow).filter(
            TrustedAgentSessionRow.user_id == user_id,
            TrustedAgentSessionRow.merchant_id == merchant_id,
            TrustedAgentSessionRow.status == "active",
        )
        if trusted_session_id:
            q = q.filter(TrustedAgentSessionRow.session_id == trusted_session_id)
        elif chat_session_id:
            q = q.filter(TrustedAgentSessionRow.chat_session_id == chat_session_id)
        row = q.order_by(TrustedAgentSessionRow.id.desc()).first()
        if row is None:
            return None, TrustDecision(verified=False, checks=[], failed_check="trusted_session_exists",
                                       reason="no trusted agent session with this merchant")
        credential = AgentCredential.model_validate_json(row.credential)
        session = _to_model(row)

    decision = trust_service.verify(credential, merchant_id, action, amount)
    return (session if decision.verified else None), decision
