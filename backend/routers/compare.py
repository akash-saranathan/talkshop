"""
Compare endpoint — LLM-powered product comparison.
Takes 2–4 products, returns an AI recommendation explaining
which is best overall and why (price, rating, delivery, etc.).
No financial fields are invented — all values come from the request payload.
"""
from typing import Optional

from fastapi import APIRouter
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from backend.config.llm import get_llm

router = APIRouter()


class CompareProduct(BaseModel):
    product_id: str
    title: str
    brand: Optional[str] = None
    price: float
    rating: float
    review_count: int = 0
    delivery_days: int
    shipping_cost: float = 0.0
    color: Optional[str] = None
    size: Optional[str] = None
    merchant_name: str


class CompareRequest(BaseModel):
    products: list[CompareProduct]


class CompareResponse(BaseModel):
    winner_product_id: str
    headline: str        # one punchy sentence: "Nike Pegasus wins overall"
    reasoning: str       # 2–3 sentences explaining why
    trade_offs: list[str]  # 1 bullet per other product: what it's better at


@router.post("/api/compare", response_model=CompareResponse)
async def compare_products(req: CompareRequest):
    """
    LLM compares the submitted products and returns a structured recommendation.
    The LLM only writes prose — all factual values come from the payload.
    """
    if len(req.products) < 2:
        # Shouldn't happen from the UI, but be safe
        p = req.products[0]
        return CompareResponse(
            winner_product_id=p.product_id,
            headline=f"{p.title} is your only option.",
            reasoning="Only one product was submitted for comparison.",
            trade_offs=[],
        )

    # Build a compact product summary for the LLM — factual values only
    lines = []
    for i, p in enumerate(req.products, 1):
        shipping = "free shipping" if p.shipping_cost == 0 else f"${p.shipping_cost:.2f} shipping"
        arrives = (
            "arrives today" if p.delivery_days == 0
            else "arrives tomorrow" if p.delivery_days == 1
            else f"arrives in {p.delivery_days} days"
        )
        lines.append(
            f"{i}. {p.title} (ID: {p.product_id})"
            f" | ${p.price:.2f}"
            f" | rating {p.rating}/5 ({p.review_count} reviews)"
            f" | {arrives}"
            f" | {shipping}"
            f" | sold by {p.merchant_name}"
            + (f" | color: {p.color}" if p.color else "")
            + (f" | size: {p.size}" if p.size else "")
        )

    product_list = "\n".join(lines)

    prompt = f"""You are a helpful shopping assistant. A user is comparing these products:

{product_list}

Decide which product is the best overall choice and explain your reasoning.
Consider: value for money, rating quality, delivery speed, free shipping.

Respond with ONLY valid JSON in this exact format — no markdown, no explanation outside the JSON:
{{
  "winner_product_id": "<product_id of the winner>",
  "headline": "<one punchy sentence, e.g. 'Nike Pegasus is the best overall pick'>",
  "reasoning": "<2-3 sentences explaining why the winner is best, citing specific numbers>",
  "trade_offs": [
    "<for each non-winner: one sentence on what it's better at, e.g. 'Brooks Ghost has the lowest price at $74.99'>",
    "..."
  ]
}}

Rules:
- winner_product_id must be one of the IDs listed above — do not invent one
- cite actual numbers (price, rating, delivery days) — do not invent facts
- trade_offs array must have exactly {len(req.products) - 1} entries, one per non-winner product
"""

    try:
        llm = get_llm(temperature=0.2)
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        raw = response.content
        if isinstance(raw, list):
            raw = "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in raw)
        raw = raw.strip()
        # Strip markdown fences if the LLM added them
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        import json
        data = json.loads(raw.strip())
        # Validate winner_id is actually one we sent
        valid_ids = {p.product_id for p in req.products}
        if data.get("winner_product_id") not in valid_ids:
            data["winner_product_id"] = req.products[0].product_id
        trade_offs = data.get("trade_offs", [])
        if not isinstance(trade_offs, list):
            trade_offs = []
        return CompareResponse(
            winner_product_id=data["winner_product_id"],
            headline=data.get("headline", "See comparison above"),
            reasoning=data.get("reasoning", ""),
            trade_offs=trade_offs,
        )
    except Exception:
        # Deterministic fallback — pick winner by composite score
        def score(p: CompareProduct) -> float:
            price_score = 1 / p.price if p.price > 0 else 0
            rating_score = p.rating / 5
            delivery_score = 1 / (p.delivery_days + 1)
            shipping_score = 0.1 if p.shipping_cost == 0 else 0
            return price_score * 30 + rating_score * 40 + delivery_score * 20 + shipping_score
        winner = max(req.products, key=score)
        others = [p for p in req.products if p.product_id != winner.product_id]
        return CompareResponse(
            winner_product_id=winner.product_id,
            headline=f"{winner.title} is the best overall pick.",
            reasoning=(
                f"It scores highest across price (${winner.price:.2f}), "
                f"rating ({winner.rating}/5), and delivery ({winner.delivery_days} day{'s' if winner.delivery_days != 1 else ''})."
            ),
            trade_offs=[
                f"{p.title} has a {'lower price' if p.price < winner.price else 'higher rating' if p.rating > winner.rating else 'faster delivery'}."
                for p in others
            ],
        )
