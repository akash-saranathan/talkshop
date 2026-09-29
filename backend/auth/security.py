"""
Password hashing (bcrypt) and access tokens (JWT).
JWT secret follows the same pattern as backend/payment/signing.py's
SIGNING_KEY — loaded from env, demo fallback default (never use in prod).
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from dotenv import load_dotenv

load_dotenv()

_JWT_SECRET = os.getenv("JWT_SECRET_KEY", "demo-jwt-secret-replace-in-production")
_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24

# bcrypt silently ignores bytes beyond 72 — truncate explicitly so behavior is deterministic
_MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    pw_bytes = password.encode("utf-8")[:_MAX_PASSWORD_BYTES]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    pw_bytes = password.encode("utf-8")[:_MAX_PASSWORD_BYTES]
    try:
        return bcrypt.checkpw(pw_bytes, password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(hours=TOKEN_TTL_HOURS)}
    return jwt.encode(payload, _JWT_SECRET, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    """Returns the user_id if valid, None if missing/invalid/expired."""
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
