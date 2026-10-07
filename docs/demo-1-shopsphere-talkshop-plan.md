# Demo 1: ShopSphere × Talkshop — Merchant Chat Assistant

**Build plan: phases, steps, exact flow and how it all works**

| | |
|---|---|
| **Branch** | `demo-1-merchant-chat-assistant`. Local only; never pushed or merged to `main` until we decide |
| **Source spec** | *ShopSphere Demo 1: Step-by-Step Backend Architecture & Orchestration Pipeline* (followed exactly; see §12 traceability) |
| **Status** | ✅ Plan approved. Building phase by phase, with your approval required after each phase |

---

## ✅ Implementation checklist

**How this works:** as each step is finished, its box is ticked `[x]`. When every step in a phase is done and its checkpoint passes, the phase is ready for review. **The next phase starts only after you tick "Approved"** (or tell me to). Step details are in §11.

### Progress

**Phases approved: 7 / 10 · Steps done: 81 / 81** · Phases 7, 8 and 9 👀 ready for your review

| Phase | Name | Steps | Status |
|---|---|---|---|
| 0 | Groundwork | 4 / 4 | ✅ Approved |
| 1 | ShopSphere catalog and data foundation | 7 / 7 | ✅ Approved |
| 2 | ShopSphere merchant services (APIs) | 8 / 8 | ✅ Approved |
| 3 | Talkshop orchestrator (AI layer) | 12 / 12 | ✅ Approved |
| 4 | ShopSphere storefront (website) | 10 / 10 | ✅ Approved |
| 5 | Talkshop panel (inside ShopSphere) | 11 / 11 | ✅ Approved |
| 6 | Connecting ShopSphere and Talkshop | 6 / 6 | ✅ Approved |
| 7 | Polish, quality and demo readiness | 6 / 6 | 👀 Ready for your review |
| 8 | Shop without logging in (login only at checkout) | 9 / 9 | 👀 Ready for your review |
| 9 | Secure checkout details in Talkshop | 8 / 8 | 👀 Ready for your review |

Status key: ⬜ Not started · 🔨 In progress · 👀 Ready for your review · ✅ Approved

### Phase 0: Groundwork
- [x] 0.1 `CATALOG_SOURCES` setting: ShopSphere catalog only (DummyJSON, Shopify, Best Buy switched off)
- [x] 0.2 DummyJSON validation bug recorded as a known issue
- [x] 0.3 Guest login removed from the UI
- [x] 0.4 Demo reset command (reseed catalog, customer, carts, orders)
- [x] **Checkpoint:** app runs, search returns ShopSphere catalog only, reset works *(174 tests pass; live search: "30 products across 1 store", 0 DummyJSON)*
- [x] **Approved, proceed to Phase 1**

### Phase 1: ShopSphere catalog and data foundation
- [x] 1.1 Catalog file: about 60 products, variants, gender tags, new arrivals, stock gaps, the spec's 3 running shoes
- [x] 1.2 Colour photos sourced, resized and saved locally, plus licence record
- [x] 1.3 Schema: product fields + `product_variants` (SKU, size, colour, stock, image)
- [x] 1.4 Schema: `addresses`, `payment_methods` (masked), `checkouts`
- [x] 1.5 Schema: extended `orders` + `order_lines`; SKU-based cart
- [x] 1.6 Seed: ShopSphere merchant, catalog, Kaajal with 2 addresses and 2 cards
- [x] 1.7 Catalog and seed tests
- [x] **Checkpoint:** fresh reset gives the catalog with variants and photos, and Kaajal's saved details *(184 tests pass on a fresh test database; 60 products, 400 SKUs, 99 studio photos)*
- [x] **Approved, proceed to Phase 2**

### Phase 2: ShopSphere merchant services (deterministic APIs, no AI)
- [x] 2.1 Catalog / search API (filters + ranking)
- [x] 2.2 Inventory API (sizes, colours, SKU stock, alternatives)
- [x] 2.3 Cart API (SKU-based, full cart in every response)
- [x] 2.4 Customer profile API (addresses, masked payment methods)
- [x] 2.5 Checkout API (complete checkout record, server-side recalculation)
- [x] 2.6 Payment API, consent-gated (stock re-check → GreenLight → PayIt → processor)
- [x] 2.7 Order service (`SS-#####`, reduce stock, save everything, tracking)
- [x] 2.8 API tests: happy path + every §7 alternative path
- [x] **Checkpoint:** full purchase flow passes as API tests with no LLM *(206 tests pass, incl. 21 service tests covering every §7 path)*
- [x] **Approved, proceed to Phase 3**

### Phase 3: Talkshop orchestrator (AI layer)
- [x] 3.1 Stage tracker (stages and allowed transitions)
- [x] 3.2 Intent extraction without questions before searching
- [x] 3.3 Tool layer (8 tools calling the Phase 2 services)
- [x] 3.4 Orchestrator loop (stage → LLM decision → tool → events)
- [x] 3.5 Top 3 + one-line reasons from returned facts only
- [x] 3.6 Option questions (size → colour) with inventory checks
- [x] 3.7 Cart → offer checkout → checkout for this conversation's items only
- [x] 3.8 Consent gate: payment only from the GO AHEAD event
- [x] 3.9 Structured event stream (§9.4)
- [x] 3.10 Page context + "Ask Talkshop about this" entry
- [x] 3.11 Old browser-run cart and checkout actions retired *(Talkshop's new orchestrator has none. The old `/api/chat` code path is deleted together with the old chat page in 5.11, so today's chat keeps working until the new panel replaces it)*
- [x] 3.12 Orchestrator tests (incl. "typing go ahead never pays")
- [x] **Checkpoint:** demo script runs through the stream with the right events *(228 tests pass incl. 22 orchestrator tests; live run with Gemini: spec flow end to end, order SS-#####, typed "go ahead" never pays)*
- [x] **Approved, proceed to Phase 4**

### Phase 4: ShopSphere storefront (website)
- [x] 4.1 Design system: tokens (light + dark), typography, buttons, chips, cards
- [x] 4.2 Store layout: ShopSphere header + Talkshop slot
- [x] 4.3 Home: hero, Talkshop-picks row slot, new arrivals, departments
- [x] 4.4 Category pages with filters
- [x] 4.5 Product page: per-colour gallery, size and colour pickers, Ask Talkshop button
- [x] 4.6 Cart page with Select checkboxes
- [x] 4.7 Checkout page with Change, Standard/Express, inline add forms, Place order
- [x] 4.8 Order confirmation + My Orders
- [x] 4.9 ShopSphere login and sign up (no guest)
- [x] 4.10 Routing
- [x] **Checkpoint:** full website purchase without Talkshop, in light and dark *(browser-automated: login → Shoes → FlexRun 5 orange/9 → cart select → Express → Place order → SS-##### in My orders, light + dark, no console errors; no horizontal overflow at 390 px)*
- [x] **Approved, proceed to Phase 5**

### Phase 5: Talkshop panel (inside ShopSphere)
- [x] 5.1 Panel shell: docked, minimise to button, phone bottom sheet, persists across pages
- [x] 5.2 Header + journey stepper + presenter toggle
- [x] 5.3 Composer: voice, image paste, autocorrect
- [x] 5.4 Top 3 cards (Select, View on ShopSphere)
- [x] 5.5 Option chips (sizes, colour swatches, unavailable greyed out)
- [x] 5.6 Cart-updated card + checkout quick replies
- [x] 5.7 Review Your Order card (qty, delivery, Change, inline add, GO AHEAD)
- [x] 5.8 Payment status card
- [x] 5.9 Order confirmed card + View in My Orders
- [x] 5.10 Presenter overlay (agent trace) *(built new inside the panel; the old AgentTrailPanel was retired with the old chat)*
- [x] 5.11 Old full-screen chat removed from navigation *(frontend page and its components deleted, `/assistant` redirects to the store. The backend `/api/chat` endpoints stay because the test suite still covers that pipeline)*
- [x] **Checkpoint:** whole §6 flow completes in the panel, in light and dark *(browser-automated in light, dark and phone: greeting → top 3 → Select → 8 → Black → cart → review $139.64 → typed "go ahead" refused → GO AHEAD → SS-##### → conversation kept across pages → View in My Orders → presenter view; no console errors)*
- [x] **Approved, proceed to Phase 6**

### Phase 6: Connecting ShopSphere and Talkshop
- [x] 6.1 Shared cart store (header badge bumps from both sides)
- [x] 6.2 Page context + page-aware greetings
- [x] 6.3 "Ask Talkshop about this" opens with product selected
- [x] 6.4 "Talkshop picks for you" row on the storefront
- [x] 6.5 Selection sync + View on ShopSphere
- [x] 6.6 Orders link + My Orders refresh
- [x] **Checkpoint:** connections I1–I9 (§5) checked in the browser *(automated in light + dark: greeting by name, page-aware greeting, picks row, selection highlight, badge 0→1→2→3→1 across chat + website adds and the chat order, View on ShopSphere, Ask Talkshop about this, chat checkout limited to chat items, My Orders refreshes live; no console errors)*
- [x] **Approved, proceed to Phase 7**

### Phase 7: Polish, quality and demo readiness
- [x] 7.1 Visual pass (every page and card, light and dark) *(streaks removed from FlexRun 5, Sphere Canvas Low and Converse; men's crew tee re-shot from a clean source, Black only)*
- [x] 7.2 Ease-of-use pass (§4.3 rules) *(chips for every choice, one primary action per card, no dead ends, unavailable options visible with reason, status while waiting, all amounts from the server)*
- [x] 7.3 Responsive pass (desktop, tablet, phone) *(9 pages × 3 sizes × 2 themes captured and reviewed; fixed phone checkout overflow, cramped phone order cards, room for the floating Ask Talkshop button; 0 overflow at every size)*
- [x] 7.4 All three demo scripts run from a reset, several times *(A, B, C × 3 fresh rounds, 9/9 passed with the real LLM, no console errors)*
- [x] 7.5 All tests green *(234 passed)*
- [x] 7.6 README "Demo 1" section
- [x] **Checkpoint:** all demo scripts run end to end with no manual fixes
- [ ] **Approved, proceed to Phase 8**

### Phase 8: Shop without logging in (login only at checkout)
- [x] 8.1 Visitor identity: anyone can browse; the store gives each new browser an anonymous visitor session
- [x] 8.2 Login required on the server only for checkout, payment, saved addresses/cards and My Orders
- [x] 8.3 Logging in or signing up merges the visitor's cart into the account and carries the Talkshop conversation over
- [x] 8.4 Talkshop: a visitor saying "Yes, checkout" gets a sign-in card; after signing in it continues straight to Review
- [x] 8.5 Frontend auth: store opens without login; header shows Log in for visitors; logout starts a fresh visitor
- [x] 8.6 Website checkout: visitor → login page → straight to checkout with the selected items
- [x] 8.7 My Orders and checkout pages ask visitors to log in
- [x] 8.8 Tests: visitor, login gates, cart merge, Talkshop sign-in flow
- [x] 8.9 Browser check + demo scripts re-run (incl. a new visitor script D)
- [x] **Checkpoint:** a visitor can browse, chat and fill a cart, and logs in only to check out (website and Talkshop) *(new script D + A, B, C × 3 fresh rounds: 12/12 passed; D also in dark and on phone; 246 tests)*
- [ ] **Approved, proceed to Phase 9**

### Phase 9: Secure checkout details in Talkshop
- [x] 9.1 Checkout checks whether the customer has a shipping address and a saved card (merchant data)
- [x] 9.2 Missing address: an inline **Secure ShopSphere Checkout** form that posts straight to ShopSphere's profile API
- [x] 9.3 Missing card: an inline **Secure Payment** form that posts straight to ShopSphere's card tokenization. Talkshop gets back only the card id, brand and last 4 digits
- [x] 9.4 After each save, checkout resumes automatically. ShopSphere recalculates the order, and Review shows one GO AHEAD
- [x] 9.5 Card details typed into the chat are masked in the browser and again on the server, and never reach the LLM. Addresses typed during checkout are withheld from the chat
- [x] 9.6 Edge cases: save/tokenization failures, someone else's address, an order failing after payment approval (payment released), a declined card
- [x] 9.7 Tests: 23 new; full suite 300
- [x] 9.8 Browser check (light, dark, phone) + demo scripts A–D on a fresh database
- [x] **Checkpoint:** a new customer checks out entirely in Talkshop. Address and card go only to ShopSphere, and the AI never sees them *(secure flow ×3 views passed; the raw card number reached only `/api/me/payment-methods`; A–D 4/4 on fresh data)*
- [ ] **Approved: Demo 1 complete 🎉**

---

## 1. What Demo 1 is

| Name | What it is |
|---|---|
| **ShopSphere** | The **merchant's website**: an online store with categories, product pages, a cart, checkout and My Orders |
| **Talkshop** | ShopSphere's **built-in AI shopping assistant**. It lives *inside* the ShopSphere website, docked on the right. It is not a separate app or a ChatGPT-style page |

The customer is **already logged in to ShopSphere**. They can shop in two ways, which share **one cart, one catalog, one checkout service and one order history**:

1. **On the website**, by hand: browse → product page → pick size and colour → add to cart → select items in the cart → checkout.
2. **With Talkshop**, by conversation, following the spec's pipeline exactly: request → top 3 → select → size → colour → cart → checkout → review → **GO AHEAD** → authorized → order confirmed.

> **Core principle (from the spec):** *Talkshop (the LLM) understands and coordinates the journey. ShopSphere's merchant services own and execute every transaction.*
> **Talkshop decides what needs to happen → ShopSphere's tools and services actually do it.**

Talkshop must never make up a product, price, rating, stock level, cart, tax, delivery date or order number. Each of those values comes from a ShopSphere service and is shown exactly as returned.

---

## 2. Decisions log (agreed)

| # | Topic | Decision |
|---|---|---|
| D1 | Names | **ShopSphere** = merchant website · **Talkshop** = its AI assistant |
| D2 | Product data source | **Synthetic ShopSphere catalog only.** DummyJSON, Shopify and Best Buy are switched off for Demo 1 (code kept for later; see §9.1) |
| D3 | Departments | **Shoes · Clothing · Accessories · Electronics** |
| D4 | Catalog size | **60 products with full variants** (full size ranges; 400 sellable variants). Colours per product: see D24 |
| D5 | Product images | **One photo per colour**, **saved locally** in the repo (works offline, never breaks). Source and style: D22–D23 |
| D6 | Navigation | **Women · Men · Shoes · Accessories · Electronics** (products tagged women, men or unisex) |
| D7 | Talkshop placement | **Docked on the right, open by default.** Minimise to a floating "Ask Talkshop" button. Conversation kept across pages |
| D8 | Top 3 display | **In the chat** (compact cards with **Select**) **and highlighted on the page** ("Talkshop picks for you" row in full size) |
| D9 | Visual style | **Clean premium**: white space, large photos, simple typography, one accent colour |
| D10 | Theme | **Light + dark**, both polished, with a toggle in the header |
| D11 | Quantity | **Default 1, not asked.** Changeable with −/+ on the Review card |
| D12 | Website checkout scope | Cart page has **Select** checkboxes. The customer chooses which items go to checkout |
| D13 | Talkshop checkout scope | **Only the item(s) Talkshop added in this conversation** (as in the spec). Other cart items stay in the cart |
| D14 | Saved address and card | Demo customer has **2 addresses and 2 cards**. Review shows the defaults with a **Change** link |
| D15 | Delivery | **Standard (free) preselected + Express (+$9.99)**, selectable on the Review card. Total and date update from the server |
| D16 | New sign-ups (no saved data) | **Add address and card inline in the Review card.** GO AHEAD unlocks once saved, and they're kept for next time |
| D17 | Login | **ShopSphere login + sign up. No guest checkout.** ~~Login required for everything~~ → changed in Phase 8 (D25) |
| D18 | Declined-payment demo | **Yes**: the second saved card (**Mastercard •••• 0019**) always declines. No order is created |
| D19 | Agent pipeline trace | **Hidden from customers.** A **"How Talkshop works"** toggle for presenters opens it as an overlay |
| D20 | Talkshop input features | Keep **voice (mic)**, **image search (paste a photo)** and **autocorrect** |
| D21 | Brand naming | **Mix**: real brands only where a matching or logo-free photo exists (Nike, Adidas, Converse, Levi's, Ray-Ban, Sony, Apple, Samsung, JBL: 13 products). Everything else is ShopSphere-style fictional brands (Kinetic, Northpace, Lumen, Hartwell, Marisol, Sphere Basics, Pulse Audio…). A request for a brand ShopSphere doesn't carry gets "we don't carry X, here are similar" |
| D22 | Photo source | **Pixabay** (free licence, no attribution). Pexels has paused new API keys. Every photo is **hand-picked and checked by eye** |
| D23 | Photo style | **Studio style**: background removed, product centred on one soft neutral backdrop with a floor shadow, square **800×800** WebP (square fits wide items like shoes and laptops better than the planned 4:5) |
| D25 | When login is needed (Phase 8) | **Only at checkout.** Anyone can browse, add to cart and chat with Talkshop. Login (or sign up) is needed to check out, pay, see saved addresses/cards and see My Orders |
| D26 | Cart on login | **Merge**: what the visitor added moves into the account's cart, combined with anything already there (quantities add up, capped by stock) |
| D27 | Talkshop login | **Sign-in card inside the chat.** After signing in, the conversation continues straight to Review Your Order |
| D28 | Website login | **Login page, then straight to checkout** with the items the visitor selected |
| D29 | Chat after login | Logging in **from a visitor session keeps the conversation** (same shopper). Logging **out** still starts a fresh chat (earlier request) |
| D24 | Colours follow photos | A product offers only colours it has a convincing photo for. Result: 26 products × 1 colour, 30 × 2, 3 × 3, 1 × 4 (99 photos, 400 SKUs). Fewer colours than D4's 2–4 target, but no wrong photos. Where possible the colours are **the same model** (e.g. FlexRun 5, Converse, men's tees) |

## 3. Assumptions (not yet confirmed; tell me if any are wrong)

| # | Assumption | Why |
|---|---|---|
| A1 | **Tax = flat 8.25%** on product subtotal (not on shipping) | Matches the spec: $129 → tax $10.64 → total $139.64 |
| A2 | **Order ID format `SS-#####`** (e.g. SS-48291) | From the spec |
| A3 | **Express** = +$9.99, arrives in **2 days**. **Standard** = free, product's normal delivery days | Simple and easy to see in the demo |
| A4 | Website checkout's consent button is **"Place order"**. Talkshop's is **"GO AHEAD"** | Spec defines GO AHEAD for the chat. The website follows normal store conventions |
| A5 | Stock is **re-checked before charging** and **reduced when the order is created**. Out-of-stock → no charge | Spec step 10: "Reserve / commit inventory" |
| A6 | **Payment processor stays mocked** (no real gateway). Cards are stored **masked only** (brand, last4, expiry, token reference) | Demo safety. The spec only needs masked payment |
| A7 | Electronics use **colour + storage/model** in the "size" slot (e.g. phone 128 GB / 256 GB). Accessories are mostly **one size** | Keeps one variant model for all departments |
| A8 | Talkshop asks only for **options that have more than one value** (one-colour product → no colour question) | Spec: "minimum required follow-up questions" |
| A9 | Today's demo login (`demo@talkshop.io`) becomes **`kaajal@shopsphere.demo` / `demo1234`**, name **Kaajal** | Spec mockups show "Kaajal" |

---

## 4. The experience: one website with the assistant built in

### 4.1 Screen layout (desktop)

```
+-------------------------------------------------------------------------------------------+
| ◆ SHOPSPHERE    Women  Men  Shoes  Accessories  Electronics      🔍 Search    🛒 2  Kaajal ▾ ☾ |
+-------------------------------------------------------------------------------+-----------+
|                                                                               | ✦ Talkshop |
|   ┌─────────────────────────────────────────────────────────────────────┐     | ShopSphere|
|   │                     SHOP NEW ARRIVALS                               │     | assistant |
|   │              Fresh styles for every day  ·  [Shop now]              │     |───────────|
|   └─────────────────────────────────────────────────────────────────────┘     | Hi Kaajal 👋|
|                                                                               | How can I |
|   ✦ TALKSHOP PICKS FOR YOU          (appears when Talkshop recommends)        | help you  |
|   [  Runner Pro X  ] [  FlexRun 5  ] [  Daily Runner  ]                       | shop today|
|                                                                               |           |
|   NEW ARRIVALS                                                                | [Running  |
|   [Product] [Product] [Product] [Product]                                     |  shoes    |
|   [Product] [Product] [Product] [Product]                                     |  < $150]  |
|                                                                               |───────────|
|                                                                               | Ask…  🎤 ➤ |
+-------------------------------------------------------------------------------+-----------+
```

- **Storefront:** takes the main area, with the ShopSphere header always visible.
- **Talkshop panel:** about 400 px, docked on the right, **open by default**. **—** minimises it to a floating **✦ Ask Talkshop** button, and the conversation, stage and cart reference are kept.
- **Phones and small screens:** Talkshop becomes a bottom sheet that slides up over the page.
- **Header cart badge:** one badge shared by the website and Talkshop.

### 4.2 Talkshop panel anatomy

```
┌───────────────────────────────┐
│ ✦ Talkshop          ⓘ  —      │ ← ⓘ = "How Talkshop works" (presenter toggle)
│ ShopSphere assistant          │
├───────────────────────────────┤
│ ● Search ● Choose ○ Size ○ …  │ ← journey stepper: Search · Choose · Size · Colour · Cart · Review · Done
├───────────────────────────────┤
│  (messages + cards)           │
│                               │
├───────────────────────────────┤
│ [chip] [chip] [chip]          │ ← suggested replies for the current stage
│ Ask Talkshop…   📎  🎤   ➤    │ ← image paste, voice, send (autocorrect on)
└───────────────────────────────┘
```

### 4.3 Look and feel: clean premium, light + dark

| Element | Guideline |
|---|---|
| Layout | Generous white space, 12-column grid, large product photos (4:5 ratio), max 4 products per row |
| Typography | One clean sans-serif (e.g. *Inter*). Large and confident headings, quiet body text |
| Colour | Neutral base (white / near-black) with **one ShopSphere accent**. Talkshop has a **matching but distinct** accent so the assistant is recognisable |
| Theme | Light and dark both polished, using shared colour tokens. Product photos have soft neutral backgrounds that work in both |
| Cards | Soft corners, subtle shadow on hover, price and rating always in the same place |
| Motion | Short and purposeful: panel slide, card fade-in, cart badge "bump", stepper progress |

**Making it easy to use (rules for every screen):**
1. **Every Talkshop question offers tappable chips** (sizes, colours, Yes/No). Typing works too.
2. **One primary button per card** (Select, Add to cart, GO AHEAD). Secondary actions are text links.
3. **No dead ends:** every stage has a way back (Change, Keep shopping, Cancel).
4. **Unavailable options are visible but greyed out** with a reason ("Out of stock").
5. **Show status while waiting:** "Searching ShopSphere…", "Checking stock…", "Authorizing…".
6. **Prices and totals always come from the server.** Nothing is recalculated in the browser.

---

## 5. ShopSphere + Talkshop working as one product

| # | Connection | How it works |
|---|---|---|
| I1 | **One login** | The ShopSphere session is Talkshop's identity. Talkshop greets the customer by name |
| I2 | **One cart** (owned by ShopSphere's Cart API) | Talkshop adds → **header badge bumps** and the cart page shows it. The website adds → Talkshop's `get_cart` sees it |
| I3 | **Page awareness** | Each message carries the current page (home, category, product). On a Shoes page: *"Looking for shoes? Tell me what you need."* |
| I4 | **"Ask Talkshop about this"** on every product page | Opens the panel with that product **already selected**, going straight to the size question (spec step 5) |
| I5 | **Top 3 shown in both places** (D8) | Chat shows compact cards. The storefront shows a **"✦ Talkshop picks for you"** row with the same 3 products in full size |
| I6 | **Selection syncs** | Selecting in chat highlights that product on the page. **"View on ShopSphere"** opens its product page while the chat stays open |
| I7 | **One catalog** | The same IDs, prices, stock and images on the website and in Talkshop |
| I8 | **One checkout and payment service** | The website's "Place order" and Talkshop's "GO AHEAD" use the **same** checkout, payment and order services |
| I9 | **Orders link back** | Talkshop's order confirmation has **"View in My Orders"**, which opens the ShopSphere order page |

---

## 6. The Talkshop flow, step by step (spec pipeline)

Each row shows what the customer sees, what Talkshop decides, and which ShopSphere service does the work.

| # | Spec step | Customer sees (panel · page) | Talkshop orchestrator (AI) | ShopSphere service (code) | Result |
|---|---|---|---|---|---|
| T1 | 1 · Logged in on ShopSphere | Store home. Header "Kaajal". Panel: *"Hi Kaajal 👋 How can I help you shop today?"* with starter chips | Loads the customer's name and page context | Auth/session · catalog `featured` | Logged-in session |
| T2 | 2 · Natural-language request | *"I need running shoes under $150 for everyday running."* | Receives the message and page context | — | Message |
| T3 | 2 · Intent extraction | Status line: *"Understanding your request…"* | LLM → structured intent | — | `{intent: PRODUCT_SEARCH, category: running_shoes, budget_max: 150, purpose: "everyday running"}` |
| T4 | 2 · **No unnecessary questions** | — | Enough to search → **search now, don't ask size or colour** | — | — |
| T5 | 3 · Product search | *"Searching ShopSphere…"* | Calls **`search_products`** | **Catalog/Search API:** hard filters (category, budget, in stock) → relevance ranking | Ranked products with ID, name, price, rating, image, colours, sizes |
| T6 | 4 · **Top 3** (first decision point) | Chat: 3 compact cards with **[Select]** + one-line reason. Page: **"Talkshop picks for you"** row. Stepper → *Choose* | Takes the service's top 3 and writes a short reason **using only returned facts** | — | 3 products. **The conversation waits** for the customer to choose |
| T7 | 4 · Customer selects | Clicks **Select**, or types *"the first one"* / *"Runner Pro X"*. Page highlights it | Records the selection | Product API (options) | Product with sizes and colours |
| T8 | 5 · Ask size | *"Great choice. What size would you like?"* + size chips (**out-of-stock greyed out**). Stepper → *Size* | Asks only for options still missing. Skips any option with one value | **Inventory API**: available sizes | Sizes with availability |
| T9 | 5 · Size answered and checked | *"Size 8"* | Validates the answer | **Inventory API** checks size 8 | Available, or alternatives offered |
| T10 | 5 · Ask colour | *"Size 8 is available. Which colour would you prefer?"* + colour chips (with swatch and photo). Stepper → *Colour* | Same rule as T8 | **Inventory API**: colours for size 8 | Colours with availability |
| T11 | 5 · Colour answered, variant confirmed | *"Black"* → *"✓ Runner Pro X · Size 8 · Black is in stock"*. Photo switches to the black one | Variant fixed | **Inventory API** checks the exact SKU | `SKU · AVAILABLE: YES` |
| T12 | 6 · Add to cart | *"Added to your ShopSphere cart ✓"* card. **Header badge bumps.** Stepper → *Cart* | Calls **`add_to_cart(SKU, qty 1)`** | **Cart API `ADD_ITEM`**: ShopSphere owns the cart | The cart as the server reports it: cart ID, line, subtotal |
| T13 | 7 · Offer checkout | *"Would you like me to proceed with checkout?"* **[Yes, checkout] [Keep shopping]** | Waits | — | — |
| T14 | 7 · Prepare checkout | *"Preparing your order…"* | Customer says yes → calls **`create_checkout`** with **only this conversation's item(s)** (D13) | **Checkout API** builds one **complete checkout record**: lines, default **address**, **delivery options** (Standard/Express), default **payment** (masked), **tax**, **total**. The server keeps it and fixes it with a hash | `checkout_id` + checkout record |
| T15 | 8 · **Review and consent** | **REVIEW YOUR ORDER** card (§6.1). Stepper → *Review* | Shows the record exactly as returned. **Payment must not start before GO AHEAD** | Changes (qty, delivery, address, card) → **Checkout API updates the record** | Waiting for consent |
| T16 | 9 · Consent → payment | Clicks **GO AHEAD** → *"Processing your order… Payment: Visa •••• 4821 · Authorizing…"* | Records consent, then hands over to code with no AI involved | **Payment service**: consent recorded → GreenLight issues a one-time signed payment token → PayIt runs **12 checks** → **payment processor** | **PAYMENT AUTHORIZED** (or decline, §7) |
| T17 | 10 · Create order | — | — | **Order service**: create order, **reduce stock**, save the final amount, payment status, address and delivery date, generate an `SS-#####` ID | Order details as the server reports them |
| T18 | 11 · Talkshop confirms | **ORDER CONFIRMED** card (§6.1). Stepper → *Done*. **[View in My Orders]** | Shows the order service's result **exactly as returned** | — | **End of Demo 1** |

### 6.1 Talkshop cards (what each one shows)

```
┌─ TOP 3 (in chat) ─────────┐  ┌─ REVIEW YOUR ORDER ──────────────────────┐  ┌─ ORDER CONFIRMED ─────────────┐
│ [img] Runner Pro X        │  │ [img] Runner Pro X                       │  │ ✓ Order SS-48291              │
│ ★ 4.7 · $129   [Select]   │  │       Size 8 · Black · Qty [−] 1 [+]     │  │ Runner Pro X                  │
│ View on ShopSphere ↗      │  │ Product                      $129.00     │  │ Size 8 – Black · Qty 1        │
├───────────────────────────┤  │ Tax                           $10.64     │  │ Total            $139.64      │
│ [img] FlexRun 5           │  │ Delivery  (•) Standard  Free · Oct 8     │  │ Paid with   Visa •••• 4821    │
│ ★ 4.6 · $139   [Select]   │  │           ( ) Express  +$9.99 · Oct 4    │  │ Delivery    October 8         │
├───────────────────────────┤  │ ─────────────────────────────────────    │  │ Ship to     Kaajal, Austin TX │
│ [img] Daily Runner        │  │ Total                        $139.64     │  │                               │
│ ★ 4.5 · $119   [Select]   │  │ Ship to  Kaajal, 12 Elm St…   Change     │  │ [View in My Orders]           │
└───────────────────────────┘  │ Payment  Visa •••• 4821        Change     │  └───────────────────────────────┘
                               │                                          │
                               │   [        GO AHEAD        ]   Cancel    │
                               └──────────────────────────────────────────┘
```

- **New customer with no saved address or card (D16):** the Ship to / Payment rows show **"+ Add shipping address" / "+ Add card"** forms inline. GO AHEAD stays disabled until both are saved.
- **Card details safety:** a new card number goes only to ShopSphere's payment service, which stores **masked details + a token reference**. The LLM never receives it.

### 6.2 Talkshop conversation stages

```
GREETING ─(shopping request)──────────► SEARCHING ──► RECOMMENDED (top 3 shown; waits)
RECOMMENDED ─(Select / "the first one")─► PRODUCT_SELECTED
PRODUCT_SELECTED ─(size missing)──────► ASK_SIZE ─(valid size)──► ASK_COLOR
ASK_COLOR ─(valid colour)─────────────► VARIANT_CONFIRMED          (questions skipped if only one option)
VARIANT_CONFIRMED ─(add_to_cart)──────► IN_CART ──► OFFER_CHECKOUT
OFFER_CHECKOUT ─(yes)─────────────────► CHECKOUT_READY ──► AWAITING_CONSENT (review card)
OFFER_CHECKOUT ─(keep shopping)───────► IN_CART (cart kept; can search again)
AWAITING_CONSENT ─(GO AHEAD click)────► PAYING ─(authorized)──► ORDER_CONFIRMED
                 ─(declined)──────────► AWAITING_CONSENT (change card / retry)
                 ─(Cancel)────────────► IN_CART (nothing charged)
Any stage ─(new shopping request)─────► SEARCHING (new search; cart untouched)
"Ask Talkshop about this" (product page) ─► PRODUCT_SELECTED (skips search)
```

- **The GO AHEAD button is the only way into PAYING.** Typing "yes" or "go ahead" while waiting for consent re-shows the review card; it never pays.
- Questions or comments in the middle of the flow ("is it good for flat feet?") are answered, then Talkshop **returns to the same stage**.

---

## 7. Alternative paths Demo 1 handles

| Situation | Behaviour |
|---|---|
| Size out of stock | *"Size 11 is out of stock in Runner Pro X. Available: 7, 8, 9, 10."* Stays at ASK_SIZE |
| Colour not available in that size | Offers the colours that are in stock for that size |
| No products match | Explains using the actual filters and suggests one change (*"Raise budget to $180?"*) |
| Declines checkout | *"No problem, it's saved in your ShopSphere cart."* Stays IN_CART |
| Cancel at review | Nothing is charged. The checkout record is discarded and the cart is kept |
| **Declined card (D18)** | Choose **Mastercard •••• 0019** with Change, then GO AHEAD → *"Payment wasn't authorized: card declined."* **No order created.** "Change card" to retry |
| Stock gone just before payment (A5) | *"Sorry, Runner Pro X size 8 just sold out."* No charge. Offers alternatives |
| New customer without saved details | Inline add-address and add-card forms on the review card (D16) |

---

## 8. Website shopping path (without Talkshop)

| # | Step | What happens | Service |
|---|---|---|---|
| W1 | Browse | Home → Women / Men / Shoes / Accessories / Electronics → product grid with filters (price, colour, size) | Catalog API |
| W2 | Product page | Photos (switch per colour), price, rating, **size and colour pickers with live stock**, **Add to cart**, **✦ Ask Talkshop about this** | Product + Inventory API |
| W3 | Add to cart | Badge bumps. Mini-cart confirmation | Cart API |
| W4 | Cart page | Every line has a **Select** checkbox (D12), plus qty −/+ and remove. Summary of the selected items. **[Checkout selected]** | Cart API |
| W5 | Checkout page | Same complete checkout record as Talkshop: lines, address (Change), delivery (Standard/Express), payment (Change), tax, total. **[Place order]** (A4) | Checkout API |
| W6 | Payment → order | Same payment service (GreenLight + PayIt + processor) and order service | Payment + Order services |
| W7 | Confirmation | Order confirmation page with `SS-#####`, then **My Orders** | Order API |

---

## 9. Architecture

### 9.1 Combined pipeline (spec, with the website connected)

```
CUSTOMER
   │
   ▼
SHOPSPHERE WEBSITE (logged in)  ◄──── one cart · one catalog · one session ────►  TALKSHOP PANEL
   │  page context, "Ask Talkshop"                         cart badge, highlights, order link ▲
   ▼                                                                                          │
TALKSHOP ORCHESTRATOR / LLM  (conversation stages, §6.2)
   ├──► PRODUCT SEARCH TOOL ─► Catalog/Search API ─► top 3 ─► customer selects
   ├──► VARIANT / INVENTORY TOOL ─► Inventory API (size → colour → SKU available)
   ├──► CART TOOL ─► ShopSphere Cart API (ADD_ITEM → cart as server reports it)
   └──► CHECKOUT TOOL ─► ShopSphere Checkout API
                          └─► lines + address + delivery + tax + saved payment (masked) + total
   │
   ▼
REVIEW YOUR ORDER (in chat) ──► CUSTOMER CONSENT: [ GO AHEAD ]
   │
   ▼  ─────────────── no AI from here: deterministic code only ───────────────
PAYMENT SERVICE 🔒 (consent → GreenLight token → PayIt 12 checks) ─► PAYMENT PROCESSOR ─► AUTHORIZED
   │
   ▼
ORDER SERVICE (create · reduce stock · save amount/payment/address/date · SS-#####)
   │
   ▼
TALKSHOP: ORDER CONFIRMED ─► CUSTOMER  (+ "View in My Orders" on ShopSphere)
```

**External catalogs off (D2):** product search reads **only** the ShopSphere catalog. While planning we found that the DummyJSON connection is currently **broken without anyone noticing**: every item fails validation because of its `source="dummyjson"` label and is dropped. Shopify and Best Buy return nothing without API keys. Demo 1 disables all three behind a setting rather than deleting them.

### 9.2 Who is responsible for what (spec rule)

| Talkshop (AI / LLM / orchestrator) | ShopSphere backend (deterministic code) |
|---|---|
| Understand natural-language requests | Catalog: the single source for product facts |
| Extract structured intent | Inventory validation |
| Choose which ShopSphere tool to call | Changing the cart; owning the cart |
| Rank and present products the service returned | Final prices and tax |
| Ask product-specific follow-up questions | Checkout calculation |
| Explain checkout results | Payment authorization and execution |
| Show the consent screen | Creating and saving orders |
| Explain the final order result | Refunds, recovery, reconciliation (out of scope) |

**Data Talkshop never sees:** full card numbers or CVVs. It only sees masked payment (*Visa •••• 4821*) and the authorization result.

### 9.3 Talkshop tools (called by the backend orchestrator, never by the browser)

| Tool | Calls | Input | Returns |
|---|---|---|---|
| `search_products` | Catalog/Search API | intent (department, category, gender, budget, keywords, purpose) | ranked products |
| `get_product_options` | Product API | product_id | sizes, colours (with photos), price |
| `check_variant` | Inventory API | product_id, size?, colour? | available yes/no, SKU, alternatives |
| `add_to_cart` | Cart API | SKU, qty | the cart as the server reports it |
| `get_cart` | Cart API | — | the cart |
| `create_checkout` | Checkout API | cart line IDs (this conversation's) | checkout record + `checkout_id` |
| `update_checkout` | Checkout API | checkout_id + qty / delivery / address / card | updated record |
| `confirm_and_pay` | Payment → Order service | checkout_id + **consent event** | order details or decline reason |

`confirm_and_pay` **can't be triggered by the LLM.** Only the customer's **GO AHEAD** click calls it, and the server rejects it unless consent is recorded for that exact `checkout_id`.

### 9.4 Messages from Talkshop to the panel

The panel draws cards from **structured events**, never by parsing the LLM's text. These are added to `/api/chat/stream`, which already sends `step_start`, `step_done`, `recommendation`, `blocked`, `error` and `done`:

| Event | Draws in Talkshop | Also updates the website |
|---|---|---|
| `recommendations` | Top 3 cards + reason | "Talkshop picks for you" row |
| `product_selected` | Selected-product header | Highlights / links the product |
| `ask_option` | Size or colour question + chips | — |
| `variant_confirmed` | "✓ in stock" line + colour photo | — |
| `cart_updated` | Added-to-cart card | Header badge bump, cart page |
| `offer_checkout` | [Yes, checkout] [Keep shopping] | — |
| `checkout_ready` / `checkout_updated` | REVIEW YOUR ORDER card | — |
| `payment_status` | Processing → Authorizing → Authorized / Declined | — |
| `order_confirmed` | ORDER CONFIRMED card | My Orders list refresh |
| `stage` | Journey stepper position | — |

---

## 10. Data design

### 10.1 ShopSphere catalog (about 60 products, D3–D6)

| Department | Approx. products | Example types | Options |
|---|---|---|---|
| Shoes | ~16 | running, sneakers, boots, sandals, formal | sizes US 5–12, 2–4 colours |
| Clothing | ~18 | tees, shirts, jeans, jackets, dresses, activewear | XS–XXL, 2–4 colours |
| Accessories | ~12 | bags, watches, sunglasses, belts, caps | mostly one size, 2–3 colours |
| Electronics | ~14 | headphones, earbuds, phones, laptops, smartwatches, speakers | colour + storage/model (A7) |

- **Each product has:** ID, name, brand, department, category, **gender (women/men/unisex)**, description, price, rating, review count, delivery days, **"new arrival"** flag and tags (e.g. *everyday running*, *waterproof*).
- **Each variant (SKU) has:** product ID, size/option, colour, **stock**, **photo for that colour**.
- **Built-in stock gaps** so the demo can show "out of stock" (e.g. Runner Pro X size 11).
- **Products named in the spec are included:** *Runner Pro X ($129, ★4.7)*, *FlexRun 5 ($139, ★4.6)*, *Daily Runner ($119, ★4.5)*, so the demo script matches the document.
- **As built (Phase 1):** the catalog is generated by `scripts/build_shopsphere_catalog.py` into `data/shopsphere_catalog.json`. 14 planned products were renamed or replaced where no usable photo existed (e.g. Nike Air Force 1 → *Sphere Canvas Low*, Bose → *Pulse Studio Wireless Headphones*, Garmin → *Pulse Smartwatch S2*, leggings/track pants/beanie/cap → *Ribbed Turtleneck Top*, *Knit Fringe Poncho*, *Evening Clutch Bag*, *Marisol Cat-Eye Sunglasses*).

### 10.2 Product images (D5)

- **One photo per colour** (about 150–200 photos), from **free-licence stock sites** (Pexels / Unsplash), chosen to match each product and colour.
- **Format and location:** **800×800 WebP** in studio style (D23), saved at `frontend/public/catalog/<product-slug>/<colour>.webp` (about 3 MB in total), so the demo works fully offline. Made by `scripts/fetch_catalog_photos.py`, which must run in its own virtual environment (see its header).
- **Source record:** `data/catalog_images.json` lists each photo's Pixabay ID, page URL, photographer and licence.

### 10.3 Customer, checkout and order data

| Data | Contents |
|---|---|
| **Demo customer** (A9) | Kaajal · `kaajal@shopsphere.demo` / `demo1234` |
| **Addresses** (D14) | 2 per demo customer (Home default, Work), each with name, line1, city, state, zip |
| **Saved cards** (D14, D18) | **Visa •••• 4821** (default, authorizes) · **Mastercard •••• 0019** (always declines). Masked details + token reference only |
| **Checkout record** | ID, customer, lines (SKU, qty, unit price), address, delivery choice and date, tax, shipping, total, card reference, hash, status (open / consented / paid / cancelled) |
| **Order** | `SS-#####`, customer, lines (SKU, product, size, colour, qty, price), totals, address snapshot, delivery method and date, masked card, payment status, order status, tracking number |
| **Cart** | Existing cart, switched to **SKU-based** lines |

---

## 11. Phases: steps and how each one works

Each phase ends with a **checkpoint** and a **commit on the Demo 1 branch**. Phases build on each other: data → services → Talkshop brain → website → Talkshop panel → integration → polish.

### Phase 0: Groundwork
**Goal:** get the branch ready so later phases don't fight existing behaviour.

| Step | Work | Files |
|---|---|---|
| 0.1 | Add a `CATALOG_SOURCES` setting. Demo 1 = `shopsphere` only (D2). DummyJSON, Shopify and Best Buy are skipped, not deleted | `backend/mcp/server.py`, `.env.example` |
| 0.2 | Record the DummyJSON validation bug as a known issue (not fixed in Demo 1) | this doc, `status.md` |
| 0.3 | Remove guest login from the UI (D17). Backend endpoint kept but unused | `frontend/src/pages/Login.tsx` |
| 0.4 | Add a **demo reset command** (reseed catalog, customer, carts, orders) | new `backend/db/reset_demo.py` |

✅ **Checkpoint:** the app still runs. Search returns ShopSphere catalog results only. The reset command works.

---

### Phase 1: ShopSphere catalog and data foundation
**Goal:** the database describes products with variants, customer profiles, checkout records and complete orders, and has real photos.

| Step | Work | Files |
|---|---|---|
| 1.1 | Write the **catalog file**: about 60 products, variants, gender tags, new-arrival flags, stock gaps, the spec's three running shoes | new `data/shopsphere_catalog.json` |
| 1.2 | **Source, resize and save colour photos** + licence record | `frontend/public/catalog/…`, `data/catalog_images.json` |
| 1.3 | Schema: `products` (gender, description, new_arrival, tags) and new **`product_variants`** (SKU, size, colour, stock, image) | `backend/db/schema.py` |
| 1.4 | Schema: **`addresses`**, **`payment_methods`** (masked + token reference + `behaviour` = approve/decline for demo), **`checkouts`** | `schema.py` |
| 1.5 | Schema: extend **`orders`** + new **`order_lines`**. Switch `cart_items` to SKU-based | `schema.py`, `init_db.py` migration |
| 1.6 | Seed: ShopSphere as the single merchant, the catalog, Kaajal with 2 addresses and 2 cards | `backend/db/init_db.py` |
| 1.7 | Tests: seed counts, every variant has a photo file, stock gaps exist | new `tests/test_demo1_catalog.py` |

✅ **Checkpoint:** a fresh reset gives the ShopSphere catalog with variants and photos. Kaajal has 2 addresses and 2 cards.

---

### Phase 2: ShopSphere merchant services (deterministic APIs, no AI)
**Goal:** every transactional step is a plain, testable backend service used by **both** the website and Talkshop.

| Step | Service | Endpoints | Works like this |
|---|---|---|---|
| 2.1 | **Catalog / search** | `GET /api/products?department&category&gender&q&max_price&new` · `GET /api/products/{id}` | Hard filters (department, gender, budget, in stock), then relevance ranking (keywords/tags, rating). Returns products with colours and size ranges |
| 2.2 | **Inventory** | `GET /api/products/{id}/availability?size&color` | Available sizes for a colour, colours for a size, exact SKU stock, alternatives |
| 2.3 | **Cart** | `GET/POST/PATCH/DELETE /api/cart…` | SKU-based lines. Every change returns the full cart with subtotal |
| 2.4 | **Customer profile** | `GET/POST /api/me/addresses` · `GET/POST /api/me/payment-methods` | List and add. Card numbers are masked and tokenised on save, never stored in full |
| 2.5 | **Checkout** | `POST /api/checkouts` (cart line IDs) · `GET/PATCH /api/checkouts/{id}` | Builds the **complete checkout record**: lines, address, delivery options + dates, tax 8.25% (A1), shipping, total, card, hash. Changes (qty, delivery, address, card) recalculate it on the server |
| 2.6 | **Payment (consent-gated)** | `POST /api/checkouts/{id}/confirm` | Requires consent → **re-checks stock** (A5) → GreenLight token → PayIt 12 checks → mock processor (approve/decline by card) → on success calls the order service. **The client sends only `checkout_id` + consent; amounts come from the server's saved record** |
| 2.7 | **Order** | `GET /api/orders` · `GET /api/orders/{id}` | Creates `SS-#####`, reduces stock, saves lines, totals, address, delivery date and payment status, and generates a tracking number |
| 2.8 | Tests | — | Full API happy path + out-of-stock, decline card, cancel, missing consent, tampered checkout, sold out before pay |

**Reuses:** GreenLight/PayIt and the 12-check engine (`backend/payment/*`), audit trail, tracing. **Reworks:** `routers/products.py`, `routers/cart.py`, `routers/authorizations.py`, `routers/payments.py`, `agents/cartup.py`, `agents/trackit.py`.

✅ **Checkpoint:** search → variant → cart → checkout → confirm → order passes as **API tests with no LLM**, including every case in §7.

**As built (Phase 2):** services live in `backend/shop/` (`catalog`, `cart`, `profile`, `checkout`, `payment`, `orders`) behind `backend/routers/products.py` and `backend/routers/shop.py`:
- **Cart:** the SKU-based cart is at **`/api/cart/lines`**. The older product-level `/api/cart` and `/api/cart/items` stay for the current chat UI until Phase 5.
- **Checkouts:** `POST /api/checkouts` · `GET/PATCH /api/checkouts/{id}` · `POST /api/checkouts/{id}/cancel` · `POST /api/checkouts/{id}/confirm {consent: true}`.
- **Saved details:** `GET/POST /api/me/addresses` and `GET/POST /api/me/payment-methods`. Card numbers are validated (Luhn) and then discarded.
- **Confirm:** calls the existing GreenLight approve and PayIt execute (12 checks) with amounts from the server-held checkout only. Each attempt gets its own payment reference, so a declined card can be swapped and retried. Declined or blocked attempts leave no order.
- **Policy:** tax is now **8.25%** and the single-purchase limit is **$2,500** (above that, step-up). The processor charges the chosen saved card (`behaviour=decline` → CARD_DECLINED).
- **Fix found on the way:** `GET /api/orders/{id}` had no login check. It now requires login and returns only the caller's own orders (also accepts `SS-#####`).

---

### Phase 3: Talkshop orchestrator (the AI layer)
**Goal:** Talkshop runs the stages in §6.2, **calls ShopSphere tools from the backend**, and sends structured events. It follows the spec's steps 2–11.

| Step | Work | How it works | Files |
|---|---|---|---|
| 3.1 | **Stage tracker** | Saves each conversation's stage, selected product and variant, cart line IDs and checkout ID. Only allowed transitions are possible | new `backend/talkshop/state.py` (from `graph/session_state.py`) |
| 3.2 | **Intent extraction** | Reuses VibeCheck. **Removes the questions asked before searching** (T4). Adds department, gender and purpose | `backend/agents/vibecheck.py` |
| 3.3 | **Tool layer** | The tools in §9.3, calling the Phase 2 services. The LLM picks the tool and the code runs it | new `backend/talkshop/tools.py` (replaces the old `mcp/server.py` tool set) |
| 3.4 | **Orchestrator loop** | Each message: check the stage → let the LLM decide (answer / call tool / ask option) within what the stage allows → run the tool → send events | new `backend/talkshop/orchestrator.py` |
| 3.5 | **Top 3 + reasons** | The service ranks and the orchestrator takes the top 3. The LLM writes one-line reasons from returned facts only | orchestrator |
| 3.6 | **Option questions** | Ask only for missing options with more than one value. Validate each with `check_variant`. Suggest alternatives | orchestrator |
| 3.7 | **Cart → checkout** | `add_to_cart` → offer checkout → `create_checkout` with **this conversation's lines only** (D13) | orchestrator |
| 3.8 | **Consent gate** | `confirm_and_pay` is reachable only from the **GO AHEAD** button event. LLM output can never call it | orchestrator + `/api/checkouts/{id}/confirm` |
| 3.9 | **Event stream** | Emit the §9.4 events. Keep step status for the "thinking" line and the presenter trace (D19) | `backend/routers/chat.py` |
| 3.10 | **Page context + "Ask about this"** | Message carries the page. A product-page start goes straight to PRODUCT_SELECTED | `chat.py`, orchestrator |
| 3.11 | **Retire browser-run actions** | Remove today's browser-executed add_to_cart / checkout / remove_from_cart path | `routers/chat.py`, `pages/Chat.tsx` |
| 3.12 | Tests | Scripted conversations: happy path, out-of-stock size, decline, cancel, mid-flow question, **typing "go ahead" never pays** | new `tests/test_talkshop_orchestrator.py` |

✅ **Checkpoint:** the §14 demo script runs through the stream (with no UI) and emits the right events at each step. Payment is impossible without the GO AHEAD event.

**As built (Phase 3):** `backend/talkshop/` holds `state.py` (stages + allowed actions), `parse.py` (exact reading of predictable replies and clear product requests), `tools.py` (ShopSphere services as tools; `confirm_and_pay` is not an LLM tool), `brain.py` (LLM decide + recommendation copy, with timeouts and fallbacks) and `orchestrator.py`. Endpoint: **`POST /api/talkshop/turn`** `{session_id, text | action, page}` → event stream. Plus `GET/DELETE /api/talkshop/sessions/{id}` to rebuild or reset the panel. It is a new endpoint rather than a rewrite of `/api/chat/stream`, so the current chat keeps working until Phase 5.
- **Speed:** the first live run took up to **203 s** per turn, because the Gemini client silently retried with growing waits when rate-limited. Fixed: Talkshop's LLM calls have a 10 s timeout and at most 1 retry, falling back to deterministic behaviour, and clear product requests skip the LLM entirely. Live turns are now **0.1–5.5 s**.
- **Search quality:** when a request matches some products, search no longer pads the top 3 with unrelated ones. Relationship words (sister, dad…) set women/men.

---

### Phase 4: ShopSphere storefront (the merchant website)
**Goal:** a clean, premium store that customers land on after login, which works fully on its own (path §8).

| Step | Work | Files |
|---|---|---|
| 4.1 | **Design system**: colour tokens (light + dark), typography, spacing, buttons, chips, cards, badges | new `frontend/src/styles/tokens.css`, `components/ui/*` |
| 4.2 | **App layout**: ShopSphere header (logo, nav, search, cart badge, account menu, theme toggle) + main area + Talkshop slot | new `components/shopsphere/StoreHeader.tsx`, `layouts/StoreLayout.tsx` |
| 4.3 | **Home**: hero "Shop New Arrivals", Talkshop-picks row slot, new arrivals grid, department tiles | new `pages/store/Home.tsx` |
| 4.4 | **Category pages**: Women / Men / Shoes / Accessories / Electronics, with filters (price, colour, size) | new `pages/store/Category.tsx` |
| 4.5 | **Product page**: gallery (switches per colour), size and colour pickers with live stock, Add to cart, **✦ Ask Talkshop about this** | new `pages/store/Product.tsx` |
| 4.6 | **Cart page**: **Select checkboxes** (D12), qty, remove, selected subtotal, **Checkout selected** | rework `pages/Cart.tsx` |
| 4.7 | **Checkout page**: complete checkout record, Change address/card, Standard/Express, inline add forms, **Place order** | rework `pages/Checkout.tsx` |
| 4.8 | **Order confirmation + My Orders** (list + detail with `SS-#####`, lines, delivery, payment) | rework `pages/PaymentResult.tsx`, `pages/Dashboard.tsx` |
| 4.9 | **Login / Sign up**: ShopSphere-branded with a Talkshop mention. No guest (D17). Lands on Home | rework `pages/Login.tsx` |
| 4.10 | **Routing**: `/` home · `/c/:dept` · `/p/:id` · `/cart` · `/checkout` · `/orders` · `/orders/:id` | `App.tsx` |

✅ **Checkpoint:** Kaajal can browse, open a product, pick a variant, add to cart, select items, check out and see the order in My Orders, **without using Talkshop**, in light and dark.

---

### Phase 5: Talkshop panel (inside ShopSphere)
**Goal:** the assistant docked on every page, drawing each step of §6 as polished cards.

| Step | Work | Files |
|---|---|---|
| 5.1 | **Panel shell**: docked right, open by default, minimise to the "✦ Ask Talkshop" button, bottom sheet on phones, conversation kept across pages | new `components/talkshop/TalkshopPanel.tsx` (mounted in `StoreLayout`) |
| 5.2 | **Header + journey stepper** + ⓘ presenter toggle | `talkshop/PanelHeader.tsx`, `talkshop/JourneyStepper.tsx` |
| 5.3 | **Message list + input**, moved from today's Chat page: voice, image paste, autocorrect (D20) | `talkshop/Composer.tsx` (from `pages/Chat.tsx`, `utils/autocorrect.ts`) |
| 5.4 | **Top 3 cards** with Select + "View on ShopSphere" | `talkshop/RecommendationCards.tsx` |
| 5.5 | **Option chips** (size and colour swatches, unavailable greyed out with reason) | `talkshop/OptionChips.tsx` |
| 5.6 | **Cart-updated card** + **checkout offer** quick replies | `talkshop/CartUpdatedCard.tsx`, `talkshop/QuickReplies.tsx` |
| 5.7 | **Review Your Order card**: qty −/+, Standard/Express, Change address/card, inline add forms, **GO AHEAD**, Cancel | `talkshop/ReviewOrderCard.tsx` (replaces `InlineCheckout.tsx`) |
| 5.8 | **Payment status card**: Processing → Authorizing → Authorized / Declined | `talkshop/PaymentStatusCard.tsx` |
| 5.9 | **Order confirmed card** + View in My Orders | `talkshop/OrderConfirmedCard.tsx` (replaces `InlineOrderTracker.tsx`) |
| 5.10 | **Presenter overlay**: agent trace (VibeCheck → … → TrackIt) behind ⓘ (D19) | reuse `components/AgentTrailPanel.tsx` |
| 5.11 | Retire the old full-screen chat page from navigation | `pages/Chat.tsx`, `App.tsx` |

✅ **Checkpoint:** the whole §6 flow completes in the panel, with every card drawn from server events, in light and dark.

**As built (Phase 5):** `components/talkshop/` holds `TalkshopPanel.tsx` (shell, header, stepper, conversation, presenter view), `cards.tsx` (all chat cards in one file) and `Composer.tsx`. `talkshop/useTalkshop.ts` holds the stream and session state, and `api/talkshop.ts` the client. The store is now a **layout route**, so the panel stays mounted across pages.
- **Backend additions:** photo search (`image_base64` on a turn → LLM describes it → normal search), and tapped buttons recorded as the shopper's reply.
- **Bugs found while testing and fixed:**
  - **Duplicate purchase:** an item already in the cart made the chat buy 2. The chat now buys only what it added, and a purchase now *reduces* the cart line instead of deleting it.
  - **Dead end:** when the cart already held all the stock, every chip was disabled. Talkshop now explains and asks for another colour.
  - **Squashed cards:** cards shrank as the chat grew, hiding GO AHEAD.
  - **Page scrolling:** auto-scroll moved the whole store page. It now scrolls only the chat.
  - **Duplicate review card:** typing "go ahead" stacked a second review card. The card now moves down instead.

---

### Phase 6: Connecting ShopSphere and Talkshop
**Goal:** every connection in §5 (I1–I9) works, so the website and the assistant feel like **one product**.

| Step | Work | Files |
|---|---|---|
| 6.1 | **Shared cart store**: website Add to cart and Talkshop `cart_updated` both update it. The header badge bumps | new `frontend/src/store/cart.ts`, `StoreHeader.tsx`, `TalkshopPanel.tsx` |
| 6.2 | **Page context** sent with every Talkshop message, plus page-aware greetings and chips | `TalkshopPanel.tsx`, `api/chat.ts` |
| 6.3 | **"Ask Talkshop about this"** → panel opens with the product selected → size question | `pages/store/Product.tsx`, orchestrator |
| 6.4 | **Talkshop picks row** on the storefront from the `recommendations` event | `pages/store/Home.tsx`, `Category.tsx` |
| 6.5 | **Selection sync**: `product_selected` highlights the product. "View on ShopSphere" opens its page with the chat still open | `TalkshopPanel.tsx`, router |
| 6.6 | **Orders link**: confirmed card → `/orders/:id`. The My Orders list refreshes | `OrderConfirmedCard.tsx`, `Dashboard.tsx` |

✅ **Checkpoint:** every row I1–I9 checked in the browser.

**As built (Phase 6):** `talkshop/TalkshopContext.tsx` is shared by the panel and every store page. It sends the current page with each turn, applies Talkshop's cart changes to the header badge, exposes picks and the selected product, opens the panel for "Ask Talkshop about this", refreshes My Orders after a chat order, and re-greets for the new page until the shopper has said something. `components/talkshop/TalkshopPicks.tsx` is on Home and category/search pages.
- **Backend:** page-aware greetings (Women, Men, categories, product, cart, orders, search). Product-page chips can trigger actions ("Help me choose a size & colour" → straight to the size question). The LLM sees the product page you're on, so "I'll take this one" selects it.

---

### Phase 7: Polish, quality and demo readiness
**Goal:** a beautiful, reliable, repeatable Demo 1.

| Step | Work |
|---|---|
| 7.1 | **Visual pass** on every page and card, light and dark: spacing, alignment, image crops, empty and loading states, motion |
| 7.2 | **Ease-of-use pass** against the §4.3 rules (chips everywhere, one primary action, no dead ends) |
| 7.3 | **Responsive pass**: desktop, laptop, tablet, phone (bottom-sheet Talkshop) |
| 7.4 | **Run all demo scripts** (§14) several times, from a reset each time |
| 7.5 | **All tests green**: catalog, services, orchestrator, consent gate, existing suite |
| 7.6 | **README**: a "Demo 1" section on how to run, reset and present it (including the presenter toggle) |

✅ **Checkpoint:** all three demo scripts run start to finish with no manual fixes.

---

### Phase 8: Shop without logging in (login only at checkout)
**Goal:** like a real store, ShopSphere and Talkshop work for anyone; an account is needed only to check out (D25–D29).

| Step | Work | How it works |
|---|---|---|
| 8.1 | **Visitor identity** | `POST /api/auth/visitor` creates an anonymous visitor (no name or email stored) and returns a token. The browser gets one automatically when it has no login, so the cart and Talkshop work exactly as for customers |
| 8.2 | **Login gates (server)** | Checkout, confirm/payment, saved addresses/cards and orders answer visitors with **403 `LOGIN_REQUIRED`**. Browsing, cart and Talkshop stay open |
| 8.3 | **Merge on login/sign-up** | Login and register accept the visitor's token: its cart lines move to the account (same SKU → quantities added, capped by stock), Talkshop conversations are carried over, and the visitor record is removed. The response maps old → new cart line ids |
| 8.4 | **Talkshop sign-in card** | A visitor's checkout emits `login_required`. The panel shows a Log in / Sign up card (with the demo account shortcut). After signing in, Talkshop continues to the Review card automatically |
| 8.5 | **Frontend auth** | The store opens on Home (no login wall). The header shows **Log in** for visitors and the name + menu for customers. Logout → a new visitor (empty cart, fresh chat) |
| 8.6 | **Website checkout** | A visitor's **Checkout selected** → login page ("Log in to check out — your cart is saved") → straight to checkout with the selected items |
| 8.7 | **Customer-only pages** | `/orders`, `/orders/:id` and `/checkout/:id` send visitors to log in and then back |
| 8.8 | **Tests** | Visitor creation, every gate, cart merge (incl. same-SKU), Talkshop visitor checkout → sign-in → review |
| 8.9 | **Browser check** | New visitor script D (browse → chat → cart → sign in at checkout → order), plus scripts A–C again |

✅ **Checkpoint:** a visitor can browse, chat and fill a cart, and is asked to log in only to check out, on the website and in Talkshop.

**As built (Phase 8):**
- **Backend:** `POST /api/auth/visitor`, a `require_customer` guard (403 `LOGIN_REQUIRED`) on checkouts, confirm, addresses, cards, orders, wallet and loyalty, and `merge_carts` plus Talkshop `rekey` when a visitor logs in or signs up.
- **Frontend:** `AuthContext` starts a visitor automatically. `auth/afterSignIn.ts` finishes a website checkout after login. Talkshop has a `SignInCard`, and the panel remounts per identity and resumes checkout.
- **Bugs found while testing and fixed:**
  - **Account menu behind the panel:** it dropped down behind the Talkshop panel and couldn't be clicked.
  - **Login race:** a late visitor-session response could undo a fresh login on a cold start.
  - **Size and colour asked twice:** "wait, I need teal Nike shoes of size 10", typed while answering a size question, was taken as size 10 for the current shoe. A clear new request now always starts a search. Talkshop also remembers the size and colour named in a request, fills them in when the shopper picks a product (if they're in stock), and shows the cards in that colour.
  - **Typos and loose wording ("nike tale colour size 10"):** keyword matching dropped what it couldn't read. Now:
    - The LLM reads every search request for size and colour (typos, shades like "sea green"), in the recommendation call it already makes, so there's no extra wait. Code accepts only colours the products really come in.
    - A message that names a product is never taken as a quick answer to the question on screen. Unclear ones go to the LLM.
    - A small typo matcher covers a model outage.
  - **Logged in, yet checkout said "Not authenticated":** all tabs share one saved login, so a tab could show a stale name after another tab (or a backend restart) changed or cleared it. Now:
    - Tabs follow each other's login and logout.
    - A request with no token reloads the page to restore the identity.
    - Starting a visitor session retries while the backend restarts.

---

### Phase 9: Secure checkout details in Talkshop
**Goal:** when a logged-in customer has no saved address or card, collect them inside the Talkshop panel through ShopSphere-owned secure components. These are clearly separate from the AI conversation, and the AI never sees the details.

**Who owns what:**
- **Talkshop (LLM):** intent, conversation, which merchant step comes next, and presenting results.
- **ShopSphere:** profile, addresses, cart, prices, tax, inventory, checkout and orders.
- **Payment partner** (the card form + tokenization): raw card data in, a token reference out.

| Step | Work | How it works |
|---|---|---|
| 9.1 | **Completeness check** | `_checkout` creates the checkout, then checks its address and payment method. Both present → Review as before |
| 9.2 | **Secure ShopSphere Checkout** | Event `checkout_details_needed {needs}` → the panel renders the address form (Full name, Address, Apt optional, City, State, ZIP). It posts to `POST /api/me/addresses`. Note: "This information is sent directly to ShopSphere checkout and is not processed as chat content." |
| 9.3 | **Secure Payment** | Card form → `POST /api/me/payment-methods`. ShopSphere tokenizes (stores a `tok_…` vault reference, brand, last 4, expiry), and the response is masked only. The form wipes its fields after saving |
| 9.4 | **Resume** | The form sends action `details_added {address_id | payment_method_id}`, ids only. Talkshop attaches it (ShopSphere checks the id belongs to the customer), re-reads the checkout, and either asks for the next detail or shows Review with one GO AHEAD. If the total changed, it says so |
| 9.5 | **Nothing sensitive in the chat** | Browser (`talkshop/redact.ts`) and server (`parse.redact_payment_data`) mask Luhn-valid card numbers, CVCs and expiry dates before the message is shown, stored, guard-railed or read by the LLM. Talkshop answers without the LLM and points back to the secure form. Addresses typed during checkout are withheld |
| 9.6 | **Edge cases** | Address/card validation errors stay in the form (server-side: required fields, 2-letter state, ZIP, Luhn, expiry, CVC). Someone else's id → refused, form shown again. Order creation failing after authorization → the authorization is voided, the shopper is told they weren't charged, and they can retry. Declined card → as before |
| 9.7 | **Tests** | `tests/test_demo1_secure_checkout.py`: both/one missing, resume, ownership, typed card/address, validation, the void path |
| 9.8 | **Browser check** | New customer, light/dark/phone: address → payment → review → GO AHEAD → confirmed. The raw card number is sent only to the card endpoint |

✅ **Checkpoint:** a new customer completes checkout inside Talkshop; address and card go only to ShopSphere; the AI never sees them.

**As built (Phase 9):**
- **Stage:** new `CHECKOUT_DETAILS` stage (stepper shows "Review"). GO AHEAD only works from `AWAITING_CONSENT`.
- **Panel:** new `SecureDetailsCard`.
- **Payment:** `mock_processor.void_authorization`. `payment.confirm` returns `order_failed` when the order can't be created.
- **Address validation:** `profile.add_address` now also checks the state code and field lengths.
- **Not changed:** the website's own checkout page keeps its forms; it also handles `order_failed`. Tax is a flat rate today, so adding an address doesn't change the total. The "total recalculated" message is there for when it does.
- **Follow-up: deleting saved details.** The checkout page's Change lists now have a delete button (with a Delete/Keep confirmation) for each saved address and card.
  - The server endpoints are `DELETE /api/me/addresses/{id}` and `DELETE /api/me/payment-methods/{id}`. They only delete the customer's own items; visitors get 403.
  - The next saved item becomes the default, and open checkouts switch to it, or ask again when none are left.
  - Past orders keep their own copy of the address and card.
- **Follow-up: auto-checkout countdown.** After Talkshop adds an item, a card counts down 10 seconds ("Moving to checkout in 10s"), then opens Review on its own.
  - **Buttons:** Checkout now / Keep shopping.
  - **Pauses** when the shopper clicks into the chat box. **Doesn't run** while the panel is minimised, or for a conversation restored after a reload.
  - **Payment is unchanged:** moving to checkout never pays; GO AHEAD is still the only consent. A visitor's countdown ends at the sign-in card.
- **Follow-up: "we don't sell that" blocker.** Asking for something outside ShopSphere's range (e.g. "no laptop tomatoes grocery") used to show unrelated top-rated products. Now:
  1. A list of product types ShopSphere doesn't sell (groceries, furniture, pet supplies, books, toys, beauty, appliances, medicine, vehicles) gets a plain "ShopSphere doesn't sell…" reply with no cards.
  2. "no"/"not"/"don't want" rules out the next item ("not a laptop, show me headphones" shows headphones).
  3. For anything not on the list, the LLM checks in the recommendation call whether the results are the kind of thing asked for, so there's no extra wait. Only an explicit "doesn't fit" hides them, and it caught "garden hose", "yoga mat" and "cookware" in testing.
  4. A mixed request ("a laptop and some tomatoes") shows the laptops with a note.
- **For a production build:** the card fields would sit in a payment provider's hosted iframe (e.g. Stripe Elements), so the store's own page couldn't read them. Here they are a local, ShopSphere-only React component that posts straight to the tokenization endpoint.

---

## 12. Traceability: spec happy path → this plan

| Spec step (Demo 1 happy path) | Plan steps | Phase(s) |
|---|---|---|
| 1. Customer is logged into ShopSphere | T1, 4.9 | 4 |
| 2. Customer sends a natural-language request | T2 | 5 |
| 3. Orchestrator extracts structured intent | T3–T4, 3.2 | 3 |
| 4. Product Search Tool calls ShopSphere catalog/search | T5, 2.1, 3.3 | 2, 3 |
| 5. Filter/rank and show top 3 | T6, 3.5, 5.4, 6.4 | 3, 5, 6 |
| 6. Customer selects a product | T7, 5.4, 6.5 | 5, 6 |
| 7. Chatbot asks size/colour/qty questions | T8–T10, 3.6, 5.5 (qty default 1, D11) | 3, 5 |
| 8. Inventory validates the selected variant | T9, T11, 2.2 | 2, 3 |
| 9. Cart Tool writes the SKU to the ShopSphere cart | T12, 2.3, 3.7, 6.1 | 2, 3, 6 |
| 10. Chatbot asks whether to proceed to checkout | T13, 5.6 | 3, 5 |
| 11. Checkout Tool prepares the checkout record | T14, 2.5, 3.7 | 2, 3 |
| 12. Chatbot shows product + total + delivery + masked payment | T15, 5.7 | 5 |
| 13. Customer selects GO AHEAD | T16, 3.8, 5.7 | 3, 5 |
| 14. Merchant payment service authorizes payment | T16, 2.6 | 2 |
| 15. Order Service creates/finalizes the order | T17, 2.7 | 2 |
| 16. Chatbot shows the order confirmation | T18, 5.9 | 5 |

---

## 13. Existing Talkshop pieces: what happens to each

| Existing piece | Demo 1 plan |
|---|---|
| GreenLight token + PayIt 12-check engine, audit trail, tracing | ✅ **Kept.** This is ShopSphere's payment service |
| VibeCheck (intent) | ♻️ Reused. The questions asked before searching are removed |
| SneakPeek (search/rank), CartUp (checkout), TrackIt (orders) | ♻️ Logic moves into the Phase 2 services |
| Cart API | ♻️ Reused, switched to SKU-based lines |
| Autocorrect, voice, image paste | ♻️ Move into the Talkshop panel |
| Inline checkout / order tracker cards | ♻️ Reworked into the Review / Confirmed cards |
| Agent pipeline trace | ↪️ Presenter overlay only (D19) |
| Full-screen chat page | ↪️ Removed from navigation |
| Compare, loyalty points, wallet | ⏸️ Not in the Demo 1 flow (code left in place, hidden) |
| Guest login | ⏸️ Hidden (D17) |
| DummyJSON / Shopify / Best Buy adapters | ⏸️ Switched off (D2). DummyJSON bug recorded |
| Hardcoded `SAVED_CARDS` | ❌ Replaced by saved payment methods per customer |

## 14. Demo scripts

### Script A: happy path (the spec)

```
[ShopSphere home · logged in as Kaajal · Talkshop open on the right]

Kaajal:   I need running shoes under $150 for everyday running.
Talkshop: I found three options for you:                  ← page shows "✦ Talkshop picks for you"
          [Runner Pro X ★4.7 $129 Select] [FlexRun 5 ★4.6 $139 Select] [Daily Runner ★4.5 $119 Select]
Kaajal:   (Select → Runner Pro X)                          ← page highlights Runner Pro X
Talkshop: Great choice. What size would you like?   [7] [8] [9] [10] [11 · out of stock]
Kaajal:   Size 8.
Talkshop: Size 8 is available. Which colour would you prefer?   [● Black] [○ White]
Kaajal:   Black.
Talkshop: ✓ Runner Pro X · Size 8 · Black is in stock.
          Added to your ShopSphere cart ✓                  ← header cart badge bumps
          Would you like me to proceed with checkout?   [Yes, checkout] [Keep shopping]
Kaajal:   Yes.
Talkshop: REVIEW YOUR ORDER
          Runner Pro X · Size 8 · Black · Qty 1
          Product $129.00 · Tax $10.64 · Total $139.64
          Delivery: Standard · October 8   (Express +$9.99 available)
          Ship to: Kaajal, Home · Payment: Visa •••• 4821
          [ GO AHEAD ]  Cancel
Kaajal:   (GO AHEAD)
Talkshop: Processing your order… Payment: Visa •••• 4821 · Authorizing… PAYMENT AUTHORIZED
          ORDER CONFIRMED · Order SS-48291
          Runner Pro X · Size 8 – Black · Qty 1 · Total $139.64
          Paid with Visa •••• 4821 · Expected delivery: October 8
          [View in My Orders]
```

### Script B: declined payment (D18)
Same as A until the review card → **Change** payment → **Mastercard •••• 0019** → GO AHEAD → *"Payment wasn't authorized: card declined. No order was created."* → Change back to Visa → GO AHEAD → confirmed.

### Script C: website + Talkshop together
Browse **Shoes** → open **FlexRun 5** → **✦ Ask Talkshop about this** → Talkshop: *"What size would you like?"* → size and colour chosen in chat → added (badge bumps) → *Keep shopping* → on the website, add a cap → **Cart** → **Select** only the cap → **Checkout selected** → **Place order** → My Orders shows both flows' orders.

*Product names, prices and dates come from the ShopSphere catalog and services at demo time. The values above follow the spec's example.*

---

## 15. Risks and notes

| Risk | Mitigation |
|---|---|
| Finding colour-matched photos for about 60 products (about 150–200 photos) | Choose products that stock sites cover well. Accept close matches. Keep the licence record |
| LLM latency or occasional wrong tool choice | Stages limit what the LLM can do at each step. Option chips and buttons give a deterministic path. Every money step is code-only |
| Scope size (website + assistant + services) | Strict phase order with a checkpoint per phase. Website path works before the panel is built |
| Gemini model availability | Keep the provider swappable (existing `get_llm`) |

## 16. Known issues (found while building)

| Issue | Where | Status |
|---|---|---|
| **DummyJSON adapter drops every product.** Items are fetched but tagged `source="dummyjson"`, which the product model doesn't allow, so all fail validation and are silently skipped. DummyJSON has never added results to search | `backend/merchants/dummyjson.py`, `backend/models/product.py` | Not fixed in Demo 1. External catalogs are off (`CATALOG_SOURCES=shopsphere`). Logged in `status.md` |
| **"Forgot password" changes a password with only an email** (account-takeover risk) | `POST /api/auth/reset-password` | Out of Demo 1 scope. Needs an emailed reset link |
| ~~Payment policy capped purchases at $500~~ | `backend/payment/policy.py` | ✅ Resolved in Phase 2: limit $2,500 (step-up above) |
| ~~Tax was 8.2%~~ | `backend/payment/policy.py` | ✅ Resolved in Phase 2: 8.25% ($129 → $10.64) |
| ~~Streaky / ragged photos~~ | `frontend/public/catalog/` | ✅ Fixed in Phase 7 |
| The `rembg` photo tool needs numpy 2, which conflicts with the app's packages. It was removed from the global Python and must be run in `.venv-photos` | `scripts/fetch_catalog_photos.py` | Documented in the script header |
| The demo runs on its own `backend/db/demo1.db` (`COMMERCE_DB_PATH`), so the older `commerce.db` with pre-Demo-1 data is left untouched. Resetting `commerce.db` is optional | `backend/db/` | Your call. Not needed for the demo |
