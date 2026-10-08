"""
Demo 2 purchase endpoints. The browser makes one call per human decision; the
server runs everything in between (see backend/purchase/service.py).

  GET  /api/payment-methods        saved payment method references (brand + last4 only)
  POST /api/psp/payment-methods    register a browser-tokenized card (reference only, no PAN/CVC)
  POST /api/psp/paypal-connect     register a (mocked) PayPal authorization reference
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


class RegisterCardRequest(BaseModel):
    """A card the browser already tokenized: only the non-sensitive reference.
    No PAN or CVC field exists here — raw card data never reaches the backend."""
    brand: str
    last4: str = Field(min_length=4, max_length=4)
    exp_month: int
    exp_year: int
    merchant_id: Optional[str] = None


class PayPalConnectRequest(BaseModel):
    merchant_id: Optional[str] = None


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
async def list_payment_methods(merchant_id: Optional[str] = None,
                               current_user: CurrentUser = Depends(get_current_user)):
    """Saved cards. Scoped to merchant_id when given; otherwise all the
    customer's cards across merchants (profile-wide view)."""
    return {
        "talkshop_account": "talkshop_guest" if current_user.is_talkshop_guest else "authenticated",
        "payment_methods": methods.list_methods(current_user.user_id, merchant_id),
    }


@router.post("/api/psp/payment-methods")
async def register_payment_method(req: RegisterCardRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Register a card the browser already validated and tokenized. Receives only
    the reference (brand, last4, expiry) — never a card number or CVC, which stay
    inside the browser's secure payment entry.
    """
    pm, error = methods.register_card(current_user.user_id, req.brand, req.last4, req.exp_month, req.exp_year,
                                      merchant_id=req.merchant_id)
    if error:
        return JSONResponse(status_code=400, content={"error": error})
    trace = service.Trace()
    trace.add("Secure payment entry", "CustomerAgent", "internal", "payment_method_attached", {
        "brand": pm["brand"], "last4": pm["last4"],
        "note": "Card tokenized in the browser. Only this reference crosses here — the card number and CVC never reach the agent, the merchant, the trace, or any log.",
    }, direction="in")
    return {"payment_method": pm, "events": trace.events}


@router.delete("/api/payment-methods/{payment_method_id}")
async def delete_payment_method(payment_method_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Forget a saved method — used to drop a non-member's one-off card/PayPal
    after checkout so that merchant stays a guest relationship."""
    methods.delete_method(current_user.user_id, payment_method_id)
    return {"ok": True}


@router.post("/api/psp/paypal-connect")
async def paypal_connect(req: PayPalConnectRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Mocked PayPal handoff result: the browser's simulated PayPal authorization
    returns here with no credentials, only the intent to register an authorized
    PayPal reference for this merchant. Not a real PayPal integration.
    """
    pm = methods.register_paypal(current_user.user_id, merchant_id=req.merchant_id)
    trace = service.Trace()
    trace.add("PayPal", "CustomerAgent", "internal", "paypal_authorization_received", {
        "reference": pm["payment_method_id"],
        "note": "PayPal authorization reference received after the handoff. No PayPal credentials are ever seen by the agent — only this reference.",
    }, direction="in")
    return {"payment_method": pm, "events": trace.events}


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
