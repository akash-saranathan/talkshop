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
