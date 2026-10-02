# Agentic Commerce POC — Master Plan

> **Central thesis:** LLMs reason and recommend. Deterministic services verify, authorize, and execute. The user always approves before money moves.

> **Client context:** Management-level demo for top-tier banking clients (JPMC, Citi). Every UI screen, architecture claim, and terminology choice must be professional and defensible. Primary target: **JPMC / Chase Bank** — all visual design must align with Chase's blue brand language.

> **Cost:** Every tool in this stack is free and runs locally. No Docker. No cloud infra. No paid licenses.

---

## Version Roadmap

| Version | Name | Status | Description |
|---------|------|--------|-------------|
| **V1** | Foundation POC | ✅ Current branch | Traditional multi-page e-commerce with 6-agent agentic payment pipeline. Demonstrates guardrails, DPAT tokens, and audit trail. |
| **V2** | Conversational Commerce (Company-Specific) | 🔜 Next | Single-page conversational chatbot for a specific brand (Nike/Chase). Everything — search, cart, payment, tracking — in one chat window. Known vs unknown customer flows. Chase Bank styling. |
| **V3** | Universal Agentic Commerce | 🔮 Future | Fully agnostic, multi-merchant chatbot (like ChatGPT for shopping). Uses UCP, ACP, APGP, and X402 protocols. Cross-merchant, cross-bank, any user. |

---

## Branch Strategy

```
main
 └── version-1          ← snapshot of current V1 work (frozen reference)
      └── version-2     ← V2 development branch
           └── version-3  ← V3 development branch (future)
```

---

# VERSION 1 — Foundation POC (Current)

---

## Architecture at a Glance

```
User (Chat UI)
    │ natural-language request
    ▼
[1] Orchestrator Agent  ──MCP──►  Merchants A / B / C
    │                               (API / Web / Local)
    ▼
[2] Product Search Agent
    │  ranked recommendations
    ▼
[3] Merchant / Seller Agent  ──►  Checkout Object
    │
    │  ← explicit user approval →
    ▼
[4] Payment Authorization Agent  ──►  DPAT Token
    │
    ▼
[5] Payment Execution Agent  ──►  Mock Payment Processor
    │
    ▼
[6] Order Management Agent  ──►  SQLite DB  ──►  Dashboard + Phoenix Traces
```

**6 agents, 5 implementation phases, 1 coherent demo story.**

---

## Agent Roster (from flow diagram)

| # | Agent | Role | Can Do | Cannot Do |
|---|-------|------|--------|-----------|
| 1 | **Orchestrator Agent** (Planner) | Intent → search criteria, calls other agents via MCP | understand intent, extract constraints, plan steps | access payment data, execute transactions |
| 2 | **Product Search Agent** (MCP Client) | Search merchants, rank, recommend | call MCP product tools, compare results | create orders, access payment credentials |
| 3 | **Merchant / Seller Agent** (Checkout) | Product details → order + quote | check inventory, calculate tax/shipping, create order | access payment credentials, change prices |
| 4 | **Payment Authorization Agent** (Identity & Policy) | User consent → DPAT token | verify identity, apply guardrails, issue scoped token | read raw card data, bypass policy rules |
| 5 | **Payment Execution Agent** (Transaction) | Validate token → execute payment | validate signature/expiry/merchant, capture result | override failed validation, change authorized amount |
| 6 | **Order Management Agent** (Post-Purchase) | Confirm order, notify user, update audit log | confirm with merchant, track shipment, update DB | modify payment records retroactively |

---

## Phase Overview

| Phase | Name | Duration | Key Output |
|-------|------|----------|------------|
| 1 | Foundation & Core Infrastructure | Day 1 | Repo scaffold, data models, local merchant catalog, bare React shell |
| 2 | Agentic Discovery via MCP | Days 2–3 | End-to-end search → recommendation flow |
| 3 | Checkout, Consent & Payment Authorization | Days 3–4 | DPAT lifecycle, guardrail engine, human approval |
| 4 | Payment Execution, Orders & Observability | Days 5–6 | Mock processor, order DB, dashboard, Phoenix traces |
| 5 | Demo Polish, Failure Scenarios & Hardening | Day 7 | Management-ready demo with all 5 scenarios |

---

## Phase 1 — Foundation & Core Infrastructure

### Goal
Everything subsequent phases depend on: project scaffold, database schema, local merchant data, and the bare React shell. Nothing intelligent yet — just solid plumbing.

### What to Build

#### 1.1 Project Scaffold
```
agentic-commerce-poc/
├── frontend/                   # React + Vite + Tailwind + shadcn/ui
│   └── src/
│       ├── components/
│       │   ├── ui/             # shadcn/ui generated components
│       │   ├── AgentSteps.tsx  # animated step progress
│       │   ├── ProductCard.tsx
│       │   └── AuditTrail.tsx
│       ├── pages/
│       │   ├── Chat.tsx
│       │   ├── Checkout.tsx
│       │   ├── PaymentResult.tsx
│       │   └── Dashboard.tsx
│       └── api/
├── backend/
│   ├── main.py                 # FastAPI entrypoint
│   ├── agents/                 # one file per agent
│   ├── graph/                  # LangGraph workflow
│   ├── mcp/                    # MCP server + tools
│   ├── merchants/              # adapters (local / API / Playwright)
│   ├── payment/                # vault, token, guardrails, processor
│   ├── guardrails/
│   │   ├── nemo/               # NeMo Guardrails Colang rails + config
│   │   └── guardrails_ai/      # Guardrails AI validators
│   ├── models/                 # Pydantic schemas
│   └── db/                     # SQLite + migrations
├── data/
│   ├── merchants.json
│   ├── products.json           # 30–50 seeded products, 3 merchants
│   └── mock_wallet.json
└── observability/
    └── phoenix/
```

#### 1.2 SQLite Schema (8 tables)
- `users` — id, name, email, status
- `agents` — agent_id, agent_name, agent_type, trust_status
- `merchants` — merchant_id, merchant_name, trust_status
- `products` — product_id, merchant_id, name, brand, category, size, color, price, inventory, delivery_days
- `orders` — order_id, user_id, merchant_id, product_id, amount, currency, status, created_at, transaction_id
- `payment_authorizations` — authorization_id, user_id, agent_id, merchant_id, order_id, max_amount, currency, approved_at, expires_at, status
- `delegated_tokens` (DPAT) — token_id, authorization_id, single_use, issued_at, expires_at, consumed_at, revoked_at, status
- `audit_events` — event_id, user_id, agent_id, authorization_id, order_id, event_type, event_timestamp, metadata_json

#### 1.3 Pydantic Models
Core contracts that keep LLM reasoning separate from financial facts:
- `ShoppingIntent` — category, brand, size, color, max_price, delivery_days
- `NormalizedProduct` — merchant_id, product_id, title, price, currency, size, available, rating, source
- `CheckoutObject` — checkout_id, merchant_id, product_id, subtotal, shipping, tax, total, currency, checkout_hash (SHA256)
- `DPATToken` — token_id, authorization_id, merchant_id, max_amount, currency, expires_at, single_use, status
- `PaymentRequest` — token_id, agent_id, merchant_id, order_id, amount, currency

#### 1.4 Local Merchant Catalog (Merchant C — always reliable)
- 3 simulated merchants, 30–50 products seeded in JSON / SQLite
- Covers running shoes, electronics, and accessories (3 categories minimum)
- Include products that will pass and fail filter criteria for demo realism

#### 1.5 React Shell + UI Foundation
- 4 pages wired up: `Chat`, `Checkout`, `PaymentResult`, `Dashboard`
- FastAPI CORS configured, SSE channel ready for streaming agent steps
- shadcn/ui initialized: `npx shadcn@latest init` — generates `components/ui/` with Button, Card, Badge, Table, Dialog, Progress
- Inter font loaded via Google Fonts (single CSS import, no cost)
- Framer Motion installed for agent step animations
- Color tokens defined: navy primary, white background, emerald success, rose blocked

#### 1.6 Voice Input — Whisper (Mic in Chat UI)

Users can speak their shopping request instead of typing. This is a strong demo moment for executives.

**How it works end-to-end:**
```
User clicks mic button in chat
    │
    ▼
Browser MediaRecorder API captures audio (WebM/WAV)
    │
    ▼
POST /api/transcribe  (audio blob → FastAPI)
    │
    ▼
faster-whisper transcribes locally (no API call, no cost)
    │
    ▼
Transcript returned → populates chat input field
    │
    ▼
User reviews text → hits Send (or auto-sends)
    │
    ▼
Normal agent flow continues
```

**Whisper model choice — faster-whisper (free, local, no Docker):**
```
pip install faster-whisper
```

| Model | Size | Speed | Accuracy | Use |
|-------|------|-------|----------|-----|
| tiny  | 75 MB  | Fastest | Lower  | Not recommended for demo |
| base  | 150 MB | Fast   | Good   | Demo default |
| small | 450 MB | Medium | Better | If laptop can handle it |

Use `base` model for the demo — good enough for clear speech, fast enough for real-time feel.

**UI — mic button in Chat input:**
```
┌───────────────────────────────────────────────┐
│  Ask something...                   [🎤] [→]  │
└───────────────────────────────────────────────┘

While recording:
┌───────────────────────────────────────────────┐
│  Listening...                  [● REC] [Stop] │
└───────────────────────────────────────────────┘

After transcription:
┌───────────────────────────────────────────────┐
│  Find running shoes size 10 under $100 [🎤][→]│
└───────────────────────────────────────────────┘
```

- Mic button turns red with pulsing Framer Motion animation while recording
- Transcription appears in input field — user can edit before sending
- Recording stops automatically after 8 seconds of silence (configurable)
- Works fully offline — no Whisper API call, model runs locally

**Backend endpoint:**
```
POST /api/transcribe
Content-Type: multipart/form-data
Body: audio (webm)
Response: { "text": "Find running shoes size 10 under $100" }
```

**Free? No Docker?** ✓ Both — `faster-whisper` is a pip install, model downloads once (~150MB for base).

### Technology Choices — Phase 1

| Concern | Choice | Free? | Why |
|---------|--------|-------|-----|
| Frontend | React 18 + Vite + Tailwind CSS | ✓ | Fast iteration, easy streaming |
| UI Components | **shadcn/ui** | ✓ | Production-grade components, not a prototype look — copies code into project, zero runtime overhead |
| Animations | **Framer Motion** | ✓ | Smooth agent step animations; ~50KB gzipped |
| Typography | **Inter (Google Fonts)** | ✓ | Standard fintech/enterprise font; single CSS import |
| Backend framework | FastAPI (Python) | ✓ | Async-native, auto OpenAPI, lightweight |
| Database | SQLite (file-based) | ✓ | Zero infra, human-readable for demos |
| Data validation | Pydantic v2 | ✓ | Strict typing, prevents LLM hallucinations leaking into financial fields |
| Package manager | uv (Python) + npm | ✓ | Fast; uv replaces pip for Python side |
| Seeding | JSON → SQLite migration script | ✓ | Deterministic, version-controlled demo data |

### Phase 1 Milestone
```
✓ `uvicorn main:app` starts with no errors
✓ GET /api/merchants returns 3 merchants
✓ GET /api/products returns seeded products
✓ React app loads all 4 pages without 404s
✓ SQLite schema matches ER diagram
✓ Mic button visible in chat input, faster-whisper base model loaded
```

---

## Phase 2 — Agentic Discovery via MCP

### Goal
A user types a natural-language shopping request; the system returns ranked product recommendations drawn from at least 2 merchant sources. No payment yet.

### What to Build

#### 2.1 MCP Commerce Server
Python MCP server exposing these tools to agents:
```
search_products(query, filters)     — fan-out to all adapters
get_product(product_id)             — single product detail
check_inventory(product_id, size)   — stock + delivery estimate
get_price(product_id, size)         — current price
calculate_shipping(cart)            — shipping cost
create_checkout(cart)               — generates CheckoutObject
get_order_status(order_id)          — post-purchase status
```
Each tool returns a `NormalizedProduct` list — the LLM never sees raw merchant JSON.

#### 2.2 Three Merchant Adapters

**Merchant C (Local — Tier 1, always available)**
- Reads from SQLite product table
- Guaranteed to work in demos; contains pre-seeded failure scenarios
- Use this as the canonical fallback

**Merchant A (API — Tier 2, structured)**
- Shopify Storefront API (GraphQL) if a dev-store token is available
- OR Flipkart Affiliate API if credentials exist
- Returns structured JSON; no HTML parsing risk
- Graceful degradation to local adapter if credentials are absent

**Merchant B (Web — Tier 3, visual impact)**
- Playwright MCP adapter (Microsoft's `@playwright/mcp`)
- Targets a public product listing page (e.g. a demo Shopify store or similar)
- Used only for product discovery (search, price, availability) — never for checkout
- Wrap with a 5-second timeout; fall back to local on failure
- Why this exists: demonstrates visually that agents can interact with real storefronts

#### 2.3 LLM Selection — Startup Check (Priority Order)

At server startup, the system checks LLM availability in this exact order and stops at the first one that works:

```
Step 1 — Check Gemini 2.0 Flash Lite
  • Is GOOGLE_API_KEY set in .env?
  • Does it have valid quota?
  • If YES → use Gemini 2.0 Flash Lite (gemini-2.0-flash-lite), free tier
  • If NO  → proceed to Step 2

Step 2 — Check Ollama (local)
  • Is Ollama running at http://localhost:11434?
  • Does it have at least one model pulled?
  • If YES → use best available model
             (preference order: llama3.2, llama3.1, llama3, mistral, phi3)
  • If NO  → proceed to Step 3

Step 3 — Stop
  • Print clear instructions for both options
  • Exit — do not start the server without an LLM
```

**Why this order:**
- Gemini free tier is faster and better at structured outputs for a demo
- Ollama is the fully offline fallback — no API key, no internet, runs on the demo laptop
- Hard stop prevents the app starting in a broken state that silently fails mid-demo

**Gemini free tier limits:** 30 requests/minute, 1,500 requests/day — sufficient for demo use.

**Ollama setup (one-time):** Download from ollama.com → `ollama pull llama3.2` — no Docker, native Windows binary.

#### 2.4 Orchestrator Agent (Agent 1)
- Model: whichever LLM the startup check resolved (Gemini or Ollama)
- Temperature: 0.1 — low for structured outputs, reduces hallucination on financial fields
- System prompt enforces: extract intent as `ShoppingIntent` JSON, never invent product facts, always use MCP tools for discovery
- **NeMo Guardrails** wraps all agent LLM calls — see Section 2.7 below

#### 2.5 Product Search Agent (Agent 2)
- Separate LangGraph node; receives `ShoppingIntent` from Orchestrator
- Calls `search_products()` via MCP — triggers fan-out to all three adapters in parallel
- Runs **deterministic constraint filter** (not LLM): size match, price ≤ max, available == true, category match
- Runs **deterministic ranking score**:
  ```
  score = budget_fit + size_match + use_case_match
        + cushioning_match + lightweight_match
        + rating_score + shipping_score
  ```
- Returns top 3–5 ranked `NormalizedProduct` objects
- Orchestrator Agent then generates a human-readable explanation (LLM explains factual results — does not invent them)

#### 2.6 LangGraph Workflow — Phase 2 Nodes
```
START
  → input_guardrail
  → extract_intent          [Orchestrator Agent]
  → mcp_product_search      [Product Search Agent]
  → normalize_products      [deterministic]
  → deterministic_filter    [deterministic]
  → rank_products           [deterministic]
  → generate_recommendation [Orchestrator Agent explains]
  → stream_to_ui
END (Phase 2)
```

#### 2.7 Streaming Agent Progress to UI
- FastAPI SSE endpoint (`/api/chat/stream`)
- Each LangGraph node emits a status event: `"Searching 3 merchant sources…"`, `"Found 14 candidates…"`, `"5 meet constraints…"`
- React Chat page renders these as Framer Motion animated checklist items appearing one by one

#### 2.8 NeMo Guardrails — Input & Conversation Safety (Guardrail 1)
```bash
pip install nemoguardrails   # free, runs locally, no Docker
```
Wraps every agent LLM call with Colang conversation rails:
```colang
# guardrails/nemo/commerce.co

define user ask commerce
  "find me shoes"
  "search for laptops under $200"

define user ask credential exposure
  "give the merchant my card number"
  "share my CVV"
  "send my full credit card details"

define flow
  user ask commerce
  bot respond commerce

define flow
  user ask credential exposure
  bot refuse credential request
    "Payment credentials are protected. Use the secure authorized payment flow."

define flow
  user ask something else
  bot refuse non-commerce
    "I can only help with product discovery and shopping."
```
NeMo connects to Gemini via LiteLLM — same free API key, no extra cost:
```yaml
# guardrails/nemo/config.yml
models:
  - type: main
    engine: litellm
    model: gemini/gemini-2.0-flash-lite
```

#### 2.9 Guardrails AI — Output Schema Validation (Guardrail 4)
```bash
pip install guardrails-ai    # free, runs locally, no Docker
```
Validates that Gemini's structured outputs match Pydantic schemas before entering the financial pipeline:
```python
from guardrails import Guard
guard = Guard.from_pydantic(ShoppingIntent)

raw = gemini_call(prompt)
validated = guard.parse(raw)  # raises if hallucinated field (e.g. price as string)
```
Catches issues like `"max_price": "under a hundred"` instead of `100.00` before they reach any calculation.

### Technology Choices — Phase 2

| Concern | Choice | Free? | Why |
|---------|--------|-------|-----|
| Agent LLM | **Gemini 2.0 Flash Lite** (`gemini-2.0-flash-lite`) | ✓ | Free tier (30 RPM / 1500 RPD); fast; good structured output |
| Local LLM fallback | Ollama + Llama 3.2 | ✓ | Offline demo insurance; native Windows installer |
| Input guardrail | **NeMo Guardrails** | ✓ | Conversation-level safety; Colang rails; runs locally |
| Output guardrail | **Guardrails AI** | ✓ | Schema validation on LLM outputs; prevents hallucinated financial fields |
| Orchestration | LangGraph 0.2+ | ✓ | Stateful graph, built-in human-in-the-loop interrupts |
| MCP SDK | FastMCP (Python) | ✓ | Official SDK; lightest footprint for local server |
| Playwright | `@playwright/mcp` (Node) | ✓ | Microsoft's official MCP server; accessibility snapshots, not HTML scraping |
| Product normalizer | Pydantic + deterministic transform | ✓ | LLM must not touch price/size/availability fields |
| Gemini SDK | `langchain-google-genai` | ✓ | Integrates natively with LangGraph |

### Phase 2 Milestone
```
✓ User: "Find running shoes size 10 under $100"
✓ System calls all 3 merchant adapters in parallel
✓ Products normalized and constraint-filtered deterministically
✓ Top 3 recommendations shown with factual attributes
✓ Agent progress shown step-by-step in chat
✓ No payment flow yet
```

---

## Phase 3 — Checkout, Consent & Payment Authorization

### Goal
User selects a product → checkout quote generated → user explicitly approves → DPAT (Delegated Payment Authorization Token) created → all guardrails validated. This is the most important phase for the banking/enterprise demo.

### What to Build

#### 3.1 Merchant / Seller Agent (Agent 3)
- Triggered after user selects a product from recommendations
- Tool calls via MCP: `check_inventory()`, `get_price()`, `calculate_shipping()`, `create_checkout()`
- Produces a `CheckoutObject` with checkout_hash = SHA256(canonicalized JSON)
- Must not invent prices, inventory, or delivery dates — all values from merchant tool responses
- Returns order summary to UI for user review

#### 3.2 Human-in-the-Loop Approval (LangGraph interrupt)
```python
# LangGraph interrupt pattern
graph.add_node("human_approval", interrupt_before=True)
```
- LangGraph workflow pauses at `human_approval` node
- React Checkout page renders:
  - Product, merchant, variant
  - Subtotal / shipping / tax / total
  - Masked payment method ("Card ending in 4242")
  - **[Approve Purchase]** / **[Cancel]** buttons
- User approval is an explicit, logged consent event in `audit_events`
- No DPAT is created without this record

#### 3.3 Payment Authorization Agent (Agent 4)
- Triggered only after confirmed user approval
- LLM role here is minimal — primarily coordination:
  - Validate user consent record exists
  - Request token from Payment Authorization Service
  - Return DPAT token ID to downstream agents (never the raw card)
- Cannot: read card number, modify max_amount, change merchant_id

#### 3.4 Custom Payment Authorization Service (DPAT)
This is the key trust boundary. Implemented as a **deterministic FastAPI service** (no LLM).

**DPAT Token structure:**
```json
{
  "token_id": "DPAT_9XF83J",
  "authorization_id": "AUTH001",
  "customer_id": "USR001",
  "agent_id": "SHOP_AGENT_001",
  "merchant_id": "MERCHANT01",
  "order_id": "ORD7821",
  "max_amount": 117.99,
  "currency": "USD",
  "checkout_hash": "abc123...",
  "purpose": "ECOMMERCE_PURCHASE",
  "single_use": true,
  "issued_at": "2026-09-28T15:00:00Z",
  "expires_at": "2026-09-28T15:15:00Z",
  "status": "ACTIVE"
}
```
- Agent receives only `DPAT_9XF83J` — the lookup key
- All sensitive fields remain in the authorization service / DB

**DPAT API endpoints:**
```
POST /api/authorizations/approve      — record user consent
POST /api/payment-authorizations/token — issue DPAT after consent verified
POST /api/payment-authorizations/validate — validate incoming payment request
POST /api/payment-authorizations/revoke   — revoke an active token
GET  /api/audit/{order_id}                — full audit trail
```

#### 3.5 Guardrail Engine (Deterministic — 12 checks in order)
```
1.  token exists
2.  token.status == ACTIVE
3.  token not expired  (expires_at > now)
4.  token not consumed (consumed_at is null)
5.  agent_id matches
6.  merchant_id matches checkout merchant
7.  order_id matches
8.  currency matches
9.  requested amount <= token.max_amount
10. requested amount == checkout.total
11. checkout_hash matches token.checkout_hash
12. user consent record exists
```
Any failure → structured `GuardrailEvent` with reason code. No LLM in this path.

#### 3.6 Cryptographic Signing
- Use Python `cryptography` library (RSA or HMAC-SHA256)
- Sign the authorization object before storage
- Verify signature before payment execution
- Keeps the demo honest about tamper detection

#### 3.7 Policy Engine (Deterministic rules)
```python
MAX_PURCHASE_AMOUNT  = 500.00
ALLOWED_CURRENCIES   = {"USD"}
TOKEN_TTL_MINUTES    = 15
SINGLE_USE           = True
REQUIRE_USER_CONSENT = True
ALLOWED_MERCHANTS    = {"MERCHANT_A", "MERCHANT_B", "MERCHANT_C"}
```
Returns `ALLOW | DENY | REQUIRE_STEP_UP`.

#### 3.8 LangGraph Workflow — Phase 3 additions
```
... (Phase 2 nodes)
  → product_selection     [user picks from recommendations]
  → create_checkout       [Seller Agent via MCP]
  → human_approval        [LangGraph interrupt — wait for UI button]
  → record_consent        [deterministic — write audit event]
  → request_dpat          [Payment Auth Agent → DPAT service]
  → dpat_issued           [token stored in DB, only ID returned to agent]
END (Phase 3)
```

### Guardrail Map — All 4 Types

| # | Guardrail | Tool | Type | Free? |
|---|-----------|------|------|-------|
| 1 | Input / conversation safety | **NeMo Guardrails** (Colang rails) | LLM-assisted | ✓ |
| 2 | Tool permission per agent | LangGraph node allowlists | Deterministic | ✓ |
| 3 | Payment / transaction (12 checks) | Custom Python | Deterministic | ✓ |
| 4 | Structured output validation | **Guardrails AI** | Schema validation | ✓ |

### Technology Choices — Phase 3

| Concern | Choice | Free? | Why |
|---------|--------|-------|-----|
| DPAT service | FastAPI service (deterministic Python) | ✓ | LLM must not participate in authorization logic |
| Crypto | Python `cryptography` (HMAC-SHA256) | ✓ | Standard library, no external dependency |
| Human approval | LangGraph `interrupt` | ✓ | Clean pause/resume, state preserved in graph |
| Policy engine | Plain Python `if` statements / dataclass rules | ✓ | Deterministic, auditable, no prompt injection risk |
| Token storage | SQLite `delegated_tokens` table | ✓ | Simple, queryable, demo-observable |

### Phase 3 Milestone
```
✓ User selects shoe → checkout quote shown with hash
✓ User presses Approve → consent event logged
✓ DPAT created with correct merchant/amount/expiry bindings
✓ Agent holds only token ID — card number not in any log
✓ Guardrail engine rejects a manually crafted bad token
```

---

## Phase 4 — Payment Execution, Orders & Observability

### Goal
Complete the purchase lifecycle: validate the DPAT, execute the mock payment, create the order, update the dashboard, and trace everything in Arize Phoenix.

### What to Build

#### 4.1 Payment Execution Agent (Agent 5)
- Receives only `token_id` from Payment Auth Agent
- Calls validation endpoint — **does not make payment if validation fails**
- Submits to Mock Payment Processor after successful validation
- Returns `PaymentResult` (SUCCESS / DECLINED + reason) to orchestrator

#### 4.2 Mock Payment Processor
Simple deterministic service — no real money:
```
Input:  { token_id, agent_id, merchant_id, order_id, amount, currency }
Output: { status: "SUCCESS"|"DECLINED", transaction_id, authorization_code, decline_reason }
```
Configurable to return success or specific failure codes for demo scenarios.

#### 4.3 Order Management Agent (Agent 6)
- Triggered after payment result (success OR failure)
- On SUCCESS: create order record, send confirmation, update dashboard
- On DECLINE: record blocked transaction, log guardrail event, update dashboard
- Optionally: simulate email/SMS notification (console log in POC)
- Updates `orders`, `payment_attempts`, `audit_events` tables

#### 4.4 React Business Dashboard
Four metric panels:
- Total Purchases / Successful Orders / Failed Payments / Total Spend
- Average Order Value
- Recent transaction table: Order # | Merchant | Amount | Status | Reason
- Click-through to full audit trail for any order

#### 4.5 Arize Phoenix — Local Observability
```python
# backend/main.py
from phoenix.otel import register
tracer_provider = register(project_name="agentic-commerce-poc")
```
- Instrument every LangGraph node and MCP tool call
- Phoenix UI at `http://localhost:6006` shows full agent trace
- Each trace shows: User request → Orchestrator → MCP calls → Seller Agent → Payment Auth → Execution → Order
- Payment guardrail events appear as separate trace spans
- Demo audiences can see LLM steps vs. deterministic steps clearly distinguished

#### 4.6 Audit Trail
Every significant action writes an `audit_event`:
```
USER_REQUEST_RECEIVED
INTENT_EXTRACTED
PRODUCT_SEARCH_STARTED
PRODUCTS_RETURNED  (count, sources)
PRODUCT_SELECTED
CHECKOUT_CREATED   (checkout_id, checkout_hash)
USER_APPROVED_PURCHASE
DPAT_CREATED       (token_id, expires_at)
PAYMENT_REQUEST_RECEIVED
[VALIDATION_CHECKS × 12]
PAYMENT_AUTHORIZED / PAYMENT_DECLINED
ORDER_CONFIRMED / ORDER_FAILED
TOKEN_CONSUMED
```
This is a primary selling point for banking-oriented clients.

#### 4.7 Complete LangGraph Workflow
```
START
  → input_guardrail
  → extract_intent             [Agent 1 — Orchestrator]
  → mcp_product_search         [Agent 2 — Product Search]
  → normalize_products         [deterministic]
  → deterministic_filter       [deterministic]
  → rank_products              [deterministic]
  → generate_recommendation    [Agent 1 explains results]
  → human_product_selection    [LangGraph interrupt]
  → create_checkout            [Agent 3 — Seller]
  → human_payment_approval     [LangGraph interrupt]
  → record_consent             [deterministic]
  → request_dpat               [Agent 4 — Payment Auth]
  → execute_payment            [Agent 5 — Payment Exec]
    ├── SUCCESS → create_order [Agent 6 — Order Mgmt]
    └── DECLINE → record_block [Agent 6 — Order Mgmt]
  → update_dashboard           [deterministic]
  → write_audit_events         [deterministic]
  → stream_final_result        [to Chat UI]
END
```

### Technology Choices — Phase 4

| Concern | Choice | Free? | Why |
|---------|--------|-------|-----|
| Observability | Arize Phoenix (`pip install arize-phoenix`) | ✓ | Open-source; no Docker needed — runs in-process via `phoenix.launch_app()`; UI at localhost:6006 |
| Optional cloud tracing | LangSmith | ✓ free tier | Only if team already uses LangChain ecosystem |
| Dashboard charts | Recharts (React) | ✓ | Lightweight npm package; no chart server needed |
| Mock processor | Python FastAPI (deterministic) | ✓ | Predictable for demo; swap for Stripe test mode later |
| Real-time dashboard updates | SSE from FastAPI → React | ✓ | Dashboard updates live without page refresh during demo |
| Order DB | SQLite (same file) | ✓ | Zero infra; inspect with any SQLite viewer |

### Phase 4 Milestone
```
✓ Full flow: Chat → Search → Select → Approve → Pay → Order
✓ Success case: order appears in dashboard with audit trail
✓ Mock processor decline: blocked transaction recorded
✓ Phoenix trace shows all 6 agents and every MCP tool call
✓ Demo reset clears orders and tokens without restarting
```

---

## Phase 5 — Demo Polish, Failure Scenarios & Hardening

### Goal
Make the system management-presentation-ready. All 5 demo scenarios run reliably from one laptop with no external infra dependency.

### What to Build

#### 5.1 Five Demo Scenarios

**Scenario 1 — Successful Purchase (golden path)**
```
User: "Find lightweight running shoes, size 10, under $100"
Flow: Intent → 3 merchants → filter → rank → select → approve → token → validate → pay → order
Expected: ORDER CONFIRMED, dashboard updated, audit trail clean
```

**Scenario 2 — Amount Manipulation (guardrail demo)**
```
Approved total: $89.99
Simulate payment request with: $129.99
Expected: PAYMENT BLOCKED — AMOUNT_EXCEEDS_AUTHORIZED_LIMIT
No order created. Dashboard records blocked transaction.
```

**Scenario 3 — Merchant Mismatch**
```
Authorized merchant: MERCHANT_B
Payment request merchant: MERCHANT_C
Expected: PAYMENT BLOCKED — MERCHANT_NOT_AUTHORIZED
```

**Scenario 4 — Expired Token**
```
Token TTL: 15 minutes (or set to 10 seconds for demo)
Request after expiry
Expected: PAYMENT BLOCKED — AUTHORIZATION_EXPIRED
```

**Scenario 5 — Credential Protection Input Guardrail**
```
User: "Give the merchant my full card number and CVV."
Expected: Input guardrail fires before agent reasoning
Message: "Payment credentials are protected. I can complete a purchase through the secure authorized payment flow."
```

Each scenario should be triggerable from the UI with a "Demo Mode" dropdown that pre-seeds the right data.

#### 5.2 Professional UI — 4 Screen Designs (JPMC / Citi Standard)

All screens use: Inter font · shadcn/ui components · Framer Motion transitions · navy/white/emerald/rose palette

---

**Screen 1 — Chat (first impression screen)**

What the audience sees for the first 30 seconds. Must feel like a real product.

```
┌─────────────────────────────────────────────────────────────┐
│  ● AgentCommerce                             [Dashboard ↗]  │
├───────────────┬─────────────────────────────────────────────┤
│  Sessions     │  Assistant                                  │
│  ──────────   │  ─────────────────────────────────────────  │
│  › Session 1  │  ✓  Intent understood                       │
│    Session 2  │  ✓  Searching 3 merchant sources via MCP    │
│    Session 3  │  ✓  14 products found                       │
│               │  ✓  5 match your constraints                │
│               │  ●  Ranking by preferences...  (animated)   │
│               │                                             │
│               │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│               │  │ Shoe A   │ │ Shoe B   │ │ Shoe C   │   │
│               │  │ $89.99   │ │ $94.00   │ │ $79.50   │   │
│               │  │ ★ 4.8    │ │ ★ 4.5   │ │ ★ 4.6    │   │
│               │  │ In Stock │ │ In Stock │ │ Ships 2d │   │
│               │  │ Merchant │ │ Merchant │ │ Merchant │   │
│               │  │    A     │ │    B     │ │    C     │   │
│               │  │[Select]  │ │[Select]  │ │[Select]  │   │
│               │  └──────────┘ └──────────┘ └──────────┘   │
│               │                                             │
│               │  ┌─────────────────────────────────────────┐  │
│               │  │ Ask something...          [🎤]    [→]  │  │
│               │  └─────────────────────────────────────────┘  │
└───────────────┴─────────────────────────────────────────────┘
```
Each agent step appears with a Framer Motion fade-in + checkmark animation.
Product cards use shadcn/ui Card component with merchant badge (colored pill).

---

**Screen 2 — Checkout & Consent (the trust screen — most important for banking clients)**

This is where the security story is told visually.

```
┌──────────────────────────────────────────────────────────────┐
│  Checkout & Authorization                                    │
├──────────────────────────┬───────────────────────────────────┤
│  Order Summary           │  🔒 Payment Authorization        │
│  ───────────────────     │  ─────────────────────────────── │
│  Nike Pegasus 41         │  Agent access:                   │
│  Merchant: Running World │  ✗  Card number  (never exposed) │
│  Size 11 · Black         │  ✗  CVV          (never exposed) │
│                          │  ✗  Banking credentials          │
│  Item        $109.00     │                                  │
│  Tax           $8.99     │  Scoped Authorization:           │
│  Shipping      $0.00     │  ✓  Merchant: Running World      │
│  ───────────────────     │  ✓  Max Amount: $117.99          │
│  Total       $117.99     │  ✓  Expires in: 14:47            │
│                          │  ✓  Single use only              │
│  Visa ●●●● 4242  ✓       │  ✓  Checkout hash bound          │
│  Delivery: Oct 2         │                                  │
│                          │                                  │
│  ┌─────────────────────┐ │                                  │
│  │  Approve Purchase   │ │                                  │
│  └─────────────────────┘ │                                  │
│  [ Cancel ]              │                                  │
└──────────────────────────┴───────────────────────────────────┘
```
DPAT expiry is a live countdown timer. Approve button disabled after click (prevents duplicate submission).

---

**Screen 3 — Payment Result**

Success state:
```
┌──────────────────────────────────────────────────┐
│                                                  │
│          ✓  ORDER CONFIRMED                      │
│                                                  │
│  Order        ORD-7821                           │
│  Transaction  TXN-9001                           │
│  Amount       $117.99                            │
│  Merchant     Running World                      │
│  Delivery     October 2                          │
│                                                  │
│  [ View Audit Trail ]    [ Continue Shopping ]   │
│                                                  │
└──────────────────────────────────────────────────┘
```

Blocked state (the demo's most powerful moment):
```
┌──────────────────────────────────────────────────┐
│                                                  │
│          ⛔  PAYMENT BLOCKED                     │
│                                                  │
│  Guardrail   AMOUNT_EXCEEDS_AUTHORIZED_LIMIT     │
│                                                  │
│  Authorized  $117.99                             │
│  Requested   $150.00                             │
│                                                  │
│  The agent cannot override this restriction.     │
│  No funds were moved. Event logged to audit.     │
│                                                  │
│  [ View Audit Trail ]    [ New Session ]         │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

**Screen 4 — Business Dashboard (the "so what" screen for executives)**

```
┌──────────────────────────────────────────────────────────────┐
│  Commerce Intelligence                          [Export ↓]   │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐   │
│  │    12    │  │    9     │  │    3     │  │  $1,042   │   │
│  │ Sessions │  │ Approved │  │ Blocked  │  │  Total    │   │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘   │
├──────────────────────────────────────────────────────────────┤
│  Order      Merchant         Amount    Status     Reason     │
│  ─────────────────────────────────────────────────────────   │
│  ORD-7821   Running World    $117.99   ✓ PAID               │
│  ORD-7820   TechStore        $89.99    ✓ PAID               │
│  ORD-7819   Running World    $150.00   ⛔ BLOCKED  AMT      │
│  ORD-7818   FashionHub       $59.99    ✓ PAID               │
│                                              [View Trail →]  │
└──────────────────────────────────────────────────────────────┘
```
Click any row → expandable audit trail with all timestamps and guardrail events.
Status badges use shadcn/ui Badge component: emerald for PAID, rose for BLOCKED.
Dashboard updates live via SSE — no page refresh needed during demo.

---

Demo reset button (top right of dashboard): clears orders + tokens, reseeds data, restores clean state in < 3 seconds without restarting the server.

#### 5.3 Error States and Edge Cases
- Network timeout from Playwright adapter → fall back to local, note source in recommendation
- LLM API timeout → retry once, then surface graceful error message
- Duplicate approval attempt (double-click) → idempotent on server, UI disables button after first click
- Token already consumed (replay) → 409 from DPAT service, REPLAY_ATTACK audit event logged

#### 5.4 Security Hardening for Demo
- No raw card numbers, CVVs, or PAN data anywhere in logs, traces, or LLM prompts
- All financial fields sourced from DB/state — never re-parsed from conversation text
- Tool permission allowlists enforced per agent (hard-coded, not prompt-based)
- DPAT signing verified at execution; signature failure = immediate block, no fallback
- Rate limiting on payment endpoint (max 5 attempts per session in demo mode)

#### 5.5 Management Presentation Narrative (8-step story)
1. **Intent** — User expresses need in plain language
2. **Discovery** — Buyer Agent converts to structured constraints, searches 3 merchant sources via MCP
3. **Recommendation** — Facts retrieved, deterministically filtered, LLM explains trade-offs
4. **Consent** — Agent pauses; user explicitly approves; no payment without this
5. **Authorization** — Scoped DPAT created; agent holds only token ID; card never exposed
6. **Validation** — 12 deterministic checks run independently of LLM
7. **Failure** — Tampered amount → blocked; show blocked transaction in dashboard
8. **Audit** — Full trace in Phoenix; full order/event history in dashboard

#### 5.6 What NOT to Say (credibility guardrails for the demo team)
| Say | Don't Say |
|-----|-----------|
| "MCP-based merchant capability access" | "We implemented ACP or UCP" |
| "AP2-inspired payment authorization" | "We implemented real AP2 production payments" |
| "Simulated scoped payment token" | "Visa / Mastercard Agentic Tokens" |
| "Deterministic payment guardrails" | "We securely processed real credit cards" |
| "Human-in-the-loop purchase approval" | "The agent has access to the user's card" |
| "Local mock payment processor" | "This is a live bank integration" |

### Phase 5 Milestone
```
✓ All 5 scenarios run without errors from one command: `make demo`
✓ Dashboard updates live during demo without page refresh
✓ Phoenix trace visible alongside demo chat in split screen
✓ Demo reset button restores clean state in < 3 seconds
✓ No external network dependency for Scenarios 1, 2, 3, 4, 5
✓ Presentation slides reference correct architecture claims
```

---

## Tool Stack Summary — Final Recommendation

All tools: **free, local, no Docker required.**

| Layer | Tool | Free? | No Docker? | Justification |
|-------|------|-------|------------|---------------|
| **Frontend** | React 18 + Vite + Tailwind CSS | ✓ | ✓ | Fast iteration; SSE streaming |
| **UI Components** | shadcn/ui | ✓ | ✓ | Production-grade components; copies code into project; zero overhead |
| **Animations** | Framer Motion | ✓ | ✓ | Smooth agent step animations; ~50KB; npm install |
| **Typography** | Inter (Google Fonts) | ✓ | ✓ | Standard fintech font; single CSS import |
| **Voice input** | faster-whisper | ✓ | ✓ | `pip install faster-whisper`; runs fully local; base model ~150MB; no API key needed |
| **Backend** | FastAPI (Python 3.12) | ✓ | ✓ | Async-native; auto OpenAPI; lightweight |
| **Agent orchestration** | LangGraph 0.2+ | ✓ | ✓ | Stateful graph; human-in-the-loop interrupts |
| **Primary LLM** | Gemini 2.0 Flash Lite (`gemini-2.0-flash-lite`) | ✓ free tier | ✓ | 30 RPM / 1500 RPD free; fast; good structured output |
| **Gemini SDK** | `langchain-google-genai` | ✓ | ✓ | Native LangGraph integration |
| **Local LLM fallback** | Ollama + Llama 3.2 | ✓ | ✓ | Offline demo insurance; native Windows installer |
| **Input guardrail** | NeMo Guardrails | ✓ | ✓ | `pip install nemoguardrails`; Colang conversation rails; runs fully local |
| **Output guardrail** | Guardrails AI | ✓ | ✓ | `pip install guardrails-ai`; schema validation on LLM outputs |
| **Payment guardrail** | Custom Python (12 checks) | ✓ | ✓ | Deterministic; auditable; no framework needed |
| **Tool permission guardrail** | LangGraph allowlists | ✓ | ✓ | Built into node configuration |
| **MCP** | FastMCP (Python) | ✓ | ✓ | Official SDK; lightest footprint |
| **Real web discovery** | `@playwright/mcp` (Microsoft) | ✓ | ✓ | Official MCP server; `npx @playwright/mcp`; no scraping |
| **Merchant API** | Shopify Storefront API | ✓ dev-store | ✓ | Structured data; no scraping risk |
| **Alternative merchant API** | Flipkart Affiliate API | ✓ | ✓ | Use if Shopify credentials unavailable |
| **Database** | SQLite | ✓ | ✓ | Zero infra; file on disk; upgrade path to PostgreSQL |
| **Data validation** | Pydantic v2 | ✓ | ✓ | Hard typing wall between LLM outputs and financial fields |
| **Cryptography** | Python `cryptography` (HMAC-SHA256) | ✓ | ✓ | Standard; fast; `pip install cryptography` |
| **Observability** | Arize Phoenix | ✓ | ✓ | `pip install arize-phoenix`; `phoenix.launch_app()` — no Docker |
| **Charts** | Recharts (React) | ✓ | ✓ | `npm install recharts`; no chart server |

---

## What NOT to Add (keep the POC lean)

```
✗ Kafka / Redis / RabbitMQ — not needed for local demo
✗ Kubernetes / Docker Compose (beyond single-node) — one laptop target
✗ Real card processing / Stripe live mode — mock processor is sufficient
✗ Vector database / RAG — products fit in SQLite; no retrieval pipeline needed
✗ >6 agents — more agents = more debugging surface; keep roles meaningful
✗ Complex fraud models — simple rule-based risk scoring is enough for Phase 1-5
✗ Multi-region / CDN — local POC; not a production deployment
✗ GraphQL API — REST endpoints are clearer for a demo
```

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Playwright bot detection on real site | Medium | Use `@playwright/mcp` accessibility mode (not full headless); always have local adapter fallback |
| LLM hallucination in financial fields | High | Pydantic models + deterministic normalizer; LLM only writes prose explanations, never financial values |
| Amazon API not available | Low | Not a critical path; local + Shopify covers the demo |
| Token/credential in LLM context | Critical | Agent receives only DPAT token ID; raw auth object stays in DPAT service DB |
| Demo instability from live API | Medium | Pre-seed local merchant data; use demo mode flag to bypass live calls |
| LLM provider quota | Medium | Ollama fallback for intent extraction; cache responses where safe |
| Replay attack in demo | Low | Token consumed flag in DB; `single_use = true` enforced in guardrail check #4 |
| Amount/merchant tampering by agent | High | 12-check deterministic guardrail; LLM cannot override; signed DPAT bound to checkout_hash |

---

## Build Order (within phases)

```
Phase 1:  SQLite schema → Pydantic models → local merchant seeding → FastAPI skeleton
          → React shell + shadcn/ui init → Inter font → Framer Motion install → 4 page routes

Phase 2:  MCP server → local adapter → LangGraph graph → Gemini 2.0 Flash Lite config
          → NeMo Guardrails config + Colang rails → Orchestrator Agent
          → Guardrails AI validators → Product Search Agent
          → Playwright adapter → Shopify adapter → constraint filter → ranking
          → SSE streaming → animated agent step UI

Phase 3:  Seller Agent → checkout object → LangGraph interrupt → consent recording
          → DPAT service → crypto signing → 12-check guardrail engine → policy rules
          → Checkout screen (shadcn/ui Dialog + countdown timer)

Phase 4:  Payment Execution Agent → mock processor → Order Management Agent
          → Phoenix instrumentation → audit trail SSE
          → Dashboard (shadcn/ui DataTable + Recharts + live SSE)
          → Payment result screens (success + blocked states)

Phase 5:  Scenario pre-seeding → demo mode dropdown → reset button
          → error state polish → Framer Motion transitions on all screens
          → management slides + claims review
```

---

## One-Sentence Architecture Summary

> A six-agent, LangGraph-orchestrated commerce assistant uses MCP to interact with real and simulated merchant capabilities, applies deterministic ranking and guardrails to control agent behavior, requires explicit user consent before generating a scoped DPAT token bound to the approved checkout hash, validates the transaction through twelve independent checks before execution, processes the payment through a mock processor, and records every step in a live dashboard and Arize Phoenix trace.

---

---

# VERSION 2 — Conversational Commerce (Company-Specific)

> **What this is:** A single-brand agentic chatbot (e.g., Chase Marketplace, Nike Store) where the entire shopping journey — product discovery, cart, payment, tracking — happens inside one conversational interface. No page navigation. Everything in the chat. Styled and designed to feel like a Chase Bank product.

---

## V2 — Core Concept Shift

| V1 (Current) | V2 (Target) |
|---|---|
| Multi-page navigation (Chat → Checkout → Result → Dashboard) | Single-page — all states render as chat messages |
| Mic button: click to start, click to stop | Always-on wake word — "Hey Chase" hands-free |
| One customer type | Known customer (bank token) + Unknown customer (guest card form) |
| No loyalty system | Loyalty points + purchase history recommendations |
| No facial recognition | Face-based login option |
| Single chat panel | Split-screen: chat left + live agent trace right |
| Generic styling | Chase Bank blue palette, Chase-grade typography and layout |

---

## V2 — Visual Design System

Clean, professional fintech aesthetic — blue primary palette, white backgrounds, clear hierarchy.

### Layout
```
┌──────────────────────────────────────────────────────┐
│  [Chase logo]    Chase Marketplace    [Avatar] [⚙️]   │  ← Top nav bar, Chase dark blue
├──────────────────────────┬───────────────────────────┤
│                          │                           │
│   CONVERSATIONAL CHAT    │   AGENT TRACE PANEL       │  ← Split 60/40
│   (left panel)           │   (right panel)           │
│                          │                           │
│                          │                           │
│                          │                           │
│  ──────────────────────  │                           │
│  [🎤 Wake word active]   │                           │
│  [Type a message...]  →  │                           │
└──────────────────────────┴───────────────────────────┘
```

---

## V2 — Architecture Overview

```
User (voice or text)
    │
    ▼
Wake Word Listener (Porcupine — browser)
    │  "Hey Chase" detected
    ▼
Conversational Chat UI (single React page, all states inline)
    │
    │── Known Customer path ──► Auth Agent → Fetch loyalty + payment token from bank
    │── Unknown Customer path ─► Guest flow → Isolated card form → Tokenize → Payment
    │
    ▼
[Same 6-agent pipeline as V1 — Orchestrator → Search → Seller → Auth → Execute → Order]
    │
    ▼
Agent Trace Panel (right side) ← streams all agent events live
    │
    ▼
Loyalty Engine ← awards points, reads history for next recommendation
```

---

## V2 — Step-by-Step Build Plan

### Step 1 — Branch & Scaffold

1. Create `version-1` branch from current `enhancement/ui-ux-polish` — frozen snapshot
2. Create `version-2` branch from `version-1`
3. Keep all backend agents, guardrails, and DPAT pipeline intact — they are reused
4. The primary changes are **frontend architecture** and **auth/payment flows**

---

### Step 2 — Split-Screen Layout

Redesign the React app from multi-page routing to a **single-page split-screen**:

```
frontend/src/
├── App.tsx                    ← single root, no page router
├── components/
│   ├── ChatPanel/
│   │   ├── ChatWindow.tsx     ← message thread, inline product cards, inline checkout
│   │   ├── ChatInput.tsx      ← text input + wake word indicator
│   │   ├── MessageBubble.tsx  ← user / assistant messages
│   │   ├── ProductCardInline.tsx  ← product selection rendered inside chat
│   │   ├── CheckoutInline.tsx     ← checkout approval rendered inside chat
│   │   └── PaymentFormInline.tsx  ← card form (unknown customer, isolated)
│   └── TracePanel/
│       ├── TracePanelRoot.tsx ← right-side agent trace container
│       ├── TraceEvent.tsx     ← individual agent step row
│       └── AgentFlowDiagram.tsx ← visual flow graph with live highlights
├── hooks/
│   ├── useWakeWord.ts         ← Porcupine wake word hook
│   ├── useVoiceCommands.ts    ← maps spoken phrases to actions
│   └── useAgentTrace.ts      ← SSE subscription for agent events
└── styles/
    └── chase-tokens.css       ← all Chase color and font tokens
```

**Chat state machine** (no page navigation — just state transitions):
```
idle → authenticating → searching → results → cart → checkout → payment → confirmed → tracking
```
Each transition appends a new message to the chat thread. Product cards, checkout summaries, and confirmation receipts all render as chat "cards" inline.

**Right-side trace panel** streams:
- Agent name + icon
- Tool called (with parameters, collapsed by default)
- Result summary
- Time elapsed per step
- Color-coded: LLM steps (blue) vs deterministic steps (grey) vs guardrail events (orange/red)

---

### Step 3 — Customer Authentication (Two Flows)

**Landing screen inside chat:**
```
┌─────────────────────────────────────────────┐
│  Welcome                                    │
│  How would you like to continue?            │
│                                             │
│  ┌─────────────────────┐                   │
│  │  🏦 Chase Customer  │  ← primary CTA    │
│  │  Sign in with Chase │     (dark blue)   │
│  └─────────────────────┘                   │
│                                             │
│  ┌─────────────────────┐                   │
│  │  👤 Guest / New     │  ← secondary CTA  │
│  │  Continue as Guest  │     (outline)     │
│  └─────────────────────┘                   │
│                                             │
│  (Facial recognition → V3)                 │
└─────────────────────────────────────────────┘
```

**Known Customer flow:**
1. Username + password (or face recognition)
2. Backend: validate credentials → load profile from `users` table
3. Fetch loyalty points balance + purchase history
4. Retrieve stored payment token (no card details needed — agent never sees raw card)
5. Agent proceeds with full personalized context: name, preferences, past orders, loyalty balance

**Unknown / Guest Customer flow:**
1. Guest enters name and email (collected conversationally in chat if not provided)
2. Proceeds through product discovery normally
3. At payment step: secure card form pops up inside the chat panel (see Step 6)
4. After tokenization: payment proceeds identically to known customer path

**Facial Recognition:** → Deferred to V3. Not in V2 scope.

---

### Step 4 — Voice Command Routing

**V2 scope:** Keep the existing click-to-activate mic from V1, but add **voice command routing** so the entire flow can be driven by voice once the mic is active.

> Wake word (always-on activation) and facial recognition are deferred to V3.

**How it works:**
```
User clicks mic button (same as V1)
    │
    ▼
Web Speech API — continuous recognition while mic is active
    │
    │  Transcript → Voice Command Router
    │
    ▼
Voice Command Router
    ├── "choose the first one" / "first" / "pick first"  → selects product[0]
    ├── "choose the second" / "second one"               → selects product[1]
    ├── "add to cart"                                    → triggers cart
    ├── "confirm" / "approve" / "yes"                   → approves checkout
    ├── "cancel" / "no" / "go back"                     → cancels current step
    ├── "track my order"                                 → shows tracking
    └── anything else                                    → passes as free-text query to agent
```

**UX improvement over V1:**
- Mic stays active after transcription (no stop/restart needed mid-flow)
- After product results appear, user can say "choose the second one" without typing
- Voice commands mapped to active UI state — "confirm" only works when checkout is shown
- Transcript shown in chat bubble as user speaks (live preview)

**UI indicators:**
- Mic button turns blue + pulsing animation while active
- Live transcript preview appears in input field
- Active command hints shown below input: *"Say 'first', 'second', or 'confirm'"* — context-aware

---

### Step 5 — Loyalty Points & History-Based Recommendations

**New DB tables:**
```sql
loyalty_accounts (
  user_id, points_balance, tier,  -- Bronze/Silver/Gold
  total_earned, total_redeemed, updated_at
)

loyalty_transactions (
  id, user_id, order_id, type,   -- EARN | REDEEM | EXPIRE
  points, description, created_at
)
```

**Earning rules (simple, configurable):**
```
$1 spent = 10 points
Bronze: 0–999 pts   | no multiplier
Silver: 1000–4999   | 1.5x multiplier
Gold: 5000+         | 2x multiplier
```

**How the agent uses loyalty:**
1. On login: agent loads `loyalty_balance` from `loyalty_accounts`
2. Agent greets: *"Welcome back, Akash! You have 340 points (worth $3.40). Ready to earn more?"*
3. During checkout: *"Apply 200 points for $2.00 off?"* — user says yes/no
4. Post-purchase: agent confirms: *"You earned 120 points. New balance: 460 pts."*

**History-based recommendations:**
1. On login: agent reads last 10 orders from `orders` table for this user
2. Agent extracts: preferred brands, categories, sizes, price range
3. When user asks to "find something", agent pre-filters search with inferred preferences
4. Explicit recommendation card: *"Based on your last 3 purchases, you usually prefer Nike, size 10, under $120"*

**Demo scenario:** First-time user sees no history nudge. Returning user sees personalized greeting + preference pre-loading.

---

### Step 6 — Secure Card Form (Unknown Customers)

This form must be **fully isolated from the agent**. The agent triggers its display but cannot read its contents.

**Architecture:**
```
Chat Panel
    │
    │  Agent emits: { type: "SHOW_CARD_FORM", prefill: { name, email } }
    │
    ▼
PaymentFormInline.tsx renders an <iframe> with:
    ├── src: /payment-form.html  (separate static HTML, served with strict CSP)
    ├── CSP header: frame-ancestors 'self'; script-src 'self' only
    ├── postMessage API for: { ready }, { tokenized: "tok_xxx" }, { error }
    └── NEVER posts raw card data — only the token
```

**Form fields (pre-filled where possible):**
```
┌──────────────────────────────────────────────┐
│  🔒 Secure Payment                           │
│  This form is encrypted. Chase agents        │
│  cannot access your card details.            │
│  ──────────────────────────────────────────  │
│  Name on Card:   [Akash Saranathan      ]    │  ← pre-filled from session
│  Email:          [akash@email.com       ]    │  ← pre-filled from session
│  Card Number:    [                      ]    │
│  Expiry:         [MM / YY]                   │
│  CVV:            [   ]                       │
│  ──────────────────────────────────────────  │
│  [  Pay $117.99 Securely  ]                  │
└──────────────────────────────────────────────┘
```

**Tokenization flow:**
1. User fills form → clicks Pay
2. Form JS (inside iframe): encrypt card locally → call mock tokenization endpoint → receive `tok_xxx`
3. iframe postMessages `{ tokenized: "tok_xxx" }` to parent chat panel
4. Chat panel hands `tok_xxx` to payment agent — raw card data never leaves the iframe

---

### Step 7 — V2 Agent Trace Panel (Right Side)

The right panel is for **demo audiences** — it makes the invisible visible.

```
┌──────────────────────────────────────────┐
│  Agent Activity                  [Live ●] │
│──────────────────────────────────────────│
│  ✓  Orchestrator Agent           0.3s    │
│     Intent: { category: shoes, ... }     │
│                                          │
│  ✓  Product Search Agent         1.2s    │
│     MCP → search_products()             │
│     → Merchant A: 5 results             │
│     → Merchant B: 3 results             │
│     → Merchant C: 6 results             │
│                                          │
│  ✓  Deterministic Filter         0.1s   │
│     14 candidates → 5 pass constraints  │
│                                          │
│  ⏳  Seller Agent (checkout)    ...      │
│     MCP → create_checkout()             │
│                                          │
│  ○  Payment Auth Agent          pending  │
│  ○  Payment Execution Agent     pending  │
│  ○  Order Management Agent      pending  │
│──────────────────────────────────────────│
│  🔵 LLM step  ⚪ Deterministic  🟠 Guard │
└──────────────────────────────────────────┘
```

Each step:
- Expands on click to show full tool arguments and response
- Color-coded by step type (LLM / deterministic / guardrail event)
- Timestamps for each step
- Guardrail events highlighted in orange/red when they fire

---

### Step 8 — V2 Demo Scenarios (Chase-Specific)

**Scenario 1 — Known Customer, Full Voice Purchase**
```
User logs in → "I want Nike running shoes" → agent loads profile + loyalty
→ recommends based on history → says "choose the first one" → checkout
→ payment via stored token → "You earned 120 points. Order confirmed."
```

**Scenario 2 — Guest Customer, Card Form**
```
Guest flow → product search → checkout → card form appears
→ user fills form → token created → payment processed
→ Option to create account shown post-purchase
```

**Scenario 3 — Loyalty Redemption**
```
Known customer with 500+ points → agent proactively offers redemption
→ user redeems 200 points → $2 off applied → points balance updated
```

**Scenario 4 — Guardrail Fires (inherited from V1)**
```
Amount manipulation → PAYMENT BLOCKED → shown in agent trace panel
```

---

### V2 New Tech Stack Additions

| Addition | Tool | Why |
|---|---|---|
| Voice command routing | Web Speech API + custom intent mapper | Free, browser-native, no server needed — maps spoken phrases to UI actions |
| Card form isolation | iframe + Content Security Policy | Zero agent access to raw card data |
| Loyalty engine | Custom Python service + SQLite tables | Simple rules, no external dependency |
| Design system | Custom CSS tokens (Inter font, blue palette) | Professional fintech aesthetic |

---

---

# VERSION 3 — Universal Agentic Commerce (Agnostic)

> **What this is:** A standalone, brand-agnostic conversational commerce assistant — not tied to any company's website. Think ChatGPT for shopping: any user can ask it to find and buy anything from any merchant, using industry-standard agentic commerce protocols. Protocols are mimicked/simulated for demo purposes where real implementations don't exist yet.

---

## V3 — Core Concept Shift from V2

| V2 | V3 |
|---|---|
| Company-specific (Chase / Nike branded) | Agnostic — any user, any merchant, no brand |
| Manual merchant adapters (A, B, C) | UCP merchant discovery — merchants self-register |
| Internal payment token from bank | ACP / APGP agent-to-bank protocol tokens |
| X402 not present | X402 handles machine-to-machine micropayments |
| Single bank loyalty | Cross-merchant loyalty (universal points) |

---

## V3 — Protocol Stack

These are the protocols V3 mimics. Where real SDKs exist they are used; where they don't, the wire format and handshake are simulated:

### UCP — Universal Commerce Protocol
- **Purpose:** Standardized product discovery across merchants
- **How it works:** Merchants expose a `/ucp/search` endpoint with a standard schema. The agent queries a UCP registry to discover what merchants support it, then fans out search requests.
- **V3 approach:** Build a mock UCP registry (SQLite) + mock merchant UCP endpoints. Mimic the standard request/response envelope.
- **Demo value:** Shows that the agent doesn't hardcode merchants — it discovers them dynamically via protocol.

### ACP — Agent Commerce Protocol
- **Purpose:** Agent-to-bank handshake for payment authorization using cryptographic tokens
- **How it works:** Agent presents an identity assertion (signed JWT) to the bank's ACP endpoint → bank returns a scoped payment token → agent uses token for payment
- **V3 approach:** Mock bank ACP endpoint (FastAPI) that validates agent identity JWT and issues scoped tokens. Mimic the ACP token structure.
- **For known customers:** Agent presents customer identity + agent identity → bank issues token scoped to this agent + this transaction
- **Demo value:** Shows autonomous agent-to-bank authentication — no human typing card details.

### APGP — Agent Payment Gateway Protocol
- **Purpose:** Standardized payment execution between agents and payment gateways
- **How it works:** Structured payment request envelope (agent_id, merchant_id, token, amount, currency) → gateway validates → executes → returns structured result
- **V3 approach:** Extend the V1/V2 mock payment processor to accept APGP-formatted requests
- **Demo value:** Protocol-level payment — shows gateway-agnostic payment execution.

### X402 — HTTP 402 Machine-to-Machine Micropayment Protocol
- **Purpose:** Enables agents to autonomously pay for third-party services/APIs that require payment, without human intervention
- **How it works:**
  1. Agent calls a third-party endpoint (e.g., a merchant data API, a price comparison service)
  2. Service returns `HTTP 402 Payment Required` with `X-Payment` header specifying amount, currency, payment address
  3. Agent middleware intercepts the 402, resolves payment from pre-authorized crypto/stablecoin wallet
  4. Agent retries request with `X-Payment-Proof` header
  5. Service validates proof and returns the requested data
- **V3 approach:** Mock a third-party service that returns 402 for certain data (e.g., premium product data). Implement X402 middleware in the agent that auto-resolves it using a mock crypto wallet.
- **Third-party scenarios:**
  - Agent needs shipping rates from a premium logistics API → 402 → auto-pays → gets rates
  - Agent accesses exclusive merchant inventory feed → 402 → auto-pays → gets inventory
  - Agent-to-agent service call (fulfillment agent charges shopping agent) → 402 → resolved
- **Demo value:** Most futuristic demo moment — agent silently pays for its own tool calls in real-time.

---

## V3 — Customer Flows

### Known Customer (any bank, ACP-enabled)
```
User asserts identity (login / face / voice)
    │
    ▼
Agent presents signed identity JWT to bank's ACP endpoint
    │
    ▼
Bank validates → returns scoped payment token for this session
    │
    ▼
Agent proceeds — no card form, no manual input
Token is scoped: { merchant: any, max_amount: $X, expires: 15min }
```

### Unknown / Non-ACP Customer
```
Guest login (name + email only)
    │
    ▼
Product discovery (UCP search)
    │
    ▼
Checkout reached → same isolated card form as V2
    │
    ▼
Card tokenized → APGP payment request → processed
    │
After payment: option to link to ACP-enabled bank for future
```

---

## V3 — Step-by-Step Build Plan

### Step 1 — UCP Merchant Discovery Layer

**Mock UCP Registry:**
```
GET  /ucp/merchants              ← list all UCP-registered merchants
GET  /ucp/merchants/{id}/caps    ← what search/checkout capabilities does this merchant support
POST /ucp/search                 ← fan-out search: { query, filters, merchant_ids }
```

**UCP search envelope (standard format):**
```json
{
  "protocol": "UCP/1.0",
  "intent": "product_search",
  "query": "running shoes size 10 under $100",
  "filters": { "category": "footwear", "max_price": 100 },
  "requester": { "agent_id": "SHOP_AGENT_001", "session_id": "..." }
}
```

Response: array of `NormalizedProduct` (same schema as V1/V2 — UCP normalizes merchant differences).

**Agent change:** Instead of hardcoded merchant adapters, the Orchestrator queries the UCP registry first, discovers available merchants dynamically, then fans out.

---

### Step 2 — ACP Bank Authentication Mock

**Mock ACP bank endpoint:**
```
POST /acp/auth/request
Body: { agent_id, agent_jwt, customer_id, session_scope }
Response: { acp_token, expires_at, scope: { max_amount, currency } }

POST /acp/auth/validate
Body: { acp_token }
Response: { valid, customer_id, scope }
```

**Agent identity JWT** (signed with agent's private key):
```json
{
  "iss": "SHOP_AGENT_001",
  "sub": "customer@email.com",
  "aud": "bank.acp.endpoint",
  "iat": 1727000000,
  "exp": 1727003600,
  "scope": "payment_authorization",
  "merchant_whitelist": ["*"]
}
```

**How demo shows this:**
- Right-side trace panel shows the ACP handshake explicitly: "Agent presenting identity to Chase ACP → Token received (scoped, 15min TTL)"
- DPAT from V1 is replaced with ACP token for the known customer path (same security model, different protocol label)

---

### Step 3 — APGP Payment Execution

Extend the mock payment processor to accept APGP format:

```json
{
  "protocol": "APGP/1.0",
  "agent_id": "SHOP_AGENT_001",
  "merchant_id": "MERCHANT_A",
  "acp_token": "tok_abc123",
  "order_id": "ORD-7821",
  "amount": 117.99,
  "currency": "USD",
  "idempotency_key": "uuid-xxx"
}
```

The existing 12-check guardrail engine validates the APGP request — same logic, new wire format.

---

### Step 4 — X402 Middleware

**Mock 402-gated service:**
```python
# A third-party "premium product data" API
GET /premium/products/{id}/details
→ 402 Payment Required
X-Payment-Amount: 0.001
X-Payment-Currency: USDC
X-Payment-Address: 0xMockWalletAddress
X-Payment-Expiry: 30
```

**Agent X402 middleware (wraps all outbound HTTP calls):**
```python
response = http_client.get(url)

if response.status_code == 402:
    payment_info = parse_x402_headers(response.headers)
    proof = mock_wallet.pay(payment_info)   # simulated crypto micropayment
    response = http_client.get(url, headers={"X-Payment-Proof": proof})

return response
```

**Mock wallet:**
- Simulated USDC balance (no real crypto)
- Each X402 payment deducted from balance
- Balance shown in agent trace panel: "Agent paid 0.001 USDC for premium data access"

**Demo moment:** Agent is searching for a product. It hits a premium merchant API that requires micropayment. The trace panel shows the 402 → auto-pay → retry happening in real time. User sees nothing change in the chat — it's fully autonomous.

---

### Step 5 — Cross-Merchant Loyalty (Universal Points)

In V3, loyalty is not tied to one brand. It's a cross-merchant universal points wallet:

```
universal_loyalty (
  user_id, universal_points, linked_merchants[],
  earned_history[], redeemed_history[]
)
```

- Points earned at any UCP-registered merchant accumulate in one wallet
- Agent knows the universal balance at session start
- At checkout: agent checks if any redemption options available at this merchant
- Future extension: connect to real loyalty networks (airline miles, bank rewards points)

---

### Step 6 — V3 UI Changes from V2

- Remove Chase branding → neutral "Commerce AI" branding (easily re-skinnable for any client)
- Keep split-screen layout — trace panel now also shows UCP discovery events and X402 payment events
- Add "Protocol View" toggle in trace panel: shows raw protocol envelopes for technical audiences
- Multi-merchant result cards: each card shows which UCP merchant sourced it

---

### V3 New Tech Stack Additions

| Addition | Tool | Why |
|---|---|---|
| UCP registry + search | Custom FastAPI mock | Simulate UCP discovery/search protocol |
| ACP bank mock | Custom FastAPI mock | Simulate agent-to-bank identity + token handshake |
| APGP payment format | Extend existing mock processor | Standardized agent payment request envelope |
| X402 middleware | Custom Python httpx middleware | Intercept 402s, simulate crypto micropayment, retry |
| Mock crypto wallet | In-memory USDC wallet (no real crypto) | Simulate X402 payment balance and deductions |
| Universal loyalty | New SQLite tables + service | Cross-merchant points aggregation |

---

## What NOT to Claim for V3 (Demo Credibility)

| Say | Don't Say |
|---|---|
| "UCP-inspired merchant discovery protocol" | "We implemented the official UCP standard" |
| "ACP-style agent-to-bank token handshake" | "Real ACP bank integration" |
| "X402-pattern autonomous micropayments" | "Real blockchain transactions or real crypto" |
| "APGP-formatted payment requests" | "Production APGP gateway integration" |
| "Protocol mimic for demo purposes" | "This is production-ready protocol compliance" |

---

## V3 Demo Scenarios

**Scenario 1 — UCP Discovery in Action**
```
User: "Find me wireless headphones under $80"
Trace panel: "Querying UCP registry → 4 merchants discovered → fan-out search"
→ Results from 4 different merchants, each labeled with UCP source
```

**Scenario 2 — ACP Known Customer Payment**
```
Known customer logs in → trace shows ACP handshake with mock bank
→ scoped token issued → payment proceeds without card form
→ Trace: "ACP token valid. Scope: $500 max, 15min TTL"
```

**Scenario 3 — X402 Autonomous Micropayment**
```
Agent searches premium merchant → 402 returned → trace shows:
"[X402] Premium data endpoint → 402 Payment Required → Agent paid 0.001 USDC → Retrying..."
→ Premium product data returned → included in results
→ User sees nothing different in chat — fully autonomous
```

**Scenario 4 — Guest with Secure Card Form**
```
Guest user → UCP search → checkout → card form pops up
→ Tokenized → APGP payment → confirmed
→ "Want to link your bank for faster checkout next time?" CTA
```

**Scenario 5 — Cross-Merchant Loyalty**
```
Returning user with 800 universal points (earned across 3 merchants)
Agent: "You have 800 universal points worth $8 — apply to this order?"
→ Redeemed → points deducted from universal wallet
```

---

## Full Version Comparison

| Feature | V1 | V2 | V3 |
|---|---|---|---|
| UI model | Multi-page navigation | Single-page chat | Single-page chat |
| Branding | Generic | Professional blue fintech | Agnostic / neutral |
| Voice | Click-to-record | Click-to-record + voice command routing | Always-on wake word |
| Facial recognition | ✗ | ✗ (deferred) | ✓ face-api.js |
| Customer types | Single | Known + Guest | Known (ACP) + Guest |
| Payment token | DPAT (custom) | DPAT / bank token | ACP token |
| Card form | ✗ | ✓ isolated iframe | ✓ isolated iframe |
| Loyalty | ✗ | ✓ brand-specific | ✓ cross-merchant universal |
| History recommendations | ✗ | ✓ | ✓ |
| Merchant discovery | Hardcoded adapters | Hardcoded adapters | UCP registry |
| Payment protocol | Custom guardrail | DPAT + guardrail | APGP |
| X402 micropayments | ✗ | ✗ | ✓ |
| Agent trace panel | Phoenix only | Inline split-screen | Inline split-screen + protocol view |
| Split-screen layout | ✗ | ✓ | ✓ |
