# TalkShop — Product Document

> **Conversational AI commerce.** You describe what you want — or just ask anything. A multi-agent pipeline finds it, secures the payment, and tracks the order, all without leaving the chat window.

---

## Is it demo-ready?

**Yes.** The full purchase flow works end-to-end today, entirely in one chat window:

```
Ask anything → Search → Results → "Add to cart" → Inline cart review →
"Proceed to checkout" → DPAT authorization → Payment → Order confirmation
```

No page navigation required. All natural language. Filters, voice input, image search, and guest checkout all work. Three merchants, 137 products, 11 categories. Works for both registered and guest users.

---

## Version 2 Highlights (current)

Version 2 transformed TalkShop from a multi-page app into a fully conversational single-screen experience.

### LLM-Driven Everything

Every interaction — not just product searches — is now handled by the LLM:

- **Any question answered** — ask about general knowledge, advice, or shopping help. The agent replies naturally, not with a scripted fallback.
- **Follow-up questions** — "which one is better for trail running?", "is the first one waterproof?", "compare the top two" — all answered with real product facts from the current session.
- **Cart operations by voice or text** — "add the first one to cart", "remove it", "show me my cart", "add the Nike ones" — the LLM understands what you mean and executes the right action.
- **"Show more"** — "what else do you have?", "show me more options" — returns products 6–10 from the original search without a new query.

### Inline Commerce — Zero Page Navigation

The entire purchase flow happens inside the chat:

1. Agent recommends a product and asks "Want me to add it to your cart?"
2. Say "yes" or "add it" → inline cart card appears showing the added product, all cart items, total, and action buttons
3. Click "Proceed to Checkout →" → order summary card appears in chat with product details, tax, shipping
4. Click "Confirm & Pay" → live payment pipeline streams: GreenLight authorization → PayIt execution → TrackIt confirmation
5. Order confirmed card shows in chat with order ID, amount, loyalty points

### Live Agent Pipeline Panel

The right panel shows a real-time execution trace of the 6-agent pipeline:

- Horizontal flowchart: VibeCheck → SneakPeek → CartUp → GreenLight → PayIt → TrackIt
- Each node animates live: idle → running (amber pulse) → done (green) → error (red)
- Click any agent to see its detailed output: what it found, what it decided, what it produced
- Panel persists the full history of the session — search steps AND payment steps in one view

### Session Persistence

- Navigate to /cart or /dashboard and come back — the conversation is exactly where you left it
- Mid-checkout: the order summary card re-appears on return, card details pre-filled
- Post-payment: the order confirmation shows, not the product cards

---

## Product Catalog

| Stat | Value |
|---|---|
| Total products | 137 |
| Available categories | 11 |
| Unique brands | 73 |
| Merchants | 3 |
| Price range | $14.99 – $1,399.00 |

### Categories

| Category | Products | Example Brands |
|---|---|---|
| Running shoes | 30 | Nike, Brooks, New Balance, Adidas, ASICS |
| Electronics | 25 | Sony, Apple, Samsung, Bose, Jabra |
| Accessories | 25 | Garmin, Ray-Ban, Coach, Fossil |
| Clothing | 23 | Zara, H&M, Calvin Klein, Ralph Lauren, Adidas |
| Sneakers | 10 | Nike, Vans, Converse, Puma |
| Laptops | 6 | Apple, Dell, Lenovo, ASUS |
| Watches | 4 | Garmin, Fossil, Casio |
| Phones | 4 | Apple, Samsung |
| Boots | 4 | Timberland, Dr. Martens |
| Sunglasses | 3 | Ray-Ban, Oakley |
| Bags | 3 | Coach, Herschel |

### Merchants

| ID | Name | Trust Tier | Ships In | Returns |
|---|---|---|---|---|
| MERCHANT_A | RunnerWorld | Verified | 24 hours | 30 days |
| MERCHANT_B | TechStore | Verified | 48 hours | 14 days |
| MERCHANT_C | FashionHub | Premium | Same day | 60 days |

---

## How It Works

### End-to-end flow (v2)

```
User types or speaks any message
          │
          ▼
 VibeCheck (Agent 1) — LLM orchestrator
   • classify_message_intent() — is this a product search, follow-up, or chitchat?
   • If chitchat/general: answer_general_message() — LLM answers any question naturally
   • If product follow-up: answer_product_question_with_action() — answers + returns action
   • If new search: extract_intent() → structured ShoppingIntent (color, size, brand, price...)
   • Asks one clarifying question if intent is too vague
   • NeMo Guardrails blocks harmful / off-topic requests
          │  (only for new searches)
          ▼
 SneakPeek (Agent 2) — multi-store product search
   • Fans out to 3 merchant adapters in parallel
   • Deterministic filter: size, price, color, category, delivery
   • Deterministic ranking score: budget fit, brand match, rating, speed
   • Deduplicates same-model products (highest-scored variant kept)
   • Stores top 10; emits top 5 to UI; remainder surfaced on "show more"
          │
          ▼
 Chat UI streams results — skeleton cards → real cards with match tags
 Right panel flowchart lights up node by node
          │
          ▼
 User adds to cart (via LLM action or affirmative reply)
          │
          ▼
 CartUp (Agent 3) — inline in chat
   • Calls addToCart() API
   • Creates checkout session (subtotal, tax, shipping, tamper hash)
   • Inline cart card appears in chat: added product + all cart items + total
   • "Proceed to Checkout →" button triggers payment flow
          │
          ▼
 GreenLight (Agent 4) — issues DPAT token
   • Scoped: one merchant, one amount, one checkout hash
   • Single-use, 15-minute TTL
   • 12 deterministic guardrail checks
   • Step appears live in chat AND in right panel
          │
          ▼
 PayIt (Agent 5) — validates token, executes payment
   • Independently re-runs guardrail checks (does not trust GreenLight's issuance)
   • Mock processor approves; step appears live in both panels
          │
          ▼
 TrackIt (Agent 6) — confirms order
   • Writes to order table, updates loyalty balance
   • "Order Confirmed" card appears in chat turn
   • Right panel shows full 6/6 pipeline complete
```

### What the LLM does vs. what is deterministic

| Concern | Handled by |
|---|---|
| Classifying message intent | LLM (VibeCheck) |
| Answering any general question | LLM (VibeCheck — `answer_general_message`) |
| Answering follow-ups about products | LLM (VibeCheck — `answer_product_question_with_action`) |
| Extracting structured shopping intent | LLM (VibeCheck) |
| Deciding which cart action to take | LLM (returns `{text, action}`) |
| Writing recommendation text | LLM (VibeCheck) |
| Product search and filtering | Deterministic (SneakPeek) |
| Ranking score | Deterministic (SneakPeek) |
| Price, inventory, delivery data | Merchant DB — never LLM |
| DPAT token issuance | Deterministic service |
| Payment guardrail checks (12 checks) | Deterministic (GreenLight) |
| Payment execution | Mock processor (deterministic) |

**The LLM never touches financial values.** It only classifies intent, routes actions, and writes prose.

---

## Tech Stack

### Frontend
| Layer | Technology | Why |
|---|---|---|
| Framework | React 18 + Vite + TypeScript | Fast HMR, strong types |
| Styling | Tailwind CSS + CSS variables | Dark/light mode, token-based theming |
| Animation | Framer Motion | Smooth agent step reveals, drawer slides, spring modals |
| Routing | React Router v6 | SPA with clean page transitions |
| Icons | Lucide React | Consistent, tree-shakeable |
| State | useState / useCallback / useRef | No external store needed at this scale |
| Streaming | EventSource (SSE) | Real-time agent step updates without WebSocket overhead |
| Session persistence | sessionStorage | Survives tab navigation, clears on new tab |

### Backend
| Layer | Technology | Why |
|---|---|---|
| API framework | FastAPI (Python 3.12) | Async-native, auto OpenAPI, lightweight |
| Agent orchestration | LangGraph 0.2+ | Stateful graph, human-in-the-loop pauses |
| Primary LLM | Gemini 2.0 Flash Lite | Free tier (30 RPM / 1,500 RPD), fast, good structured output |
| LLM fallback | Ollama + Llama 3.2 | Fully offline — demo works with no internet |
| Input guardrail | NeMo Guardrails (Colang rails) | Blocks harmful / off-topic requests before LLM sees them |
| Output guardrail | Guardrails AI | Schema-validates LLM structured outputs before they enter the pipeline |
| Database | SQLite + SQLAlchemy ORM | Zero infra, file on disk, human-readable for demos |
| Data validation | Pydantic v2 | Hard typing wall between LLM outputs and financial fields |
| Observability | Arize Phoenix | Local LLM trace viewer at localhost:6006 |
| Payment auth | Custom DPAT service (Python) | Deterministic, no LLM in payment path |

### Merchant adapters
| Adapter | Source | Notes |
|---|---|---|
| Local (primary) | SQLite catalog | Always available, 137 seeded products |
| DummyJSON | External API | Extra products, graceful fallback if offline |
| Shopify | Storefront API | Optional — works if credentials are present |

---

## Full Feature List

### Conversation & intelligence
- **LLM message classification** — every message classified as `product_followup`, `new_search`, or `chitchat` before pipeline routes it
- **Any question answered** — LLM replies naturally to general knowledge, advice, greetings, or anything else
- **Natural language intent extraction** — "blue Nike size 10 under $100" → structured `ShoppingIntent`
- **Product follow-up understanding** — "which one is better for trail running?", "is the first one waterproof?" answered from session context
- **Cart operations by text** — "add the first one to cart", "remove it", "show me my cart"
- **Affirmative intent** — "yes", "ok", "sure" after the agent's CTA triggers the correct action
- **Context merging** — "make it Nike" updates the previous search without restarting
- **Follow-up clarification** — asks one focused question when intent is too vague
- **Streaming text** — recommendation appears word by word at 40 ms/word with a live cursor
- **History-based personalization** — last 3 orders passed to recommendation prompt for personal relevance

### Product display
- **Top 5 shown, top 10 stored** — "show me more" surfaces products 6–10 without a new search
- **Match checkmarks** — every card shows which constraints were verified (✓ blue ✓ size 10 ✓ under $100)
- **Sort bar** — Best Match · ↓ Price · Top Rated · Fastest — client-side re-sort per turn
- **Follow-up chips** — auto-generated smart chips after each result set
- **Skeleton cards** — ghost cards pulse during search (not during follow-ups)
- **Same-model deduplication** — highest-scored variant shown when multiple sizes/colors match
- **Delivery urgency** — `⚡ Arrives tomorrow` computed from today's date
- **Merchant trust badges** — Verified / Premium tier, ships-in time, return policy

### Compare mode
- Select 2–4 products → Compare button in floating bar
- Side-by-side spec table with best price / top rating / fastest delivery highlighted
- AI Recommendation panel — LLM picks winner with numbered reasoning and trade-off bullets

### Cart & checkout (inline)
- **Inline cart card** — product + all cart items + total + View Cart / Proceed to Checkout buttons
- **Inline order summary** — product, subtotal, tax, shipping, card selection, Confirm & Pay button
- **Animated payment pipeline** — live step-by-step GreenLight → PayIt → TrackIt progress in chat
- **Inline order confirmation** — Order ID, amount, loyalty points, collapsible order tracker
- **Guest checkout** — secure card entry modal (card details never appear in chat)
- **Session card memory** — guest card pre-filled on repeat checkout within the same session
- **Enter key in modal** — submits card details form

### Payment security (DPAT model)
- DPAT token scoped to one merchant, one amount, one checkout hash, one use, 15-minute TTL
- Agent holds only the token ID — card number and CVV never enter the AI pipeline
- 12 deterministic guardrail checks before payment executes
- Any check failure → PAYMENT_BLOCKED with reason code, logged to audit trail

### Session & persistence
- **Full conversation history** — ChatGPT-style session sidebar, resumable
- **Cross-navigation restore** — returning from /cart or /dashboard shows the exact same chat state
- **Checkout persistence** — in-progress checkout survives navigation; no card re-entry
- **Order confirmation persistence** — completed payment shows confirmation card, not product cards

### Agent pipeline panel (right)
- **6-agent flowchart** — horizontal pipeline with animated arrows and status nodes
- **Per-agent detail** — click any agent to see its output table and step timeline
- **All agents visible** — idle agents shown with descriptions, not hidden
- **Session accumulation** — full history of all steps (search + payment) in one view
- **Pipeline progress bar** — N / 6 with gradient fill

### Voice & image
- Real audio waveform level meter (32-bar visualizer) while mic is active
- Image paste — AI infers category and visual attributes to find similar items
- Graceful browser fallback message for unsupported browsers

### Auth & identity
- Known Customer / Guest two-CTA landing page
- JWT + bcrypt registered accounts
- Guest checkout with session-scoped card memory
- Loyalty points: 1 pt per $1 on every confirmed order; balance shown after payment

---

## Security & Trust Model

```
User sees:       Natural language → product cards → confirm button

AI pipeline:     VibeCheck → SneakPeek → CartUp → GreenLight → PayIt → TrackIt

What AI can do:  Understand intent, search products, write recommendations,
                 answer any question, route cart actions

What AI cannot:  Read card numbers or CVV, modify prices, change merchant ID,
                 create or consume DPAT tokens, override guardrail decisions

Trust boundary:  DPAT service is deterministic Python — no LLM in the payment path
```

**Demo talking points:**
- The agent cannot route money to a different merchant even if instructed to
- Tampered amounts are blocked at guardrail check 9 (amount ≤ authorized)
- Expired tokens are blocked at check 3; replayed tokens at check 4
- Every step is logged to the audit trail with timestamps and reason codes

---

## How to Run

```bash
# Backend
uvicorn backend.main:app --reload --port 8000

# Frontend (requires Node.js 22.12+)
cd frontend && npm run dev          # runs on http://localhost:5175
```

LLM priority order at startup:
1. Gemini 2.0 Flash Lite — if `GOOGLE_API_KEY` is set in `.env`
2. Ollama + Llama 3.2 — if Ollama is running at `localhost:11434`
3. Hard stop with setup instructions

Demo login:
```
email:    demo@talkshop.io
password: demo1234
```

---

## What Not to Say in the Demo

| Say | Don't say |
|---|---|
| "MCP-based merchant capability access" | "We implemented ACP or UCP" |
| "Simulated scoped payment token (DPAT-inspired)" | "Visa / Mastercard Agentic Tokens" |
| "Deterministic payment guardrails" | "We securely processed real credit cards" |
| "Human-in-the-loop purchase approval" | "The agent has access to the user's card" |
| "Local mock payment processor" | "This is a live bank integration" |
| "AI-powered product ranking" | "This uses deep learning" (it's deterministic today) |

---

## Future Scope (v3)

| Feature | Notes |
|---|---|
| UCP merchant discovery | Real-time merchant catalog via Universal Commerce Protocol |
| ACP agent-to-bank token handshake | Stripe ACP / Visa Agentic Token integration |
| One-tap reorder | Reorder button re-runs the same purchase |
| Price drop alerts | Background watcher per saved intent |
| Real shipping tracking | EasyPost free sandbox |
| WhatsApp order notifications | Twilio integration |
| Preference learning | Notices patterns (always Nike, always size 10), pre-fills them |
| Collaborative filtering | Personalized ranking from order history |
| X402 micropayments | Machine-to-machine payment protocol |
