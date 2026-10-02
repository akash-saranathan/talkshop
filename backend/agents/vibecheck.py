"""
VibeCheck -- Orchestrator Agent (Agent 1).
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
    LangChain message content is typed as str | list[str | dict] -- some
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
  "category": string,          // required -- e.g. "running_shoes", "electronics", "accessories"
  "brand": string | null,      // e.g. "Nike"
  "size": string | null,       // e.g. "10", "M", "15-inch"
  "color": string | null,
  "max_price": number | null,  // USD, numeric only -- NEVER a string
  "delivery_days": number | null,
  "preferences": [string],     // e.g. ["lightweight", "high cushioning"]
  "use_case": string | null,   // e.g. "road running", "office work"
  "currency": "USD",
  "raw_query": string          // exact user text, preserved for audit
}

Rules:
- max_price must be a number, not a string ("under $100" → 100.0)
- category must be one of:
    running_shoes, sneakers, boots, shoes, clothing, laptops, phones, watches,
    bags, sunglasses, electronics, accessories, general, chitchat
  Map user words precisely:
    "shirt", "t-shirt", "tee", "polo", "dress", "pants", "jeans" → "clothing"
    "shoe", "shoes" (generic, no qualifier) → "shoes"
    "sneaker", "casual shoe", "trainer" → "sneakers"
    "running shoe", "running sneaker" → "running_shoes"
    "boot", "chelsea boot" → "boots"
    "laptop", "notebook", "computer" → "laptops"
    "phone", "smartphone", "iphone", "android" → "phones"
    "watch", "timepiece" → "watches"
    "bag", "backpack", "purse", "handbag" → "bags"
    "sunglasses", "shades", "sunnies" → "sunglasses"
    "headphones", "earbuds", "speaker" → "electronics"
- Use "chitchat" when the message is a greeting, thanks, or anything else that
  isn't actually a product request (e.g. "hi", "hello", "thanks", "how are you")
  -- leave every other field null in that case
- If you are uncertain about a field, use null
- Never invent product facts, prices, or inventory -- that is done by other agents
- The user may attach a photo of the kind of product they want. Use it only
  to infer visual attributes already in the schema (category, color) --
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

    prior_intent, when given, is merged with -- not replaced by -- the new
    message, so a follow-up answer ("size 10, under $100") completes the
    same intent instead of starting a fresh, under-specified one.

    image_base64, when given, is a photo the user pasted of the kind of
    product they want -- passed to the LLM as a second content part
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
            f"First decide: is the new message a REFINEMENT of the same product search "
            f"(a size, color, budget, or brand for the same kind of item), or does it ask "
            f"for a DIFFERENT kind of product entirely (a new category)?\n"
            f"- Refinement: merge the new message into the previous info -- keep fields "
            f"already known unless the new message changes them.\n"
            f"- Different product: this is a fresh search. Use only what the new message "
            f"says. Reset brand, size, color, max_price, preferences, and use_case to null "
            f"-- a size/color/budget that applied to the old category (e.g. a bag) almost "
            f"never applies to the new one (e.g. shoes), so do not carry them over unless "
            f"the new message states them again."
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


_AFFIRMATIVE = {
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "please do",
    "go ahead", "do it", "sounds good", "that works", "raise it", "increase it",
}


def is_affirmative(message: str) -> bool:
    """
    Deterministic check for a bare "yes"-style reply -- used to apply a
    pending suggestion (e.g. a budget raise) without asking the LLM to
    guess what a one-word message is agreeing to.
    """
    return message.strip().lower().rstrip(".!") in _AFFIRMATIVE


_DISTINGUISHING_FIELDS = ("brand", "size", "color", "max_price")


def needs_followup(intent: ShoppingIntent) -> bool:
    """
    True when we know the product category but nothing else distinguishing --
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
    """Deterministic, category-aware -- no LLM call needed for one clarifying question."""
    label = intent.category.replace("_", " ")
    return (
        f"Got it, {label}! To find the best options -- "
        f"do you have a preferred size, color, brand, or budget in mind?"
    )


_OBVIOUS_CHITCHAT = {
    "hi", "hello", "hey", "thanks", "thank you", "bye", "goodbye",
    "ok", "okay", "cool", "nice", "great", "perfect", "awesome",
    "sure", "yes", "no", "nope", "yep", "yeah",
}

_NEW_SEARCH_KEYWORDS = {
    "show me", "find me", "search for", "look for", "i want", "i need",
    "get me", "buy me", "running shoes", "sneakers", "boots", "laptop",
    "phone", "watch", "shirt", "bag", "headphones", "earbuds", "jacket",
    "dress", "pants", "sunglasses", "backpack", "camera",
}

# Phrases that indicate checkout/purchase intent for the CURRENT session product --
# fast-path so the LLM never sees these when context products exist.
_CHECKOUT_HINTS = {
    "add it", "add to cart", "buy it", "purchase it", "checkout",
    "make payment", "proceed to pay", "proceed to checkout", "place order",
    "complete purchase", "ready to pay", "move on to buy", "let's buy", "lets buy",
    # These reach the backend only when frontend intercepts miss them -- treat as
    # product_followup so the pipeline skips a new product search.
    "show cart", "show the cart", "view cart", "view my cart", "open cart",
    "proceed", "ok proceed", "yes proceed", "buy now", "yes buy it", "ok buy it",
    "add first", "add second", "add third", "buy first", "buy second", "buy third",
}


def _fast_classify(message: str) -> Optional[str]:
    """
    Deterministic fast-path -- no LLM call.
    Returns a classification only for clear-cut cases; None means ambiguous
    and the LLM classifier should decide.
    """
    m = message.strip().lower().rstrip("!?.")
    # Bare one-or-two-word greetings/acks
    if m in _OBVIOUS_CHITCHAT or all(w in _OBVIOUS_CHITCHAT for w in m.split()):
        return "chitchat"
    # Checkout intent → treat as product_followup so the pipeline skips search
    # and the frontend's own isCheckoutIntent() intercepts it before it gets here
    if any(kw in m for kw in _CHECKOUT_HINTS):
        return "product_followup"
    # Explicit search phrasing or clear product category mention
    if any(kw in m for kw in _NEW_SEARCH_KEYWORDS):
        return "new_search"
    return None  # ambiguous -- let the LLM decide


async def classify_message_intent(
    message: str,
    session_products: list[dict],
) -> str:
    """
    When the session already has shown products, ask the LLM to classify the
    new message as one of three intents:
      - "product_followup"  -- question/comment about the products already shown
      - "new_search"        -- request for a different/new product
      - "chitchat"          -- greeting, thanks, or unrelated remark

    Returns "new_search" on any error so the pipeline always continues safely.
    Only called when session_products is non-empty.
    """
    # Try deterministic fast-path first -- avoids an LLM call for obvious cases
    fast = _fast_classify(message)
    if fast is not None:
        return fast

    products_summary = "\n".join(
        f"{i + 1}. {p['title']} -- ${p['price']}"
        for i, p in enumerate(session_products[:5])
    )
    prompt = f"""The user was just shown these products:
{products_summary}

New message: "{message}"

Classify this message as exactly one of:
- "product_followup" -- ANY question, comment, or action about the products already shown above. This includes: comparing products ("compare first and third", "which is better?"), asking about quality or features ("is the first one good?", "are they waterproof?"), buying/cart actions ("add first one to cart", "buy the top one", "add it to cart", "proceed to buy", "how do I buy this?"), or asking for a recommendation ("which one should I get?").
- "new_search" -- a request for a DIFFERENT or NEW kind of product (e.g. "show me Nike shoes", "find me a laptop", "what about blue ones?", "I want something under $50 instead").
- "chitchat" -- a completely unrelated greeting or remark (e.g. "hi", "thanks", "how are you"). NOT buying/cart phrases.

When in doubt between product_followup and new_search, choose product_followup.

Reply with exactly one word: product_followup, new_search, or chitchat."""

    try:
        llm = get_llm(temperature=0.0)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        result = _content_text(response.content).strip().lower().rstrip(".")
        if result in ("product_followup", "new_search", "chitchat"):
            return result
        return "new_search"
    except Exception:
        return "new_search"


async def answer_product_question_with_action(
    question: str, products: list[dict]
) -> tuple[str, Optional[dict]]:
    """
    Answer a follow-up about the shown products AND return an optional frontend
    action: {"type": "show_cart"}, {"type": "checkout", "product_idx": N}, or None.
    """
    top = products[:5]
    products_summary = "\n".join(
        f"{i + 1}. {p['title']} -- ${p['price']} | Rating: {p['rating']}/5 | {p.get('merchant_name', '')}"
        for i, p in enumerate(top)
    )
    prompt = f"""You are a helpful shopping assistant. The user was shown these products (best first). Product #1 is the top pick.

Products:
{products_summary}

User message: "{question}"

Respond with raw JSON only (no markdown, no code fences):
{{"text": "..your reply..", "action": null}}

If the user wants an action, set action to one of:
  {{"type": "show_cart"}}
  {{"type": "add_to_cart", "product_idx": 0}}
  {{"type": "checkout", "product_idx": 0}}
  {{"type": "remove_from_cart", "product_idx": 0}}
  {{"type": "show_more"}}

Rules for text:
- "this"/"it"/"that"/"this one" without a number = product #1
- "first one"/"top one"/"#1" = product #1 (index 0), "second" = index 1, etc.
- Answer in 1-3 natural sentences using only the listed facts
- For add_to_cart: "Added the [product name] to your cart!"
- For checkout/proceed: "Taking you to checkout for [product name]!"
- For remove from cart: "Removing the [product name] from your cart."
- For show_cart: "Here's your cart!"
- For show_more: "Here are more options for you!"
- Do NOT invent specs. Do NOT say you cannot do things -- you CAN via the action field.

Rules for action (IMPORTANT -- add_to_cart and checkout are DIFFERENT):
- "show cart", "view cart", "open cart", "what's in my cart" -> show_cart
- "add [it/this/first/...] to cart", "add it", "add this", "I want to add it",
  "can you add", "add the first/second/...", "add it to my cart" -> add_to_cart with product_idx
- "buy [it/this/...]", "buy now", "checkout", "proceed to checkout", "proceed to payment",
  "pay now", "place order", "yes buy it", "ok proceed", "confirm purchase" -> checkout with product_idx
- "remove [it/this/first/...] from cart", "delete from cart", "take it out",
  "remove it", "remove this" -> remove_from_cart with product_idx
- "show more", "see more", "more options", "what else", "show others",
  "any more?", "other options" -> show_more
- "it"/"this"/"that"/"first one" = product_idx 0; "second" = 1; "third" = 2
- Pure questions (specs, comparisons, recommendations) -> action: null
"""

    try:
        llm = get_llm(temperature=0.2)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        raw = _content_text(response.content).strip()
        # Strip code fences if LLM wrapped despite instructions
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        data = json.loads(raw)
        text = str(data.get("text", "")).strip()
        action = data.get("action")
        if not text:
            raise ValueError("empty text")
        _valid_actions = ("show_cart", "add_to_cart", "checkout", "remove_from_cart", "show_more")
        if action is not None:
            if not isinstance(action, dict) or action.get("type") not in _valid_actions:
                action = None
        return text, action
    except Exception:
        p = top[0] if top else None
        fallback = (
            f"The top pick is **{p['title']}** at ${p['price']} with a {p['rating']}/5 rating "
            f"from {p.get('merchant_name', 'the store')}."
            if p else "Could you ask me more specifically? I'm happy to help compare or explain any of the products."
        )
        return fallback, None


async def answer_general_message(message: str) -> str:
    """
    LLM-powered reply for any message that isn't a product search or follow-up:
    greetings, general questions, small talk, anything. Acts like a real AI
    assistant while naturally guiding shopping conversations toward searches.
    """
    prompt = f"""You are TalkShop, a friendly and knowledgeable AI shopping assistant powered by AI.
You can answer ANY question the user asks -- general knowledge, advice, chitchat, or shopping help.
Be natural, warm, and conversational (1-3 sentences). If it's a greeting, greet back warmly.
If the user asks a general knowledge question, answer it. If it's shopping-related, help them.
Never say you "cannot" answer something you actually can answer.

User: {message}"""
    try:
        llm = get_llm(temperature=0.7)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return _content_text(response.content).strip()
    except Exception:
        return "Hey! I'm TalkShop, your AI shopping assistant. What can I help you find today?"


async def generate_recommendation_text(
    intent: ShoppingIntent,
    products: list[dict],
    order_history: Optional[list[dict]] = None,
) -> tuple[str, Optional[dict]]:
    """
    LLM writes a human-readable recommendation explanation.
    All factual values (prices, ratings) come from the products list -- LLM only writes prose.

    Returns (text, pending_suggestion). pending_suggestion is only set for the
    one relaxation that has a concrete, reapplicable value (raising the
    budget) -- enough for a bare "yes" on the next turn to apply it directly,
    see vibecheck.is_affirmative(). The other hints ("try a different color")
    don't have a single value to auto-apply, so they're prose-only.
    """
    if not products:
        parts: list[str] = []
        if intent.category:
            parts.append(intent.category.replace("_", " "))
        if intent.color:
            parts.append(f"in {intent.color}")
        if intent.size:
            parts.append(f"size {intent.size}")
        if intent.brand:
            parts.append(f"from {intent.brand}")
        if intent.max_price:
            parts.append(f"under ${intent.max_price:.0f}")
        what = " ".join(parts) if parts else "products matching your criteria"
        hints: list[str] = []
        suggestion: Optional[dict] = None
        if intent.max_price:
            raised = round(intent.max_price * 1.3, 2)
            hints.append(f"try raising your budget to ${int(raised)}")
            suggestion = {"field": "max_price", "value": raised}
        if intent.color:
            hints.append("try a different color")
        if intent.brand:
            hints.append("remove the brand filter")
        if intent.size:
            hints.append("check if a similar style comes in that size")
        hint = (" -- " + hints[0].capitalize() + "?") if hints else ""
        return f"No {what} found right now{hint} Try broadening your search.", suggestion

    top = products[:3]
    best = top[0]
    others_summary = "\n".join(
        f"- {p['title']} | ${p['price']} | Rating: {p['rating']}"
        for p in top[1:]
    ) if len(top) > 1 else ""

    history_context = ""
    if order_history:
        lines = ", ".join(
            f"{h['title']} ({h['category']})" + (f" by {h['brand']}" if h.get("brand") else "")
            for h in order_history
        )
        history_context = f"\nThis customer previously bought: {lines}. Factor this in if relevant -- mention a brand match or suggest it fits their taste, in ONE extra phrase at most."

    prompt = f"""The user asked: "{intent.raw_query}"

Best match (rank #1):
- {best['title']} | ${best['price']} | Rating: {best['rating']} | Merchant: {best['merchant_name']}

Other options shown:
{others_summary if others_summary else "(none)"}
{history_context}
Write ONE short sentence (max 25 words) highlighting why the #1 pick is the best match.
Then on a new line, ask: "Want me to add the **{best['title']}** to your cart?"
Do NOT mention the other options. Do not invent any facts not listed above."""

    try:
        llm = get_llm(temperature=0.3)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        return _content_text(response.content).strip(), None
    except Exception:
        # LLM is prose-only here -- fall back to a deterministic CTA built
        # from data already in `products` rather than losing the search results.
        return (
            f"Top pick: **{best['title']}** -- ${best['price']} at {best['merchant_name']} "
            f"(rated {best['rating']}/5).\n\nWant me to add the **{best['title']}** to your cart?"
        ), None
