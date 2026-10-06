"""
ShopSphere merchant services API (Demo 1, Phase 2) — no AI in any endpoint.
The website calls these directly; Talkshop calls the same services as tools.

Cart (SKU-based; every call returns the full cart)
  GET    /api/cart/lines
  POST   /api/cart/lines                {sku, quantity}
  PATCH  /api/cart/lines/{line_id}      {quantity}   (0 removes)
  DELETE /api/cart/lines/{line_id}

Customer profile (cards are stored masked; number/CVC are never kept)
  GET/POST /api/me/addresses              DELETE /api/me/addresses/{id}
  GET/POST /api/me/payment-methods        DELETE /api/me/payment-methods/{id}

Checkout + payment
  POST /api/checkouts                       {line_ids}       → review snapshot
  GET  /api/checkouts/{id}
  PATCH /api/checkouts/{id}                 {delivery_method?, address_id?, payment_method_id?, quantities?}
  POST /api/checkouts/{id}/cancel
  POST /api/checkouts/{id}/confirm          {consent: true}  → authorized order | declined | blocked

The older /api/cart and /api/cart/items endpoints (product-level, no SKU) stay
for the current chat UI until Demo 1 Phase 5 replaces it.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.auth.dependencies import CurrentUser, get_current_user, require_customer
from backend.db.init_db import get_engine
from backend.shop import cart as cart_service
from backend.shop import checkout as checkout_service
from backend.shop import payment as payment_service
from backend.shop import profile as profile_service

router = APIRouter(tags=["shop"])


def get_db():
    with Session(get_engine()) as session:
        yield session


def _error(exc) -> JSONResponse:
    body = {"code": exc.code, "message": exc.message}
    body.update(getattr(exc, "detail", None) or {})
    return JSONResponse(status_code=exc.status, content={"detail": body})


# ── Cart ─────────────────────────────────────────────────────────────────────

class AddLineRequest(BaseModel):
    sku: str
    quantity: int = Field(1, ge=1, le=20)


class QuantityRequest(BaseModel):
    quantity: int = Field(..., ge=0, le=20)


@router.get("/api/cart/lines")
def get_cart(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return cart_service.get_cart(db, user.user_id)


@router.post("/api/cart/lines")
def add_cart_line(req: AddLineRequest, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        cart, line_id = cart_service.add_line(db, user.user_id, req.sku, req.quantity)
    except cart_service.CartError as exc:
        return _error(exc)
    return {**cart, "added_line_id": line_id}


@router.patch("/api/cart/lines/{line_id}")
def update_cart_line(line_id: str, req: QuantityRequest, user: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    try:
        return cart_service.set_quantity(db, user.user_id, line_id, req.quantity)
    except cart_service.CartError as exc:
        return _error(exc)


@router.delete("/api/cart/lines/{line_id}")
def delete_cart_line(line_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return cart_service.remove_line(db, user.user_id, line_id)
    except cart_service.CartError as exc:
        return _error(exc)


# ── Customer profile ─────────────────────────────────────────────────────────

class AddressRequest(BaseModel):
    full_name: str
    line1: str
    line2: Optional[str] = None
    city: str
    state: str
    postal_code: str
    label: Optional[str] = None
    make_default: bool = False


class CardRequest(BaseModel):
    number: str
    exp_month: int
    exp_year: int
    cvc: str
    cardholder_name: str
    make_default: bool = False


@router.get("/api/me/addresses")
def get_addresses(user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    return [profile_service.address_dict(a) for a in profile_service.list_addresses(db, user.user_id)]


@router.post("/api/me/addresses")
def add_address(req: AddressRequest, user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    try:
        a = profile_service.add_address(db, user.user_id, **req.model_dump())
    except profile_service.ProfileError as exc:
        return _error(exc)
    return profile_service.address_dict(a)


@router.get("/api/me/payment-methods")
def get_cards(user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    return [profile_service.card_dict(c) for c in profile_service.list_cards(db, user.user_id)]


@router.post("/api/me/payment-methods")
def add_card(req: CardRequest, user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    try:
        card = profile_service.add_card(db, user.user_id, **req.model_dump())
    except profile_service.ProfileError as exc:
        return _error(exc)
    return profile_service.card_dict(card)   # masked: brand, last 4, expiry


@router.delete("/api/me/addresses/{address_id}")
def delete_address(address_id: str, user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    try:
        default = profile_service.delete_address(db, user.user_id, address_id)
    except profile_service.ProfileError as exc:
        return _error(exc)
    checkout_service.reassign(db, user.user_id, "address_id", address_id, default)
    return {"deleted": address_id, "default_address_id": default}


@router.delete("/api/me/payment-methods/{payment_method_id}")
def delete_card(payment_method_id: str, user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    try:
        default = profile_service.delete_card(db, user.user_id, payment_method_id)
    except profile_service.ProfileError as exc:
        return _error(exc)
    checkout_service.reassign(db, user.user_id, "payment_method_id", payment_method_id, default)
    return {"deleted": payment_method_id, "default_payment_method_id": default}


# ── Checkout + payment ───────────────────────────────────────────────────────

class CreateCheckoutRequest(BaseModel):
    line_ids: list[str] = Field(..., min_length=1)


class UpdateCheckoutRequest(BaseModel):
    delivery_method: Optional[str] = None
    address_id: Optional[str] = None
    payment_method_id: Optional[str] = None
    quantities: Optional[dict[str, int]] = None   # cart line id → quantity


class ConfirmRequest(BaseModel):
    consent: bool = False   # true only from the customer's explicit GO AHEAD / Place order


@router.post("/api/checkouts")
def create_checkout(req: CreateCheckoutRequest, user: CurrentUser = Depends(require_customer),
                    db: Session = Depends(get_db)):
    try:
        co = checkout_service.create_checkout(db, user.user_id, req.line_ids)
    except checkout_service.CheckoutError as exc:
        return _error(exc)
    return checkout_service.snapshot(db, co)


@router.get("/api/checkouts/{checkout_id}")
def get_checkout(checkout_id: str, user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    try:
        return checkout_service.snapshot(db, checkout_service.get_checkout(db, user.user_id, checkout_id))
    except checkout_service.CheckoutError as exc:
        return _error(exc)


@router.patch("/api/checkouts/{checkout_id}")
def update_checkout(checkout_id: str, req: UpdateCheckoutRequest, user: CurrentUser = Depends(require_customer),
                    db: Session = Depends(get_db)):
    try:
        co = checkout_service.update_checkout(db, user.user_id, checkout_id, **req.model_dump())
    except checkout_service.CheckoutError as exc:
        return _error(exc)
    return checkout_service.snapshot(db, co)


@router.post("/api/checkouts/{checkout_id}/cancel")
def cancel_checkout(checkout_id: str, user: CurrentUser = Depends(require_customer), db: Session = Depends(get_db)):
    try:
        co = checkout_service.cancel_checkout(db, user.user_id, checkout_id)
    except checkout_service.CheckoutError as exc:
        return _error(exc)
    return checkout_service.snapshot(db, co)


@router.post("/api/checkouts/{checkout_id}/confirm")
async def confirm_checkout(checkout_id: str, req: ConfirmRequest, user: CurrentUser = Depends(require_customer)):
    try:
        return await payment_service.confirm(user, checkout_id, req.consent)
    except checkout_service.CheckoutError as exc:
        return _error(exc)
