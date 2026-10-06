"""
Conversation stages and per-session state.

Stages follow the plan's §6.2 flow. Each stage lists what may happen next;
the orchestrator refuses anything else, so the LLM can't skip ahead (for
example, straight to payment).

State is in-process (like the older chat session state): enough for a demo
session, and the panel restores itself from `transcript` after a page change.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Stage(str, Enum):
    GREETING = "GREETING"
    SEARCHING = "SEARCHING"
    RECOMMENDED = "RECOMMENDED"            # top 3 shown — waiting for the shopper to choose
    PRODUCT_SELECTED = "PRODUCT_SELECTED"
    ASK_SIZE = "ASK_SIZE"
    ASK_COLOR = "ASK_COLOR"
    VARIANT_CONFIRMED = "VARIANT_CONFIRMED"
    IN_CART = "IN_CART"
    OFFER_CHECKOUT = "OFFER_CHECKOUT"
    AWAITING_CONSENT = "AWAITING_CONSENT"  # review card shown — only GO AHEAD can pay
    PAYING = "PAYING"
    ORDER_CONFIRMED = "ORDER_CONFIRMED"


# The journey stepper shown in the panel header.
STEPPER = {
    Stage.GREETING: "Search", Stage.SEARCHING: "Search", Stage.RECOMMENDED: "Choose",
    Stage.PRODUCT_SELECTED: "Choose", Stage.ASK_SIZE: "Size", Stage.ASK_COLOR: "Colour",
    Stage.VARIANT_CONFIRMED: "Colour", Stage.IN_CART: "Cart", Stage.OFFER_CHECKOUT: "Cart",
    Stage.AWAITING_CONSENT: "Review", Stage.PAYING: "Review", Stage.ORDER_CONFIRMED: "Done",
}

# What each stage allows next (plan §6.2). A new search is allowed from any
# stage except while paying; "answer" (a question mid-flow) never changes stage.
ALLOWED = {
    Stage.GREETING: {"search", "answer", "select_product"},
    Stage.SEARCHING: {"answer"},
    Stage.RECOMMENDED: {"select_product", "search", "answer"},
    Stage.PRODUCT_SELECTED: {"choose_option", "search", "answer", "select_product"},
    Stage.ASK_SIZE: {"choose_option", "search", "answer", "select_product"},
    Stage.ASK_COLOR: {"choose_option", "search", "answer", "select_product"},
    Stage.VARIANT_CONFIRMED: {"search", "answer"},
    Stage.IN_CART: {"checkout", "search", "answer", "select_product"},
    Stage.OFFER_CHECKOUT: {"checkout", "keep_shopping", "search", "answer", "select_product"},
    Stage.AWAITING_CONSENT: {"update_checkout", "cancel_checkout", "answer", "search"},
    Stage.PAYING: set(),
    Stage.ORDER_CONFIRMED: {"search", "answer", "select_product"},
}


@dataclass
class Session:
    session_id: str
    user_id: str
    stage: Stage = Stage.GREETING
    page: dict = field(default_factory=dict)
    last_query: Optional[str] = None
    shown: list[str] = field(default_factory=list)          # product ids of the current top 3
    product_id: Optional[str] = None                        # selected product
    size: Optional[str] = None
    color: Optional[str] = None
    sku: Optional[str] = None
    line_ids: list[str] = field(default_factory=list)       # cart lines Talkshop added in this conversation
    checkout_id: Optional[str] = None
    order_id: Optional[str] = None
    history: list[dict] = field(default_factory=list)       # [{"role": "user"|"assistant", "text": ...}] for the LLM
    transcript: list[dict] = field(default_factory=list)    # every event sent, so the panel can rebuild itself

    def allows(self, action: str) -> bool:
        return action in ALLOWED[self.stage]

    def reset_selection(self):
        self.product_id = self.size = self.color = self.sku = None


_sessions: dict[tuple[str, str], Session] = {}


def get(user_id: str, session_id: str) -> Session:
    key = (user_id, session_id)
    if key not in _sessions:
        _sessions[key] = Session(session_id=session_id, user_id=user_id)
    return _sessions[key]


def peek(user_id: str, session_id: str) -> Optional[Session]:
    return _sessions.get((user_id, session_id))


def drop(user_id: str, session_id: str) -> None:
    _sessions.pop((user_id, session_id), None)
