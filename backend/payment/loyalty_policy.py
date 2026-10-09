"""
Loyalty redemption policy — deterministic, no LLM.

The customer chooses how many of their merchant points to apply (all /
partial / none) via the checkout proposal's points slider; this module turns
that choice into a dollar split. It never decides the choice itself.

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


def max_redeemable(balance_points: int, order_total: float) -> int:
    """The most points that can usefully be applied to this order: capped by
    the balance, and by what's needed to clear the total (rounded up to the
    nearest point so an odd-cent total can still be fully covered). Redeeming
    more than this would leave an un-spendable credit, which this demo
    doesn't model."""
    if balance_points <= 0 or order_total <= 0:
        return 0
    return min(balance_points, ceil(round(order_total, 2) * POINTS_PER_DOLLAR))


def decide_redemption(balance_points: int, order_total: float, points_to_redeem: int = 0) -> RedemptionDecision:
    """
    points_to_redeem is the exact number of points the customer chose to apply
    (0 = card only). Clamped to what's actually usable — see max_redeemable.
    """
    order_total = round(order_total, 2)
    usable = max_redeemable(balance_points, order_total)
    points = max(0, min(points_to_redeem, usable))

    if points <= 0 or order_total <= 0:
        return RedemptionDecision(0, 0.0, order_total, False)

    if points >= usable and usable == ceil(order_total * POINTS_PER_DOLLAR):
        # Enough to cover the whole order: no cents left on the card.
        return RedemptionDecision(points, order_total, 0.0, True)

    value = round(points / POINTS_PER_DOLLAR, 2)
    return RedemptionDecision(points, value, round(order_total - value, 2), False)
