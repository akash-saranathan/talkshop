"""
Generic chat router — SSE stream + human-approval resume for the generic agent.

GET  /api/generic/stream   — opens the SSE stream; drives the GenericShoppingAgent
POST /api/generic/resume   — unpauses the agent at a human approval boundary

Auth: same as /api/chat/stream — JWT via ?token= query param (EventSource can't
set Authorization headers) or normal Bearer header.

SSE event types emitted:
  protocol_event    {ts, source, target, protocol, direction, label, detail}
  products_ready    {products, total_count, session_id}
  human_pause       {pause_type: "product_selection"|"approve_pay", session_id}
  checkout_ready    {session_id, ucp_session_id, product, totals, use_acp}
  order_complete    {session_id, order_id, order_label, totals, product, payment_display, mandates}
  error             {message}
  done              {} — stream ended
"""
from __future__ import annotations
import asyncio
import json
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from datetime import datetime, timezone

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.agents.generic_shopping_agent import ShoppingSession, run_generic_agent
from backend.guardrails.nemo import check_input

router = APIRouter()

# Module-level session store — one entry per active SSE stream
_SESSIONS: dict[str, ShoppingSession] = {}


# ── SSE stream ─────────────────────────────────────────────────────────────────

async def _stream(session: ShoppingSession):
    """Async generator driving the agent and yielding SSE lines."""
    task = asyncio.create_task(run_generic_agent(session))

    try:
        while True:
            event = await asyncio.wait_for(session.queue.get(), timeout=60.0)
            if event is None:
                yield "event: done\ndata: {}\n\n"
                break
            yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
    except asyncio.TimeoutError:
        yield 'event: error\ndata: {"message":"Stream timed out"}\n\n'
    finally:
        if not task.done():
            task.cancel()
        _SESSIONS.pop(session.session_id, None)


@router.get("/api/generic/stream")
async def generic_stream(
    q: str = Query(..., description="Natural-language shopping request"),
    session_id: str = Query(default_factory=lambda: uuid.uuid4().hex),
    use_acp: bool = Query(default=True, description="True = ACP SPT flow (customer); False = pre-registered instrument (guest)"),
    prior_intent: str = Query(default="", description="JSON of partial intent from a previous clarifying-question round"),
    current_user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    """
    Open the SSE stream. The Generic Shopping Agent runs as a background task
    and puts events on the session queue. Human-pause moments hold until
    POST /api/generic/resume is called with the session_id.
    """
    # ── Guardrails check ─────────────────────────────────────────────────────
    allowed, block_msg = await check_input(q)
    if not allowed:
        ts = datetime.now(timezone.utc).isoformat()

        async def _blocked():
            pev = {
                "type": "protocol_event",
                "ts": ts,
                "source": "User",
                "target": "GuardrailsEngine",
                "protocol": "guardrails",
                "direction": "✗",
                "label": "input_blocked",
                "detail": {"reason": "sensitive_request_detected"},
            }
            yield f"event: protocol_event\ndata: {json.dumps(pev)}\n\n"
            yield f"event: guardrail_block\ndata: {json.dumps({'message': block_msg})}\n\n"
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(
            _blocked(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    session = ShoppingSession(
        session_id=session_id,
        query=q,
        user_id=current_user.user_id,
        use_acp=use_acp,
        prior_intent_json=prior_intent or None,
    )
    _SESSIONS[session_id] = session

    return StreamingResponse(
        _stream(session),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Resume endpoint ────────────────────────────────────────────────────────────

class ResumeRequest(BaseModel):
    session_id: str
    action: Literal["select_product", "approve_pay"]
    data: dict[str, Any] = {}
    """
    For action='select_product':
      data.product_id   — selected product id from the products_ready list
      data.quantity     — quantity (default 1)
      data.variant      — {size, color} if applicable

    For action='approve_pay':
      Case 1 (use_acp=True):
        data.payment_method — opaque PM reference from MockHostedPaymentField
        data.brand          — "visa" | "mastercard" | ...
        data.last4          — last 4 digits (display only)
      Case 2 (use_acp=False):
        data.payment_token  — "mock_card_4001" or "mock_card_5002"
        data.brand          — network name from demo_instruments.json
        data.last4          — last4 from demo_instruments.json
    """


@router.post("/api/generic/resume")
async def generic_resume(
    req: ResumeRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Unblock a paused agent. Sets resume_data and fires the pause_event so the
    background agent coroutine can continue to the next step.
    """
    session = _SESSIONS.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{req.session_id}' not found or already complete")

    if session.user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Session belongs to a different user")

    expected_pause = {
        "select_product": "products_shown",
        "approve_pay":    "payment_ready",
    }.get(req.action)

    if session.state != expected_pause:
        raise HTTPException(
            status_code=409,
            detail=f"Agent is in state '{session.state}', not ready for '{req.action}'",
        )

    session.resume_data = req.data
    session.pause_event.set()
    return {"ok": True, "session_id": req.session_id, "action": req.action}


# ── Instruments helper ─────────────────────────────────────────────────────────

from pathlib import Path as _Path

_INSTRUMENTS_PATH = _Path(__file__).parent.parent / "data" / "demo_instruments.json"


@router.get("/api/generic/instruments")
async def get_demo_instruments(current_user: CurrentUser = Depends(get_current_user)):
    """
    Return pre-registered demo payment instruments for Case 2 (guest / pre-registered flow).
    Renames mock_token → payment_token so the frontend can pass it directly in the
    approve_pay resume payload without ever touching raw card data.
    """
    with open(_INSTRUMENTS_PATH, encoding="utf-8") as f:
        instruments = json.load(f)
    return [
        {**{k: v for k, v in inst.items() if k != "mock_token"}, "payment_token": inst["mock_token"]}
        for inst in instruments
    ]
