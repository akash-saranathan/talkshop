"""
Payment policy rules — deterministic, no LLM.
These constants are the single source of truth for all authorization decisions.
"""
from dataclasses import dataclass
from typing import Literal

MAX_PURCHASE_AMOUNT: float = 500.00
ALLOWED_CURRENCIES: set[str] = {"USD"}
TOKEN_TTL_MINUTES: int = 15
SINGLE_USE: bool = True
REQUIRE_USER_CONSENT: bool = True
ALLOWED_MERCHANTS: set[str] = {"MERCHANT_A", "MERCHANT_B", "MERCHANT_C"}
TAX_RATE: float = 0.082  # 8.2%
FREE_SHIPPING_THRESHOLD: float = 50.0
FLAT_SHIPPING_COST: float = 5.99


PolicyDecision = Literal["ALLOW", "DENY", "REQUIRE_STEP_UP"]


@dataclass(frozen=True)
class PolicyResult:
    decision: PolicyDecision
    reason_code: str
    detail: str


def evaluate_purchase(
    merchant_id: str,
    amount: float,
    currency: str,
) -> PolicyResult:
    """
    Pre-authorization policy check. Called before issuing a DPAT token.
    Returns ALLOW only when all rules pass.
    """
    if merchant_id not in ALLOWED_MERCHANTS:
        return PolicyResult("DENY", "MERCHANT_NOT_ALLOWED", f"{merchant_id} is not in the approved merchant list")

    if currency not in ALLOWED_CURRENCIES:
        return PolicyResult("DENY", "CURRENCY_NOT_SUPPORTED", f"{currency} is not supported")

    if amount <= 0:
        return PolicyResult("DENY", "INVALID_AMOUNT", "Amount must be greater than zero")

    if amount > MAX_PURCHASE_AMOUNT:
        return PolicyResult(
            "REQUIRE_STEP_UP",
            "AMOUNT_EXCEEDS_LIMIT",
            f"Amount ${amount:.2f} exceeds single-purchase limit of ${MAX_PURCHASE_AMOUNT:.2f}",
        )

    return PolicyResult("ALLOW", "POLICY_PASSED", "All policy checks passed")
