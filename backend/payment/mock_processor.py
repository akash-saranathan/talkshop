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


async def process_payment(
    request: PaymentRequest, wallet: Optional[dict] = None
) -> PaymentResult:
    """
    Charge the default active payment method in the wallet.
    Only called after the 12-check guardrail engine has already passed.
    """
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
