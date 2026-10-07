# Talkshop 

---

## The One-Line Pitch

**Talkshop is a conversational AI commerce platform. You describe what you want in plain language, and a multi-agent pipeline finds it, secures the payment, and tracks the order — entirely from a chat window.**

No search bar. No filter dropdowns. No form to fill. Just a conversation.

---

## Act 1 — The Problem We're Solving (1 min)

> Set the stage before touching the screen.

**Talk track:**

"Today's e-commerce UX is a form problem. The user knows what they want — 'blue Nike running shoes, size 10, under a hundred dollars, arriving before Friday' — but they have to translate that into four separate filters and a category nav. Then they get 200 results.

What if the interface just understood them? That's Talkshop.

We built a six-agent pipeline on top of an LLM that takes natural language as the only input, and handles everything downstream — search, ranking, cart, payment authorization, and order tracking — in a single session."

---

## Act 2 — Login & Chat Page (2 min)

> Open the app. Log in. Land on the chat.

**Login screen — two options:**
- **Customer** — opens a tab switcher: Log in (returning) or Sign up (new). One card, both flows.
- **Continue as Guest** — name + email only; card details are entered at checkout, never stored.

**What the chat screen shows:**
- Clean dark/light toggle header with cart badge and "Order Tracker ↗" link
- Left sidebar with previous sessions (like ChatGPT threads)
- Central text input with a microphone button
- Orders panel on the right (collapsible live feed of recent orders)

**Talk track:**

"The entry point is a chat window. Nothing else. Users can type or hold the mic to speak — the voice input has a real-time waveform visualizer, so they get feedback they're being heard.

The sidebar preserves every past conversation. Sessions are restored on return — including any in-progress checkout. So if a user came back from the cart page, they pick up exactly where they left off.

Guests get the full experience. They enter payment details once at checkout via a secure modal; that card is remembered for the rest of the session so they're not asked twice."

**Key message for directors:**
> Session continuity is a trust feature. The user never loses their thread.

---

## Act 3 — Talking to the Agent (3 min)

> Type: "Show me blue Nike running shoes size 10 under $120"

**What happens (live, on screen):**
1. Three skeleton cards pulse while the pipeline runs
2. Agent trail reveals: **VibeCheck → SneakPeek**
3. Streaming recommendation text appears word-by-word
4. Real product cards load with match checkmarks

**Talk track:**

"Under the hood, there are six named agents. The first, VibeCheck, reads the intent — color, brand, size, price ceiling, delivery deadline — and turns it into a structured object. It never guesses; if the request is too vague, it asks one clarifying question.

The second agent, SneakPeek, fans out to three merchant stores simultaneously, filters by the exact constraints, and ranks results by price fit, brand match, rating, and delivery speed.

The cards show match checkmarks — blue, size 10, under $120 — so the user sees exactly why each result was returned. Hover a checkmark and it explains the match in a tooltip."

**Demonstrate the sort bar:**
- Click "Price ↓" — cards re-sort instantly, no new query
- Click "Fastest" — delivery urgency glows green for next-day items

**Key message:**
> The LLM extracts intent. A deterministic engine does the search and ranking. This means results are reproducible and explainable — not a black box.

---

## Act 4 — Compare Mode & AI Verdict (2 min)

> Select 2–3 products. Click Compare.

**What happens:**
- Side-by-side spec table
- Best price highlighted green, top rating in amber, fastest delivery in green
- AI Recommendation panel loads below with 2–3 sentence reasoning

**Talk track:**

"When a user can't decide, they select up to four products and hit Compare. The AI reads the actual specs — not marketing copy — and explains which one wins and why, citing specific numbers. It also flags the trade-off for every other option.

The winning column gets a Best Pick badge. Each column has its own Add to Cart button."

**Key message:**
> This is the LLM doing what LLMs are good at: synthesizing tradeoffs in prose. The underlying data — prices, ratings, delivery times — comes from deterministic sources, not the model.

---

## Act 5 — Inline Checkout & Cart (3 min)

> Say "yes" or "buy it" after the agent recommends a product.

**What happens — inline checkout flow (no page navigation):**
1. The agent asks "Want me to add this to your cart?" with quick-action chips (Yes / No thanks)
2. User says yes (or types "buy it", "proceed", etc.) → **Order Summary card appears inside the chat bubble**
3. Summary shows: product, merchant, subtotal / tax / shipping / total, and a saved card picker
4. Returning customers see their saved cards (Visa, Mastercard, Amex) — pick one and confirm
5. Guest users click "Secure Payment" → modal collects card details once, never stored in chat
6. User clicks **Confirm & Pay** → multi-step status animation runs inline (GreenLight → PayIt → TrackIt)
7. Confirmed card appears with order ID, total, loyalty points earned, and a collapsible order tracker
8. **"📦 Track my orders"** button fades in — clicking it drops a live tracker directly in the chat thread

**Cart drawer — for multi-item or deferred purchases:**
- Slides in over the chat (no page navigation)
- Items split: "Added This Session" vs. "Earlier"
- Wallet or card payment; wallet grays out with amber warning if balance is insufficient
- Proceed to Checkout → multi-item checkout page processes each item sequentially with status badges

**Talk track:**

"The entire purchase can happen without ever leaving the chat. The user says yes — an order summary card appears right there in the conversation. They pick a saved card and confirm. Three animated steps run inline, then the confirmed state appears with their order ID and points earned.

For users buying multiple items, or who added to cart earlier, the cart drawer gives a full view — session items flagged separately so nothing looks auto-added. Everything is read-only at approval time. The user sees exactly what they're approving before anything is charged."

**Key message:**
> Human-in-the-loop. The AI assembles the cart, but the user clicks Approve. Nothing is charged without explicit consent. The entire flow — from discovery to confirmation — never leaves the chat window.

---

## Act 6 — Payment Security: The DPAT Model (2 min)

> This is the architecture slide, not a UI moment. Talk while on the checkout screen.

**Talk track:**

"Here's the part that matters most from a risk and compliance perspective.

When the user clicks Approve, the system issues what we call a DPAT — a Delegated Payment Authorization Token. This is a scoped, single-use cryptographic token:

- Bound to **this merchant** only
- Bound to **this exact amount**
- Bound to **this checkout hash**
- Expires in **15 minutes**
- **One use only**

The AI agent never sees a card number. It only holds the token ID.

Before any money moves, the system runs 12 deterministic guardrail checks — token not expired, not already used, amount matches, merchant matches, hash matches, balance check. Any single failure blocks the payment and logs a reason code.

The LLM is completely out of the payment path. The trust boundary is enforced by a deterministic Python service, not a model."

**Key message:**
> The AI can't route money to a different merchant, even if instructed to. Tampered amounts are blocked at check 9. Replayed tokens are blocked at check 4. Everything is audited.

---

## Act 7 — Order Tracker: In Chat & Dashboard (2 min)

> After confirming a purchase, click "📦 Track my orders". Or type "track my order" at any time.

**Inline tracker — right inside chat:**
- Appears as a chat bubble with a header showing "X on the way · Y delivered"
- Each order is a collapsible card showing:
  - Product name, merchant, amount, purchase date
  - Real-time status badge (Processing / Shipped / Delivered / Blocked)
  - **5-step delivery stepper**: Order Placed → Processing → Shipped → Out for Delivery → Delivered — current step highlighted, completed steps in green
  - Estimated arrival date ("Tomorrow", "Oct 12", etc.)
  - Tracking number with one-click copy
- Active/in-transit orders shown expanded at the top; delivered orders collapsed below
- "Full dashboard →" link at the bottom

**Triggered two ways:**
1. **After purchase** — "📦 Track my orders" button fades in below the confirmed card
2. **Any time** — type "track my order", "where's my package", "order status", "when will it arrive", etc.

**Full Dashboard:**
- Metric cards: total sessions, approved orders, blocked transactions, total spend
- Sortable order table with delivery status badges and date range filter
- Every blocked payment shows its reason code — full audit trail

**Talk track:**

"After a purchase confirms in chat, a Track my orders button appears. Click it and the tracker drops right into the conversation — no navigation, no new tab. Each order shows exactly where it is in the pipeline with a live step indicator and the expected arrival date.

Users can also just ask — 'where's my package' or 'order status' — and get the same tracker bubble at any point in the session.

The full dashboard is still there for a complete historical view with sortable tables and audit logs."

---

## Act 8 — Voice & Image Search (30 sec)

> Quick demo — hold the mic or paste an image.

**Talk track:**

"Two more input modes: hold the mic and speak naturally — the waveform shows real audio levels. Release and the transcript populates.

Or paste a product screenshot. The AI reads the image, infers the category and visual attributes, and searches for similar items. Useful when a user finds something they like elsewhere and wants to find it here."

---

## Act 9 — The Architecture Summary (1 min)

> No screen needed. Closing remarks.

**Talk track:**

"To summarize the six agents:

1. **VibeCheck** — natural language → structured shopping intent
2. **SneakPeek** — multi-store parallel search + deterministic ranking
3. **CartUp** — assembles the order object
4. **GreenLight** — issues the scoped payment token with 12 guardrail checks
5. **PayIt** — validates token, executes payment
6. **TrackIt** — records the order, updates the tracker

Stack: React + FastAPI. LLM is Gemini 2.0 Flash Lite with an Ollama fallback for offline demos. LangGraph for the agent graph. NeMo Guardrails on input. Guardrails AI on LLM output. SQLite for the catalog and order DB.

Frontend highlights: framer-motion for all inline animations, session persistence via sessionStorage, real-time audio waveform via Web Audio API, inline checkout and order tracker rendered directly in the chat thread — no page navigation required.

137 products, 3 merchants, 11 categories. Full end-to-end conversational commerce flow works today — discovery, comparison, inline checkout, and live order tracking, all from a single chat window."

---

## Things to Not Say

| Say this | Not this |
|---|---|
| "Simulated scoped payment token" | "We integrated with Visa/Mastercard" |
| "Human-in-the-loop approval" | "The agent has your card" |
| "Deterministic payment guardrails" | "AI secures the payment" |
| "AI-powered product ranking" | "This uses deep learning" |
| "Local mock payment processor" | "This is a live bank integration" |

---

## Demo Order Cheat Sheet

1. **Login** — click Customer → Log in tab (or Sign up for new account); or Continue as Guest
2. Type: *"Show me blue Nike running shoes size 10 under $120"*
3. Watch agent trail, skeleton cards → real cards + match tags
4. Sort by price, then fastest delivery
5. Select 2–3 products → Compare → show AI verdict panel
6. Say *"yes"* or *"buy it"* → **Order Summary card appears inline in chat**
7. Pick a saved card → click **Confirm & Pay** → watch inline payment steps animate
8. See confirmed card with order ID + loyalty points
9. Click **"📦 Track my orders"** → live order tracker drops in the chat thread
10. Type *"track my order"* in a new message → tracker appears again from scratch
11. Add another item to cart → open cart drawer → show session split → multi-item checkout page
12. Go to Dashboard → show metrics, order table, audit trail
13. Quick voice demo: hold mic, speak, release

---

---

# Version 2 — Generic Agentic Commerce (v3-generic-agent branch)

> Note: the steps below describe the earlier generic protocol path (`/api/generic/stream`), which still exists separately. The main Talk Shop chat now runs AP2 and ACP as well; the flow it actually runs, with real payloads, is documented at the end of this file under "Live Trace — Current Flow (Real Runtime)".

## What Changed

Version 2 upgrades the payment and agent communication architecture. Instead of a single in-house pipeline with a proprietary DPAT token, v2 uses **four real industry protocols** as of 2025–2026: A2A (Google), UCP (Google + Shopify + Walmart), ACP (OpenAI + Stripe), and AP2 (Google). The six named v1 agents (VibeCheck, SneakPeek, etc.) are replaced by a single **Generic Shopping Agent** that orchestrates across these protocols.

---

## Full Flow — Suggestion Click to Payment Complete

### Step 1 — User clicks a suggestion chip (or types a query)

The chat input is always active. Clicking a chip like *"Nike running shoes"* immediately calls `launchSearch()` — no need to click the input first. If a previous search is in progress, it is cleanly cancelled and a fresh session starts.

**What fires:**
- A new `session_id` (UUID, 32 hex chars) is generated client-side
- An SSE connection opens: `GET /api/generic/stream?q=...&session_id=...&use_acp=true`
- The session is saved to the sidebar history (persists for the browser session)

---

### Step 2 — Merchant Routing (internal)

**Protocol:** internal  
**Color in trace:** slate

The agent calls `parse_intent(query)` — extracts brand, category, size, price constraints from natural language. Then `route_merchants(intent)` picks which merchant agents to call (Nike, Adidas, Zara, H&M, Fossil, Casio, etc.).

**SSE event emitted to frontend:**
```json
{
  "type": "protocol_event",
  "data": {
    "protocol": "internal",
    "direction": "→",
    "label": "merchant_routing",
    "detail": { "merchants": ["nike"], "brand": "nike", "category": "running shoes" }
  }
}
```

---

### Step 3 — A2A Product Search

**Protocol:** A2A — Agent-to-Agent (Google, Apr 2025)  
**Color in trace:** blue  
**Spec:** JSON-RPC 2.0 envelope, Agent Cards at `/.well-known/agent.json`

The agent makes parallel `asyncio.gather()` calls to each merchant agent. Each call:
1. `GET /.well-known/agent.json` — fetches the merchant's Agent Card (describes capabilities, endpoints, auth)
2. `POST /a2a` with JSON-RPC payload: `{"method": "message/send", "params": {"message": {"parts": [{"text": query}]}}}`
3. Merchant agent returns a Task with Artifacts containing the product list

**Two SSE events per merchant (request + response):**
```json
{
  "protocol": "A2A",
  "source": "GenericShoppingAgent",
  "target": "NikeMerchantAgent",
  "direction": "→",
  "label": "message/send",
  "detail": { "merchant": "nike", "query": "running shoes" }
}
```
```json
{
  "protocol": "A2A",
  "source": "NikeMerchantAgent",
  "target": "GenericShoppingAgent",
  "direction": "←",
  "label": "products_returned",
  "detail": { "count": 8, "merchant": "nike" }
}
```

Products from all merchants are merged and sorted (rating desc, price asc).

---

### Step 4 — AP2 IntentMandate

**Protocol:** AP2 — Agent Payments Protocol (Google, Sep 2025)  
**Color in trace:** amber  
**Spec:** W3C Verifiable Credential (VC) — signed JSON-LD

After A2A search confirms which merchants have products, the agent creates the first of three AP2 mandates: the **IntentMandate**. This is the user's cryptographic authorization for the agent to proceed.

```json
{
  "protocol": "AP2",
  "source": "User",
  "target": "AP2Verifier",
  "direction": "→",
  "label": "intent_mandate_signed",
  "detail": {
    "id": "ap2_intent_abc123",
    "merchants": ["nike"]
  }
}
```

**The mandate object** (stored server-side, never sent to frontend):
```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiableCredential", "IntentMandate"],
  "credentialSubject": {
    "query": "Nike running shoes",
    "authorized_merchants": ["nike"],
    "user_id": "user_42"
  }
}
```

---

### Step 5 — Human Pause: Product Selection

`human_pause` SSE event fires with `pause_type: "product_selection"`. The backend blocks on an `asyncio.Event` (5-minute timeout).

**Frontend shows:** product grid with category-appropriate photos (curated Unsplash pools per merchant), variants selector, quantity picker, filter by brand.

**User picks a product.** Frontend sends:
```
POST /api/generic/resume
{ "session_id": "...", "product_id": "nike_air_max_001", "quantity": 1, "variant": {...} }
```

The asyncio.Event is set, the backend continues.

---

### Step 6 — UCP Checkout Session

**Protocol:** UCP — Universal Commerce Protocol (Google + Shopify + Walmart + Target + Etsy + Wayfair, Jan 2026)  
**Color in trace:** violet  
**Spec:** REST, `POST /checkout-sessions`

```json
{
  "protocol": "UCP",
  "source": "GenericShoppingAgent",
  "target": "UCPAdapter",
  "direction": "→",
  "label": "POST /checkout-sessions",
  "detail": { "product_id": "nike_air_max_001", "quantity": 1, "merchant": "nike" }
}
```

**Response — the totals breakdown:**
```json
{
  "protocol": "UCP",
  "direction": "←",
  "label": "session_created",
  "detail": {
    "ucp_session_id": "ucp_sess_xyz789",
    "status": "open",
    "totals": {
      "subtotal": 129.99,
      "fulfillment": 7.99,
      "tax": 13.52,
      "total": 151.50
    }
  }
}
```

---

### Step 7 — AP2 CartMandate

The second AP2 mandate locks the cart — product, quantity, and the exact total from UCP. This prevents price tampering.

```json
{
  "protocol": "AP2",
  "label": "cart_mandate_signed",
  "detail": {
    "id": "ap2_cart_def456",
    "checkout_hash": "a3f9c2b1d7e0..."
  }
}
```

The `checkout_hash` is a SHA-256 of `product_id + quantity + total_cents`. Any price change would invalidate it.

---

### Step 8 — Human Pause: Approve & Pay

`human_pause` fires with `pause_type: "approve_pay"`. Frontend shows:

- **Customer (useAcp=true):** Auto-displays registered card "Visa •••• 4001 · exp 12/27" — just a Confirm button, no card entry
- **Guest (useAcp=false):** Shows pre-registered demo instruments to choose from

Frontend sends on approve:
```
POST /api/generic/resume
{ "session_id": "...", "payment_method": "mock_pm_4001", "brand": "Visa", "last4": "4001" }
```

**Security:** Raw card data (PAN, CVV, expiry) never leaves the browser. A `mockTokenize()` call produces `mock_pm_<last4>` — the only thing that ever crosses the wire.

---

### Step 9 — ACP Shared Payment Token (customer mode only)

**Protocol:** ACP — Agentic Commerce Protocol (OpenAI + Stripe, Sep 2025)  
**Color in trace:** indigo  
**Spec:** Shared Payment Token (SPT)

The `mock_pm_4001` reference is sent to ACP to issue a single-use, amount-capped, merchant-scoped token:

```json
{
  "protocol": "ACP",
  "direction": "→",
  "label": "POST /shared_payment/issued_tokens",
  "detail": {
    "payment_method": "pm_***4001",
    "network_business_profile": "nbp_nike",
    "constraints": {
      "currency": "USD",
      "maximum_amount": 15150,
      "expiration": "now+15min"
    }
  }
}
```

**SPT issued:**
```json
{
  "protocol": "ACP",
  "direction": "←",
  "label": "token_issued",
  "detail": {
    "id": "spt_ghi789",
    "brand": "Visa",
    "last4": "4001",
    "status": "active",
    "maximum_amount_usd": 151.50
  }
}
```

**SPT verified** — constraints check (currency, amount cap, merchant scope, expiry):
```json
{ "protocol": "ACP", "label": "token_verified", "detail": { "ok": true, "reason": "constraints_satisfied" } }
```

---

### Step 10 — AP2 PaymentMandate

The final mandate authorizes the specific payment. Together, the three mandates form a chain: IntentMandate → CartMandate → PaymentMandate.

```json
{
  "protocol": "AP2",
  "label": "payment_mandate_signed",
  "detail": {
    "id": "ap2_pay_jkl012",
    "acp_token_id": "spt_ghi789",
    "amount_cents": 15150
  }
}
```

---

### Step 11 — Order Complete

The `order_complete` SSE event fires. Frontend transitions to the confirmation screen showing:
- Order ID (e.g. `TS-2026-00042`)
- Product thumbnail, merchant, variant
- Price breakdown (subtotal / fulfillment / tax / total)
- AP2 mandate chain summary (3 VCs)
- 5-step delivery tracker: Order Placed → Processing → Shipped → Out for Delivery → Delivered — "Processing" highlighted
- Dashboard link

The sidebar history entry is annotated with the order label.

---

## Protocol Summary Table

| Step | Protocol | Who Calls It | What It Does |
|------|----------|--------------|--------------|
| Routing | internal | Generic Agent | Parses NL intent, selects merchants |
| Search | **A2A** | Generic Agent → Merchant Agents | JSON-RPC product search via Agent Cards |
| Intent Auth | **AP2** | User → AP2Verifier | W3C VC: user authorizes agent to shop |
| Checkout | **UCP** | Generic Agent → UCPAdapter | REST: creates session, returns totals |
| Cart Lock | **AP2** | Generic Agent → AP2Verifier | W3C VC: locks product, price, quantity |
| Payment Token | **ACP** | Generic Agent → ACPAdapter | Issues single-use SPT, verifies constraints |
| Payment Auth | **AP2** | Generic Agent → AP2Verifier | W3C VC: final payment authorization |

---

## Key Security Properties

- **Card data stays in the browser** — only a tokenized `mock_pm_<last4>` crosses the wire
- **ACP SPT is single-use** — replay attacks are impossible
- **ACP SPT is amount-capped** — the agent cannot charge more than the UCP total
- **ACP SPT is merchant-scoped** — the token only works at the intended merchant
- **AP2 CartMandate includes a checkout hash** — price tampering is detected at the PaymentMandate step
- **LLM is outside the payment path** — all three payment steps are deterministic Python, not model calls

---

## Right Panel — Pipeline View vs Protocol Trace

The right panel has two tabs:

**Pipeline tab (default):** A vertical flowchart showing all 10 stages. Each stage lights up as it completes — slate dot → colored filled dot. The active stage shows a spinner. This gives a high-level view of "where are we in the flow."

**Trace tab:** Every raw protocol message, expandable to see the full JSON payload. Color-coded by protocol. Useful for technical inspection of exactly what each adapter sent and received.

---

## Demo Cheat Sheet (v2)

1. Login as Customer (uses ACP path) or Guest (pre-registered instruments)
2. Click a suggestion chip or type: *"Nike running shoes"*
3. Watch Pipeline tab: Routing → A2A → AP2 Intent → [pause]
4. Pick a product from the grid
5. Watch: UCP → AP2 Cart → [pause]
6. See totals, confirm with registered card (customer) or select demo instrument (guest)
7. Watch: ACP Token → AP2 Payment
8. Order confirmation screen: order ID, delivery tracker, AP2 mandate chain
9. Sidebar shows completed session with order label ✓ TS-2026-XXXXX
10. Type another query — chat input stays active, new search starts automatically

---

# Live Trace — Current Flow (Real Runtime)

> **Superseded for the main chat's purchase steps.** Stages 7–10 below describe the earlier order (DPAT first, ACP derived from it, payment driven by the browser). The main chat now uses the rectified Demo 2 flow: see [Demo 2 — Rectified Orchestration](#demo-2--rectified-orchestration) at the end of this document. Stages 1–6 still apply, with the agent trust stage added after routing.

This section describes what the app did before the Demo 2 rework. Every JSON block was captured from a real run of the backend (Gemini calls, NeMo, Guardrails AI and the merchant catalogs were all live). Where a value is not captured, the document says so.

## How to read the Live Trace

- **Flow** shows the stages as a template: A2A → UCP Catalog → UCP Checkout → AP2 approval → ACP/DPAT → Payment → Order. Each stage lights up when its real event arrives. Click a stage to see its events.
- **Live** is the real-time stream. Each event is a card. Click a card to see its captured data, sender and receiver, timestamp, and duration if one was measured.
- Only real results are shown. A guardrail appears only if it actually ran. If a stage has no guardrail, it shows none.

## Honest scope

| Layer | How it runs | Real? |
|---|---|---|
| A2A (merchant agents) | The six merchant agents are called in-process. The same agents are also exposed over HTTP as JSON-RPC 2.0 `message/send` at `/a2a/{merchant}`. | The chat flow uses the in-process calls, **not** the HTTP endpoint |
| UCP Catalog | Calls to each merchant's catalog through the agent | Real data from `backend/data/*_catalog.json` |
| UCP Checkout | `POST /api/checkout/create` | Real REST response |
| AP2 cart and payment mandates | Cart mandate created with `POST /api/checkout/create`; payment mandate created with `POST /api/authorizations/approve` | Real. The cart mandate is verified at approval and again at payment. Mandates are stored in the `protocol_mandates` table. |
| ACP token (SPT) | Issued at `POST /api/authorizations/approve`, bound to the DPAT, stored in `acp_shared_tokens` | Real. Verified before payment and marked used with the DPAT. |
| DPAT (GreenLight) | Single-use authorization from `POST /api/authorizations/approve`, used by `POST /api/payments/execute` | Real. Remains the authoritative payment token. |
| Payment | `POST /api/payments/execute` | Real REST response |
| Order | Returned in the execute response | Real order ID |

## Stage 1 — Input checks (custom, deterministic)

**What it does:** checks the user's message before any LLM call: empty input, length, harsh language, malformed characters, PII (email, phone, card-like numbers, SSN), and payment-credential keywords.

**Why:** these checks are fast, free, and predictable. A card number should never reach an LLM, so this stage runs first.

**Benefit:** every check reports its own result, so a PASS is only shown for a check that actually ran.

**Real output (shopping request, "Nike running shoes"):**

```json
{
  "type": "protocol_event",
  "source": "Input checks",
  "target": "ShoppingAgent",
  "protocol": "internal",
  "direction": "out",
  "label": "input_validation_pass",
  "detail": {
    "framework": "custom",
    "checks": [
      {"check": "empty_input", "status": "pass", "reason": null},
      {"check": "input_length", "status": "pass", "reason": null},
      {"check": "harsh_language", "status": "pass", "reason": null},
      {"check": "malformed_input", "status": "pass", "reason": null},
      {"check": "pii_detection", "status": "pass", "reason": null},
      {"check": "credential_keyword", "status": "pass", "reason": null}
    ]
  }
}
```

## Stage 2 — NeMo Guardrails: Commerce Scope (Gemini engine)

**What it does:** decides whether the message is about shopping, is off-topic, or asks for payment credentials.

**Why NeMo and Gemini:** NeMo is the policy layer. Its flow in `backend/guardrails/nemo/commerce.co` says what happens for each verdict. Gemini is the classifier that picks the verdict. This takes one Gemini call per message. The earlier embedding-based matching did not run in this environment, so it was replaced.

**Benefit:** the policy is readable and editable in one file. A verdict is enforced by the flow, not by string matching in Python.

**Real output (off-topic: "what is the weather in Paris today"):**

```json
{
  "type": "protocol_event",
  "source": "NeMo Guardrails",
  "target": "ShoppingAgent",
  "protocol": "internal",
  "direction": "out",
  "label": "nemo_blocked",
  "detail": {
    "framework": "NeMo Guardrails",
    "policy": "Commerce Scope",
    "engine": "Gemini",
    "category": "off_topic",
    "response": "I'm your personal shopping assistant — I'm not able to help with that. Ask me to find a product, compare prices, or check availability and I'll get right on it!"
  }
}
```

A shopping request produces `nemo_pass` with `category: commerce_allowed`. If classification fails, the result is an error. It is never shown as a PASS.

## Stage 3 — Intent extraction (Gemini) and schema check (Guardrails AI)

**What it does:** Gemini turns the message into a structured `ShoppingIntent` (brand, category, size, colour, budget). Guardrails AI then checks that JSON against the Pydantic model.

**Why:** the LLM can return text that looks right but has a string where a number belongs. The schema check catches that before any price or merchant decision uses it.

**Benefit:** the `schema_valid` event appears only when Guardrails AI actually validated and passed the output. If Guardrails AI doesn't pass, no event is shown.

*Not captured in this document:* this run did not record a sample of the Gemini output, so no JSON is shown for this stage.

## Stage 4 — A2A: merchant routing and agent message

**What it does:** routes the intent to the relevant merchant agents. For "Nike running shoes", only Nike is selected.

**Why A2A:** it is the agent-to-agent pattern. The shopping agent talks to each merchant agent through a message with a skill and parameters, instead of reaching into the merchant's database.

**Benefit:** each merchant can change its catalog or rules without the shopping agent knowing. The message shape matches what a real A2A call would send.

**Real output (routing):**

```json
{
  "label": "merchant_routing",
  "source": "ShoppingAgent",
  "target": "MerchantNetwork",
  "protocol": "internal",
  "detail": {"merchants": ["nike"]}
}
```

**Real output (message to the agent):**

```json
{
  "label": "message/send",
  "source": "ShoppingAgent",
  "target": "NikeAgent",
  "protocol": "A2A",
  "direction": "out",
  "detail": {
    "method": "message/send",
    "skill": "product_search",
    "intent": {"category": "running_shoes", "brand": "Nike"}
  }
}
```

**Real output (task result):**

```json
{
  "label": "task_result",
  "source": "NikeAgent",
  "target": "ShoppingAgent",
  "protocol": "A2A",
  "direction": "in",
  "detail": {"merchant": "nike", "product_count": 46, "status": "completed", "duration_ms": 1.2}
}
```

`duration_ms` is measured around the in-process call. It is not a network time.

## Stage 5 — UCP Catalog

**What it does:** the Nike agent queries its own catalog, `backend/data/nike_catalog.json`, and returns matching items. Each catalog product lists its colours, and every colour has its own studio photo (see [Merchant Catalog & Product Photos](#merchant-catalog--product-photos)).

**Why UCP:** the Universal Commerce Protocol describes catalog lookups and checkout as standard operations. Here it is used as the catalog structure, not as a network service.

**Benefit:** the catalog format is the same for every merchant, so the trace and cards don't need special cases.

**Real output (catalog results):**

```json
{
  "label": "catalog_results",
  "source": "UCPCatalog",
  "target": "NikeAgent",
  "protocol": "UCP",
  "direction": "in",
  "detail": {"merchant": "nike", "product_count": 8, "duration_ms": 279.8}
}
```

`product_count` is the number of matching size and colour variants the catalog returned for "show me Nike running shoes size 9". The chat then ranks them and shows the top picks.

**Real product (one card's data):**

```json
{
  "merchant_id": "nike",
  "product_id": "nike_zoom_fly_6-9-black",
  "title": "Nike Zoom Fly 6",
  "category": "running_shoes",
  "price": 139.99,
  "currency": "USD",
  "size": "9",
  "color": "Black",
  "available": true,
  "inventory": 15,
  "delivery_days": 3,
  "rating": 4.8,
  "review_count": 412,
  "image_url": "/catalog/nike-zoom-fly-6/black.webp",
  "source": "merchant_catalog"
}
```

`image_url` points at the photo for this card's colour, so a Coral Pegasus card shows the coral shoe and a Teal card shows the teal one.

## Stage 6 — Merchant boundary checks (custom)

**What it does:** before the products reach the list, checks that each product belongs to the merchant that returned it and has a positive price. Products that fail are dropped.

**Why:** a merchant response is data from another system, so it is checked at the boundary.

**Real output:**

```json
{
  "label": "boundary_check",
  "source": "NikeAgent",
  "target": "ShoppingAgent",
  "protocol": "A2A",
  "detail": {
    "framework": "custom",
    "merchant": "nike",
    "checks": [
      {"check": "merchant_identity", "status": "pass", "reason": null},
      {"check": "price_positive", "status": "pass", "reason": null}
    ]
  }
}
```

## Stage 7 — UCP Checkout (REST)

**What it does:** the user clicks a product and the app calls `POST /api/checkout/create`. The server locks the price, tax and shipping, and returns a checkout hash.

**Why:** the checkout hash lets the payment step prove the approved amount has not changed.

**Benefit:** the total the user approves is the total that gets charged.

**Real request body:** `{"product_id": "nike_zoom_fly_6-9-black", "merchant_id": "nike", "quantity": 1}`

**Real response:**

```json
{
  "checkout_id": "CHK_E9140BCD",
  "merchant_id": "nike",
  "product_id": "nike_zoom_fly_6-9-black",
  "product_title": "Nike Zoom Fly 6",
  "quantity": 1,
  "size": "9",
  "color": "Black",
  "subtotal": 139.99,
  "shipping": 0.0,
  "tax": 11.48,
  "total": 151.47,
  "currency": "USD",
  "checkout_hash": "d4a39e7ae5f479f7ad07cedff344f0307e578f92855c9d3a386532097e9e69ed"
}
```

The checkout event in the trace shows these totals from this response.

## Stage 8 — AP2 approval and GreenLight DPAT

**What it does:** the user confirms the amount in the UI. The app calls `POST /api/authorizations/approve` with the checkout details. The server first verifies the AP2 cart mandate against the checkout hash. It then issues a single-use DPAT token, creates the AP2 payment mandate that references that DPAT, and derives an ACP shared token from it.

**Why:** the user's consent is recorded before any money moves. Every record (DPAT, AP2 payment mandate, ACP token) is tied to this one checkout and this one token.

**Order of events in the trace:** AP2 cart mandate verified (at checkout), then DPAT issued, then AP2 payment mandate issued, then ACP token issued. Each event comes from the real response of the call that produced it.

**Authoritative token:** the DPAT stays authoritative. PayIt's 12 checks are unchanged. The ACP token is a shared-token view of the same authorization, with the same amount, currency and expiry.

## Stage 8b — ACP verification and payment guardrails

**What it does:** before PayIt runs, the server verifies the AP2 cart mandate, the AP2 payment mandate (its `payment_ref` must be the DPAT id and its checkout hash must match), and the ACP token (signature, amount, currency, expiry, seller). Only then do PayIt's 12 guardrail checks run, followed by the mock processor.

**Trace order:** ACP token verified, then payment guardrails (12/12), then payment executed, then order recorded. A blocked check stops the payment before the charge, and the DPAT is not used up by that blocked attempt.

**Real request body:** the checkout's `checkout_id`, `checkout_hash`, `merchant_id`, `total`, `currency`, `product_id`, `product_title`, `merchant_name`, `subtotal`, `tax` and `shipping` fields, copied from the checkout response.

**Real response:**

```json
{
  "token_id": "DPAT_8E632A3F",
  "authorization_id": "AUTH_5226723EE0",
  "expires_at": "2026-10-06T22:22:48.408127Z",
  "summary": "Authorization token DPAT_8E632A3F issued for Nike. Amount: $151.47. Expires in 15 minutes. Single-use token — valid for this purchase only."
}
```

## Stage 9 — ACP / payment (DPAT used for payment)

**What it does:** the app calls `POST /api/payments/execute` with the DPAT token and checkout details. The payment engine runs its 12 payment checks, then charges the mock processor.

**Why:** the token can be used once, for this amount and merchant, within its expiry window. The engine rejects anything else.

**Benefit:** a replayed or altered token is blocked before any charge.

**Real response:**

```json
{
  "status": "success",
  "order_id": "CHK_3FA7B824",
  "amount": 151.47,
  "merchant": "Nike",
  "summary": "Order CHK_3FA7B824 confirmed at Nike. Charged $151.47. Transaction TXN_A6B209C6C8.",
  "transaction_id": "TXN_A6B209C6C8",
  "blocked_reason": null,
  "points_earned": 151,
  "loyalty_balance": 151
}
```

**In the browser:** the 12 payment check results come back in the same response, and the trace shows them as "Payment guardrails (12/12)" before the payment is recorded.

## Stage 10 — Order

**What it does:** the order is recorded in the same execute response. The trace shows it as `order_created`.

**Honest note:** the order is not a separate timed operation, so its duration is shown as not measured.

## Durations

Durations are measured only where a real call was timed: the merchant catalog call (in-process), the checkout create, the approve call and the execute call. Everything else shows no duration.

## What is still not real

- Separate request and response payloads are not captured for each event. Each event shows what it recorded when it fired.
- The AP2 and ACP records are stored in the database, and are verified in the main chat before payment.
- The chat flow calls the merchant agents in-process. It does not use the HTTP A2A endpoint.
- Payment guardrail results are returned to the browser with each execution, and shown in the trace.
- Intent extraction samples are not captured in this document.

## Protocol Fidelity

This section explains how each protocol is represented in the POC. The goal is a working demo that reproduces each protocol's roles, sequence and message structure. It is not a claim of formal protocol compliance.

### Where each protocol runs

| Protocol | Main Talk Shop chat | Generic protocol path (`/api/generic/stream`) |
|---|---|---|
| A2A | Yes. The six merchant agents are called in-process with A2A-style messages and task results. | Yes. Merchant agents are called in-process with A2A events (`backend/agents/generic_shopping_agent.py`). |
| UCP | Yes, for catalog search. Checkout is our REST endpoint with UCP-style totals and fulfillment. | Yes, through the UCP adapter |
| AP2 | Yes. Cart mandate at checkout, payment mandate at approval, both verified before payment. | Yes. Intent, cart and payment mandates. |
| ACP | Yes. Shared payment token derived from the DPAT, verified before payment. | Yes. Delegated payment tokens. |
| Guardrails (NeMo, Guardrails AI, input checks, merchant checks, payment checks) | Yes | Shared guardrail modules |

### Ratings against the official specifications

| Protocol | Rating | What matches | What is simplified |
|---|---|---|---|
| A2A | **Partially mimics** | Message, task and artifact structure. JSON-RPC 2.0 request and response shape. Agent card with skills and capabilities. | Method name is `message/send` (earlier A2A naming). Agent card lacks `id`, `provider`, `interfaces` and `securitySchemes`. Chat calls agents in-process; the HTTP endpoint is available separately. |
| UCP | **Partially mimics** (catalog); **simplified** (checkout) | Products, variants, prices, totals and fulfillment concepts. | No pagination. Ratings are flat. No checkout session status lifecycle. |
| AP2 | **Partially mimics** (main chat and generic path) | Intent, cart and payment mandates. Checkout-hash binding between mandates. | HMAC demo signature instead of SD-JWT. No `vct` claim. No merchant-signed checkout JWT. Credential Provider and Payment Processor roles are not separate components. |
| ACP | **Partially mimics** (main chat and generic path) | Maximum amount in minor units, currency, expiry, single-use token concept. | Field names differ: `constraints` and `expiration` instead of `allowance` and `expires_at`. No `reason`, `checkout_session_id` or `merchant_id`. No `/checkout_sessions` or `/agentic_commerce/delegate_payment` routes. |

### Truthful wording for the presentation

- **A2A:** "Our merchant agents use A2A-style messages and task results. The chat calls them in-process, and the same agents are available over HTTP."
- **UCP:** "Our catalog and checkout use UCP-style concepts: products, variants, totals and fulfillment. This is not the UCP wire protocol."
- **AP2:** "Our purchase carries AP2-style cart and payment mandates as verifiable-credential-style objects, bound to the checkout hash, with a demo signature. They're verified before payment."
- **ACP:** "An ACP-style scoped, single-use payment token is the only payment credential that reaches the merchant. It's issued after GO AHEAD, bound to the merchant, checkout, amount, currency and expiry, and verified by the merchant before payment."
- **DPAT:** "Our internal single-use enforcement token. The verified authorization is mapped to it, and the payment service runs 12 deterministic checks before the mock processor charges. It is not an industry protocol."
- **Agent trust:** "Before checkout, the merchant verifies the customer agent's identity, platform, delegation and scope with deterministic checks. The signature is a demo key, not production PKI."

### Guardrails

These are real libraries and run in the main chat: NeMo Guardrails with a Gemini classifier for commerce scope, and Guardrails AI for the intent schema. The input checks, merchant boundary checks and payment checks are our own code.

## POC Approach & Advantages

Our approach reproduces the key roles, sequence and interaction patterns of each protocol, and connects them into one commerce journey:

- **Roles and sequence:** the shopping agent routes the request to merchant agents, merchants return products as results, the user approves a checkout, a single-use token authorizes payment, and an order is recorded.
- **Realistic structures:** requests and responses use protocol-style fields (JSON-RPC envelopes, task and artifact objects, totals and fulfillment, mandates with checkout hashes, token constraints). The Live Trace shows the real data each step produced, rather than only labelling UI steps.
- **End-to-end execution:** the chat runs real merchant routing, checkout creation, approval, payment and order completion. Guardrails run at each boundary and report what actually executed.
- **Local infrastructure:** merchants, the credential provider and the payment processor are local mock services. This keeps the demo deterministic and reproducible, with no dependency on real customer or payment data.
- **Observability:** the Live Trace shows each protocol event, its captured data, and measured durations where a real call was timed.
- **Path to real integrations:** each role sits behind its own module. Swapping a mock merchant, credential provider or payment processor for a real endpoint keeps the overall agentic-commerce flow the same.

The purpose of this POC is functional demonstration and architectural validation. It shows how these protocol roles and sequences can work together, and gives a concrete base to extend toward official protocol endpoints.

## Merchant Catalog & Product Photos

The six merchant catalogs (Nike, Adidas, Zara, H&M, Fossil, Casio) were rebuilt so the data is clean and every product colour has its own real photo from Pixabay. The format follows the ShopSphere catalog from the Demo 1 build.

### What changed

| Before | Now |
|---|---|
| One stock photo per product, from Wikimedia Commons. Often the wrong brand (a FILA shoe on the "Nike Zoom Fly 6" card) or a store scene. 18 products had no photo. | One studio photo per colour. Every product has a photo for every colour it sells. |
| Photos shown as-is, cropped into the card. | Background removed, product centred on the same soft grey backdrop with a floor shadow, so the grid looks like one store. |
| Colours were invented and had no photo behind them. | A product only offers colours it has a convincing photo for. |
| Every size and colour combination written out as a variant row (5–10 rows per product). | Sizes come from a named size range. Stock is written as exceptions (`out_of_stock`). |
| Some descriptions had broken characters. | Clean descriptions, plus tags, department, gender and a hex swatch for each colour. |

**Totals:** 46 products and 60 colour photos across the six merchants.

### The catalog format

Each merchant file, `backend/data/<merchant>_catalog.json`, has three parts: the merchant, the size ranges it uses, and its products.

```json
{
  "merchant": {"merchant_id": "nike", "merchant_name": "Nike", "categories": ["shoes", "running", "sneakers", "sportswear", "apparel", "clothing"]},
  "size_ranges": {"shoe_unisex": ["6", "7", "8", "9", "10", "11", "12"]},
  "products": [ ... ]
}
```

One real product:

```json
{
  "product_id": "nike_pegasus_42",
  "slug": "nike-air-zoom-pegasus-42",
  "name": "Nike Air Zoom Pegasus 42",
  "brand": "Nike",
  "department": "shoes",
  "category": "running",
  "subcategory": "shoes",
  "gender": "unisex",
  "price": 99.99,
  "currency": "USD",
  "rating": 4.6,
  "review_count": 1240,
  "delivery_days": 2,
  "is_new": false,
  "option_label": "Size",
  "sizes": "shoe_unisex",
  "colors": [
    {"name": "Coral", "hex": "#f0705a", "photo": {"pixabay_id": 1324431, "mode": "studio"}},
    {"name": "Teal",  "hex": "#2bb3b1", "photo": {"pixabay_id": 2799608, "mode": "studio"}}
  ],
  "description": "Lightweight daily trainer with React foam cushioning and a smooth ride.",
  "tags": ["everyday running", "cushioned", "road"],
  "out_of_stock": [{"size": "11", "color": "Teal"}]
}
```

**How the app reads it:** when a merchant agent loads its catalog, it expands each product into one variant per size and colour. Stock levels are deterministic, between 3 and 15, so they look varied but never change between runs. Out-of-stock entries become `available: false` with zero stock. The rest of the app (search, A2A results, checkout, AP2 and ACP) sees the same product shape as before, so no other part of the flow had to change.

### How the photos are made

1. **Pick:** each colour names a hand-picked Pixabay photo by its id. Photos were chosen by eye from Pixabay search results, preferring a single product on a plain background.
2. **Download:** `scripts/fetch_catalog_photos.py` fetches the photo through the Pixabay API, using `PIXABAY_API_KEY` from `.env`.
3. **Cut out:** the product is separated from its background. The `mode` on each photo says how:
   - `studio` removes the background with rembg, a background-removal model.
   - `largest` does the same, then keeps only the biggest shape, which drops props such as jeans or a bag.
   - `onblack` separates a product shot on a plain black backdrop by brightness.
4. **Compose:** the cut-out is centred on the grey backdrop with a soft shadow and saved as an 800×800 WebP at `frontend/public/catalog/<slug>/<colour>.webp`.
5. **Record:** the source page, photographer and licence of every photo are written to `backend/data/catalog_images.json`.

```json
"nike-air-zoom-pegasus-42": {
  "Coral": {"pixabay_id": 1324431, "mode": "studio", "page_url": "https://pixabay.com/photos/shoe-sports-training-sneaker-1324431/", "photographer": "stux", "license": "Pixabay Content License"}
}
```

**Why photos are stored locally:** Pixabay's API terms don't allow apps to link to Pixabay image URLs permanently. Downloading also means the demo works offline once the photos exist.

**Where photos show:** each product card gets the photo for its own colour through `image_url`. Cards and the product detail view show the whole square photo on the matching backdrop instead of cropping it. The checkout adapter uses the selected colour's photo too.

### Changing the catalog

The single source of truth is `scripts/build_merchant_catalogs.py`. To add a product, add a colour or swap a photo, edit it there, then run:

```bash
.venv/Scripts/python scripts/build_merchant_catalogs.py          # rewrites the six catalog files
.venv-photos/Scripts/python scripts/fetch_catalog_photos.py      # makes any missing or changed photos
```

Then restart the backend. The photo script only redoes photos whose id or mode changed, and deletes photos no product uses any more. It runs in its own environment, `.venv-photos`, so rembg and its ~170 MB model stay out of the app's packages.

### Products that changed to fit Pixabay

Pixabay has no photos of some exact models, so the catalog was adjusted to what it does have:

- **Removed:** Nike Pro Compression Shorts, Nike React Infinity Run 4, Casio F-91W and Casio Databank. No usable photo existed.
- **Replaced:** Nike Air Max 270 became the Air Max 90, the square G-Shock GW-M5610 became the G-Shock GA-100, and the Casio Baby-G became the G-Shock DW-6900.
- **Renamed to match their photos:** Zara Linen Sundress, Zara Bow-Neck Blouse, Zara Evening Gown, Fossil Carlie Watch, Casio Edifice EFR-539, H&M Pleated Chiffon Dress, H&M Tiered Denim Dress, H&M Oxford Shirt, H&M Skinny High Jeans, H&M Chino Shorts, H&M Embroidered Blouse and H&M Patterned Knit Cardigan.
- **Added:** H&M Oversized Knit Sweater.

### Search improvement

Search now also matches a product's department and tags. Before, a broad ask like "zara evening dress", which the intent step turns into the category "clothing", skipped the dresses because they sit in their own "dresses" category. Dresses are in the clothing department, so they now come back. Tags help keyword searches such as "g-shock" or "linen".

### Honest notes

- Pixabay rarely has the exact model, so many photos show a similar product from the right brand rather than the exact one. Fossil watches are generic watches.
- A few cut-outs have small flaws, such as a faint smear under the green G-Shock.
- The generic protocol path (`/api/generic/stream`) still uses its own Unsplash photo pools. The new photos are used in the main chat.

**Talk track:** "Every product photo is a real, licence-free Pixabay photo that we cut out and put on one studio backdrop, so the store looks consistent. Each colour has its own photo, and the catalog only sells colours we actually have a picture of."

**Don't say:** "These are official brand product photos." They are stock photos of similar products.

---

# Demo 2 — Rectified Orchestration

The main chat now follows the business scenario: **an authenticated Talkshop customer, unknown to Nike, buys through their own shopping agent.** Full details, live evidence and test results are in [demo2_implementation_report.md](demo2_implementation_report.md). Work is tracked in [demo2_orchestration_plan.md](demo2_orchestration_plan.md).

## Guest vs known

| Relationship | Values | Primary demo |
|---|---|---|
| Talkshop account | authenticated · talkshop_guest | authenticated |
| Merchant relationship | merchant_guest · merchant_member | merchant_guest |

"Continue as Talkshop guest (testing)" on the login page is a secondary path. Nike only ever sees a pseudonymous customer reference.

## The flow

1. Input checks and NeMo Guardrails, then Gemini extracts the shopping intent. The intent is what the customer wants, not permission to spend.
2. The brand is named, so the request routes straight to Nike.
3. **Customer Agent → Nike Agent** (A2A-style, in-process).
4. **Agent trust:** Nike runs 8 deterministic checks on the agent's credential and opens a trusted session. If any check fails, nothing is searched, checked out or charged.
5. Nike's catalog (UCP-style) returns products. The customer picks one; that is not a payment approval.
6. Nike creates the checkout, stores it, and returns totals, delivery date and a checkout hash. AP2 cart evidence binds it.
7. The **order proposal** shows product, totals, delivery and the payment method as brand + last4.
8. **GO AHEAD** is the only thing that authorizes payment. It is bound to the exact checkout, total and payment method.
9. AP2 authorization evidence, then an ACP-style scoped token, then Nike verifies trust, token and evidence.
10. If Nike's delivery date changed, payment pauses for YES / NO.
11. The verified authorization maps to the internal DPAT; the 12 payment checks run; the mock processor charges; Nike creates the order and returns ORDER_CONFIRMED.

## In the right panel

The **Story** tab (default) shows one row per step: Input · Intent · Routing · A2A · Agent trust · UCP · Human · Checkout · AP2 · Human (GO AHEAD) · ACP · Payment · Nike · A2A. Each row has **View details** with the raw event. The Live and Flow tabs show the same events in more detail.

## Demo scenarios

A small **Demo scenario** picker under the message box triggers the failure cases on stage:

| Scenario | What the audience sees |
|---|---|
| Invalid agent credential | The search stops at Agent trust. No products, no checkout. |
| Merchant changes delivery date | After GO AHEAD, payment pauses and asks YES / NO. |
| Agent tries to charge $20 more | Nike rejects the charge as outside the token's scope. No payment, no order. |

Reset the picker to **Normal** for the happy path.

## Talk track

"You're signed in to your own assistant, and you've never shopped with Nike. Your agent connects to Nike's agent, and Nike checks who the agent is and what you allowed it to do before showing anything. You pick the shoes — that's not a payment yet. Nike builds the checkout, and you see the exact total, delivery date and the card as Visa •••• 4242. Only when you say GO AHEAD does your agent get a single-use token for exactly that amount at Nike. Nike verifies it, our payment service runs 12 checks, and the order comes back. The card number never reaches the AI or Nike."

**Don't say:** "fully compliant", "live A2A network call", "production payment" or "DPAT protocol".
