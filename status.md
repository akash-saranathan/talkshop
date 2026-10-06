# v3-generic-agent — Implementation Status

Branch: `v3-generic-agent`
Design doc: `generic_cb.md`

Update each checkbox as you complete a step. Add notes under a step if something changed from the design doc.

---

## Phase 1 — Foundation
*Goal: branch is clean, login works, both merchant catalogs exist, A2A layer is wired up and smoke-testable.*

- [x] **1.1 — Branch setup verification**
  Confirm the branch has the full existing stack intact — nothing is deleted.
  Everything from main carries over and stays:
  LangGraph pipeline, MCP server, Dashboard, AgentTrailPanel, Cart drawer,
  Compare page, CartUp, Shopify/BestBuy/DummyJSON adapters, DPAT signing.
  We add the generic agent layer ON TOP of all of this.
  Existing routes and pages remain unchanged.

- [x] **1.2 — Login page**
  `frontend/src/pages/Login.tsx` at route `/`
  - Email + password form → JWT login (reuse existing `backend/auth/` endpoints)
  - "Continue as Guest" → guest session → redirect to `/chat`
  - On success → redirect to `/chat`

- [x] **1.3 — Synthetic merchant catalogs**
  6 merchants across 3 categories — all synthetic JSON, no real APIs:

  Shoes/Sportswear:
  `backend/data/nike_catalog.json`   — 12–15 Nike shoes + sportswear ($80–$180)
  `backend/data/adidas_catalog.json` — 10–12 Adidas shoes + sportswear ($75–$160)

  Clothing/Dresses:
  `backend/data/zara_catalog.json`   — 12–15 Zara dresses, tops, clothing ($25–$120)
  `backend/data/hm_catalog.json`     — 12–15 H&M dresses, tops, clothing ($15–$80)

  Watches:
  `backend/data/fossil_catalog.json` — 8–10 Fossil watches ($80–$250)
  `backend/data/casio_catalog.json`  — 8–10 Casio watches ($30–$150)

  Registry + payment:
  `backend/data/merchant_registry.json` — all 6 merchants + categories + A2A URLs
  `backend/data/demo_instruments.json`  — 2 pre-registered guest payment instruments

  Each product has variants (size/color/availability) for realistic edge cases.

- [x] **1.4 — A2A layer**
  `backend/a2a/models.py` — AgentCard, Task, TaskStatus, Artifact
  `backend/a2a/client.py` — httpx calls to local merchant agent endpoints
  `backend/a2a/server.py` — router factory, mounts per-merchant A2A endpoints
  `backend/a2a/merchants/nike.py`   — Nike Agent Card + message/send handler
  `backend/a2a/merchants/adidas.py` — Adidas Agent Card + message/send handler
  `backend/a2a/merchants/zara.py`   — Zara Agent Card + message/send handler
  `backend/a2a/merchants/hm.py`     — H&M Agent Card + message/send handler
  `backend/a2a/merchants/fossil.py` — Fossil Agent Card + message/send handler
  `backend/a2a/merchants/casio.py`  — Casio Agent Card + message/send handler
  `backend/routers/a2a.py` — mounts all 6 merchant A2A routers into FastAPI

  Smoke test: `curl http://localhost:8000/a2a/nike/.well-known/agent.json`
              `curl http://localhost:8000/a2a/zara/.well-known/agent.json`

---

## Phase 2 — Agent + Protocols
*Goal: full backend pipeline works end-to-end — intent → merchant routing → A2A → UCP → ACP → AP2 → order.*

- [x] **2.1 — Generic Shopping Agent**
  `backend/agents/generic_shopping_agent.py`
  - Intent parse: regex-based extract of brand / category / max_price / size / color
  - Merchant routing: brand → direct; category → CATEGORY_ROUTES lookup; fallback → broadcast all 6
  - Parallel A2A calls via asyncio.gather + asyncio.to_thread
  - Aggregate + re-rank (rating desc, price asc)
  - Human approval pauses: `product_selection` and `approve_pay` via asyncio.Event

- [x] **2.2 — SSE streaming endpoint**
  `backend/routers/generic_chat.py`
  - `GET /api/generic/stream` — drives Generic Shopping Agent, emits SSE events
  - `POST /api/generic/resume` — unpauses agent (validates session state before setting event)
  - `GET /api/generic/instruments` — returns pre-registered demo instruments for Case 2
  - Both human pause moments wired: `product_selection` and `approve_pay`

- [x] **2.3 — UCP adapter**
  `backend/ucp/models.py` — UCPCheckoutSession, UCPTotalEntry, UCPFulfillment, UCPCompleteResponse
  `backend/ucp/adapter.py` — create_session (totals) + complete_session (order)
  Wire format: ucp.dev/specification/checkout-rest/ (2026-01-23)
  Emits: `POST /checkout-sessions`, `session_created`, `POST /checkout-sessions/{id}/complete`, `order_created`

- [x] **2.4 — ACP adapter**
  `backend/acp/models.py` — ACPSharedPaymentToken, ACPConstraints, ACPIssueTokenRequest
  `backend/acp/token.py` — issue_spt (HMAC-signed) + verify_spt (constraints enforcement)
  `backend/acp/adapter.py` — ACPAdapter.issue() + .verify()
  Wire format: Stripe ACP spec — spt_<8hex> token, constraints{currency, maximum_amount, expiration}
  Emits: `POST /shared_payment/issued_tokens`, `token_issued`, `token_verified`

- [x] **2.5 — AP2 adapter**
  `backend/ap2/models.py` — AP2IntentMandate, AP2CartMandate, AP2PaymentMandate (W3C VC JSON-LD)
  `backend/ap2/adapter.py` — creates + signs all three mandates; verify_mandate checks HMAC
  Wire format: W3C Verifiable Credential + DataIntegrityProof (HMAC-SHA256 demo, real: ECDSA-P256)
  Emits: `intent_mandate_signed`, `cart_mandate_signed`, `payment_mandate_signed`, `all_mandates_submitted`

  Tests: `tests/test_phase2_protocols.py` — 42 tests, all passing

---

## Phase 3 — Frontend + Full Flow
*Goal: the app is fully usable end-to-end in the browser — chat works, protocol trace fires, both payment cases work.*

- [x] **3.1 — GenericChat page**
  `frontend/src/pages/GenericChat.tsx` at route `/chat`
  - 3-column layout: Sessions sidebar | Chat center | Protocol Trace right (collapsible)
  - Protocol selector in header: `[ A2A + UCP + ACP + AP2 ]` / `[ A2A + UCP + AP2 ]` toggle
  - SSE connection to `GET /api/generic/stream`; EventSource with `?token=` auth
  - State machine: idle → searching → products_shown → checkout_loading → payment_ready → ordering → complete/error
  - Human approval moments: ProductCard selection → `POST /api/generic/resume`; APPROVE & PAY → `POST /api/generic/resume`

- [x] **3.2 — Protocol Trace Panel**
  `frontend/src/components/ProtocolTracePanel.tsx`
  - Color coding: A2A=blue, UCP=violet, ACP=indigo, AP2=amber, internal=slate
  - Expandable rows showing raw JSON payload
  - Live event count badge; legend strip

- [x] **3.3 — Product results UI**
  - Top 3 products shown by default; `+ N more results` expands inline
  - Brand filter chips (client-side); sort toggle (rating / price)

- [x] **3.4 — Payment flows**
  `frontend/src/utils/mockTokenizer.ts`
  - **Case 1 (customer, useAcp=true)**: inline hosted-fields form → `mockTokenize()` → `mock_pm_<last4>` → ACP SPT path
  - **Case 2 (guest, useAcp=false)**: pre-registered demo instruments from `GET /api/generic/instruments`
  - Raw card digits never leave the browser; only opaque token sent to backend

---

## Completed Steps

Phase 1 — all steps complete (see checkboxes above)
Phase 2 — all steps complete (2026-10-05)
  New files: backend/ucp/, backend/acp/, backend/ap2/, backend/agents/generic_shopping_agent.py,
             backend/routers/generic_chat.py, tests/test_phase2_protocols.py
  Tests: 12 A2A (Phase 1) + 42 protocol (Phase 2) = 54 total, all passing

Phase 3 — all steps complete (2026-10-05)
  New files: frontend/src/pages/GenericChat.tsx (replaced placeholder),
             frontend/src/components/ProtocolTracePanel.tsx,
             frontend/src/utils/mockTokenizer.ts
  Route: /chat → GenericChat (already wired in App.tsx)

---

## Notes / Deviations from Design Doc

*(record anything that changed during implementation)*
