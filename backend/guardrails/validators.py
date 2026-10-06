"""
Guardrails AI — output schema validation on LLM responses.
Catches hallucinated financial fields (e.g. price as string) before they
enter the financial pipeline.
"""
from typing import Optional

from backend.models.intent import ShoppingIntent


def validate_shopping_intent(raw_output: str) -> tuple[bool, Optional[ShoppingIntent], Optional[str]]:
    valid, intent, err, _ = validate_shopping_intent_checked(raw_output)
    return valid, intent, err


def validate_shopping_intent_checked(raw_output: str) -> tuple[bool, Optional[ShoppingIntent], Optional[str], bool]:
    """
    Returns (valid, intent, error_message, guardrails_ai_ran).
    guardrails_ai_ran is True only when the Guardrails AI validator executed,
    so callers never report a Guardrails AI PASS for the plain Pydantic fallback.
    """
    try:
        from guardrails import Guard
    except ImportError:
        Guard = None

    if Guard is not None:
        try:
            result = Guard.for_pydantic(ShoppingIntent).parse(raw_output)
            if not result.validation_passed:
                return False, None, "guardrails_validation_failed", True
            return True, ShoppingIntent.model_validate(result.validated_output), None, True
        except Exception as e:
            return False, None, f"guardrails_validation_failed: {e}", True

    try:
        import json
        clean = raw_output.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1])
        intent = ShoppingIntent.model_validate(json.loads(clean))
        return True, intent, None, False
    except Exception as e:
        return False, None, f"pydantic_parse_failed: {e}", False


def extract_json_from_llm(text: str) -> str:
    """Strip markdown fences from LLM JSON output."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()
