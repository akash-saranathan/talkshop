"""Shared pieces of the VIC-inspired simulator: ids, clock, errors, lifecycle."""
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.schema import PaymentInstruction, VicLifecycleEvent

# The one agent allowed to use members' agent tokens in Demo 1: the merchant's
# embedded assistant (PayIt executes on its behalf).
TALKSHOP_AGENT_ID = "TALKSHOP_AI"
MERCHANT_ID = "SHOPSPHERE"
MERCHANT_NAME = "ShopSphere"
SIMULATED = "SIMULATED"   # label on every simulated external step


class VicError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, detail: Optional[dict] = None):
        super().__init__(message)
        self.code, self.message, self.status, self.detail = code, message, status, detail or {}


def now() -> datetime:
    """Naive UTC, matching how the rest of the schema stores timestamps."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_ref(prefix: str) -> str:
    """Random, opaque, unguessable reference (192 bits). Never derived from card data."""
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def short(ref: Optional[str]) -> Optional[str]:
    """Safe display form of a reference for traces: prefix + last 6."""
    if not ref:
        return ref
    prefix = ref.split("_", 1)[0]
    return f"{prefix}_…{ref[-6:]}"


# ── Lifecycle ────────────────────────────────────────────────────────────────
# CARD_LINKED → AGENT_TOKEN_ACTIVE → CHECKOUT_CREATED → INSTRUCTION_AUTHENTICATED
#   → CREDENTIAL_ISSUED → PAYMENT_AUTHORIZED → SIGNAL_RECORDED → ORDER_CONFIRMED
LIFECYCLE = ["CARD_LINKED", "AGENT_TOKEN_ACTIVE", "CHECKOUT_CREATED", "INSTRUCTION_AUTHENTICATED",
             "CREDENTIAL_ISSUED", "PAYMENT_AUTHORIZED", "SIGNAL_RECORDED", "ORDER_CONFIRMED"]
FAILURES = {"INSTRUCTION_CANCELLED", "INSTRUCTION_EXPIRED", "AUTHENTICATION_FAILED", "CONTROLS_FAILED",
            "PAYMENT_DECLINED", "PAYMENT_TIMEOUT", "ORDER_FAILED"}
ALLOWED = {
    "CHECKOUT_CREATED": {"INSTRUCTION_AUTHENTICATED", "AUTHENTICATION_FAILED", "INSTRUCTION_CANCELLED",
                         "INSTRUCTION_EXPIRED"},
    "INSTRUCTION_AUTHENTICATED": {"CREDENTIAL_ISSUED", "CONTROLS_FAILED", "INSTRUCTION_CANCELLED",
                                  "INSTRUCTION_EXPIRED"},
    "CREDENTIAL_ISSUED": {"PAYMENT_AUTHORIZED", "PAYMENT_DECLINED", "PAYMENT_TIMEOUT"},
    "PAYMENT_AUTHORIZED": {"SIGNAL_RECORDED"},
    "SIGNAL_RECORDED": {"ORDER_CONFIRMED", "ORDER_FAILED"},
}


def log_event(db: Session, instruction_id: Optional[str], user_id: str, state: str, detail: str = "") -> None:
    db.add(VicLifecycleEvent(instruction_id=instruction_id, user_id=user_id, state=state, detail=detail[:300]))


def transition(db: Session, instr: PaymentInstruction, state: str, detail: str = "") -> None:
    """Move an instruction's lifecycle forward; anything not in ALLOWED is refused."""
    if state not in ALLOWED.get(instr.lifecycle_state, set()):
        raise VicError("INVALID_LIFECYCLE_TRANSITION",
                       f"Can't move from {instr.lifecycle_state} to {state}.", 409)
    instr.lifecycle_state = state
    log_event(db, instr.instruction_id, instr.user_id, state, detail)
