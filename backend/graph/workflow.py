"""
LangGraph workflow — Phase 2 + Phase 3 nodes.

Phase 2 flow (discovery):
  START
    → input_guardrail → extract_intent → mcp_product_search
    → normalize_products → deterministic_filter → rank_products
    → generate_recommendation → stream_to_ui
  END  ← user selects product on frontend, navigates to /checkout

Phase 3 flow (checkout + authorization) runs via REST endpoints, not
this graph — see backend/routers/authorizations.py. The graph handles
the discovery half; the checkout/consent/DPAT half is driven by the
Checkout page calling POST /api/checkout/create then POST /api/authorizations/approve.
This keeps the LangGraph state simple and the human-in-the-loop pause
modelled naturally as a page navigation rather than a graph interrupt.

SSE events are pushed via an asyncio.Queue injected per-session.
"""
import asyncio
from datetime import datetime
from typing import Any, AsyncGenerator, Optional, TypedDict

from langgraph.graph import StateGraph, START, END

from backend.agents import vibecheck, sneakpeek
from backend.graph import session_state
from backend.models.intent import ShoppingIntent
from backend.models.product import NormalizedProduct


# ── State schema ──────────────────────────────────────────────────────────────

class CommerceState(TypedDict):
    user_message: str
    session_id: str
    intent: Optional[ShoppingIntent]
    raw_products: list[dict]
    filtered_products: list[NormalizedProduct]
    ranked_products: list[NormalizedProduct]
    recommendation_text: str
    stats: dict
    error: Optional[str]
    blocked: bool
    chitchat: bool  # greeting/thanks/etc — skip search, reply with a friendly prompt
    awaiting_followup: bool  # category known but under-specified — ask before searching
    sse_queue: Optional[asyncio.Queue]  # injected per request, not serialized


# ── SSE helper ────────────────────────────────────────────────────────────────

async def _emit(state: CommerceState, event_type: str, message: str, data: Any = None):
    q: Optional[asyncio.Queue] = state.get("sse_queue")
    if q:
        await q.put({"type": event_type, "message": message, "data": data, "ts": datetime.utcnow().isoformat()})


# ── Graph nodes ───────────────────────────────────────────────────────────────

async def input_guardrail(state: CommerceState) -> CommerceState:
    await _emit(state, "step_start", "Checking request safety...")
    from backend.guardrails.nemo import check_input
    allowed, block_msg = await check_input(state["user_message"])
    if not allowed:
        await _emit(state, "blocked", block_msg or "Request blocked by safety guardrail")
        return {**state, "blocked": True, "error": block_msg}
    await _emit(state, "step_done", "Safety check passed")
    return {**state, "blocked": False}


async def extract_intent(state: CommerceState) -> CommerceState:
    if state.get("blocked"):
        return state
    await _emit(state, "step_start", "Understanding your request...")
    session_id = state["session_id"]
    prior = session_state.get_partial_intent(session_id)
    image = session_state.pop_pending_image(session_id)
    intent, error = await vibecheck.extract_intent(state["user_message"], prior_intent=prior, image_base64=image)
    if error or not intent:
        await _emit(state, "error", f"Could not understand request: {error}")
        return {**state, "error": error or "intent_extraction_failed", "blocked": True}
    if intent.category == "chitchat":
        await _emit(state, "step_done", "Just saying hello, not shopping yet")
        return {**state, "intent": intent, "chitchat": True}

    if not session_state.has_asked_followup(session_id) and vibecheck.needs_followup(intent):
        await _emit(state, "step_done", f"Intent understood: {intent.category} — need a bit more detail")
        session_state.save_followup_asked(session_id, intent.model_dump(mode="json"))
        return {**state, "intent": intent, "awaiting_followup": True}

    session_state.clear(session_id)
    await _emit(state, "step_done", f"Intent understood: {intent.category}", {"intent": intent.model_dump()})
    return {**state, "intent": intent}


async def mcp_product_search(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup"):
        return state
    intent: ShoppingIntent = state["intent"]
    sources_msg = "Searching 3 merchant sources via MCP..."
    await _emit(state, "step_start", sources_msg)

    products, stats = await sneakpeek.search_and_rank(intent, top_n=50)

    total = stats["total_found"]
    await _emit(state, "step_done", f"Found {total} products across {len(stats['merchants'])} merchants", stats)
    return {**state, "raw_products": [p.model_dump() for p in products], "stats": stats}


async def normalize_products(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup"):
        return state
    products = [NormalizedProduct.model_validate(p) for p in state["raw_products"]]
    await _emit(state, "step_done", f"Normalized {len(products)} products")
    return {**state, "filtered_products": products}


async def deterministic_filter(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup"):
        return state
    intent: ShoppingIntent = state["intent"]
    await _emit(state, "step_start", "Applying your constraints...")
    filtered = sneakpeek.filter_products(state["filtered_products"], intent)
    await _emit(state, "step_done", f"{len(filtered)} products meet your constraints")
    return {**state, "filtered_products": filtered}


async def rank_products_node(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup"):
        return state
    intent: ShoppingIntent = state["intent"]
    await _emit(state, "step_start", "Ranking by your preferences...")
    ranked = sneakpeek.rank_products(state["filtered_products"], intent)
    top5 = ranked[:5]
    await _emit(state, "step_done", f"Top {len(top5)} recommendations ready", [p.model_dump() for p in top5])
    return {**state, "ranked_products": top5}


async def generate_recommendation(state: CommerceState) -> CommerceState:
    if state.get("blocked"):
        return state
    if state.get("chitchat"):
        text = vibecheck.generate_greeting_reply()
        await _emit(state, "recommendation", text, [])
        return {**state, "recommendation_text": text}
    if state.get("awaiting_followup"):
        text = vibecheck.generate_followup_question(state["intent"])
        await _emit(state, "recommendation", text, [])
        return {**state, "recommendation_text": text}
    await _emit(state, "step_start", "Generating personalized recommendation...")
    text = await vibecheck.generate_recommendation_text(
        state["intent"],
        [p.model_dump() for p in state["ranked_products"]],
    )
    await _emit(state, "recommendation", text, [p.model_dump() for p in state["ranked_products"]])
    return {**state, "recommendation_text": text}


async def stream_to_ui(state: CommerceState) -> CommerceState:
    await _emit(state, "done", "Search complete", {
        "products": [p.model_dump() for p in state.get("ranked_products", [])],
        "recommendation": state.get("recommendation_text", ""),
        "stats": state.get("stats", {}),
    })
    return state


# ── Graph assembly ────────────────────────────────────────────────────────────

def build_graph():
    graph = StateGraph(CommerceState)

    graph.add_node("input_guardrail", input_guardrail)
    graph.add_node("extract_intent", extract_intent)
    graph.add_node("mcp_product_search", mcp_product_search)
    graph.add_node("normalize_products", normalize_products)
    graph.add_node("deterministic_filter", deterministic_filter)
    graph.add_node("rank_products", rank_products_node)
    graph.add_node("generate_recommendation", generate_recommendation)
    graph.add_node("stream_to_ui", stream_to_ui)

    graph.add_edge(START, "input_guardrail")
    graph.add_edge("input_guardrail", "extract_intent")
    graph.add_edge("extract_intent", "mcp_product_search")
    graph.add_edge("mcp_product_search", "normalize_products")
    graph.add_edge("normalize_products", "deterministic_filter")
    graph.add_edge("deterministic_filter", "rank_products")
    graph.add_edge("rank_products", "generate_recommendation")
    graph.add_edge("generate_recommendation", "stream_to_ui")
    graph.add_edge("stream_to_ui", END)

    return graph.compile()


# Singleton compiled graph — built once at import
commerce_graph = build_graph()


# ── Entry point ───────────────────────────────────────────────────────────────

async def run_discovery(
    user_message: str,
    session_id: str,
    sse_queue: asyncio.Queue,
) -> CommerceState:
    """Run the Phase 2 discovery graph and stream events via sse_queue."""
    initial_state: CommerceState = {
        "user_message": user_message,
        "session_id": session_id,
        "intent": None,
        "raw_products": [],
        "filtered_products": [],
        "ranked_products": [],
        "recommendation_text": "",
        "stats": {},
        "error": None,
        "blocked": False,
        "chitchat": False,
        "awaiting_followup": False,
        "sse_queue": sse_queue,
    }
    try:
        final_state = await commerce_graph.ainvoke(initial_state)
    except Exception as e:
        # Surface the real failure immediately instead of letting the SSE
        # consumer hang until its 60s timeout with a generic message.
        await sse_queue.put({
            "type": "error",
            "message": f"Something went wrong while searching: {e}",
            "data": None,
            "ts": datetime.utcnow().isoformat(),
        })
        await sse_queue.put(None)
        return initial_state
    await sse_queue.put(None)  # sentinel — consumer knows stream is done
    return final_state
