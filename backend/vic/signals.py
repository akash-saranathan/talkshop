"""
CommerceSignalsService — after the gateway answers, the transaction outcome is
sent to the (simulated) VIC service and linked to the member's original
instruction. No real Visa commerce-signal API is called.
"""
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import CommerceSignal, PaymentInstruction
from backend.vic.common import new_ref


def record(db: Session, instr: Optional[PaymentInstruction], *, outcome: str, amount: float, currency: str,
           checkout_id: str, merchant_id: str, credential_ref: Optional[str] = None,
           gateway_ref: Optional[str] = None, reason: Optional[str] = None,
           order_id: Optional[str] = None) -> CommerceSignal:
    sig = CommerceSignal(signal_id=new_ref("sig"), instruction_id=instr.instruction_id if instr else None,
                         agent_token_ref=instr.agent_token_ref if instr else None, credential_ref=credential_ref,
                         checkout_id=checkout_id, merchant_id=merchant_id, amount=amount, currency=currency,
                         outcome=outcome, reason=reason, gateway_ref=gateway_ref, order_id=order_id)
    db.add(sig)
    return sig


def for_instruction(db: Session, instruction_id: str) -> list[CommerceSignal]:
    return db.query(CommerceSignal).filter_by(instruction_id=instruction_id).order_by(CommerceSignal.id).all()
