"""
GenericShoppingAgent — orchestrates the full agentic commerce flow.

Protocol stack (bottom → top):
  A2A   — envelope protocol for talking to merchant agents (JSON-RPC 2.0)
  UCP   — locks exact totals from the selected merchant's checkout session
  ACP   — issues a Shared Payment Token scoped to those exact totals (Case 1 only)
  AP2   — three signed Verifiable Credential mandates that form the audit chain

Two payment cases:
  Case 1 (use_acp=True):  customer with inline hosted fields
                           → frontend sends opaque payment_method reference
                           → agent issues ACP SPT capped to UCP total
                           → SPT id is the UCP complete credential
  Case 2 (use_acp=False): guest with pre-registered demo instruments
                           → agent uses mock_token directly
                           → skips ACP; AP2 still runs

Human-in-the-loop pauses:
  product_selection — after products are shown; user picks one
  approve_pay       — after checkout totals are shown; user confirms + provides payment
"""
from __future__ import annotations
import asyncio
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.a2a.models import ShoppingIntent
from backend.a2a.merchants.nike import agent as nike_agent
from backend.a2a.merchants.adidas import agent as adidas_agent
from backend.a2a.merchants.zara import agent as zara_agent
from backend.a2a.merchants.hm import agent as hm_agent
from backend.a2a.merchants.fossil import agent as fossil_agent
from backend.a2a.merchants.casio import agent as casio_agent
from backend.acp.adapter import ACPAdapter
from backend.ap2.adapter import AP2Adapter
from backend.ucp.adapter import UCPAdapter

_AGENTS = {
    "nike":   nike_agent,
    "adidas": adidas_agent,
    "zara":   zara_agent,
    "hm":     hm_agent,
    "fossil": fossil_agent,
    "casio":  casio_agent,
}

_BRAND_MAP: dict[str, str] = {
    "nike": "nike", "adidas": "adidas", "zara": "zara",
    "h&m": "hm", "hm": "hm", "h and m": "hm",
    "fossil": "fossil", "casio": "casio",
}

_CATEGORY_ROUTES: dict[str, list[str]] = {
    "shoes":      ["nike", "adidas"],
    "shoe":       ["nike", "adidas"],
    "sneaker":    ["nike", "adidas"],
    "sneakers":   ["nike", "adidas"],
    "trainer":    ["nike", "adidas"],
    "running":    ["nike", "adidas"],
    "sportswear": ["nike", "adidas"],
    "athletic":   ["nike", "adidas"],
    "dress":      ["zara", "hm"],
    "dresses":    ["zara", "hm"],
    "clothing":   ["zara", "hm"],
    "outfit":     ["zara", "hm"],
    "shirt":      ["zara", "hm"],
    "pants":      ["zara", "hm"],
    "jacket":     ["zara", "hm"],
    "fashion":    ["zara", "hm"],
    "apparel":    ["nike", "adidas", "zara", "hm"],
    "watch":      ["fossil", "casio"],
    "watches":    ["fossil", "casio"],
    "timepiece":  ["fossil", "casio"],
    "chronograph":["fossil", "casio"],
    "digital":    ["casio"],
    "g-shock":    ["casio"],
    "gshock":     ["casio"],
}

_STOP_WORDS = {
    "i", "want", "need", "looking", "for", "a", "some", "the", "find",
    "show", "me", "get", "buy", "purchase", "give", "please", "can",
    "you", "help", "with", "an", "any", "good", "nice", "best",
}


# ── Shopping session state ─────────────────────────────────────────────────────

@dataclass
class ShoppingSession:
    session_id: str
    query: str
    user_id: str
    use_acp: bool

    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)
    resume_data: dict[str, Any] = field(default_factory=dict)

    state: str = "searching"
    all_products: list[dict] = field(default_factory=list)
    selected_product: dict | None = None
    selected_variant: dict | None = None
    quantity: int = 1
    payment_method: str | None = None   # opaque — never raw card data
    payment_brand: str = "card"
    payment_last4: str = "0000"

    ucp_session: Any = None
    acp_token: Any = None
    intent_mandate: Any = None
    cart_mandate: Any = None
    payment_mandate: Any = None


# ── Protocol event helpers ─────────────────────────────────────────────────────

async def _emit(queue: asyncio.Queue, event_type: str, data: dict) -> None:
    await queue.put({"type": event_type, **data})


async def _pev(
    queue: asyncio.Queue,
    source: str,
    target: str,
    protocol: str,
    direction: str,
    label: str,
    detail: dict | None = None,
) -> None:
    """Emit a protocol_event — the right-panel trace row."""
    await _emit(queue, "protocol_event", {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "target": target,
        "protocol": protocol,
        "direction": direction,
        "label": label,
        "detail": detail or {},
    })


# ── Intent parsing ─────────────────────────────────────────────────────────────

def parse_intent(query: str) -> ShoppingIntent:
    q = query.lower()

    # Brand detection — check longest match first
    brand = None
    for candidate in sorted(_BRAND_MAP, key=len, reverse=True):
        if candidate in q:
            brand = _BRAND_MAP[candidate]
            break

    # Category detection
    category = None
    for kw in _CATEGORY_ROUTES:
        if kw in q:
            category = kw
            break

    # Price extraction: "under $100", "less than 50", "max 80", "up to $120"
    max_price = None
    price_match = re.search(
        r"(?:under|less\s+than|below|max|up\s+to|at\s+most)\s*\$?\s*(\d+(?:\.\d+)?)", q
    )
    if price_match:
        max_price = float(price_match.group(1))

    # Size detection
    size = None
    size_match = re.search(r"\b(xs|s|m|l|xl|xxl|[0-9]{1,2}(?:\.[05])?)\b", q)
    if size_match:
        size = size_match.group(1).upper()

    # Color detection
    colors = ["black", "white", "red", "blue", "green", "grey", "gray", "pink",
              "yellow", "purple", "orange", "brown", "navy", "beige"]
    color = next((c for c in colors if c in q), None)

    keywords = [w for w in q.split() if w not in _STOP_WORDS and len(w) > 2][:5]

    return ShoppingIntent(
        raw_query=query,
        brand=brand,
        category=category,
        max_price=max_price,
        size=size,
        color=color,
        keywords=keywords,
    )


def route_merchants(intent: ShoppingIntent) -> list[str]:
    """Return the merchant IDs to query based on brand or category."""
    if intent.brand and intent.brand in _AGENTS:
        return [intent.brand]

    if intent.category:
        cat = intent.category.lower()
        for kw, ids in _CATEGORY_ROUTES.items():
            if kw in cat or cat in kw:
                return list(dict.fromkeys(ids))  # deduplicate, preserve order

        # Fuzzy: check against keywords
        for kw in _CATEGORY_ROUTES:
            if kw in intent.keywords:
                return list(dict.fromkeys(_CATEGORY_ROUTES[kw]))

    # No brand, no category match → broadcast to all
    return list(_AGENTS.keys())


# ── Merchant A2A calls ─────────────────────────────────────────────────────────

async def _call_merchant(
    session: ShoppingSession,
    merchant_id: str,
    intent: ShoppingIntent,
) -> list[dict]:
    agent = _AGENTS[merchant_id]

    await _pev(
        session.queue,
        "GenericShoppingAgent", f"{agent.merchant_name}Agent",
        "A2A", "→", "message/send",
        {"intent": {"category": intent.category, "brand": intent.brand, "max_price": intent.max_price}},
    )

    products = await asyncio.to_thread(agent.search, intent)

    await _pev(
        session.queue,
        f"{agent.merchant_name}Agent", "GenericShoppingAgent",
        "A2A", "←", "task_result",
        {"product_count": len(products), "merchant": merchant_id},
    )

    return products


# ── Main agent coroutine ───────────────────────────────────────────────────────

async def run_generic_agent(session: ShoppingSession) -> None:
    """
    Full agentic commerce flow. Puts SSE events on session.queue.
    Pauses at human_pause moments; resumed by the /api/generic/resume endpoint.
    """
    ucp = UCPAdapter()
    acp = ACPAdapter()
    ap2 = AP2Adapter()

    try:
        # ── AP2: IntentMandate created at session start ───────────────────────
        intent = parse_intent(session.query)
        merchant_ids = route_merchants(intent)

        await _pev(
            session.queue,
            "GenericShoppingAgent", "MerchantRegistry",
            "internal", "→", "merchant_routing",
            {"merchants": merchant_ids, "brand": intent.brand, "category": intent.category},
        )

        session.intent_mandate = ap2.create_intent_mandate(
            query=session.query,
            user_id=session.user_id,
            merchants=merchant_ids,
        )
        await _pev(
            session.queue,
            "User", "AP2Verifier",
            "AP2", "→", "intent_mandate_signed",
            {"id": session.intent_mandate.id, "merchants": merchant_ids},
        )

        # ── A2A: parallel calls to selected merchant agents ───────────────────
        results = await asyncio.gather(
            *[_call_merchant(session, mid, intent) for mid in merchant_ids]
        )
        all_products = [p for prods in results for p in prods]

        # Sort: rating desc, price asc — same as BaseMerchantAgent
        all_products.sort(key=lambda p: (-p["rating"], p["price"]))
        session.all_products = all_products

        if not all_products:
            await _emit(session.queue, "error", {"message": f"No products found for '{session.query}'. Try a different search."})
            return

        await _emit(session.queue, "products_ready", {
            "products": all_products,
            "total_count": len(all_products),
            "session_id": session.session_id,
        })

        # ── Human pause 1: product selection ─────────────────────────────────
        session.state = "products_shown"
        await _emit(session.queue, "human_pause", {
            "pause_type": "product_selection",
            "session_id": session.session_id,
        })

        try:
            await asyncio.wait_for(session.pause_event.wait(), timeout=300.0)
        except asyncio.TimeoutError:
            await _emit(session.queue, "error", {"message": "Session timed out — no product selected."})
            return
        session.pause_event.clear()

        # ── Resolve selected product ──────────────────────────────────────────
        product_id = session.resume_data.get("product_id")
        session.selected_product = next(
            (p for p in all_products if p["id"] == product_id), None
        )
        if not session.selected_product:
            # fallback: first product
            session.selected_product = all_products[0]

        session.quantity = int(session.resume_data.get("quantity", 1))
        session.selected_variant = session.resume_data.get("variant")

        # ── UCP: create checkout session ──────────────────────────────────────
        session.state = "checkout_started"
        await _pev(
            session.queue,
            "GenericShoppingAgent", "UCPAdapter",
            "UCP", "→", "POST /checkout-sessions",
            {
                "product_id": session.selected_product["id"],
                "quantity": session.quantity,
                "merchant": session.selected_product["merchant_id"],
            },
        )

        ucp_session = ucp.create_session(session.selected_product, session.quantity)
        session.ucp_session = ucp_session
        totals = ucp.totals_dict(ucp_session)

        await _pev(
            session.queue,
            "UCPAdapter", "GenericShoppingAgent",
            "UCP", "←", "session_created",
            {
                "ucp_session_id": ucp_session.id,
                "status": ucp_session.status,
                "totals": totals,
            },
        )

        # ── AP2: CartMandate after product + totals are known ─────────────────
        session.cart_mandate = ap2.create_cart_mandate(
            product=session.selected_product,
            quantity=session.quantity,
            totals=totals,
            ucp_session_id=ucp_session.id,
            intent_mandate_id=session.intent_mandate.id,
        )
        await _pev(
            session.queue,
            "GenericShoppingAgent", "AP2Verifier",
            "AP2", "→", "cart_mandate_signed",
            {
                "id": session.cart_mandate.id,
                "checkout_hash": session.cart_mandate.credentialSubject["checkout_hash"][:12] + "...",
            },
        )

        await _emit(session.queue, "checkout_ready", {
            "session_id": session.session_id,
            "ucp_session_id": ucp_session.id,
            "product": {
                "id": session.selected_product["id"],
                "title": session.selected_product["title"],
                "price": session.selected_product["price"],
                "merchant": session.selected_product["merchant_name"],
                "variant": session.selected_variant,
            },
            "totals": totals,
            "use_acp": session.use_acp,
        })

        # ── Human pause 2: approve & pay ──────────────────────────────────────
        session.state = "payment_ready"
        await _emit(session.queue, "human_pause", {
            "pause_type": "approve_pay",
            "session_id": session.session_id,
        })

        try:
            await asyncio.wait_for(session.pause_event.wait(), timeout=300.0)
        except asyncio.TimeoutError:
            await _emit(session.queue, "error", {"message": "Session timed out — payment not confirmed."})
            return
        session.pause_event.clear()

        # ── Resolve payment credential ────────────────────────────────────────
        if session.use_acp:
            # Case 1: ACP SPT path — payment_method is an opaque PM reference
            raw_pm = session.resume_data.get("payment_method", "mock_pm_demo")
            session.payment_brand = session.resume_data.get("brand", "visa")
            session.payment_last4 = session.resume_data.get("last4", "0000")
            total_cents = int(round(totals["total"] * 100))

            await _pev(
                session.queue,
                "GenericShoppingAgent", "ACPAdapter",
                "ACP", "→", "POST /shared_payment/issued_tokens",
                {
                    "payment_method": f"pm_***{raw_pm[-4:]}",  # redact PM id
                    "network_business_profile": f"nbp_{session.selected_product['merchant_id']}",
                    "constraints": {
                        "currency": "USD",
                        "maximum_amount": total_cents,
                        "expiration": "now+15min",
                    },
                },
            )

            session.acp_token = acp.issue(
                payment_method=raw_pm,
                merchant_id=session.selected_product["merchant_id"],
                total_cents=total_cents,
                brand=session.payment_brand,
                last4=session.payment_last4,
            )

            await _pev(
                session.queue,
                "ACPAdapter", "GenericShoppingAgent",
                "ACP", "←", "token_issued",
                {
                    "id": session.acp_token.id,
                    "brand": session.acp_token.brand,
                    "last4": session.acp_token.last4,
                    "status": session.acp_token.status,
                    "maximum_amount_usd": round(session.acp_token.constraints.maximum_amount / 100, 2),
                },
            )

            ok, reason = acp.verify(
                session.acp_token.id,
                session.selected_product["merchant_id"],
                total_cents,
            )
            await _pev(
                session.queue,
                "GenericShoppingAgent", "ACPAdapter",
                "ACP", "↔", "token_verified",
                {"token_id": session.acp_token.id, "ok": ok, "reason": reason or "constraints_satisfied"},
            )

            if not ok:
                await _emit(session.queue, "error", {"message": f"ACP token verification failed: {reason}"})
                return

            payment_token = session.acp_token.id
        else:
            # Case 2: pre-registered demo instrument — use mock_token directly
            payment_token = session.resume_data.get("payment_token", "mock_card_4001")
            session.payment_brand = session.resume_data.get("brand", "Visa")
            session.payment_last4 = session.resume_data.get("last4", "4001")

        # ── AP2: PaymentMandate before UCP complete ───────────────────────────
        # Placeholder order_id — will be confirmed by UCP complete
        temp_order_id = f"pending_{uuid.uuid4().hex[:8]}"
        session.payment_mandate = ap2.create_payment_mandate(
            cart_mandate=session.cart_mandate,
            order_id=temp_order_id,
            payment_ref=payment_token,   # spt_xxx or mock_card_XXXX — no raw card
            user_id=session.user_id,
        )

        # Verify all three mandates
        for mandate, label in [
            (session.intent_mandate, "intent_mandate_verified"),
            (session.cart_mandate,   "cart_mandate_verified"),
            (session.payment_mandate,"payment_mandate_verified"),
        ]:
            ok = ap2.verify_mandate(mandate)
            await _pev(
                session.queue,
                "GenericShoppingAgent", "AP2Verifier",
                "AP2", "↔", label,
                {"id": mandate.id, "valid": ok, "type": mandate.type[-1]},
            )
            if not ok:
                await _emit(session.queue, "error", {"message": f"AP2 mandate verification failed: {label}"})
                return

        await _pev(
            session.queue,
            "GenericShoppingAgent", "AP2Verifier",
            "AP2", "→", "all_mandates_submitted",
            {
                "intent_mandate_id": session.intent_mandate.id,
                "cart_mandate_id": session.cart_mandate.id,
                "payment_mandate_id": session.payment_mandate.id,
            },
        )

        # ── UCP complete ──────────────────────────────────────────────────────
        await _pev(
            session.queue,
            "GenericShoppingAgent", "UCPAdapter",
            "UCP", "→", f"POST /checkout-sessions/{ucp_session.id}/complete",
            {"credential_type": "PAYMENT_GATEWAY", "token": f"{payment_token[:8]}..."},
        )

        complete = ucp.complete_session(
            session_id=ucp_session.id,
            token=payment_token,
            brand=session.payment_brand,
            last_digits=session.payment_last4,
        )

        await _pev(
            session.queue,
            "UCPAdapter", "GenericShoppingAgent",
            "UCP", "←", "order_created",
            {
                "order_id": complete.order.id,
                "status": complete.status,
                "label": complete.order.label,
            },
        )

        session.state = "complete"
        await _emit(session.queue, "order_complete", {
            "session_id": session.session_id,
            "order_id": complete.order.id,
            "order_label": complete.order.label,
            "order_url": complete.order.permalink_url,
            "totals": totals,
            "product": {
                "id": session.selected_product["id"],
                "title": session.selected_product["title"],
                "merchant": session.selected_product["merchant_name"],
            },
            "payment_display": {
                "brand": session.payment_brand,
                "last4": session.payment_last4,
                "token_type": "spt" if session.use_acp else "pre_registered",
            },
            "mandates": {
                "intent":  session.intent_mandate.id,
                "cart":    session.cart_mandate.id,
                "payment": session.payment_mandate.id,
            },
        })

    except Exception as exc:
        await _emit(session.queue, "error", {"message": str(exc)})
    finally:
        await session.queue.put(None)  # sentinel — SSE stream ends
