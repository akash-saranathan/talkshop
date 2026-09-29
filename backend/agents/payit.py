"""
PayIt — Payment Execution Agent (Agent 5).
Triggered after a DPAT token exists. Runs the 12-check guardrail engine
before ever touching the mock payment processor — a guardrail failure
never reaches the charge step. No LLM anywhere in this path.
"""
from typing import Optional

from backend.models.payment import GuardrailEvent, PaymentRequest, PaymentResult
from backend.observability.tracing import get_tracer
from backend.payment import mock_processor
from backend.payment.guardrail_engine import run_guardrails

tracer = get_tracer(__name__)


async def execute_payment(
    request: PaymentRequest,
    token: Optional[dict],
    checkout_total: float,
    checkout_hash: str,
    consent_exists: bool,
) -> tuple[Optional[PaymentResult], list[GuardrailEvent], Optional[str]]:
    """
    Validate then charge. Returns (result, guardrail_events, blocked_reason).
    blocked_reason is set only when the guardrail engine itself fails —
    a processor decline is returned as a normal PaymentResult, not a block.
    """
    with tracer.start_as_current_span("payit.execute_payment") as span:
        span.set_attribute("order_id", request.order_id)

        with tracer.start_as_current_span("guardrail_engine.run_guardrails"):
            passed, events = run_guardrails(
                request, token, checkout_total, checkout_hash, consent_exists
            )

        if not passed:
            blocked_reason = next(
                (e.reason_code for e in events if not e.passed), "VALIDATION_FAILED"
            )
            span.set_attribute("blocked_reason", blocked_reason)
            return None, events, blocked_reason

        with tracer.start_as_current_span("mock_processor.process_payment") as proc_span:
            result = await mock_processor.process_payment(request)
            proc_span.set_attribute("status", result.status)

        return result, events, None
