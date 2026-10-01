"""NeMo Guardrails — input/conversation safety for all agent LLM calls."""
from pathlib import Path
from typing import Optional

_rails = None
_CONFIG_DIR = Path(__file__).parent

# Deterministic credential-request detector — runs BEFORE NeMo so it never
# relies on LLM availability or semantic matching.
_CREDENTIAL_KEYWORDS = [
    "card number", "card no", "card digit",
    "cvv", "cvc", "csc",
    " pin ", "my pin", "tell pin", "share pin",
    "credit card", "debit card",
    "bank account", "account number", "routing number",
    "card details", "card credentials", "card info",
    "provide card", "give card", "show card", "my card",
    "billing number", "security code",
    "expiry", "expiration date", "card expir",
    "full card", "payment details", "payment credentials",
]

_BLOCKED_CREDENTIAL_MSG = (
    "I can never share or expose payment credentials — that's a hard boundary "
    "I never cross. Card numbers, CVVs, PINs, and banking details stay locked "
    "in the secure vault and are never visible to me or any agent. "
    "What can I help you find today? 🔒"
)


def get_rails():
    """Lazy-load NeMo Guardrails. Cached after first call."""
    global _rails
    if _rails is not None:
        return _rails
    try:
        from nemoguardrails import RailsConfig, LLMRails
        config = RailsConfig.from_path(str(_CONFIG_DIR))
        _rails = LLMRails(config)
    except Exception as e:
        print(f"[WARNING] NeMo Guardrails unavailable: {e}. Running without input guardrails.")
        _rails = None
    return _rails


async def check_input(user_message: str) -> tuple[bool, Optional[str]]:
    """
    Run input through guardrails.
    Returns (allowed: bool, blocked_message: str | None).

    1. Deterministic keyword check — always runs, never fails open.
    2. NeMo semantic check — runs only if NeMo is available; fails open.
    """
    msg_lower = user_message.lower()

    # --- deterministic layer (runs even if NeMo is down) ---
    for kw in _CREDENTIAL_KEYWORDS:
        if kw in msg_lower:
            return False, _BLOCKED_CREDENTIAL_MSG

    # --- NeMo semantic layer ---
    rails = get_rails()
    if rails is None:
        return True, None

    try:
        response = await rails.generate_async(
            messages=[{"role": "user", "content": user_message}]
        )
        content = response.get("content", "")
        refused_phrases = [
            "Payment credentials are protected",
            "I can only help with product discovery",
        ]
        for phrase in refused_phrases:
            if phrase in content:
                return False, content
        return True, None
    except Exception:
        return True, None
