# Demo 2 Orchestration — Rectification Plan & Tracker

This file tracks the work to reshape the Demo 2 purchase flow into the target business story:

> An authenticated Talkshop customer uses their own shopping agent to buy from a merchant such as Nike. The customer may be unknown to Nike. The customer agent connects to the Nike agent, Nike verifies the agent before any sensitive action, the customer approves the exact checkout with **GO AHEAD**, and payment uses a scoped token. Raw card data never reaches the LLM.

**How to use this file**

- Tick a box when the sub-task is merged and its check has passed: `- [x]`.
- Update the phase status in the tracker table when a phase starts or finishes.
- Record any change of plan in the [Decision log](#decision-log), with the date.
- Status values: `Not started` · `In progress` · `Blocked` · `Done`.

---

## Progress tracker

| Phase | Name | Status | Depends on |
|---|---|---|---|
| 0 | Guest vs known customer: definitions | Done (agreed below) | — |
| 1 | Map the current implementation | Done (findings below) | — |
| 2 | Merchant-side Agent Trust stage | Done | 1 |
| 3 | Customer context: known to Talkshop, guest to Nike | Done (3.7 deferred) | 0, 2 |
| 4 | Separate shopping intent from payment consent | Done | 1 |
| 5 | Reorder checkout: proposal before GO AHEAD | Done | 3, 4 |
| 6 | Payment roles: AP2 evidence, ACP token, DPAT internal | Done | 5 |
| 7 | Simplified protocol trace | Done | 2, 5, 6 |
| 8 | Delivery-change re-consent path | Done | 5, 6 |
| 9 | End-to-end and security tests | Done — 251 passed; live API and UI runs recorded | 2–8 |
| 10 | Demo deliverables and documentation | Done — see demo2_implementation_report.md | 9 |

---

## Phase 0 — Guest vs known customer: definitions

This is the main source of confusion today, so it is settled first and every later phase uses these words.

There are **two separate relationships**. Each one is answered independently.

| Relationship | Question it answers | Values |
|---|---|---|
| **Talkshop account** | Does Talkshop (the customer-side platform) know this person? | `authenticated` or `talkshop_guest` |
| **Merchant relationship** | Does Nike (the merchant) know this person? | `merchant_guest` or `merchant_member` |

| Talkshop account | Merchant relationship | Meaning | Role in Demo 2 |
|---|---|---|---|
| authenticated | **merchant_guest** | Known to Talkshop, unknown to Nike | **Primary demo scenario** |
| authenticated | merchant_member | Known to both | Possible later extension. Not in scope now. |
| talkshop_guest | merchant_guest | Unknown to both, card typed at checkout | Secondary / testing path only. Keep working, don't feature it. |
| talkshop_guest | merchant_member | Not a meaningful case | Not supported |

**Rules every phase follows**

- [x] "Guest" on its own is never used in code, UI or trace. Always say **Talkshop guest** or **Nike guest**.
- [x] The primary story is: logged-in Talkshop customer, guest to Nike.
- [x] A known Talkshop customer pays with a **saved payment method reference** (brand + last4 + payment_method_id). They never type a card.
- [x] Nike-guest status does not reduce security. Nike trusts the **customer agent and its delegation**, not a Nike account.
- [x] The Talkshop-guest path stays available from the login page, labelled as a secondary path.

**What the code does today (from Phase 1)**

- "Guest" only means **Talkshop guest**: the "Continue as Guest" login (`backend/routers/auth.py`, `users.is_guest`) and the card-entry form in `frontend/src/components/InlineCheckout.tsx`.
- On the generic path, "guest" means paying with **pre-registered demo instruments** instead of ACP (`use_acp=False` in `backend/routers/generic_chat.py`). That is a third meaning.
- Nothing models the **merchant relationship**. Nike never knows or says whether the customer is its guest.

---

## Phase 1 — Map the current implementation

**Status: Done.** Findings recorded so later phases change the right places.

| Stage | Where it happens today | Notes |
|---|---|---|
| Input checks, NeMo, Guardrails AI | `backend/graph/workflow.py`, `backend/guardrails/` | Keep as is. |
| Intent extraction | `backend/agents/vibecheck.py`, `backend/graph/workflow.py` | Produces `ShoppingIntent`. |
| Merchant routing | `_select_agents()` in `backend/merchants/catalog.py` and `workflow.py` | A named brand already routes to one merchant. No brand means all relevant merchants. |
| A2A-style merchant call | `backend/a2a/merchants/*.py`, trace events `merchant_routing`, `task_result` in `workflow.py` | Called **in-process**. The HTTP A2A endpoint (`backend/routers/a2a.py`) is not used by the main chat. |
| UCP-style catalog | `backend/merchants/catalog.py`, merchant `search()` | Events `catalog_search`, `catalog_results`. |
| Merchant boundary checks | `backend/guardrails/agent_checks.py` | Event `boundary_check`. Keep. |
| Checkout create | `POST /api/checkout/create` in `backend/routers/authorizations.py`, built by `backend/agents/cartup.py` | Returns totals and `checkout_hash`. **`delivery_date` is always null.** |
| AP2 intent + cart mandate | `_issue_checkout_mandates()` in `authorizations.py`, `backend/ap2/adapter.py` | The **search intent is turned into an AP2 IntentMandate** at checkout. That conflicts with "search is not payment consent". |
| Approve (consent) | `POST /api/authorizations/approve` | Order inside: verify AP2 cart → **issue DPAT** → AP2 payment mandate referencing the DPAT → **ACP token derived from the DPAT**. |
| Execute payment | `POST /api/payments/execute` in `backend/routers/payments.py` | ACP verification, then the 12 checks in `backend/payment/guardrail_engine.py`, then `mock_processor.py`, then the order row. |
| 12 payment checks | `guardrail_engine.py` | token_exists, token_active, token_not_expired, token_not_consumed, agent_id_match, merchant_id_match, order_id_match, currency_match, amount_within_limit, amount_matches_checkout, checkout_hash_match, consent_exists. |
| Order | `payments.py` (Order row, audit), `backend/agents/trackit.py` | Keep. |
| Who drives the purchase | `frontend/src/pages/Chat.tsx` | **The browser calls create → approve → execute in sequence**, and itself emits the checkout, AP2, ACP and DPAT trace rows (`emitProto`). |
| Saved cards | `SAVED_CARDS` in `InlineCheckout.tsx` | Hard-coded in the frontend: Visa 4242, Mastercard 8317, Amex 5591. Not tied to the user on the server. |
| Talkshop-guest card | `InlineCheckout.tsx`, `Chat.tsx` | Card number, expiry and CVC are saved in browser `sessionStorage`. They are not sent to the server. |

**Gaps against the target**

1. No merchant-side agent trust stage.
2. No merchant relationship (Nike guest) in the model or the trace.
3. The search intent becomes an AP2 mandate at checkout.
4. Order is DPAT first, then ACP derived from it. The target is ACP as the delegated token and DPAT as internal enforcement behind it.
5. No order proposal step with a masked payment method and delivery date. The current button is "Confirm & Pay".
6. Payment trace rows come from the browser, not the server.
7. Raw card data sits in browser storage on the Talkshop-guest path.
8. No delivery date, so no delivery-change path is possible yet.

---

## Phase 2 — Merchant-side Agent Trust stage

**Goal:** before Nike allows checkout or payment, it deterministically verifies the customer agent, its platform, its credential and the customer's delegation. No LLM is involved in the decision.

**Sub-tasks**

- [x] 2.1 Create `backend/trust/` with models `AgentIdentity`, `DelegationGrant`, `AgentCredential`, `TrustedAgentSession`.
- [x] 2.2 Issue a customer-agent credential on the Talkshop side for the logged-in user. It carries agent_id, platform_id, key hint, user_id, scopes (`catalog:read`, `checkout:create`, `payment:execute`), merchant scope, expiry and an HMAC signature. The demo key lives in `.env`.
- [x] 2.3 Write `AgentTrustService.verify()` with deterministic checks:
  - [x] identity is well-formed and the agent_id is registered
  - [x] platform_id is the expected customer platform
  - [x] signature is valid
  - [x] delegation belongs to this user and this agent
  - [x] the requested action is in scope
  - [x] the credential has not expired
  - [x] the merchant scope includes this merchant
  - [x] the amount is within max_amount, when one is set
- [x] 2.4 Create a `TrustedAgentSession` per customer-agent and merchant pair, with an id, scopes and expiry. Store it server-side.
- [x] 2.5 Run trust after routing and before the catalog call. Checkout and payment endpoints require a valid trusted session id.
- [x] 2.6 Emit server-side trace events: `agent_identity_received`, `agent_identity_verified` (or `agent_identity_failed`), `delegation_verified`, `scope_verified`, `trusted_agent_session_created`.
- [x] 2.7 Add a demo switch to send an invalid credential, for the trust-failure test. For example a query flag or a debug header, off by default.

**Checks — done when**

- [x] A valid credential creates a trusted session and the flow continues.
- [x] An invalid signature, wrong platform, expired credential or wrong merchant scope stops the flow at trust: no catalog call, no checkout, no payment, no order.
- [x] `/api/checkout/create` and `/api/payments/execute` refuse requests without a valid trusted session.
- [x] The decision code contains no LLM call.
- [x] Unit tests cover each failure reason.

**Likely files:** new `backend/trust/*`, `backend/graph/workflow.py`, `backend/routers/authorizations.py`, `backend/routers/payments.py`.

---

## Phase 3 — Customer context: known to Talkshop, guest to Nike

**Goal:** the system and trace say clearly that the customer is authenticated to Talkshop and a guest to Nike.

**Sub-tasks**

- [x] 3.1 Add `talkshop_account` (`authenticated` / `talkshop_guest`) to the server session from the login token.
- [x] 3.2 Add `merchant_relationship` (`merchant_guest` / `merchant_member`) returned by the merchant at trust time. Default: Nike has no record, so `merchant_guest`.
- [x] 3.3 Move saved payment methods to the server, per user, as references only: payment_method_id, brand, last4, expiry month/year. No PAN and no CVC stored anywhere. Seed the demo user with a Visa reference.
- [x] 3.4 The frontend reads payment methods from the server instead of `SAVED_CARDS`.
- [x] 3.5 Rename UI and trace wording: "Continue as Guest" becomes "Continue as Talkshop guest (testing)". Checkout shows "Checking out as a guest with Nike" for the primary scenario.
- [x] 3.6 Talkshop-guest path: stop storing card number and CVC in `sessionStorage`. Keep at most brand and last4 in the browser, and tokenize at the mock PSP.
- [ ] 3.7 Align the generic path's "guest" (pre-registered instruments) with the same two terms, or rename it to "pre-registered instrument". *(Deferred: the generic path is left unchanged for now — see decision log.)*

**Checks — done when**

- [x] Logging in as `demo@talkshop.io` shows the primary scenario: authenticated to Talkshop, guest to Nike.
- [x] The trace shows `merchant_relationship: merchant_guest` at the trust stage.
- [x] Searching `sessionStorage`, `localStorage`, server logs and the database for a test card number finds nothing.
- [x] The Talkshop-guest login still works end to end.

**Likely files:** `backend/routers/auth.py`, `backend/db/schema.py`, new payment-method route, `frontend/src/components/InlineCheckout.tsx`, `frontend/src/pages/Chat.tsx`, `frontend/src/pages/Login.tsx`.

---

## Phase 4 — Separate shopping intent from payment consent

**Goal:** a search request never counts as permission to spend.

**Sub-tasks**

- [x] 4.1 Stop creating an AP2 IntentMandate from the search intent at checkout. Alternatively keep it labelled `shopping_intent`, with no spending meaning.
- [x] 4.2 Name the two concepts in code and trace: `shopping_intent` (what the customer wants) and `payment_authorization` (what the customer approved to pay).
- [x] 4.3 Make sure no token, mandate or authorization is created before GO AHEAD.
- [x] 4.4 Update the AP2 cart-mandate link so it no longer depends on an intent mandate id.

**Checks — done when**

- [x] After a search and a product selection, the database has no payment authorization, DPAT or ACP token for the session.
- [x] Trace rows before GO AHEAD contain no spending-authorization labels.
- [x] AP2 tests still pass, with the intent-mandate link updated.

**Likely files:** `backend/routers/authorizations.py`, `backend/ap2/adapter.py`, `backend/ap2/models.py`, tests under `tests/`.

---

## Phase 5 — Reorder checkout: proposal before GO AHEAD

**Goal:** the order is product selection → checkout → cart evidence → order proposal → GO AHEAD → payment authorization.

**Sub-tasks**

- [x] 5.1 Checkout returns a real delivery date: today + the product's `delivery_days`, in the response and inside the `checkout_hash`.
- [x] 5.2 The AP2 cart mandate binds merchant, product, variant, quantity, total, currency and checkout hash. This already exists. Confirm delivery is included.
- [x] 5.3 Build an order proposal card: product, variant, quantity, merchant, subtotal, tax, shipping, total, delivery date, and payment method as **brand + last4 only**.
- [x] 5.4 Replace "Confirm & Pay" with **GO AHEAD**. Product selection alone never triggers payment.
- [x] 5.5 GO AHEAD sends a consent bound to merchant, checkout_id, checkout_hash, total, currency and payment_method_id. The server records `customer_consent_received`.
- [x] 5.6 Move the purchase sequence to the server: one call after GO AHEAD runs consent → AP2 → ACP → DPAT → checks → PSP → order and streams the events. The browser no longer chains create, approve and execute.
- [x] 5.7 No extra confirmation after GO AHEAD, unless conditions change (Phase 8).

**Checks — done when**

- [x] The proposal shows the delivery date and a masked card such as "Visa •••• 4242".
- [x] Nothing is authorized or charged before GO AHEAD.
- [x] A consent whose checkout_hash, total or merchant differs from the checkout is rejected.
- [x] The happy path still creates an order and shows it in the order tracker.

**Likely files:** `backend/agents/cartup.py`, `backend/routers/authorizations.py`, new purchase orchestration route, `frontend/src/components/InlineCheckout.tsx`, `frontend/src/pages/Chat.tsx`.

---

## Phase 6 — Payment roles: AP2 evidence, ACP token, DPAT internal

**Goal:** one clear authorization story. AP2 is the evidence, ACP is the delegated payment token that crosses to the merchant, and DPAT is internal enforcement.

Target order after GO AHEAD:

```
Customer consent
  → AP2 payment authorization evidence (bound to checkout hash)
  → ACP scoped token (merchant, checkout_id, amount, currency, expiry, single use)
  → Nike verifies the token against the trusted session and checkout
  → PaymentAuthorizationAdapter maps it to an internal DPAT
  → 12 deterministic checks
  → Mock PSP
  → Payment approved
```

**Sub-tasks**

- [x] 6.1 Create the AP2 payment mandate **after** consent and **before** any token. It references checkout_id and checkout_hash, not the DPAT id.
- [x] 6.2 Issue the ACP token from the consent and AP2 evidence, with merchant, checkout_id, max_amount in cents, currency, expiry and single_use. It is no longer derived from the DPAT.
- [x] 6.3 Merchant-side ACP verification checks merchant, checkout binding, amount, currency, expiry, single use and the trusted session.
- [x] 6.4 Add `PaymentAuthorizationAdapter`: verified ACP token → internal DPAT. Keep the DPAT model and all 12 checks unchanged.
- [x] 6.5 Single use is enforced once, at the ACP token and the DPAT together. A replay fails with "token already used".
- [x] 6.6 Any failure stops the flow with a structured reason. No charge and no order.
- [x] 6.7 Wording: in UI and docs, DPAT is "internal single-use enforcement token", never an industry protocol.
- [x] 6.8 Remove duplicated authorization logic between approve and execute, so each rule lives in one place.

**Checks — done when**

- [x] Happy path: consent → AP2 → ACP → DPAT → 12/12 checks → PSP approved → order.
- [x] Tampered amount ($171.47 against a $151.47 checkout) is rejected for not matching the authorized checkout or token scope. No payment, no order.
- [x] Replaying a used token is rejected as already used.
- [x] No raw card data in any AP2, ACP or DPAT object, trace event or log.
- [x] Existing payment guardrail tests still pass, or are updated with the reason recorded.

**Likely files:** `backend/routers/authorizations.py`, `backend/routers/payments.py`, `backend/acp/*`, `backend/ap2/*`, new `backend/payment/authorization_adapter.py`, `backend/agents/greenlight.py`, `backend/agents/payit.py`.

---

## Phase 7 — Simplified protocol trace

**Goal:** the right-hand panel tells the business story by default, with raw JSON one click away.

Default rows:

| Row | Shows |
|---|---|
| INPUT | ✓ Security checks passed |
| INTENT | ✓ Nike running shoes under $150 |
| ROUTING | ✓ Nike selected |
| A2A | Customer Agent → Nike Agent |
| AGENT TRUST | ✓ Identity · ✓ Delegation · ✓ Scope · Trusted session established |
| UCP | ✓ Catalog queried |
| HUMAN | ✓ Product selected |
| CHECKOUT | ✓ Total $151.47 · delivery date |
| AP2 | ✓ Checkout bound · ✓ Consent recorded |
| HUMAN | ✓ GO AHEAD |
| ACP | ✓ Scoped payment token issued · ✓ Merchant + amount verified |
| PAYMENT | ✓ 12/12 deterministic checks · ✓ Authorized |
| NIKE | ✓ Order created |
| A2A | Nike Agent → Customer Agent: ORDER_CONFIRMED |

**Sub-tasks**

- [x] 7.1 All rows come from server events, not from the browser's `emitProto`.
- [x] 7.2 Rename "ShoppingAgent" to "Customer Agent" in the trace.
- [x] 7.3 Add the AGENT TRUST row and the two HUMAN rows.
- [x] 7.4 DPAT appears inside the PAYMENT row as internal enforcement, not as its own protocol row.
- [x] 7.5 Every row has "View details" with the raw event JSON, already redacted.
- [x] 7.6 Add a redaction check so card-like numbers and CVC fields never reach an SSE event.
- [x] 7.7 Keep the existing Flow and Live tabs working.

**Checks — done when**

- [x] A happy-path run shows exactly the rows above, in order.
- [x] A trust failure shows the trace stopping at AGENT TRUST with `agent_identity_failed`.
- [x] A text search of a full SSE capture finds no card number, CVC or full expiry.

**Likely files:** `backend/graph/workflow.py`, new purchase orchestration route, `frontend/src/components/AgentTrailPanel.tsx`, `frontend/src/pages/Chat.tsx`.

---

## Phase 8 — Delivery-change re-consent path

**Goal:** if Nike's delivery date changes after GO AHEAD, the payment pauses and the customer decides.

**Sub-tasks**

- [x] 8.1 Before execution, the merchant re-checks delivery. Add a demo switch to force a change, for example October 8 becoming October 10.
- [x] 8.2 On change: emit `condition_changed` and `reconsent_required`, pause, and keep the ACP token and DPAT unused.
- [x] 8.3 The chat shows "Delivery on October 8 is no longer available. Nike can deliver on October 10 instead. Would you like to continue?" with YES and NO.
- [x] 8.4 YES: update the checkout (new delivery and new hash), record `reconsent_received`, issue updated AP2 evidence and token, then execute.
- [x] 8.5 NO: record `checkout_cancelled`, revoke the unused token and DPAT. No payment and no order.
- [x] 8.6 The old token cannot be used after a YES or a NO.

**Checks — done when**

- [x] YES path ends with an order showing the new delivery date.
- [x] NO path ends with no charge, no order, and a revoked token.
- [x] Reusing the pre-change token fails.

**Likely files:** new purchase orchestration route, `backend/agents/cartup.py`, `backend/routers/authorizations.py`, `frontend/src/pages/Chat.tsx`, `frontend/src/components/InlineCheckout.tsx`.

---

## Phase 9 — End-to-end and security tests

**Baseline before this work:** 210 passed, 19 failed (recorded 2026-10-07). All 19 were stale tests still buying product `RW001` from the v1 catalog; they now use a current Nike product. **Current: 240 passed, 0 failed**, including the 11 tests in `tests/test_demo2_purchase.py`.

| # | Acceptance test | Expected | Automated test | Live run | Status |
|---|---|---|---|---|---|
| T1 | Happy path: "Find me Nike running shoes under $150, size 9" → Zoom Fly 6, size 9, Black → GO AHEAD | Steps 1–22 of the brief all occur. Order confirmed. | [x] | [x] | Passed (automated + live) |
| T2 | Trust failure: invalid customer-agent credential | Stops at trust with `agent_identity_failed`. No checkout, payment or order. | [x] | [x] | Passed (automated + live) |
| T3 | Payment tampering: pay $171.47 against $151.47 | Rejected: amount does not match authorized checkout / token scope. No payment, no order. | [x] | [x] | Passed (automated + live) |
| T4 | Replay: same token twice | First approved, second rejected as already used. | [x] | [x] | Passed (automated + live) |
| T5 | Delivery change, customer says YES | Pause, re-consent, then order with new date. | [x] | [x] | Passed (automated + live) |
| T6 | Delivery change, customer says NO | Cancelled, token revoked, no payment, no order. | [x] | [x] | Passed (automated + live) |
| T7 | Card-data boundary | No PAN, CVC or full expiry in LLM prompts, SSE, logs, database or browser storage. | [x] | [x] | Passed (automated + live) |
| T8 | Search is not consent | After search and selection, no authorization or token exists. | [x] | [x] | Passed (automated + live) |
| T9 | Talkshop-guest path still works | Secondary path completes, with no raw card stored. | [x] | [x] | Passed (automated + live) |

**Non-regression checklist** (must still work at the end)

- [x] Login and Talkshop-guest login
- [x] Session history sidebar *(automated test only; not re-checked in the UI)*
- [x] Product catalog, product cards and per-colour photos
- [x] Intent extraction, NeMo Guardrails, Guardrails AI *(Guardrails AI is not installed in this environment, so the schema check uses the Pydantic fallback — unchanged by this work)*
- [x] Merchant boundary checks
- [x] Checkout endpoint and checkout hash
- [x] Saved payment method display (masked)
- [x] DPAT issuance and validation, all 12 payment checks
- [x] Mock processor
- [x] Order persistence, order tracker and dashboard *(order list verified via API; dashboard page not re-checked in the UI)*
- [x] SSE events, pipeline view and Live Trace panel

---

## Phase 10 — Demo deliverables and documentation

The brief asks for evidence from a real run, not a claim of completion.

- [x] 10.1 Updated architecture diagram
- [x] 10.2 List of modified files
- [x] 10.3 Explanation of each modification
- [x] 10.4 Old flow vs new flow
- [x] 10.5 Exact runtime sequence
- [x] 10.6 Example SSE / protocol trace captured from a live run
- [x] 10.7 Security boundary explanation
- [x] 10.8 Happy-path test results (T1)
- [x] 10.9 Negative and security test results (T2–T8)
- [x] 10.10 Remaining mocked or simplified areas
- [x] 10.11 Exact truthful wording for the client demo
- [x] 10.12 Update `explain.md`: the Live Trace stages and the Protocol Fidelity section

**Truthful wording to use** (update if the implementation changes)

- **A2A:** "A2A-style message and task interaction between the customer agent and the Nike agent. In this POC the agents run in-process."
- **Agent trust:** "Nike verifies the customer agent's identity, platform, delegation and scope with deterministic checks before checkout. The signature is a demo HMAC, not a production PKI."
- **UCP:** "UCP-style catalog and checkout concepts. Not the UCP wire protocol."
- **AP2:** "AP2-style authorization evidence, bound to the checkout hash and created only after the customer says GO AHEAD."
- **ACP:** "An ACP-style scoped, single-use payment token is what crosses to the merchant. The agent never sees the card."
- **DPAT:** "Our internal single-use enforcement token. The payment service runs 12 deterministic checks on it before the mock processor charges."

---

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-07 | Primary scenario is authenticated to Talkshop + guest to Nike. | Matches the business requirement. "Continue as Guest" is a secondary path. |
| 2026-10-07 | "Guest" is always qualified as Talkshop guest or Nike guest. | The code used one word for three different things. |
| 2026-10-07 | DPAT stays, as internal enforcement behind ACP. | Keeps the working 12 checks while simplifying the client story. |
| 2026-10-07 | The demo card stays Visa •••• 4242. | It is the card the UI and mock processor already use. The brief's 4001 was only an example. |
| 2026-10-07 | Failure demos are triggered by a `demo` option on the request (`bad_agent_credential`, `tampered_amount`, `delivery_change`). Off by default. | Deterministic and easy to show on stage. |
| 2026-10-07 | A payment token gets a single attempt, everywhere. A rejected attempt burns or revokes it. | Stops probing a token with varied tampered fields. Two older tests disagreed; this policy is the one the payment code documents. |
| 2026-10-07 | A failed payment no longer creates a "blocked" order row in the new flow. | The brief says no order on any failure. The legacy endpoints keep their old behaviour. |
| 2026-10-07 | The generic protocol path (`/api/generic/stream`) is left unchanged for now. | It is a separate protocol showcase. |
| 2026-10-07 | Removed the 10-second auto-pay on the order summary. | It charged without any click, which contradicts "GO AHEAD is the only consent". The cart → proposal countdown stays; it never pays. |
| 2026-10-07 | Restored the 10-second countdown on the order proposal, at the product owner's request, as a visible **Auto GO AHEAD**. | The countdown shows on the exact proposal with Pause and Cancel, pauses while the card is being changed, restarts after a card change, and runs the same GO AHEAD checks. The consent is recorded as `consent_mode: auto_countdown`, so the trace never presents it as a click. |
| 2026-10-07 | The legacy endpoints (`/api/checkout/create`, `/approve`, `/execute`) stay for compatibility but now require a trusted agent session. | No way to reach payment around the trust stage. |
| 2026-10-07 | Fixed: the six A2A merchants were missing from the merchants table, so their orders never appeared in the order list. Order details now fall back to the merchant catalog for title and photo. | Order tracker had to keep working. |

## Open questions

- [x] Which saved card should the demo show? The brief's example is Visa •••• 4001. The code today has Visa •••• 4242.
- [ ] Should the Nike-member case (known to both) be shown at all, or only mentioned?
- [x] How should the trust-failure and delivery-change demos be triggered on stage: a hidden toggle, a query flag, or a scripted second account?
- [x] Should the generic path (`/api/generic/stream`) get the same changes, or stay as the protocol showcase?
