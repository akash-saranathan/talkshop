"""
In-memory, per-session conversation state — lets VibeCheck ask a follow-up
question and merge the answer into the same intent on the next message,
instead of treating every message as an unrelated, one-shot request.

In-process only (like the NeMo rails cache in backend/guardrails/nemo) —
conversation state doesn't need to survive a server restart, and session_id
is already stable per browser tab for the life of that tab.
"""
from typing import Optional, TypedDict


class SessionState(TypedDict):
    partial_intent: dict
    asked_followup: bool


_sessions: dict[str, SessionState] = {}

# Pasted images live in a separate map, keyed by session_id: they're attached
# via their own endpoint just before the SSE stream starts (EventSource can
# only do GET, so the image can't ride along in that request), then popped
# — used once, for the very next message, not kept around indefinitely.
_pending_images: dict[str, str] = {}


def save_pending_image(session_id: str, image_base64: str) -> None:
    _pending_images[session_id] = image_base64


def pop_pending_image(session_id: str) -> Optional[str]:
    return _pending_images.pop(session_id, None)


def get_partial_intent(session_id: str) -> Optional[dict]:
    state = _sessions.get(session_id)
    return state["partial_intent"] if state else None


def has_asked_followup(session_id: str) -> bool:
    state = _sessions.get(session_id)
    return bool(state and state["asked_followup"])


def save_followup_asked(session_id: str, intent: dict) -> None:
    _sessions[session_id] = {"partial_intent": intent, "asked_followup": True}


def clear(session_id: str) -> None:
    _sessions.pop(session_id, None)
