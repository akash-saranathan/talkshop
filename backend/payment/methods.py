"""
Saved payment methods.

Only references are stored: payment_method_id, brand, last4 and expiry month/year
(or, for PayPal, just an authorized reference). A raw card number or CVC never
reaches this module, the database, a log, a trace event or an LLM prompt — the
browser validates and tokenizes the card locally (frontend secure payment entry)
and sends only the non-sensitive reference here.

Saved methods are scoped to (user, merchant): a card held by Nike is not visible
to Adidas. A member of a merchant has that merchant's card seeded at account
creation (backend/config/demo_profile.py). For a merchant the customer is a guest
to, there is no saved method until they add one through the secure entry.
"""
from __future__ import annotations

import uuid
from typing import Optional

from backend.db.schema import SavedPaymentMethod
from backend.db.session_utils import get_session


def masked(pm: SavedPaymentMethod) -> dict:
    provider = pm.provider or "card"
    display = "PayPal" if provider == "paypal" else f"{pm.brand} •••• {pm.last4}"
    return {
        "payment_method_id": pm.payment_method_id,
        "provider": provider,
        "brand": pm.brand,
        "last4": pm.last4,
        "exp_month": pm.exp_month,
        "exp_year": pm.exp_year,
        "is_default": bool(pm.is_default),
        "merchant_id": pm.merchant_id,
        "display": display,
    }


def list_methods(user_id: str, merchant_id: Optional[str] = None) -> list[dict]:
    """Saved cards for the user. Scoped to one merchant when merchant_id is given;
    otherwise every saved card across merchants (e.g. a profile-wide view)."""
    with get_session() as db:
        q = db.query(SavedPaymentMethod).filter(SavedPaymentMethod.user_id == user_id)
        if merchant_id is not None:
            q = q.filter(SavedPaymentMethod.merchant_id == merchant_id)
        rows = q.all()
        rows.sort(key=lambda r: (not r.is_default, r.id))
        return [masked(r) for r in rows]


def get_method(user_id: str, payment_method_id: str) -> Optional[dict]:
    with get_session() as db:
        row = db.query(SavedPaymentMethod).filter(
            SavedPaymentMethod.user_id == user_id,
            SavedPaymentMethod.payment_method_id == payment_method_id,
        ).first()
        return masked(row) if row else None


def default_method(user_id: str, merchant_id: Optional[str] = None) -> Optional[dict]:
    methods = list_methods(user_id, merchant_id)
    return methods[0] if methods else None


def _make_default_for_merchant(db, user_id: str, merchant_id: Optional[str]) -> None:
    # Default flag is per merchant scope, so a new method for one merchant
    # doesn't unset the default held by another.
    db.query(SavedPaymentMethod).filter(
        SavedPaymentMethod.user_id == user_id,
        SavedPaymentMethod.merchant_id == merchant_id,
    ).update({"is_default": False})


def register_card(user_id: str, brand: str, last4: str, exp_month: int, exp_year: int,
                  merchant_id: Optional[str] = None) -> tuple[Optional[dict], Optional[str]]:
    """
    Register a card the browser has already tokenized. Only the non-sensitive
    reference (brand, last4, expiry) is accepted — never a PAN or CVC. Scoped to
    the merchant being paid. Returns (masked method, error).
    """
    if not (last4.isdigit() and len(last4) == 4):
        return None, "reference_invalid"
    if not (1 <= exp_month <= 12):
        return None, "reference_invalid"
    year = exp_year + 2000 if exp_year < 100 else exp_year
    with get_session() as db:
        _make_default_for_merchant(db, user_id, merchant_id)
        row = SavedPaymentMethod(payment_method_id=f"pm_{uuid.uuid4().hex[:12]}", user_id=user_id,
                                 merchant_id=merchant_id, provider="card",
                                 brand=brand or "Card", last4=last4, exp_month=exp_month, exp_year=year,
                                 is_default=True)
        db.add(row)
        db.commit()
        return masked(row), None


def delete_method(user_id: str, payment_method_id: str) -> bool:
    """Remove a saved method. Used to forget a non-member's one-off method after
    checkout (guest-style: the card wasn't kept), never a seeded member card."""
    with get_session() as db:
        n = db.query(SavedPaymentMethod).filter(
            SavedPaymentMethod.user_id == user_id,
            SavedPaymentMethod.payment_method_id == payment_method_id,
        ).delete(synchronize_session=False)
        db.commit()
        return n > 0


def register_paypal(user_id: str, merchant_id: Optional[str] = None) -> dict:
    """
    Register a PayPal authorization returned by the (mocked) PayPal handoff. No
    PayPal credentials ever reach the backend — only an opaque authorization
    reference, treated like any other payment method. Scoped to the merchant.
    """
    with get_session() as db:
        _make_default_for_merchant(db, user_id, merchant_id)
        row = SavedPaymentMethod(payment_method_id=f"pp_auth_{uuid.uuid4().hex[:12]}", user_id=user_id,
                                 merchant_id=merchant_id, provider="paypal",
                                 brand="PayPal", last4="0000", exp_month=12, exp_year=2099,
                                 is_default=True)
        db.add(row)
        db.commit()
        return masked(row)


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
