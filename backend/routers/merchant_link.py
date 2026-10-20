"""
Simulated merchant account linking and points (demo only).

Every request here is a call to the merchant's side: the merchant checks its own
records, issues or revokes the member token, and reports the points. The chat
never receives the merchant's email or code; only the sign-in pop-up sends them.
Responses carry trace events without the email or the code.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.merchants import account_link
from backend.purchase.service import Trace

router = APIRouter(prefix="/api/merchant-link", tags=["merchant-link"])

MERCHANT_IDS = ["nike", "zara", "fossil", "adidas", "hm", "casio"]


class StartRequest(BaseModel):
    merchant_id: str
    email: str


class CodeRequest(StartRequest):
    code: str


class PointsRequest(BaseModel):
    merchant_id: str
    points: int


@router.get("")
async def list_links(current_user: CurrentUser = Depends(get_current_user)):
    """Linked or not, for every merchant. Drives the Settings panel and the checkout."""
    return {"links": [account_link.status(current_user.user_id, m) for m in MERCHANT_IDS]}


@router.post("/start")
async def start(req: StartRequest, current_user: CurrentUser = Depends(get_current_user)):
    ok, message = account_link.start(req.merchant_id, req.email)
    trace = Trace()
    if not ok:
        trace.add("Customer", account_link.merchant_name(req.merchant_id), "LINK", "no_account_found",
                  {"merchant": req.merchant_id, "message": message})
    return {"ok": ok, "message": message, "merchant_name": account_link.merchant_name(req.merchant_id),
            "events": trace.events}


@router.post("/verify")
async def verify(req: CodeRequest, current_user: CurrentUser = Depends(get_current_user)):
    ok, message = account_link.check_code(req.merchant_id, req.email, req.code)
    return {"ok": ok, "message": message}


@router.post("/approve")
async def approve(req: CodeRequest, current_user: CurrentUser = Depends(get_current_user)):
    result = account_link.approve(current_user.user_id, req.merchant_id, req.email, req.code)
    trace = Trace()
    if result["ok"]:
        trace.add(account_link.merchant_name(req.merchant_id), "CustomerAgent", "LINK", "account_linked",
                  {"merchant": req.merchant_id, "relationship": "merchant_member"}, direction="in")
    return {**result, "events": trace.events}


@router.post("/{merchant_id}/unlink")
async def unlink(merchant_id: str, current_user: CurrentUser = Depends(get_current_user)):
    account_link.unlink(current_user.user_id, merchant_id)
    return {"ok": True, "message": f"Unlinked {account_link.merchant_name(merchant_id)}"}


@router.post("/reset")
async def reset_links(current_user: CurrentUser = Depends(get_current_user)):
    account_link.unlink_all(current_user.user_id)
    return {"ok": True, "message": "All merchant links reset"}


@router.post("/reset-points")
async def reset_points(current_user: CurrentUser = Depends(get_current_user)):
    account_link.reset_points(current_user.user_id)
    return {"ok": True, "message": "Points restored to the seeded balances"}


@router.post("/points/check")
async def check_points(req: PointsRequest, current_user: CurrentUser = Depends(get_current_user)):
    """The merchant reports total, pending and available. None when the customer is not linked."""
    status = account_link.points_status(current_user.user_id, req.merchant_id)
    if status is None:
        return {"linked": False, "message": "Link your account to use points"}
    return {"linked": True, **status,
            "message": f"{status['pending']} points pending, {status['available']} available"}
