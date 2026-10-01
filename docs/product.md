# Talkshop — Product Document

> **Conversational AI commerce.** You describe what you want. A multi-agent pipeline finds it, secures the payment, and tracks the order — all from a single chat window.

---

## Is it demo-ready?

**Yes.** The full purchase flow works end-to-end today:

```
Chat → Search → Results → Add to Cart → Cart Review → Checkout → Order Confirmation → Order Tracker
```

All filters (color, size, brand, price, delivery date) work. Wallet and card payments both work. The AI recommendation, compare mode, and streaming responses are live. Three merchants, 137 products, 11 categories.

---

## Product Catalog

| Stat | Value |
|---|---|
| Total products | 137 |
| Available categories | 11 |
| Unique brands | 73 |
| Merchants | 3 |
| Price range | $14.99 – $1,399.00 |
| Average price | $173.92 |

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

### End-to-end flow

```
User types (or speaks) a shopping request
          │
          ▼
 VibeCheck (Agent 1) — extracts structured intent from free text
   • color, size, brand, price ceiling, delivery deadline, occasion
   • asks a clarifying question if intent is too vague
   • NeMo Guardrails block harmful / off-topic requests
          │
          ▼
 SneakPeek (Agent 2) — multi-store product search
   • fans out to 3 merchant adapters in parallel
   • deterministic filter: size, price, color, category, delivery
   • deterministic ranking score: budget fit, brand match, rating, speed
   • returns top 5 results ranked by relevance
          │
          ▼
 Chat UI streams results — skeleton cards → real cards with match tags
          │
          ▼
 User adds to cart → CartUp (Agent 3) assembles order
          │
          ▼
 Cart page — session vs. previous split, wallet or card selection
          │
          ▼
 GreenLight (Agent 4) — issues DPAT (Delegated Payment Auth Token)
   • scoped: bound to this merchant, this amount, this checkout hash
   • single-use, 15-minute TTL
   • 12 deterministic guardrail checks before any token is issued
          │
          ▼
 PayIt (Agent 5) — validates token, executes mock payment
   • wallet: checks and deducts balance
   • card: mock processor approves, no balance check
          │
          ▼
 TrackIt (Agent 6) — records order, updates Order Tracker
          │
          ▼
 Order Tracker — live delivery status, purchase history, spend summary
```

### What the LLM does vs. what is deterministic

| Concern | Handled by |
|---|---|
| Understanding natural language | LLM (VibeCheck) |
| Writing recommendation text | LLM (VibeCheck) |
| Answering "which one should I buy?" | LLM (Compare endpoint) |
| Product search and filtering | Deterministic (SneakPeek) |
| Ranking score | Deterministic (SneakPeek) |
| Price, inventory, delivery data | Merchant DB — never LLM |
| DPAT token issuance | Deterministic service |
| Payment guardrail checks | Deterministic (12 checks) |
| Payment execution | Mock processor (deterministic) |

**The LLM never touches financial values.** It only writes prose.

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

## Features Built

### Conversation & search
- **Natural language intent extraction** — "blue Nike size 10 under $100" → structured `ShoppingIntent` with color, brand, size, price fields
- **Composite category aliases** — "shoes" correctly searches running_shoes + sneakers + boots in one query
- **Color fallback** — if no blue sneakers found, expands to all footwear before returning zero results
- **Smart no-results message** — names exactly what failed ("No blue running shoes under $80") and suggests the most actionable fix ("Try raising budget to $104?")
- **Follow-up clarification** — asks one question when intent is too vague, then proceeds
- **Context merging** — "make it Nike" updates the previous intent without restarting the search
- **Streaming response text** — recommendation appears word by word at 40 ms/word with a live cursor

### Product display
- **Match checkmarks** — every card shows `✓ blue  ✓ size 10  ✓ under $100` — the exact constraints the AI verified
- **Match tag tooltips** — hover a checkmark to see why that constraint was matched for that product
- **Sort bar** — Best Match · ↓ Price · Top Rated · Fastest re-sorts cards client-side, no new query
- **Horizontal scroll row** — cards scroll sideways, always visible without vertical crowding
- **Skeleton cards** — three ghost cards pulse while the search pipeline runs
- **Delivery urgency** — `⚡ Arrives tomorrow` or `📦 Arrives Oct 5` computed from today's date; fast deliveries glow green
- **Image lightbox** — click a product image → full-screen overlay with spring animation and zoom-in cursor
- **Merchant trust badges** — Verified / Premium badge, ships-in time, return policy on every card

### Compare mode
- Select 2–4 products → **Compare** button appears in the floating bar
- Side-by-side spec table: price, rating, reviews, color, size, arrival, shipping, merchant
- Best price in green, top rating in amber, fastest delivery in green
- **AI Recommendation panel** — LLM analyses the products and explains which wins overall, with 2–3 sentence reasoning citing actual numbers and one trade-off bullet per other product
- **Best Pick** badge and column highlight on the AI winner
- Each column has an Add to Cart button

### Cart & checkout
- **Cart drawer** — slides in over the chat; no navigation away. Shows session vs. previous items, qty controls, remove, wallet balance
- **Session-aware cart split** — items added in the current chat are shown separately from older items
- **Wallet / card picker** — choose payment method in the cart page; card bypasses wallet balance
- **Insufficient balance guard** — wallet payments are greyed out with an amber warning if balance is too low
- **Checkout page** — read-only order summary, "Paying with…" line, approve button, security footer
- **Multi-item checkout** — all cart items process in sequence; each shows a status badge (Queued → Authorizing → Paid / Blocked)
- **Retry on error** — individual items can be retried without re-running the whole cart

### Payment security (DPAT model)
- DPAT token is scoped to one merchant, one amount, one checkout hash, one use, 15-minute TTL
- Agent holds only the token ID — card number and CVV never enter the AI pipeline
- **12 deterministic guardrail checks**: token exists, not expired, not consumed, agent match, merchant match, order match, currency match, amount ≤ authorized, amount == checkout total, hash match, consent record exists, balance (wallet only)
- Any check failure → PAYMENT_BLOCKED with reason code, logged to audit trail

### Order tracker (Dashboard)
- Metric cards: total sessions, approved orders, blocked transactions, total spend
- Sortable order table: sort by purchase date or arrival date ascending/descending
- Date range filter: narrow orders to any custom date window
- Arrival dates displayed as real dates ("Arrives Oct 5"), not "in X days"
- Order status: paid / blocked, with reason code on blocked rows

### Voice input
- Hold-to-speak microphone with real audio waveform level meter (32-bar visualizer)
- Continuous recognition — pauses don't end the session
- Works in Chrome and Edge; graceful error message on unsupported browsers

### Image search
- Paste a screenshot of a product → AI infers category and visual attributes to find similar items
- Image is resized client-side before upload (max 768px, 70% quality) to keep requests fast

### Session management
- Full conversation history across sessions; sidebar mirrors the ChatGPT thread pattern
- Sessions restored on tab return from Cart / Dashboard
- New session clears the cart strip and session-item tracking

---

## Security & Trust Model

```
User sees:       Natural language request → product cards → approve button

AI pipeline:     VibeCheck → SneakPeek → CartUp → GreenLight → PayIt → TrackIt

What AI can do:  Understand intent, search products, explain recommendations

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

---

## Future Scope

### Near-term (days)

| # | Feature | Effort | Value |
|---|---|---|---|
| 1 | **Voice as hero CTA** — large hold-to-speak button, primary interaction pattern | 2–3 h | High |
| 9 | **One-tap reorder** — Reorder button in Order Tracker re-runs the same purchase | 2–3 h | Medium |
| 13 | **Budget tracking** — today's spend and monthly spend summary on Order Tracker | 3–4 h | Medium |
| 16 | **Order confirmation email** — fires when PayIt confirms; uses email already in DB | 2–3 h | High |
| 17 | **Order status update emails** — simulated shipped / delivered progression | half-day | Medium |

### Medium-term (weeks)

| # | Feature | Effort | Notes |
|---|---|---|---|
| 4 | **Preference learning** — notices patterns (always Nike, always size 10) and pre-fills them | 1–2 days | Needs user_preferences DB table |
| 18 | **Real shipping tracking** | 1 day | EasyPost free sandbox; real tracking numbers |
| 19 | **WhatsApp notifications** | 1–2 days | Twilio; needs phone field on user profile |
| 11 | **Price drop alerts** | 1–2 days | Background watcher job per saved intent |

### ML recommendation system (future)

The current ranking is deterministic (price fit, rating, delivery speed, brand match). A machine learning layer would make it adaptive:

| Model | What it learns | Input signals | Output |
|---|---|---|---|
| **Collaborative filtering** (user-based) | Users with similar purchase history tend to like similar products | Order history, cart additions, session patterns | "Users like you also bought..." |
| **Content-based filtering** | Map product attributes to user preference vectors | Category, brand, color, price tier, delivery preference | Personalized ranking overlay on SneakPeek results |
| **Session-based recommendation** (RNN / transformer) | What a user adds to cart mid-session predicts what else they want | Current session actions in sequence | "You might also like" after Add to Cart |
| **Price elasticity model** | Each user has a price sensitivity per category | Historical max_price vs. actual purchase price | Smarter budget suggestions in no-results messages |
| **CTR / conversion model** | Which card position and attributes drive Add to Cart | Card index, match tags shown, sort mode, image presence | Re-rank cards to maximise conversion |
| **LLM fine-tune on product corpus** | Domain-specific intent extraction | Talkshop order + query history | Better attribute extraction for niche queries ("wide toe box", "waterproof") |

**Recommended starting point:** A lightweight collaborative filtering model trained on the order history table — even with 50–100 orders it produces meaningful signals. Can be implemented in scikit-learn, served as a `/api/recommendations` endpoint, and blended into SneakPeek's ranking score with a configurable weight.

### Larger scope

| # | Feature | Notes |
|---|---|---|
| 12 | **Collaborative shopping** — share session link, vote on products | Multi-user real-time |
| 14 | **Proactive recommendations** — "You bought running shoes 6 months ago" | Cron job over order history |
| 15 | **Live merchant integrations** — real Shopify / BestBuy inventory | API credentials needed |
| 20 | **Price drop alert emails** | Extends item 11; watcher job per intent |

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
