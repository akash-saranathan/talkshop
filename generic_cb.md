# Generic Shopping Agent — Design & Implementation Plan

> **Branch:** `v3-generic-agent` (standalone — does not share UI or routes with the existing demo)

---

## Quick Overview — What This Builds

A **Generic Shopping Agent** — a chatbot that talks to merchant AI agents using real open protocols, checks out, and completes a simulated purchase. Everything runs locally; the external parties (Nike, bank, card network) are mocked, but every protocol message, HTTP call, and cryptographic signature is real.

The user logs in, types one message. The rest happens automatically — except two moments where the user must explicitly approve (product selection and payment). The right side of the screen shows every protocol step happening live.

**App entry point: Login page → Chat.** There is no other page visible on this branch.

---

## The Full Flow — Start to Finish

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER TYPES:  "I need Nike running shoes under $120, size 10"        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GENERIC SHOPPING AGENT                                             │
│  • Reads the message                                                │
│  • Figures out: brand=Nike, max_price=$120, size=10                 │
│  • Decides: go talk to the Nike Agent                               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  A2A Step 1 — "Who are you?"
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GET /a2a/nike/.well-known/agent.json                               │
│  ← Nike Agent Card received                                         │
│    "I am the Nike Agent. I can search, checkout, track orders."     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  A2A Step 2 — "Find me shoes"
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /a2a/nike   {jsonrpc: "2.0", method: "message/send", ...}     │
│  ← Nike Agent returns Task result with 5 products as artifacts      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  👤 HUMAN DECISION — "Which shoe do you want?"                      │
│  ProductCards shown in chat. User clicks one.                       │
│  Agent is PAUSED until user picks.                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │  UCP mode                   │  ACP mode
              ▼                             ▼
┌─────────────────────────┐  ┌─────────────────────────────────────┐
│  POST /ucp/checkout-    │  │  1. POST /acp/payment-tokens        │
│       sessions          │  │     ← SPT issued (spt_demo_...)     │
│  ← CheckoutSession with │  │     (bounded to nike, max $120)     │
│    line items + total   │  │  2. POST /acp/checkout-sessions     │
│    $118.42              │  │     (SPT travels with the cart)     │
└────────────┬────────────┘  │  ← CheckoutSession + SPT ref       │
             │               └──────────────┬──────────────────────┘
             └──────────────┬───────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ORDER SUMMARY shown in chat                                        │
│  Product / Subtotal / Shipping / Tax / TOTAL: $118.42               │
│                                                                     │
│  👤 HUMAN DECISION — User clicks [ APPROVE & PAY ]                 │
│  Agent is PAUSED again until user confirms.                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  AP2 — Three Mandates
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Mandate 1 — Intent Mandate  (signed at session start by user)      │
│    "User authorized agent to buy Nike shoes up to $120"             │
│                                                                     │
│  Mandate 2 — Cart Mandate   (signed now by agent)                   │
│    "Agent assembled: Pegasus 42, size 10, total $118.42"            │
│                                                                     │
│  Mandate 3 — Payment Mandate (signed now by agent)                  │
│    "Charge $118.42 to mock_card_4242, single-use, 15 min expiry"    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MOCK PAYMENT PROVIDER  — deterministic checks only, no LLM         │
│  ✓ Intent Mandate valid + not expired                               │
│  ✓ Cart total within authorized limit  ($118.42 < $120)             │
│  ✓ All three mandates linked correctly                              │
│  ✓ Single-use + not expired                                         │
│  → PAYMENT APPROVED                                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       Loyalty points    Order created   Tracking
       awarded           TS-2026-00127   initialized
```

---

## Which Protocol Does What

| Step | Protocol | Simple job |
|---|---|---|
| Agent finds Nike | **A2A** | Two agents talking to each other over HTTP |
| Agent reads Nike's capabilities | **A2A** | Nike publishes an "Agent Card" |
| Cart + total | **UCP** | Standard checkout session — line items, shipping, tax |
| Pre-authorized payment token | **ACP** | Stripe issues a one-time, amount-capped SPT after UCP gives us the total |
| Payment permission chain | **AP2** | Three signed documents proving the user authorized this exact purchase |
| Payment verification | **AP2** | Deterministic ECDSA checks — no LLM decides if payment is valid |

All four protocols are **free, open-source Apache 2.0** and we mimic their exact real JSON shapes.

---

## UCP + ACP Together (Combined Flow for Demo)

UCP and ACP are designed to **compose** — UCP structures the cart, ACP provides the payment token.
Using both shows the most protocol steps in the trace and is the correct real-world usage.

```
Step 1 — UCP: create checkout session
  POST /ucp/checkout-sessions
  ← CheckoutSession  { id: "ucp_cs_123", total: $118.42, status: "incomplete" }

Step 2 — ACP: issue SPT scoped to the exact total UCP returned
  POST /acp/payment-tokens  { seller_id: "nike_demo", max_amount: 11842, currency: "usd" }
  ← SharedPaymentToken  { id: "spt_demo_ABC123", max_amount: 11842, expires_in: 900s }

Step 3 — UCP: complete checkout using the ACP SPT as payment
  POST /ucp/checkout-sessions/ucp_cs_123/complete  { payment_token: "spt_demo_ABC123" }
  ← { status: "complete", order_id: "TS-2026-00127" }

Step 4 — AP2: three mandates verify the whole chain cryptographically
  Intent Mandate  (user pre-authorized this at session start)
  Cart Mandate    (agent signs the UCP checkout total)
  Payment Mandate (agent signs the ACP SPT + exact charge amount)
  → Mock PSP verifies all three → APPROVED
```

The right-side trace for the combined path is the richest in the demo — it shows 4 protocols
firing in sequence, each with real HTTP calls and real JSON payloads.

The demo toggle becomes:

```
[ A2A + UCP + AP2 ]     [ A2A + UCP + ACP + AP2 ]
  (standard path)          (full protocol path — recommended for demo)
```

---

## Customer vs Guest — Two Payment Flows

There are two distinct payment cases. They look and behave very differently in the UI.

---

### Case 1 — Authenticated Customer: Inline Secure Form (Hosted Fields)

**What it is — and why it is NOT a popup modal**

When banks like Citibank show a payment form, the card fields are not a popup that appears over the page. They use **Hosted Fields** — each card input (card number, expiry, CVV) is an isolated field embedded directly inside the page flow, visually indistinguishable from a normal input but structurally isolated so the parent application cannot read the raw card data.

In production (Stripe Elements, Braintree Hosted Fields, Worldline, Clover, Visa hosted fields):
- Each field is a separate `<iframe>` served from the payment processor's own domain
- The parent page hosts the iframe but **cannot read its DOM** — cross-origin isolation
- Tokenization happens inside the iframe; only a token comes out via `postMessage`
- Raw card number, CVV, and expiry never enter the merchant's JavaScript, React state, server, or logs
- PCI DSS scope drops to SAQ-A (the lowest audit level) because the merchant never handles card data

**Visual difference from the current popup:**

```
CURRENT (popup/modal — what we have now):
  [Chat conversation]
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← page dimmed / overlaid
  ┌──────────────────────────────┐
  │  Secure Payment          [×] │  ← floats above everything
  │  Card Number  [____________] │
  │  Expiry [____]  CVV  [___]   │
  │  Name   [________________]   │
  │         [ Enter Card ]       │
  └──────────────────────────────┘

NEW (inline hosted fields — bank / Citibank style):
  [Chat messages scroll normally above]
  ──────────────────────────────────────────────────
  🔒  Secure Payment
  ──────────────────────────────────────────────────
    Card Number   [ 4242  4242  4242  4242         ]
    Expiry        [ 09/27 ]     CVV   [ ···        ]
    Name on card  [ John Smith                     ]
  ──────────────────────────────────────────────────
                              [ APPROVE & PAY ]
  [Chat input below — disabled until form is done]
```

The form appears as a **card bubble in the conversation** at the payment step. No overlay. No dimming. No floating modal. It scrolls with the chat. When the user clicks APPROVE & PAY, the bubble transitions to the order confirmation state inline.

**How the mock simulates this:**

We build a `MockHostedPaymentField` component that enforces the same security contract as a real iframe:

```ts
// frontend/src/components/MockHostedPaymentField.tsx
// Fields are self-contained — raw card data never exits into parent React state.
// Only the token is emitted via onTokenized callback.

interface Props {
  onTokenized: (token: string) => void
}

// Internally:
//   formatCardNumber → •••• •••• •••• XXXX masking
//   formatExpiry     → MM/YY auto-slash
//   Luhn check + future-date validation
//   On submit → mockTokenizer.tokenizeCard(card) → "mock_card_XXXX"
//   Parent only receives "mock_card_XXXX" — never sees card, expiry, CVV
```

```ts
// frontend/src/utils/mockTokenizer.ts
export function tokenizeCard(card: GuestCardInput): string {
  const last4 = card.number.replace(/\s/g, "").slice(-4)
  return `mock_card_${last4}`   // e.g. "mock_card_4242"
}
```

This replaces the existing `SecurePaymentModal` popup. The fields are reused but moved out of
a modal and into an inline chat bubble component.

**Customer flow at payment step:**

```
User is logged in (JWT token present)
  │
  ├── Loyalty balance shown in chat header
  ├── Stored cards shown as selectable chips: [Visa ••4242] [MC ••8317] [Amex ••5591]
  │     One click selects the card — no form entry needed for known cards
  │
  ├── "Use a new card" link → inline hosted-fields form expands in-place (not a popup)
  │     MockHostedPaymentField renders; user types card; only token exits
  │
  ├── Intent Mandate pre-signed at session start with user's stored key reference
  └── Click APPROVE & PAY → AP2 Payment Mandate signed with selected instrument ref
```

---

### Case 2 — Guest / Non-Customer: Agent Uses Pre-Registered Demo Instruments

Guests do **not** enter card details. Instead, the agent/platform has **pre-registered demo payment
instruments** that are available to any guest session. The chatbot presents these as ready-to-use
options — no form, no card entry.

**Why this design:**

In real agentic commerce, a guest would either have a digital wallet (Apple Pay, Google Pay) or
would have pre-authorized the shopping platform with a delegated payment credential. The agent
knows these credentials ahead of time — the user does not need to provide card details on the spot.

For the demo, the platform ships with a small set of mock instruments in
`backend/data/demo_instruments.json`:

```json
[
  {
    "id": "demo_inst_visa_4001",
    "network": "Visa",
    "last4": "4001",
    "label": "Demo Visa",
    "mock_token": "mock_card_4001",
    "note": "platform demo credential — available to all guest sessions"
  },
  {
    "id": "demo_inst_mc_5002",
    "network": "Mastercard",
    "last4": "5002",
    "label": "Demo Mastercard",
    "mock_token": "mock_card_5002",
    "note": "platform demo credential — available to all guest sessions"
  }
]
```

**Guest flow at payment step:**

```
No auth token — guest session ID generated (uuid)
  │
  ├── At payment step, agent presents pre-registered options (no form)
  │
  │   ┌──────────────────────────────────────────────────┐
  │   │  Payment                                         │
  │   │  ─────────────────────────────────────────────   │
  │   │  Available payment methods:                      │
  │   │  ○  Visa         •••• 4001   (platform demo)     │
  │   │  ○  Mastercard   •••• 5002   (platform demo)     │
  │   │  ─────────────────────────────────────────────   │
  │   │                      [ APPROVE & PAY ]           │
  │   └──────────────────────────────────────────────────┘
  │
  ├── User selects one option and clicks APPROVE & PAY
  ├── No card data entered — instrument ID used directly as payment reference
  └── mock_token from selected instrument used in AP2 Payment Mandate + ACP SPT
```

**No card data ever appears** — the `mock_token` (`mock_card_4001`) travels in the protocol
layers exactly the same way as in Case 1.

---

### Both Cases Converge at the Same Protocol Point

```
Case 1 — Customer, inline hosted-fields form:
    mock_card_XXXX   (last 4 of typed card, tokenized in MockHostedPaymentField)  ──┐
                                                                                    ├──> AP2 Payment Mandate
Case 2 — Guest, pre-registered demo instruments:                                   │    + ACP SPT request
    mock_card_4001   (from demo_instruments.json, selected by user)               ──┘
```

The token reference (`mock_card_XXXX`) is the **only payment-related data** that appears in:
- the ACP SPT request body
- the AP2 Payment Mandate `paymentInstrumentRef`
- the SSE `protocol_event` trace on the right panel
- the order record in the DB

Raw card number, expiry, CVV, and cardholder name never appear in any log, network request,
right-side panel event, or order metadata.

---

> **Detailed design, JSON shapes, implementation sequence, and right-side panel design follow below.**

---

## Protocol Primer — What Each Protocol Does in Plain English

Before the design details, here is what each protocol actually is, in simple words.

### A2A — Agent-to-Agent (Google, open spec, April 2025)

**Simple version:** Two AI agents talking to each other over HTTP, like two developers calling each other's APIs — except the "developer" is another AI.

Every agent publishes an **Agent Card** at `/.well-known/agent.json`. This is like a business card that says "here is what I can do and where to reach me." Another agent reads that card, then sends a **Task** (a unit of work) to the agent's endpoint using **JSON-RPC 2.0** over HTTP. The receiving agent processes it and returns a result with a **status** and **artifacts** (the output data). Long-running tasks support SSE streaming so the caller gets live updates.

In our demo: the Generic Shopping Agent reads Nike's Agent Card, then sends a task saying "find running shoes under $120, size 10." Nike's agent returns product results as artifacts.

**Real spec:** [a2a-protocol.org](https://a2a-protocol.org/latest/specification/) · [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A)

---

### UCP — Universal Commerce Protocol (Google + Shopify + Walmart + Target + Etsy + Wayfair, January 2026)

**Simple version:** A standard set of commerce capabilities that any merchant exposes so any AI agent can interact with them the same way — product search, cart, checkout, fulfillment, order — all in one common interface.

**Important distinction — A2A vs UCP work at different layers:**

```
A2A  =  HOW agents communicate      (the envelope / transport)
UCP  =  WHAT the merchant exposes   (the commerce capabilities inside)
```

They are not alternatives — they stack:

```
Shopping Agent
      │  A2A: "find shoes under $120"   ← communication layer
      ▼
Nike Agent
      │  UCP: product search, cart, checkout   ← commerce capabilities layer
      ▼
Nike catalog / checkout engine
      │
      ▼
Nike Agent
      │  A2A: returns products as artifacts   ← communication layer
      ▼
Shopping Agent
```

UCP covers the full commerce journey: finding product information, creating and managing a cart, getting prices/taxes/shipping/final total, selecting fulfillment options, completing the purchase, and receiving order info.

In our demo: the Nike Agent exposes UCP capabilities. When the Shopping Agent sends an A2A task ("find shoes"), the Nike Agent uses its UCP product capability to search the catalog and return results. When the user picks a product, the Nike Agent uses its UCP checkout capability to create a session with the final total ($118.42).

**Real spec:** [ucp.dev](https://ucp.dev/documentation/core-concepts/) · [Google Merchant UCP guide](https://developers.google.com/merchant/ucp/guides/checkout/native)

---

### ACP — Agentic Commerce Protocol (OpenAI + Stripe, September 2025)

**Simple version:** A standard checkout flow specifically designed for AI agents, where the user pre-authorizes the agent with a **Shared Payment Token (SPT)** — a one-time-use, amount-capped, merchant-scoped token. The agent never touches the actual card.

The key difference from UCP: ACP includes the payment step. The user's payment provider (Stripe) issues an SPT scoped to one merchant, one max amount, and one expiry. The agent hands this token to the merchant at checkout instead of a real card number. The merchant charges against the SPT. If the agent tries to overspend or use it at the wrong merchant, it fails deterministically.

In our demo: in ACP mode, the agent gets an SPT before contacting Nike. When checkout completes, Nike charges the SPT rather than requiring a card number.

**Real spec:** [Stripe SPT docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens) · [agenticcommerce.dev](https://agenticcommerce.dev)

---

### AP2 — Agent Payments Protocol (Google, September 2025)

**Simple version:** A cryptographically signed permission chain — three "mandate" documents — that proves step by step: (1) the user wanted to buy something, (2) the agent assembled the right cart, and (3) the agent is authorized to charge exactly this amount. Like a paper trail of signed approvals.

AP2 represents every purchase as three **Mandates**, each a **W3C Verifiable Credential** signed with ECDSA-P256:

- **Intent Mandate** — signed by the user's wallet, says "I authorize this agent to shop for me, up to $X at merchant Y"
- **Cart Mandate** — signed by the agent, says "I assembled this specific cart with these items and this total"
- **Payment Mandate** — signed by the agent, says "charge exactly $118.42 to this payment instrument for this cart"

The merchant (or payment network) verifies all three mandates in order. If any signature is wrong, the amount doesn't match, or the mandate is expired, the payment is rejected — no LLM judgement, pure cryptographic check.

In our demo: the AP2 layer wraps the existing DPAT signing logic. The three mandates replace what DPAT calls CheckoutObject + DPATToken + PaymentAuthorization.

**Real spec:** [github.com/google-agentic-commerce/AP2](https://github.com/google-agentic-commerce/AP2) · [AP2 illustrated guide](https://arthurchiao.art/blog/ap2-illustrated-guide/)

---

### How They Compose in One Flow

```
USER
  │
  │  "Nike running shoes under $120"
  ▼
Generic Shopping Agent
  │
  │  A2A: reads Nike's Agent Card, sends Task
  ▼
Nike Merchant Agent
  │
  │  returns product artifacts
  ▼
USER SELECTS PRODUCT
  │
  │  UCP mode:  POST /ucp/checkout-sessions  (cart + total, no auth layer)
  │  ACP mode:  SPT issued first → POST /acp/checkout-sessions (payment pre-authorized)
  ▼
CheckoutSession  (total: $118.42)
  │
USER APPROVES & PAYS
  │
  │  AP2:  Intent Mandate → Cart Mandate → Payment Mandate
  │        each cryptographically signed
  ▼
Mock PSP verifies all three mandates deterministically
  ▼
PAYMENT APPROVED → Loyalty → Order → Tracking
```

UCP and ACP both produce a CheckoutSession; AP2 is the payment authorization layer on top of either.
The right-side trace shows a visibly different step sequence depending on whether UCP or ACP is active.

---

## What to Carry Over from the Existing Codebase

Cherry-picked onto the new branch — only what this app needs:

| Asset | Location | Notes |
|---|---|---|
| DPAT signing + 12-check guardrail | `backend/payment/` | Wrap as AP2 mandate layer |
| CartUp checkout logic | `backend/agents/cartup.py` | Wrap behind UCP adapter |
| SSE streaming infra | `backend/routers/chat.py` | New endpoint `/api/chat/stream` on this branch |
| InlineCheckout | `frontend/src/components/InlineCheckout.tsx` | Reuse for order summary + payment phases |
| ProductCard | `frontend/src/components/ProductCard.tsx` | Reuse unchanged |
| SecurePaymentModal fields | inside `InlineCheckout.tsx` | Extract field components → rebuild as inline `MockHostedPaymentField` (not a popup) |
| Auth (JWT login/register) | `backend/auth/`, `backend/routers/auth.py` | Login page depends on this |
| DB schema, models, loyalty, order | `backend/db/`, `backend/models/` | Keep as-is |
| Local merchant adapter | `backend/merchants/local.py` | Pattern for Nike catalog adapter |

---

## New Layers to Add

```
backend/
  a2a/
    models.py          # AgentCard, Task, TaskStatus, Artifact
    client.py          # httpx calls to local merchant agent endpoints
    server.py          # router factory — mounts per-merchant A2A endpoints
    merchants/
      nike.py          # Nike Agent Card + message/send handler
      adidas.py        # (future) Adidas Agent Card + handler
  commerce/
    protocol.py        # CommerceProtocol interface (shared by UCP + ACP)
  ucp/
    adapter.py         # UCPAdapter → emits UCP CheckoutSession
    models.py          # CheckoutSession, LineItem, Fulfillment, Totals
  acp/
    adapter.py         # ACPAdapter → delegation grant + agent token + checkout
    models.py          # AgentIdentity, DelegationGrant, AgentToken, ACPCheckoutSession
    token.py           # issue + verify mock Visa Agentic Token (HMAC-signed)
  ap2/
    adapter.py         # thin wrapper over DPAT → emits AP2 mandate objects
    models.py          # CheckoutBinding, CheckoutHash, CheckoutMandate, PaymentMandate, PaymentToken
  agents/
    generic_shopping_agent.py   # new orchestrator (not replacing VibeCheck)
  routers/
    generic_chat.py    # GET /api/v2/chat/stream (SSE)
    a2a.py             # mounts a2a/server routers
  data/
    nike_catalog.json  # 8–10 Nike running shoes with sizes/colors/prices/SKUs

frontend/src/
  pages/
    Login.tsx               # route /  — entry point, redirect to /chat after login
    Chat.tsx                # route /chat  — the only other page
  components/
    ProtocolTracePanel.tsx  # right-side panel (Pipeline toggle + Protocol Trace toggle)
    AgentInteractionCard.tsx # single protocol event row (expandable)
```

---

## A2A Layer — What "Real Local HTTP" Means

### Merchant Agent Endpoints (served by FastAPI, same process)

```
GET  /a2a/nike/.well-known/agent.json   ← real spec path
POST /a2a/nike                          ← JSON-RPC 2.0 endpoint (method: message/send)
```

The Generic Shopping Agent calls these with `httpx.AsyncClient` pointed at `http://localhost:8000`.
This is an **actual HTTP round-trip** — not a function call — so it appears in logs, can be traced,
and is structurally identical to calling a real remote merchant agent.

### Agent Card — real spec shape

```json
{
  "name": "Nike Merchant Agent",
  "description": "Nike commerce agent — shoes, apparel, accessories",
  "url": "http://localhost:8000/a2a/nike",
  "version": "1.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "skills": [
    {
      "id": "product_search",
      "name": "Product Search",
      "description": "Search Nike catalog by category, size, color, price",
      "inputModes": ["text"],
      "outputModes": ["text", "data"]
    },
    {
      "id": "checkout",
      "name": "Checkout",
      "description": "Create a checkout session for a selected SKU",
      "inputModes": ["data"],
      "outputModes": ["data"]
    }
  ]
}
```

### Task send/response — real spec shape (JSON-RPC 2.0)

The A2A spec uses **JSON-RPC 2.0** as the wire format. The method is `message/send`.

```json
// POST /a2a/nike  (JSON-RPC 2.0)
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": "req_001",
  "params": {
    "message": {
      "role": "user",
      "messageId": "msg_abc123",
      "contextId": "ctx_xyz789",
      "parts": [
        {
          "type": "text",
          "text": "Find running shoes under $120, size 10"
        }
      ]
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": "req_001",
  "result": {
    "id": "task_abc123",
    "contextId": "ctx_xyz789",
    "status": {
      "state": "completed",
      "timestamp": "2026-10-05T10:21:42Z"
    },
    "artifacts": [
      {
        "artifactId": "artifact_001",
        "name": "product_results",
        "parts": [
          {
            "type": "data",
            "data": {
              "products": [
                {
                  "sku": "nike_pegasus_42_black_10",
                  "title": "Nike Air Zoom Pegasus 42",
                  "price": 99.99,
                  "size": "10",
                  "color": "Black/White",
                  "available": true
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```

---

## UCP vs ACP — What Each One Is

| | UCP (Universal Commerce Protocol) | ACP (Agentic Commerce Protocol — OpenAI + Stripe) |
|---|---|---|
| **Who made it** | Google + Shopify + Walmart + Target + Etsy, Jan 2026 | OpenAI + Stripe, Sep 2025 |
| **Focus** | Standard cart + checkout session across any merchant | Agent checkout with a pre-authorized Shared Payment Token (SPT) |
| **Key artifact** | `CheckoutSession` (id, line_items, totals, status) | `SharedPaymentToken` — single-use, amount-capped, merchant-scoped |
| **Payment** | Separate step (AP2 mandates or PSP) | SPT carries the bounded payment authority itself |
| **Trust model** | Merchant trusts the checkout payload | Merchant charges against the SPT; if overspend or wrong merchant → rejected by Stripe |
| **When used** | Cart + total needs to be standardized | Agent needs pre-authorized payment that never exposes the real card |

Both are relevant to the demo and show different things:
- **UCP** is the "how we structure the cart and final amount"
- **ACP** is the "how the merchant gets paid — using a pre-authorized Shared Payment Token"

They can compose: UCP structures the cart, ACP provides the payment token.

### Real UCP JSON shapes

```json
// POST /ucp/checkout-sessions  (UCP REST binding)
{
  "line_items": [
    { "item_id": "nike_pegasus_42_black_10", "quantity": 1 }
  ],
  "buyer": { "email": "user@example.com" }
}

// Response — CheckoutSession
{
  "id": "ucp_cs_demo_123",
  "status": "incomplete",
  "ucp": {
    "version": "2026-04-08",
    "capabilities": [
      "dev.ucp.shopping.checkout",
      "dev.ucp.shopping.fulfillment"
    ]
  },
  "line_items": [
    {
      "item_id": "nike_pegasus_42_black_10",
      "title": "Nike Air Zoom Pegasus 42",
      "quantity": 1,
      "unit_price": 99.99,
      "currency": "USD"
    }
  ],
  "totals": {
    "subtotal": 99.99,
    "shipping": 10.00,
    "tax": 8.43,
    "total": 118.42,
    "currency": "USD"
  }
}

// POST /ucp/checkout-sessions/{id}/complete  (after AP2 payment)
{ "payment_ref": "ptk_demo_ABC123" }

// Response
{ "id": "ucp_cs_demo_123", "status": "complete", "order_id": "TS-2026-00127" }
```

### Real ACP JSON shapes (Shared Payment Token)

```json
// Step 1: Agent requests SPT from the payment provider (Stripe mock)
// POST /acp/payment-tokens
{
  "seller_id": "nike_demo",
  "currency": "usd",
  "max_amount": 12000,    // cents — $120.00 cap matches user's constraint
  "expires_in": 900       // 15 minutes
}

// Response: Shared Payment Token
{
  "id": "spt_demo_ABC123",
  "object": "shared_payment.granted_token",
  "created": 1759686100,
  "deactivated_at": 1759687000,
  "usage_limits": {
    "currency": "usd",
    "expires_at": 1759687000,
    "max_amount": 12000
  }
}

// Step 2: ACP checkout session (SPT travels with the cart)
// POST /acp/checkout-sessions
{
  "buyer": { "email": "user@example.com" },
  "items": [{ "product_id": "nike_pegasus_42_black_10", "quantity": 1 }],
  "payment_token": "spt_demo_ABC123"
}

// Response
{
  "id": "acp_cs_demo_456",
  "status": "pending_completion",
  "total": { "amount": 11842, "currency": "usd" }
}

// Step 3: Complete (merchant charges the SPT)
// POST /acp/checkout-sessions/{id}/complete
{ "payment_token": "spt_demo_ABC123" }

// Response
{
  "id": "acp_cs_demo_456",
  "status": "complete",
  "order_id": "TS-2026-00127",
  "charged": { "amount": 11842, "currency": "usd" }
}
```

---

## UCP / ACP Checkout Adapter

The underlying `CartUp` logic is shared. A `CommerceProtocol` interface wraps it, and the active
adapter is selected at session start via a **UI toggle in the demo** (not just a config flag).

```python
# backend/commerce/protocol.py
class CommerceProtocol(Protocol):
    async def create_session(self, buyer, items) -> CheckoutSession: ...
    async def confirm_session(self, session_id, payment_ref) -> OrderRef: ...

# backend/ucp/adapter.py
class UCPAdapter(CommerceProtocol):
    async def create_session(self, buyer, items) -> CheckoutSession:
        # CartUp internally → returns UCP-shaped CheckoutSession
        # Emits: ucp_session_created protocol_event

# backend/acp/adapter.py
class ACPAdapter(CommerceProtocol):
    async def create_session(self, buyer, items) -> CheckoutSession:
        # 1. Verify ACP AgentToken (delegation chain check)
        # 2. CartUp internally → CheckoutSession
        # 3. Attach acp_token_ref to session
        # Emits: acp_agent_verified, acp_session_created protocol_events
```

### ACP-specific concepts added to the backend

```
backend/
  acp/
    adapter.py        # ACPAdapter implementing CommerceProtocol
    models.py         # AgentIdentity, DelegationGrant, AgentToken, ACPCheckoutSession
    token.py          # issue + verify mock Visa Agentic Token (HMAC-signed locally)
```

#### ACP model shapes

```python
# AgentIdentity — who is the agent
class AgentIdentity(BaseModel):
    agent_id: str          # e.g. "generic_shopping_agent_v1"
    agent_name: str
    issued_by: str         # e.g. "talkshop_platform"
    public_key_hint: str   # mock; would be JWK in production

# DelegationGrant — user pre-authorizes the agent
class DelegationGrant(BaseModel):
    grant_id: str
    user_id: str
    agent_id: str
    scope: list[str]       # ["product_search", "checkout", "pay"]
    merchant_filter: list[str] | None   # None = any merchant
    max_amount: float
    currency: str
    expires_at: datetime
    issued_at: datetime

# AgentToken — the Visa Agentic Token equivalent
class AgentToken(BaseModel):
    token_id: str          # "agt_demo_<random>"
    agent_identity: AgentIdentity
    grant_id: str
    merchant_id: str
    max_amount: float
    currency: str
    token_hash: str        # HMAC-SHA256 over (token_id + grant_id + merchant + amount)
    expires_at: datetime
    status: str            # "active" | "used" | "expired"
```

#### ACP flow (additional steps before checkout)

```
Generic Shopping Agent
    |
    | [ACP only] Fetch user's DelegationGrant
    v
ACP Token Service
    |
    | Issue AgentToken scoped to: merchant=nike, max=$120, expiry=15min
    v
AgentToken  agt_demo_XYZ
    |
    | Attach to A2A task header
    v
Nike Merchant Agent
    |
    | [ACP only] Verify AgentToken (hash check, expiry, scope, merchant match)
    v
Token Valid → proceed to checkout
```

SSE events emitted during ACP path:

```python
"acp_grant_fetched"        # user's delegation grant retrieved
"acp_token_issued"         # AgentToken agt_demo_... created and signed
"acp_token_attached"       # token added to A2A task headers
"acp_token_verified"       # Nike agent verified the token
"acp_scope_checked"        # merchant + amount within grant scope
"acp_session_created"      # checkout session created under ACP authorization
```

### Endpoints added for ACP

```
POST /acp/delegation-grants          # user pre-authorizes the agent (called at session start)
GET  /acp/delegation-grants/{id}
POST /acp/agent-tokens               # issue a scoped AgentToken for a specific merchant
POST /acp/agent-tokens/{id}/verify   # merchant verifies incoming token
```

### UCP vs ACP toggle in the UI

The GenericChat page header (or chat input toolbar) gets a **protocol selector**:

```
Commerce Protocol:  [ UCP ]  [ ACP ]
```

Selecting a mode at session start determines which adapter runs. The **Protocol Trace panel
shows visibly different steps** depending on which is active:

**UCP path (trace):**
```
─── UCP ───>  POST /ucp/checkout-sessions
<── Nike ───  CheckoutSession (total: $118.42)
```

**ACP path (trace):**
```
─── ACP ───>  POST /acp/delegation-grants  (user pre-auth)
<── ACP ────  DelegationGrant  grant_abc
─── ACP ───>  POST /acp/agent-tokens  (scoped to nike, $120)
<── ACP ────  AgentToken  agt_demo_XYZ
─── A2A ───>  POST /a2a/nike/tasks/send  [Authorization: Bearer agt_demo_XYZ]
─── ACP ───>  Nike verifies AgentToken
<── ACP ────  Token valid — scope ✓ merchant ✓ amount ✓
─── ACP ───>  POST /acp/checkout-sessions
<── Nike ───  ACPCheckoutSession (total: $118.42, acp_token_ref: agt_demo_XYZ)
```

This makes the distinction tangible in the demo: ACP shows the delegation/trust layer that UCP
does not have. Presenters can switch between them to explain why ACP matters for autonomous agents.

### Color coding (updated)

- A2A → blue
- UCP → purple
- **ACP → indigo** (distinct from UCP purple — both are commerce but different trust models)
- AP2 → amber
- PSP → green
- HUMAN → neutral
- SYSTEM → gray

Endpoint:
```
POST /ucp/checkout-sessions   (UCP mode)
POST /acp/checkout-sessions   (ACP mode)
```

The Nike Merchant Agent calls the appropriate endpoint based on the session's active protocol.
The Generic Shopping Agent never calls checkout directly — it delegates to the merchant agent.

---

## AP2 Payment Layer

AP2 represents every purchase as **three signed Mandates** — W3C Verifiable Credentials signed
with ECDSA-P256. The merchant verifies all three in order; any mismatch rejects the payment.

| DPAT concept | AP2 real equivalent |
|---|---|
| `CheckoutObject` | Cart Mandate (VC signed by agent) |
| `checkout_hash` | ECDSA proof inside Cart Mandate |
| `DPATToken` | Payment Mandate (VC signed by agent) |
| `PaymentAuthorization` record | Intent Mandate (VC signed by user) |
| 12-check guardrail engine | Deterministic mandate verification |
| Mock processor | Mock PSP that verifies all three mandates |

### Real AP2 mandate JSON shapes

```json
// 1. Intent Mandate — signed by the USER's wallet at session start
//    "I authorize this agent to shop for me, up to $120 at Nike"
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://ap2-protocol.org/ns/v1"
  ],
  "type": ["VerifiableCredential", "IntentMandate"],
  "issuer": "did:ap2:user:user_abc123",
  "validFrom": "2026-10-05T10:21:40Z",
  "validUntil": "2026-10-05T10:36:40Z",
  "credentialSubject": {
    "agentId": "did:ap2:agent:generic_shopping_agent_v1",
    "canPurchaseOnBehalf": true,
    "constraints": {
      "maxAmount": { "value": 12000, "currency": "USD" },
      "merchantScope": ["nike_demo"],
      "category": "running_shoes"
    }
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "ecdsa-sd-2023",
    "created": "2026-10-05T10:21:40Z",
    "proofValue": "z3FXBpJFTamJVQ..."
  }
}

// 2. Cart Mandate — signed by the AGENT after product selection
//    "I assembled this cart with these items and this total"
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://ap2-protocol.org/ns/v1"
  ],
  "type": ["VerifiableCredential", "CartMandate"],
  "issuer": "did:ap2:agent:generic_shopping_agent_v1",
  "validFrom": "2026-10-05T10:21:49Z",
  "credentialSubject": {
    "intentMandateId": "intent_mandate_abc",
    "merchant": { "id": "nike_demo", "name": "Nike" },
    "lineItems": [
      {
        "sku": "nike_pegasus_42_black_10",
        "title": "Nike Air Zoom Pegasus 42",
        "size": "10",
        "quantity": 1,
        "unitPrice": { "value": 9999, "currency": "USD" }
      }
    ],
    "totals": {
      "subtotal": { "value": 9999, "currency": "USD" },
      "shipping": { "value": 1000, "currency": "USD" },
      "tax":      { "value": 843,  "currency": "USD" },
      "total":    { "value": 11842, "currency": "USD" }
    }
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "ecdsa-sd-2023",
    "created": "2026-10-05T10:21:49Z",
    "proofValue": "zABCDEFghijklm..."
  }
}

// 3. Payment Mandate — signed by the AGENT after user clicks APPROVE & PAY
//    "Charge exactly $118.42 to this instrument for this cart"
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://ap2-protocol.org/ns/v1"
  ],
  "type": ["VerifiableCredential", "PaymentMandate"],
  "issuer": "did:ap2:agent:generic_shopping_agent_v1",
  "validFrom": "2026-10-05T10:21:50Z",
  "validUntil": "2026-10-05T10:36:50Z",
  "credentialSubject": {
    "cartMandateId": "cart_mandate_xyz",
    "paymentInstrumentRef": "mock_card_4242",
    "chargeAmount": { "value": 11842, "currency": "USD" },
    "merchant": "nike_demo",
    "nonce": "nonce_abc123abc456",
    "singleUse": true
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "ecdsa-sd-2023",
    "created": "2026-10-05T10:21:50Z",
    "proofValue": "zGHIJKLmnopqrs..."
  }
}
```

The mock PSP verifies all three mandates:
1. Intent Mandate signature valid + not expired + agent matches
2. Cart Mandate linked to Intent Mandate + total within Intent's maxAmount
3. Payment Mandate linked to Cart Mandate + charge amount equals cart total + not used + not expired

These checks are deterministic ECDSA verifications — no LLM involved.

New `ap2/adapter.py` wraps the existing DPAT signing with the mandate structure and emits named steps:

```python
# Steps emitted as protocol_event SSE events:
"ap2_intent_mandate_created"    # user authorizes agent at session start
"ap2_cart_mandate_created"      # agent signs the assembled cart
"ap2_payment_mandate_created"   # agent signs the payment authorization
"ap2_mandates_submitted"        # all three sent to Mock PSP
"ap2_intent_verified"           # Intent Mandate: signature + expiry ✓
"ap2_cart_verified"             # Cart Mandate: linked to Intent + amount within limit ✓
"ap2_payment_verified"          # Payment Mandate: amount matches cart + single-use ✓
"ap2_payment_approved"          # all checks passed
```

---

## Merchant Selection Logic

**Short answer: this is NOT UCP.** UCP only handles the cart and checkout once you already know which merchant to buy from. Merchant *discovery* — deciding which websites/agents to call — is the Generic Shopping Agent's own job, done before any protocol is invoked.

### How the agent decides which merchants to contact

**Step 1 — Parse the user's message**

The agent reads the message and extracts a `ShoppingIntent`:

| User says | Brand | Category | Price | Size |
|---|---|---|---|---|
| "I want Nike shoes under $120, size 10" | Nike | running | < $120 | 10 |
| "I want shoes under $100" | *(none)* | shoes | < $100 | *(none)* |
| "Find me Adidas sneakers" | Adidas | sneakers | *(none)* | *(none)* |

**Step 2 — Merchant Registry lookup**

There is a local **Merchant Registry** — a simple JSON/dict that lists every merchant agent available in the demo system, tagged by category:

```json
// backend/data/merchant_registry.json
[
  {
    "id": "nike",
    "name": "Nike",
    "categories": ["running", "shoes", "sneakers", "apparel"],
    "a2a_url": "http://localhost:8000/a2a/nike"
  },
  {
    "id": "adidas",
    "name": "Adidas",
    "categories": ["running", "shoes", "sneakers", "apparel"],
    "a2a_url": "http://localhost:8000/a2a/adidas"
  }
]
```

**Step 3 — Route: brand known vs brand unknown**

```
User says "I want NIKE shoes"          User says "I want shoes"
        │                                       │
        │  brand = "nike"                       │  brand = None, category = "shoes"
        ▼                                       ▼
  Registry lookup:                      Registry lookup:
  filter by brand "nike"                filter by category "shoes"
        │                                       │
        ▼                                       ▼
  [nike]  ← only one merchant           [nike, adidas]  ← all matching merchants
        │                                       │
        ▼                                       ▼
  A2A call to Nike agent only           A2A calls to Nike + Adidas IN PARALLEL
                                        Results merged → ranked by price/rating
                                        → shown as combined product list
```

When a brand IS mentioned → direct route to that one merchant agent.
When NO brand is mentioned → broadcast to all merchants whose category list matches → parallel A2A calls → aggregate results.

**Step 4 — A2A calls happen AFTER routing**

Only after the routing decision is made does any protocol fire. A2A is the first protocol:

```
routing decision: [nike, adidas]
  │
  ├─ A2A → GET /a2a/nike/.well-known/agent.json   (read Nike's capabilities)
  │         POST /a2a/nike  message/send           (ask Nike for matching products)
  │
  └─ A2A → GET /a2a/adidas/.well-known/agent.json
            POST /a2a/adidas  message/send
```

UCP/ACP only start AFTER the user selects a specific product — by then we know the exact merchant.

**Protocol sequence summary:**

```
1. LLM parses message → ShoppingIntent            (LLM — no protocol)
2. Registry lookup → list of merchant IDs         (local data — no protocol)
3. A2A → fetch each merchant's Agent Card         (A2A protocol)
4. A2A → send product search task to each         (A2A protocol)
5. Aggregate results → show ProductCards          (local — no protocol)
6. User picks a product                           (HUMAN)
7. UCP → create checkout session                  (UCP protocol — NOW starts)
8. ACP → issue SPT (if UCP+ACP mode)              (ACP protocol)
9. AP2 → three mandates → payment                 (AP2 protocol)
```

### Code shape

```python
# backend/agents/generic_shopping_agent.py

async def route_to_merchants(intent: ShoppingIntent) -> list[str]:
    if intent.brand:
        return [intent.brand.lower()]             # e.g. ["nike"]
    return await discover_merchants(intent.category)  # e.g. ["nike", "adidas"]

async def discover_merchants(category: str) -> list[str]:
    registry = load_merchant_registry()           # reads merchant_registry.json
    return [m["id"] for m in registry if category in m["categories"]]

async def run(user_message: str, session_id: str, sse_queue):
    intent = parse_intent(user_message)           # LLM extracts brand/category/price/size
    merchants = await route_to_merchants(intent)

    # Parallel A2A calls to all selected merchants
    tasks = [call_merchant_agent(m, intent, sse_queue) for m in merchants]
    results = await asyncio.gather(*tasks)

    products = aggregate_and_rank(results)        # merge + sort by relevance/price
    # emit products → wait for user selection → then UCP/ACP/AP2
```

Each `call_merchant_agent` call:
1. `GET /a2a/{merchant}/.well-known/agent.json` → emits `a2a_agent_card_fetched` event
2. `POST /a2a/{merchant}` with JSON-RPC `message/send` → emits `a2a_task_sent` event
3. Awaits response → emits `a2a_task_completed` event with product count

### What this looks like in the Protocol Trace panel

```
10:21:40  🤖 Agent parsed: category=shoes, no brand → checking registry
10:21:41  ─── A2A ──>  GET /a2a/nike/.well-known/agent.json
10:21:41  <── Nike ─   Agent Card received
10:21:41  ─── A2A ──>  GET /a2a/adidas/.well-known/agent.json
10:21:41  <── Adidas   Agent Card received
10:21:41  ─── A2A ──>  POST /a2a/nike   message/send  "shoes under $100"
10:21:41  ─── A2A ──>  POST /a2a/adidas message/send  "shoes under $100"  (parallel)
10:21:42  <── Nike ─   4 products returned
10:21:42  <── Adidas   3 products returned
10:21:42  🤖 Agent ranked 7 results — showing top 5
10:21:42  👤 HUMAN — waiting for product selection
```

If the user had said "Nike shoes", lines for Adidas would not appear — only Nike is contacted.

---

## Product Results — Show More + Filtering

All results from all merchants are fetched in the initial parallel A2A calls and stored in frontend
state. No extra network calls happen when the user browses, expands, or filters results.

### Default view — top 3 ranked cards

```
🤖  Found 7 shoes under $100 across Nike and Adidas.
    Here are the top results:

    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Nike Free Run│  │Nike Pegasus42│  │Adidas Solar  │
    │    $89.99    │  │   $99.99     │  │   $99.99     │
    │   ★ 4.7      │  │   ★ 4.6      │  │   ★ 4.5      │
    │  [Select]    │  │  [Select]    │  │  [Select]    │
    └──────────────┘  └──────────────┘  └──────────────┘

    + 4 more results  ▾
```

### User clicks "+ 4 more results" — expands inline, no new A2A call

```
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Nike Air Max │  │ Adidas Run   │  │ Nike React   │  │ Adidas Boost │
    │   $95.99     │  │   $94.99     │  │   $97.99     │  │   $98.99     │
    │   ★ 4.4      │  │   ★ 4.3      │  │   ★ 4.3      │  │   ★ 4.2      │
    │  [Select]    │  │  [Select]    │  │  [Select]    │  │  [Select]    │
    └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

### Filter bar — client-side only, no new requests

```
    [ Nike only ]  [ Adidas only ]  [ Under $90 ]  [ Sort: Price ↑ ]
```

- **Nike only / Adidas only** — filter `products` array by `brand` field
- **Under $90** — filter by `price < 90`
- **Sort: Price ↑ / Price ↓ / Rating** — re-sort the array

All filters stack. "Nike only + Under $90" shows only Nike products priced below $90.

### Frontend state shape

```ts
interface ProductSearchState {
  allResults: ProductData[]      // full merged list from all merchants
  visibleCount: number           // starts at 3, +4 on "show more"
  filters: {
    brand: string | null         // "nike" | "adidas" | null
    maxPrice: number | null
  }
  sortBy: 'price_asc' | 'price_desc' | 'rating'
}
```

Selecting a product clears the results panel and moves to the checkout phase.
The filter bar and "show more" button disappear once a product is selected.

---

## SSE Event Taxonomy (New for Demo 2)

Existing Demo 1 events: `step_start`, `step_done`, `recommendation`, `error`

New Demo 2 events (all serialized into the same SSE stream). Both UCP and ACP events use the
same `protocol_event` type — the `protocol` field (`"UCP"` vs `"ACP"`) drives the color in the
trace panel, making the two paths visually distinct without needing separate event types:

```python
# Protocol event — drives right-side ProtocolTracePanel
{ "type": "protocol_event", "data": {
    "ts": "10:21:41",
    "source": "Shopping Agent",
    "target": "Nike Agent",
    "protocol": "A2A",
    "direction": "outbound",          # outbound | inbound | internal | human
    "label": "GET agent card",
    "detail": { ... raw payload ... } # shown in expandable row
}}

# Human approval boundary — pauses agent flow until user acts
{ "type": "awaiting_human", "data": {
    "reason": "product_selection",
    "products": [ ... ]
}}

# Also: awaiting_human for "approve_pay"
{ "type": "awaiting_human", "data": {
    "reason": "approve_pay",
    "checkout_session": { ... }
}}
```

---

## Right-Side Panel: ProtocolTracePanel

### Problem with the current AgentTrailPanel

The existing panel shows 6 static horizontal nodes. This works well for Demo 1's linear pipeline.
For Demo 2, the interesting story is the **protocol messages flowing between agents**, not the
node states. A horizontal pipeline doesn't convey directionality, latency, or message content.

### Proposed design: Toggle buttons — Pipeline / Protocol Trace

The panel header has two buttons that switch the active view. Both views are always available;
clicking a button swaps the content area without any navigation or modal.

```
┌─────────────────────────────────────────────────────────────┐
│                          ┌──────────┐  ┌────────────────┐   │
│                          │ Pipeline │  │ Protocol Trace │   │
│                          └──────────┘  └────────────────┘   │
│                          (inactive)      (active — filled)   │
└─────────────────────────────────────────────────────────────┘
```

Styled as a **segmented control** (pill-shaped container, active button has filled background,
inactive is ghost). One tap switches instantly — no re-fetch, no loading state.

**Button 1 — Pipeline:** high-level 6-node flowchart showing the overall agent journey at a glance — good for audiences seeing the app for the first time

**Button 2 — Protocol Trace:** chronological event log showing every actual HTTP call, protocol message, and verification step — the default view, and the main story of this demo

#### Auto-activate behavior

When the user starts on Pipeline view and the first `protocol_event` SSE item arrives, the
Protocol Trace button gets a **dot badge** (small colored indicator, not a number) and a subtle
pulse animation. This draws attention without forcing a view switch. If the user ignores it, a
second `protocol_event` **auto-flips** the active view to Protocol Trace once — after that the
user's manual selection is respected and no more auto-flips happen.

```tsx
// Rough state logic in ProtocolTracePanel
const [activeView, setActiveView] = useState<'pipeline' | 'trace'>('trace')
const [hasAutoFlipped, setHasAutoFlipped] = useState(false)
const [traceBadge, setTraceBadge] = useState(false)

useEffect(() => {
  if (newProtocolEvent && activeView === 'pipeline') {
    if (!hasAutoFlipped) {
      setTraceBadge(true)           // first event: just show badge
      // second event triggers the flip
    } else {
      setActiveView('trace')        // flip once
      setHasAutoFlipped(true)
      setTraceBadge(false)
    }
  }
}, [newProtocolEvent])
```

The badge clears as soon as the user clicks Protocol Trace manually.

```
┌─────────────────────────────────────────────────────────────┐
│  PROTOCOL TRACE                                             │
│                    ┌──────────┐  ┌────────────────●┐        │
│                    │ Pipeline │  │ Protocol Trace  │        │
│                    └──────────┘  └─────────────────┘        │
│                                    ↑ dot badge + pulse       │
├─────────────────────────────────────────────────────────────┤
│  10:21:41  🤖 Shopping Agent                                 │
│            ✓ Intent parsed — Nike shoes <$120, size 10       │
│                                                             │
│  10:21:41  ─── A2A ──────────────────────────────────────>  │
│            GET /a2a/nike/.well-known/agent-card             │
│            ↓ Agent Card received                [expand ▾]  │
│                                                             │
│  10:21:41  ─── A2A ──────────────────────────────────────>  │
│            POST /a2a/nike/tasks/send                        │
│            task_id: task_abc123                 [expand ▾]  │
│                                                             │
│  10:21:42  <── Nike Agent ──────────────────────────────    │
│            5 products returned                  [expand ▾]  │
│                                                             │
│  10:21:49  👤 HUMAN                                         │
│            Product selected                                 │
│            SKU: nike_pegasus_42_black_10                    │
│                                                             │
│  10:21:49  ─── UCP ───────────────────────────────────────> │
│            POST /ucp/checkout-sessions                      │
│            ↓ CheckoutSession created            [expand ▾]  │
│            total: $118.42                                   │
│                                                             │
│  10:21:50  ─── AP2 ───────────────────────────────────────> │
│            ✓ Checkout hash  sha256:3fa2…                    │
│            ✓ Checkout Mandate  mandate_789                  │
│            ✓ Payment Mandate                                │
│            ✓ Token issued  ptk_demo_ABC123                  │
│                                                             │
│  10:21:50  Mock PSP                                         │
│            ✓ Merchant verified                              │
│            ✓ Amount verified                                │
│            ✓ Checkout binding verified                      │
│            ✓ Single-use verified                            │
│            ✓ PAYMENT APPROVED                               │
│                                                             │
│  10:21:51  ✓ Loyalty points awarded                         │
│            ✓ Order created  TS-2026-00127                   │
│            ✓ Tracking initialized                           │
└─────────────────────────────────────────────────────────────┘
```

### AgentInteractionCard component

Each row in the trace is an `AgentInteractionCard`:

```tsx
interface ProtocolEvent {
  ts: string
  source: string
  target?: string
  protocol: 'A2A' | 'UCP' | 'ACP' | 'AP2' | 'PSP' | 'SYSTEM' | 'HUMAN'
  direction: 'outbound' | 'inbound' | 'internal' | 'human'
  label: string
  detail?: Record<string, unknown>   // expandable raw JSON
  status?: 'pending' | 'ok' | 'error'
}
```

Color coding:
- A2A → blue (inter-agent)
- UCP/ACP → purple (commerce protocol)
- AP2 → amber (payment authorization)
- PSP → green (payment settled)
- HUMAN → white/neutral (user action)
- SYSTEM → gray (internal)

Arrow direction: outbound events render `────>`, inbound render `<────`, internal render `▷`.

Expandable detail: clicking `[expand]` shows the raw JSON payload in a code block with syntax
highlighting. Raw card numbers and PII are never included in these payloads.

---

## App Pages

### Page 1 — Login (`/`)

Simple login form. On success → redirect to `/chat`.
Guest option: "Continue as Guest" skips login and starts a guest session.

```
┌──────────────────────────────────────┐
│           TalkShop                   │
│                                      │
│   Email     [________________]       │
│   Password  [________________]       │
│                                      │
│         [ Sign In ]                  │
│                                      │
│   ── or ──                           │
│   [ Continue as Guest ]              │
└──────────────────────────────────────┘
```

Authenticated users see their saved cards or an inline hosted-fields form.
Guest users see the pre-registered demo payment instruments — no card entry needed.

---

### Page 2 — Chat (`/chat`)

This is the entire app after login. Three columns:

```
┌──────────────┬────────────────────────────────────┬──────────────────────┐
│  Sessions    │           Chat                     │   Protocol Trace     │
│  (sidebar)   │                                    │                      │
│              │  [chat bubbles]                    │  [ Pipeline | Trace ]│
│  Session 1   │  [ProductCards on search result]   │                      │
│  Session 2   │  [InlineCheckout on payment]       │  10:21:41 A2A ──>   │
│  ...         │  [InlineOrderTracker on confirm]   │  10:21:42 <── Nike  │
│              │                                    │  10:21:49 👤 HUMAN  │
│              │  Protocol:  [ UCP ]  [ UCP+ACP ]   │  10:21:49 UCP ──>   │
│              │  [chat input box]                  │  10:21:50 ACP ──>   │
│              │                                    │  10:21:50 AP2 ──>   │
└──────────────┴────────────────────────────────────┴──────────────────────┘
```

The center column handles two explicit human approval moments:

**Moment 1 — Product Selection:**
```
┌─────────────────────────────────────────────────────┐
│  Found 5 Nike running shoes. Please select one:     │
│  [ProductCard] [ProductCard] [ProductCard] ...       │
│  ⚠ Product selection requires your approval         │
└─────────────────────────────────────────────────────┘
```
Clicking a card emits a `select_product` event; the agent resumes.

**Moment 2 — Approve & Pay:**
Reuse InlineCheckout's summary phase, but rename the CTA to "APPROVE & PAY".
Clicking it starts the AP2 flow.

---

## Merchant Catalogs (Synthetic — We Build These)

All merchant catalogs are **synthetic JSON files we create ourselves** and serve locally.
No real brand APIs are called. Each merchant agent reads its own local JSON file when it
receives an A2A product search task and filters results in-process.

### Why synthetic?

- No API keys, no rate limits, no network dependency
- We control the data — can guarantee any query always returns results
- Can add edge cases (out of stock, low stock, size unavailable) for demo variation
- Runs fully offline

### 6 Merchants across 3 categories

| Merchant | Categories | Price range | Products |
|---|---|---|---|
| **Nike** | shoes, sportswear, running | $80–$180 | 12–15 items |
| **Adidas** | shoes, sportswear, running | $75–$160 | 10–12 items |
| **Zara** | clothing, dresses, tops, women | $25–$120 | 12–15 items |
| **H&M** | clothing, dresses, tops, women, men | $15–$80 | 12–15 items |
| **Fossil** | watches, accessories, men, women | $80–$250 | 8–10 items |
| **Casio** | watches, accessories | $30–$150 | 8–10 items |

```
backend/data/
  nike_catalog.json      # 12–15 Nike shoes + sportswear
  adidas_catalog.json    # 10–12 Adidas shoes + sportswear
  zara_catalog.json      # 12–15 Zara clothing, dresses, tops
  hm_catalog.json        # 12–15 H&M clothing, dresses, tops
  fossil_catalog.json    # 8–10 Fossil watches + accessories
  casio_catalog.json     # 8–10 Casio watches
  merchant_registry.json # all 6 merchants + categories + A2A URLs
  demo_instruments.json  # 2 pre-registered guest payment instruments
```

### Merchant registry — `backend/data/merchant_registry.json`

```json
[
  { "id": "nike",   "name": "Nike",   "categories": ["shoes","sportswear","running","sneakers"],
    "a2a_url": "http://localhost:8000/a2a/nike" },
  { "id": "adidas", "name": "Adidas", "categories": ["shoes","sportswear","running","sneakers"],
    "a2a_url": "http://localhost:8000/a2a/adidas" },
  { "id": "zara",   "name": "Zara",   "categories": ["clothing","dresses","tops","women","fashion"],
    "a2a_url": "http://localhost:8000/a2a/zara" },
  { "id": "hm",     "name": "H&M",    "categories": ["clothing","dresses","tops","women","men","fashion"],
    "a2a_url": "http://localhost:8000/a2a/hm" },
  { "id": "fossil", "name": "Fossil", "categories": ["watches","accessories","men","women"],
    "a2a_url": "http://localhost:8000/a2a/fossil" },
  { "id": "casio",  "name": "Casio",  "categories": ["watches","accessories"],
    "a2a_url": "http://localhost:8000/a2a/casio" }
]
```

### Product schema — same shape across all 6 catalogs

```json
{
  "id": "nike_pegasus_42_black_10",
  "title": "Nike Air Zoom Pegasus 42",
  "brand": "Nike",
  "category": "running",
  "subcategory": "shoes",
  "price": 99.99,
  "currency": "USD",
  "variants": [
    { "size": "9",  "color": "Black/White", "available": true,  "inventory": 8  },
    { "size": "10", "color": "Black/White", "available": true,  "inventory": 12 },
    { "size": "11", "color": "Black/White", "available": false, "inventory": 0  },
    { "size": "10", "color": "Grey/Blue",   "available": true,  "inventory": 4  }
  ],
  "shipping_days": 2,
  "rating": 4.6,
  "review_count": 1240,
  "image_url": "/assets/nike_pegasus_42.png",
  "sku": "nike_pegasus_42",
  "description": "Lightweight daily trainer with React foam cushioning."
}
```

Variants let the agent show "size 11 is out of stock" — a realistic edge case.

### Sample products per merchant

**Nike** ($80–$180): Pegasus 42, Free Run 5.0, Vomero 18, Zoom Fly 6, Air Max 270,
React Infinity Run, Metcon 9, Dri-FIT T-shirt, Pro Compression Shorts, Air Force 1

**Adidas** ($75–$160): Ultraboost 22, Solarboost 4, Supernova Rise, SL20.3, Forum Low,
Terrex Trail, Adicolor T-shirt, Tiro Track Pants, NMD R1, Gazelle Bold

**Zara** ($25–$120): Floral Midi Dress, Satin Slip Dress, Linen Blazer, Wide-Leg Trousers,
Ribbed Knit Top, Flowy Maxi Dress, Cropped Jacket, Printed Blouse, Tailored Shorts, Evening Gown

**H&M** ($15–$80): Cotton Wrap Dress, Printed Maxi Dress, Oversized Shirt, Slim Fit Jeans,
Jersey Dress, Linen Shorts, V-Neck Tee, Floral Blouse, Cargo Pants, Knit Cardigan

**Fossil** ($80–$250): Gen 6 Smartwatch, Neutra Chronograph, Minimalist Watch, Pilot Chronograph,
Machine Automatic, Ladies Carlie Watch, Hybrid Smartwatch HR, Nate Chronograph

**Casio** ($30–$150): G-Shock GA-2100, F-91W Classic, Edifice EFR-303, Pro Trek PRW-3500,
G-Shock GBD-200, Baby-G BGA-310, Databank CA-53W, G-Shock GW-M5610

### Demo query → merchant routing examples

```
"Nike shoes under $120"          → Nike only (brand known)
"running shoes under $100"       → Nike + Adidas (category: running/shoes)
"a dress under $60"              → Zara + H&M (category: dresses)
"watches under $100"             → Fossil + Casio (category: watches)
"something casual under $50"     → H&M + Casio (broad → LLM picks most relevant)
"birthday gift under $80"        → H&M + Casio + Zara (gift → LLM infers categories)
"sportswear"                     → Nike + Adidas (category: sportswear)
```

### How each merchant agent uses its catalog

```python
# backend/a2a/merchants/nike.py  (same pattern for all 6 merchants)

def search_catalog(intent: ShoppingIntent) -> list[dict]:
    catalog = load_json("backend/data/nike_catalog.json")
    results = []
    for product in catalog:
        if intent.category and intent.category not in product["category"]:
            continue
        if intent.max_price and product["price"] > intent.max_price:
            continue
        # filter variants by size if specified
        matching_variants = [
            v for v in product["variants"]
            if (not intent.size or v["size"] == intent.size)
        ]
        if matching_variants:
            results.append({**product, "variants": matching_variants})
    return results
```

All 6 merchant agents share the same handler pattern — only the catalog file differs.
The Shopping Agent never sees the files; it just receives A2A task artifacts back.

---

## Payment Data Isolation

Raw card data NEVER leaves the frontend. Flow:

```
Frontend form (card number, expiry, CVV)
      |
      | (stays in browser)
      v
Mock Tokenizer (frontend utility)
      |
      v
mock_instrument_id: "mock_card_4242"
      |
      v  (only this travels over the wire)
AP2 / DPAT layer → Payment Token (ptk_demo_...)
```

The `protocol_event` SSE events, the A2A task payloads, and the trace panel all contain only
`mock_instrument_id` and the derived `ptk_demo_...` token. The card number is never logged.

---

## Implementation Sequence

**Before starting:** create branch `v3-generic-agent` from `main`. The full existing stack carries over — nothing is deleted. LangGraph, MCP server, Dashboard, AgentTrailPanel, Cart, Compare, CartUp, Shopify/BestBuy adapters all remain intact. New files are added alongside the existing ones.

0. **Login page** — `frontend/src/pages/Login.tsx` at route `/`. On success → `/chat`. "Continue as Guest" → `/chat` with guest session. Re-use existing `backend/auth/` JWT endpoints unchanged.

1. **A2A layer** — `backend/a2a/` models, client, Nike server. Wire into FastAPI via `backend/routers/a2a.py`. Smoke-test with `curl /a2a/nike/.well-known/agent.json`.

2. **Nike catalog** — `backend/data/nike_catalog.json` + Nike merchant agent handler that filters/returns products in A2A task response format.

3. **Generic Shopping Agent** — `backend/agents/generic_shopping_agent.py`. Intent parse (reuse VibeCheck's `extract_intent`), merchant routing, A2A calls, product aggregation. No LLM in the checkout/payment path.

4. **SSE endpoint** — `GET /api/chat/stream`. Drives generic_shopping_agent, emits `protocol_event` SSE items. Human approval boundaries pause the generator until a resume signal arrives via `POST /api/chat/resume`.

5. **UCP adapter** — `backend/ucp/adapter.py` wrapping CartUp, emitting `ucp_session_created` protocol event. Adds `POST /ucp/checkout-sessions`.

5a. **ACP adapter** — `backend/acp/` with `DelegationGrant`, `AgentToken` models and mock Visa Agentic Token signing. Adds `/acp/delegation-grants`, `/acp/agent-tokens`, `/acp/agent-tokens/{id}/verify` routes. Emits the 6 ACP-specific protocol events so the trace panel shows the delegation chain steps. Both UCP and ACP share the same `CommerceProtocol` interface in `backend/commerce/protocol.py` — the session's active mode selects the adapter at runtime.

6. **AP2 adapter** — `backend/ap2/adapter.py` wrapping DPAT signing. Adds named step events so the trace panel shows each mandate creation step.

7. **ProtocolTracePanel** — new React component. Subscribes to `protocol_event` SSE items, renders scrolling trace with expandable rows. Tabs toggle between this and the existing pipeline view.

8. **GenericChat page** — new route `/demo2`. Connects to `/api/v2/chat/stream`. Handles human approval moments. Renders ProtocolTracePanel on the right.

9. **Adidas agent** (optional) — copy Nike agent structure, different catalog, enables multi-merchant demo.

---

## What This Branch Adds (Nothing Is Removed)

This branch builds **on top of** the existing codebase. Every existing feature stays:

| Existing — kept as-is | New — added by this branch |
|---|---|
| LangGraph pipeline (VibeCheck, SneakPeek, CartUp, GreenLight, PayIt, TrackIt) | Generic Shopping Agent |
| AgentTrailPanel (6-node pipeline view) | ProtocolTracePanel (protocol event trace) |
| Dashboard, Compare, Cart drawer | Login page, Chat page |
| Shopify / BestBuy / DummyJSON adapters | Nike / Adidas A2A merchant agents |
| MCP server | A2A layer (models, client, server) |
| DPAT signing | AP2 adapter (wraps DPAT as three mandates) |
| Auth, DB, models, loyalty, order | UCP adapter, ACP adapter |

New routes (`/`, `/chat`, `/api/chat/stream`, `/a2a/*`, `/ucp/*`, `/acp/*`, `/ap2/*`) are added
alongside existing routes. Nothing is overwritten or removed.

---

## Key Design Principle

This app is accurately described as:

> **Protocol-faithful local simulation.** External parties (Nike backend, bank, card network, PSP, loyalty provider) are mocked. Every protocol interaction is real — actual HTTP calls, structured A2A messages with task IDs and context IDs, UCP checkout sessions, ACP Shared Payment Tokens, AP2 Verifiable Credential mandates, ECDSA signatures, and deterministic validation. Nothing is a setTimeout animation.

The right-side Protocol Trace panel makes this visible in real time: every row maps to a real backend event.

---

## End-to-End Flow Diagram — Simple Version

This is the full journey from user message to order confirmed, in plain English and simple boxes.

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER TYPES:  "I need Nike running shoes under $120, size 10"        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GENERIC SHOPPING AGENT                                             │
│  • Reads the message                                                │
│  • Figures out: brand=Nike, max_price=$120, size=10                 │
│  • Decides: go talk to the Nike Agent                               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  A2A Step 1 — "Who are you?"
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GET /a2a/nike/.well-known/agent.json                               │
│  ← Nike Agent Card received                                         │
│    "I am the Nike Agent. I can search, checkout, track orders."     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  A2A Step 2 — "Find me shoes"
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /a2a/nike   {jsonrpc: "2.0", method: "message/send", ...}     │
│  ← Nike Agent returns Task result with 5 products as artifacts      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  👤 HUMAN DECISION — "Which shoe do you want?"                      │
│  ProductCards shown in chat. User clicks one.                       │
│  Agent is PAUSED until user picks.                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │  UCP mode                   │  ACP mode
              ▼                             ▼
┌─────────────────────────┐  ┌─────────────────────────────────────┐
│  POST /ucp/checkout-    │  │  1. POST /acp/payment-tokens        │
│       sessions          │  │     ← SPT issued (spt_demo_...)     │
│  ← CheckoutSession with │  │     (bounded to nike, max $120)     │
│    line items + total   │  │  2. POST /acp/checkout-sessions     │
│    $118.42              │  │     (SPT travels with the cart)     │
└────────────┬────────────┘  │  ← CheckoutSession + SPT ref       │
             │               └──────────────┬──────────────────────┘
             └──────────────┬───────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ORDER SUMMARY shown in chat                                        │
│  Product / Subtotal / Shipping / Tax / TOTAL: $118.42               │
│                                                                     │
│  👤 HUMAN DECISION — User clicks [ APPROVE & PAY ]                 │
│  Agent is PAUSED again until user confirms.                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  AP2 — Three Mandates
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Mandate 1 — Intent Mandate  (already signed at session start)      │
│    "User authorized agent to buy Nike shoes up to $120"             │
│    Signed: user's key  ·  Verified: ✓                               │
│                                                                     │
│  Mandate 2 — Cart Mandate   (signed now by agent)                   │
│    "Agent assembled: Pegasus 42, size 10, total $118.42"            │
│    Signed: agent's key  ·  Links to Intent Mandate  ✓              │
│                                                                     │
│  Mandate 3 — Payment Mandate (signed now by agent)                  │
│    "Charge $118.42 to mock_card_4242, single-use, 15 min expiry"    │
│    Signed: agent's key  ·  Links to Cart Mandate  ✓                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │  All three mandates sent to Mock PSP
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MOCK PAYMENT PROVIDER  — deterministic checks only, no LLM         │
│  ✓ Intent Mandate signature valid + not expired                     │
│  ✓ Cart total within Intent's maxAmount ($118.42 < $120)            │
│  ✓ Cart Mandate links to Intent Mandate                             │
│  ✓ Payment Mandate links to Cart Mandate                            │
│  ✓ Charge amount = cart total                                       │
│  ✓ Token not yet used (single-use enforced)                         │
│  ✓ Token not expired (issued < 15 min ago)                          │
│                                                                     │
│  → PAYMENT APPROVED                                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       Loyalty points    Order created   Tracking
       awarded           TS-2026-00127   initialized
```

---

## Protocol Map — Which Standard Each Step Follows

```
USER MESSAGE
    └── Shopping Agent understands it                [LLM — VibeCheck]

FIND MERCHANT
    └── Read Nike's Agent Card                       [A2A — agent.json]
    └── Send product search task                     [A2A — JSON-RPC 2.0]
    └── Receive product artifacts                    [A2A — task result]

CHECKOUT  (choose one)
    ├── UCP: POST /checkout-sessions                 [UCP — ucp.dev spec]
    └── ACP: SPT issued → checkout with token        [ACP — Stripe/OpenAI spec]

PAYMENT AUTHORIZATION
    └── Intent Mandate (user signs at start)         [AP2 — google-agentic-commerce]
    └── Cart Mandate   (agent signs after selection) [AP2]
    └── Payment Mandate (agent signs on APPROVE)     [AP2]
    └── PSP verifies all three mandates              [AP2 — deterministic ECDSA]

POST-PAYMENT
    └── Loyalty points                               [internal]
    └── Order record                                 [internal DB]
    └── Tracking initialized                         [TrackIt agent]
```

---

## Sources — Real Protocol Specs

| Protocol | What it is | Official spec |
|---|---|---|
| A2A | Google's agent-to-agent communication standard | [a2a-protocol.org](https://a2a-protocol.org/latest/specification/) · [GitHub](https://github.com/a2aproject/A2A) |
| UCP | Universal Commerce Protocol — standard cart + checkout for AI agents | [ucp.dev](https://ucp.dev/documentation/core-concepts/) · [Google Merchant docs](https://developers.google.com/merchant/ucp/guides/checkout/native) |
| ACP | Agentic Commerce Protocol (OpenAI + Stripe) — checkout with Shared Payment Tokens | [Stripe SPT docs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens) |
| AP2 | Agent Payments Protocol (Google) — three signed Verifiable Credential mandates | [GitHub](https://github.com/google-agentic-commerce/AP2) · [AP2 guide](https://arthurchiao.art/blog/ap2-illustrated-guide/) |
