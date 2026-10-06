# Talkshop

**Talk to it. It shops for you.**

Talkshop is a multi-agent **agentic commerce** demo — a conversational shopping assistant that discovers products, manages your cart, authorizes payment, and confirms your order, entirely inside one chat window. No page navigation. No forms to fill. Just conversation.

It's a working prototype of the same problem Stripe's [Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/acp), Google's [Agent Payments Protocol (AP2)](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol), and Visa/Mastercard's agent-payment frameworks are solving: how do you let an AI agent spend money on your behalf *without* ever handing it your actual card or credentials?

---

## Demo 1 — ShopSphere × Talkshop (branch: `demo-1-merchant-chat-assistant`)

**ShopSphere** is a merchant website; **Talkshop** is its built-in shopping assistant, docked on the right of every page. Anyone can browse, fill a cart and chat with Talkshop without an account. Logging in (or signing up) is needed only to check out, and the visitor's cart and conversation come along. Talkshop understands the request and decides what should happen; ShopSphere's own services (catalog, inventory, cart, checkout, payment, orders) do it. Payment only ever runs when the customer taps **GO AHEAD**.

Full plan, phases, decisions and checklist: [`docs/demo-1-shopsphere-talkshop-plan.md`](docs/demo-1-shopsphere-talkshop-plan.md).

### Run it

```powershell
pip install -r requirements.txt            # once
cd frontend; npm install; cd ..            # once
# .env needs GOOGLE_API_KEY (see .env.example)

# Backend, on its own demo database (your other local data is untouched)
$env:COMMERCE_DB_PATH = "backend/db/demo1.db"
python -m backend.db.reset_demo --yes      # fresh catalog, Kaajal's saved details, no orders
python -m uvicorn backend.main:app --port 8000

# Frontend, in a second terminal
cd frontend; npm run dev                   # http://localhost:5173
```

Open http://localhost:5173: the store opens straight away, no login needed. Log in from the header, or at checkout, with the demo account (**Use demo account**): `kaajal@shopsphere.demo` / `demo1234`. Kaajal has two saved addresses and two cards: **Visa •••• 4821** (approves) and **Mastercard •••• 0019** (always declines, for the decline demo).

To reset between demos: stop the backend, run `python -m backend.db.reset_demo --yes` with the same `COMMERCE_DB_PATH`, start it again.

### Demo scripts

| Script | What to do | What it shows |
|---|---|---|
| **A: the spec** | In Talkshop: *"I need running shoes under $150 for everyday running."* → **Select** Runner Pro X → size **8** → **Black** → **Yes, checkout** → **GO AHEAD** | Top 3 on the chat and the page, size/colour checked against stock, ShopSphere cart, review card ($129 + $10.64 = **$139.64**), authorized, order **SS-#####** |
| **B: declined card** | As A, then on the review card **Change** payment → Mastercard •••• 0019 → GO AHEAD → change back to Visa → GO AHEAD | Payment not authorized, **no order created**, retry on the same checkout |
| **D: no account yet** | Open the store logged out → add a wallet → in Talkshop pick Runner Pro X, 8, Black → **Yes, checkout** → sign-in card → **Use demo account** → **Log in & continue** → GO AHEAD | Browsing, cart and chat without an account; login only at checkout; the cart and conversation carry over and Talkshop continues straight to Review |
| **C: site + Talkshop** | Shoes → FlexRun 5 → **Ask Talkshop about this** → size/colour in chat → Keep shopping → add a wallet on the website → Cart: select only the wallet → Checkout selected → Place order | One cart for both, page-aware chat, website checkout of selected items, both orders in My Orders |

Things worth pointing out: typing *"go ahead"* never pays (only the button does) · the header cart badge moves when Talkshop adds items · **ⓘ How Talkshop works** in the panel shows the live agent trace (VibeCheck → SneakPeek → CartUp → GreenLight → PayIt → TrackIt) · light/dark toggle in the header.

### Notes

- Catalog: 60 products / 385 SKUs in `data/shopsphere_catalog.json`, built by `scripts/build_shopsphere_catalog.py`; one studio photo per colour in `frontend/public/catalog/` (Pixabay licence, sources in `data/catalog_images.json`). Regenerating photos needs its own virtualenv — see `scripts/fetch_catalog_photos.py`.
- Product search reads only the ShopSphere catalog (`CATALOG_SOURCES=shopsphere`); the Shopify/BestBuy/DummyJSON adapters are kept but switched off.
- Tests run on their own temporary database: `python -m pytest tests/`.

---

## Version 2 — Conversational Commerce (current branch: `v2-upgrade`)

Version 2 transforms TalkShop into a fully conversational single-screen experience. The entire purchase flow — search → add to cart → checkout → pay → order confirmation — happens inline in the chat. The right panel shows a live real-time trace of the 6-agent pipeline as it runs.

### What's new in v2

**LLM-driven everything**
- Every message — shopping queries, follow-ups, general questions, cart commands — is handled by the LLM
- "which one is better for trail running?" → answered from the products already shown in the session
- "add the first one to cart" / "remove it" / "show me my cart" → LLM understands and executes the action
- "what else do you have?" → surfaces products 6–10 from the original search without a new query
- Any off-topic question is answered naturally ("who invented the internet?" → real answer)

**Inline purchase flow — zero page navigation**
1. Agent recommends a product and asks "Want me to add it to your cart?"
2. Say "yes" or "add it" → inline cart card appears: added product, full cart list, total, action buttons
3. "Proceed to Checkout →" → order summary card appears in chat with product details, tax, shipping
4. "Confirm & Pay" → live pipeline streams GreenLight authorization → PayIt execution → TrackIt confirmation
5. "Order Confirmed" card shows inline with order ID, amount, loyalty points earned

**Live agent pipeline panel (right)**
- 6-node horizontal flowchart: VibeCheck → SneakPeek → CartUp → GreenLight → PayIt → TrackIt
- Each node animates live: idle (grey) → running (amber pulse) → done (green) → error (red)
- Click any agent to expand: key-value output table + step-by-step timeline
- Idle agents show their role description when expanded — the panel explains itself
- Accumulates all agent steps across the full session (search + checkout + payment in one view)

**Session persistence**
- Navigate to /cart or /dashboard and return — the conversation is exactly where you left it
- In-progress checkout survives navigation; order summary card re-appears, card details pre-filled
- Completed payment shows the order confirmation card, not the original product results

---

## How it works

A user's message moves through six named agents, each with one job:

| # | Agent | Role | Uses an LLM? |
|---|-------|------|---------------|
| 1 | **VibeCheck** | Classifies your message, answers any question, extracts shopping intent, writes recommendations | Yes — intent, prose, action routing |
| 2 | **SneakPeek** | Searches 3 merchant catalogs in parallel, filters and ranks results | No — deterministic |
| 3 | **CartUp** | Adds items, builds the checkout (subtotal, tax, shipping, tamper hash) | No — deterministic |
| 4 | **GreenLight** | Issues a scoped, single-use DPAT payment token after 12 guardrail checks | No — deterministic |
| 5 | **PayIt** | Independently re-verifies the token and executes the charge | No — deterministic |
| 6 | **TrackIt** | Confirms the order, updates loyalty balance | No — deterministic |

**Core design rule:** anything involving money, inventory, or a guardrail decision is plain, testable Python — never the LLM. The LLM classifies intent, routes actions, and writes prose. It never invents a price and never authorizes a payment.

**Trust boundary:** agents never see a card number, CVV, or bank credential — only an opaque DPAT token. GreenLight issues a token scoped to one merchant, one order, one amount, with a 15-minute TTL and single-use flag. PayIt does **not** trust that token just because GreenLight issued it — it independently re-runs 12 guardrail checks (merchant match, amount ceiling, expiry, single-use enforcement, tamper-hash verification, and more) before any charge happens. Every step is written to an audit trail.

Discovery (VibeCheck → SneakPeek) runs as a [LangGraph](https://github.com/langchain-ai/langgraph) state machine, streamed live to the UI over SSE. Checkout and payment (CartUp → GreenLight → PayIt → TrackIt) run as direct, auditable function calls behind REST endpoints.

---

## Features

### Conversation & intelligence
- **Any question answered** — LLM replies naturally to general knowledge, advice, or chitchat, not a scripted fallback
- **Natural language intent extraction** — "blue Nike size 10 under $100" → structured `ShoppingIntent`
- **Product follow-up** — "which one is better?", "is the first one waterproof?", "compare the top two" answered from session context
- **LLM-driven cart operations** — "add the first one", "remove it", "show me my cart", all understood by the LLM
- **Affirmative replies** — "yes", "ok", "sure" after the agent's CTA triggers the correct action
- **Context merging** — "make it Nike" updates the previous search without restarting
- **Show more** — "what else?" returns products 6–10 from the original search, no new query
- **Streaming text** — recommendation appears word-by-word at 40 ms/word with a live cursor
- **Voice input** — real audio waveform level meter (32-bar visualizer) while mic is active
- **Image-paste search** — paste an image; AI infers category and attributes to find similar items

### Product display
- **137 products** across 11 categories, 73 brands, 3 merchants, $14.99–$1,399
- **Match checkmarks** — every card shows which constraints were verified (✓ blue ✓ size 10 ✓ under $100)
- **Sort bar** — Best Match · ↓ Price · Top Rated · Fastest — client-side re-sort per turn
- **Same-model deduplication** — highest-scored variant shown when multiple sizes/colors match
- **Follow-up chips** — auto-generated smart suggestions after each result set
- **Delivery urgency** — ⚡ Arrives tomorrow, computed from today's date
- **Merchant trust badges** — Verified / Premium tier, ships-in time, return policy

### Compare mode
- Select 2–4 products → Compare button in floating bar
- Side-by-side spec table with best price / top rating / fastest delivery highlighted
- AI Recommendation panel — LLM picks the winner with numbered reasoning and trade-off bullets

### Cart & checkout (inline in chat)
- **Inline cart card** — added product + full cart list + total + View Cart / Proceed to Checkout buttons
- **Inline order summary** — product, subtotal, tax, shipping, card selection, Confirm & Pay
- **Animated payment pipeline** — live GreenLight → PayIt → TrackIt progress in the chat turn
- **Inline order confirmation** — Order ID, amount, loyalty points, collapsible order tracker
- **Guest checkout** — secure card entry modal; card details never appear in chat
- **Session card memory** — guest card pre-filled for repeat checkouts in the same session
- **Enter key submits** — the card details form responds to Enter

### Payment security (DPAT model)
- Token scoped to one merchant, one amount, one checkout hash, one use, 15-minute TTL
- Agent holds only the token ID — card number and CVV never enter the AI pipeline
- 12 deterministic guardrail checks before payment executes
- Any check failure → `PAYMENT_BLOCKED` with reason code, logged to audit trail

### Session & persistence
- **Full conversation history** — ChatGPT-style session sidebar, resumable
- **Cross-navigation restore** — returning from /cart or /dashboard shows the exact conversation state
- **Checkout state persisted** — in-progress checkout survives tab navigation
- **Order confirmation persisted** — completed payment shows the order card, not raw product cards

### Agent pipeline panel
- **6-agent horizontal flowchart** with animated arrows and status badges
- **Per-agent detail** — click to expand; shows key-value output table + step trace
- **All agents always visible** — idle agents show their role description when expanded
- **Session accumulation** — complete step history across all turns: search + payment in one view
- **Pipeline progress bar** — N / 6 with gradient fill

### Auth & identity
- Known Customer / Guest two-CTA landing page
- JWT + bcrypt registered accounts
- Guest checkout with session-scoped card memory
- Loyalty points: 1 pt per $1 on every confirmed order

---

## Tech stack

**Backend:** FastAPI · Python 3.12 · SQLAlchemy · SQLite · Pydantic v2 · LangGraph · Gemini 2.0 Flash Lite (+ Ollama fallback) · NeMo Guardrails · Guardrails AI · PyJWT · bcrypt · Arize Phoenix

**Frontend:** React 18 · TypeScript · Vite · Tailwind CSS · Framer Motion · React Router v6 · Lucide React · SSE (EventSource)

---

## Project structure

```
backend/
  agents/        VibeCheck, SneakPeek, CartUp, GreenLight, PayIt, TrackIt
  graph/         LangGraph discovery workflow + per-session state
  payment/       Guardrail engine, HMAC signing, mock processor
  routers/       FastAPI endpoints (auth, chat, cart, checkout, payments, ...)
  db/            SQLAlchemy schema + seeding
  merchants/     Local catalog + Shopify/DummyJSON adapter stubs
frontend/
  src/pages/       Chat (main), Cart, Dashboard, Login
  src/components/  AgentTrailPanel, InlineCheckout, CartDrawer, ProductCard, ...
  src/api/         Typed fetch clients per backend router
data/            Seed catalog (products.json, merchants.json)
tests/           pytest suite
docs/product.md  Full product document with v2 feature details
status.md        Version-by-version build log
plan.md          v2 task tracker and build diary
```

---

## Getting started

### Backend

```bash
pip install -r requirements.txt
cp .env.example .env        # set GOOGLE_API_KEY (see .env.example)
python -m backend.db.init_db
uvicorn backend.main:app --reload --port 8000
```

LLM priority: Gemini 2.0 Flash Lite if `GOOGLE_API_KEY` is set → Ollama + Llama 3.2 if running locally → setup error.

### Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5175
```

### Try it

```
email:    demo@talkshop.io
password: demo1234
```

Then ask: *"Find running shoes, size 10, under $100"* — or anything else.

---

## Running tests

```bash
python -m pytest tests/ -v
```

---

## Limitations

This is a proof of concept, not a production payment system:

- **Payment is simulated** — no real card network or bank connection; no real money moves
- **Merchant search is a seeded local catalog** — the Shopify/DummyJSON adapters exist but have no live credentials
- **The MCP tool layer** is structured correctly but called in-process, not over a real MCP transport
- **Multi-item checkout** processes each item as its own order rather than one combined order

See [`docs/product.md`](docs/product.md) for the full product document, [`status.md`](status.md) for the detailed build log, and [`plan.md`](plan.md) for the v2 task tracker.
