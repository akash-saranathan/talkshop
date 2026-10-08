# Final Demo Polish Plan

**Status: PLANNING ONLY. No application code, config, or UI has been changed as part of this document. Execute exactly one phase at a time, in order, with explicit approval between phases.**

This replaces the previous contents of this file (an implementation checklist for the now-complete `v3-generic-agent` branch — see "Superseded content" note at the very bottom). The branch has moved far past that doc: there is now a real SQLite-backed auth system, a trust/consent layer, AP2/ACP mandate signing, a mock PSP, loyalty points, and a Live Trace + Agent Pipeline dual panel. This plan audits the *current* code (verified by direct inspection on 2026-10-07, branch `Kaajal-demo-2-countdown-and-live-trace-guide`), not the older design docs (`generic_cb.md`, `demo2_orchestration_plan.md`), which have already drifted in places (noted below).

---

## 1. Current Architecture Audit

### What exists today

**Auth**: Real SQLite DB (`backend/db/commerce.db`, SQLAlchemy ORM, `backend/db/schema.py`). `User` table has `user_id, name, email, password_hash, status, is_guest, created_at`. A seeded demo account already exists: `USR001 / demo@talkshop.io / demo1234` (`backend/db/init_db.py:64-77`), with a seeded `Wallet` and `LoyaltyPoints` row. `POST /api/auth/login`, `/register`, `/guest`, `GET /api/auth/me`. JWT stored in `localStorage`, attached via `Authorization` header (fetch) or `?token=` query param (SSE). `frontend/src/App.tsx` wraps every route except `/login` in `RequireAuth`, which redirects to `/login` if no valid session — **this is the login page we need to remove in Phase 1.**

**Identity/profile**: No distinct "profile" entity (no shipping address field anywhere in the schema — `Checkout.tsx`'s "shipping" is a flat fee, not an address). The closest thing to a profile is the `User` row (name/email) plus two global 1:1 tables: `Wallet` (mock balance) and `LoyaltyPoints` (balance/lifetime), both keyed **only by `user_id`** — i.e. today there is exactly one wallet and one loyalty balance per account, shared across all 6 merchants. `SavedPaymentMethod` is likewise keyed only by `user_id` — a card saved once is available to every merchant.

**Merchant-customer relationship — important discovery**: a merchant-scoped relationship concept **already exists** in the A2A trust layer, just not wired to loyalty/payment data yet:
- `backend/trust/models.py` distinguishes `talkshop_account` ("authenticated" | "talkshop_guest" — does Talkshop know this person) from `merchant_relationship` ("merchant_guest" | "merchant_member" — does *the merchant* know this person).
- `backend/trust/verifier.py:21-27` — `MERCHANT_MEMBERS: dict[str, set[str]]`, keyed by `merchant_id` → set of pseudonymous `customer_ref`s. **Currently empty** ("every Talkshop customer is a guest to Nike" — comment on line 22), so every merchant relationship resolves to `merchant_guest` today.
- `customer_ref` (`backend/trust/credentials.py`) is a stable per-user pseudonymous hash, deliberately decoupled from the real `user_id` so merchants never see Talkshop's internal identity — this is exactly the key a per-merchant loyalty/payment lookup should use.
- `TrustedAgentSession` (`backend/db/schema.py:165-183`) already persists `customer_ref` and `merchant_relationship` per `(session_id, merchant_id)`.

This means Phase 2 is not "invent a new concept," it's "turn on and extend a dormant one" — populate `MERCHANT_MEMBERS`, and add a `merchant_id` column to `LoyaltyPoints` and `SavedPaymentMethod` so they key off `(user_id, merchant_id)` instead of `user_id` alone.

**Payment**: Card entry is real but has a boundary gap — `InlineCheckout.tsx`'s `CardModal` collects raw PAN/expiry/CVC and **POSTs it in plaintext JSON to `POST /api/psp/tokenize`** (`backend/routers/purchase.py`). The backend immediately discards PAN/CVC after Luhn-validating and storing only `brand/last4/exp_month/exp_year` — it's never logged, stored, or put in a trace event — but the raw data *does* cross the network to the backend today, which contradicts the UI's own copy implying it never leaves the browser. This is the concrete gap Phase 3 needs to close. Charging is fully mocked (`backend/payment/mock_processor.py`, reads a JSON wallet file, deterministic declines). There is already a **dead-code client-side tokenizer** (`frontend/src/utils/mockTokenizer.ts`) built for an older, now-unrouted demo page (`GenericChat.tsx`) that does real client-side-only tokenization — reusing/adapting it is the cleanest way to close the gap without new architecture.

**Loyalty**: Real and wired end-to-end (`backend/db/schema.py` `LoyaltyPoints`/`LoyaltyTransaction`, `backend/orders/service.py` earns 1 pt/$1 on order confirm, `backend/routers/loyalty.py` read API, shown in `Chat.tsx` and `InlineCheckout.tsx`) but **global per user, not merchant-scoped**, and **there is no redemption logic at all** — grep for `redeem`/`spend_points` returns zero code hits.

**Checkout/payment sequence** (`backend/purchase/service.py`): `create_proposal()` (trust check → build checkout via `cartup.build_checkout`, labeled "UCP" in the trace → store `MerchantCheckout` → sign AP2 Cart Mandate) → user clicks/auto-triggers GO AHEAD → `go_ahead()` (records `consent_mode: "click"|"auto_countdown"`) → `_authorize_and_execute()` (sign AP2 Payment Mandate → issue ACP-style delegated token via `backend/acp/delegated.py` → map to an internal DPAT token → `payit.execute_payment` runs 12 deterministic guardrail checks → mock charge) → `orders/service.confirm_paid_order()` (creates order, earns loyalty). AP2 and the ACP-style token are **always both** issued for every purchase today — there is no guest-vs-member branch.

**Protocols — real vs. cosmetic** (this matters for Section 5 and for not overstating anything in the demo):
| Protocol | Status |
|---|---|
| **A2A** | Real JSON-RPC HTTP Agent Card server exists (`backend/routers/a2a.py`, `backend/a2a/merchants/*`) but the *live* discovery flow never calls it over HTTP — `backend/graph/workflow.py`'s `_run_a2a_sidecar` calls `merchant_catalog.search_agent_checked(...)` as a plain in-process Python function and emits `"A2A"`-labeled trace events around it. The HTTP server is reachable and spec-shaped but dead code from the live path's point of view. *(This matches the already-known pending item in memory: "real HTTP A2A calls vs in-process.")* |
| **UCP** | Cosmetic/label-only in the live path — "UCP" is a trace-event label wrapping `cartup.build_checkout()`, an ordinary in-process function. The formal `backend/ucp/adapter.py` class exists but is unused by the live flow (only referenced by an unrouted generic-agent page and tests). |
| **ACP** | Genuinely implemented — `backend/acp/delegated.py` issues/verifies a deterministic scoped token bound to merchant/checkout/hash/amount/currency/expiry, single-use. Real logic, mock cryptosuite (HMAC-SHA256, not asymmetric signing). |
| **AP2** | Genuinely implemented — `backend/ap2/adapter.py` builds and signs real Verifiable-Credential-shaped Intent/Cart/Payment mandates with hash-chained linkage, and verification actually gates the flow. Real logic, mock key material (HMAC, comment notes production would use ECDSA-P256/HSM). |
| **Trust layer** (not one of the 4 named protocols, but central to the demo) | Real — HMAC signature check, registered-agent check, expiry, scope/merchant/amount checks; genuinely rejects a tampered credential. |
| **Guardrails** | Real deterministic checks (PII/length/control-char regex, agent-claim-vs-catalog check, 12-point payment guardrail engine) layered with one real NeMo Guardrails + one Gemini classification call for off-topic/credential-request detection. |

**MCP**: real `fastmcp` tool definitions exist (`backend/mcp/server.py`) but are only ever called as in-process Python functions (`backend/agents/cartup.py`, `sneakpeek.py`) — the MCP transport itself is never served or used. Legacy scaffolding, not a live protocol boundary.

**Timers**: `AUTO_SECONDS = 10` (`frontend/src/pages/Chat.tsx:167`). Two independent visible countdowns, both frontend-only (no backend delay exists anywhere — grepped, zero `asyncio.sleep`/`time.sleep` outside tests): (1) a "Checkout in Ns" bar after items are added to cart, which auto-advances to the order proposal; (2) an "Auto GO AHEAD in Ns" bar on the order proposal, which auto-submits payment via the identical code path a manual click uses (differing only in a `consent_mode` tag). Both use a shared `AutoStepBar` component with Pause/Resume. **Important regression risk for Phase 8**: Pause/Resume is the mechanism a live presenter currently uses to control demo pacing — removing the visible countdown removes this control surface unless replaced.

**Live Trace panel**: `frontend/src/components/ProtocolTracePanel.tsx` — still current despite a stale filename in `demo2_orchestration_plan.md` (which names `AgentTrailPanel.tsx`; that component still exists but now serves a separate "Agent Pipeline" tab). **The Pipeline/Trace toggle noted as a pending item in memory already exists** — `Chat.tsx:2218-2269` has a tab switcher between "Live Trace" (`ProtocolTracePanel`) and "Agent Pipeline" (`AgentTrailPanel`). *(Memory should be updated to drop this as a pending gap — see note at the end of this document.)* One real structural wrinkle: discovery-phase trace events arrive over SSE, but purchase-phase trace events (GO AHEAD → AP2 → ACP → DPAT → PSP → order) arrive as a plain JSON response body and are merged into the same client-side array — worth knowing before touching this component, not necessarily worth fixing in this pass.

**Scrolling**: Consistent flex + `min-h-0` + `overflow-y-auto` pattern throughout (`Chat.tsx`, `ProtocolTracePanel.tsx`, `CartDrawer.tsx`, `AgentTrailPanel.tsx`, `GenericChat.tsx`, modals). No fixed-pixel heights or `100vh` literals found anywhere. Structurally this is the *correct* Tailwind pattern, but it's fragile — any ancestor missing `min-h-0` silently breaks a descendant's scroll. The static audit didn't find an obviously broken container; Phase 7 should be a **runtime** audit (actually open each screen and scroll) rather than a redesign.

### What must be preserved

- The SQLite auth/session plumbing, JWT mechanism, and `CurrentUser` dependency — Phase 1 removes the *login screen*, not the auth system.
- The trust layer, AP2/ACP mandate signing, guardrail engine, and redaction (`backend/observability/redact.py`) — these are real and already enforce the "no sensitive data in the trace" requirement for everything *except* the raw tokenize POST (Phase 3's actual gap).
- The dual Live Trace / Agent Pipeline panel structure, the GO AHEAD consent recording (`consent_mode`), and the existing demo scenario machinery (bad-agent-credential, declined-card, etc.) referenced in `backend/trust/credentials.py` and `mock_processor.py`.
- All 6 merchant catalogs, the chat UI, Cart/Checkout pages, and the generic-agent adapter code (unrouted but not to be deleted — out of scope for this pass).

---

## 2. Target Experience

- App opens directly into the chat. No `/login` screen, no "Continue as Guest" button, no blocking auth check on first paint.
- Behind the scenes, the app is still authenticated as a real, persistent demo user — we reuse the already-seeded `demo@talkshop.io` account rather than inventing a new identity mechanism. The JWT/session plumbing stays; only the *gate* in front of it is removed.
- "Are you a customer here?" is answered per-merchant, not once globally. Nike remembers the demo user (saved card, loyalty balance); Adidas doesn't (clean secure-entry flow, zero points) — using the *same* backend identity, scoped differently per merchant.
- Card data and PayPal-style auth never visibly touch the chat, the agent trace, or the LLM — and, after Phase 3, never touch the backend in raw form either.
- Loyalty points are earned and spent per merchant and are invisible until relevant: the agent decides how to pay (points / points+card / card) automatically, honoring a backend-configured reward preference, with zero extra clicks.
- No visible countdown numbers anywhere; the demo still "auto-advances" at a believable pace (2-3s) via a processing/spinner state instead of a ticking clock.
- Error and status copy names the actual relationship that failed (user ↔ merchant ↔ payment), not generic strings.

---

## 3. Identity & Merchant Relationship Model

### Demo user/profile
- Single persistent identity: the existing seeded `USR001 / demo@talkshop.io` account. No new user-creation mechanism needed.
- Add the profile fields the plan calls for (name, shipping address, preferences) to this one row/related table — today there is no shipping-address field anywhere, so this is a genuinely new, small addition, not a relocation of existing data.
- This profile is global to the demo user (one name, one address) — it is *not* duplicated per merchant. What *is* per-merchant is the relationship data below.

### Merchant relationship (per `user_id` × `merchant_id`)
Extend the existing-but-inert trust-layer concept instead of inventing a parallel one:
- Populate `MERCHANT_MEMBERS` (`backend/trust/verifier.py`) for the demo: the Talkshop demo user's `customer_ref` is a member at Nike and Zara, a guest at Adidas/H&M/Fossil/Casio (exact roster finalized in Phase 2/12).
- Add a `merchant_id` column to `LoyaltyPoints` and `SavedPaymentMethod` (today keyed only by `user_id`), changing their uniqueness constraint to `(user_id, merchant_id)`. This is the one real schema change in this plan's identity work.
- A merchant's `merchant_member` status drives three things read at checkout time: (a) does a saved payment method exist for this merchant, (b) what is this merchant's loyalty balance, (c) does the merchant already have the fulfillment details it needs, or does it need to ask (secure form) for anything.
- `merchant_guest` does not create a "chatbot account" — it simply means no saved method/points exist for that merchant_id yet; the secure payment surface (Phase 3) handles that merchant inline, scoped to that one purchase, without a registration step.

### What the Shopping Agent is allowed to know vs. not
- The Shopping Agent (LLM-driven) knows: which merchant, whether the trust layer marked this a `merchant_member` or `merchant_guest` relationship (a label, not payment data), the loyalty balance *amount* (a number, not an instrument), and the final authorized charge amount.
- The Shopping Agent never knows: card numbers, CVC, the content of the secure payment form, or PayPal-style credentials. It only ever receives an opaque payment-method reference (`payment_method_id`) and a yes/no authorization result — this boundary already exists for the LLM/agent code paths (`greenlight.py`, `payit.py` docstrings are explicit about this) and must hold for every new merchant-scoped path too.

---

## 4. Security / Payment Data Boundary

### Current state (verified)
- Card data from `InlineCheckout.tsx`'s `CardModal` is POSTed as **plaintext JSON** to `POST /api/psp/tokenize`. It is Luhn-validated and immediately discarded server-side — never logged, stored beyond `brand/last4/exp`, or placed in any trace event — but it does cross the network to the FastAPI backend today. This is the one real gap versus the "never leaves the browser" goal.
- `backend/observability/redact.py` already strips card-like fields/number-patterns from every protocol trace event before it's queued or returned — belt-and-suspenders, since card data was never intentionally put in an event to begin with.
- No LLM call site (`backend/agents/*`) ever receives PAN/CVC/PayPal credentials — confirmed by reading `greenlight.py`/`payit.py`, which explicitly document "no LLM anywhere in this path."

### Target trust boundary
```
Browser (secure payment surface)
   │  raw PAN / CVC / expiry — NEVER crosses this line
   ▼
[Client-side tokenizer]  →  opaque payment_method_id / token
   │
   ▼
Backend (purchase/service.py, payment/methods.py)
   │  only: payment_method_id, brand, last4, exp, authorization result
   ▼
Shopping Agent / Gemini / A2A messages / protocol trace / chat history / logs
```
- Close the current gap by reviving the existing (currently dead-code) `frontend/src/utils/mockTokenizer.ts` pattern for the live `CardModal`: tokenize client-side, send only `{token, brand, last4, exp_month, exp_year}` to the backend. This is reuse of code already in the repo, not a new subsystem.
- The secure payment surface (modal) should visually and structurally separate itself from the chat: a distinct bordered panel, a lock/shield trust indicator, masked PAN after entry (show digits while typing, mask all but last 4 after), masked CVC (dots, optional reveal toggle), clear Cancel/Close, clear success/failure state — standard patterns confirmed by Stripe's and Basis Theory's published payment-form guidance (see Section 6 sources).
- **PayPal-style "Connect" flow — POC design, explicitly not a real integration**: real PayPal/Braintree Connect is an OAuth redirect — merchant app sends the user to PayPal, PayPal redirects back with `?code=...&state=...`, and the app exchanges the code server-side for an access token scoped to that merchant relationship. The POC should mimic this *shape* without a real PayPal app: a modal that shows a believable "Redirecting to PayPal..." → mocked consent screen → returns a fake authorization reference (e.g. `pp_auth_<random>`), which the backend treats exactly like any other `payment_method_id`. Document this explicitly in-UI or in code comments as mocked, so nobody mistakes it for a real integration later.
- Decision to record for Phase 3: do we keep a `/api/psp/tokenize` endpoint at all once tokenization is client-side? Recommendation: keep a backend endpoint only for *registering* an already-tokenized method (brand/last4/exp + token) against a `(user_id, merchant_id)` pair — never for receiving raw card fields.

---

## 5. Protocol Impact

No new protocol labels are being added anywhere in this plan — only real behavior changes, mapped against the table in Section 1.

| Flow | A2A | UCP | ACP | AP2 | Loyalty |
|---|---|---|---|---|---|
| **Customer flow** (merchant_member, saved method exists) | unchanged (in-process, labeled) | unchanged (cosmetic label on `cartup.build_checkout`) | real token issued, bound to the *post-redemption* remaining amount | real mandates signed over the *post-redemption* remaining amount | reads merchant-scoped balance, applies redemption policy, writes a `LoyaltyTransaction` — **not** a protocol message |
| **Non-customer flow** (merchant_guest, no saved method) | unchanged | unchanged | real token issued once secure-entry/PayPal-mock produces a `payment_method_id` | real mandates signed the same way — AP2/ACP do not currently branch on guest vs. member, and this plan does not introduce such a branch | balance is 0, redemption policy yields "use payment method only" |
| **Loyalty redemption** | not involved | checkout *total* (UCP-style) is unchanged — it reflects true order cost | the amount **bound into the ACP token** is the remaining-after-redemption amount | the amount **signed into the AP2 Payment Mandate** is the remaining-after-redemption amount; the AP2 Cart Mandate still reflects full order cost | the actual decision layer — see Phase 5 |

Explicitly: loyalty is not AP2/ACP/UCP/A2A. It is a merchant-side ledger decision that determines one number — the remaining amount to authorize — which AP2/ACP then carry exactly as they do today. No existing protocol adapter code changes shape; only the `amount` value fed into `AP2Adapter.create_payment_mandate()` and `acp/delegated.issue()` changes, in `purchase/service.py`.

Guardrails are unaffected structurally — the 12-point payment guardrail engine already checks amount-vs-checkout-total; it will simply be checking against the post-redemption amount instead of the full cart total, which is exactly what it's designed to do.

This plan does **not** change A2A from in-process-styled to real HTTP, and does not change UCP from a cosmetic label to a real adapter invocation — both remain known, documented gaps (consistent with the existing memory note), out of scope for "final polish," and listed again under Recommendations (Section 10) as a future, separate, larger piece of work.

---

## 6. UX / Visual Research

### Chase — "Shop Through Chase" / "The Shops at Chase" (researched; no branding to be copied)
Two distinct Chase experiences exist and both inform this plan differently:
- **Shop Through Chase** (the older portal, part of Ultimate Rewards): a pass-through portal — you still shop on the retailer's real site, Chase just tracks the referral for bonus points. Relevant lesson: *don't fight the merchant's own product experience* — our chat-embedded `InlineCheckout` already does this correctly (we don't try to re-skin each merchant's product pages).
- **The Shops at Chase** (launched 2025, curated marketplace): cardholders check out "using their cards, Chase Ultimate Rewards points, or both," with **shipping information pre-filled** and product recommendations based on cardmember interest. This is the direct UX precedent for Phase 5 (zero-click, policy-driven points usage) and for pre-filling the demo user's profile (Section 3) at checkout instead of asking for it again.

Design principles to extract (not to clone):
1. **Points and card are presented as one coherent payment composition**, not a separate screen or toggle — reinforces the "automatic, no extra click" requirement already specified for Phase 5.
2. **Shipping/profile information is pre-filled** and shown as a confirmable summary line, not a form to re-fill — directly supports Phase 1/3 (persistent demo profile, no re-entry for merchants we're already a customer of).
3. **Financial information (points balance, benefit) is surfaced inline near the product/checkout**, in a small labeled card (e.g. "Nike • Loyalty balance: 1,000 pts"), not buried in a separate account page — informs the loyalty display called for in Section 5 of the original request.
4. **Visual hierarchy favors the transaction**: product image/name largest, price and reward/benefit secondary but visible, fine print (terms) smallest and last.
5. **Consistent card treatment** across product cards and checkout summary cards: subtle border + shadow, rounded corners, generous internal padding, no heavy drop shadows — "financial-grade" reads as restrained, not flashy.

### Secure payment-entry research (Stripe, Basis Theory, Gr4vy — current published guidance, 2025/2026)
- Mask the PAN *after* input (leave visible while typing), always mask CVC (dots, optional reveal), never echo back a full PAN/CVC anywhere, show only last-4 for confirmation.
- `inputmode="numeric"` for PAN/expiry/CVC/ZIP so mobile shows the numeric keypad; detect and show the card brand as the user types; auto-advance between segments but allow backspace to go back.
- A visible "Secure checkout" label or lock icon near the form measurably increases user trust completion.
- Real-time validation (Luhn, expiry, CVC length) reduces downstream decline friction — already partially present in `CardModal`.
- 3D-Secure-style step-up is the real-world analogue for "why does this sometimes need an extra confirmation" — not required for this mock PSP, but worth a one-line mention in the demo narration if asked.

Sources: [The Shops at Chase: What It Is and How It Works](https://www.nerdwallet.com/credit-cards/learn/the-shops-at-chase-how-it-works) · [Announcing The Shops at Chase](https://media.chase.com/news/Announcing-The-Shops-at-Chase) · [Beginner's Guide to the Chase Online Shopping Portal](https://www.chase.com/personal/credit-cards/education/rewards-benefits/beginners-guide-to-chase-online-shopping-portal) · [Payment HTML forms: Best practices for UX, security, and conversion (Stripe)](https://stripe.com/resources/more/payment-html-forms) · [Payments UX best practices (Basis Theory)](https://go.basistheory.com/hubfs/resources/payments-ux-best-practices-basis-theory.pdf) · [Credit card form best practices (Gr4vy)](https://gr4vy.com/posts/credit-card-form-best-practices-the-basics-for-2026/) · [PayPal/Braintree Connect flow (OAuth)](https://developer.paypal.com/braintree/docs/guides/braintree-auth/connect/)

---

## 7. Scroll / Interaction Improvements

The static structure is already correct (flex + `min-h-0` + `overflow-y-auto` consistently, no fixed heights found). The work here is a **verification pass**, not a redesign:
- Open each surface at a few viewport sizes (including the common "laptop + half-height browser" demo setup) and actually scroll: chat message list, `ProtocolTracePanel` (all three internal regions — Story/Live/Flow), `AgentTrailPanel`, `CartDrawer`, `Cart.tsx`/`Checkout.tsx` full pages, `CompareModal`, `ProductDetailModal`, and the new secure-payment modal once it exists.
- Specifically check the one place two different scroll transports feed the same panel (SSE for discovery events, JSON-response events for purchase events in `ProtocolTracePanel`) — confirm the list doesn't jump or lose scroll position when the second source starts appending.
- Any ancestor found missing `min-h-0` gets exactly that one class added — no broader restructuring.

---

## 8. Timer Behavior

- Remove both visible countdown renderings (`AutoStepBar` usages in `Chat.tsx`'s cart-stage bar and in `InlineCheckout.tsx`'s GO AHEAD bar). Replace with a short, silent, **backend-anchored** delay (2-3s) surfaced as a processing/spinner state ("Preparing checkout…", "Authorizing payment…") instead of a number.
- Because no backend delay exists today, this is a real new behavior, not a relocation: add a bounded `await asyncio.sleep(...)` (2-3s, randomized slightly so it doesn't feel robotic) at the point `create_proposal()` would otherwise return instantly, and again before `_authorize_and_execute()` commits — so the "processing" state the frontend shows has something real to wait on.
- Preserve the automatic continuation semantics exactly: the flow still advances without a click after the delay, `consent_mode` is still recorded (rename the auto value from `"auto_countdown"` to something like `"auto_delay"` if we want the trace label to stop implying a countdown — cosmetic, confirm wording in Phase 9).
- **Regression risk to resolve explicitly in this phase**: Pause/Resume on `AutoStepBar` is today's only presenter control over demo pacing. Removing the visible countdown removes this control unless replaced — recommend a small non-countdown "Continue now" affordance (skip the remaining delay) so a live presenter isn't stuck waiting through every 2-3s window during a talk.

---

## 9. Demo Wording Improvements

Current strings are already more specific than the prompt's "Invalid credentials" example suggests (no such literal string exists in the repo), but several can still name the actual relationship more precisely:

| Location | Current | Recommended direction |
|---|---|---|
| `backend/routers/auth.py:70` | `"Incorrect email or password"` | fine as-is — this is Talkshop-account auth, not merchant auth; don't over-explain a simple login failure that no longer has a visible login screen anyway (Phase 1 makes this nearly unreachable in the new flow) |
| `backend/purchase/service.py:126-127` | `"{merchant_name} did not accept the shopping agent for checkout."` | `"{merchant_name} could not verify this shopping agent's credentials, so the checkout could not be authorized."` — names the actual trust-layer failure |
| `backend/payment/guardrail_engine.py:131-132` | `"Requested $X does not match checkout total $Y"` | keep the numbers, add the relationship: `"The amount authorized for payment does not match the checkout total — the order was not charged."` |
| `backend/payment/guardrail_engine.py:138-139` | `"Checkout hash does not match — possible cart tampering detected"` | keep as-is — already specific and accurate |
| `backend/payment/mock_processor.py` declines surfaced via `service.py:456-457` | `"The card processor declined the payment."` | `"{merchant_name}'s payment processor declined this card ({reason}). No charge was made."` — surface the specific decline reason (`NO_ACTIVE_PAYMENT_METHOD`, `CARD_EXPIRED`) in plain language instead of collapsing both into one sentence |
| New (Phase 2/4) | n/a | a non-customer merchant should explain itself the first time, e.g. "Adidas doesn't have a saved payment method or rewards balance for this profile yet — you can pay securely for this order without creating an account." |

General rule going forward: every failure message should be answerable from the sentence alone — *who* (user/merchant), *what relationship* (authentication/authorization/trust/payment/loyalty), and *what didn't happen as a result* (nothing charged, order not placed, etc.) — without being longer than ~2 sentences.

---

## 10. Implementation Phases

Each phase is independently executable and independently demo-able. **Phase 1 goes first.** Do not start a phase until the previous one is approved.

### Phase 1 — Remove login screen
- **Objective**: App opens directly into the chat, authenticated as the persistent demo user, with no visible login UI.
- **Current behavior**: `App.tsx`'s `RequireAuth` redirects to `/login` (`Login.tsx`) whenever no valid JWT is present; the user must log in or click "Continue as Guest."
- **Target behavior**: On first load, the client silently establishes a session as the seeded `demo@talkshop.io` account (no form, no click) and renders the chat. `RequireAuth`'s failure path becomes "auto-establish the demo session" instead of "navigate to `/login`."
- **Files/components likely involved**: `frontend/src/App.tsx`, `frontend/src/auth/AuthContext.tsx`, `frontend/src/pages/Login.tsx` (route removed or kept only as an unlinked fallback), `backend/routers/auth.py` (no new endpoint needed — reuse `/api/auth/login` or add a narrow `/api/auth/demo-session` that returns a token for the fixed seeded account without a password prompt).
- **Backend impact**: Minimal — either call existing login with the known seeded credentials from the client bootstrap, or add one small endpoint that issues a JWT for the fixed demo `user_id` without credential input. No schema change.
- **Frontend impact**: `AuthContext` gains a "bootstrap" path that runs once on app mount; `RequireAuth` no longer renders a redirect for the default case.
- **Data-model impact**: none (reuses existing seeded `User`/`Wallet`/`LoyaltyPoints` rows).
- **Protocol impact**: none.
- **Security considerations**: this is a demo-only shortcut (one fixed account, no real multi-tenant login) — acceptable because the whole app is a single-demo-user POC; flag clearly in code/comments so it's never mistaken for production auth.
- **Demo scenario**: open the app fresh (cleared localStorage) → lands directly in chat, profile menu shows the demo user's name.
- **Acceptance criteria**: no network request to render the first screen fails with a 401/redirect loop; `/login` is unreachable from normal navigation; refreshing mid-conversation keeps the same identity.
- **Regression risks**: the existing "Continue as Guest" throwaway-identity flow and the real `/register` flow become unused by the primary path — decide whether to keep them reachable (e.g. behind a hidden dev route) for completeness, or remove the UI entry points only (keep backend endpoints, since other scripts/tests may use them).

### Phase 2 — Merchant-scoped customer state
- **Objective**: "Customer" becomes a `(user_id, merchant_id)` fact, not a global one.
- **Current behavior**: `Wallet`, `LoyaltyPoints`, `SavedPaymentMethod` are keyed only by `user_id`; `MERCHANT_MEMBERS` in `backend/trust/verifier.py` is empty, so every merchant relationship resolves to `merchant_guest`.
- **Target behavior**: `LoyaltyPoints` and `SavedPaymentMethod` are keyed by `(user_id, merchant_id)`; `MERCHANT_MEMBERS` (or a proper DB-backed replacement table) marks the demo user as a member at Nike (and optionally Zara) and a guest everywhere else, matching Section 12's scenario roster.
- **Files/components likely involved**: `backend/db/schema.py` (`LoyaltyPoints`, `SavedPaymentMethod` composite key), `backend/db/init_db.py` (seed data per merchant), `backend/trust/verifier.py` (`MERCHANT_MEMBERS` → real seeded data, ideally backed by the same DB rather than an in-memory dict), `backend/payment/methods.py`, `backend/routers/loyalty.py`.
- **Backend impact**: schema migration (additive column + uniqueness constraint change), seed-data update, every read of loyalty/saved-method gains a `merchant_id` parameter.
- **Frontend impact**: wherever loyalty balance or saved card is fetched/displayed, pass/show the current merchant context instead of a single global value.
- **Data-model impact**: the one real schema change in this entire plan.
- **Protocol impact**: none directly — this is pure identity/data-model work feeding Phases 4/5.
- **Security considerations**: `customer_ref` (not raw `user_id`) remains the key the merchant-trust layer reasons about — preserve that indirection.
- **Demo scenario**: switching from a Nike product to an Adidas product in the same conversation shows different loyalty balances and different (absent) saved-method state.
- **Acceptance criteria**: querying loyalty/saved-method for Nike and Adidas in the same session returns independently correct, non-shared data.
- **Regression risks**: any existing code that assumes one global `LoyaltyPoints`/`SavedPaymentMethod` row per user (grep before changing) must be updated in the same phase or it will silently break on the new composite key.

### Phase 3 — Secure payment boundary
- **Objective**: Close the one real gap found in Section 4 — raw card data stops crossing the network in plaintext; add the PayPal-style mock connect flow.
- **Current behavior**: `CardModal` POSTs raw `{number, exp_month, exp_year, cvc}` to `/api/psp/tokenize`; backend discards after validating. No PayPal-style option exists.
- **Target behavior**: Client-side tokenization (reviving the existing `mockTokenizer.ts` pattern) — only `{token, brand, last4, exp}` ever reaches the backend. A new "Connect PayPal" option in the same modal mocks an OAuth-style redirect/consent/return, producing an opaque `payment_method_id` the backend treats identically to a card token.
- **Files/components likely involved**: `frontend/src/components/InlineCheckout.tsx` (`CardModal`), `frontend/src/utils/mockTokenizer.ts` (revive/adapt), `backend/routers/purchase.py` (`/api/psp/tokenize` → accepts a pre-tokenized payload, or is replaced by a "register method" endpoint), `backend/payment/methods.py`.
- **Backend impact**: the tokenize endpoint's contract changes (no longer accepts raw PAN/CVC fields at all); add a mocked PayPal-connect endpoint that returns a fake `pp_auth_<id>` reference.
- **Frontend impact**: new secure-modal visual treatment (Section 6 principles: lock icon, masked fields, distinct bordered surface, clear cancel/success/failure states); new "Connect PayPal" entry point alongside the card form.
- **Data-model impact**: `SavedPaymentMethod` gains a `provider` discriminator (`card` | `paypal_mock`) if not already generalized enough.
- **Protocol impact**: none — this is entirely pre-protocol, inside the trust boundary described in Section 4.
- **Security considerations**: this is the phase where the "card details must never pass through Shopping Agent / Gemini / A2A / trace / LLM / logs" requirement becomes fully true end-to-end, not just true for everything after tokenization.
- **Demo scenario**: entering a card never produces a network request containing the full PAN; cancelling the secure modal returns cleanly to the conversation with no partial state.
- **Acceptance criteria**: grep/network-tab inspection shows zero raw PAN/CVC bytes leaving the browser; PayPal-mock path reaches a working `payment_method_id` without any real external call.
- **Regression risks**: `CardModal`'s existing client-side Luhn/expiry validation must be preserved when moving tokenization logic; make sure `methods.tokenize_card`'s current discard-only behavior isn't quietly replaced by something that still expects raw fields.

### Phase 4 — Merchant-specific loyalty (data + display)
- **Objective**: Loyalty balance is per-merchant, visible for the merchant currently involved in the conversation.
- **Current behavior**: one global balance earned at 1pt/$1, shown in `Chat.tsx`'s profile menu and `InlineCheckout.tsx`'s earn line.
- **Target behavior**: balance and earn line are scoped to the current merchant (depends on Phase 2's schema change).
- **Files/components likely involved**: `backend/routers/loyalty.py` (merchant-scoped query param), `backend/orders/service.py` (`confirm_paid_order` earns into the right `(user_id, merchant_id)` row), `frontend/src/pages/Chat.tsx`, `frontend/src/components/InlineCheckout.tsx`.
- **Backend impact**: straightforward once Phase 2's schema is in place.
- **Frontend impact**: display string becomes "{Merchant} • Loyalty balance: N pts" instead of a bare number.
- **Data-model impact**: none beyond Phase 2.
- **Protocol impact**: none — confirmed in Section 5, loyalty is not a protocol.
- **Security considerations**: none new.
- **Demo scenario**: Nike purchase increases Nike's balance only; Adidas balance stays 0.
- **Acceptance criteria**: balance shown always matches the merchant of the product currently in the conversation/checkout.
- **Regression risks**: any cached/stale balance shown in the UI before a merchant is known (e.g. at the very start of a conversation) needs a sensible empty state, not a leftover global number.

### Phase 5 — Loyalty redemption (zero-click, policy-driven)
- **Objective**: The agent automatically decides the payment composition (points / points+card / card) within a backend-configured policy, with no separate "pay with points" UI step.
- **Current behavior**: no redemption logic exists at all.
- **Target behavior**: a new deterministic policy function, e.g. `backend/payment/loyalty_policy.py: decide_redemption(user_id, merchant_id, order_total, preference) -> RedemptionDecision{points_redeemed, value_redeemed, remaining_amount}`, called inside `create_proposal()` right after the checkout total is known and *before* the AP2 Cart Mandate's companion Payment Mandate amount is fixed. The demo user has one backend-configured preference, e.g. `maximize_points_usage`, applied automatically:
  - **Scenario A** (Nike, 1,000 pts, $80 order, 100 pts = $1 or whatever conversion the current code implies once checked — if none exists yet, define 100 pts = $1 as the demo rate): fully covered by points, no card touched, continue automatically.
  - **Scenario B** (Nike, 300 pts, $80 order): redeem all 300 eligible points, charge the remaining amount to Nike's saved payment method, continue automatically.
  - **Scenario C** (no usable balance): skip redemption, charge the payment method in full, continue automatically.
  - A natural-language override ("use my Nike points") is parsed as a one-off preference for that turn, not a new UI control.
- **Files/components likely involved**: `backend/payment/loyalty_policy.py` (new, small), `backend/purchase/service.py` (`create_proposal`/`_authorize_and_execute` — feed `remaining_amount` into the AP2 Payment Mandate and the ACP token instead of the full cart total), `backend/db/schema.py` (`LoyaltyTransaction` gains a `reason="redemption"` row), `backend/routers/loyalty.py`, `frontend/src/components/InlineCheckout.tsx` (display only — subtotal / points redeemed / remaining amount / method used / final charge).
- **Backend impact**: new policy function; `purchase/service.py`'s amount-computation step changes from "amount = cart total" to "amount = cart total − redemption value"; `LoyaltyTransaction` gets a redemption-reason row at the same point `confirm_paid_order` already writes an earn-reason row.
- **Frontend impact**: checkout summary gains four read-only lines (merchant points available, points redeemed, remaining amount, method charged) — no new buttons.
- **Data-model impact**: `LoyaltyTransaction.reason` already supports multiple reasons (`"purchase"` exists) — add `"redemption"`; add a `reward_preference` field somewhere on the demo user record (or a small config constant, since there's only one demo user).
- **Protocol impact**: exactly as described in Section 5 — the AP2 Payment Mandate and ACP token are signed/bound to the post-redemption amount; the guardrail engine's amount-vs-checkout-total check now compares against that same post-redemption figure, which it already does generically.
- **Security considerations**: redemption must be computed and committed atomically with the payment authorization — a declined payment must not have already debited points. Ensure the redemption debit happens only inside the same transaction/step that confirms a successful charge (mirror how `confirm_paid_order` already only earns points on success).
- **Demo scenario**: run Scenario A/B/C above back to back in one conversation (switch merchants) with no extra click beyond selecting the product and the existing (soon-to-be-silent) GO AHEAD step.
- **Acceptance criteria**: the checkout trace always shows all four required lines even when redemption is zero; redeemed points are deducted exactly once per completed order and never on a declined/cancelled one.
- **Regression risks**: existing earn-on-purchase logic (`confirm_paid_order`) must not double-count or conflict with a same-order redemption debit; the 12-point payment guardrail engine's amount check must be updated in the same phase or it will reject every redemption-adjusted payment as a "mismatch."

### Phase 6 — Chase-inspired visual polish
- **Objective**: Apply the Section 6 design principles (pre-filled profile summary, inline points/benefit cards, restrained card/shadow treatment, clear hierarchy) without cloning Chase branding.
- **Current behavior**: functional but not yet "financial-commerce-grade" — loyalty shown as a bare number, checkout fields not consistently pre-filled.
- **Target behavior**: checkout shows a pre-filled, confirmable shipping/profile summary (enabled by Phase 1/3's persistent profile); loyalty/benefit info appears as a small labeled card near the product/checkout, not a separate page; consistent border/shadow/spacing treatment across product cards and checkout summary cards.
- **Files/components likely involved**: `frontend/src/components/InlineCheckout.tsx`, `frontend/src/pages/Cart.tsx`, `frontend/src/pages/Checkout.tsx`, `frontend/src/index.css` (shared card/spacing tokens).
- **Backend impact**: none beyond already-available data (profile, loyalty, saved method).
- **Frontend impact**: the bulk of this phase's work — styling and layout only, no new data flows.
- **Data-model impact**: none.
- **Protocol impact**: none.
- **Security considerations**: none new — ensure the visual polish on the secure-payment modal (Phase 3) doesn't accidentally reintroduce a "feels like chat" look that undermines its separateness.
- **Demo scenario**: side-by-side before/after of the checkout summary card.
- **Acceptance criteria**: no functional behavior changes; only visual/layout.
- **Regression risks**: low — mostly CSS/layout; re-check scrolling (Phase 7 should probably run after this, or be re-verified after) since spacing changes can shift overflow behavior.

### Phase 7 — Scroll behavior
- **Objective**: Predictable, smooth scrolling everywhere, verified at runtime.
- **Current behavior**: structurally correct (Section 1/7 audit) but unverified at runtime; two scroll transports merge into one trace panel.
- **Target behavior**: every documented scroll region (Section 7 list) behaves correctly at common viewport sizes; the dual-source trace panel doesn't jump when the second (purchase) event source starts appending.
- **Files/components likely involved**: whichever specific component(s) fail the manual check — expected to be none or very few, based on the static audit.
- **Backend impact**: none.
- **Frontend impact**: targeted `min-h-0` fixes only where the manual check finds a real break; no broad restructuring.
- **Data-model impact**: none.
- **Protocol impact**: none.
- **Security considerations**: none.
- **Demo scenario**: run through every screen (chat, trace panel tabs, cart, checkout, secure-payment modal, compare modal) at a reduced browser height and confirm no clipped/non-scrolling content.
- **Acceptance criteria**: no screen requires a window resize to reach otherwise-hidden content.
- **Regression risks**: minimal, given the narrow fix scope.

### Phase 8 — Timer behavior
- **Objective**: No visible countdown numbers; automatic behavior preserved via a short backend-anchored delay.
- **Current behavior**: two 10s visible frontend countdowns (`AutoStepBar`), no backend delay at all.
- **Target behavior**: both countdowns replaced by a 2-3s backend delay with a processing/spinner UI state; automatic continuation preserved; a non-countdown presenter control (e.g. "Continue now") replaces the lost Pause/Resume pacing control.
- **Files/components likely involved**: `frontend/src/pages/Chat.tsx` (remove `autoTimer`/tick loop, add processing state), `frontend/src/components/AutoStepBar.tsx` (replace or repurpose as a static "Processing…" indicator), `frontend/src/components/InlineCheckout.tsx`, `backend/purchase/service.py` (`create_proposal`, `_authorize_and_execute` — add bounded `asyncio.sleep`).
- **Backend impact**: new, genuine 2-3s delays at two points in the purchase flow (today there are none).
- **Frontend impact**: remove countdown rendering/state; add a simple processing indicator; add the presenter "Continue now" control.
- **Data-model impact**: none; optionally rename `consent_mode` value `"auto_countdown"` → `"auto_delay"` for trace-label accuracy (confirm wording with Phase 9).
- **Protocol impact**: none — `consent_mode` recording and the trace events it drives are unchanged in structure.
- **Security considerations**: none.
- **Demo scenario**: add to cart → no visible number, short pause, proposal appears; let it sit → no visible number, short pause, order completes.
- **Acceptance criteria**: no countdown digits/progress bar tied to seconds anywhere in the UI; total added latency per step stays in the 2-3s target; a presenter can still skip ahead without waiting.
- **Regression risks**: this is the phase most likely to need live rehearsal — confirm the new pacing still "reads" as agentic/automatic during an actual demo run-through, not just in isolation.

### Phase 9 — Demo/error wording
- **Objective**: Every surfaced message explains the actual user/merchant/payment/loyalty relationship that succeeded or failed (Section 9 table).
- **Current behavior**: generally already reasonable; a few spots collapse specific failure reasons into a generic sentence.
- **Target behavior**: apply the Section 9 table's recommended strings; add the new non-customer-merchant explanatory line from Phase 2/3.
- **Files/components likely involved**: `backend/purchase/service.py`, `backend/payment/guardrail_engine.py`, `backend/payment/mock_processor.py`/`service.py:456-457`, new copy in `InlineCheckout.tsx` for the non-customer explanatory line.
- **Backend impact**: string changes only, no logic changes.
- **Frontend impact**: string changes only.
- **Data-model impact**: none.
- **Protocol impact**: none.
- **Security considerations**: ensure improved error detail never leaks anything about *why* a trust/guardrail check failed in a way that would help someone craft a bypass (keep detail to "what relationship failed," not "which specific check number tripped").
- **Demo scenario**: trigger each of the 7 demo scenarios in Section 12 and confirm the message is self-explanatory.
- **Acceptance criteria**: no message requires the presenter to verbally explain what actually happened.
- **Regression risks**: none functional; low risk.

### Phase 10 — Final protocol regression audit
- **Objective**: Confirm nothing in Phases 1-9 accidentally changed the real-vs-cosmetic protocol boundaries documented in Section 1/5, and that the full customer and non-customer flows still work end-to-end.
- **Current behavior**: n/a — this is a verification phase.
- **Target behavior**: run both full flows (Scenario 1 and Scenario 2 from Section 12) end-to-end, confirm the Live Trace panel still shows accurate A2A/UCP/ACP/AP2 events, confirm redaction still holds with the new secure-payment and loyalty-redemption data in play.
- **Files/components likely involved**: none new — this is testing/inspection only, using `tests/test_phase2_protocols.py` as a baseline and extending manual QA.
- **Backend impact**: none (unless the audit finds a regression, which gets its own fix, not folded into this phase).
- **Frontend impact**: none.
- **Data-model impact**: none.
- **Protocol impact**: verification that Section 5's table still holds.
- **Security considerations**: re-confirm no raw PAN/CVC/PayPal credential ever appears in a trace event, log line, or LLM-bound prompt, across every new path added by Phases 2-5.
- **Demo scenario**: all 7 scenarios in Section 12, run back-to-back, no server restart between them.
- **Acceptance criteria**: all 7 scenarios pass; existing automated tests (`tests/test_phase2_protocols.py` and any auth/trust tests) still pass.
- **Regression risks**: this phase exists specifically to catch them — any finding here becomes a new, explicitly-scoped fix, not a silent patch bundled into Phase 10 itself.

---

## 11. Demo Data / State (Scenarios)

Deterministic roster for the demo user (`USR001` / `demo@talkshop.io`), finalized at Phase 2:

| Merchant | Relationship | Loyalty balance | Saved payment method |
|---|---|---|---|
| Nike | `merchant_member` | 1,000 pts | Visa •••• 4001 |
| Adidas | `merchant_guest` | 0 pts | none |
| Zara | `merchant_member` | 300 pts | Mastercard •••• 5002 |
| H&M, Fossil, Casio | `merchant_guest` | 0 pts | none |

1. **Nike customer, full purchase** — saved method + loyalty both present; points cover the order fully (Scenario A) if the item is ≤ the points value, else points+card (Scenario B).
2. **Adidas non-customer** — no saved method, 0 points; secure payment entry or PayPal-mock appears; card data stays outside the agent path (Phase 3).
3. **Full-points purchase** — Nike item priced at or under the points value; card never touched.
4. **Points + card purchase** — Nike item priced above the points value; remaining balance charged to the saved card; trace shows all four required lines (Phase 5).
5. **Invalid merchant/customer credentials** — reuse/rename the existing bad-agent-credential trust-layer scenario (`backend/trust/credentials.py`) with Phase 9 wording.
6. **Payment authorization failure** — reuse the existing declined-card mock scenario (`mock_processor.py`) with Phase 9 wording.
7. **Secure payment form cancellation** — new, exercised only once Phase 3's modal exists; cancelling returns cleanly to the conversation with no partial order/trust-session state left behind.

---

## 12. Additional Recommendations (not required for this pass — flagged for later)

- **A2A over real HTTP**: wire `_run_a2a_sidecar` to actually call the already-built `/a2a/{merchant}` endpoints instead of the in-process function call. Already tracked as a known pending gap; genuinely larger than "final polish" since it changes a working, demo-safe path into a networked one.
- **UCP as a real adapter boundary**: route `cartup.build_checkout` through `backend/ucp/adapter.py`'s actual session model instead of just labeling the call "UCP" in the trace. Same size/risk category as the A2A item above.
- **Real asymmetric signing for AP2/ACP** (ECDSA-P256 instead of demo HMAC) — mentioned in the adapter's own comments as the production direction; not needed for a mocked PSP demo.
- **Split the Live Trace panel's two event transports** (SSE for discovery, JSON-response for purchase) into one consistent stream — would simplify `ProtocolTracePanel` and remove the one structural wrinkle noted in Section 1/7, but is a refactor of working code and should be its own reviewed change, not bundled here.
- **Persist `MERCHANT_MEMBERS` in the DB** rather than the current in-memory Python dict, so merchant-membership survives a backend restart — small, but worth doing in the same breath as Phase 2's schema change if convenient.
- **Correct the stale file reference** in `demo2_orchestration_plan.md` (names `AgentTrailPanel.tsx` where it means `ProtocolTracePanel.tsx`) — a one-line doc fix, unrelated to app behavior.

---

## Superseded content

The remainder of this file (below this line, if present after this rewrite) was the `v3-generic-agent` branch implementation checklist. All of Phases 1-3 described there were completed and merged; that branch's work is now part of the baseline this plan audits in Section 1. It has been removed from this file to avoid confusion with the phases above — see git history for the original checklist if needed.

---

## 13. TODOs (do one at a time, only when told to start it)

- [x] 1. Remove the login screen — open the app straight into chat, already authenticated as the one persistent demo user/profile running behind the scenes (no login form, no guest-login click). *(Done: demo identity John Carter / john@gmail.com via POST /api/auth/demo-session; /login route removed; global loyalty number hidden from profile menu pending per-merchant rebuild.)*
- [x] 2. Make customer status merchant-specific, not chatbot-global — e.g. the demo user is a Nike customer but not an Adidas customer, and each merchant relationship independently determines its own saved payment method and loyalty balance. *(Done: backend/config/demo_profile.py is the source of truth — John is a member of Nike/Zara/Fossil (cards + points 1000/300/500), guest to Adidas/H&M/Casio. LoyaltyPoints & SavedPaymentMethod now keyed by (user, merchant); MERCHANT_MEMBERS seeded; checkout shows the member card or none. 7 old demo-purchase tests assume global cards and need updating in TODO #10.)*
- [x] 3. Add a secure payment-entry boundary (plus a mocked "Connect PayPal") so raw card/PayPal credentials never leave that boundary — tokenized before anything crosses it, and never seen by the Shopping Agent, the LLM, A2A messages, the protocol trace, or logs. *(Done: client-side tokenizeCard — raw PAN/CVC never leave the browser; old raw /api/psp/tokenize removed (404), replaced by /api/psp/payment-methods (reference only) + /api/psp/paypal-connect (3-step realistic handoff, returns pp_auth ref). Polished SecurePaymentModal: card preview, masking, CVC reveal, trust strip, no outside-close, no clear-on-error, Luhn relaxed for demo. Non-member methods forgotten after purchase; member cards kept. Benign "payment_method_attached"/"paypal_authorization_received" trace events; Live Trace sub-tab defaults to "live".)*
- [x] 4. Make loyalty points merchant-specific, not one global chatbot balance — track and display a separate points balance per merchant, scoped to whichever merchant is involved in the current purchase. *(Done: order proposal shows a per-merchant rewards card (member only) with that merchant's balance; `loyalty_balance` trace event from the merchant; earning is now members-only + merchant-scoped (guest purchases earn nothing); confirmation earn line is merchant-scoped. Nike 1000 / Zara 300 / Fossil 500; guests show no card.)*
- [x] 5. Make loyalty redemption fully automatic and zero-click — after the user picks a product, the backend applies that merchant's redemption rules plus the user's configured reward preference (e.g. maximize points usage) to decide points-only / points+card / card-only, with no "pay with points" button or extra click. *(Done: payment/loyalty_policy.py (10 pts = $1, maximize_points_usage); redemption applied in create_proposal, bound into checkout_hash; amount_due threaded through AP2/ACP/guardrails/charge; points-only fully-covered path skips ACP/PSP (loyalty_settlement); points deducted on success in confirm_paid_order; proposal + confirmation show the split. Reset-on-fresh-start added (loyalty/cart/ad-hoc methods reset per new tab; token moved to sessionStorage).)*
- [x] 6. Give the app Chase-inspired visual polish — merchant/marketplace navigation, product discovery, product card layout, spacing/borders/shadows, points-and-offers presentation, and checkout smoothness — so it reads as a polished financial-commerce marketplace, without copying Chase branding. *(Called good enough for now. Done: shared elevation system (shadow-card/shadow-card-hover/shadow-raised), blue-violet accent on brand/AI touchpoints, colored-tint borders, Dashboard KPI accent stripes, dark-mode color fix, polished loading spinners (badge-wrapped, gradient typing dots) — applied to Chat, ProductCard, InlineCheckout, Dashboard, ChatSidebar, ProtocolTracePanel, AgentTrailPanel (Pipeline tab), and OrdersPanel widget. Not covered: the Cart/Checkout/PaymentResult pages — left as-is.)*
- [x] 7. Fix scrolling so it behaves predictably and smoothly everywhere (chat, trace panel, cart, checkout, modals). *(Done: ChatGPT-style scroll in Chat.tsx — sending a message jumps it to the top so the reply fills the space below instead of chasing the bottom; gentle auto-follow only when already near bottom. Trace/cart/checkout/modals were already structurally correct per the earlier audit — no changes needed there.)*
- [x] 8. After the user selects a product, let the agent carry checkout and payment through automatically — no routine checkout/payment clicks — using a silent 2-3 second internal delay for pacing instead of a visible countdown timer. *(Done: AUTO_SECONDS 10→3; all three visible countdown bars (cart strip, session-cart, Auto GO AHEAD) hidden; auto-advance preserved silently; proposal copy updated to drop "countdown/pause" wording.)*
- [x] 9. Rewrite vague error/status messages so each one names the real user/merchant/payment/loyalty relationship that failed or succeeded. *(Done: the four demo-scenario outcomes now read clearly — invalid-agent-credential (merchant can't verify the agent → checkout not authorized), overcharge attempt (amount/scope didn't match what you authorized → nothing charged), delivery-change (specific dates + re-approve), card decline (merchant + specific reason). Demo-scenario dropdown labels made descriptive.)*
- [ ] 10. Run a final pass verifying A2A/UCP/AP2/ACP fidelity — confirm what's genuinely implemented vs. mocked/cosmetic is still accurately represented after all other changes, and that every demo scenario still works end to end. *(In progress: A2A, MCP, and UCP were upgraded from in-process/cosmetic to real HTTP calls — see Section 14 for exactly what's real vs. mimicked now. Manually verified end-to-end (search, checkout, GO AHEAD, payment) across two merchants with zero regressions in totals/loyalty/outcomes. Still open: the 7 tests broken by TODO #2's merchant-scoped cards haven't been fixed, and the full pytest suite hasn't been re-run since all changes landed together.)*
- [x] 11. Extend the existing Dashboard/History view (no new dashboard) so every completed purchase — from any merchant, under the same persistent demo user — shows an Order ID, a mock carrier + tracking number, merchant, product, total, status, and estimated delivery date right after purchase, opens into a real shipping/tracking timeline from that same Dashboard, and can be filtered by merchant or looked up by Order ID. *(Called good enough for now. Done: merchant filter dropdown, Order ID/tracking-number search, mock carrier (UPS/USPS/FedEx/DHL) shown with tracking number — all on the existing Dashboard, no new one. Not done: a dedicated shipping/tracking timeline view — the Dashboard's existing audit-trail expand is what's there today, not a timeline.)*

**Next step**: review this plan. Once Phase 1 is explicitly approved, implementation begins there and only there.

---

## 14. Protocol Reality Guide — plain-English, for demo narration

This section exists so anyone narrating a demo can say, truthfully, exactly what's happening at each step — without overclaiming or underselling it. Written for a non-technical reader.

### The one-sentence version

**A2A, MCP, and UCP now make real network calls to real servers running inside this same app — they're genuinely "over the wire," just not to a different company's computer. AP2 and ACP were already doing real cryptographic-style signing and verification; the only mock part of those two is that the "signature" uses a simple demo key instead of real bank-grade cryptography.**

### What each protocol actually does, and where

| Protocol | Plain-English job | Where it fires | Real or mimicked? |
|---|---|---|---|
| **A2A** (Agent2Agent) | The shopping assistant "talks to" each merchant's own agent to ask it to search its catalog | Every product search | **Real network call.** A genuine HTTP request goes out to that merchant's own server address and a genuine response comes back. |
| **MCP** (Model Context Protocol) | The standard way an AI agent calls a "tool" (search, check stock, get price) without the tool's raw code being exposed to the AI | Every product search, and every time a checkout is being built (price + stock check) | **Real protocol call.** A real MCP client connects to a real MCP server and calls the tool through the actual MCP handshake — not a shortcut function call. |
| **UCP** (Universal Commerce Protocol) | The merchant's own checkout system calculates and "locks in" the official subtotal/tax/shipping/total for this exact cart | The moment a product is selected and a checkout is being prepared | **Real network call.** A real HTTP request asks a real checkout endpoint to compute and return the locked total. |
| **AP2** (Agent Payments Protocol) | The customer's explicit, signed proof that they approved this exact purchase, for this exact amount | Twice: once when the cart is first shown (binds the cart), once when GO AHEAD is pressed (binds the payment) | **Real signing & verification logic.** A real digital document is built and a real signature is checked before anything proceeds — it's just signed with a simple demo key instead of real bank-grade cryptography. |
| **ACP** (Agentic Commerce Protocol) | A one-time-use "permission slip" that lets the merchant charge a specific amount, and only that amount, and only once | Right after GO AHEAD, before the actual charge | **Real logic.** The permission slip genuinely can't be reused, can't be stretched to a bigger amount, and is checked by the merchant before it charges anything — same demo-key caveat as AP2. |
| **Trust layer** (not one of the 5 named protocols, but the gatekeeper for all of them) | Each merchant checks that the shopping assistant is who it claims to be before answering it at all | Before every search and every checkout | **Fully real.** This has never been mocked — it's real signature verification with real pass/fail checks. |

### What's still mimicked, and exactly how (no surprises)

- **The network calls are to ourselves.** Every "real" HTTP call above (A2A, MCP, UCP) is this one app calling its own other parts over `localhost` — it's genuinely a network round trip, with everything that implies (it can be slow, it can time out, it can fail), but it's not reaching an actual different company's servers, because Nike/Adidas/etc. are synthetic demo merchants that live inside this same app.
- **The signatures are demo-strength, not bank-strength.** AP2 and ACP's "signed documents" use a simple shared secret (HMAC) instead of the real asymmetric cryptography (public/private key pairs) a production system would use. The *process* — sign it, then verify it, then refuse to proceed if it doesn't check out — is completely real. Only the specific math underneath the signature is simplified.
- **Card numbers never travel through any of this.** Whichever protocol step is running, the only payment information that ever moves between them is an opaque reference (like `pm_demo_nike` or `pp_auth_ab12cd`) — never a real card number, never a CVV. That boundary was never mocked.
- **PayPal is a realistic mock, not a connection to real PayPal.** The "Connect PayPal" flow looks and behaves like the real thing (handoff, sign-in, choose a funding source, approve) but there's no real PayPal account or server involved — it's a believable simulation that produces the same *kind* of result a real connection would.
- **Carrier/tracking numbers are invented, not real shipments.** UPS/USPS/FedEx/DHL tracking numbers shown after a purchase are generated to look plausible; no real package is ever created or tracked.

### A worked example: buying Nike running shoes with Nike loyalty points

Walking through one purchase end to end, naming exactly which protocol does what:

1. **You ask**: "Nike running shoes."
2. **Trust check** (real): the shopping assistant presents its credentials to Nike's agent; Nike's agent verifies the signature and opens a trusted session. If this fails, nothing below happens.
3. **A2A** (real network call): the assistant sends Nike's agent a real HTTP message asking it to search its catalog.
4. **MCP** (real protocol call): behind that search, the assistant calls the "search_products" tool through a real MCP connection — the actual mechanism by which an AI agent is allowed to call a tool safely.
5. Products come back and are shown to you. You pick a pair of shoes.
6. **UCP** (real network call): a real checkout-session request is sent to lock in the subtotal, tax, shipping, and total for exactly this item and quantity.
7. **Loyalty redemption** (real logic, not a protocol): since you're a Nike member, the backend checks your Nike points balance and decides — automatically, no extra click — how many points to apply. This changes the amount owed on a card, but it isn't AP2/ACP/UCP itself; it's a merchant-side decision that happens between UCP's total and the payment step.
8. **AP2 — Cart Mandate** (real signing): a signed document is created proving this exact cart (product, quantity, total) is what's being proposed to you.
9. You see the order proposal and click (or silently auto-confirm after ~3 seconds) **GO AHEAD**.
10. **AP2 — Payment Mandate** (real signing): a second signed document proves you personally approved paying the remaining amount (after points) using your saved card.
11. **ACP** (real logic): a one-time "permission slip" is issued, scoped to that exact amount, that exact merchant, that exact order — and it can never be reused or stretched.
12. The mock payment processor charges the card for the remaining amount. If points covered the whole order, **this step and the ACP step are skipped entirely** — there's no card to charge, so there's nothing to authorize on the card rails.
13. The order is confirmed, loyalty points are deducted (if used) and earned (on whatever was actually charged), and a tracking number appears.

Every step above either genuinely happened the way it's described, or is explicitly flagged in this document as mimicked — nothing in that list is overstated.
