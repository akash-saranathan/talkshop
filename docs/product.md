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

**2. Compare mode** ✅ *Shipped* — select 2–4 products → Compare button → side-by-side spec table (price, rating, delivery, color, size, shipping, merchant). Best value highlighted per column. Each column has Add to Cart. AI-powered recommendation panel explains which product wins overall and why (price, rating, delivery, free shipping), with a highlighted winner card.

**3. Smarter no-results message** ✅ *Shipped* — when search returns nothing, the AI now names exactly what it couldn't find ("No blue running shoes size 10 under $80 found") and suggests the most actionable fix ("Try raising budget to $104?").

**4. Preference learning** — across sessions, the app should notice patterns (user always picks Nike, always size 10, always under $100) and surface them: *"Based on your past searches, adding Nike and size 10 — is that right?"* This turns a search tool into a personal shopper.

**5. Cart drawer** ✅ *Shipped* — cart icon and session-cart strip now open a slide-in drawer over the chat. Shows session vs. previous items, qty controls, remove, wallet balance, and a link to the full cart page. Chat context is never lost.

### Medium priority

**6. Streaming recommendation text** ✅ *Shipped* — recommendation text now streams word-by-word at 40ms/word with a live cursor, matching the ChatGPT feel.

**7. Product image zoom** ✅ *Shipped* — clicking a product image opens a full-screen lightbox with spring animation. ZoomIn icon appears on hover. Eye button still opens the detail modal.

**8. "Why this?" explainer** ✅ *Shipped* — hovering match tags (✓ blue, ✓ size 10, ✓ under $100) shows a tooltip explaining exactly why that constraint was matched for that product.

**9. One-tap reorder** — the Recent Orders list in the Agent Trail panel already shows past purchases. Adding a "Reorder" button next to each would let users re-run the same purchase in two taps.

**10. Merchant trust badges** ✅ *Shipped* — Verified / Premium badge next to every merchant name. Hovering shows ships-in time and return policy. A persistent "🚚 Ships in 24h · ↩ 30-day returns" line appears below the badge.

### Future / larger scope

**11. Price drop alerts** — after a session, the user can opt in to get notified if the recommended product drops below their stated budget. Turns one-time intent into ongoing value.

**12. Collaborative shopping** — share a chat session link with someone else to shop together. Each person can add items, leave comments on product cards, and vote on options.

**13. Budget tracking** — a persistent "today's spend" and "monthly spend" summary tied to completed orders, visible in the dashboard.

**14. Proactive recommendations** — based on past order history ("you bought running shoes 6 months ago — time for a new pair?"), the AI surfaces relevant suggestions without being asked.

**15. External merchant integrations** — currently local catalog + DummyJSON. Adding real Shopify/BestBuy connectors would let users shop actual live inventory.

---

## Notification & real-time order tracking (next major feature area)

This is a distinct capability layer — turning Talkshop from a one-shot purchase tool into an ongoing relationship with the user across channels.

### How it works end-to-end

1. **User places an order** → `PayIt` agent completes → backend triggers an immediate order confirmation email using the email already stored in the `users` table.
2. **A scheduled agent** runs every hour, checks all `paid` orders, and advances their status through a defined progression: `paid → processing → shipped → out_for_delivery → delivered`.
3. **Each status transition** fires a notification (email and/or WhatsApp) with the relevant update: *"Your Brooks Ghost 15 has shipped — arrives Thursday, Oct 3."*
4. **With a real carrier integration** (EasyPost, ShipStation), the mock progression is replaced by actual webhook events pushed from the carrier whenever the package moves. The agent reacts to those instead of simulating them.

### Buildable now vs later

| Item | Effort | Needs |
|---|---|---|
| **16. Order confirmation email** | Low — a few hours | Free Resend or SendGrid API key; email already in DB |
| **17. Order status update emails** (simulated) | Low — half a day | Scheduled cron/agent job; no external account |
| **18. Real shipping tracking** | Medium — 1 day | EasyPost free sandbox account; real tracking numbers |
| **19. WhatsApp notifications** | Medium — 1–2 days | Twilio account; add phone number field to user profile |
| **20. Price drop alert emails** | Medium | Extends item 11 above; needs a watcher job per intent |

### Notes
- Items 16 and 17 use only infrastructure already in the project (SQLite DB, user email, Python backend). No new accounts needed beyond a free email API key.
- WhatsApp (item 19) requires users to opt in with a phone number — a new field on the profile page — and a Twilio WhatsApp Business number.
- The AI agent doesn't inherently "know" a package shipped — the carrier tells it via webhooks (item 18). Items 16–17 simulate this loop so the full notification experience works in demo before real carriers are connected.
