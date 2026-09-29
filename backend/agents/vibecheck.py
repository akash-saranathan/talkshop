"""
VibeCheck — Orchestrator Agent (Agent 1).
Receives raw user text, extracts a structured ShoppingIntent via LLM,
validates output with Guardrails AI, runs NeMo input rails.
LLM only touches intent extraction and prose explanations.
Financial fields (price, inventory, etc.) come from merchant tools, never from here.
"""
import json
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage

from backend.config.llm import get_llm
from backend.guardrails.validators import validate_shopping_intent, extract_json_from_llm
from backend.models.intent import ShoppingIntent

_SYSTEM_PROMPT = """You are VibeCheck, an intent extraction agent for an agentic commerce platform.

Your ONLY job: convert a user's natural-language shopping request into a structured JSON object.

Output ONLY valid JSON. No markdown, no explanation, no preamble.
The JSON must match this schema exactly:
{
  "category": string,          // required — e.g. "running_shoes", "electronics", "accessories"
  "brand": string | null,      // e.g. "Nike"
  "size": string | null,       // e.g. "10", "M", "15-inch"
  "color": string | null,
  "max_price": number | null,  // USD, numeric only — NEVER a string
  "delivery_days": number | null,
  "preferences": [string],     // e.g. ["lightweight", "high cushioning"]
  "use_case": string | null,   // e.g. "road running", "office work"
  "currency": "USD",
  "raw_query": string          // exact user text, preserved for audit
}

Rules:
- max_price must be a number, not a string ("under $100" → 100.0)
- category must be one of: running_shoes, electronics, accessories, general
- If you are uncertain about a field, use null
- Never invent product facts, prices, or inventory — that is done by other agents
"""


async def extract_intent(user_message: str) -> tuple[Optional[ShoppingIntent], Optional[str]]:
    """
    Run NeMo input guard → LLM extraction → Guardrails AI validation.
    Returns (intent, error_message). error_message is non-None if blocked.
    """
    from backend.guardrails.nemo import check_input
    allowed, block_msg = await check_input(user_message)
    if not allowed:
        return None, block_msg

    llm = get_llm(temperature=0.1)
    messages = [
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(content=user_message),
    ]

    try:
        response = await llm.ainvoke(messages)
        raw = extract_json_from_llm(response.content)
    except Exception as e:
        return None, f"llm_error: {e}"

    valid, intent, err = validate_shopping_intent(raw)
    if not valid:
        # Last-resort: inject raw_query so the pipeline can still proceed
        try:
            data = json.loads(raw)
            data["raw_query"] = user_message
            intent = ShoppingIntent.model_validate(data)
            return intent, None
        except Exception:
            return None, f"intent_extraction_failed: {err}"

    if intent:
        intent = intent.model_copy(update={"raw_query": user_message})

    return intent, None


async def generate_recommendation_text(
    intent: ShoppingIntent,
    products: list[dict],
) -> str:
    """
    LLM writes a human-readable recommendation explanation.
    All factual values (prices, ratings) come from the products list — LLM only writes prose.
    """
    if not products:
        return "I couldn't find products matching your criteria. Try adjusting your filters."

    top = products[:3]
    product_summary = "\n".join(
        f"- {p['title']} | ${p['price']} | Rating: {p['rating']} | "
        f"Merchant: {p['merchant_name']} | In stock: {p['available']}"
        for p in top
    )

    prompt = f"""The user asked: "{intent.raw_query}"

Top matching products found:
{product_summary}

Write a 2–3 sentence recommendation explaining which product best fits their needs and why.
Be specific about the price and key feature. Do not invent any facts not listed above."""

    try:
        llm = get_llm(temperature=0.3)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return response.content.strip()
    except Exception:
        # LLM is prose-only here — fall back to a deterministic sentence built
        # from data already in `products` rather than losing the search results.
        best = top[0]
        return (
            f"Here's what I found: {best['title']} for ${best['price']} "
            f"at {best['merchant_name']}."
        )
