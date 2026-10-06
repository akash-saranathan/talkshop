"""
Customer profile — saved shipping addresses and saved cards.

Cards are stored masked only: brand, last 4, expiry and a processor token
reference. The full number and CVC are validated here and then discarded;
nothing downstream (checkout, payment, Talkshop) ever sees them.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import Address, PaymentMethod


class ProfileError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def address_dict(a: Address) -> dict:
    return {
        "address_id": a.address_id, "label": a.label, "full_name": a.full_name,
        "line1": a.line1, "line2": a.line2, "city": a.city, "state": a.state,
        "postal_code": a.postal_code, "country": a.country, "is_default": bool(a.is_default),
        "display": f"{a.full_name}, {a.line1}{', ' + a.line2 if a.line2 else ''}, {a.city}, {a.state} {a.postal_code}",
    }


def card_dict(c: PaymentMethod) -> dict:
    return {
        "payment_method_id": c.payment_method_id, "brand": c.brand, "last4": c.last4,
        "exp_month": c.exp_month, "exp_year": c.exp_year, "cardholder_name": c.cardholder_name,
        "is_default": bool(c.is_default), "display": f"{c.brand} •••• {c.last4}",
    }


def list_addresses(db: Session, user_id: str) -> list[Address]:
    return (db.query(Address).filter_by(user_id=user_id)
            .order_by(Address.is_default.desc(), Address.id.asc()).all())


def list_cards(db: Session, user_id: str) -> list[PaymentMethod]:
    return (db.query(PaymentMethod).filter_by(user_id=user_id)
            .order_by(PaymentMethod.is_default.desc(), PaymentMethod.id.asc()).all())


def add_address(db: Session, user_id: str, *, full_name: str, line1: str, city: str, state: str,
                postal_code: str, line2: Optional[str] = None, label: Optional[str] = None,
                country: str = "US", make_default: bool = False) -> Address:
    for field, value in (("full_name", full_name), ("line1", line1), ("city", city),
                         ("state", state), ("postal_code", postal_code)):
        if not (value or "").strip():
            raise ProfileError("MISSING_FIELD", f"Please fill in {field.replace('_', ' ')}.")
    if not re.fullmatch(r"\d{5}(-\d{4})?", postal_code.strip()):
        raise ProfileError("INVALID_POSTAL_CODE", "ZIP code should look like 78704.")
    first = not list_addresses(db, user_id)
    if make_default or first:
        db.query(Address).filter_by(user_id=user_id).update({"is_default": False})
    a = Address(address_id=f"ADDR_{uuid.uuid4().hex[:10].upper()}", user_id=user_id, label=label or "Home",
                full_name=full_name.strip(), line1=line1.strip(), line2=(line2 or "").strip() or None,
                city=city.strip(), state=state.strip().upper(), postal_code=postal_code.strip(),
                country=country, is_default=make_default or first)
    db.add(a)
    db.commit()
    return a


def _luhn_ok(number: str) -> bool:
    total, parity = 0, len(number) % 2
    for i, ch in enumerate(number):
        d = int(ch)
        if i % 2 == parity:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def _brand(number: str) -> str:
    if number.startswith("4"):
        return "Visa"
    if re.match(r"5[1-5]|2[2-7]", number):
        return "Mastercard"
    if re.match(r"3[47]", number):
        return "Amex"
    if number.startswith("6"):
        return "Discover"
    return "Card"


def add_card(db: Session, user_id: str, *, number: str, exp_month: int, exp_year: int, cvc: str,
             cardholder_name: str, make_default: bool = False) -> PaymentMethod:
    digits = re.sub(r"\D", "", number or "")
    if not 13 <= len(digits) <= 19 or not _luhn_ok(digits):
        raise ProfileError("INVALID_CARD_NUMBER", "That card number doesn't look right.")
    if exp_year < 100:
        exp_year += 2000
    now = datetime.now(timezone.utc)
    if not 1 <= exp_month <= 12 or (exp_year, exp_month) < (now.year, now.month):
        raise ProfileError("CARD_EXPIRED", "That card has expired or the expiry date is invalid.")
    if not re.fullmatch(r"\d{3,4}", cvc or ""):
        raise ProfileError("INVALID_CVC", "CVC should be 3 or 4 digits.")
    if not (cardholder_name or "").strip():
        raise ProfileError("MISSING_FIELD", "Please enter the name on the card.")
    first = not list_cards(db, user_id)
    if make_default or first:
        db.query(PaymentMethod).filter_by(user_id=user_id).update({"is_default": False})
    card = PaymentMethod(
        payment_method_id=f"PM_{uuid.uuid4().hex[:10].upper()}", user_id=user_id,
        brand=_brand(digits), last4=digits[-4:], exp_month=exp_month, exp_year=exp_year,
        cardholder_name=cardholder_name.strip(),
        token_ref=f"tok_{uuid.uuid4().hex}",    # stand-in for the processor's vault token
        behaviour="approve", is_default=make_default or first,
    )
    db.add(card)
    db.commit()
    return card   # the number and CVC go no further than this function
