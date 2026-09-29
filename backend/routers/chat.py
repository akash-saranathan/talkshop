"""
Chat router — SSE streaming endpoint for the Phase 2 discovery flow.
GET /api/chat/stream?message=...&session_id=...
Streams LangGraph node events as Server-Sent Events to the React UI.
"""
import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.graph.workflow import run_discovery

router = APIRouter()


async def _event_stream(user_message: str, session_id: str):
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
        _event_stream(message, session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
