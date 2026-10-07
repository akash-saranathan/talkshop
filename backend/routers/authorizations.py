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
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.acp.adapter import ACPAdapter
from backend.acp.token import verify_spt_document
from backend.agents.cartup import build_checkout
from backend.ap2.adapter import AP2Adapter
from backend.ap2.models import AP2CartMandate
from backend.auth.dependencies import CurrentUser, get_current_user
from backend.agents.greenlight import request_dpat, summarize_authorization
from backend.db.schema import AcpSharedToken, AuditEvent, DelegatedToken, ProtocolMandate
from backend.db.session_utils import get_session as _session, now_utc as _now, write_audit_event as _audit
from backend.merchants import catalog as merchant_catalog
from backend.models.checkout import CheckoutObject
from backend.models.payment import GuardrailEvent, PaymentRequest
from backend.payment.authorization_adapter import persist_dpat
from backend.trust import sessions as trust_sessions
from backend.trust.models import SCOPE_CHECKOUT
from backend.payment.guardrail_engine import run_guardrails
from backend.payment.token_lookup import load_token_context

router = APIRouter()


# ── Request / Response schemas ────────────────────────────────────────────────

class CreateCheckoutRequest(BaseModel):
    product_id: str
    merchant_id: str
    quantity: int = 1
    session_id: Optional[str] = None
    trusted_session_id: Optional[str] = None


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
    card_brand: Optional[str] = None
    card_last4: Optional[str] = None


class ApproveResponse(BaseModel):
    token_id: str
    authorization_id: str
    expires_at: str
    summary: str
    protocols: dict = {}


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

_ap2 = AP2Adapter()
_acp = ACPAdapter()


def _store_mandate(session, mandate, mandate_type: str, checkout_id: str, user_id: str) -> None:
    session.add(ProtocolMandate(
        mandate_id=mandate.id,
        mandate_type=mandate_type,
        checkout_id=checkout_id,
        user_id=user_id,
        document=json.dumps(mandate.model_dump(by_alias=True), default=str),
    ))


def _load_mandate(session, checkout_id: str, mandate_type: str) -> Optional[dict]:
    row = (
        session.query(ProtocolMandate)
        .filter(ProtocolMandate.checkout_id == checkout_id, ProtocolMandate.mandate_type == mandate_type)
        .order_by(ProtocolMandate.id.desc())
        .first()
    )
    return json.loads(row.document) if row else None


def _verify_cart(doc: Optional[dict], checkout_hash: str) -> tuple[bool, str]:
    if doc is None:
        return False, "cart_mandate_missing"
    mandate = AP2CartMandate(**doc)
    if not _ap2.verify_mandate(mandate):
        return False, "cart_mandate_signature_mismatch"
    if mandate.credentialSubject.get("checkout_hash") != checkout_hash:
        return False, "cart_mandate_checkout_hash_mismatch"
    return True, ""


def _issue_checkout_mandates(checkout: CheckoutObject, product, session_id: Optional[str], user_id: str) -> dict:
    """
    AP2 cart evidence for this checkout. The shopping search intent is deliberately
    NOT turned into an AP2 IntentMandate here: finding shoes is not permission to
    spend money. Spending consent is recorded only when the customer says GO AHEAD.
    """
    cart_mandate = _ap2.create_cart_mandate(
        product={
            "id": product.product_id,
            "merchant_id": product.merchant_id,
            "merchant_name": product.merchant_name,
            "title": product.title,
            "price": product.price,
        },
        quantity=checkout.quantity,
        totals={"subtotal": checkout.subtotal, "fulfillment": checkout.shipping, "tax": checkout.tax, "total": checkout.total},
        ucp_session_id=checkout.checkout_id,
        intent_mandate_id="",
        checkout_hash=checkout.checkout_hash,
    )
    with _session() as session:
        _store_mandate(session, cart_mandate, "cart", checkout.checkout_id, user_id)
        session.commit()
    verified, reason = _verify_cart(json.loads(cart_mandate.model_dump_json(by_alias=True)), checkout.checkout_hash)
    return {
        "intent_mandate_id": None,
        "cart_mandate_id": cart_mandate.id,
        "cart_verified": verified,
        "cart_reason": reason or None,
    }


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

    # The merchant only creates a checkout for a customer agent it has verified.
    trusted, decision = trust_sessions.require(current_user.user_id, normalized.merchant_id, SCOPE_CHECKOUT,
                                               chat_session_id=req.session_id,
                                               trusted_session_id=req.trusted_session_id)
    if trusted is None:
        raise HTTPException(status_code=403, detail=f"TRUST_VALIDATION_FAILED: {decision.reason}")

    checkout, error = await build_checkout(normalized, req.quantity, current_user.user_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    checkout_out = checkout.model_dump(mode="json")
    checkout_out["ap2"] = _issue_checkout_mandates(checkout, normalized, req.session_id, current_user.user_id)
    return checkout_out


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

    with _session() as session:
        cart_doc = _load_mandate(session, req.checkout_id, "cart")
    cart_ok, cart_reason = _verify_cart(cart_doc, req.checkout_hash)
    if not cart_ok:
        raise HTTPException(status_code=400, detail=f"AP2 verification failed: {cart_reason}")

    token_id, token_dict, error = await request_dpat(
        checkout, current_user.user_id, authorization_id
    )
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Persist authorization + token + consent audit event
    with _session() as session:
        persist_dpat(session, token_id=token_id, token_dict=token_dict, authorization_id=authorization_id,
                     user_id=current_user.user_id, checkout=checkout)

        payment_mandate = _ap2.create_payment_mandate(
            cart_mandate=AP2CartMandate(**cart_doc),
            order_id=req.checkout_id,
            payment_ref=token_id,
            user_id=current_user.user_id,
        )
        _store_mandate(session, payment_mandate, "payment", req.checkout_id, current_user.user_id)

        spt_doc = _acp.issue_document(
            dpat_token_id=token_id,
            merchant_id=req.merchant_id,
            total_cents=round(req.total * 100),
            brand=req.card_brand or "card",
            last4=req.card_last4 or "0000",
            currency=req.currency,
        )
        session.add(AcpSharedToken(
            spt_id=spt_doc["token"]["id"],
            dpat_token_id=token_id,
            checkout_id=req.checkout_id,
            document=json.dumps(spt_doc),
        ))

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
        protocols={
            "ap2_cart_verified": True,
            "ap2_payment_mandate_id": payment_mandate.id,
            "acp_spt_id": spt_doc["token"]["id"],
            "acp_maximum_amount_cents": spt_doc["token"]["constraints"]["maximum_amount"],
            "acp_currency": spt_doc["token"]["constraints"]["currency"],
            "acp_expiration": spt_doc["token"]["constraints"]["expiration"],
            "dpat_token_id": token_id,
        },
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
