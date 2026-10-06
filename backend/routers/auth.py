"""
Authentication — register, login, current-user lookup.
Passwords hashed with bcrypt; sessions are stateless JWTs
(backend/auth/security.py). Logout is client-side only (discard the token) —
no server-side revocation list for a demo JWT.
"""
import secrets
import uuid

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.auth.security import create_access_token, decode_access_token, hash_password, verify_password
from backend.db.init_db import STARTING_WALLET_BALANCE
from backend.db.schema import User, Wallet
from backend.db.session_utils import get_session

router = APIRouter()


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr
    password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GuestRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: EmailStr


class AuthResponse(BaseModel):
    access_token: str
    user: CurrentUser
    # After a visitor logs in: their old cart line ids → the line ids in the account
    merged_lines: dict[str, str] = {}


def _visitor_id(authorization: Optional[str]) -> Optional[str]:
    """The visitor behind the request's token, if it is a visitor."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    user_id = decode_access_token(authorization[len("Bearer "):])
    if not user_id:
        return None
    with get_session() as session:
        u = session.query(User).filter(User.user_id == user_id).first()
        return u.user_id if u and u.is_guest else None


def _adopt_visitor(visitor_id: Optional[str], customer_id: str) -> dict[str, str]:
    """Bring a visitor's cart and Talkshop conversations into the account they
    just logged in to (or created), then remove the visitor."""
    if not visitor_id or visitor_id == customer_id:
        return {}
    from backend.shop.cart import merge_carts
    from backend.talkshop import state as talkshop_state
    with get_session() as session:
        mapping = merge_carts(session, visitor_id, customer_id)
        session.query(Wallet).filter(Wallet.user_id == visitor_id).delete()
        session.query(User).filter(User.user_id == visitor_id, User.is_guest.is_(True)).delete()
        session.commit()
    talkshop_state.rekey(visitor_id, customer_id)
    return mapping


@router.post("/api/auth/visitor", response_model=AuthResponse)
async def visitor():
    """An anonymous visitor session: browse, fill a cart and chat with Talkshop
    without an account. Nothing about the visitor is stored except the cart."""
    with get_session() as session:
        user_id = f"VIS{uuid.uuid4().hex[:8].upper()}"
        session.add(User(
            user_id=user_id, name="Visitor",
            email=f"{user_id.lower()}@visitor.invalid",          # placeholder; never shown
            password_hash=hash_password(secrets.token_urlsafe(24)),  # can't be logged in to
            status="active", is_guest=True,
        ))
        session.commit()
    current = CurrentUser(user_id=user_id, name="Visitor", email="", is_visitor=True)
    return AuthResponse(access_token=create_access_token(user_id), user=current)


@router.post("/api/auth/register", response_model=AuthResponse)
async def register(req: RegisterRequest, authorization: Optional[str] = Header(default=None)):
    with get_session() as session:
        existing = session.query(User).filter(User.email == req.email).first()
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists")

        user_id = f"USR{uuid.uuid4().hex[:6].upper()}"
        session.add(User(
            user_id=user_id,
            name=req.name,
            email=req.email,
            password_hash=hash_password(req.password),
            status="active",
        ))
        session.add(Wallet(user_id=user_id, balance=STARTING_WALLET_BALANCE))
        session.commit()

    current = CurrentUser(user_id=user_id, name=req.name, email=req.email)
    merged = _adopt_visitor(_visitor_id(authorization), user_id)
    return AuthResponse(access_token=create_access_token(user_id), user=current, merged_lines=merged)


@router.post("/api/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest, authorization: Optional[str] = Header(default=None)):
    with get_session() as session:
        user = session.query(User).filter(User.email == req.email).first()
        if not user or user.is_guest or not verify_password(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect email or password")
        current = CurrentUser(user_id=user.user_id, name=user.name, email=user.email)

    merged = _adopt_visitor(_visitor_id(authorization), current.user_id)
    return AuthResponse(access_token=create_access_token(current.user_id), user=current, merged_lines=merged)


@router.post("/api/auth/guest", response_model=AuthResponse)
async def guest(req: GuestRequest):
    """
    Start a guest session. Only registered customers' details are persisted:
    the guest's name and email are checked against customer accounts but
    never written — the session runs on an anonymous placeholder account
    (cart and orders need a user_id), and the name/email are echoed back
    for the UI only. Every guest login is therefore a fresh session.

    An email that belongs to a registered customer is refused, so a guest
    session is never a way into someone's account without their password.
    """
    with get_session() as session:
        customer = (
            session.query(User)
            .filter(User.email == req.email, User.is_guest.is_(False))
            .first()
        )
        if customer:
            raise HTTPException(
                status_code=409,
                detail="You're already a customer with this email. Please log in instead.",
            )
        user_id = f"USR{uuid.uuid4().hex[:6].upper()}"
        session.add(User(
            user_id=user_id,
            name="Guest",
            # Placeholder only — keeps the unique/not-null column satisfied
            # without storing the guest's real address. .invalid never resolves.
            email=f"guest-{user_id.lower()}@guest.invalid",
            # Never used to log in — guests can't log back in to this account.
            password_hash=hash_password(secrets.token_urlsafe(24)),
            status="active",
            is_guest=True,
        ))
        session.add(Wallet(user_id=user_id, balance=STARTING_WALLET_BALANCE))
        session.commit()

    current = CurrentUser(user_id=user_id, name=req.name, email=req.email)
    return AuthResponse(access_token=create_access_token(user_id), user=current)


@router.get("/api/auth/me", response_model=CurrentUser)
async def me(current_user: CurrentUser = Depends(get_current_user)):
    return current_user


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    new_password: str = Field(..., min_length=8)


@router.post("/api/auth/reset-password")
async def reset_password(req: ResetPasswordRequest):
    with get_session() as session:
        user = session.query(User).filter(User.email == req.email).first()
        if not user:
            raise HTTPException(status_code=404, detail="No account found with that email")
        user.password_hash = hash_password(req.new_password)
        session.commit()
    return {"ok": True}
