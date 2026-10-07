"""
Saved payment methods and the mock card processor's tokenization.

Only references are stored: payment_method_id, brand, last4 and expiry month/year.
A card number or CVC is never written to the database, a log, a trace event or
an LLM prompt.

Known Talkshop customers get demo cards on first use. A Talkshop guest has none,
and adds one through `tokenize_card`, which plays the role of a processor's
hosted card field: it validates the card in memory and hands back a reference.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.db.schema import SavedPaymentMethod
from backend.db.session_utils import get_session

# Demo cards for a known customer. Mirrors the cards the checkout UI has always shown.
_DEMO_CARDS = [
    {"brand": "Visa", "last4": "4242", "exp_month": 9, "exp_year": 2027, "is_default": True},
    {"brand": "Mastercard", "last4": "8317", "exp_month": 3, "exp_year": 2028, "is_default": False},
    {"brand": "Amex", "last4": "5591", "exp_month": 11, "exp_year": 2028, "is_default": False},
]


def masked(pm: SavedPaymentMethod) -> dict:
    return {
        "payment_method_id": pm.payment_method_id,
        "brand": pm.brand,
        "last4": pm.last4,
        "exp_month": pm.exp_month,
        "exp_year": pm.exp_year,
        "is_default": bool(pm.is_default),
        "display": f"{pm.brand} •••• {pm.last4}",
    }


def list_methods(user_id: str, is_talkshop_guest: bool) -> list[dict]:
    with get_session() as db:
        rows = db.query(SavedPaymentMethod).filter(SavedPaymentMethod.user_id == user_id).all()
        if not rows and not is_talkshop_guest:
            for card in _DEMO_CARDS:
                db.add(SavedPaymentMethod(payment_method_id=f"pm_{uuid.uuid4().hex[:12]}", user_id=user_id, **card))
            db.commit()
            rows = db.query(SavedPaymentMethod).filter(SavedPaymentMethod.user_id == user_id).all()
        rows.sort(key=lambda r: (not r.is_default, r.id))
        return [masked(r) for r in rows]


def get_method(user_id: str, payment_method_id: str) -> Optional[dict]:
    with get_session() as db:
        row = db.query(SavedPaymentMethod).filter(
            SavedPaymentMethod.user_id == user_id,
            SavedPaymentMethod.payment_method_id == payment_method_id,
        ).first()
        return masked(row) if row else None


def default_method(user_id: str, is_talkshop_guest: bool) -> Optional[dict]:
    methods = list_methods(user_id, is_talkshop_guest)
    return methods[0] if methods else None


def _luhn_ok(digits: str) -> bool:
    total, parity = 0, len(digits) % 2
    for i, ch in enumerate(digits):
        d = int(ch)
        if i % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _brand(digits: str) -> str:
    if digits.startswith("4"):
        return "Visa"
    if digits[:2] in {"51", "52", "53", "54", "55"} or 2221 <= int(digits[:4]) <= 2720:
        return "Mastercard"
    if digits[:2] in {"34", "37"}:
        return "Amex"
    return "Card"


def tokenize_card(user_id: str, number: str, exp_month: int, exp_year: int, cvc: str) -> tuple[Optional[dict], Optional[str]]:
    """
    Mock processor tokenization: validate in memory, keep only brand + last4 + expiry.
    Returns (masked payment method, error). The number and CVC are dropped here.
    """
    digits = "".join(ch for ch in number if ch.isdigit())
    if not 13 <= len(digits) <= 19 or not _luhn_ok(digits):
        return None, "card_number_invalid"
    if not (cvc.isdigit() and len(cvc) in (3, 4)):
        return None, "cvc_invalid"
    now = datetime.now(timezone.utc)
    year = exp_year + 2000 if exp_year < 100 else exp_year
    if not 1 <= exp_month <= 12 or (year, exp_month) < (now.year, now.month):
        return None, "card_expired"
    with get_session() as db:
        db.query(SavedPaymentMethod).filter(SavedPaymentMethod.user_id == user_id).update({"is_default": False})
        row = SavedPaymentMethod(payment_method_id=f"pm_{uuid.uuid4().hex[:12]}", user_id=user_id,
                                 brand=_brand(digits), last4=digits[-4:], exp_month=exp_month, exp_year=year,
                                 is_default=True)
        db.add(row)
        db.commit()
        return masked(row), None


def processor_wallet(method: dict) -> dict:
    """The processor's view of the chosen card, in the shape mock_processor.process_payment expects."""
    return {"payment_methods": [{
        "payment_method_id": method["payment_method_id"],
        "card_brand": method["brand"],
        "masked_pan": method["last4"],
        "expiry_month": method["exp_month"],
        "expiry_year": method["exp_year"],
        "status": "active",
        "is_default": True,
    }]}
