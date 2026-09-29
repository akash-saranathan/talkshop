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
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.agents.cartup import build_checkout
from backend.agents.greenlight import request_dpat, summarize_authorization
from backend.db.schema import (
    AuditEvent, DelegatedToken, PaymentAuthorization, Product, Merchant
)
from backend.models.checkout import CheckoutObject
from backend.models.payment import GuardrailEvent, PaymentRequest
from backend.models.product import NormalizedProduct
from backend.payment.guardrail_engine import run_guardrails
from backend.payment.signing import verify_authorization

router = APIRouter()

DB_PATH = Path(__file__).parent.parent / "db" / "commerce.db"


def _session() -> Session:
    engine = create_engine(f"sqlite:///{DB_PATH}")
    return Session(engine)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _audit(session: Session, event_type: str, user_id: str = "USR001",
           agent_id: str = "", order_id: str = "",
           authorization_id: str = "", metadata: dict = {}):
    session.add(AuditEvent(
        event_id=f"EVT_{uuid.uuid4().hex[:10].upper()}",
        user_id=user_id,
        agent_id=agent_id,
        authorization_id=authorization_id,
        order_id=order_id,
        event_type=event_type,
        metadata_json=json.dumps(metadata),
    ))


# ── Request / Response schemas ────────────────────────────────────────────────

class CreateCheckoutRequest(BaseModel):
    product_id: str
    merchant_id: str
    quantity: int = 1
    user_id: str = "USR001"


class ApproveRequest(BaseModel):
    checkout_id: str
    checkout_hash: str
    merchant_id: str
    total: float
    currency: str = "USD"
    user_id: str = "USR001"
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
async def create_checkout_endpoint(req: CreateCheckoutRequest) -> dict:
    """
    CartUp builds a CheckoutObject from a selected product.
    Returns the full checkout with SHA-256 hash.
    """
    with _session() as session:
        row = (
            session.query(Product, Merchant)
            .join(Merchant, Product.merchant_id == Merchant.merchant_id)
            .filter(Product.product_id == req.product_id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Product not found")
        product, merchant = row
        normalized = NormalizedProduct(
            merchant_id=product.merchant_id,
            merchant_name=merchant.merchant_name,
            product_id=product.product_id,
            title=product.name,
            brand=product.brand,
            category=product.category,
            price=product.price,
            size=product.size,
            color=product.color,
            available=product.inventory > 0,
            inventory=product.inventory,
            delivery_days=product.delivery_days or 5,
            rating=product.rating or 0.0,
        )

    checkout, error = await build_checkout(normalized, req.quantity, req.user_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    return checkout.model_dump(mode="json")


@router.post("/api/authorizations/approve", response_model=ApproveResponse)
async def approve_authorization(req: ApproveRequest):
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
        checkout, req.user_id, authorization_id
    )
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Persist authorization + token + consent audit event
    with _session() as session:
        now = _now()
        from datetime import datetime as dt
        expires_at = dt.fromisoformat(token_dict["expires_at"].replace("Z", "+00:00"))

        auth = PaymentAuthorization(
            authorization_id=authorization_id,
            user_id=req.user_id,
            agent_id=token_dict["agent_id"],
            merchant_id=req.merchant_id,
            order_id=req.checkout_id,
            max_amount=req.total,
            currency=req.currency,
            checkout_hash=req.checkout_hash,
            signature=token_dict.get("signature"),
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
               user_id=req.user_id, order_id=req.checkout_id,
               authorization_id=authorization_id,
               metadata={"checkout_hash": req.checkout_hash, "total": req.total})
        _audit(session, "DPAT_CREATED",
               user_id=req.user_id, order_id=req.checkout_id,
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
        auth = (
            session.query(PaymentAuthorization)
            .filter(PaymentAuthorization.order_id == req.payment_request.order_id)
            .order_by(PaymentAuthorization.approved_at.desc())
            .first()
        )
        token = (
            session.query(DelegatedToken)
            .filter(DelegatedToken.token_id == req.payment_request.token_id)
            .first()
        )
        consent_exists = auth is not None and auth.approved_at is not None

        token_dict = None
        if token and auth:
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
                "signature": auth.signature,
            }

            # Verify HMAC signature before running checks
            sig = token_dict.pop("signature", None)
            if sig and not verify_authorization(token_dict, sig):
                return ValidateResponse(
                    passed=False,
                    events=[GuardrailEvent(
                        check_number=0, check_name="signature_verify",
                        passed=False, reason_code="SIGNATURE_INVALID",
                        detail="Authorization object signature is invalid — possible tampering",
                    )],
                    blocked_reason="SIGNATURE_INVALID",
                )
            token_dict["signature"] = sig

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
