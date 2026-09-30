# Talkshop

**Talk to it. It shops for you.**

Talkshop is a multi-agent **agentic commerce** demo — a conversational shopping assistant that can discover products, build a cart, authorize payment, and place an order, entirely through chat. It's a working prototype of the same problem Stripe's [Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/acp), Google's [Agent Payments Protocol (AP2)](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), and Visa/Mastercard's agent-payment frameworks are solving industry-wide: how do you let an AI agent spend money on your behalf *without* ever handing it your actual card or bank credentials?

## How it works

A user's request moves through six named agents, each with one job:

| # | Agent | Role | Uses an LLM? |
|---|-------|------|---------------|
| 1 | **VibeCheck** | Understands what you want, asks clarifying questions if you're vague | Yes — intent extraction & prose only |
| 2 | **SneakPeek** | Searches the catalog, filters and ranks results | No — deterministic |
| 3 | **CartUp** | Builds the checkout (subtotal, tax, shipping, tamper-detection hash) | No — deterministic |
| 4 | **GreenLight** | Issues a scoped, single-use payment authorization token | No — deterministic |
| 5 | **PayIt** | Independently re-verifies the token and executes the charge | No — deterministic |
| 6 | **TrackIt** | Confirms the order and simulates delivery tracking | No — deterministic |

**The core design rule:** anything involving money, inventory, or a guardrail decision is plain, testable Python — never left to an LLM. The LLM only ever touches two things: turning your sentence into structured intent, and writing the human-readable recommendation text. It never sees a price it invented, and it never authorizes a payment.

**The trust boundary:** agents never see a card number, CVV, or bank credential — only an opaque token. GreenLight issues a token scoped to one merchant, one order, one maximum amount, with a short expiry. PayIt does **not** trust that token just because GreenLight issued it — it independently re-runs a 12-check guardrail engine (merchant match, amount match, expiry, single-use, tamper-hash match, and more) before any charge happens. Every step is written to an audit trail.

Discovery (VibeCheck → SneakPeek) runs as a [LangGraph](https://github.com/langchain-ai/langgraph) state machine, streamed live to the UI over SSE. Checkout and payment (CartUp → GreenLight → PayIt → TrackIt) run as direct, testable function calls behind REST endpoints — a deliberate choice to keep the money-moving path simple and auditable rather than folding it into the same graph.

## Features

- **Conversational discovery** — natural-language search with follow-up questions when you're vague ("running shoes" → "what size, color, budget?"), voice input, and image-paste search (multimodal)
- **Real product catalog** — 80 products across running shoes / electronics / accessories, with real, color-matched product photography
- **Cart** — add from chat, edit quantity, remove items, choose what to check out now vs. save for later
- **Checkout & payment** — scoped token authorization, independent guardrail re-verification, wallet-based payment (no real payment gateway — see [Limitations](#limitations))
- **Fulfillment** — order confirmation, tracking numbers, simulated delivery status
- **Persistent chat history** — ChatGPT-style session sidebar, resumable conversations
- **Dashboard** — wallet balance, order history, delivery status, spend summary
- **Real authentication** — JWT + bcrypt, not a UI mock
- **Observability** — OpenTelemetry tracing on the payment path, viewable in [Arize Phoenix](https://github.com/Arize-ai/phoenix)

## Tech stack

**Backend:** FastAPI · SQLAlchemy · SQLite · Pydantic · LangGraph · LangChain (Gemini) · PyJWT · bcrypt · OpenTelemetry
**Frontend:** React 19 · TypeScript · Vite · Tailwind CSS · React Router · Framer Motion

## Project structure

```
backend/
  agents/        VibeCheck, SneakPeek, CartUp, GreenLight, PayIt, TrackIt
  graph/         LangGraph discovery workflow + per-session state
  payment/       Guardrail engine, HMAC signing, mock processor
  routers/       FastAPI endpoints (auth, chat, cart, checkout, payments, ...)
  db/            SQLAlchemy schema + seeding
  merchants/     Local catalog + Shopify/BestBuy adapter stubs
frontend/
  src/pages/       Chat, Cart, Checkout, Dashboard, Login, PaymentResult
  src/components/  ProductCard, ChatSidebar, OrdersPanel, ...
  src/api/         Typed fetch clients per backend router
data/            Seed catalog (products.json, merchants.json)
tests/           pytest suite
status.md        Phase-by-phase build log
```

## Getting started

### Backend

```bash
pip install -r requirements.txt
cp .env.example .env        # then set GOOGLE_API_KEY (see .env.example for where to get one)
python -m backend.db.init_db
python -m uvicorn backend.main:app --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

### Try it

Register a new account, or use the seeded demo login:

```
email:    demo@talkshop.io
password: demo1234
```

Then just ask for something: *"Find running shoes, size 10, under $100"*.

## Running tests

```bash
python -m pytest tests/ -v
```

## Limitations

This is a proof of concept, not a production payment system. To be upfront about what's simulated:

- **Payment is a wallet balance**, not a real card network or bank connection — no real money ever moves
- **Merchant search is one seeded local catalog** — the Shopify/BestBuy adapters exist in code but have no live credentials wired in
- **The MCP tool layer** is structured correctly (`@mcp.tool()`-decorated functions) but is called in-process, not over a real MCP client/server transport
- **Multi-item checkout** processes each cart item as its own independent order rather than one combined order

See [`status.md`](status.md) for the full phase-by-phase build log, and [`wallet-topup-flow.md`](wallet-topup-flow.md) for a proposed (not yet built) flow to fund the wallet from a linked bank account, modeled on Stripe's Shared Payment Token pattern.
