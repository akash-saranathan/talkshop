# Agentic Commerce POC — Build Status

## Agent Roster (locked)

| # | Name | Role |
|---|------|------|
| 1 | **VibeCheck** | Intent & Orchestration |
| 2 | **SneakPeek** | Product Discovery |
| 3 | **CartUp** | Checkout & Quoting |
| 4 | **GreenLight** | Consent & Authorization |
| 5 | **PayIt** | Payment Execution |
| 6 | **TrackIt** | Order & Audit |

---

## Phase 1 — Foundation & Core Infrastructure ✅

**Branch:** `phase-1/foundation`
**Status:** Complete — 6 commits
**Commits:**
| Hash | Description |
|------|-------------|
| `fac291a` | Project scaffold and directory structure |
| `674a8a4` | Agent config, SQLite schema, requirements.txt |
| `eec192f` | Pydantic models for all 5 core contracts |
| `988c9fb` | Seed data — 3 merchants, 45 products, mock wallet |
| `90c8e1b` | FastAPI skeleton with /api/merchants and /api/products |
| `ab0574c` | React + Vite frontend — 4 pages, router, Tailwind, Framer Motion |

### What was built

#### Project Scaffold
- Full directory structure: `backend/`, `frontend/`, `data/`, `observability/`
- Python virtual environment at `.venv/`
- `requirements.txt` covering all 5 phases

#### Backend
- `backend/config/agents.py` — agent name/ID constants for all 6 agents
- `backend/db/schema.py` — SQLite schema (8 tables: users, agents, merchants, products, orders, payment_authorizations, delegated_tokens, audit_events)
- `backend/db/init_db.py` — DB initializer + seeder
- `backend/models/` — Pydantic v2 models: ShoppingIntent, NormalizedProduct, CheckoutObject, DPATToken, PaymentRequest
- `backend/main.py` — FastAPI entrypoint with CORS, SSE channel, `/api/merchants`, `/api/products`, `/api/transcribe`
- `backend/routers/products.py`, `backend/routers/merchants.py`

#### Data
- `data/merchants.json` — 3 merchants (RunnerWorld, TechStore, FashionHub)
- `data/products.json` — 45 seeded products across 3 categories (shoes, electronics, accessories)
- `data/mock_wallet.json` — mock payment vault entry

#### Frontend
- React 18 + Vite + TypeScript + Tailwind CSS
- shadcn/ui initialized (Button, Card, Badge, Table, Dialog, Progress)
- Framer Motion installed
- Inter font via Google Fonts
- 4 page routes wired: Chat, Checkout, PaymentResult, Dashboard
- React Router DOM navigation
- Mic button (UI only — wired to `/api/transcribe` in Phase 2)

### Milestone checks
- [x] `uvicorn main:app` starts with no errors
- [x] `GET /api/merchants` returns 3 merchants
- [x] `GET /api/products` returns seeded products
- [x] React app loads all 4 pages without 404s
- [x] SQLite schema matches ER diagram
- [x] Mic button visible in chat input

---

## Phase 2 — Agentic Discovery via MCP ✅

**Branch:** `phase-2/agentic-discovery`
**Status:** Complete — 8 commits
**Commits:**
| Hash | Description |
|------|-------------|
| `29a9901` | LLM config (gemini-3.5-flash-lite) and 3 merchant adapters |
| `6774c6c` | FastMCP commerce server with 7 tools |
| `110961f` | NeMo Guardrails (Colang rails) and Guardrails AI validators |
| `c4024b7` | VibeCheck and SneakPeek agents |
| `5f73942` | LangGraph 7-node discovery workflow |
| `63d3a88` | SSE /api/chat/stream endpoint + main.py LLM startup check |
| `0ba9748` | Frontend SSE client, ProductCard component, Chat.tsx rewire |
| `2a27da2` | 23 passing tests + fix rank_products enumerate bug |

### What was built

#### LLM Layer
- `backend/config/llm.py` — `gemini-3.5-flash-lite` via `langchain-google-genai`; hard stop if `GOOGLE_API_KEY` absent

#### Merchant Adapters (3-tier)
- `backend/merchants/local.py` — SQLite Tier 1 (always on); `search_products()` + `get_product()`
- `backend/merchants/shopify.py` — Shopify Storefront GraphQL Tier 2; graceful `[]` fallback when no credentials
- `backend/merchants/bestbuy.py` — Best Buy Open API Tier 2 + Playwright Tier 3 fallback; both return `[]` on failure

#### MCP Commerce Server
- `backend/mcp/server.py` — FastMCP server with 7 tools: `search_products`, `get_product`, `check_inventory`, `get_price`, `calculate_shipping`, `create_checkout`, `get_order_status`
- Fan-out hits all 3 adapters in parallel; always falls back to local
- Agents receive `NormalizedProduct` dicts — raw merchant JSON never exposed to LLM

#### Guardrails
- `backend/guardrails/nemo/` — NeMo Guardrails: `commerce.co` Colang rails (credential exposure guard, scope guard), `config.yml` (LiteLLM + Gemini), `check_input()` async function
- `backend/guardrails/validators.py` — Guardrails AI + Pydantic fallback; `validate_shopping_intent()` catches hallucinated financial fields (e.g. price as string)

#### Agents
- `backend/agents/vibecheck.py` — Orchestrator (Agent 1): NeMo guard → Gemini LLM → Guardrails AI validation → `ShoppingIntent`; `generate_recommendation_text()` writes prose from factual data
- `backend/agents/sneakpeek.py` — Product Search (Agent 2): deterministic `filter_products()` and `rank_products()`; no LLM in this agent

#### LangGraph Workflow
- `backend/graph/workflow.py` — 7-node Phase 2 graph: `input_guardrail → extract_intent → mcp_product_search → normalize_products → deterministic_filter → rank_products → generate_recommendation → stream_to_ui`
- SSE events pushed to `asyncio.Queue` per session; `run_discovery()` is the entry point

#### API + Streaming
- `backend/routers/chat.py` — `GET /api/chat/stream?message=&session_id=`; streams LangGraph node events as SSE; 60s timeout guard
- `backend/main.py` — updated to include chat router + `resolve_llm()` on startup

#### Frontend
- `frontend/src/api/chat.ts` — `streamChat()` SSE client; typed callbacks for all event types
- `frontend/src/components/ProductCard.tsx` — Framer Motion animated card; merchant badge, rating, delivery, price, Select → `/checkout`
- `frontend/src/pages/Chat.tsx` — live SSE wired; animated step list; product card grid; recommendation text; blocked guardrail panel

### Milestone checks
- [x] User types "Find running shoes size 10 under $100"
- [x] System calls all 3 merchant adapters in parallel via MCP
- [x] Products normalized and constraint-filtered deterministically
- [x] Top recommendations shown with merchant badges and ranked scores
- [x] Agent progress shown step-by-step in chat
- [x] NeMo Guardrails blocks credential exposure attempts
- [x] No payment flow yet
- [x] 23 Phase 2 tests passing, 19 Phase 1 tests still passing (42 total)

---

## Phase 3 — Checkout, Consent & Payment Authorization 🔲

**Branch:** `phase-3/checkout-payment-auth`
**Status:** Not started

---

## Phase 4 — Payment Execution, Orders & Observability 🔲

**Branch:** `phase-4/execution-observability`
**Status:** Not started

---

## Phase 5 — Demo Polish, Failure Scenarios & Hardening 🔲

**Branch:** `phase-5/demo-polish`
**Status:** Not started
