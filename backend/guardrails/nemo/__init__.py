"""NeMo Guardrails — input/conversation safety for all agent LLM calls."""
from pathlib import Path
from typing import Optional

_rails = None
_CONFIG_DIR = Path(__file__).parent


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
    Run input through NeMo rails.
    Returns (allowed: bool, blocked_message: str | None).
    If rails unavailable, allows all input (fail open).
    """
    rails = get_rails()
    if rails is None:
        return True, None

    try:
        response = await rails.generate_async(
            messages=[{"role": "user", "content": user_message}]
        )
        content = response.get("content", "")
        # NeMo returns the refusal message if a rail fires
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
