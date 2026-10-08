"""
The one persistent demo customer (John Carter) and their per-merchant
relationships. This is the single source of truth for the demo:

  - which merchants John is a customer ("member") of,
  - his seeded loyalty-point balance at each of those merchants,
  - the saved card each of those merchants holds for him.

Customer status is a merchant-by-merchant fact — John is a Nike/Zara/Fossil
customer but a guest to Adidas/H&M/Casio — so loyalty balances and saved
payment methods are scoped to (user, merchant), never shared across merchants.
The trust layer reads membership from here (backend/trust/verifier.py); the
balances and cards are seeded into the DB when the demo user is first created
(seed_demo_customer below).
"""
from __future__ import annotations

DEMO_USER_ID = "USRDEMO1"
DEMO_NAME = "John Carter"
DEMO_EMAIL = "john@gmail.com"

# The demo customer's standing reward preference — a backend policy, applied
# automatically at checkout with no extra UI click (see payment/loyalty_policy).
REWARD_PREFERENCE = "maximize_points_usage"

# merchant_id -> relationship. A non-member merchant has no points and no
# saved card: at checkout the customer pays through the secure payment entry.
MERCHANT_PROFILE: dict[str, dict] = {
    "nike":   {"member": True,  "points": 1000, "card": {"brand": "Visa",       "last4": "4001", "exp_month": 9,  "exp_year": 2027}},
    "zara":   {"member": True,  "points": 300,  "card": {"brand": "Mastercard", "last4": "5002", "exp_month": 3,  "exp_year": 2028}},
    "fossil": {"member": True,  "points": 500,  "card": {"brand": "Amex",       "last4": "3007", "exp_month": 11, "exp_year": 2028}},
    "adidas": {"member": False},
    "hm":     {"member": False},
    "casio":  {"member": False},
}


def member_merchants() -> list[str]:
    return [m for m, p in MERCHANT_PROFILE.items() if p.get("member")]


def profile_for(merchant_id: str) -> dict:
    return MERCHANT_PROFILE.get(merchant_id, {"member": False})


def seed_demo_customer(session, user_id: str = DEMO_USER_ID) -> None:
    """
    Reset the demo customer to a clean baseline. Called when a fresh demo
    session is bootstrapped (a new app start — a new tab or a reopened browser),
    NOT on a refresh within the same session, so each demo run starts from the
    same deterministic state: member loyalty balances back to their seeded
    values, loyalty history cleared, and any one-off (non-seeded) saved methods
    dropped. Imported lazily to avoid import cycles at module load.
    """
    from backend.db.schema import CartItem, LoyaltyPoints, LoyaltyTransaction, SavedPaymentMethod

    # Clear this demo customer's loyalty history, cart, and any cards they added
    # ad hoc (seeded member cards, pm_demo_*, are kept).
    session.query(LoyaltyTransaction).filter(LoyaltyTransaction.user_id == user_id).delete(synchronize_session=False)
    session.query(CartItem).filter(CartItem.user_id == user_id).delete(synchronize_session=False)
    for pm in session.query(SavedPaymentMethod).filter(SavedPaymentMethod.user_id == user_id).all():
        if not pm.payment_method_id.startswith("pm_demo_"):
            session.delete(pm)

    for merchant_id, prof in MERCHANT_PROFILE.items():
        if not prof.get("member"):
            continue

        lp = session.query(LoyaltyPoints).filter(
            LoyaltyPoints.user_id == user_id, LoyaltyPoints.merchant_id == merchant_id
        ).first()
        if lp:
            lp.balance = prof["points"]            # reset to seeded baseline
            lp.lifetime_points = prof["points"]
        else:
            session.add(LoyaltyPoints(
                user_id=user_id, merchant_id=merchant_id,
                balance=prof["points"], lifetime_points=prof["points"],
            ))

        card = prof.get("card")
        if card and not session.query(SavedPaymentMethod).filter(
            SavedPaymentMethod.user_id == user_id, SavedPaymentMethod.merchant_id == merchant_id
        ).first():
            session.add(SavedPaymentMethod(
                payment_method_id=f"pm_demo_{merchant_id}",
                user_id=user_id, merchant_id=merchant_id,
                brand=card["brand"], last4=card["last4"],
                exp_month=card["exp_month"], exp_year=card["exp_year"],
                is_default=True,
            ))
    session.commit()
