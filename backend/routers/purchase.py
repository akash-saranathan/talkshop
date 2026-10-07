"""
Demo 2 purchase endpoints. The browser makes one call per human decision; the
server runs everything in between (see backend/purchase/service.py).

  GET  /api/payment-methods        saved payment method references (brand + last4 only)
  POST /api/psp/tokenize           mock processor tokenization for a Talkshop guest's card
  POST /api/trust/session          customer agent connects to a merchant and opens a trusted session
  POST /api/purchase/checkout      product selection -> merchant checkout -> order proposal
  POST /api/purchase/go-ahead      GO AHEAD -> authorization -> payment -> order
  POST /api/purchase/reconsent     YES / NO after the merchant changed a term
  POST /api/merchant/payments      merchant charges a delegated token (used directly by tests)
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.payment import methods
from backend.purchase import service
from backend.trust import credentials, sessions
from backend.trust.models import SCOPE_CATALOG

router = APIRouter()


class TokenizeRequest(BaseModel):
    number: str = Field(repr=False)
    exp_month: int
    exp_year: int
    cvc: str = Field(repr=False)


class TrustSessionRequest(BaseModel):
    merchant_id: str
    chat_session_id: Optional[str] = None
    demo: Optional[str] = None


class CheckoutRequest(BaseModel):
    product_id: str
    quantity: int = 1
    chat_session_id: Optional[str] = None
    trusted_session_id: Optional[str] = None
    payment_method_id: Optional[str] = None


class GoAheadRequest(BaseModel):
    checkout_id: str
    checkout_hash: str
    total: float
    currency: str = "USD"
    payment_method_id: str
    demo: Optional[str] = None
    # "click" = the customer pressed GO AHEAD; "auto_countdown" = the visible 10-second
    # countdown on the proposal ran out without the customer pausing or cancelling.
    consent_mode: Literal["click", "auto_countdown"] = "click"


class ReconsentRequest(BaseModel):
    checkout_id: str
    decision: Literal["yes", "no"]


class MerchantChargeRequest(BaseModel):
    token_id: str
    checkout_id: str
    amount: float
    currency: str = "USD"


@router.get("/api/payment-methods")
async def list_payment_methods(current_user: CurrentUser = Depends(get_current_user)):
    return {
        "talkshop_account": "talkshop_guest" if current_user.is_talkshop_guest else "authenticated",
        "payment_methods": methods.list_methods(current_user.user_id, current_user.is_talkshop_guest),
    }


@router.post("/api/psp/tokenize")
async def tokenize(req: TokenizeRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Plays the card processor's hosted card field. The number and CVC are validated
    in memory and dropped; only a reference with brand and last4 is kept or returned.
    """
    pm, error = methods.tokenize_card(current_user.user_id, req.number, req.exp_month, req.exp_year, req.cvc)
    if error:
        return JSONResponse(status_code=400, content={"error": error})
    return {"payment_method": pm}


@router.post("/api/trust/session")
async def open_trust_session(req: TrustSessionRequest, current_user: CurrentUser = Depends(get_current_user)):
    credential = credentials.issue_customer_agent_credential(
        current_user.user_id, is_talkshop_guest=current_user.is_talkshop_guest,
        simulate=req.demo if req.demo == "bad_agent_credential" else None)
    decision, trusted = sessions.establish(credential, req.merchant_id, req.chat_session_id or "rest", SCOPE_CATALOG)
    body = {"verified": decision.verified, "checks": [c.model_dump() for c in decision.checks],
            "failed_check": decision.failed_check, "reason": decision.reason,
            "trusted_session": trusted.model_dump() if trusted else None}
    return JSONResponse(status_code=200 if decision.verified else 403, content=body)


@router.post("/api/purchase/checkout")
async def purchase_checkout(req: CheckoutRequest, current_user: CurrentUser = Depends(get_current_user)):
    result = await service.create_proposal(
        user_id=current_user.user_id, is_talkshop_guest=current_user.is_talkshop_guest,
        product_id=req.product_id, quantity=req.quantity, chat_session_id=req.chat_session_id,
        trusted_session_id=req.trusted_session_id, payment_method_id=req.payment_method_id)
    status = 200
    if result["status"] == "rejected":
        status = {"TRUST_VALIDATION_FAILED": 403, "PRODUCT_NOT_FOUND": 404}.get(result["reason"], 400)
    return JSONResponse(status_code=status, content=result)


@router.post("/api/purchase/go-ahead")
async def purchase_go_ahead(req: GoAheadRequest, current_user: CurrentUser = Depends(get_current_user)):
    return await service.go_ahead(
        user_id=current_user.user_id, checkout_id=req.checkout_id, checkout_hash=req.checkout_hash,
        total=req.total, currency=req.currency, payment_method_id=req.payment_method_id, demo=req.demo,
        consent_mode=req.consent_mode)


@router.post("/api/purchase/reconsent")
async def purchase_reconsent(req: ReconsentRequest, current_user: CurrentUser = Depends(get_current_user)):
    return await service.reconsent(user_id=current_user.user_id, checkout_id=req.checkout_id, decision=req.decision)


@router.post("/api/merchant/payments")
async def merchant_payment(req: MerchantChargeRequest, current_user: CurrentUser = Depends(get_current_user)):
    return await service.merchant_charge(user_id=current_user.user_id, token_id=req.token_id,
                                         checkout_id=req.checkout_id, amount=req.amount, currency=req.currency)
