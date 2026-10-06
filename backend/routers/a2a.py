"""
A2A router — mounts Agent Card + message/send endpoints for all 6 merchant agents.

Real spec paths:
  GET  /a2a/{merchant}/.well-known/agent.json   → Agent Card
  POST /a2a/{merchant}                          → JSON-RPC 2.0 message/send
"""
import uuid
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from backend.a2a.models import A2ARequest, A2AResponse, ShoppingIntent
from backend.a2a.merchants.nike   import agent as nike_agent
from backend.a2a.merchants.adidas import agent as adidas_agent
from backend.a2a.merchants.zara   import agent as zara_agent
from backend.a2a.merchants.hm     import agent as hm_agent
from backend.a2a.merchants.fossil import agent as fossil_agent
from backend.a2a.merchants.casio  import agent as casio_agent

router = APIRouter(prefix="/a2a", tags=["a2a"])

AGENTS = {
    "nike":   nike_agent,
    "adidas": adidas_agent,
    "zara":   zara_agent,
    "hm":     hm_agent,
    "fossil": fossil_agent,
    "casio":  casio_agent,
}


def _get_agent(merchant: str):
    agent = AGENTS.get(merchant.lower())
    if not agent:
        raise HTTPException(status_code=404, detail=f"No agent registered for merchant '{merchant}'")
    return agent


# ── Agent Card ────────────────────────────────────────────────────────────────

@router.get("/{merchant}/.well-known/agent.json")
def agent_card(merchant: str):
    """Return the A2A Agent Card for a merchant — real spec path."""
    return _get_agent(merchant).agent_card()


# ── message/send ─────────────────────────────────────────────────────────────

@router.post("/{merchant}")
def message_send(merchant: str, request: A2ARequest) -> A2AResponse:
    """
    JSON-RPC 2.0 message/send endpoint.
    The Shopping Agent passes a ShoppingIntent extracted from the user message.
    The merchant agent searches its catalog and returns products as A2A artifacts.
    """
    if request.method != "message/send":
        return A2AResponse(
            jsonrpc="2.0",
            id=request.id,
            error={"code": -32601, "message": f"Method '{request.method}' not found"},
        )

    # Intent is passed in params.intent; fall back to empty intent if missing
    intent_data = request.params.get("intent", {})
    intent = ShoppingIntent(
        raw_query=intent_data.get("raw_query", ""),
        brand=intent_data.get("brand"),
        category=intent_data.get("category"),
        subcategory=intent_data.get("subcategory"),
        max_price=intent_data.get("max_price"),
        size=intent_data.get("size"),
        color=intent_data.get("color"),
        keywords=intent_data.get("keywords", []),
    )

    return _get_agent(merchant).handle_message(request, intent)
