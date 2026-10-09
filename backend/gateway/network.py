"""
SIMULATED card networks. Not VisaNet or any real network.

  visa_agent_credential  resolves a purchase-specific credential (pcr_…) with the
                         VIC simulator and enforces its bindings: merchant, checkout,
                         member, amount, currency, single use, expiry, active
                         instruction and agent token.
  card_on_file           resolves the PSP card token (tok_…) for the standard path.
Both hand the card to the simulated issuer.
"""
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import AgentToken, CardAccount, PaymentInstruction, PaymentMethod
from backend.vic import credentials
from backend.vic.common import VicError, short


class NetworkDecline(Exception):
    def __init__(self, actor: str, reason: str, detail: str):
        super().__init__(reason)
        self.actor, self.reason, self.detail = actor, reason, detail


def visa_agent_credential(db: Session, req: dict) -> tuple[PaymentMethod, Optional[CardAccount], dict]:
    actor = "Simulated Visa network"
    ref = req["instrument"].get("credential_ref") or ""
    try:
        cred = credentials.redeem(db, ref, merchant_id=req["merchant_id"], amount=req["amount"],
                                  currency=req["currency"], checkout_id=req["checkout_id"],
                                  user_id=req["customer_ref"])
    except VicError as exc:
        db.commit()                       # e.g. an expired credential is marked EXPIRED
        raise NetworkDecline(actor, exc.code, exc.message)
    instr = db.query(PaymentInstruction).filter_by(instruction_id=cred.instruction_id).first()
    tok = db.query(AgentToken).filter_by(agent_token_ref=instr.agent_token_ref).first()
    if not tok or tok.status != "ACTIVE":
        raise NetworkDecline(actor, "AGENT_TOKEN_INACTIVE", "Agent token is not active")
    card = db.query(PaymentMethod).filter_by(payment_method_id=tok.payment_method_id).first()
    acct = db.query(CardAccount).filter_by(payment_method_id=tok.payment_method_id).first()
    return card, acct, {
        "actor": actor, "result": "pass",
        "detail": f"Credential {short(ref)} valid once for ShopSphere, {req['checkout_id']}, "
                  f"{req['currency']} {req['amount']:.2f}; agent token {short(tok.agent_token_ref)} active",
        "checks": ["credential known", "not expired", "not used before", "merchant binding", "checkout + member binding",
                   "amount + currency binding", "instruction authenticated", "agent token active"]}


def card_on_file(db: Session, req: dict) -> tuple[PaymentMethod, Optional[CardAccount], dict]:
    token_ref = req["instrument"].get("token_ref") or ""
    card = db.query(PaymentMethod).filter_by(token_ref=token_ref).first()
    actor = f"Simulated {card.brand if card else 'card'} network"
    if not card or card.user_id != req["customer_ref"]:
        raise NetworkDecline(actor, "NO_ACTIVE_PAYMENT_METHOD", "Unknown card token")
    acct = db.query(CardAccount).filter_by(payment_method_id=card.payment_method_id).first()
    return card, acct, {"actor": actor, "result": "pass",
                        "detail": f"{card.brand} card-on-file token routed to the issuer (no agent token, no VIC credential)",
                        "checks": ["card token known", "belongs to this customer"]}
