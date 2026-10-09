"""
Cardmember API (Part 2). No AI in any endpoint.

  GET /api/member     who am I in the marketplace: eligibility, masked accounts,
                      rewards balance, agent-pay status. Open to any session (a
                      guest or a checking-only customer learns *why* they can't
                      enter); everything else needs require_cardmember.
  GET /api/offers     the member's entitled offers (cardmembers only)
  GET /api/rewards    rewards summary + ledger (cardmembers only)
"""
from fastapi import APIRouter, Depends

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.db.schema import LoyaltyPoints, User
from backend.db.session_utils import get_session
from backend.shop import eligibility, offers, rewards
from backend.shop.eligibility import require_cardmember

router = APIRouter(tags=["member"])


def member_summary(db, user: CurrentUser) -> dict:
    code = eligibility.check(db, user)
    out = {"signed_in": not user.is_visitor, "eligible": code is None, "code": code,
           "message": eligibility.MESSAGES.get(code) if code else None, "member": None}
    if user.is_visitor:
        return out
    row = db.query(User).filter_by(user_id=user.user_id).first()
    lp = db.query(LoyaltyPoints).filter_by(user_id=user.user_id).first()
    cards = eligibility.eligible_cards(db, user.user_id)
    primary = cards[0] if cards else None
    out["member"] = {
        "name": user.name,
        "member_since": row.created_at.date().isoformat() if row and row.created_at else None,
        "status": "Eligible cardmember" if code is None else "Not eligible for the marketplace",
        "accounts": eligibility.accounts(db, user.user_id),
        "primary_card": eligibility.card_view(primary) if primary else None,
        "rewards_balance": lp.balance if lp else 0,
    }
    if code is None:
        from backend.routers.vic import status_view
        out["member"]["agent_pay"] = status_view(db, user.user_id)["cards"]
    return out


@router.get("/api/member")
def get_member(user: CurrentUser = Depends(get_current_user)):
    with get_session() as db:
        return member_summary(db, user)


@router.get("/api/offers")
def get_offers(user: CurrentUser = Depends(require_cardmember)):
    with get_session() as db:
        return [offers.offer_view(db, o, user.user_id) for o in offers.entitled(db, user.user_id)]


@router.get("/api/rewards")
def get_rewards(user: CurrentUser = Depends(require_cardmember)):
    with get_session() as db:
        return {**rewards.summary(db, user.user_id), "ledger": rewards.ledger(db, user.user_id)}
