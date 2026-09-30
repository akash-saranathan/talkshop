# Talkshop — Product Definition

## What it is

Talkshop is an AI-native commerce platform where shopping happens entirely through conversation. You describe what you want in plain language, and a multi-agent AI pipeline searches across stores, applies your constraints, ranks results, and walks you through checkout — without a single filter dropdown, category page, or search bar.

---

## How it differs from traditional e-commerce

| Dimension | Traditional e-commerce | Talkshop |
|---|---|---|
| **Discovery** | Browse categories, apply filters, paginate through results | Describe what you want in one sentence |
| **Search** | Keyword match against product titles | Intent extraction → structured constraints → ranked results |
| **Filters** | Dropdowns for size, color, price, brand | Expressed naturally in the message ("under $100", "blue", "size 10") |
| **Results explanation** | No reason given for ranking | Match tags on every card show exactly what the AI matched |
| **Follow-up** | Modify filters, start a new search | Continue the conversation ("only Nike", "under $80", "which one should I buy?") |
| **Checkout trigger** | Explicit "Go to Cart → Checkout" flow | Inline "Add to Cart" from chat; auto-countdown to checkout; or voice-triggered |
| **History** | Order history only | Full conversation history — browse past sessions, re-ask questions |
| **Loading state** | Spinner or blank page | Skeleton cards shaped like results so users see what's coming |
| **Multi-store** | One store's inventory | Single query searches all connected merchants simultaneously |
| **Transparency** | Black-box ranking | Agent trail panel shows every agent step in real time |

---

## Unique features (built so far)

### Conversational intent engine
VibeCheck (Agent 1) extracts structured shopping intent from free text — color, size, price ceiling, brand, delivery deadline, use case, occasion. It handles ambiguity, follow-ups, and merges context across turns ("make it size 11" updates the previous intent rather than starting fresh).

### Multi-agent pipeline — visible to the user
Six specialized agents run on every query. Their activity streams live into the right panel:
- **VibeCheck** — intent extraction + safety guardrails
- **SneakPeek** — multi-store search, deterministic constraint filtering, rank scoring
- **CartUp** — order assembly
- **GreenLight** — DPAT token issuance + spend authorization
- **PayIt** — payment execution
- **TrackIt** — order confirmation

### Match checkmarks on product cards
Every card shows exactly which constraints the AI verified — `✓ blue  ✓ size 10  ✓ under $100`. Not a score. Not a black box. Immediate trust signal that the AI understood the request.

### Skeleton loading grid
As soon as the search pipeline starts, three ghost cards pulse in the result area. Users see product-shaped placeholders filling in, not a spinner. Signals that specific items are being retrieved, not just "loading".

### Delivery urgency on every card
`⚡ Arrives tomorrow` or `📦 Arrives Thu, Oct 3` — computed from today's date and the product's `delivery_days` value. Fast deliveries (≤ 2 days) glow green. No need to click into the product detail to find out.

### Instant sort bar
After results arrive, a `Best Match · ↓ Price · Top Rated · Fastest` bar re-sorts the existing cards client-side without a new query. Active sort is highlighted.

### Follow-up chips
After each result set, contextual chips appear: `Only Nike · Under $80 · Fastest delivery only · Which one should I buy?`. One tap pre-fills the input; Enter sends it. Keeps users in the flow without retyping.

### Session-aware cart strip
A persistent strip above the input shows how many items were added in the current chat session — separate from the global cart total. Resets when switching sessions. Clicking it opens the full cart.

### Per-session conversation memory
Each chat session is persisted. Users can return to past sessions and continue shopping where they left off. The session sidebar mirrors the ChatGPT thread pattern.

### Voice input
A hold-to-speak microphone with a real audio waveform level meter. Continuous recognition — pauses don't end the session.

### Image search
Paste a screenshot of something you like; the AI infers the product category and visual attributes to find similar items.

### Guardrails
NeMo input rails block harmful or off-topic requests before they reach the search pipeline. A separate Guardrails AI layer validates structured intent output.

### Multi-select bulk checkout
Checkbox each card you want; a floating bar shows the total and a single "Buy Selected" button adds them all to cart and navigates to checkout.

---

## What can be improved

### High priority

**1. Voice as the primary input** — the mic button is secondary today. It should be the hero CTA, especially on mobile, with a large hold-to-speak surface. A truly conversational app should make speaking feel easier than typing.

**2. Compare mode** — when 2–3 products are selected, a "Compare" button should open a side-by-side spec table (price, rating, delivery, size, key attributes). Decisions happen at the comparison stage; right now that step is missing.

**3. Smarter no-results message** — currently falls back to a generic "Try adjusting your filters." The AI knows exactly why it found nothing (price too low, color not stocked, size out of stock). It should explain: *"No blue sneakers under $50 — closest is $74. Try $80?"* with a tappable suggestion.

**4. Preference learning** — across sessions, the app should notice patterns (user always picks Nike, always size 10, always under $100) and surface them: *"Based on your past searches, adding Nike and size 10 — is that right?"* This turns a search tool into a personal shopper.

**5. Cart drawer** — navigating away to `/cart` breaks the chat context. A slide-in drawer over the chat would let users review cart items, adjust quantities, and start checkout without losing their conversation.

### Medium priority

**6. Streaming recommendation text** — the recommendation paragraph appears all at once after the products. Streaming it in word by word (like ChatGPT responses) would make the AI feel more present and alive.

**7. Product image zoom** — clicking the product image should open a full-size lightbox with swipe support, not just the detail modal.

**8. "Why this?" explainer** — a tap/hover on the match checkmarks should expand to a one-sentence explanation: *"Ranked #1 because it matched all 3 of your filters and has the highest rating among blue size-10 shoes under $100."*

**9. One-tap reorder** — the Recent Orders list in the Agent Trail panel already shows past purchases. Adding a "Reorder" button next to each would let users re-run the same purchase in two taps.

**10. Merchant trust badges** — show verified merchant indicators (response time, return policy, trust tier) on cards. This is a trust signal that matters when buying from an unfamiliar store via an AI recommendation.

### Future / larger scope

**11. Price drop alerts** — after a session, the user can opt in to get notified if the recommended product drops below their stated budget. Turns one-time intent into ongoing value.

**12. Collaborative shopping** — share a chat session link with someone else to shop together. Each person can add items, leave comments on product cards, and vote on options.

**13. Budget tracking** — a persistent "today's spend" and "monthly spend" summary tied to completed orders, visible in the dashboard.

**14. Proactive recommendations** — based on past order history ("you bought running shoes 6 months ago — time for a new pair?"), the AI surfaces relevant suggestions without being asked.

**15. External merchant integrations** — currently local catalog + DummyJSON. Adding real Shopify/BestBuy connectors would let users shop actual live inventory.
