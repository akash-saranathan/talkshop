"""
Guardrails AI — output schema validation on LLM responses.
Catches hallucinated financial fields (e.g. price as string) before they
enter the financial pipeline.
"""
from typing import Any, Optional

from backend.models.intent import ShoppingIntent


def validate_shopping_intent(raw_output: str) -> tuple[bool, Optional[ShoppingIntent], Optional[str]]:
    """
    Parse and validate LLM output as ShoppingIntent.
    Returns (valid, intent, error_message).
    Uses Guardrails AI if available, falls back to raw Pydantic parse.
    """
    try:
        from guardrails import Guard
        guard = Guard.from_pydantic(ShoppingIntent)
        result = guard.parse(raw_output)
        validated = ShoppingIntent.model_validate(result.validated_output)
        return True, validated, None
    except ImportError:
        # Guardrails AI not installed — fall back to Pydantic directly
        pass
    except Exception as e:
        return False, None, f"guardrails_validation_failed: {e}"

    # Pydantic fallback
    try:
        import json
        # Strip markdown code fences if present
        clean = raw_output.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1])
        data = json.loads(clean)
        intent = ShoppingIntent.model_validate(data)
        return True, intent, None
    except Exception as e:
        return False, None, f"pydantic_parse_failed: {e}"


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
