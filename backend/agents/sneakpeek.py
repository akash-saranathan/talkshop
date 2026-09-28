"""
SneakPeek — Product Search Agent (Agent 2).
Receives ShoppingIntent, calls MCP search_products, applies deterministic
constraint filter and ranking score. LLM is NOT used in this agent.
All financial fields (price, availability) come from merchant DB — never from LLM.
"""
from backend.models.intent import ShoppingIntent
from backend.models.product import NormalizedProduct


def filter_products(
    products: list[NormalizedProduct],
    intent: ShoppingIntent,
) -> list[NormalizedProduct]:
    """
    Deterministic constraint filter — no LLM involved.
    Keeps products that strictly match all specified constraints.
    """
    filtered = []
    for p in products:
        # Must be in stock
        if not p.available:
            continue
        # Price ceiling
        if intent.max_price is not None and p.price > intent.max_price:
            continue
        # Size match (if specified)
        if intent.size and p.size and p.size.lower() != intent.size.lower():
            continue
        # Category match (normalize underscore/space)
        if intent.category:
            cat_norm = intent.category.lower().replace(" ", "_")
            p_cat_norm = p.category.lower().replace(" ", "_")
            if cat_norm not in p_cat_norm and p_cat_norm not in cat_norm:
                continue
        filtered.append(p)
    return filtered


def rank_products(
    products: list[NormalizedProduct],
    intent: ShoppingIntent,
) -> list[NormalizedProduct]:
    """
    Deterministic ranking — score computed from factual attributes.
    Higher score = better match. rank_score field is set here and frozen.
    """
    prefs_lower = [p.lower() for p in intent.preferences]
    max_price = intent.max_price or float("inf")

    for product in products:
        score = 0.0

        # Budget fit: closer to max_price ceiling = better value signal
        if max_price < float("inf") and product.price > 0:
            budget_ratio = product.price / max_price
            score += max(0.0, (1.0 - budget_ratio) * 20)

        # Size match
        if intent.size and product.size and product.size.lower() == intent.size.lower():
            score += 15

        # Brand preference
        if intent.brand and product.brand and intent.brand.lower() in product.brand.lower():
            score += 20

        # Preference keywords in title / category
        title_lower = product.title.lower()
        for pref in prefs_lower:
            if pref in title_lower:
                score += 10
            if product.cushioning and pref in product.cushioning.lower():
                score += 8
            if pref == "lightweight" and product.weight_grams and product.weight_grams < 300:
                score += 8

        # Delivery speed
        if intent.delivery_days and product.delivery_days:
            if product.delivery_days <= intent.delivery_days:
                score += 10

        # Rating quality signal
        score += product.rating * 3
        if product.review_count > 50:
            score += 5
        if product.review_count > 200:
            score += 5

        # Free shipping bonus
        if product.shipping_cost == 0.0:
            score += 3

        product = product.model_copy(update={"rank_score": round(score, 2)})
        products[products.index(product)] = product

    return sorted(products, key=lambda p: p.rank_score, reverse=True)


async def search_and_rank(
    intent: ShoppingIntent,
    top_n: int = 5,
) -> tuple[list[NormalizedProduct], dict]:
    """
    Full SneakPeek pipeline: MCP search → filter → rank → return top N.
    Returns (products, stats) where stats drives the SSE step messages.
    """
    from backend.mcp.server import search_products as mcp_search

    raw = await mcp_search(
        query=intent.raw_query or intent.category,
        category=intent.category,
        brand=intent.brand,
        max_price=None,  # Pre-filter by price AFTER normalization; let MCP fetch broadly
        size=intent.size,
    )

    all_products = [NormalizedProduct.model_validate(p) for p in raw]
    filtered = filter_products(all_products, intent)
    ranked = rank_products(filtered, intent)
    top = ranked[:top_n]

    stats = {
        "total_found": len(all_products),
        "after_filter": len(filtered),
        "returned": len(top),
        "sources": list({p.source for p in all_products}),
        "merchants": list({p.merchant_id for p in all_products}),
    }

    return top, stats
