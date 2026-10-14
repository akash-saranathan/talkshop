"""Commerce scope and credential guardrail for chat input.

Two layers, in order:
  1. Deterministic credential-keyword check (no LLM).
  2. Commerce scope check: one direct Gemini classification call per message.
     Fails closed: if the check errors or returns an unrecognised label, the
     message is blocked, never let through.
"""
from typing import Optional

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

_OFF_TOPIC_MSG = (
    "I'm your personal shopping assistant — I'm not able to help with that. "
    "Ask me to find a product, compare prices, or check availability and I'll get right on it!"
)

_CHECK_FAILED_MSG = "I couldn't verify that request just now. Please try again."

_VERDICTS = {"commerce_allowed", "off_topic", "credential_request"}
_CLASSIFY_PROMPT = """Classify this message sent to a shopping assistant. Reply with exactly one label:
commerce_allowed - finding, comparing, checking or buying products, or a follow-up about shopping
credential_request - asking for card numbers, CVV, PIN, bank details or other payment credentials
off_topic - anything else, such as weather, poems, code, homework or general knowledge

Message: {text}"""


async def classify_commerce_scope(text: str) -> str:
    from backend.config.llm import get_llm
    response = await get_llm(temperature=0.0).ainvoke(_CLASSIFY_PROMPT.format(text=text))
    content = response.content
    if isinstance(content, list):
        content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
    label = str(content).strip().strip("\"'.").lower()
    return label if label in _VERDICTS else "unknown"


def _result(allowed: bool, message: Optional[str], credential_check: str, scope: str,
            category: Optional[str] = None, error: Optional[str] = None) -> dict:
    return {
        "allowed": allowed,
        "message": message,
        "credential_check": credential_check,
        "scope": scope,  # "pass" | "blocked" | "error" | "skipped"
        "policy": "Commerce scope",
        "engine": "Gemini",
        "category": category,
        "error": error,
    }


async def check_input_detailed(user_message: str, skip_scope: bool = False) -> dict:
    msg_lower = user_message.lower()
    for kw in _CREDENTIAL_KEYWORDS:
        if kw in msg_lower:
            return _result(False, _BLOCKED_CREDENTIAL_MSG, "blocked", "skipped", "credential_request")

    # Active shopping conversation: a short reply ("anything is fine") is a follow-up
    # answer, so the scope call is skipped. Reported as "skipped", never as a PASS.
    if skip_scope:
        return _result(True, None, "pass", "skipped", "commerce_allowed")

    try:
        verdict = await classify_commerce_scope(user_message)
    except Exception as e:
        return _result(False, _CHECK_FAILED_MSG, "pass", "error", error=str(e)[:200])

    if verdict == "commerce_allowed":
        return _result(True, None, "pass", "pass", "commerce_allowed")
    if verdict == "credential_request":
        return _result(False, _BLOCKED_CREDENTIAL_MSG, "pass", "blocked", "credential_request")
    if verdict == "off_topic":
        return _result(False, _OFF_TOPIC_MSG, "pass", "blocked", "off_topic")
    return _result(False, _CHECK_FAILED_MSG, "pass", "error", verdict,
                   error="classification did not return a known label")


async def check_input(user_message: str) -> tuple[bool, Optional[str]]:
    result = await check_input_detailed(user_message)
    return result["allowed"], result["message"]
