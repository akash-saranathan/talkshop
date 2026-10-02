# TalkShop — Version 2 Plan & Build Log

**Branch:** `v2-upgrade`
**Goal:** Single-page conversational commerce — LLM-driven everything, full purchase flow inline in chat, live agent pipeline panel.

---

## Version 2 Task Tracker

| # | Feature | Category | Status |
|---|---|---|---|
| 1 | LLM message intent classifier (`classify_message_intent`) | Intelligence | ✅ Done |
| 2 | `answer_general_message()` — LLM answers any question naturally | Intelligence | ✅ Done |
| 3 | `answer_product_question_with_action()` — structured `{text, action}` response | Intelligence | ✅ Done |
| 4 | Action types: `add_to_cart`, `checkout`, `remove_from_cart`, `show_cart`, `show_more` | Intelligence | ✅ Done |
| 5 | Show more than 5 products — store top 10, surface 6-10 on "show more" | Intelligence | ✅ Done |
| 6 | InlineCheckout component — full payment flow inside chat | Commerce | ✅ Done |
| 7 | Inline cart card — "added to cart" shows product + cart list + actions in chat | Commerce | ✅ Done |
| 8 | `add_to_cart` vs `checkout` action distinction | Commerce | ✅ Done |
| 9 | Affirmative reply intercept ("yes", "ok") → checkout without re-querying | Commerce | ✅ Done |
| 10 | Ordinal product selection ("add the first one", "buy the second") | Commerce | ✅ Done |
| 11 | Remove from cart via LLM action | Commerce | ✅ Done |
| 12 | CartUp / GreenLight / PayIt / TrackIt steps appear in right panel during checkout | Commerce | ✅ Done |
| 13 | 6-agent horizontal pipeline flowchart in right panel | Panel | ✅ Done |
| 14 | Animated status badges (idle/running/done/error) per pipeline node | Panel | ✅ Done |
| 15 | Click-to-expand agent detail with key-value output + step trace | Panel | ✅ Done |
| 16 | All agents always visible; idle agents show description when expanded | Panel | ✅ Done |
| 17 | Session-wide step accumulation across all turns | Panel | ✅ Done |
| 18 | Pipeline progress bar (`N / 6`) | Panel | ✅ Done |
| 19 | 60-40 split layout (chat wider, agent panel ~40%) | Layout | ✅ Done |
| 20 | Draggable resize handles for both panels | Layout | ✅ Done |
| 21 | Left sidebar collapsed by default | Layout | ✅ Done |
| 22 | Session restore — checkout state persists after navigating to /cart | Persistence | ✅ Done |
| 23 | Session restore — confirmed order shown on return, not 5 product cards | Persistence | ✅ Done |
| 24 | Guest card details persisted within session (no re-entry on return) | Persistence | ✅ Done |
| 25 | Enter key submits card entry modal | UX | ✅ Done |
| 26 | Follow-up chips auto-generated per product turn | UX | ✅ Done |
| 27 | Sort bar per turn (client-side re-sort) | UX | ✅ Done |
| 28 | Intent badges ("AI matched: blue · size 10 · under $100") | UX | ✅ Done |
| 29 | Same-model product deduplication in search results | Fix | ✅ Done |
| 30 | No skeleton cards on follow-up Q&A turns | Fix | ✅ Done |
| 31 | "this/it/that" resolves to product #1 in follow-ups | Fix | ✅ Done |

---

## Build Log

| Date | # | What changed |
|---|---|---|
| 2026-09-30 | — | v2-upgrade branch created from ts-version1 |
| 2026-09-30 | 1 | `classify_message_intent()` added — LLM classifies any message before pipeline routing |
| 2026-09-30 | — | `answer_product_followup()` added — LLM answers questions about already-shown products |
| 2026-09-30 | 31 | "this/it/that" pronoun resolution fixed — always resolves to product #1 |
| 2026-09-30 | 30 | No skeleton cards on follow-up Q&A (skeletons only appear when SneakPeek is running) |
| 2026-09-30 | 29 | Same-model deduplication added to `rank_products_node` — highest-scored variant kept |
| 2026-09-30 | 21 | Left sidebar collapses by default; expand arrow shown inside collapsed state |
| 2026-09-30 | — | TalkShop header branding added |
| 2026-09-30 | 9 | Affirmative reply intercept — "yes"/"ok" after recommendation triggers checkout |
| 2026-10-01 | 6 | `InlineCheckout` component built — phases: setup, summary, processing, confirmed, failed |
| 2026-10-01 | 12 | CartUp step messages tagged so they appear in the right panel |
| 2026-10-01 | 17 | `doPayment` mirrors GreenLight/PayIt/TrackIt steps into `turn.steps` for panel visibility |
| 2026-10-01 | 17 | `activeTurnId.current` set at start of `doPayment` so panel tracks the correct turn |
| 2026-10-01 | 17 | `turns.flatMap(t => t.steps)` — panel accumulates steps from ALL turns in session |
| 2026-10-01 | 2 | `answer_general_message()` — LLM-powered reply for any non-shopping question |
| 2026-10-01 | 3 | `answer_product_question_with_action()` — structured action added to follow-up answers |
| 2026-10-01 | 4 | `ChatAction` type added; SSE `recommendation` event carries `{products, action}` |
| 2026-10-01 | 11 | `remove_from_cart` action handled in `onRecommendation` callback |
| 2026-10-01 | 5 | Top 10 stored per session; `show_more` returns products 6-10 |
| 2026-10-01 | 19 | Right panel width defaults to 40% of screen via `Math.round((window.innerWidth - 48) * 0.40)` |
| 2026-10-01 | 13 | `AgentTrailPanel` rewritten — 6-node horizontal flowchart with SVG arrows |
| 2026-10-01 | 14 | Animated pulse ring on running node; status badge on each node |
| 2026-10-01 | 15 | Click-to-expand per agent: key-value output table + step timeline |
| 2026-10-01 | 18 | Progress bar `doneCount / 6` with gradient fill |
| 2026-10-01 | 16 | All agents always rendered; idle agents show description on expand |
| 2026-10-02 | 7 | `InlineCartCard` component — inline cart confirmation with product + cart list + action buttons |
| 2026-10-02 | 8 | `add_to_cart` LLM action type added; `checkout` reserved for payment intent only |
| 2026-10-02 | 8 | `isAddToCartPhrase()` frontend intercept — "add it"/"add to cart" calls `doAddToCart`, not `doCheckoutSummary` |
| 2026-10-02 | 8 | `doAddToCart` / `attachAddToCartToActiveTurn` — adds item, fetches fresh cart, shows cart card |
| 2026-10-02 | 4 | `show_cart` action also sets `showCartInline` on turn — cart card shows in chat |
| 2026-10-02 | 22 | `doCheckoutSummary` + `attachCheckoutToActiveTurn` save checkout to `sessionStorage` |
| 2026-10-02 | 23 | `doPayment` saves confirmed order to `sessionStorage`; clears checkout key |
| 2026-10-02 | 22 | `loadSession` restores confirmed order or in-progress checkout from `sessionStorage` |
| 2026-10-02 | 24 | `updateGuestCard` saves guest card to `sessionStorage` for cross-navigation persistence |
| 2026-10-02 | 24 | `cancelCheckout` clears `sessionStorage` checkout key |
| 2026-10-02 | 25 | `SecurePaymentModal` wrapped in `<form>` — Enter key submits card details |

---

## Design Principles

- **LLM for understanding, deterministic for money** — the LLM decides intent and writes prose; price, inventory, tokens, and payments are always code
- **Zero navigation** — the user should never need to leave the chat to complete a purchase
- **Persistent state** — navigating away and back should never lose progress or require re-entry
- **Every agent visible** — the right panel tells the full story of what happened, even for past turns
- **One action per message** — the LLM returns at most one frontend action per response, keeping the UX predictable
