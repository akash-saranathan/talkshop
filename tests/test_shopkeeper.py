"""
Conversational shopkeeper tests — VibeCheck should ask one clarifying
question when it only knows the product category, then merge the answer
into the same intent on the next message instead of starting over.
"""
from unittest.mock import AsyncMock, patch

import pytest

from backend.graph import session_state
from backend.models.intent import ShoppingIntent


# ── needs_followup / generate_followup_question ─────────────────────────────────

def test_needs_followup_true_for_bare_category():
    from backend.agents.vibecheck import needs_followup
    intent = ShoppingIntent(category="running_shoes", raw_query="running shoes")
    assert needs_followup(intent) is True


def test_needs_followup_false_when_brand_given():
    from backend.agents.vibecheck import needs_followup
    intent = ShoppingIntent(category="running_shoes", brand="Nike", raw_query="Nike running shoes")
    assert needs_followup(intent) is False


def test_needs_followup_false_when_preferences_given():
    from backend.agents.vibecheck import needs_followup
    intent = ShoppingIntent(category="running_shoes", preferences=["lightweight"], raw_query="lightweight running shoes")
    assert needs_followup(intent) is False


def test_needs_followup_false_for_chitchat():
    from backend.agents.vibecheck import needs_followup
    intent = ShoppingIntent(category="chitchat", raw_query="hi")
    assert needs_followup(intent) is False


def test_needs_followup_false_for_general():
    from backend.agents.vibecheck import needs_followup
    intent = ShoppingIntent(category="general", raw_query="i need a thing")
    assert needs_followup(intent) is False


def test_generate_followup_question_mentions_category():
    from backend.agents.vibecheck import generate_followup_question
    intent = ShoppingIntent(category="running_shoes", raw_query="running shoes")
    question = generate_followup_question(intent)
    assert "running shoes" in question.lower()
    assert "?" in question


# ── session_state ─────────────────────────────────────────────────────────────

def test_session_state_round_trip():
    session_id = "test-session-1"
    session_state.clear(session_id)

    assert session_state.get_partial_intent(session_id) is None
    assert session_state.has_asked_followup(session_id) is False

    session_state.save_followup_asked(session_id, {"category": "running_shoes"})
    assert session_state.has_asked_followup(session_id) is True
    assert session_state.get_partial_intent(session_id) == {"category": "running_shoes"}

    session_state.clear(session_id)
    assert session_state.get_partial_intent(session_id) is None
    assert session_state.has_asked_followup(session_id) is False


# ── extract_intent merges prior_intent ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_intent_passes_prior_intent_into_prompt():
    """
    We don't need a real LLM to prove the merge context is being sent —
    just that prior_intent shows up in what gets passed to the model.
    """
    from backend.agents.vibecheck import extract_intent

    fake_response = AsyncMock()
    fake_response.content = (
        '{"category": "running_shoes", "brand": null, "size": "10", "color": null, '
        '"max_price": 100.0, "delivery_days": null, "preferences": [], '
        '"use_case": null, "currency": "USD", "raw_query": null}'
    )
    llm = AsyncMock()
    llm.ainvoke = AsyncMock(return_value=fake_response)

    with patch("backend.agents.vibecheck.get_llm", return_value=llm), \
         patch("backend.guardrails.nemo.check_input", AsyncMock(return_value=(True, None))):
        intent, error = await extract_intent(
            "size 10, under $100",
            prior_intent={"category": "running_shoes"},
        )

    assert error is None
    assert intent.category == "running_shoes"
    assert intent.size == "10"
    assert intent.max_price == 100.0

    # The prior intent must actually have been included in what we sent the LLM
    sent_messages = llm.ainvoke.call_args[0][0]
    user_message_content = sent_messages[-1].content
    assert "running_shoes" in user_message_content
    assert "size 10, under $100" in user_message_content
