"""
Loyalty redemption policy — deterministic, no LLM.

The agent decides the payment composition automatically from the customer's
configured reward preference, the merchant's balance and the order total. There
is no "pay with points" button: selecting the product is the only choice; the
split (points-only / points + card / card-only) follows from policy.

Demo conversion: 10 points = $1 (1 pt = $0.10). Points are a merchant reward,
settled by the merchant's own loyalty ledger — not a payment protocol.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import ceil

POINTS_PER_DOLLAR = 10


@dataclass
class RedemptionDecision:
    points_redeemed: int        # points to burn
    value_redeemed: float       # dollar value those points cover
    amount_due: float           # remaining to charge the card/PayPal
    fully_covered: bool         # True when points cover the whole order


def decide_redemption(balance_points: int, order_total: float,
                      preference: str = "maximize_points_usage") -> RedemptionDecision:
    """
    Decide how many points to apply. "maximize_points_usage" spends as many
    eligible points as possible, capped at the order total. Any other preference
    (e.g. a future "card_only") redeems nothing.
    """
    if preference != "maximize_points_usage" or balance_points <= 0 or order_total <= 0:
        return RedemptionDecision(0, 0.0, round(order_total, 2), False)

    order_total = round(order_total, 2)
    if balance_points / POINTS_PER_DOLLAR >= order_total:
        # Enough to cover the whole order: redeem just enough to clear it,
        # rounding the final increment up so no cents are left on the card.
        points = min(ceil(order_total * POINTS_PER_DOLLAR), balance_points)
        return RedemptionDecision(points, order_total, 0.0, True)

    # Not enough to cover it all: apply the whole balance, charge the remainder.
    points = balance_points
    value = round(points / POINTS_PER_DOLLAR, 2)
    return RedemptionDecision(points, value, round(order_total - value, 2), False)
