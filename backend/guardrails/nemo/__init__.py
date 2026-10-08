"""NeMo Guardrails — commerce scope and credential policy for chat input.

The policy lives in commerce.co / config.yml. Its only decision source is one
direct Gemini classification call (classify_commerce_scope), made once per message.
"""
from contextvars import ContextVar
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

# Must match the bot refusal wording in commerce.co
_CREDENTIAL_REFUSAL = "I can't share or expose payment credentials"
_SCOPE_REFUSAL = "I'm your personal shopping assistant"

_VERDICTS = {"commerce_allowed", "off_topic", "credential_request"}
_CLASSIFY_PROMPT = """Classify this message sent to a shopping assistant. Reply with exactly one label:
commerce_allowed - finding, comparing, checking or buying products, or a follow-up about shopping
credential_request - asking for card numbers, CVV, PIN, bank details or other payment credentials
off_topic - anything else, such as weather, poems, code, homework or general knowledge

Message: {text}"""

_verdict_ctx: ContextVar[Optional[dict]] = ContextVar("nemo_verdict", default=None)


async def classify_commerce_scope(text: str) -> str:
    from backend.config.llm import get_llm
    response = await get_llm(temperature=0.0).ainvoke(_CLASSIFY_PROMPT.format(text=text))
    content = response.content
    if isinstance(content, list):
        content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
    label = str(content).strip().strip("\"'.").lower()
    verdict = label if label in _VERDICTS else "unknown"
    holder = _verdict_ctx.get()
    if holder is not None:
        holder["verdict"] = verdict
    return verdict


def get_rails():
    """Lazy-load NeMo Guardrails. Cached after first call."""
    global _rails
    if _rails is not None:
        return _rails
    try:
        from nemoguardrails import RailsConfig, LLMRails
        from backend.config.llm import get_llm
        config = RailsConfig.from_path(str(_CONFIG_DIR))
        rails = LLMRails(config, llm=get_llm(temperature=0.0))
        rails.register_action(classify_commerce_scope, "classify_commerce_scope")
        _rails = rails
    except Exception as e:
        print(f"[WARNING] NeMo Guardrails unavailable: {e}. Running without input guardrails.")
        _rails = None
    return _rails


def _result(allowed: bool, message: Optional[str], credential_check: str, nemo: str,
            category: Optional[str] = None, error: Optional[str] = None) -> dict:
    return {
        "allowed": allowed,
        "message": message,
        "credential_check": credential_check,
        "nemo": nemo,
        "policy": "Commerce Scope",
        "engine": "Gemini",
        "category": category,
        "error": error,
    }


async def check_input_detailed(user_message: str, skip_scope: bool = False) -> dict:
    msg_lower = user_message.lower()
    for kw in _CREDENTIAL_KEYWORDS:
        if kw in msg_lower:
            return _result(False, _BLOCKED_CREDENTIAL_MSG, "blocked", "not_run", "credential_request")

    # Already in an active shopping conversation: a short reply like "anything is
    # fine" or "no preference" is a follow-up answer, not an off-topic message, so
    # the scope classifier is skipped (the credential check above still ran).
    if skip_scope:
        return _result(True, None, "pass", "pass", "commerce_allowed")

    rails = get_rails()
    if rails is None:
        return _result(True, None, "pass", "unavailable")

    holder: dict = {}
    token = _verdict_ctx.set(holder)
    try:
        response = await rails.generate_async(
            messages=[{"role": "user", "content": user_message}],
            options={"rails": {"input": True, "output": False}},
        )
    except Exception as e:
        return _result(True, None, "pass", "error", error=str(e)[:200])
    finally:
        _verdict_ctx.reset(token)

    content = response.response[0]["content"] if response.response else ""
    verdict = holder.get("verdict")
    if _CREDENTIAL_REFUSAL in content:
        return _result(False, content, "pass", "blocked", "credential_request")
    if _SCOPE_REFUSAL in content:
        return _result(False, content, "pass", "blocked", "off_topic")
    if verdict == "commerce_allowed":
        return _result(True, None, "pass", "pass", "commerce_allowed")
    return _result(True, None, "pass", "error", verdict or "no_verdict",
                   error="classification did not complete")


async def check_input(user_message: str) -> tuple[bool, Optional[str]]:
    result = await check_input_detailed(user_message)
    return result["allowed"], result["message"]
