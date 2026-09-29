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

## Phase 3 — Checkout, Consent & Payment Authorization ✅

**Branch:** `phase-3/checkout-payment-auth`
**Status:** Complete — 7 commits
**Commits:**
| Hash | Description |
|------|-------------|
| `dea9744` | Policy engine (rules) and HMAC-SHA256 signing |
| `d79eb80` | 12-check deterministic payment guardrail engine |
| `ff662ce` | CartUp (Agent 3) and GreenLight (Agent 4) |
| `64bc307` | DPAT authorization service (5 endpoints) + wire into main |
| `3fd98d2` | workflow docstring — Phase 3 runs via REST endpoints |
| `(pending)` | Checkout.tsx live countdown + PaymentResult.tsx real data |
| `(pending)` | 39 Phase 3 tests |

### What was built

#### Payment Policy Engine (`backend/payment/policy.py`)
Deterministic rules — no LLM. Single source of truth for all authorization decisions.
- `MAX_PURCHASE_AMOUNT = $500` — single-purchase ceiling
- `ALLOWED_CURRENCIES = {"USD"}` — scope guard
- `TOKEN_TTL_MINUTES = 15` — DPAT expiry
- `ALLOWED_MERCHANTS = {"MERCHANT_A", "MERCHANT_B", "MERCHANT_C"}` — merchant allowlist
- `evaluate_purchase(merchant_id, amount, currency)` → `PolicyResult(decision, reason_code, detail)`
  - Returns `ALLOW`, `DENY`, or `REQUIRE_STEP_UP`

#### HMAC-SHA256 Signing (`backend/payment/signing.py`)
Tamper-detection layer for authorization objects stored in DB.
- `sign_authorization(auth_data)` — canonical JSON (sorted keys, no whitespace) → HMAC-SHA256 hex digest
- `verify_authorization(auth_data, signature)` — `hmac.compare_digest` to prevent timing attacks
- Signature stored alongside auth record; verified by guardrail check before payment execution

#### 12-Check Guardrail Engine (`backend/payment/guardrail_engine.py`)
Deterministic Python — no LLM in any check. Stops at first failure.

| # | Check | Reason code on fail |
|---|-------|---------------------|
| 1 | Token exists | `TOKEN_NOT_FOUND` |
| 2 | Token status = active | `TOKEN_NOT_ACTIVE` |
| 3 | Token not expired | `AUTHORIZATION_EXPIRED` |
| 4 | Token not consumed | `TOKEN_ALREADY_CONSUMED` |
| 5 | Agent ID matches | `AGENT_NOT_AUTHORIZED` |
| 6 | Merchant ID matches | `MERCHANT_NOT_AUTHORIZED` |
| 7 | Order ID matches | `ORDER_MISMATCH` |
| 8 | Currency matches | `CURRENCY_MISMATCH` |
| 9 | Amount ≤ token max_amount | `AMOUNT_EXCEEDS_AUTHORIZED_LIMIT` |
| 10 | Amount = checkout total (±$0.01) | `AMOUNT_CHECKOUT_MISMATCH` |
| 11 | Checkout hash matches | `CHECKOUT_HASH_MISMATCH` |
| 12 | User consent record exists | `CONSENT_RECORD_MISSING` |

#### CartUp — Agent 3 (`backend/agents/cartup.py`) — NO LLM
Triggered after user selects a product. Calls MCP tools to produce a `CheckoutObject`.
- `build_checkout(product, quantity, user_id)` → `(CheckoutObject, error)`
- Calls MCP `check_inventory` → `get_price` → `calculate_shipping`
- Computes subtotal, tax (8.2%), shipping (free ≥ $50, else $5.99)
- Generates SHA-256 `checkout_hash` over canonicalized cart JSON — binds DPAT token to this exact cart; any tampering invalidates it

#### GreenLight — Agent 4 (`backend/agents/greenlight.py`) — NO LLM
Triggered only after confirmed user consent. Issues DPAT tokens.
- `request_dpat(checkout, user_id, consent_authorization_id)` → `(token_id, full_token_dict, error)`
- Runs `evaluate_purchase()` before issuing any token
- Creates `DPATToken` with 15-min TTL, single-use, HMAC-SHA256 signed
- Returns ONLY `token_id` to the agent — full auth object goes to DPAT service DB
- `summarize_authorization(token_id, checkout)` — deterministic template string for UI

#### DPAT Authorization Service (`backend/routers/authorizations.py`)
5 FastAPI endpoints — all deterministic, no LLM.

| Endpoint | What it does |
|----------|--------------|
| `POST /api/checkout/create` | CartUp builds `CheckoutObject` from selected product |
| `POST /api/authorizations/approve` | Records user consent (AuditEvent) + issues DPAT token; returns `{token_id, authorization_id, expires_at, summary}` |
| `POST /api/authorizations/validate` | HMAC verify + 12-check engine → `{passed, events, blocked_reason}` (used by PayIt in Phase 4) |
| `POST /api/authorizations/revoke` | Idempotent token revocation |
| `GET /api/audit/{order_id}` | Full chronological audit trail for an order |

Trust model: agent receives only `token_id`. Card credentials, max_amount, raw auth fields — none of these are ever returned to the agent.

#### Frontend — Checkout & Payment Result Pages

**`frontend/src/pages/Checkout.tsx`** — real Phase 3 flow
- Reads product from React Router state (`location.state.product`)
- On mount: `POST /api/checkout/create` → builds `CheckoutObject` with live pricing
- Authorization panel: shows what agent CAN'T see (card, CVV, credentials) vs. what the scoped token allows (merchant, max amount, single use, hash-bound)
- "Approve Purchase" button: `POST /api/authorizations/approve` → disabled after first click (prevents duplicate submission)
- Live countdown timer (`useCountdown` hook) — ticks every second after approval, shows MM:SS expiry
- Navigates to `/payment-result` with full result state after 1.2s

**`frontend/src/pages/PaymentResult.tsx`** — real result data
- Reads result from React Router state (`location.state`)
- Success state: shows order ID, DPAT token, amount, merchant, DPAT trust message
- Blocked state: shows guardrail reason code (used by Phase 4 PayIt)
- Fallback for direct navigation (no state)

#### Human-in-the-Loop Design
LangGraph interrupt was not used — the pause is modelled as page navigation:
```
Chat (discovery) → /checkout (user reviews + approves) → /payment-result
```
This avoids distributed state management across HTTP requests while delivering the same consent story. The approval is explicit, single-click, and non-revocable until the user navigates away.

### Milestone checks
- [x] User selects product → `/checkout` builds live order with real pricing from DB
- [x] Authorization panel shows trust boundary (what agent can/cannot see)
- [x] "Approve Purchase" calls `/api/authorizations/approve` — disabled after click
- [x] DPAT token issued with HMAC signature + 15-min TTL
- [x] Agent receives only `token_id` — full auth object stays in DB
- [x] Countdown timer starts ticking after approval
- [x] Payment result page shows real order/token data
- [x] Guardrail engine covers all 12 checks with distinct reason codes
- [x] `/api/authorizations/revoke` works and is idempotent
- [x] Audit trail records USER_APPROVED_PURCHASE + DPAT_CREATED events
- [x] 39 Phase 3 tests passing; 81 total (Phase 1 + 2 + 3) all green

---

## Phase 4 — Payment Execution, Orders & Observability ✅

**Branch:** `phase-4/execution-observability`
**Status:** Complete — 7 commits
**Commits:**
| Hash | Description |
|------|-------------|
| `c9826eb` | Mock payment processor + shared DB/token helpers |
| `1e767c7` | PayIt (Agent 5) and TrackIt (Agent 6) + OpenTelemetry tracing |
| `a3194bd` | Fix DPAT token scoping + signature verification |
| `238d14e` | Payment execution service (3 endpoints) + wire into main |
| `fc1e712` | Checkout.tsx real payment execution, Dashboard.tsx real orders |
| `fa73143` | 21 Phase 4 tests |
| `(pending)` | status.md milestone log |

### What was built

#### Bug fix: DPAT token scoping + signature verification

Two latent issues surfaced while wiring PayIt to the guardrail engine, both fixed as part of this phase (no test in Phase 3 exercised either path, so neither was caught until Phase 4's payment-execution flow actually ran end-to-end):

- `backend/agents/greenlight.py` — the DPAT token's `agent_id` was scoped to `GREENLIGHT.agent_id`, but guardrail check 5 requires the token to name the agent that *executes* payment. Fixed to `PAYIT.agent_id`.
- `backend/routers/authorizations.py` / `backend/payment/token_lookup.py` — `/api/authorizations/validate`'s token-signature reconstruction didn't match the fields GreenLight actually signed (different key set, plus a raw `datetime` that would crash `json.dumps`). Fixed by having `approve_authorization` compute a second, storage-scoped HMAC signature over exactly the string/float columns `PaymentAuthorization` persists — this reconstructs identically from DB rows with no serialization ambiguity. GreenLight's original in-memory signature (and its Phase 3 unit test) is untouched.

#### Mock Payment Processor (`backend/payment/mock_processor.py`)
Deterministic charge simulation against `data/mock_wallet.json` — no network, no randomness. Declines only on wallet conditions (`NO_ACTIVE_PAYMENT_METHOD`, `CARD_EXPIRED`), so tests stay reproducible. Success returns a `TXN_`-prefixed transaction ID.

#### PayIt — Agent 5 (`backend/agents/payit.py`) — NO LLM
Runs the existing 12-check guardrail engine (`backend/payment/guardrail_engine.py`, unchanged) before ever calling the processor. A guardrail failure returns a blocked reason with zero processor calls and zero token mutation; a guardrail pass calls the mock processor and returns its result (success or decline) — a processor decline is distinct from a guardrail block.

#### TrackIt — Agent 6 (`backend/agents/trackit.py`) — NO LLM
Pure field/string builders: `confirm_order()` / `record_incomplete_order()` produce the `Order` row fields for confirmed vs. blocked/declined outcomes; `summarize_order()` / `summarize_decline()` are deterministic UI copy templates (no LLM), mirroring GreenLight's `summarize_authorization`.

#### Payment Execution Service (`backend/routers/payments.py`)
| Endpoint | What it does |
|----------|--------------|
| `POST /api/payments/execute` | PayIt validates + charges; TrackIt records the `Order` row and audit trail; token is consumed on any guardrail-pass outcome (success or decline), untouched on guardrail block |
| `GET /api/orders` | Order list for the Dashboard — collapses to `paid`/`blocked` with the real block/decline reason pulled from the audit trail |
| `GET /api/orders/{order_id}` | Single order detail, 404 if unknown |

Order rows are inserted only on the first execute call for a given `order_id` (`_insert_order_if_absent`) — a later replay attempt (already blocked by the guardrail engine) can never overwrite a prior confirmed/declined outcome.

#### Shared helpers
- `backend/db/session_utils.py` — `get_session()`/`now_utc()`/`write_audit_event()`, extracted from `authorizations.py` so the new payments router uses identical DB/audit conventions.
- `backend/payment/token_lookup.py` — `load_token_context()`, shared by `/api/authorizations/validate` and `/api/payments/execute` so token/signature assembly never drifts between the two call sites.

#### Real order tracking (`backend/mcp/server.py`)
`get_order_status` replaced its Phase 2 stub with a real query against the `Order` table (`"not_found"` for unknown IDs).

#### Observability (`backend/observability/tracing.py`)
OpenTelemetry, scoped to the payment-execution path only (`payments.execute`, `payit.execute_payment`, the guardrail check, `mock_processor.process_payment`, `trackit.confirm_order`) — not all 6 agents, disproportionate for a POC. Soft-fail by design (unlike `resolve_llm()`'s hard stop): OTel's default global tracer is already a no-op, so tracing code runs identically whether or not an OTLP collector (e.g. Arize Phoenix at `localhost:6006`) is listening. `init_tracing()` never raises.

#### Frontend
- **`Checkout.tsx`** — `handleApprove()` now calls `POST /api/payments/execute` right after authorization succeeds, and navigates to `/payment-result` based on the *real* execution outcome instead of an optimistic 1.2s timeout. New "Processing Payment..." button state.
- **`Dashboard.tsx`** — replaced `MOCK_TRANSACTIONS` with a live `GET /api/orders` fetch.
- **`PaymentResult.tsx`** — unchanged; existing success/blocked state shapes already covered the real execution response.

### Milestone checks
- [x] Guardrail engine (12 checks) reused unchanged by PayIt — not reimplemented
- [x] Mock processor declines are deterministic (wallet-based), never random
- [x] A guardrail block never reaches the mock processor; a processor decline is distinct from a guardrail block
- [x] DPAT token is single-use — replaying a consumed token is blocked with `TOKEN_ALREADY_CONSUMED`
- [x] Tampered checkout data is blocked with `CHECKOUT_HASH_MISMATCH`
- [x] `Order` rows are never overwritten by a later blocked replay of the same order
- [x] `/payment-result` shows a real `transaction_id` from a live execution call, not an assumed success
- [x] `/dashboard` renders real orders from `GET /api/orders`
- [x] Audit trail includes `PAYMENT_EXECUTED` / `ORDER_CONFIRMED` (and blocked/declined variants)
- [x] App boots and payments execute successfully with no OTEL collector running
- [x] 21 Phase 4 tests passing; 102 total (Phase 1 + 2 + 3 + 4) all green

---

## Phase 5 — Demo Polish, Failure Scenarios & Hardening 🔲

**Branch:** `phase-5/demo-polish`
**Status:** Not started
