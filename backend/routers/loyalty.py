"""
Loyalty points router — read-only balance and transaction history.
Points are awarded by the payments router on each successful purchase (1 pt per $1).
"""
from fastapi import APIRouter, Depends

from backend.auth.dependencies import CurrentUser, get_current_user, require_customer
from backend.db.schema import LoyaltyPoints, LoyaltyTransaction
from backend.db.session_utils import get_session

router = APIRouter()


@router.get("/api/loyalty")
async def get_loyalty_balance(current_user: CurrentUser = Depends(require_customer)):
    """Current loyalty balance and lifetime total for the logged-in user."""
    with get_session() as session:
        lp = session.query(LoyaltyPoints).filter(LoyaltyPoints.user_id == current_user.user_id).first()
        return {
            "balance": lp.balance if lp else 0,
            "lifetime_points": lp.lifetime_points if lp else 0,
        }


@router.get("/api/loyalty/history")
async def get_loyalty_history(current_user: CurrentUser = Depends(require_customer)):
    """Last 20 loyalty transactions for the logged-in user."""
    with get_session() as session:
        txns = (
            session.query(LoyaltyTransaction)
            .filter(LoyaltyTransaction.user_id == current_user.user_id)
            .order_by(LoyaltyTransaction.created_at.desc())
            .limit(20)
            .all()
        )
        return [
            {
                "transaction_id": t.transaction_id,
                "order_id": t.order_id,
                "points_earned": t.points_earned,
                "reason": t.reason,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txns
        ]
