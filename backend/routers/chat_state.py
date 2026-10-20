"""
Per-chat state — the Live/Story/Flow trace, the confirmed order card and any
checkout still waiting for approval — saved per chat session so it shows again
after a reload or on another device.

  GET /api/chat-state/{session_id}   the saved state for one of the caller's chats
  PUT /api/chat-state/{session_id}   save the state for one of the caller's chats

A chat belongs to the user who created it. Another user's chat is never read or
overwritten.
"""
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.db.schema import ChatState
from backend.db.session_utils import get_session

router = APIRouter(prefix="/api/chat-state", tags=["chat-state"])

# Keep saved state small: the newest events only.
MAX_EVENTS = 400


class ChatStateBody(BaseModel):
    state: dict[str, Any]


@router.get("/{session_id}")
async def get_chat_state(session_id: str, current_user: CurrentUser = Depends(get_current_user)):
    with get_session() as db:
        row = db.query(ChatState).filter(ChatState.session_id == session_id).first()
        if row is None or row.user_id != current_user.user_id:
            return {"state": None}
        return {"state": json.loads(row.state)}


@router.put("/{session_id}")
async def put_chat_state(session_id: str, body: ChatStateBody,
                         current_user: CurrentUser = Depends(get_current_user)):
    state = dict(body.state)
    events = state.get("events")
    if isinstance(events, list):
        state["events"] = events[-MAX_EVENTS:]
    payload = json.dumps(state)

    with get_session() as db:
        row: Optional[ChatState] = db.query(ChatState).filter(ChatState.session_id == session_id).first()
        if row is not None and row.user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="This chat belongs to another account.")
        if row is None:
            db.add(ChatState(session_id=session_id, user_id=current_user.user_id, state=payload))
        else:
            row.state = payload
        db.commit()
    return {"ok": True}
