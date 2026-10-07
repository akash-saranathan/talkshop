# Talkshop Live Trace — What Happens at Each Step

This guide walks through every card you see in the right-hand **Live Trace** panel while Talkshop runs, in the order they appear. Each card is one real event the server recorded at that moment. Nothing in the panel is scripted animation.

The examples come from a real run of: *"Find me Nike running shoes under $150, size 9"* → Nike Zoom Fly 6, size 9, Black → **$151.47** on Visa •••• 4242.

---

## How to read the panel

The panel has three views, chosen at the top right of **Agent Activity**:

| View | What it shows | Best for |
|---|---|---|
| **Story** (default) | One fixed row per business step: Input · Intent · Routing · A2A · Agent trust · UCP · Human · Checkout · AP2 · Human · ACP · Payment · Merchant · A2A | Presenting the flow to a client |
| **Flow** | A diagram of the stages lighting up as they complete | Showing the overall shape |
| **Live** | Every event as its own card, in real time | Explaining each step in detail |

**Anatomy of a Live card:**

- **Coloured badge** — the protocol or layer: `guardrails`, `internal`, `A2A`, `TRUST`, `UCP`, `HUMAN`, `AP2`, `ACP`, `PAYMENT`.
- **Headline** — what just happened, in plain words.
- **Description** — the one-line explanation.
- **Highlight chip** — the key value (a category, an amount, a token id).
- **Status icon** — ✓ green = passed, ⚠ amber = paused or warning, ✗ red = failed or blocked.

**Click any card** to open its details:

| Field | Meaning |
|---|---|
| Event | The event's internal name, e.g. `nemo_pass` |
| Sender → receiver | Who did it and to whom, e.g. `NeMo Guardrails → CustomerAgent` |
| Protocol | The layer it belongs to |
| Call | For A2A/UCP: "In-process call (not a network request)" — honest about how the POC runs |
| Timestamp | When it fired |
| JSON block | The exact data recorded at that moment |

**The actors you'll see:**

| Name in the trace | Who it is |
|---|---|
| User / Customer | You, typing or clicking |
| CustomerAgent | Your shopping assistant on the Talkshop side (MyChatGPT-style) |
| Input checks, NeMo Guardrails, Gemini | Safety and understanding layers on the Talkshop side |
| MerchantRegistry | The list of merchants the agent can route to |
| NikeAgent (or ZaraAgent, AdidasAgent…) | The merchant's own agent |
| UCPCatalog | The merchant's product catalog |
| AP2 evidence | The authorization records that prove what you approved |
| PaymentAuthorizationAdapter, PaymentService | The internal payment enforcement |
| MockPSP | The mock card processor |
| Nike Order Service | The merchant's order system |

---

## The journey at a glance

```
YOU TYPE A REQUEST
  1  Input checks ............ guardrails   is the message safe and well-formed?
  2  NeMo Guardrails ......... guardrails   is it a shopping request?
  3  Gemini intent ........... internal     what exactly do you want?
  4  Routing ................. internal     which merchant?
  5  A2A connect ............. A2A          your agent reaches the Nike agent
  6  Agent trust (5 cards) ... TRUST        Nike verifies your agent before anything else
  7  Catalog (5 cards) ....... A2A / UCP    Nike searches its own catalog
     → products and a recommendation appear in the chat

YOU SAY "YES" (pick a product)
  8  Checkout (4 cards) ...... TRUST / UCP / AP2 / HUMAN
     → the order proposal appears, with a GO AHEAD button and a 10-second countdown

YOU CLICK GO AHEAD (or let the countdown finish)
  9  Consent ................. HUMAN        your approval of this exact checkout
 10  Authorization ........... AP2 / ACP    evidence + a scoped single-use payment token
 11  Nike verifies (3 cards) . TRUST / ACP / AP2
 12  Payment (3 cards) ....... PAYMENT      internal DPAT, 12 checks, card processor
 13  Order (2 cards) ......... internal / A2A
     → "Order confirmed" appears in the chat
```

---

## Part 1 — You send a message

You type *"Find me Nike running shoes under $150, size 9"* and press send. The chat shows progress lines ("Let me figure out what you're looking for…") while these cards appear.

### 1. Input checks running
`input_check` · User → Input checks · **guardrails**

Talkshop's own checks start on your message before any AI sees it.
**Details:** the query text.

### 2. Custom input checks passed ✓
`input_validation_pass` · Input checks → CustomerAgent · **guardrails**

Five deterministic checks ran and passed:

| Check | Stops |
|---|---|
| `empty_input` | blank messages |
| `input_length` | messages that are too long |
| `harsh_language` | abusive language |
| `malformed_input` | garbage or injected markup |
| `pii_detection` | personal data such as a card number typed into the chat |

A sixth check, `credential_keyword`, looks for payment secrets like "CVV" or "password".
If any check fails you see **Blocked by custom input check** (red) instead, and nothing else runs.

### 3. NeMo Guardrails · Commerce Scope: PASS
`nemo_pass` · NeMo Guardrails → CustomerAgent · **guardrails**

NVIDIA's NeMo Guardrails library, using Gemini as its classifier, decides whether the message is in scope for a shopping assistant.
**Details:** `policy: Commerce Scope`, `engine: Gemini`, `category: commerce_allowed`.
Off-topic requests get **NeMo Guardrails · Commerce Scope: BLOCK** and stop here.

### 4. Gemini extracting intent
`intent_extraction` · CustomerAgent → Gemini · **guardrails**

Gemini turns your sentence into a structured shopping intent: brand = Nike, category = running shoes, size = 9, max price = $150.
**Important:** this is *what you want*, not permission to spend. Searching never authorizes payment.

> A further card, **Intent validated** (`schema_valid`, Guardrails AI), appears when the Guardrails AI library is installed. In the current environment it isn't, so the intent is checked by the built-in Pydantic model instead and this card doesn't show.

### 5. Routing to Nike
`merchant_routing` · CustomerAgent → MerchantRegistry · **internal**

You named a brand, so the agent goes straight to Nike. No other merchants are asked.
**Details:** `merchants: ["nike"]`, `reason: "brand named in request"`.
Without a brand (e.g. "summer dress"), it routes by category to every merchant that sells it, and the next steps repeat for each one.

### 6. Customer Agent → Nike Agent
`a2a_connect` · CustomerAgent → NikeAgent · **A2A**

Your agent connects to Nike's agent and reads its agent card: the agent's name and what it can do.
**Details:** `agent_card: "Nike Merchant Agent"`, `skills: ["product_search", "checkout"]`, `mode: "A2A-style, in-process"`.

### 7. Customer agent presents its credential
`agent_identity_received` · CustomerAgent → NikeAgent · **TRUST**

Your agent shows Nike a credential signed by Talkshop. It says who the agent is and what you allowed it to do.

| Field | Example | Meaning |
|---|---|---|
| `agent_id` | `talkshop.customer-agent` | which agent this is |
| `platform_id` | `talkshop.platform` | which platform vouches for it |
| `customer_ref` | `cust_325e2e426d3c` | a pseudonymous id; Nike never sees your Talkshop account |
| `talkshop_account` | `authenticated` | you are logged in to Talkshop |
| `scopes` | `catalog:read`, `checkout:create`, `payment:execute` | what the agent may do |
| `max_amount` | `500` | the most it may ever spend |

The signature itself is never shown.

### 8. ✓ Customer agent identity verified
`agent_identity_verified` · NikeAgent → CustomerAgent · **TRUST**

Nike checks, with plain code and no AI:
`agent_identity_registered` · `platform_expected` · `credential_signature_valid` · `credential_not_expired`.

### 9. ✓ Customer delegation verified
`delegation_verified` · NikeAgent → CustomerAgent · **TRUST**

The permissions were really granted to *this* agent (`delegation_bound_to_agent`).

### 10. ✓ Scope verified
`scope_verified` · NikeAgent → CustomerAgent · **TRUST**

The requested action (`catalog:read`) and the merchant (Nike) are inside what you allowed. `amount_within_scope` shows `n/a` here because searching has no amount.

### 11. Trusted session established
`trusted_agent_session_created` · NikeAgent → CustomerAgent · **TRUST**

Nike opens a trusted session for your agent. Checkout and payment will require it.
**Details:** `trusted_session_id: tas_…`, `merchant_relationship: merchant_guest` (you are known to Talkshop but a **guest to Nike**), `talkshop_account: authenticated`.
The chat shows: *"Nike verified your shopping agent — trusted session established (you're checking out as a guest with Nike)."*

### 12. A2A → Nike Agent
`message/send` · CustomerAgent → NikeAgent · **A2A**

Your agent sends Nike the search request, quoting the trusted session id.
**Details:** `method: message/send`, `skill: product_search`, `intent: {category, brand}`.

### 13. UCP Catalog — Nike searching
`catalog_search` · NikeAgent → UCPCatalog · **UCP**

Nike looks in its own catalog. The catalog is the source of truth for price, stock, colours, sizes and delivery; the AI never invents these.

### 14. UCP Catalog returned 8 products
`catalog_results` · UCPCatalog → NikeAgent · **UCP**

**Details:** `product_count` (matching size/colour variants) and `duration_ms`.

### 15. Boundary check
`boundary_check` · NikeAgent → CustomerAgent · **A2A**

Before results reach your agent, every product is checked: `merchant_identity` (it really is from Nike) and `price_positive`. Products that fail are dropped.

### 16. A2A ← Nike: 8 products
`task_result` · NikeAgent → CustomerAgent · **A2A**

Nike's answer arrives. Talkshop then filters by your size and budget, ranks the results and Gemini writes the recommendation.

**In the chat:** the top 5 product cards and *"…Want me to add the Nike Zoom Fly 6 to your cart?"*

---

## Part 2 — You say "yes"

Picking a product is **not** a payment approval. It only asks Nike for a checkout.

### 17. Trusted session re-checked for checkout:create
`trusted_session_verified` · NikeAgent → CustomerAgent · **TRUST**

Nike re-verifies your agent's credential for the new action, `checkout:create`, before building a checkout.

### 18. Checkout created · $151.47
`checkout_created` · CustomerAgent → NikeAgent · **UCP**

Nike builds the checkout from its own prices and stores it.

| Field | Example |
|---|---|
| `checkout_id` | `CHK_D3A8CF33` |
| `totals` | subtotal 139.99 · shipping 0.00 · tax 11.48 · **total 151.47 USD** |
| `delivery_date` | Saturday, October 10 |
| `checkout_hash` | a fingerprint of everything above; any change breaks it |

### 19. AP2 checkout bound
`ap2_checkout_bound` · CustomerAgent → AP2 evidence · **AP2**

A signed AP2-style cart record binds the product, quantity, merchant, total and delivery to the checkout hash. It is evidence of *what is being bought*, not permission to pay.

### 20. Order proposal shown
`order_proposal` · CustomerAgent → Customer · **HUMAN**

The proposal appears in the chat and the agent waits for you.
**Details:** total, delivery date, `payment_method: "Visa •••• 4242"`, `awaiting: "GO AHEAD"`.

**In the chat:** the **Order proposal from Nike** card with the product photo, *"Guest checkout with Nike · your Talkshop account stays private"*, the totals, delivery date, **Pay with Visa •••• 4242**, an **Auto GO AHEAD in 10s** countdown with **Pause**, the **GO AHEAD · $151.47** button and **Cancel**.

Opening **Change** or **Add a card** pauses the countdown. Choosing another card restarts it from 10.

---

## Part 3 — GO AHEAD

You click **GO AHEAD**, or the 10-second countdown finishes without you pausing or cancelling. Both run exactly the same steps; the trace records which one it was. While it runs, the chat shows a checklist:

1. Recording your GO AHEAD for this exact checkout
2. AP2 authorization evidence
3. ACP scoped payment token
4. Merchant verifies agent, token and evidence
5. Internal DPAT · 12 payment checks
6. Merchant creates your order

### 21. GO AHEAD received
`customer_consent_received` · Customer → CustomerAgent · **HUMAN**

Your approval is recorded and bound to this exact checkout: merchant, `checkout_id`, `checkout_hash`, total, currency and payment method.
**Details:** `consent_id`, `total: 151.47`, `payment_method: "Visa •••• 4242"`, and `consent_mode`:
- `click` — headline **GO AHEAD received**
- `auto_countdown` — headline **Auto GO AHEAD after the 10 s countdown**

If what was approved doesn't match Nike's stored checkout, you get **Approval did not match the checkout** instead and nothing is authorized.

### 22. AP2 authorization evidence created
`ap2_payment_authorization` · CustomerAgent → AP2 evidence · **AP2**

A signed AP2-style payment record, created only now, proves you approved this checkout and amount.
**Details:** `payment_mandate_id`, `cart_mandate_id`, `consent_id`, `payment_ref` (a payment-method reference like `pm_…`, never a card number).

### 23. Scoped payment credential issued
`acp_token_issued` · CustomerAgent → NikeAgent · **ACP**

An ACP-style payment token is created. It is the only payment credential that reaches Nike, and your agent never sees the card.

| Field | Example | Meaning |
|---|---|---|
| `token_id` | `spt_c0b226c0b00e` | the token |
| `merchant_id` | `nike` | usable only at Nike |
| `checkout_id` | `CHK_D3A8CF33` | only for this checkout |
| `max_amount_cents` | `15147` | at most $151.47 |
| `currency` | `USD` | only in dollars |
| `expires_at` | 15 minutes from now | short-lived |
| `single_use` | `true` | works once |
| `payment_method` | `Visa, 4242` | brand and last 4 only |

### 24. Trusted session re-checked for payment:execute
`trusted_session_verified` · NikeAgent → CustomerAgent · **TRUST**

Nike re-verifies your agent once more, now for `payment:execute` and the exact amount (151.47 is within the 500 limit you delegated).

### 25. ✓ Merchant + amount verified
`acp_token_verified` · NikeAgent → CustomerAgent · **ACP**

Nike checks the token against its own checkout:
`token_signature_valid` · `merchant_matches` · `checkout_bound` · `checkout_hash_bound` · `amount_within_token_scope` · `amount_matches_checkout` · `currency_matches` · `token_not_expired`.

### 26. AP2 evidence verified by the merchant
`ap2_evidence_verified` · NikeAgent → AP2 evidence · **AP2**

The cart record still matches the checkout (`cart_evidence_matches_checkout`), and the payment record matches this token and your consent (`payment_authorization_matches_token`).

> If the **Merchant changes delivery date** scenario is on, the flow pauses here. See Part 5.

### 27. Internal enforcement token (DPAT)
`internal_dpat_issued` · PaymentAuthorizationAdapter → PaymentService · **PAYMENT**

The verified authorization is mapped to Talkshop's internal single-use enforcement token, the DPAT. It is our own mechanism, not an industry protocol.
**Details:** `dpat_token_id: DPAT_…`, `from_delegated_token: spt_…`, `max_amount: 151.47`.

### 28. 12/12 deterministic payment checks
`payment_checks` · PaymentService → PaymentService · **PAYMENT**

The payment service runs its 12 checks before any money moves:

| # | Check | # | Check |
|---|---|---|---|
| 1 | token_exists | 7 | order_id_match |
| 2 | token_active | 8 | currency_match |
| 3 | token_not_expired | 9 | amount_within_limit |
| 4 | token_not_consumed | 10 | amount_matches_checkout |
| 5 | agent_id_match | 11 | checkout_hash_match |
| 6 | merchant_id_match | 12 | consent_exists |

### 29. Payment authorized
`psp_result` · PaymentService → MockPSP · **PAYMENT**

The mock card processor charges the chosen card.
**Details:** `status: success`, `transaction_id: TXN_…`, `payment_method: "Visa •••• 4242"`.

### 30. Order recorded
`order_created` · Nike Order Service → NikeAgent · **internal**

Nike creates and saves the order and starts tracking.
**Details:** `order_id: CHK_D3A8CF33`, `tracking_number: TRK…`, `delivery_date`, `amount: 151.47`.

### 31. Nike Agent → Customer Agent: ORDER_CONFIRMED
`order_confirmed` · NikeAgent → CustomerAgent · **A2A**

Nike's agent sends the authoritative order back to your agent.

**In the chat:** the **Order confirmed** card — Nike Zoom Fly 6, Size 9 · Black, Paid $151.47, Visa •••• 4242, delivery date, tracking number and loyalty points earned. The order also appears in **Track my orders** and the Dashboard.

---

## Part 4 — The Story view for the same run

Switch to **Story** to see the same run as 14 rows, each with **View details**:

| Row | Shows after a successful run |
|---|---|
| Input | Security checks passed |
| Intent | Shopping intent extracted — "What you want, not permission to spend" |
| Routing | Nike selected · brand named in request |
| A2A | Customer Agent → Nike Agent · A2A-style, in-process |
| Agent trust | ✓ Identity ✓ Delegation ✓ Scope · Trusted session · guest with Nike |
| UCP | Catalog queried · 8 variants |
| Human | ✓ Product selected |
| Checkout | Total $151.47 · Delivery Saturday, October 10 |
| AP2 | ✓ Checkout bound · ✓ Consent recorded as authorization evidence |
| Human | ✓ GO AHEAD (or ✓ Auto GO AHEAD (10 s countdown)) |
| ACP | ✓ Scoped payment credential issued · ✓ Merchant + amount verified |
| Payment | ✓ 12/12 deterministic checks · ✓ Authorized |
| Nike | ✓ Order created · CHK_… |
| A2A | Nike Agent → Customer Agent · ORDER_CONFIRMED |

Green border = done, red = failed, amber = paused, grey = not reached yet.

---

## Part 5 — When something goes wrong

Use the **Demo scenario** picker under the message box to show these on purpose. Set it back to **Normal** afterwards.

### Invalid agent credential (trust fails)

After card 7, Nike rejects the credential:

**Trust validation failed** · `agent_identity_failed` · NikeAgent → CustomerAgent · **TRUST** (red)
**Details:** `failed_check: credential_signature_valid`, `reason: credential signature does not verify`, plus all eight checks.

Nothing after that runs: no catalog, no products, no checkout.
**In the chat:** *"Nike could not verify your shopping agent, so no products were requested. Nothing was searched, reserved or charged."*
**Story:** the Agent trust row turns red and every later row stays grey.

### Merchant changes delivery date

After card 26, Nike re-checks its own terms and finds the delivery date has moved:

| Card | Event | Meaning |
|---|---|---|
| Merchant changed the delivery date | `condition_changed` · A2A | e.g. Saturday, October 10 → Monday, October 12 |
| Re-consent required | `reconsent_required` · HUMAN | payment paused; the token stays unused |

**In the chat:** an amber card — *"Delivery on Saturday, October 10 is no longer available. Nike can deliver on Monday, October 12 instead. Would you like to continue?"* with **YES, continue** and **NO, cancel**.

**YES:**

| Card | Event |
|---|---|
| Old payment token invalidated | `delegated_token_invalidated` (it was bound to the old date) |
| AP2 checkout bound | `ap2_checkout_bound` (re-bound to the new date) |
| Customer accepted the new terms | `reconsent_received` |

…then cards 22–31 run again with a fresh token, and the order shows the new date.

**NO:**

| Card | Event |
|---|---|
| Old payment token invalidated | `delegated_token_invalidated` |
| Checkout cancelled | `checkout_cancelled` |

**In the chat:** *"Okay, I cancelled that checkout. Nothing was charged."* No order is created.

### Agent tries to charge $20 more

After card 23, the charge attempt doesn't match what you approved:

| Card | Event | Meaning |
|---|---|---|
| Demo: charge attempt above the authorized amount | `demo_tampered_charge` | authorized 151.47, attempted 171.47 |
| Payment token rejected | `acp_token_rejected` (red) | `amount_within_token_scope` fails: 17147 > 15147 cents |
| Payment stopped | `payment_rejected` (red) | `reason: AMOUNT_EXCEEDS_TOKEN_SCOPE`, `charged: false`, `order_created: false` |

**In the chat:** *"The payment did not match the authorized checkout or the token's scope. Nothing was charged."* with the reason code.

### Other rejections you may see

| Card | Cause | Result |
|---|---|---|
| Blocked by custom input check | e.g. a card number typed into the chat | stops at card 2 |
| NeMo Guardrails · Commerce Scope: BLOCK | off-topic request | stops at card 3 |
| Approval did not match the checkout | approved total, hash or card doesn't match Nike's checkout | nothing authorized |
| Payment stopped · TOKEN_ALREADY_CONSUMED | the same payment token used twice | second attempt refused; the first order stands |
| Payment stopped · TOKEN_REVOKED | a cancelled token reused | refused |
| Payment stopped · *check name* | one of the 12 payment checks failed | no charge, no order |

Any failure after GO AHEAD means **no charge and no order**, with the reason shown in red.

### If the AI is slow

Searches depend on Gemini and can take 20–60 seconds when it is busy. Each Gemini call is limited to 45 seconds with one retry. If it still fails, the chat says *"The AI service is responding slowly right now… Please try again."*

---

## Part 6 — What is real and what is simulated

| Real in this POC | Simulated or simplified |
|---|---|
| Input checks, NeMo Guardrails with Gemini, Gemini intent and recommendations | A2A calls run in-process, not over the network |
| Merchant catalogs, prices, stock and delivery dates | The agent credential uses a demo signing key, not production PKI |
| Agent trust checks, consent binding, token checks, 12 payment checks | AP2 records use a demo signature, not SD-JWT |
| Every trace event and every value in its details | The ACP token is ACP-style, not Stripe's wire format |
| Orders saved and shown in the tracker | The card processor is a mock |
| | Delivery change, bad credential and tampering are triggered by the demo picker |

**No card number, CVC or full expiry ever appears in the trace.** Only a payment-method reference and "brand •••• last4".

---

## Glossary

| Term | Meaning here |
|---|---|
| **Customer Agent** | Your shopping assistant on the Talkshop side |
| **Merchant agent** | Nike's (or Zara's…) own agent |
| **Trusted session** | Nike's record that it verified your agent; required for checkout and payment |
| **Guest to Nike** | Nike has no account for you; you are known only to Talkshop |
| **Checkout hash** | A fingerprint of the checkout; any change to price, item or delivery breaks it |
| **GO AHEAD** | Your approval of this exact checkout and amount (click or 10-second countdown) |
| **A2A** | Agent-to-agent messages (A2A-style) |
| **UCP** | Catalog and checkout concepts (UCP-style) |
| **AP2** | Signed evidence of what you're buying and what you approved (AP2-style) |
| **ACP** | The scoped, single-use payment token Nike receives (ACP-style) |
| **DPAT** | Talkshop's internal single-use enforcement token behind the 12 payment checks — not an industry protocol |
| **Mock PSP** | The pretend card processor |
