"""
Last line of defence for trace events: nothing that looks like card data leaves the
server in a protocol event, whatever a caller put in it.

The purchase flow never puts card data in events in the first place; this only
guarantees it stays that way if someone adds a field later.
"""
from __future__ import annotations

import re
from typing import Any

_SENSITIVE_KEYS = {"number", "card_number", "pan", "cvc", "cvv", "cvc2", "security_code", "card_expiry", "expiry"}
# A standalone 13-19 digit number, optionally grouped by spaces or dashes. Digits inside a longer
# token (a hash, an id) are left alone.
_CARD_LIKE = re.compile(r"(?<![0-9A-Za-z])\d(?:[ -]?\d){12,18}(?![0-9A-Za-z])")


def _mask(text: str) -> str:
    return _CARD_LIKE.sub(lambda m: "**** " + re.sub(r"\D", "", m.group())[-4:], text)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[redacted]" if str(k).lower() in _SENSITIVE_KEYS else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return _mask(value)
    return value
