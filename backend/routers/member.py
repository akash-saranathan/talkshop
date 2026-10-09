"""
Cardmember API (Part 2). No AI in any endpoint.

  GET /api/member     who am I in the marketplace: eligibility, masked accounts,
                      rewards balance, agent-pay status. Open to any session (a
                      guest or a checking-only customer learns *why* they can't
                      enter); everything else needs require_cardmember.
  GET /api/offers     the member's entitled offers (cardmembers only)
  GET /api/rewards    rewards summary + ledger (cardmembers only)

  POST /api/auth/register-cardmember   {full_name, email, password, last4}
        New customer: name + email + last four digits must match one record in
        the SIMULATED Chase cardholder directory; then the account is created
        and the cardholder's accounts are linked. Nothing is created otherwise.
  POST /api/member/verify-card         {last4}
        Signed-in customer without an eligible card (e.g. an older account):
        the account's own name + email + these digits must match.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.auth.security import create_access_token, hash_password
from backend.db.init_db import STARTING_WALLET_BALANCE
from backend.db.schema import LoyaltyPoints, User, Wallet
from backend.db.session_utils import get_session, write_audit_event
from backend.shop import cardholder_verification as verification
from backend.shop import eligibility, offers, rewards
from backend.shop.eligibility import require_cardmember

router = APIRouter(tags=["member"])


def member_summary(db, user: CurrentUser) -> dict:
    code = eligibility.check(db, user)
    out = {"signed_in": not user.is_visitor, "eligible": code is None, "code": code,
           "message": eligibility.MESSAGES.get(code) if code else None, "member": None}
    if user.is_visitor:
        return out
    row = db.query(User).filter_by(user_id=user.user_id).first()
    lp = db.query(LoyaltyPoints).filter_by(user_id=user.user_id).first()
    cards = eligibility.eligible_cards(db, user.user_id)
    primary = cards[0] if cards else None
    out["member"] = {
        "name": user.name,
        "member_since": row.created_at.date().isoformat() if row and row.created_at else None,
        "status": "Eligible cardmember" if code is None else "Not eligible for the marketplace",
        "accounts": eligibility.accounts(db, user.user_id),
        "primary_card": eligibility.card_view(primary) if primary else None,
        "rewards_balance": lp.balance if lp else 0,
    }
    if code is None:
        from backend.routers.vic import status_view
        out["member"]["agent_pay"] = status_view(db, user.user_id)["cards"]
    return out


@router.get("/api/member")
def get_member(user: CurrentUser = Depends(get_current_user)):
    with get_session() as db:
        return member_summary(db, user)


@router.get("/api/offers")
def get_offers(user: CurrentUser = Depends(require_cardmember)):
    with get_session() as db:
        return [offers.offer_view(db, o, user.user_id) for o in offers.entitled(db, user.user_id)]


@router.get("/api/rewards")
def get_rewards(user: CurrentUser = Depends(require_cardmember)):
    with get_session() as db:
        return {**rewards.summary(db, user.user_id), "ledger": rewards.ledger(db, user.user_id)}


# ── Sign up as a cardmember / verify a card (simulated issuer directory) ─────

class CardmemberSignup(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=200)
    last4: str = Field(..., min_length=4, max_length=4)


class VerifyCard(BaseModel):
    last4: str = Field(..., min_length=4, max_length=4)


def _refused(exc: verification.VerificationError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": {"code": exc.code, "message": exc.message}})


@router.post("/api/auth/register-cardmember")
def register_cardmember(req: CardmemberSignup, authorization: Optional[str] = Header(default=None)):
    from backend.routers.auth import AuthResponse, _adopt_visitor, _visitor_id
    email = req.email.strip().lower()
    with get_session() as db:
        if db.query(User).filter(User.email == email).first():
            return JSONResponse(status_code=409, content={"detail": {
                "code": "EMAIL_EXISTS",
                "message": "An account with this email already exists. Sign in, then verify your Chase card."}})
        try:
            records = verification.match(db, req.full_name, email, req.last4)
        except verification.VerificationError as exc:
            return _refused(exc)
        user_id = f"USR{uuid.uuid4().hex[:6].upper()}"
        name = " ".join(req.full_name.split())
        db.add(User(user_id=user_id, name=name, email=email, password_hash=hash_password(req.password), status="active"))
        db.add(Wallet(user_id=user_id, balance=STARTING_WALLET_BALANCE))
        db.add(LoyaltyPoints(user_id=user_id, balance=0, lifetime_points=0))
        linked = verification.link(db, user_id, records, name)
        write_audit_event(db, "CARDMEMBER_SIGNUP", user_id=user_id,
                          metadata={"linked": [verification.view(a) for a in linked], "issuer": "Chase (simulated)"})
        db.commit()
    current = CurrentUser(user_id=user_id, name=name, email=email)
    merged = _adopt_visitor(_visitor_id(authorization), user_id)
    return AuthResponse(access_token=create_access_token(user_id), user=current, merged_lines=merged)


@router.post("/api/member/verify-card")
def verify_card(req: VerifyCard, user: CurrentUser = Depends(get_current_user)):
    if user.is_visitor:
        return JSONResponse(status_code=403, content={"detail": {
            "code": "LOGIN_REQUIRED", "message": "Sign in first, then verify your card."}})
    with get_session() as db:
        try:
            records = verification.match(db, user.name, user.email, req.last4)
        except verification.VerificationError as exc:
            return _refused(exc)
        linked = verification.link(db, user.user_id, records, user.name)
        write_audit_event(db, "CARDMEMBER_VERIFIED", user_id=user.user_id,
                          metadata={"linked": [verification.view(a) for a in linked], "issuer": "Chase (simulated)"})
        db.commit()
        return member_summary(db, user)

