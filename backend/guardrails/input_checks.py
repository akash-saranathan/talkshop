"""
Deterministic input checks that run before any LLM call. Every check always
executes and reports its own result, so the trace never shows a PASS for a
check that didn't run. Off-topic requests are handled by NeMo's scope rule.
"""
import re

MAX_INPUT_CHARS = 1000

_HARSH_WORDS = (
    "fuck", "fucking", "shit", "bullshit", "bitch", "bastard", "asshole",
    "dick", "cunt", "idiot", "moron", "stupid",
)
_HARSH_RE = re.compile(r"\b(?:" + "|".join(_HARSH_WORDS) + r")\b", re.IGNORECASE)
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

_PII_PATTERNS = {
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "phone": re.compile(r"\b(?:\+?1[\s-]?)?(?:\(\d{3}\)|\d{3})[\s-]?\d{3}[\s-]?\d{4}\b"),
    "card_number": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
}


def _result(check: str, blocked: bool, reason: str) -> dict:
    return {
        "framework": "custom",
        "check": check,
        "status": "blocked" if blocked else "pass",
        "reason": reason if blocked else None,
    }


def run_input_checks(text: str) -> list[dict]:
    stripped = text.strip()
    pii_found = next((name for name, pattern in _PII_PATTERNS.items() if pattern.search(text)), None)
    return [
        _result("empty_input", not stripped, "Message is empty."),
        _result("input_length", len(text) > MAX_INPUT_CHARS,
                f"Message is longer than {MAX_INPUT_CHARS} characters."),
        _result("harsh_language", bool(_HARSH_RE.search(text)),
                "Please keep your request respectful."),
        _result("malformed_input", bool(_CONTROL_CHARS_RE.search(text)),
                "Message contains unsupported characters."),
        _result("pii_detection", pii_found is not None,
                f"Personal data detected ({pii_found}). Please don't share personal details in chat."),
    ]
