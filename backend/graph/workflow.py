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
from backend.observability.redact import redact

# ── A2A merchant agents (lazy-loaded) ────────────────────────────────────────

_MERCHANT_AGENTS = None

def _get_merchant_agents():
    global _MERCHANT_AGENTS
    if _MERCHANT_AGENTS is None:
        from backend.a2a.merchants.nike import agent as nike
        from backend.a2a.merchants.adidas import agent as adidas
        from backend.a2a.merchants.zara import agent as zara
        from backend.a2a.merchants.hm import agent as hm
        from backend.a2a.merchants.fossil import agent as fossil
        from backend.a2a.merchants.casio import agent as casio
        _MERCHANT_AGENTS = [nike, adidas, zara, hm, fossil, casio]
    return _MERCHANT_AGENTS

def _select_merchants(intent: ShoppingIntent) -> list:
    """Return only the A2A merchant agents relevant to this intent."""
    agents = _get_merchant_agents()
    brand = (intent.brand or "").lower()
    category = (intent.category or "").lower().replace("_", " ").replace("-", " ")
    relevant = []
    for ag in agents:
        if brand and ag.merchant_id.lower() == brand:
            return [ag]  # exact brand match — only that agent
        cats = " ".join(ag.categories)
        if any(w in cats for w in category.split() if len(w) > 2):
            relevant.append(ag)
    return relevant if relevant else agents  # fallback: broadcast to all 6


# ── State schema ──────────────────────────────────────────────────────────────

class CommerceState(TypedDict):
    user_message: str
    session_id: str
    user_id: Optional[str]  # injected per request for order-history personalization
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
    product_followup: bool  # question about already-shown products — skip search, answer contextually
    is_talkshop_guest: bool  # True only for "Continue as Talkshop guest" accounts
    demo: Optional[str]  # demo-only failure scenario, e.g. "bad_agent_credential"
    trusted_merchants: dict  # merchant_id -> trusted agent session id, set by the agent_trust node
    sse_queue: Optional[asyncio.Queue]  # injected per request, not serialized


# ── SSE helper ────────────────────────────────────────────────────────────────

async def _emit(state: CommerceState, event_type: str, message: str, data: Any = None):
    q: Optional[asyncio.Queue] = state.get("sse_queue")
    if q:
        await q.put({"type": event_type, "message": message, "data": data, "ts": datetime.utcnow().isoformat()})

async def _emit_protocol(state: CommerceState, *, source: str, target: str, protocol: str,
                         direction: str, label: str, detail: dict):
    q: Optional[asyncio.Queue] = state.get("sse_queue")
    if q:
        await q.put({
            "type": "protocol_event",
            "ts": datetime.utcnow().isoformat(),
            "source": source, "target": target,
            "protocol": protocol, "direction": direction,
            "label": label, "detail": redact(detail),
        })


# ── Graph nodes ───────────────────────────────────────────────────────────────

async def input_guardrail(state: CommerceState) -> CommerceState:
    from backend.guardrails.input_checks import run_input_checks
    from backend.guardrails.nemo import check_input_detailed
    from backend.graph import session_state

    await _emit(state, "step_start", "VibeCheck is reviewing your request for safety...")
    message = state["user_message"]
    await _emit_protocol(state, source="User", target="Input checks", protocol="internal",
                         direction="in", label="input_check", detail={"query": message[:120]})

    checks = run_input_checks(message)
    blocked = next((c for c in checks if c["status"] == "blocked"), None)
    if blocked:
        await _emit_protocol(state, source="Input checks", target="CustomerAgent", protocol="internal",
                             direction="out", label="input_blocked",
                             detail={"framework": "custom", "check": blocked["check"], "checks": checks})
        await _emit(state, "blocked", blocked["reason"])
        return {**state, "blocked": True, "error": blocked["reason"]}

    # An ongoing shopping conversation: a short reply ("anything is fine", "no
    # preference") is a follow-up answer, so skip the off-topic scope classifier
    # — it would otherwise misread a bare answer as off-topic. Credential checks
    # still run inside check_input_detailed.
    sid = state["session_id"]
    in_shopping_context = bool(
        session_state.get_partial_intent(sid)
        or session_state.has_asked_followup(sid)
        or session_state.get_ranked_products(sid)
    )
    nemo = await check_input_detailed(message, skip_scope=in_shopping_context)
    credential_blocked = nemo["credential_check"] == "blocked"
    checks.append({
        "framework": "custom", "check": "credential_keyword",
        "status": "blocked" if credential_blocked else "pass",
        "reason": nemo["message"] if credential_blocked else None,
    })
    if credential_blocked:
        await _emit_protocol(state, source="Input checks", target="CustomerAgent", protocol="internal",
                             direction="out", label="input_blocked",
                             detail={"framework": "custom", "check": "credential_keyword", "checks": checks})
        await _emit(state, "blocked", nemo["message"] or "Request blocked by safety guardrail")
        return {**state, "blocked": True, "error": nemo["message"]}

    await _emit_protocol(state, source="Input checks", target="CustomerAgent", protocol="internal",
                         direction="out", label="input_validation_pass",
                         detail={"framework": "custom", "checks": checks})

    if nemo["nemo"] == "pass":
        await _emit_protocol(state, source="NeMo Guardrails", target="CustomerAgent", protocol="internal",
                             direction="out", label="nemo_pass",
                             detail={"framework": "NeMo Guardrails", "policy": nemo["policy"],
                                     "engine": nemo["engine"], "category": nemo["category"]})
    elif nemo["nemo"] == "blocked":
        await _emit_protocol(state, source="NeMo Guardrails", target="CustomerAgent", protocol="internal",
                             direction="out", label="nemo_blocked",
                             detail={"framework": "NeMo Guardrails", "policy": nemo["policy"],
                                     "engine": nemo["engine"], "category": nemo["category"],
                                     "response": nemo["message"]})
        await _emit(state, "blocked", nemo["message"] or "Request blocked by safety guardrail")
        return {**state, "blocked": True, "error": nemo["message"]}
    elif nemo["nemo"] == "error":
        await _emit_protocol(state, source="NeMo Guardrails", target="CustomerAgent", protocol="internal",
                             direction="out", label=f"nemo_{nemo['nemo']}",
                             detail={"framework": "NeMo Guardrails", "error": nemo.get("error")})

    await _emit(state, "step_done", "VibeCheck — all clear, ready to shop!")
    return {**state, "blocked": False}


async def extract_intent(state: CommerceState) -> CommerceState:
    if state.get("blocked"):
        return state
    await _emit(state, "step_start", "VibeCheck is understanding what you're looking for...")
    session_id = state["session_id"]
    prior = session_state.get_partial_intent(session_id)
    image = session_state.pop_pending_image(session_id)

    # A bare "yes" to "try raising your budget to $65?" carries no product
    # info an LLM could extract on its own — apply the pending suggestion
    # deterministically instead of guessing, same reasoning as everything
    # else price-related in this app never being left to the LLM.
    pending = session_state.get_pending_suggestion(session_id)
    if prior and pending and vibecheck.is_affirmative(state["user_message"]):
        intent = ShoppingIntent.model_validate({
            **prior, pending["field"]: pending["value"], "raw_query": state["user_message"],
        })
        session_state.save_context(session_id, intent.model_dump(mode="json"))
        await _emit(state, "step_done", f"VibeCheck — got it, updated {pending['field'].replace('_', ' ')}", {"intent": intent.model_dump()})
        return {**state, "intent": intent}

    # If the session already has products, let the LLM classify whether this is
    # a follow-up question about those products, a new search, or chitchat —
    # before running full intent extraction. This handles any phrasing naturally.
    session_products = session_state.get_ranked_products(session_id)
    if session_products and not image:
        classification = await vibecheck.classify_message_intent(state["user_message"], session_products)
        if classification == "product_followup":
            await _emit(state, "step_done", "VibeCheck — answering your question about these products")
            return {**state, "product_followup": True}
        if classification == "chitchat":
            await _emit(state, "step_done", "VibeCheck — just a greeting, no products needed")
            return {**state, "chitchat": True}
        # "new_search" — fall through to full intent extraction below

    intent, error, schema_ok = await vibecheck.extract_intent_checked(state["user_message"], prior_intent=prior, image_base64=image)
    if error or not intent:
        # Never show raw provider errors in the chat (or save them to its history).
        if (error or "").startswith("llm_error"):
            message = "The AI service is responding slowly right now, so I couldn't read your request. Please try again."
        else:
            message = "Sorry, I couldn't understand that request. Could you rephrase it?"
        await _emit(state, "error", message)
        return {**state, "error": message, "blocked": True}
    if intent.category in ("chitchat", "general"):
        await _emit(state, "step_done", "VibeCheck — just a greeting, no products needed")
        return {**state, "intent": intent, "chitchat": True}

    if not session_state.has_asked_followup(session_id) and vibecheck.needs_followup(intent):
        await _emit(state, "step_done", "VibeCheck — got your request, need one more detail")
        session_state.save_followup_asked(session_id, intent.model_dump(mode="json"))
        return {**state, "intent": intent, "awaiting_followup": True}

    # Keep this intent as the conversation's ongoing context (not cleared)
    # so a later short follow-up — "budget is 50", "only black" — keeps
    # merging into the same search instead of starting over from nothing.
    session_state.save_context(session_id, intent.model_dump(mode="json"))
    await _emit_protocol(state, source="CustomerAgent", target="Gemini", protocol="internal",
                         direction="out", label="intent_extraction",
                         detail={"query": state["user_message"][:120]})
    if schema_ok:
        await _emit_protocol(state, source="Guardrails AI", target="CustomerAgent", protocol="internal",
                             direction="out", label="schema_valid",
                             detail={"framework": "Guardrails AI", "validator": "ShoppingIntent",
                                     "intent": {k: v for k, v in intent.model_dump().items() if v is not None}})
    await _emit(state, "step_done", f"VibeCheck — understood! Looking for {intent.category.replace('_', ' ')}", {"intent": intent.model_dump()})
    return {**state, "intent": intent}


def _skip_search(state: CommerceState) -> bool:
    return bool(state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup")
                or state.get("product_followup"))


async def agent_trust(state: CommerceState) -> CommerceState:
    """
    Routing, then A2A-style connection, then merchant-side trust validation.
    The customer agent presents a credential signed by Talkshop; each merchant
    verifies it deterministically and opens a trusted session. Catalog search,
    checkout and payment only happen with merchants that did.
    """
    if _skip_search(state):
        return state
    from backend.trust import credentials, sessions
    from backend.trust.models import SCOPE_CATALOG

    intent: ShoppingIntent = state["intent"]
    agents = _select_merchants(intent)
    explicit = bool(intent.brand) and len(agents) == 1 and agents[0].merchant_id == (intent.brand or "").lower()
    await _emit_protocol(state, source="CustomerAgent", target="MerchantRegistry", protocol="internal",
                         direction="out", label="merchant_routing",
                         detail={"merchants": [ag.merchant_id for ag in agents],
                                 "reason": "brand named in request" if explicit else "matched by category",
                                 "brand": intent.brand})

    credential = credentials.issue_customer_agent_credential(
        state.get("user_id") or "anonymous",
        is_talkshop_guest=bool(state.get("is_talkshop_guest")),
        simulate=state.get("demo"),
    )
    trusted: dict[str, str] = {}
    for ag in agents:
        name = f"{ag.merchant_name}Agent"
        card = ag.agent_card()
        await _emit(state, "step_start", f"Customer Agent is connecting to the {ag.merchant_name} agent...")
        await _emit_protocol(state, source="CustomerAgent", target=name, protocol="A2A", direction="out",
                             label="a2a_connect",
                             detail={"mode": "A2A-style, in-process", "agent_card": card.name,
                                     "skills": [sk.id for sk in card.skills],
                                     "endpoint": card.url})
        await _emit_protocol(state, source="CustomerAgent", target=name, protocol="TRUST", direction="out",
                             label="agent_identity_received", detail=credentials.public_view(credential))

        decision, trusted_session = sessions.establish(credential, ag.merchant_id, state["session_id"], SCOPE_CATALOG)
        checks = [c.model_dump() for c in decision.checks]
        if not decision.verified:
            await _emit_protocol(state, source=name, target="CustomerAgent", protocol="TRUST", direction="in",
                                 label="agent_identity_failed",
                                 detail={"merchant": ag.merchant_id, "failed_check": decision.failed_check,
                                         "reason": decision.reason, "checks": checks})
            continue
        await _emit_protocol(state, source=name, target="CustomerAgent", protocol="TRUST", direction="in",
                             label="agent_identity_verified",
                             detail={"merchant": ag.merchant_id,
                                     "checks": [c for c in checks if c["check"] in (
                                         "agent_identity_registered", "platform_expected",
                                         "credential_signature_valid", "credential_not_expired")]})
        await _emit_protocol(state, source=name, target="CustomerAgent", protocol="TRUST", direction="in",
                             label="delegation_verified",
                             detail={"merchant": ag.merchant_id, "customer_ref": trusted_session.customer_ref,
                                     "talkshop_account": trusted_session.talkshop_account,
                                     "checks": [c for c in checks if c["check"] == "delegation_bound_to_agent"]})
        await _emit_protocol(state, source=name, target="CustomerAgent", protocol="TRUST", direction="in",
                             label="scope_verified",
                             detail={"merchant": ag.merchant_id, "action": SCOPE_CATALOG,
                                     "granted_scopes": trusted_session.scopes,
                                     "checks": [c for c in checks if c["check"] in (
                                         "action_in_scope", "merchant_in_scope", "amount_within_scope")]})
        await _emit_protocol(state, source=name, target="CustomerAgent", protocol="TRUST", direction="in",
                             label="trusted_agent_session_created",
                             detail={"merchant": ag.merchant_id, "trusted_session_id": trusted_session.session_id,
                                     "merchant_relationship": trusted_session.merchant_relationship,
                                     "talkshop_account": trusted_session.talkshop_account,
                                     "scopes": trusted_session.scopes, "expires_at": trusted_session.expires_at})
        trusted[ag.merchant_id] = trusted_session.session_id
        guest_note = (f" (you're checking out as a guest with {ag.merchant_name})"
                      if trusted_session.merchant_relationship == "merchant_guest" else "")
        await _emit(state, "step_done",
                    f"{ag.merchant_name} verified your shopping agent — trusted session established{guest_note}")

    if not trusted:
        names = ", ".join(ag.merchant_name for ag in agents)
        message = (f"{names} could not verify your shopping agent, so no products were requested. "
                   "Nothing was searched, reserved or charged.")
        await _emit(state, "blocked", message)
        return {**state, "blocked": True, "error": "TRUST_VALIDATION_FAILED", "trusted_merchants": {}}
    return {**state, "trusted_merchants": trusted}


async def _run_a2a_sidecar(state: CommerceState, intent: ShoppingIntent) -> None:
    """Emit A2A + UCP protocol events alongside the main product search."""
    import time
    from backend.a2a.models import ShoppingIntent as A2AIntent
    from backend.merchants import catalog as merchant_catalog
    a2a_intent = A2AIntent(
        raw_query=intent.raw_query or "",
        brand=intent.brand,
        category=intent.category,
        max_price=intent.max_price,
        size=intent.size,
        color=intent.color,
        keywords=list(intent.preferences or []),
    )
    trusted = state.get("trusted_merchants") or {}
    agents = [ag for ag in _select_merchants(intent) if ag.merchant_id in trusted]
    for ag in agents:
        await _emit_protocol(state, source="CustomerAgent", target=f"{ag.merchant_name}Agent",
                             protocol="A2A", direction="out", label="message/send",
                             detail={"mode": "real HTTP — JSON-RPC 2.0 POST to the merchant's A2A endpoint",
                                     "method": "message/send", "skill": "product_search",
                                     "trusted_session_id": trusted[ag.merchant_id],
                                     "intent": {"category": intent.category, "brand": intent.brand}})
        await _emit_protocol(state, source=f"{ag.merchant_name}Agent", target="UCPCatalog",
                             protocol="UCP", direction="out", label="catalog_search",
                             detail={"merchant": ag.merchant_id, "query": intent.category})
        t0 = time.perf_counter()
        products, checks = await merchant_catalog.search_agent_over_a2a(ag, a2a_intent)
        duration_ms = round((time.perf_counter() - t0) * 1000, 1)
        await _emit_protocol(state, source="UCPCatalog", target=f"{ag.merchant_name}Agent",
                             protocol="UCP", direction="in", label="catalog_results",
                             detail={"merchant": ag.merchant_id, "product_count": len(products),
                                     "duration_ms": duration_ms})
        await _emit_protocol(state, source=f"{ag.merchant_name}Agent", target="CustomerAgent",
                             protocol="A2A", direction="in", label="boundary_check",
                             detail={"framework": "custom", "merchant": ag.merchant_id, "checks": checks})
        await _emit_protocol(state, source=f"{ag.merchant_name}Agent", target="CustomerAgent",
                             protocol="A2A", direction="in", label="task_result",
                             detail={"merchant": ag.merchant_id, "product_count": len(products),
                                     "status": "completed", "duration_ms": duration_ms})


async def mcp_product_search(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup") or state.get("product_followup"):
        return state
    intent: ShoppingIntent = state["intent"]
    await _emit(state, "step_start", "SneakPeek is searching stores for your product...")

    # Run main product search + A2A protocol sidecar in parallel
    products_result, _ = await asyncio.gather(
        sneakpeek.search_and_rank(intent, top_n=50),
        _run_a2a_sidecar(state, intent),
    )
    products, stats = products_result
    # Enforcement, not just ordering: nothing from a merchant that didn't open a trusted session.
    trusted = state.get("trusted_merchants") or {}
    products = [p for p in products if p.merchant_id in trusted]
    stats = {**stats, "returned": len(products), "trusted_merchants": sorted(trusted)}

    total = stats["total_found"]
    await _emit(state, "step_done", f"SneakPeek — found {total} products across {len(stats['merchants'])} stores", stats)
    return {**state, "raw_products": [p.model_dump() for p in products], "stats": stats}


async def normalize_products(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup") or state.get("product_followup"):
        return state
    products = [NormalizedProduct.model_validate(p) for p in state["raw_products"]]
    await _emit(state, "step_done", f"SneakPeek — catalogued {len(products)} products")
    return {**state, "filtered_products": products}


async def deterministic_filter(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup") or state.get("product_followup"):
        return state
    intent: ShoppingIntent = state["intent"]
    await _emit(state, "step_start", "SneakPeek is applying your filters (size, price, availability)...")
    filtered = sneakpeek.filter_products(state["filtered_products"], intent)
    await _emit(state, "step_done", f"SneakPeek — {len(filtered)} products match your criteria")
    return {**state, "filtered_products": filtered}


async def rank_products_node(state: CommerceState) -> CommerceState:
    if state.get("blocked") or state.get("chitchat") or state.get("awaiting_followup") or state.get("product_followup"):
        return state
    intent: ShoppingIntent = state["intent"]
    await _emit(state, "step_start", "SneakPeek is ranking the best options for you...")
    ranked = sneakpeek.rank_products(state["filtered_products"], intent)
    # Deduplicate by (title, merchant_id) — same model in multiple sizes shows up as
    # one entry (highest-scored variant wins since ranked is already sorted desc).
    seen_keys: set[tuple[str, str]] = set()
    deduped: list = []
    for p in ranked:
        key = (p.title.lower(), p.merchant_id)
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(p)
    top5 = deduped[:5]
    top10 = deduped[:10]
    # Persist up to 10 so "show more" requests can surface products 6-10 without a new search
    session_state.save_ranked_products(state["session_id"], [p.model_dump() for p in top10])
    await _emit(state, "step_done", f"SneakPeek — top {len(top5)} picks ready for you", [p.model_dump() for p in top5])
    return {**state, "ranked_products": top5}


def _get_order_history(user_id: Optional[str]) -> list[dict]:
    """Fetch last 3 confirmed orders for personalization context. Returns [] on any error."""
    if not user_id:
        return []
    try:
        from backend.db.schema import Order, CartItem
        from backend.db.session_utils import get_session
        with get_session() as session:
            rows = (
                session.query(Order)
                .filter(Order.user_id == user_id, Order.status == "confirmed")
                .order_by(Order.created_at.desc())
                .limit(3)
                .all()
            )
            history = []
            for order in rows:
                cart = (
                    session.query(CartItem)
                    .filter(CartItem.product_id == order.product_id, CartItem.user_id == user_id)
                    .order_by(CartItem.added_at.desc())
                    .first()
                )
                history.append({
                    "product_id": order.product_id,
                    "title": cart.title if cart else order.product_id,
                    "category": cart.category if cart else "unknown",
                    "brand": cart.brand if cart else None,
                    "amount": order.amount,
                })
            return history
    except Exception:
        return []


async def generate_recommendation(state: CommerceState) -> CommerceState:
    if state.get("blocked"):
        return state
    if state.get("chitchat"):
        text = await vibecheck.answer_general_message(state["user_message"])
        await _emit(state, "recommendation", text, {"products": [], "action": None})
        return {**state, "recommendation_text": text}
    if state.get("product_followup"):
        all_products = session_state.get_ranked_products(state["session_id"])
        text, action = await vibecheck.answer_product_question_with_action(state["user_message"], all_products[:5])
        if action and action.get("type") == "show_more":
            # Return products 6-10 (or all if fewer than 6 stored)
            extra = all_products[5:] if len(all_products) > 5 else all_products
            await _emit(state, "recommendation", text, {"products": extra, "action": action})
        else:
            await _emit(state, "recommendation", text, {"products": [], "action": action})
        return {**state, "recommendation_text": text}
    if state.get("awaiting_followup"):
        text = vibecheck.generate_followup_question(state["intent"])
        await _emit(state, "recommendation", text, [])
        return {**state, "recommendation_text": text}
    await _emit(state, "step_start", "VibeCheck is writing your personalized recommendation...")
    order_history = _get_order_history(state.get("user_id"))
    text, pending_suggestion = await vibecheck.generate_recommendation_text(
        state["intent"],
        [p.model_dump() for p in state["ranked_products"]],
        order_history=order_history,
    )
    if pending_suggestion:
        # So a bare "yes" on the next turn can apply this suggestion
        # directly — see the extract_intent node's affirmative short-circuit.
        session_state.save_context(state["session_id"], state["intent"].model_dump(mode="json"), pending_suggestion)
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
    graph.add_node("agent_trust", agent_trust)
    graph.add_node("mcp_product_search", mcp_product_search)
    graph.add_node("normalize_products", normalize_products)
    graph.add_node("deterministic_filter", deterministic_filter)
    graph.add_node("rank_products", rank_products_node)
    graph.add_node("generate_recommendation", generate_recommendation)
    graph.add_node("stream_to_ui", stream_to_ui)

    graph.add_edge(START, "input_guardrail")
    graph.add_edge("input_guardrail", "extract_intent")
    graph.add_edge("extract_intent", "agent_trust")
    graph.add_edge("agent_trust", "mcp_product_search")
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
    user_id: Optional[str] = None,
    is_talkshop_guest: bool = False,
    demo: Optional[str] = None,
) -> CommerceState:
    """Run the Phase 2 discovery graph and stream events via sse_queue."""
    initial_state: CommerceState = {
        "user_message": user_message,
        "session_id": session_id,
        "user_id": user_id,
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
        "product_followup": False,
        "is_talkshop_guest": is_talkshop_guest,
        "demo": demo,
        "trusted_merchants": {},
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
