"""
DPAT Authorization Service — deterministic FastAPI router.
No LLM in any endpoint. This is the trust boundary.

Endpoints:
  POST /api/checkout/create           — CartUp builds CheckoutObject
  POST /api/authorizations/approve    — record consent + issue DPAT token
  POST /api/authorizations/validate   — 12-check guardrail (used by PayIt in Phase 4)
  POST /api/authorizations/revoke     — revoke an active token
  GET  /api/audit/{order_id}          — full audit trail for an order
"""
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.agents.cartup import build_checkout
from backend.auth.dependencies import CurrentUser, get_current_user
from backend.agents.greenlight import request_dpat, summarize_authorization
from backend.db.schema import AuditEvent, DelegatedToken, PaymentAuthorization
from backend.db.session_utils import get_session as _session, now_utc as _now, write_audit_event as _audit
from backend.merchants import catalog as merchant_catalog
from backend.models.checkout import CheckoutObject
from backend.models.payment import GuardrailEvent, PaymentRequest
from backend.payment.guardrail_engine import run_guardrails
from backend.payment.signing import sign_authorization
from backend.payment.token_lookup import load_token_context

router = APIRouter()


# ── Request / Response schemas ────────────────────────────────────────────────

class CreateCheckoutRequest(BaseModel):
    product_id: str
    merchant_id: str
    quantity: int = 1


class ApproveRequest(BaseModel):
    checkout_id: str
    checkout_hash: str
    merchant_id: str
    total: float
    currency: str = "USD"
    product_id: str
    product_title: str
    merchant_name: str
    subtotal: float
    tax: float
    shipping: float


class ApproveResponse(BaseModel):
    token_id: str
    authorization_id: str
    expires_at: str
    summary: str


class ValidateRequest(BaseModel):
    payment_request: PaymentRequest
    checkout_total: float
    checkout_hash: str


class ValidateResponse(BaseModel):
    passed: bool
    events: list[GuardrailEvent]
    blocked_reason: Optional[str] = None


class RevokeRequest(BaseModel):
    token_id: str
    reason: str = "user_cancelled"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/checkout/create")
async def create_checkout_endpoint(
    req: CreateCheckoutRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    CartUp builds a CheckoutObject from a selected product.
    Returns the full checkout with SHA-256 hash.
    """
    normalized = merchant_catalog.get_product(req.product_id)
    if not normalized:
        raise HTTPException(status_code=404, detail="Product not found")

    checkout, error = await build_checkout(normalized, req.quantity, current_user.user_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    return checkout.model_dump(mode="json")


@router.post("/api/authorizations/approve", response_model=ApproveResponse)
async def approve_authorization(
    req: ApproveRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Records explicit user consent and issues a DPAT token.
    No DPAT is ever issued without this consent record.
    Agent receives only token_id — full auth object stays in DB.
    """
    authorization_id = f"AUTH_{uuid.uuid4().hex[:10].upper()}"

    # Reconstruct checkout for GreenLight
    checkout = CheckoutObject(
        checkout_id=req.checkout_id,
        merchant_id=req.merchant_id,
        merchant_name=req.merchant_name,
        product_id=req.product_id,
        product_title=req.product_title,
        quantity=1,
        subtotal=req.subtotal,
        tax=req.tax,
        shipping=req.shipping,
        total=req.total,
        currency=req.currency,
        checkout_hash=req.checkout_hash,
    )

    token_id, token_dict, error = await request_dpat(
        checkout, current_user.user_id, authorization_id
    )
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Persist authorization + token + consent audit event
    with _session() as session:
        now = _now()
        expires_at = datetime.fromisoformat(token_dict["expires_at"].replace("Z", "+00:00"))

        # Re-sign over exactly the columns PaymentAuthorization persists (no datetime,
        # no mutable lifecycle state like status/consumed_at) so token_lookup.load_token_context
        # can reconstruct an identical payload later and verify it byte-for-byte — the
        # in-memory signature GreenLight computed over the full DPATToken dump can't be
        # exactly reconstructed from relational columns after a DB round-trip.
        storage_signature = sign_authorization({
            "token_id": token_id,
            "agent_id": token_dict["agent_id"],
            "merchant_id": req.merchant_id,
            "order_id": req.checkout_id,
            "currency": req.currency,
            "max_amount": req.total,
            "checkout_hash": req.checkout_hash,
        })

        auth = PaymentAuthorization(
            authorization_id=authorization_id,
            user_id=current_user.user_id,
            agent_id=token_dict["agent_id"],
            merchant_id=req.merchant_id,
            order_id=req.checkout_id,
            max_amount=req.total,
            currency=req.currency,
            checkout_hash=req.checkout_hash,
            signature=storage_signature,
            approved_at=now,
            expires_at=expires_at,
            status="active",
        )
        session.add(auth)

        token_row = DelegatedToken(
            token_id=token_id,
            authorization_id=authorization_id,
            single_use=True,
            issued_at=now,
            expires_at=expires_at,
            status="active",
        )
        session.add(token_row)

        _audit(session, "USER_APPROVED_PURCHASE",
               user_id=current_user.user_id, order_id=req.checkout_id,
               authorization_id=authorization_id,
               metadata={"checkout_hash": req.checkout_hash, "total": req.total})
        _audit(session, "DPAT_CREATED",
               user_id=current_user.user_id, order_id=req.checkout_id,
               authorization_id=authorization_id,
               metadata={"token_id": token_id, "expires_at": token_dict["expires_at"]})

        session.commit()

    summary = summarize_authorization(token_id, checkout)
    return ApproveResponse(
        token_id=token_id,
        authorization_id=authorization_id,
        expires_at=token_dict["expires_at"],
        summary=summary,
    )


@router.post("/api/authorizations/validate", response_model=ValidateResponse)
async def validate_authorization(req: ValidateRequest):
    """
    Run the 12-check guardrail engine. Called by PayIt (Phase 4) before execution.
    Returns pass/fail + all guardrail events.
    """
    with _session() as session:
        token_dict, consent_exists, sig_error = load_token_context(
            session, req.payment_request.order_id, req.payment_request.token_id
        )

        if sig_error:
            return ValidateResponse(
                passed=False,
                events=[GuardrailEvent(
                    check_number=0, check_name="signature_verify",
                    passed=False, reason_code=sig_error,
                    detail="Authorization object signature is invalid — possible tampering",
                )],
                blocked_reason=sig_error,
            )

        passed, events = run_guardrails(
            req.payment_request, token_dict,
            req.checkout_total, req.checkout_hash, consent_exists,
        )
        blocked_reason = None if passed else next(
            (e.reason_code for e in events if not e.passed), "VALIDATION_FAILED"
        )
        return ValidateResponse(passed=passed, events=events, blocked_reason=blocked_reason)


@router.post("/api/authorizations/revoke")
async def revoke_authorization(req: RevokeRequest):
    """Revoke an active token. Idempotent — revoking an already-revoked token is a no-op."""
    with _session() as session:
        token = session.query(DelegatedToken).filter(
            DelegatedToken.token_id == req.token_id
        ).first()
        if not token:
            raise HTTPException(status_code=404, detail="Token not found")
        if token.status == "revoked":
            return {"status": "already_revoked", "token_id": req.token_id}

        token.status = "revoked"
        token.revoked_at = _now()
        _audit(session, "TOKEN_REVOKED", order_id=token.authorization_id,
               metadata={"token_id": req.token_id, "reason": req.reason})
        session.commit()

    return {"status": "revoked", "token_id": req.token_id}


@router.get("/api/audit/{order_id}")
async def get_audit_trail(order_id: str):
    """Full audit trail for an order — every event in chronological order."""
    with _session() as session:
        events = (
            session.query(AuditEvent)
            .filter(AuditEvent.order_id == order_id)
            .order_by(AuditEvent.event_timestamp)
            .all()
        )
        return [
            {
                "event_id": e.event_id,
                "event_type": e.event_type,
                "user_id": e.user_id,
                "agent_id": e.agent_id,
                "timestamp": e.event_timestamp.isoformat() if e.event_timestamp else None,
                "metadata": json.loads(e.metadata_json) if e.metadata_json else {},
            }
            for e in events
        ]
