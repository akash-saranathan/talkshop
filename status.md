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

#### MCP Commerce Server (`backend/mcp/server.py`)
FastMCP server — agents call these tools; tools return normalized data; raw merchant JSON never reaches the LLM.

| # | Tool | What it does |
|---|------|--------------|
| 1 | `search_products(query, category, brand, max_price, size)` | Fan-out to all 3 adapters in parallel; merges results; always falls back to local if external adapters fail |
| 2 | `get_product(product_id)` | Fetch a single product by ID from local DB |
| 3 | `check_inventory(product_id, size)` | Returns `available`, `inventory`, `delivery_days` |
| 4 | `get_price(product_id, size)` | Returns current price + currency for a product variant |
| 5 | `calculate_shipping(product_id, merchant_id, quantity)` | Free shipping ≥ $50 order, else $5.99 flat |
| 6 | `create_checkout(product_id, merchant_id, quantity)` | Builds `CheckoutObject` with subtotal/tax/shipping/total + SHA-256 `checkout_hash` |
| 7 | `get_order_status(order_id)` | Post-purchase status lookup (stub in Phase 2, full in Phase 4) |

#### Guardrails (2 layers active in Phase 2)

**Guardrail 1 — NeMo Guardrails (input/conversation safety)**
- `backend/guardrails/nemo/commerce.co` — Colang rails with 3 flows:
  - `credential guard` — blocks "give merchant my card number", "share my CVV", etc.
  - `scope guard` — blocks non-commerce requests ("tell me a joke", "write an essay")
  - `commerce request` — allows product search and shopping queries
- `backend/guardrails/nemo/config.yml` — LiteLLM + `gemini/gemini-3.5-flash-lite`
- `check_input()` — async; fails open (allows) if NeMo is unavailable

**Guardrail 4 — Guardrails AI (output schema validation)**
- `backend/guardrails/validators.py` — `validate_shopping_intent()` validates LLM JSON output against `ShoppingIntent` Pydantic schema
- Catches hallucinated financial fields before they enter the pipeline (e.g. `"max_price": "under a hundred"` → rejected)
- Falls back to raw Pydantic parse if Guardrails AI library is not installed

#### Agents

**VibeCheck — Agent 1 (Orchestrator) — USES LLM**
- `backend/agents/vibecheck.py`
- `extract_intent(user_message)` pipeline: NeMo input guard → Gemini LLM → Guardrails AI validation → `ShoppingIntent`
- System prompt enforces JSON-only output; numeric `max_price` ("under $100" → `100.0`); category normalisation
- `generate_recommendation_text(intent, products)` — LLM writes a 2–3 sentence explanation; all prices/ratings come from the product list, LLM cannot invent them

**SneakPeek — Agent 2 (Product Search) — NO LLM (by design)**
- `backend/agents/sneakpeek.py`
- `filter_products(products, intent)` — deterministic: drops out-of-stock, enforces price ceiling, size match, category match
- `rank_products(products, intent)` — deterministic scoring formula:
  ```
  score = budget_fit (20pts) + brand match (20pts) + size match (15pts)
        + preference keywords in title (10pts each)
        + delivery speed (10pts) + rating × 3 + review bonus (5–10pts)
        + free shipping bonus (3pts)
  ```
  rank_score is set here and frozen — LLM cannot alter it
- `search_and_rank(intent)` — calls MCP `search_products`, normalises, filters, ranks, returns top 5 + stats dict for SSE messages
- Why no LLM? Price, availability, and ranking are financial-adjacent data — deterministic code = auditable, tamper-proof, no hallucination risk

#### LangGraph Workflow (`backend/graph/workflow.py`)

7-node Phase 2 graph — each node emits SSE events the React UI renders as animated steps:

| Node | Type | What it does | SSE message |
|------|------|--------------|-------------|
| `input_guardrail` | NeMo | Runs `check_input()` on raw user message | "Checking request safety..." |
| `extract_intent` | LLM (VibeCheck) | Gemini extracts `ShoppingIntent` JSON | "Understanding your request..." |
| `mcp_product_search` | Deterministic | Calls MCP `search_products`, fan-out to 3 adapters | "Searching 3 merchant sources via MCP..." |
| `normalize_products` | Deterministic | Validates raw dicts → `NormalizedProduct` objects | "Normalized N products" |
| `deterministic_filter` | Deterministic | Price, size, stock, category filter | "Applying your constraints..." |
| `rank_products` | Deterministic | Scoring formula, sort descending | "Ranking by your preferences..." |
| `generate_recommendation` | LLM (VibeCheck) | Prose explanation from factual ranked results | "Generating personalized recommendation..." |
| `stream_to_ui` | — | Final `done` event with products + recommendation | "Search complete" |

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
