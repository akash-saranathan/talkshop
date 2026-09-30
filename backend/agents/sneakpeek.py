"""
SneakPeek — Product Search Agent (Agent 2).
Receives ShoppingIntent, calls MCP search_products, applies deterministic
constraint filter and ranking score. LLM is NOT used in this agent.
All financial fields (price, availability) come from merchant DB — never from LLM.
"""
from backend.models.intent import ShoppingIntent
from backend.models.product import NormalizedProduct

# Maps common user terms / LLM category outputs → canonical DB categories.
# Prevents cross-category bleed (e.g. "shirt" should never return watches).
CATEGORY_ALIASES: dict[str, list[str]] = {
    "running_shoes":  ["running_shoes", "running shoes"],
    "sneakers":       ["sneakers", "casual shoes", "casual sneakers"],
    "boots":          ["boots"],
    "shoes":          ["running_shoes", "sneakers", "boots"],
    "footwear":       ["running_shoes", "sneakers", "boots"],
    "clothing":       ["clothing"],
    "shirt":          ["clothing"],
    "shirts":         ["clothing"],
    "tshirt":         ["clothing"],
    "t-shirt":        ["clothing"],
    "tee":            ["clothing"],
    "polo":           ["clothing"],
    "dress":          ["clothing"],
    "dresses":        ["clothing"],
    "pants":          ["clothing"],
    "jeans":          ["clothing"],
    "apparel":        ["clothing"],
    "fashion":        ["clothing"],
    "laptops":        ["laptops"],
    "laptop":         ["laptops"],
    "notebook":       ["laptops"],
    "computer":       ["laptops"],
    "phones":         ["phones"],
    "phone":          ["phones"],
    "smartphone":     ["phones"],
    "mobile":         ["phones"],
    "iphone":         ["phones"],
    "android":        ["phones"],
    "watches":        ["watches"],
    "watch":          ["watches"],
    "timepiece":      ["watches"],
    "bags":           ["bags"],
    "bag":            ["bags"],
    "backpack":       ["bags"],
    "handbag":        ["bags"],
    "purse":          ["bags"],
    "sunglasses":     ["sunglasses"],
    "sunnies":        ["sunglasses"],
    "shades":         ["sunglasses"],
    "glasses":        ["sunglasses"],
    "electronics":    ["electronics", "laptops", "phones"],
    "accessories":    ["accessories", "watches", "bags", "sunglasses"],
    "headphones":     ["electronics"],
    "earbuds":        ["electronics"],
    "keyboard":       ["electronics"],
    "mouse":          ["electronics"],
    "charger":        ["electronics"],
}


def _resolve_categories(intent_category: str) -> list[str]:
    """Return the set of DB categories that match this intent category."""
    key = intent_category.lower().replace(" ", "_").replace("-", "_")
    if key in CATEGORY_ALIASES:
        return CATEGORY_ALIASES[key]
    # Fallback: exact match or substring
    return [key]


def filter_products(
    products: list[NormalizedProduct],
    intent: ShoppingIntent,
) -> list[NormalizedProduct]:
    """
    Deterministic constraint filter — no LLM involved.
    Keeps products that strictly match all specified constraints.
    Returns an empty list when no products match (never silently falls back).
    """
    allowed_cats = _resolve_categories(intent.category) if intent.category else None

    filtered = []
    for p in products:
        # Must be in stock
        if not p.available:
            continue
        # Price ceiling
        if intent.max_price is not None and p.price > intent.max_price:
            continue
        # Category — strict match against resolved alias set
        if allowed_cats is not None:
            p_cat = p.category.lower().replace(" ", "_")
            if not any(p_cat == ac or p_cat.startswith(ac) or ac.startswith(p_cat) for ac in allowed_cats):
                continue
        # Size match (if specified)
        if intent.size and p.size and p.size.lower() != intent.size.lower():
            continue
        # Color match (if specified) — substring so "navy" matches "dark navy"
        if intent.color and p.color:
            if intent.color.lower() not in p.color.lower() and p.color.lower() not in intent.color.lower():
                continue
        # Delivery deadline
        if intent.delivery_days is not None and p.delivery_days is not None:
            if p.delivery_days > intent.delivery_days:
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

    for i, product in enumerate(products):
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

        # Color match bonus
        if intent.color and product.color:
            if intent.color.lower() in product.color.lower():
                score += 12

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

        products[i] = product.model_copy(update={"rank_score": round(score, 2)})

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

    # If the intent category is a composite alias (e.g. "shoes" maps to
    # running_shoes + sneakers + boots), passing it directly to the DB would
    # return nothing because no row has category="shoes". Fetch broadly with
    # category=None so SQLite returns all products, then let filter_products
    # handle narrowing via CATEGORY_ALIASES.
    resolved_cats = _resolve_categories(intent.category) if intent.category else None
    intent_cat_key = intent.category.lower().replace(" ", "_").replace("-", "_") if intent.category else None
    mcp_category = (
        None
        if (resolved_cats and intent_cat_key not in resolved_cats)
        else intent.category
    )

    raw = await mcp_search(
        query=intent.raw_query or intent.category,
        category=mcp_category,
        brand=intent.brand,
        max_price=None,  # Pre-filter by price AFTER normalization; let MCP fetch broadly
        size=intent.size,
    )

    all_products = [NormalizedProduct.model_validate(p) for p in raw]
    filtered = filter_products(all_products, intent)

    # Color-miss fallback: if color-filtered search returned nothing for a specific
    # shoe subcategory, expand to all footwear before giving up.
    if (
        len(filtered) == 0
        and intent.color
        and intent.category
        and intent.category.lower() in ("sneakers", "running_shoes", "boots", "casual_shoes")
    ):
        expanded_raw = await mcp_search(
            query=intent.raw_query or "shoes",
            category=None,
            brand=intent.brand,
            max_price=None,
            size=intent.size,
        )
        expanded_products = [NormalizedProduct.model_validate(p) for p in expanded_raw]
        expanded_intent = intent.model_copy(update={"category": "shoes"})
        fallback = filter_products(expanded_products, expanded_intent)
        if fallback:
            all_products = expanded_products
            filtered = fallback

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
