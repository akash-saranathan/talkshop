"""
Simulated merchant account linking (demo only).

Stands in for the merchant's own sign-in. The merchant checks the email against
its own member records, sends a one-time code, and on approval issues a member
token for this customer. Talkshop never sees the merchant's login.

The merchant decides member vs guest from the token it issued: no token, an
expired token, or a token it did not issue all count as guest. Every merchant
call that depends on membership (trust check, checkout, points, payment) passes
the token and the merchant validates it on each call.

Points are the merchant's: the conversion to dollars, the discount, the new total
and the messages all come from this module, not from the checkout code.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import ceil
from typing import Optional

from backend.config.demo_profile import DEMO_EMAIL, member_merchants
from backend.db.schema import LoyaltyPoints, MerchantAccountLink
from backend.db.session_utils import get_session

# Demo one-time code. The merchant stub is the only place that checks it.
DEMO_OTP = "376496"
TOKEN_TTL = timedelta(days=30)
POINTS_PER_DOLLAR = 10  # demo: 10 points = $1

MERCHANT_NAMES = {
    "nike": "Nike", "zara": "Zara", "fossil": "Fossil",
    "adidas": "Adidas", "hm": "H&M", "casio": "Casio",
}


@dataclass
class PointsDecision:
    points_redeemed: int   # points the merchant applies to this order
    value_redeemed: float  # dollar value of those points
    amount_due: float      # what is still to pay after points
    fully_covered: bool    # True when points cover the whole order
    available: int         # total minus pending
    pending: int
    max_redeemable: int    # most points that can be applied to this order
    message: str           # the merchant's message for the customer


def merchant_name(merchant_id: str) -> str:
    return MERCHANT_NAMES.get(merchant_id, merchant_id)


def _account_email(merchant_id: str) -> Optional[str]:
    """The merchant's own record: only members have an account. Demo: John Carter's email."""
    return DEMO_EMAIL if merchant_id in member_merchants() else None


def start(merchant_id: str, email: str) -> tuple[bool, str]:
    """Step 1: the merchant looks the email up in its own records."""
    account = _account_email(merchant_id)
    if account is None or email.strip().lower() != account:
        return False, "No account found"
    return True, "We sent a one-time code"


def check_code(merchant_id: str, email: str, code: str) -> tuple[bool, str]:
    """Step 2: the merchant checks the one-time code."""
    ok, message = start(merchant_id, email)
    if not ok:
        return False, message
    if code.strip() != DEMO_OTP:
        return False, "Incorrect code, try again"
    return True, "Code accepted"


def approve(user_id: str, merchant_id: str, email: str, code: str) -> dict:
    """Final step: the customer approves sharing. The merchant issues a member token."""
    ok, message = check_code(merchant_id, email, code)
    if not ok:
        return {"ok": False, "message": message}
    token = "mtk_" + secrets.token_urlsafe(24)
    expires = datetime.utcnow() + TOKEN_TTL
    with get_session() as db:
        row = db.query(MerchantAccountLink).filter_by(user_id=user_id, merchant_id=merchant_id).first()
        if row is None:
            row = MerchantAccountLink(user_id=user_id, merchant_id=merchant_id)
            db.add(row)
        row.merchant_email = email.strip().lower()
        row.link_token = token
        row.expires_at = expires
        row.linked_at = datetime.utcnow()
        db.commit()
    return {"ok": True, "message": f"Linked to {merchant_name(merchant_id)}"}


def unlink(user_id: str, merchant_id: str) -> None:
    with get_session() as db:
        db.query(MerchantAccountLink).filter_by(user_id=user_id, merchant_id=merchant_id).delete()
        db.commit()


def unlink_all(user_id: str) -> None:
    with get_session() as db:
        db.query(MerchantAccountLink).filter_by(user_id=user_id).delete()
        db.commit()


def member_token(user_id: str, merchant_id: str) -> Optional[str]:
    """The token the customer's agent holds for this merchant. The agent sends it; it does not decide with it."""
    with get_session() as db:
        row = db.query(MerchantAccountLink).filter_by(user_id=user_id, merchant_id=merchant_id).first()
        return row.link_token if row else None


def validate_token(merchant_id: str, token: Optional[str]) -> bool:
    """The merchant's check, run on every call: did it issue this token, for this merchant, and is it still valid?"""
    if not token:
        return False
    with get_session() as db:
        row = db.query(MerchantAccountLink).filter_by(merchant_id=merchant_id, link_token=token).first()
        return row is not None and row.expires_at > datetime.utcnow()


def status(user_id: str, merchant_id: str) -> dict:
    """What the customer sees for one merchant: linked or not, and the token's expiry."""
    token = member_token(user_id, merchant_id)
    if token is None:
        return {"merchant_id": merchant_id, "linked": False}
    with get_session() as db:
        row = db.query(MerchantAccountLink).filter_by(user_id=user_id, merchant_id=merchant_id).first()
        return {
            "merchant_id": merchant_id,
            "linked": validate_token(merchant_id, token),
            "expires_at": row.expires_at.isoformat(),
        }


def relationship(user_id: str, merchant_id: str, token: Optional[str] = None) -> str:
    """Member vs guest, decided by the merchant from the token it is sent."""
    if token is None:
        token = member_token(user_id, merchant_id)
    return "merchant_member" if validate_token(merchant_id, token) else "merchant_guest"


def points_status(user_id: str, merchant_id: str, token: Optional[str] = None) -> Optional[dict]:
    """Merchant's answer for points: total, pending and available. None when not a member."""
    if token is None:
        token = member_token(user_id, merchant_id)
    if not validate_token(merchant_id, token):
        return None
    with get_session() as db:
        lp = db.query(LoyaltyPoints).filter_by(user_id=user_id, merchant_id=merchant_id).first()
        total = lp.balance if lp else 0
        pending = lp.pending_points if lp else 0
    return {"total": total, "pending": pending, "available": max(total - pending, 0)}


def _usable_points(available: int, order_total: float) -> int:
    """Most points that can usefully be applied: capped by the available balance and by what
    clears the total (rounded up to a whole point)."""
    if available <= 0 or order_total <= 0:
        return 0
    return min(available, ceil(round(order_total, 2) * POINTS_PER_DOLLAR))


def max_points(user_id: str, merchant_id: str, order_total: float, token: Optional[str] = None) -> int:
    status_ = points_status(user_id, merchant_id, token)
    return _usable_points(status_["available"], order_total) if status_ else 0


def apply_points(user_id: str, merchant_id: str, order_total: float,
                 points_requested: Optional[int] = None, token: Optional[str] = None) -> PointsDecision:
    """The merchant applies points to an order and returns the discount and the new total.
    points_requested None means as many as are usable. A guest gets nothing applied."""
    total = round(order_total, 2)
    if token is None:
        token = member_token(user_id, merchant_id)
    status_ = points_status(user_id, merchant_id, token)
    if status_ is None:
        return PointsDecision(0, 0.0, total, False, 0, 0, 0, "Link your account to use points")

    available, pending = status_["available"], status_["pending"]
    usable = _usable_points(available, total)
    requested = usable if points_requested is None else points_requested
    points = max(0, min(requested, usable))
    base = f"{pending} points pending, {available} available"

    if points <= 0 or total <= 0:
        return PointsDecision(0, 0.0, total, False, available, pending, usable, base)

    if points >= usable and usable == ceil(total * POINTS_PER_DOLLAR):
        return PointsDecision(points, total, 0.0, True, available, pending, usable,
                              f"{base}; {points} applied, covers the whole order")

    value = round(points / POINTS_PER_DOLLAR, 2)
    return PointsDecision(points, value, round(total - value, 2), False, available, pending, usable,
                          f"{base}; {points} applied")


def reset_points(user_id: str) -> None:
    """Restore each merchant's seeded balance and pending amount."""
    from backend.config.demo_profile import MERCHANT_PROFILE
    with get_session() as db:
        for merchant_id, prof in MERCHANT_PROFILE.items():
            if not prof.get("member"):
                continue
            lp = db.query(LoyaltyPoints).filter_by(user_id=user_id, merchant_id=merchant_id).first()
            if lp:
                lp.balance = prof["points"]
                lp.pending_points = prof.get("pending", 0)
        db.commit()
