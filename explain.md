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

**What the screen shows:**
- Clean dark/light toggle header
- Left sidebar with previous sessions (like ChatGPT threads)
- Central text input with a microphone button
- Agent trail panel on the right (collapsed by default)

**Talk track:**

"The entry point is a chat window. Nothing else. Users can type or hold the mic to speak — the voice input has a real-time waveform visualizer, so they get feedback they're being heard.

The sidebar preserves every past conversation. Sessions are restored on return. So if a user came back from the cart page, they pick up exactly where they left off."

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

## Act 5 — Cart & Checkout (2 min)

> Add a product. Open cart drawer. Proceed to checkout.

**What happens:**
- Cart drawer slides in over the chat (no page navigation)
- Items split: "This session" vs. "Previous items"
- Wallet balance shown; card option available
- Checkout page: read-only order summary, Approve button

**Talk track:**

"Cart is a drawer, not a separate page. The user stays in the conversation. The session split shows what they added today vs. past sessions — this builds trust that nothing is being auto-added.

Payment selection is here: wallet or card. If the wallet balance is too low, the option grays out with an amber warning. No ambiguity.

On the checkout page, everything is read-only. The user sees exactly what they're approving — amount, merchant, payment method — before they click anything."

**Key message:**
> Human-in-the-loop. The AI assembles the cart, but the user clicks Approve. Nothing is charged without explicit consent.

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

## Act 7 — Order Tracker / Dashboard (1 min)

> Navigate to Dashboard.

**What the screen shows:**
- Metric cards: total sessions, approved orders, blocked transactions, total spend
- Sortable order table with delivery status badges
- Date range filter

**Talk track:**

"The dashboard gives a complete picture of activity. Admins and users can see approved vs. blocked transactions, total spend, and delivery status for every order — Processing, Shipped, Delivered.

The order table is sortable by purchase date or arrival date, with a date range filter. Every blocked payment shows its reason code, so there's a full audit trail."

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

137 products, 3 merchants, 11 categories. Full end-to-end flow works today."

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

1. Login
2. Type: *"Show me blue Nike running shoes size 10 under $120"*
3. Watch agent trail, skeleton cards → real cards + match tags
4. Sort by price, then fastest delivery
5. Select 2–3 products → Compare → show AI verdict panel
6. Add one to cart → open cart drawer → show session split
7. Switch to card payment → Checkout → Approve
8. Watch multi-step status badges (Queued → Authorizing → Paid)
9. Go to Dashboard → show metrics, order table, audit trail
10. Quick voice demo: hold mic, speak, release
