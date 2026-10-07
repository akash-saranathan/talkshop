"""
get_current_user — the single source of truth for "who is making this request."
Accepts the token via the Authorization header (normal fetch calls) OR a
?token= query param (needed because browser EventSource can't set custom
headers — this is how the chat SSE endpoint authenticates).
"""
from typing import Optional

from fastapi import Header, HTTPException, Query
from pydantic import BaseModel

from backend.auth.security import decode_access_token
from backend.db.schema import User
from backend.db.session_utils import get_session


class CurrentUser(BaseModel):
    user_id: str
    name: str
    email: str
    is_talkshop_guest: bool = False  # "Continue as Talkshop guest" account, not a registered customer


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
        return CurrentUser(user_id=user.user_id, name=user.name, email=user.email,
                           is_talkshop_guest=bool(user.is_guest))
