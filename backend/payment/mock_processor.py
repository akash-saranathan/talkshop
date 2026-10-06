"""
Mock payment processor — simulates a card network charge against the
mock wallet (data/mock_wallet.json). No network calls, no LLM.
Declines are deterministic wallet conditions only — never random —
so the test suite stays reproducible.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.models.payment import PaymentRequest, PaymentResult

WALLET_PATH = Path(__file__).parent.parent.parent / "data" / "mock_wallet.json"


def _load_wallet() -> dict:
    with open(WALLET_PATH) as f:
        return json.load(f)


def _default_payment_method(wallet: dict) -> Optional[dict]:
    for pm in wallet.get("payment_methods", []):
        if pm.get("is_default") and pm.get("status") == "active":
            return pm
    return None


def _is_expired(pm: dict) -> bool:
    now = datetime.now(timezone.utc)
    return (pm["expiry_year"], pm["expiry_month"]) < (now.year, now.month)


def _saved_card_result(request: PaymentRequest) -> PaymentResult:
    """Charge a customer's saved card (Demo 1). Declines are deterministic:
    unknown card, expired card, or a card set up to decline for the demo."""
    from backend.db.schema import PaymentMethod
    from backend.db.session_utils import get_session

    def declined(reason: str) -> PaymentResult:
        return PaymentResult(status="declined", decline_reason=reason,
                             amount=request.amount, currency=request.currency)

    with get_session() as session:
        card = session.query(PaymentMethod).filter_by(payment_method_id=request.payment_method_id).first()
        if card is None:
            return declined("NO_ACTIVE_PAYMENT_METHOD")
        now = datetime.now(timezone.utc)
        if (card.exp_year, card.exp_month) < (now.year, now.month):
            return declined("CARD_EXPIRED")
        if card.behaviour == "decline":
            return declined("CARD_DECLINED")
    return PaymentResult(
        status="success",
        transaction_id=f"TXN_{uuid.uuid4().hex[:10].upper()}",
        authorization_code=f"AUTH{uuid.uuid4().hex[:6].upper()}",
        amount=request.amount,
        currency=request.currency,
    )


async def process_payment(
    request: PaymentRequest, wallet: Optional[dict] = None
) -> PaymentResult:
    """
    Charge the chosen saved card (Demo 1) or, for older callers, the default
    active payment method in the wallet. Only called after the 12-check
    guardrail engine has already passed.
    """
    if request.payment_method_id:
        return _saved_card_result(request)
    wallet = wallet if wallet is not None else _load_wallet()
    pm = _default_payment_method(wallet)

    if pm is None:
        return PaymentResult(
            status="declined",
            decline_reason="NO_ACTIVE_PAYMENT_METHOD",
            amount=request.amount,
            currency=request.currency,
        )

    if _is_expired(pm):
        return PaymentResult(
            status="declined",
            decline_reason="CARD_EXPIRED",
            amount=request.amount,
            currency=request.currency,
        )

    return PaymentResult(
        status="success",
        transaction_id=f"TXN_{uuid.uuid4().hex[:10].upper()}",
        authorization_code=f"AUTH{uuid.uuid4().hex[:6].upper()}",
        amount=request.amount,
        currency=request.currency,
    )
