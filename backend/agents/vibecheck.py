"""
VibeCheck — Orchestrator Agent (Agent 1).
Receives raw user text, extracts a structured ShoppingIntent via LLM,
validates output with Guardrails AI, runs NeMo input rails.
LLM only touches intent extraction and prose explanations.
Financial fields (price, inventory, etc.) come from merchant tools, never from here.
"""
import json
from typing import Any, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from backend.config.llm import get_llm
from backend.guardrails.validators import validate_shopping_intent, extract_json_from_llm
from backend.models.intent import ShoppingIntent


def _content_text(content: Any) -> str:
    """
    LangChain message content is typed as str | list[str | dict] — some
    Gemini responses come back as a list of content parts rather than a
    plain string. Normalize to plain text either way.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(part.get("text", ""))
        return "".join(parts)
    return str(content)

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
- category must be one of:
    running_shoes, sneakers, boots, clothing, laptops, phones, watches,
    bags, sunglasses, electronics, accessories, general, chitchat
  Map user words precisely:
    "shirt", "t-shirt", "tee", "polo", "dress", "pants", "jeans" → "clothing"
    "sneaker", "casual shoe", "trainer" → "sneakers"
    "boot", "chelsea boot" → "boots"
    "laptop", "notebook", "computer" → "laptops"
    "phone", "smartphone", "iphone", "android" → "phones"
    "watch", "timepiece" → "watches"
    "bag", "backpack", "purse", "handbag" → "bags"
    "sunglasses", "shades", "sunnies" → "sunglasses"
    "headphones", "earbuds", "speaker" → "electronics"
- Use "chitchat" when the message is a greeting, thanks, or anything else that
  isn't actually a product request (e.g. "hi", "hello", "thanks", "how are you")
  — leave every other field null in that case
- If you are uncertain about a field, use null
- Never invent product facts, prices, or inventory — that is done by other agents
- The user may attach a photo of the kind of product they want. Use it only
  to infer visual attributes already in the schema (category, color) —
  never invent a brand, price, or model name just because it looks similar
  to one you recognize
"""


async def extract_intent(
    user_message: str,
    prior_intent: Optional[dict] = None,
    image_base64: Optional[str] = None,
) -> tuple[Optional[ShoppingIntent], Optional[str]]:
    """
    Run NeMo input guard → LLM extraction → Guardrails AI validation.
    Returns (intent, error_message). error_message is non-None if blocked.

    prior_intent, when given, is merged with — not replaced by — the new
    message, so a follow-up answer ("size 10, under $100") completes the
    same intent instead of starting a fresh, under-specified one.

    image_base64, when given, is a photo the user pasted of the kind of
    product they want — passed to the LLM as a second content part
    (Gemini is multimodal) purely to help infer visual attributes.
    """
    from backend.guardrails.nemo import check_input
    allowed, block_msg = await check_input(user_message)
    if not allowed:
        return None, block_msg

    llm = get_llm(temperature=0.1)
    user_content = user_message
    if prior_intent:
        user_content = (
            f"Previously gathered info: {json.dumps(prior_intent)}\n"
            f'User\'s new message: "{user_message}"\n'
            f"Merge the new message into the previous info — keep fields "
            f"already known unless the new message changes them."
        )

    human_content: Any = user_content
    if image_base64:
        human_content = [
            {"type": "text", "text": user_content},
            {"type": "image_url", "image_url": f"data:image/jpeg;base64,{image_base64}"},
        ]

    messages = [
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(content=human_content),
    ]

    try:
        response = await llm.ainvoke(messages)
        raw = extract_json_from_llm(_content_text(response.content))
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


_DISTINGUISHING_FIELDS = ("brand", "size", "color", "max_price")


def needs_followup(intent: ShoppingIntent) -> bool:
    """
    True when we know the product category but nothing else distinguishing —
    exactly the case where a real shopkeeper would ask before suggesting
    anything, rather than guessing from one vague word.

    use_case is deliberately excluded from the "distinguishing" fields: the
    LLM tends to restate the category there ("running shoes" -> use_case=
    "running") even for a genuinely vague message, which would otherwise
    make this check falsely think enough detail was already given.
    """
    if intent.category in ("chitchat", "general"):
        return False
    has_detail = any(getattr(intent, f) for f in _DISTINGUISHING_FIELDS) or bool(intent.preferences)
    return not has_detail


def generate_followup_question(intent: ShoppingIntent) -> str:
    """Deterministic, category-aware — no LLM call needed for one clarifying question."""
    label = intent.category.replace("_", " ")
    return (
        f"Got it, {label}! To find the best options — "
        f"do you have a preferred size, color, brand, or budget in mind?"
    )


def generate_greeting_reply() -> str:
    """
    Deterministic friendly reply for non-shopping chitchat (greetings, thanks,
    etc.) — no LLM call needed for something this simple, and it keeps the
    tone consistent every time instead of leaving it to chance.
    """
    return (
        "Hi! I'm your shopping assistant — tell me what you're looking for "
        "(a product, brand, size, or budget) and I'll find the best options for you."
    )


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
        return _content_text(response.content).strip()
    except Exception:
        # LLM is prose-only here — fall back to a deterministic sentence built
        # from data already in `products` rather than losing the search results.
        best = top[0]
        return (
            f"Here's what I found: {best['title']} for ${best['price']} "
            f"at {best['merchant_name']}."
        )
