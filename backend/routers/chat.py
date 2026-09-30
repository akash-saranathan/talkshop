"""
Chat router — SSE streaming endpoint for the Phase 2 discovery flow, plus
persistent chat session history.

GET /api/chat/stream?message=...&session_id=...   — streams LangGraph node events
GET /api/chat/sessions                              — this user's chat threads
GET /api/chat/sessions/{session_id}/messages        — one thread's messages
"""
import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.db.schema import ChatMessage, ChatSession
from backend.db.session_utils import get_session, now_utc
from backend.graph import session_state
from backend.graph.workflow import run_discovery

router = APIRouter()

TITLE_MAX_LENGTH = 60


def _save_turn(session_id: str, user_id: str, user_message: str, final_state: dict) -> None:
    """
    Persist one user/assistant exchange. Deliberately doesn't store the
    granular step_start/step_done progress events — those are ephemeral
    "thinking" UI, not chat history; reopening a past session shows the
    final answer only, same as ChatGPT doesn't replay its own "Thinking..."
    animation for old chats.
    """
    with get_session() as db:
        chat_session = db.query(ChatSession).filter(ChatSession.session_id == session_id).first()
        if not chat_session:
            title = user_message[:TITLE_MAX_LENGTH]
            if len(user_message) > TITLE_MAX_LENGTH:
                title += "..."
            chat_session = ChatSession(session_id=session_id, user_id=user_id, title=title)
            db.add(chat_session)
        chat_session.updated_at = now_utc()

        db.add(ChatMessage(session_id=session_id, role="user", content=user_message))

        products = [p.model_dump(mode="json") for p in final_state.get("ranked_products", [])]
        db.add(ChatMessage(
            session_id=session_id,
            role="assistant",
            content=final_state.get("recommendation_text", ""),
            products_json=json.dumps(products) if products else None,
            blocked_reason=final_state.get("error") if final_state.get("blocked") else None,
        ))
        db.commit()


async def _event_stream(user_message: str, session_id: str, user_id: str):
    """Async generator that drives the LangGraph run and yields SSE lines."""
    queue: asyncio.Queue = asyncio.Queue()

    # Run the graph as a background task so we can stream events as they arrive
    task = asyncio.create_task(run_discovery(user_message, session_id, queue))

    try:
        while True:
            event = await asyncio.wait_for(queue.get(), timeout=60.0)
            if event is None:
                # Sentinel — graph finished
                yield "event: done\ndata: {}\n\n"
                break
            yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
    except asyncio.TimeoutError:
        yield 'event: error\ndata: {"message": "Request timed out"}\n\n'
    finally:
        if not task.done():
            task.cancel()
        else:
            _save_turn(session_id, user_id, user_message, task.result())


class AttachImageRequest(BaseModel):
    session_id: str
    image_base64: str  # raw base64, no "data:image/...;base64," prefix


@router.post("/api/chat/attach-image")
async def attach_image(req: AttachImageRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Stashes a pasted image for the next message in this session. Separate
    from /api/chat/stream because that's read via EventSource, which can
    only issue GET requests — too small a channel for image bytes.
    """
    session_state.save_pending_image(req.session_id, req.image_base64)
    return {"ok": True}


@router.get("/api/chat/stream")
async def chat_stream(
    message: str = Query(..., description="User's natural language shopping request"),
    session_id: str = Query(default_factory=lambda: uuid.uuid4().hex),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    SSE endpoint. React Chat page connects here and receives step events.
    Each event: { type, message, data, ts }
    Event types: step_start, step_done, blocked, error, recommendation, done

    Auth note: EventSource can't set custom headers, so the frontend passes
    the token as ?token= — get_current_user() accepts either that or a
    normal Authorization header.
    """
    return StreamingResponse(
        _event_stream(message, session_id, current_user.user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/chat/sessions")
async def list_chat_sessions(current_user: CurrentUser = Depends(get_current_user)):
    """This user's chat threads, most recently active first — the left sidebar."""
    with get_session() as db:
        sessions = (
            db.query(ChatSession)
            .filter(ChatSession.user_id == current_user.user_id)
            .order_by(ChatSession.updated_at.desc())
            .all()
        )
        return [
            {
                "session_id": s.session_id,
                "title": s.title,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
            for s in sessions
        ]


@router.get("/api/chat/sessions/{session_id}/messages")
async def get_chat_session_messages(session_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """One thread's messages in order — scoped to the current user."""
    with get_session() as db:
        chat_session = (
            db.query(ChatSession)
            .filter(ChatSession.session_id == session_id, ChatSession.user_id == current_user.user_id)
            .first()
        )
        if not chat_session:
            raise HTTPException(status_code=404, detail="Chat session not found")

        messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        return [
            {
                "role": m.role,
                "content": m.content,
                "products": json.loads(m.products_json) if m.products_json else [],
                "blocked_reason": m.blocked_reason,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ]
