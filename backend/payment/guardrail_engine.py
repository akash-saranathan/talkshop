"""
12-check deterministic payment guardrail engine.
No LLM in this path — every check is a pure Python predicate.
Any failure returns a GuardrailEvent with a reason code that the UI displays.

Check order matches the plan exactly:
 1  token exists
 2  token.status == ACTIVE
 3  token not expired
 4  token not consumed
 5  agent_id matches
 6  merchant_id matches
 7  order_id matches
 8  currency matches
 9  requested amount <= token.max_amount
10  requested amount == checkout.total  (within $0.01 tolerance)
11  checkout_hash matches
12  user consent record exists
"""
from datetime import datetime, timezone
from typing import Optional

from backend.models.payment import GuardrailEvent, PaymentRequest


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fail(num: int, name: str, code: str, detail: str) -> GuardrailEvent:
    return GuardrailEvent(check_number=num, check_name=name, passed=False,
                          reason_code=code, detail=detail)


def _pass(num: int, name: str) -> GuardrailEvent:
    return GuardrailEvent(check_number=num, check_name=name, passed=True)


def run_guardrails(
    request: PaymentRequest,
    token: Optional[dict],
    checkout_total: float,
    checkout_hash: str,
    consent_exists: bool,
) -> tuple[bool, list[GuardrailEvent]]:
    """
    Run all 12 checks in order. Stops at first failure.
    Returns (all_passed, list_of_events).
    Caller must block payment if all_passed is False.
    """
    events: list[GuardrailEvent] = []

    # 1. Token exists
    if token is None:
        events.append(_fail(1, "token_exists", "TOKEN_NOT_FOUND",
                            f"No token found for token_id={request.token_id}"))
        return False, events
    events.append(_pass(1, "token_exists"))

    # 2. Token status is active
    if token.get("status") != "active":
        events.append(_fail(2, "token_active", "TOKEN_NOT_ACTIVE",
                            f"Token status is '{token.get('status')}', expected 'active'"))
        return False, events
    events.append(_pass(2, "token_active"))

    # 3. Token not expired
    expires_at = token.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    now = _utcnow()
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now > expires_at:
        events.append(_fail(3, "token_not_expired", "AUTHORIZATION_EXPIRED",
                            f"Token expired at {expires_at.isoformat()}"))
        return False, events
    events.append(_pass(3, "token_not_expired"))

    # 4. Token not consumed
    if token.get("consumed_at") is not None:
        events.append(_fail(4, "token_not_consumed", "TOKEN_ALREADY_CONSUMED",
                            "This single-use token has already been consumed"))
        return False, events
    events.append(_pass(4, "token_not_consumed"))

    # 5. Agent ID matches
    if token.get("agent_id") != request.agent_id:
        events.append(_fail(5, "agent_id_match", "AGENT_NOT_AUTHORIZED",
                            f"Token issued to agent '{token.get('agent_id')}', "
                            f"request from '{request.agent_id}'"))
        return False, events
    events.append(_pass(5, "agent_id_match"))

    # 6. Merchant ID matches
    if token.get("merchant_id") != request.merchant_id:
        events.append(_fail(6, "merchant_id_match", "MERCHANT_NOT_AUTHORIZED",
                            f"Token bound to merchant '{token.get('merchant_id')}', "
                            f"request targets '{request.merchant_id}'"))
        return False, events
    events.append(_pass(6, "merchant_id_match"))

    # 7. Order ID matches
    if token.get("order_id") != request.order_id:
        events.append(_fail(7, "order_id_match", "ORDER_MISMATCH",
                            f"Token bound to order '{token.get('order_id')}', "
                            f"request references '{request.order_id}'"))
        return False, events
    events.append(_pass(7, "order_id_match"))

    # 8. Currency matches
    if token.get("currency", "USD") != request.currency:
        events.append(_fail(8, "currency_match", "CURRENCY_MISMATCH",
                            f"Token currency '{token.get('currency')}' != "
                            f"request currency '{request.currency}'"))
        return False, events
    events.append(_pass(8, "currency_match"))

    # 9. Amount does not exceed authorized maximum
    max_amount = token.get("max_amount", 0)
    if request.amount > max_amount:
        events.append(_fail(9, "amount_within_limit", "AMOUNT_EXCEEDS_AUTHORIZED_LIMIT",
                            f"Requested ${request.amount:.2f} exceeds "
                            f"authorized maximum ${max_amount:.2f}"))
        return False, events
    events.append(_pass(9, "amount_within_limit"))

    # 10. Amount matches checkout total (within $0.01 rounding tolerance)
    if abs(request.amount - checkout_total) > 0.01:
        events.append(_fail(10, "amount_matches_checkout", "AMOUNT_CHECKOUT_MISMATCH",
                            f"Requested ${request.amount:.2f} does not match "
                            f"checkout total ${checkout_total:.2f}"))
        return False, events
    events.append(_pass(10, "amount_matches_checkout"))

    # 11. Checkout hash matches (tamper detection)
    if token.get("checkout_hash") != checkout_hash:
        events.append(_fail(11, "checkout_hash_match", "CHECKOUT_HASH_MISMATCH",
                            "Checkout hash does not match — possible cart tampering detected"))
        return False, events
    events.append(_pass(11, "checkout_hash_match"))

    # 12. User consent record exists
    if not consent_exists:
        events.append(_fail(12, "consent_exists", "CONSENT_RECORD_MISSING",
                            "No user consent record found for this authorization"))
        return False, events
    events.append(_pass(12, "consent_exists"))

    return True, events
