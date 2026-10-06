"""
get_current_user — the single source of truth for "who is making this request."
Accepts the token via the Authorization header (normal fetch calls) OR a
?token= query param (needed because browser EventSource can't set custom
headers — this is how the chat SSE endpoint authenticates).
"""
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query
from pydantic import BaseModel

from backend.auth.security import decode_access_token
from backend.db.schema import User
from backend.db.session_utils import get_session


class CurrentUser(BaseModel):
    user_id: str
    name: str
    email: str
    # An anonymous visitor (Demo 1, Phase 8): can browse, fill a cart and chat
    # with Talkshop; needs to log in or sign up to check out.
    is_visitor: bool = False


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
) -> CurrentUser:
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization[len("Bearer "):]
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = decode_access_token(raw_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    with get_session() as session:
        user = session.query(User).filter(User.user_id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return CurrentUser(user_id=user.user_id, name=user.name, email=user.email, is_visitor=bool(user.is_guest))


async def require_customer(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """For checkout, payment, saved details and orders: visitors are asked to
    log in (403 LOGIN_REQUIRED — not 401, which would mean a bad token)."""
    if user.is_visitor:
        raise HTTPException(status_code=403, detail={
            "code": "LOGIN_REQUIRED", "message": "Please log in or create an account to continue."})
    return user
