"""
In-memory, per-session conversation state — keeps the current shopping
intent alive for the whole conversation (not just until the first searchable
message), so a short follow-up like "budget is 50" or "yes" is understood in
light of what was already being discussed, instead of being treated as an
unrelated, one-shot request. New chat -> new session_id -> fresh memory,
same as ChatGPT starting a blank context on "New Chat".

In-process only (like the NeMo rails cache in backend/guardrails/nemo) —
conversation state doesn't need to survive a server restart, and session_id
is already stable per browser tab for the life of that tab.
"""
from typing import Optional, TypedDict


class SessionState(TypedDict):
    partial_intent: dict
    asked_followup: bool
    # Set when the assistant's last reply offered a concrete, reapplicable
    # fix (e.g. "try raising your budget to $65?") — lets a bare "yes" on
    # the next turn apply it deterministically instead of being re-guessed
    # by the LLM with no idea what it's agreeing to.
    pending_suggestion: Optional[dict]


_sessions: dict[str, SessionState] = {}

# Last products shown to the user — enables contextual follow-up Q&A like
# "is the first one good?" without triggering a full new search.
_ranked_products: dict[str, list[dict]] = {}

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
    _sessions[session_id] = {"partial_intent": intent, "asked_followup": True, "pending_suggestion": None}


def save_context(session_id: str, intent: dict, pending_suggestion: Optional[dict] = None) -> None:
    """
    Keep this intent as the conversation's ongoing context — called after
    every resolved (non-chitchat) turn, not just the first under-specified
    one, so later turns keep merging into it rather than starting over.
    """
    existing = _sessions.get(session_id)
    _sessions[session_id] = {
        "partial_intent": intent,
        "asked_followup": bool(existing and existing["asked_followup"]),
        "pending_suggestion": pending_suggestion,
    }


def get_pending_suggestion(session_id: str) -> Optional[dict]:
    state = _sessions.get(session_id)
    return state.get("pending_suggestion") if state else None


def save_ranked_products(session_id: str, products: list[dict]) -> None:
    _ranked_products[session_id] = products


def get_ranked_products(session_id: str) -> list[dict]:
    return _ranked_products.get(session_id, [])


def clear(session_id: str) -> None:
    _sessions.pop(session_id, None)
    _ranked_products.pop(session_id, None)
