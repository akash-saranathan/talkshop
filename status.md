# Agentic Commerce POC — Status

> Last updated: 2026-10-02

---

## Current Branch: `v2-upgrade`

---

## Version 1 (Frozen — `ts-version1` branch)

Full 5-phase POC with 6-agent pipeline, DPAT tokens, guardrails, and audit trail.

| Phase | Status |
|---|---|
| Phase 1 — Foundation & Infrastructure | ✅ Complete |
| Phase 2 — Agentic Discovery via MCP | ✅ Complete |
| Phase 3 — Checkout, Consent & DPAT | ✅ Complete |
| Phase 4 — Payment Execution & Dashboard | ✅ Complete |
| Phase 5 — Demo Polish & Scenarios | ✅ Complete |

---

## Version 2 — Conversational Commerce (`v2-upgrade` branch)

**Theme:** Everything in one chat window. LLM-driven conversation. Zero page navigation for the purchase flow.

### v2 Goal
Transform TalkShop from a multi-page web app into a single-page conversational commerce experience — where the agent understands any question, manages cart operations through natural language, executes payment inline, and shows the full agentic pipeline in real-time on the right side.

---

### ✅ LLM Intelligence — All Interactions Now LLM-Driven

| Feature | What changed | File |
|---|---|---|
| **Message intent classification** | Replaced keyword heuristics with `classify_message_intent()` — LLM classifies any message as `product_followup`, `new_search`, or `chitchat` before the pipeline decides what to do | `backend/agents/vibecheck.py` |
| **Deterministic fast-path** | Obvious cases (bare greetings, clear checkout phrases) bypass the LLM call for speed | `backend/agents/vibecheck.py` |
| **General question answering** | `answer_general_message()` — LLM answers ANY question naturally (general knowledge, advice, chitchat). Replaced hardcoded "I'm your shopping assistant" fallback | `backend/agents/vibecheck.py` |
| **Product follow-up with actions** | `answer_product_question_with_action()` — LLM returns `{text, action}` JSON. One call handles both the prose answer AND a structured action for the frontend to execute | `backend/agents/vibecheck.py` |
| **Action types** | `show_cart`, `add_to_cart`, `checkout`, `remove_from_cart`, `show_more` — LLM decides which action fits the user's intent | `backend/agents/vibecheck.py`, `frontend/src/api/chat.ts` |
| **Show more products** | Session stores top 10 results. `show_more` action returns products 6–10 without a new search | `backend/graph/workflow.py` |
| **Recommendation CTA** | LLM writes "Want me to add the [product] to your cart?" as a natural sentence at the end of each recommendation | `backend/agents/vibecheck.py` |
| **History-based personalization** | Last 3 confirmed orders passed to recommendation prompt — agent naturally references past purchases | `backend/graph/workflow.py` |

---

### ✅ Conversational Commerce — Entire Purchase Flow in Chat

The complete loop — search → add to cart → checkout → pay → confirm — now happens entirely inside the chat window. No page navigation.

| Feature | What changed | File |
|---|---|---|
| **Inline checkout flow** | `InlineCheckout` component renders checkout phases inside the chat bubble: `setup → summary → processing → confirmed → failed` | `frontend/src/components/InlineCheckout.tsx` |
| **"Add to cart" vs "Proceed to checkout"** | Saying "add to cart" now shows a cart confirmation card (not the payment summary). "Proceed to checkout" / "buy now" starts the payment flow | `frontend/src/pages/Chat.tsx`, `backend/agents/vibecheck.py` |
| **Inline cart card** | After adding to cart: shows the added product, full cart item list with prices, cart total, "View Cart" and "Proceed to Checkout →" buttons — all inline in chat | `frontend/src/pages/Chat.tsx` |
| **LLM-driven cart operations** | "Add the first one to cart", "remove it", "show me my cart", "add the Nike ones" — all understood by the LLM, mapped to actions, executed without regex | `frontend/src/pages/Chat.tsx`, `backend/agents/vibecheck.py` |
| **Affirmative reply intercept** | "yes", "ok", "sure" after agent asks "Want me to add to cart?" triggers checkout without re-querying the backend | `frontend/src/pages/Chat.tsx` |
| **Add-to-cart intercept** | "add it", "add to cart", "add this" phrases are intercepted frontend-side and call `doAddToCart` (not checkout) | `frontend/src/pages/Chat.tsx` |
| **Ordinal product selection** | "add the first one", "buy the second one" → resolves to the correct product by position | `frontend/src/pages/Chat.tsx` |
| **CartUp step in pipeline** | "CartUp — preparing your order..." / "CartUp — checkout session ready" appear as agent steps (visible in right panel and chat) | `frontend/src/pages/Chat.tsx` |
| **DPAT authorization inline** | GreenLight → PayIt → TrackIt steps stream inline in the checkout turn as the pipeline runs | `frontend/src/pages/Chat.tsx` |
| **Payment confirmation inline** | After payment: animated "Order Confirmed" card with order ID, amount, loyalty points, and collapsible order tracker — stays in the chat turn | `frontend/src/components/InlineCheckout.tsx` |
| **Remove from cart via LLM** | "remove it from cart", "take out the first one" — LLM returns `remove_from_cart` action, frontend removes the matching cart item by `product_id` | `frontend/src/pages/Chat.tsx` |

---

### ✅ Agent Pipeline Panel — Live Execution Trace

The right panel was completely redesigned from a simple list into a detailed visual pipeline viewer.

| Feature | What changed | File |
|---|---|---|
| **6-agent horizontal flowchart** | Visual pipeline: VibeCheck → SneakPeek → CartUp → GreenLight → PayIt → TrackIt with animated arrows that turn blue as each agent activates | `frontend/src/components/AgentTrailPanel.tsx` |
| **Animated status badges** | Each node: idle (grey) / running (amber pulse) / done (green) / error (red), with ring pulse animation while running | `frontend/src/components/AgentTrailPanel.tsx` |
| **Pipeline progress bar** | `N / 6` gradient progress bar below the header tracks how many agents have completed | `frontend/src/components/AgentTrailPanel.tsx` |
| **Click-to-expand agent detail** | Click any agent (in flowchart or list) to see its key-value output table: VibeCheck shows intent fields, SneakPeek shows result counts and price range, GreenLight shows DPAT token details, etc. | `frontend/src/components/AgentTrailPanel.tsx` |
| **Step trace per agent** | Expanded agent shows its step timeline with colored dots (amber = running, green = done, red = error) and human-readable step messages | `frontend/src/components/AgentTrailPanel.tsx` |
| **All agents always visible** | Idle agents are shown in the list (not hidden). Expanding an idle agent shows its role description so viewers understand what it does before it runs | `frontend/src/components/AgentTrailPanel.tsx` |
| **Session-wide step accumulation** | Panel uses `turns.flatMap(t => t.steps)` — shows the complete history of all agent steps across the entire session (search + checkout + payment), not just the current turn | `frontend/src/pages/Chat.tsx` |
| **Payment steps in panel** | `doPayment` mirrors GreenLight/PayIt/TrackIt steps into `turn.steps` in real time, so the panel shows payment progress as it happens | `frontend/src/pages/Chat.tsx` |
| **Auto-selects active agent** | Panel auto-switches to the currently running agent as the pipeline progresses | `frontend/src/components/AgentTrailPanel.tsx` |
| **Recent orders section** | Bottom of panel shows last 3 orders with product thumbnail, amount, date, and Paid/Failed badge | `frontend/src/components/AgentTrailPanel.tsx` |
| **Gradient blue header** | Panel header with "Agent Pipeline" title, live indicator, and collapse button | `frontend/src/components/AgentTrailPanel.tsx` |

---

### ✅ Layout & UX

| Feature | What changed | File |
|---|---|---|
| **60-40 split layout** | Chat column takes ~60% of screen width, agent panel takes ~40% | `frontend/src/pages/Chat.tsx` |
| **Draggable resize handles** | Both the left sidebar and right panel are resizable by dragging their borders | `frontend/src/pages/Chat.tsx` |
| **Left sidebar collapsed by default** | Sidebar starts hidden, giving the full width to chat and panel | `frontend/src/pages/Chat.tsx` |
| **TalkShop header** | "Agentic Commerce Intelligence" branding in the chat header | `frontend/src/pages/Chat.tsx` |
| **Follow-up chips per turn** | Auto-generated smart chips after each product result ("Only Nike", "Under $80", "Fastest delivery only", "Which one should I buy?") | `frontend/src/pages/Chat.tsx` |
| **Sort bar per turn** | Each product turn has its own Best Match / ↓ Price / Top Rated / Fastest sort controls, client-side re-sort | `frontend/src/pages/Chat.tsx` |
| **Intent badges** | "AI matched: blue · size 10 · under $100" chips below the search results showing exactly what was understood | `frontend/src/pages/Chat.tsx` |
| **CartDrawer** | Slides in over the chat from the header cart button — shows session and previous cart items | `frontend/src/components/CartDrawer.tsx` |
| **Dark/light mode** | CSS variable theming with `ThemeToggle` component | `frontend/src/index.css`, `frontend/src/components/ThemeToggle.tsx` |

---

### ✅ Session Persistence — Survives Navigation

| Feature | What changed | File |
|---|---|---|
| **Session restore** | Returning from `/cart` or `/dashboard` restores the conversation from `sessionStorage` | `frontend/src/pages/Chat.tsx` |
| **Checkout state persisted** | If user navigates away mid-checkout, coming back restores the order summary card (product + pricing) rather than just showing product cards again | `frontend/src/pages/Chat.tsx` |
| **Order confirmation persisted** | After payment completes, navigating away and returning shows the "Order Confirmed" card, not 5 raw product cards | `frontend/src/pages/Chat.tsx` |
| **Guest card persisted** | Guest card details entered once are pre-filled in the modal for repeat checkouts within the same browser session | `frontend/src/pages/Chat.tsx`, `frontend/src/components/InlineCheckout.tsx` |
| **All stored in sessionStorage** | `talkshop_session`, `talkshop_checkout_{id}`, `talkshop_order_{id}`, `talkshop_guestcard_{id}` — all tab-scoped, cleared on new tab | `frontend/src/pages/Chat.tsx` |

---

### ✅ Bug Fixes

| Fix | File |
|---|---|
| "this/it/that" in follow-up questions resolves to product #1 (not an error) | `backend/agents/vibecheck.py` |
| No duplicate product cards on follow-up answers (only new products trigger card rendering) | `frontend/src/pages/Chat.tsx` |
| Expand arrow visible inside collapsed sidebar | `frontend/src/components/ChatSidebar.tsx` |
| Same-model products deduplicated in search results (highest-scored variant kept) | `backend/graph/workflow.py` |
| No skeleton cards on follow-up Q&A turns (only on product searches) | `frontend/src/pages/Chat.tsx` |
| Enter key in card number modal submits the form | `frontend/src/components/InlineCheckout.tsx` |
| Right panel showed 0/6 after payment — fixed by mirroring steps into `turn.steps` | `frontend/src/pages/Chat.tsx` |
| Cart badge updates live after add/remove operations | `frontend/src/pages/Chat.tsx` |

---

## Version 3 — Universal Agentic Commerce (future branch)

| Feature | Status |
|---|---|
| UCP merchant discovery | 🔮 Not started |
| ACP agent-to-bank token handshake | 🔮 Not started |
| APGP payment protocol | 🔮 Not started |
| X402 machine-to-machine micropayments | 🔮 Not started |
| Always-on wake word | 🔮 Not started |
| Facial recognition login | 🔮 Not started |
| Cross-merchant universal loyalty | 🔮 Not started |
