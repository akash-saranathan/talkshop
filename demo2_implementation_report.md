# Demo 2 — Rectified Orchestration: Implementation Report

**Scenario:** an authenticated Talkshop customer uses their shopping agent to buy from Nike. Talkshop knows the customer; Nike does not (guest to Nike). The customer agent connects to the Nike agent, Nike verifies it before any sensitive action, the customer approves the exact checkout with **GO AHEAD**, and payment uses a scoped token. No raw card data reaches the LLM, the agents or the trace.

Every number and event below comes from a real run of the app on 2026-10-07 (backend on `:8001`, frontend on `:5175`), driven through the same endpoints the browser uses, plus headless-browser runs of the UI. Progress is tracked in [demo2_orchestration_plan.md](demo2_orchestration_plan.md).

---

## 1. Architecture

```
CUSTOMER
  │  "Find me Nike running shoes under $150, size 9"
  ▼
MyChatGPT / Talkshop — Customer Agent  (customer is AUTHENTICATED here)
  │
  ├─ Input guardrails ........ custom checks · NeMo Guardrails (commerce scope)
  ├─ Intent extraction ....... Gemini → ShoppingIntent · Guardrails AI schema check
  │                            (what the customer wants — NOT permission to spend)
  ├─ Merchant routing ........ brand named → Nike only
  │
  ▼  A2A-style connection (agent card, skills) — in-process
NIKE AGENT  (customer is a GUEST here)
  │
  ├─ AGENT TRUST VALIDATION .. AgentTrustService, 8 deterministic checks, no LLM
  │     identity registered · expected platform · signature · delegation bound
  │     not expired · action in scope · merchant in scope · amount in scope
  │     → TrustedAgentSession (merchant_guest)
  │
  ├─ UCP-style catalog ........ Nike catalog is the source of truth
  │                            merchant boundary checks
  ▼
HUMAN — product selection  (not payment approval)
  ▼
NIKE CHECKOUT (trusted session required) → stored server-side, checkout_hash
  ├─ AP2 cart evidence ....... binds product, qty, merchant, total, delivery
  ▼
ORDER PROPOSAL ............... totals · delivery date · Visa •••• 4242
  ▼
HUMAN — GO AHEAD  ............ consent bound to merchant, checkout_id, hash, total,
  │                            currency, payment_method_id
  ▼
AUTHORIZATION LAYER
  ├─ AP2 payment authorization evidence (created only now)
  ├─ ACP-style delegated token: merchant · checkout · $151.47 · USD · 15 min · single use
  ▼
NIKE VERIFIES ................ trusted session (payment scope + amount) · token · AP2 evidence
  ├─ re-checks its own terms (delivery) → pause for re-consent if changed
  ▼
INTERNAL PAYMENT ENFORCEMENT
  ├─ PaymentAuthorizationAdapter → internal DPAT (not an industry protocol)
  ├─ 12 deterministic payment checks
  ▼
Mock PSP → payment approved
  ▼
Nike Order Service → order + tracking
  ▼  A2A-style ORDER_CONFIRMED
Customer Agent → order confirmation in chat
```

## 2. Files changed

**New**

| File | Purpose |
|---|---|
| `backend/trust/models.py` | `AgentIdentity`, `DelegationGrant`, `AgentCredential`, `TrustedAgentSession`, scope names |
| `backend/trust/credentials.py` | Talkshop issues the signed customer-agent credential; pseudonymous `customer_ref` for merchants |
| `backend/trust/verifier.py` | Merchant-side `AgentTrustService` (8 checks) and merchant relationship (guest/member) |
| `backend/trust/sessions.py` | Opens, stores and re-verifies trusted agent sessions |
| `backend/purchase/service.py` | Server-side purchase orchestration: proposal, GO AHEAD, merchant charge, re-consent |
| `backend/routers/purchase.py` | `/api/payment-methods`, `/api/psp/tokenize`, `/api/trust/session`, `/api/purchase/*`, `/api/merchant/payments` |
| `backend/acp/delegated.py` | ACP-style scoped token bound to merchant, checkout, hash, amount, currency, expiry, single use |
| `backend/payment/authorization_adapter.py` | Maps the verified delegated authorization onto the internal DPAT |
| `backend/payment/methods.py` | Saved payment method references; mock processor tokenization |
| `backend/orders/service.py` | Shared "record a paid order" logic |
| `backend/observability/redact.py` | Safety net: card-like numbers and card fields never leave in a trace event |
| `tests/test_demo2_purchase.py`, `tests/test_trust.py` | Acceptance tests T1–T9 and trust unit tests |

**Changed**

| File | Change |
|---|---|
| `backend/graph/workflow.py` | New `agent_trust` node between intent and catalog; search only runs and only returns products for trusted merchants; trace says "Customer Agent" |
| `backend/db/schema.py`, `init_db.py` | Tables for trusted sessions, merchant checkouts, consents, payment methods, delegated tokens; the six A2A merchants seeded (fixes the order list) |
| `backend/agents/cartup.py` | Checkout carries a delivery date, included in the checkout hash |
| `backend/ap2/adapter.py` | Payment authorization evidence can record the consent it came from |
| `backend/routers/authorizations.py` | Search intent no longer becomes an AP2 mandate; legacy checkout needs a trusted session; shared DPAT persistence |
| `backend/routers/payments.py` | Legacy execute needs a trusted session; single attempt per token; shared order service; order details fall back to the merchant catalog |
| `backend/agents/payit.py` | Charges the payment method the customer chose |
| `backend/auth/dependencies.py`, `routers/chat.py` | Knows Talkshop-guest vs authenticated; demo scenario switch |
| `frontend/src/components/InlineCheckout.tsx` | Order proposal, GO AHEAD, re-consent, structured rejection; card entry goes to the processor, never stored |
| `frontend/src/pages/Chat.tsx` | One server call per human decision; **removed the 10-second auto-pay**; demo scenario picker |
| `frontend/src/components/ProtocolTracePanel.tsx` | New default **Story** view with the 14 business rows; Live and Flow views understand the new events |
| `frontend/src/pages/Login.tsx` | "Continue as Talkshop guest (testing)" |
| `tests/*` | 19 stale tests repointed to the current catalog; expectations updated where the brief changed behaviour |

## 3. What changed and why

- **Agent trust before commerce.** Nike verifies the customer agent with eight deterministic checks and opens a trusted session. Catalog, checkout and payment all require it, and payment re-verifies the credential for its own scope and amount.
- **Guest vs known is explicit.** Two independent fields: `talkshop_account` (authenticated / talkshop_guest) and `merchant_relationship` (merchant_guest / merchant_member). The primary demo is authenticated + merchant_guest. The merchant sees only a pseudonymous `customer_ref`.
- **Search is not consent.** The search intent is no longer turned into an AP2 mandate. Nothing payment-related exists until GO AHEAD (test T8).
- **Visible auto GO AHEAD.** The old chat paid silently 10 seconds after the summary appeared. Now the order proposal shows an "Auto GO AHEAD in 10s" countdown with Pause and Cancel. It pauses while the card is being changed and restarts after a change. When it runs out it performs the same GO AHEAD, recorded as `consent_mode: auto_countdown` instead of a click.
- **Server-authoritative checkout.** The merchant stores its checkout. Consent and payment are checked against it, not against totals sent by the browser.
- **One payment story.** AP2 = authorization evidence. ACP = the scoped token that crosses to the merchant. DPAT = internal enforcement behind it, with the 12 checks unchanged. Previously the ACP token was derived from the DPAT.
- **No order on failure.** Any failed check stops the flow with a reason code; no charge, no order row.
- **Re-consent.** If the merchant changes a term after GO AHEAD, payment pauses with the token unused. YES re-binds and pays; NO cancels and revokes the token.
- **Card data boundary.** Saved cards are server-side references. A typed card goes to the mock processor's tokenize endpoint and only brand + last4 come back. The browser no longer keeps the card number or CVC in session storage.

## 4. Old flow vs new flow

| | Before | Now |
|---|---|---|
| Merchant trust | none | 8-check trust validation, trusted session required for catalog, checkout, payment |
| Customer context | "guest" meant three different things | authenticated to Talkshop, guest to Nike; Talkshop-guest is a labelled secondary path |
| Search intent | became an AP2 IntentMandate at checkout | stays a shopping intent; no spending meaning |
| Payment trigger | hidden 10-second countdown after the summary | GO AHEAD click, or a visible 10-second Auto GO AHEAD countdown the customer can pause or cancel; the trace records which |
| Who sequences payment | the browser: create → approve → execute | the server, one call per human decision |
| Totals used for payment | sent by the browser | the merchant's stored checkout |
| Authorization order | DPAT → AP2 payment mandate → ACP derived from DPAT | consent → AP2 evidence → ACP token → merchant verification → internal DPAT |
| Failure | "blocked" order row created | no order; structured reason |
| Delivery change | not possible (no delivery date) | pause → YES/NO re-consent |
| Trace | rows emitted by the browser, DPAT shown as a protocol | rows from server events; Story view; DPAT inside PAYMENT as internal |

## 5. Runtime sequence (happy path, live run)

| # | Step | Event(s) |
|---|---|---|
| 1 | Input checks + NeMo commerce scope | `input_check`, `input_validation_pass`, `nemo_pass` |
| 2 | Intent extracted (Gemini) | `intent_extraction` |
| 3 | Nike routed directly ("brand named in request") | `merchant_routing` |
| 4 | Customer Agent → Nike Agent | `a2a_connect` |
| 5 | Agent trust | `agent_identity_received`, `agent_identity_verified`, `delegation_verified`, `scope_verified`, `trusted_agent_session_created` |
| 6–7 | Nike catalog queried, 8 variants, boundary checks | `message/send`, `catalog_search`, `catalog_results`, `boundary_check`, `task_result` |
| 8 | Customer selects Nike Zoom Fly 6 · 9 · Black | — |
| 9–10 | Checkout re-checks trust, $151.47, delivery Oct 10 | `trusted_session_verified`, `checkout_created` |
| 10 | AP2 cart evidence | `ap2_checkout_bound` |
| 11–12 | Proposal with Visa •••• 4242 | `order_proposal` |
| 13–14 | GO AHEAD | `customer_consent_received` |
| 15 | AP2 authorization evidence | `ap2_payment_authorization` |
| 16 | ACP scoped token | `acp_token_issued` |
| 17 | Nike verifies trust (payment, $151.47), token, AP2 evidence | `trusted_session_verified`, `acp_token_verified`, `ap2_evidence_verified` |
| 18 | Internal DPAT + 12 checks | `internal_dpat_issued`, `payment_checks` (12/12) |
| 19 | Mock PSP approves | `psp_result` |
| 20 | Nike creates order CHK_D3A8CF33 | `order_created` |
| 21–22 | ORDER_CONFIRMED back to the Customer Agent; confirmation in chat | `order_confirmed` |

## 6. Example trace (live run, abridged)

```json
{"protocol":"internal","source":"CustomerAgent","target":"MerchantRegistry","label":"merchant_routing","detail":{"merchants":["nike"],"reason":"brand named in request"}}
{"protocol":"A2A","source":"CustomerAgent","target":"NikeAgent","label":"a2a_connect","detail":{"mode":"A2A-style, in-process","agent_card":"Nike Merchant Agent","skills":["product_search","checkout"]}}
{"protocol":"TRUST","source":"CustomerAgent","target":"NikeAgent","label":"agent_identity_received","detail":{"agent_id":"talkshop.customer-agent","platform_id":"talkshop.platform","public_key_hint":"talkshop-demo-key-1","customer_ref":"cust_325e2e426d3c","talkshop_account":"authenticated","scopes":["catalog:read","checkout:create","payment:execute"],"max_amount":500.0}}
{"protocol":"TRUST","source":"NikeAgent","target":"CustomerAgent","label":"trusted_agent_session_created","detail":{"trusted_session_id":"tas_7f84fc72d3f0","merchant_relationship":"merchant_guest","talkshop_account":"authenticated"}}
{"protocol":"UCP","source":"CustomerAgent","target":"NikeAgent","label":"checkout_created","detail":{"checkout_id":"CHK_D3A8CF33","totals":{"subtotal":139.99,"shipping":0.0,"tax":11.48,"total":151.47,"currency":"USD"},"delivery_date":"2026-10-10"}}
{"protocol":"HUMAN","source":"Customer","target":"CustomerAgent","label":"customer_consent_received","detail":{"consent_id":"cns_b8bd6d23399c","total":151.47,"payment_method":"Visa •••• 4242","meaning":"I authorize this exact checkout."}}
{"protocol":"AP2","source":"CustomerAgent","target":"AP2 evidence","label":"ap2_payment_authorization","detail":{"payment_mandate_id":"urn:ap2:mandate:payment:c27ff4d3…","consent_id":"cns_b8bd6d23399c","payment_ref":"pm_3f866364f85f"}}
{"protocol":"ACP","source":"CustomerAgent","target":"NikeAgent","label":"acp_token_issued","detail":{"token_id":"spt_c0b226c0b00e","merchant_id":"nike","checkout_id":"CHK_D3A8CF33","max_amount_cents":15147,"currency":"USD","single_use":true,"payment_method":{"brand":"Visa","last4":"4242"}}}
{"protocol":"PAYMENT","source":"PaymentAuthorizationAdapter","target":"PaymentService","label":"internal_dpat_issued","detail":{"dpat_token_id":"DPAT_5094C490","from_delegated_token":"spt_c0b226c0b00e","note":"Internal single-use enforcement token, not an industry protocol."}}
{"protocol":"PAYMENT","source":"PaymentService","target":"PaymentService","label":"payment_checks","detail":{"passed":12,"total":12}}
{"protocol":"PAYMENT","source":"PaymentService","target":"MockPSP","label":"psp_result","detail":{"status":"success","transaction_id":"TXN_C444C4EF7A","payment_method":"Visa •••• 4242"}}
{"protocol":"A2A","source":"NikeAgent","target":"CustomerAgent","label":"order_confirmed","detail":{"message":"ORDER_CONFIRMED","order_id":"CHK_D3A8CF33","amount":151.47,"delivery_date":"2026-10-10"}}
```

## 7. Security boundary

- **Allowed past the boundary:** `payment_method_id`, token ids, brand and last4 (e.g. "Visa •••• 4242").
- **Never present** in LLM prompts, chat messages, A2A/UCP/AP2/ACP objects, SSE events, logs or order data: card number, CVC, full expiry.
- **Where a card number exists at all:** only in memory inside the mock processor's tokenize call, for a Talkshop guest adding a card. It is validated and dropped.
- **Enforced by:** server-side references only; `backend/observability/redact.py` on every trace event; test T7 scans every table in the database and every response for the test card number.
- **No LLM decides** trust, consent, amounts or payment. Trust, consent binding, token verification, the 12 checks and order creation are deterministic code.

## 8. Happy-path results

| Check | Result |
|---|---|
| Live run (API, same calls as the browser) | Approved. Order CHK_D3A8CF33, Nike Zoom Fly 6 · 9 · Black, $151.47, Visa •••• 4242, delivery Oct 10, 12/12 checks |
| Live UI run (headless Chromium) | Proposal → GO AHEAD → "Order confirmed" card; Story view shows all 14 rows green |
| Automated T1 | Pass, including the exact event order |
| Full test suite | **251 passed, 0 failed** (baseline before this work: 210 passed, 19 failed) |

## 9. Negative and security results (live run)

| Test | Result |
|---|---|
| T2 invalid agent credential | Chat blocked at AGENT TRUST (`agent_identity_failed`: credential signature does not verify). 0 products, checkout refused with HTTP 403 `TRUST_VALIDATION_FAILED`, no order |
| T3 charge $171.47 against $151.47 | Rejected `AMOUNT_EXCEEDS_TOKEN_SCOPE` (17147 > 15147 cents). No charge, no order |
| T3 approval for a different amount | Rejected `CONSENT_DOES_NOT_MATCH_CHECKOUT` before anything was authorized |
| T4 replay a used token | First approved, second rejected `TOKEN_ALREADY_CONSUMED` |
| T5 delivery change, YES | Paused: "Delivery on Saturday, October 10 is no longer available. Nike can deliver on Monday, October 12 instead." YES → order with delivery 2026-10-12 |
| T6 delivery change, NO | "Okay, I cancelled that checkout. Nothing was charged." Token revoked; reusing it fails `TOKEN_REVOKED` |
| T7 card-data boundary | Card number found nowhere in responses or the database |
| T8 search is not consent | After search + selection: no consent, no token, no authorization; only cart evidence |
| T9 Talkshop-guest path | Card added by reference, purchase completes, still a guest to Nike |
| Order list after the live run | Only the two paid orders appear; rejected and cancelled attempts created none |

## 10. Still mocked or simplified

- **A2A** calls are in-process. The HTTP A2A endpoint exists but the chat doesn't use it.
- **Agent credential** is signed with a demo HMAC key, not a PKI or a published platform key. The merchant's agent registry is a static list.
- **Merchant membership** list is empty, so every customer is a Nike guest. The member case is not demonstrated.
- **AP2** mandates use a demo HMAC signature, not SD-JWT, and are stored server-side.
- **ACP** token is ACP-style, not Stripe's Shared Payment Token wire format.
- **Card processor** is a mock; tokenization happens on our server, standing in for a processor's hosted field.
- **Delivery change, trust failure and tampering** are triggered by a demo scenario switch, not by real merchant systems.
- **Single process.** Customer side and merchant side run in one backend; their keys and data are separated by module, not by network.
- The generic protocol path (`/api/generic/stream`) was left unchanged.

## 11. Wording for the client demo

- **Overall:** "This is a working POC of agent-to-agent commerce. It follows the roles and sequence of A2A, UCP, AP2 and ACP, without claiming formal compliance with their wire formats."
- **Guest:** "You're signed in to your own assistant. Nike doesn't know you — you check out as a guest with Nike, and Nike only sees a pseudonymous customer reference."
- **A2A:** "A2A-style message and task interaction between your agent and Nike's agent. In this POC the agents run in the same process."
- **Agent trust:** "Before any checkout, Nike verifies your agent's identity, platform, delegation and scope with deterministic checks. The signature is a demo key, not production PKI."
- **UCP:** "UCP-style catalog and checkout. Nike's catalog and checkout are the source of truth for price, stock and delivery."
- **Consent:** "Searching and picking a product never authorizes payment. GO AHEAD authorizes this exact checkout and amount — nothing else."
- **AP2:** "AP2-style authorization evidence, created only after GO AHEAD and bound to the checkout hash."
- **ACP:** "An ACP-style scoped, single-use payment token is the only payment credential that reaches Nike. The agent never sees the card."
- **DPAT:** "Behind that, our payment service maps the authorization to an internal single-use enforcement token and runs 12 deterministic checks before the mock processor charges. DPAT is our internal mechanism, not an industry protocol."
- **Change of terms:** "If Nike changes something material, like the delivery date, payment pauses and you decide again."
- **Don't say:** "fully compliant", "live A2A network call", "production payment", or "DPAT protocol".
