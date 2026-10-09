"""
CardmemberEligibilityService (Part 2, Phase 13) — who may enter the ShopSphere
cardmember marketplace. Deterministic, server-side, no AI.

The rule: a signed-in member with at least one ACTIVE Chase credit card that is
marked marketplace-eligible. All issuer data is a simulated fixture
(card_accounts); nothing here talks to a bank.

  not signed in (visitor)          → LOGIN_REQUIRED
  signed in, no eligible card      → NO_ELIGIBLE_CARD   (e.g. checking only)
  signed in, eligible credit card  → eligible
"""
import secrets
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.db.schema import CardAccount, PaymentMethod
from backend.db.session_utils import get_session

ISSUER = "Chase"

MESSAGES = {
    "LOGIN_REQUIRED": "Sign in with your cardmember account to enter ShopSphere.",
    "NO_ELIGIBLE_CARD": "ShopSphere is for eligible Chase credit-card members. "
                        "We couldn't find an eligible credit card on this account.",
}


def eligible_cards(db: Session, user_id: str) -> list[CardAccount]:
    return (db.query(CardAccount)
            .filter_by(user_id=user_id, issuer=ISSUER, account_type="credit_card",
                       status="active", marketplace_eligible=True)
            .order_by(CardAccount.id).all())


def check(db: Session, user: CurrentUser) -> Optional[str]:
    """None when eligible, otherwise the denial code."""
    if user.is_visitor:
        return "LOGIN_REQUIRED"
    if not eligible_cards(db, user.user_id):
        return "NO_ELIGIBLE_CARD"
    return None


def denial(code: str) -> HTTPException:
    return HTTPException(status_code=403, detail={"code": code, "message": MESSAGES[code]})


async def require_cardmember(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """FastAPI dependency for every marketplace API (catalog, cart, offers,
    rewards, profile, checkout, Talkshop). Hidden UI is not the control: this is."""
    with get_session() as db:
        code = check(db, user)
    if code:
        raise denial(code)
    return user


def card_view(acct: CardAccount) -> dict:
    """Masked metadata only — never a card number, CVV or token."""
    return {"account_id": acct.account_id, "issuer": acct.issuer, "account_type": acct.account_type,
            "product_name": acct.product_name, "network": acct.network, "last4": acct.last4,
            "status": acct.status, "marketplace_eligible": bool(acct.marketplace_eligible),
            "payment_method_id": acct.payment_method_id}


def accounts(db: Session, user_id: str) -> list[dict]:
    return [card_view(a) for a in db.query(CardAccount).filter_by(user_id=user_id).order_by(CardAccount.id)]


def card_account_for_payment_method(db: Session, user_id: str, payment_method_id: Optional[str]) -> Optional[CardAccount]:
    if not payment_method_id:
        return None
    return db.query(CardAccount).filter_by(user_id=user_id, payment_method_id=payment_method_id).first()


def link_demo_card(db: Session, user_id: str, *, network: str = "Visa", last4: Optional[str] = None,
                   account_type: str = "credit_card", eligible: bool = True, behaviour: str = "approve",
                   with_payment_method: bool = True, is_default: bool = True,
                   credit_limit: float = 8000.0) -> CardAccount:
    """Create a simulated Chase account for a user (seed data and tests).
    For a credit card, also saves the masked card used to pay. The processor
    token reference is random — never derived from the last four digits."""
    last4 = last4 or f"{secrets.randbelow(10000):04d}"
    suffix = secrets.token_hex(3).upper()
    pm_id = None
    if account_type == "credit_card" and with_payment_method:
        pm_id = f"PM_{network[:4].upper()}_{last4}_{suffix}"
        if is_default:
            db.query(PaymentMethod).filter_by(user_id=user_id).update({"is_default": False})
        db.add(PaymentMethod(payment_method_id=pm_id, user_id=user_id, brand=network, last4=last4,
                             exp_month=9, exp_year=2030, cardholder_name=None,
                             token_ref=f"tok_{secrets.token_urlsafe(18)}", behaviour=behaviour,
                             is_default=is_default))
    label = f"Chase {network} credit card" if account_type == "credit_card" else f"Chase {account_type}"
    acct = CardAccount(account_id=f"ACCT_{secrets.token_hex(6).upper()}", user_id=user_id, issuer=ISSUER,
                       account_type=account_type, product_name=label,
                       network=network if account_type == "credit_card" else None, last4=last4,
                       status="active", marketplace_eligible=eligible and account_type == "credit_card",
                       payment_method_id=pm_id,
                       credit_limit=credit_limit if account_type == "credit_card" else None,
                       available_credit=credit_limit if account_type == "credit_card" else None)
    db.add(acct)
    db.commit()
    return acct
