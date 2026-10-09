"""
Which payment path a checkout takes (Part 2, D38). Decided by the server from
the card on the checkout — never by the browser or the LLM.

  vic                 Chase Visa credit card with an ACTIVE agent token
                      → VIC-inspired path (instruction + simulated passkey +
                        controls + purchase credential + gateway)
  vic_setup_required  Chase Visa credit card, agent payments not active yet
  standard            any other card (e.g. a Chase Mastercard) → GreenLight
                      DPAT + 12 checks + gateway with the card-on-file token
  wallet              ShopSphere Wallet balance (internal, no gateway)
  none                no payment method yet
"""
from sqlalchemy.orm import Session

from backend.db.schema import CardAccount, Checkout, PaymentMethod
from backend.vic import enrollment
from backend.vic.common import short


def payment_path(db: Session, co: Checkout) -> dict:
    if co.pay_with == "wallet":
        return {"path": "wallet", "label": "ShopSphere Wallet"}
    card = db.query(PaymentMethod).filter_by(payment_method_id=co.payment_method_id).first() \
        if co.payment_method_id else None
    if not card:
        return {"path": "none"}
    masked = {"brand": card.brand, "last4": card.last4}
    acct = db.query(CardAccount).filter_by(user_id=co.user_id, payment_method_id=card.payment_method_id).first()
    if acct and acct.network == "Visa" and acct.account_type == "credit_card" and acct.status == "active":
        tok = enrollment.active_for_payment_method(db, co.user_id, card.payment_method_id)
        if tok:
            return {"path": "vic", "label": "Visa agent payment (VIC-inspired, simulated)", "card": masked,
                    "card_account_id": acct.account_id, "agent_token": short(tok.agent_token_ref),
                    "agent_token_status": "ACTIVE", "issuer": "Chase (simulated)"}
        return {"path": "vic_setup_required", "label": "Visa agent payments not set up", "card": masked,
                "card_account_id": acct.account_id,
                "agent_token_status": enrollment.status(db, co.user_id, acct.account_id),
                "issuer": "Chase (simulated)"}
    return {"path": "standard", "label": f"Standard card payment ({card.brand})", "card": masked,
            "issuer": "Chase (simulated)" if acct else "Card issuer (simulated)"}
