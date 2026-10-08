"""
Loyalty points router — read-only balance and transaction history.
Points are merchant-scoped and awarded on each successful purchase (1 pt per $1).
"""
from typing import Optional

from fastapi import APIRouter, Depends

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.db.schema import LoyaltyPoints, LoyaltyTransaction
from backend.db.session_utils import get_session

router = APIRouter()


@router.get("/api/loyalty")
async def get_loyalty_balance(merchant_id: Optional[str] = None,
                              current_user: CurrentUser = Depends(get_current_user)):
    """Loyalty balance for the logged-in user. Scoped to merchant_id when given;
    otherwise a per-merchant breakdown plus the combined total."""
    with get_session() as session:
        rows = session.query(LoyaltyPoints).filter(LoyaltyPoints.user_id == current_user.user_id)
        if merchant_id is not None:
            lp = rows.filter(LoyaltyPoints.merchant_id == merchant_id).first()
            return {
                "merchant_id": merchant_id,
                "balance": lp.balance if lp else 0,
                "lifetime_points": lp.lifetime_points if lp else 0,
            }
        by_merchant = [
            {"merchant_id": r.merchant_id, "balance": r.balance, "lifetime_points": r.lifetime_points}
            for r in rows.all()
        ]
        return {
            "balance": sum(m["balance"] for m in by_merchant),
            "lifetime_points": sum(m["lifetime_points"] for m in by_merchant),
            "by_merchant": by_merchant,
        }


@router.get("/api/loyalty/history")
async def get_loyalty_history(merchant_id: Optional[str] = None,
                              current_user: CurrentUser = Depends(get_current_user)):
    """Last 20 loyalty transactions for the logged-in user, optionally for one merchant."""
    with get_session() as session:
        q = session.query(LoyaltyTransaction).filter(LoyaltyTransaction.user_id == current_user.user_id)
        if merchant_id is not None:
            q = q.filter(LoyaltyTransaction.merchant_id == merchant_id)
        txns = q.order_by(LoyaltyTransaction.created_at.desc()).limit(20).all()
        return [
            {
                "transaction_id": t.transaction_id,
                "merchant_id": t.merchant_id,
                "order_id": t.order_id,
                "points_earned": t.points_earned,
                "reason": t.reason,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txns
        ]
