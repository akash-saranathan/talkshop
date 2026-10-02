# Agentic Commerce POC — Custom Payment Authorization Design

## 1. Purpose

This POC demonstrates how an AI shopping agent can discover products, help a user select an item, and complete a purchase **without giving the agent direct access to the customer's underlying payment credentials**.

The payment authorization layer is **our own custom service**. It is not tied to Stripe, Visa, Mastercard, or any specific bank network.

The main idea is:

> The AI agent can request a purchase, but a deterministic payment authorization service decides whether the transaction is allowed.

This allows us to demonstrate agentic commerce while preserving:
- Customer consent
- Agent identity
- Merchant restrictions
- Amount restrictions
- Time-based authorization
- Risk checks
- Human approval
- Full auditability

---

## 2. Demo Scenario

### User request

> "I need a black running shoe, size 11, below $120, and I need it delivered within one week."

The system should:

1. Understand the user intent.
2. Search trusted merchant catalogs.
3. Return matching products.
4. Let the user select one.
5. Generate a checkout quote.
6. Ask the user to approve the purchase.
7. Create a temporary delegated payment authorization.
8. Validate the payment request.
9. Simulate or execute the payment through a test gateway.
10. Record the complete transaction trail.

---

## 3. High-Level Architecture

```text
+------------------+
|      Customer    |
+--------+---------+
         |
         | Natural-language shopping request
         v
+--------------------------+
|      Shopping Agent      |
|  Intent Understanding    |
+------------+-------------+
             |
             | MCP tool calls
             v
+--------------------------+
|      MCP Tool Layer      |
| search_products          |
| check_inventory          |
| get_quote                |
| create_order             |
+------------+-------------+
             |
             v
+--------------------------+
| Trusted Merchant Layer   |
| Product / Pricing / Cart |
+------------+-------------+
             |
             | Checkout quote
             v
+--------------------------+
|     User Approval UI     |
+------------+-------------+
             |
             | Explicit consent
             v
+-------------------------------+
| Custom Payment Authorization  |
| Service                       |
|                               |
| - Consent validation          |
| - Agent validation            |
| - Merchant validation         |
| - Amount limits               |
| - Expiry                      |
| - Policy checks               |
+---------------+---------------+
                |
                | Delegated Payment Token
                v
+-------------------------------+
|      Agentic Payment Gateway  |
|                               |
| - Token validation            |
| - Policy validation           |
| - Risk checks                 |
| - Payment routing             |
+---------------+---------------+
                |
                v
+-------------------------------+
| Test / Simulated Payment Rail |
+---------------+---------------+
                |
                v
+-------------------------------+
| Audit + Order Confirmation    |
+-------------------------------+
```

---

# 4. Core Design Principle

The AI agent should **never be the final authority for money movement**.

The AI agent can:
- Understand user intent
- Search products
- Compare products
- Recommend products
- Prepare a purchase
- Request authorization

The AI agent should **not**:
- Store card details
- Decide payment limits
- Override policy rules
- Approve its own transaction
- Ignore expiry or merchant restrictions
- Directly move money

The deterministic authorization layer controls the payment.

```text
AI decides what it wants to do.

Payment Authorization Service decides what it is allowed to do.
```

---

# 5. Main Components

## 5.1 Shopping Agent

### Responsibility

Convert natural-language shopping requests into structured intent.

### Example input

```text
I want Nike black running shoes,
size 11,
under $120,
delivery within 7 days.
```

### Structured output

```json
{
  "category": "running_shoes",
  "brand": "Nike",
  "size": 11,
  "color": "black",
  "max_price": 120,
  "delivery_days": 7
}
```

### Suggested implementation

- Python
- OpenAI / another LLM
- Structured output / JSON schema
- Tool calling

---

## 5.2 MCP Tool Layer

MCP provides the tools that the shopping agent can call.

### Initial tools

```text
search_products()
get_product_details()
check_inventory()
check_delivery()
get_quote()
create_cart()
create_order()
```

### Example

```json
{
  "tool": "search_products",
  "arguments": {
    "brand": "Nike",
    "category": "running_shoes",
    "size": 11,
    "color": "black",
    "max_price": 120
  }
}
```

### Response

```json
[
  {
    "product_id": "PROD001",
    "name": "Nike Pegasus",
    "price": 109.00,
    "size": 11,
    "color": "black",
    "delivery_days": 3,
    "merchant_id": "MERCHANT01"
  }
]
```

---

## 5.3 Trusted Merchant Layer

For the POC, use a controlled merchant catalog instead of scraping Amazon or depending on live e-commerce sites.

### Merchant data can contain

```text
merchant_id
merchant_name
product_id
product_name
brand
category
size
color
price
inventory
delivery_days
```

### POC recommendation

Use:
- SQLite or PostgreSQL
- 3 simulated merchants
- 30–50 products

Later, merchant APIs can replace the simulated data source.

---

# 6. Checkout and Human Approval

Once the user selects a product, the merchant service generates a checkout quote.

### Example

```json
{
  "order_id": "ORD7821",
  "merchant_id": "MERCHANT01",
  "product_id": "PROD001",
  "item_price": 109.00,
  "tax": 8.99,
  "shipping": 0.00,
  "total": 117.99,
  "currency": "USD",
  "delivery_date": "2026-10-02"
}
```

The user sees:

```text
Product: Nike Pegasus
Merchant: Running World
Item Price: $109.00
Tax: $8.99
Shipping: $0.00
Total: $117.99

Delivery: October 2

Approve Purchase?
```

### Possible actions

```text
APPROVE
REJECT
MODIFY
```

No payment authorization should be created until the user explicitly approves.

---

# 7. Custom Delegated Payment Authorization

This is the most important component.

After user approval, our authorization service creates a **temporary payment permission**.

For this POC, we can call it:

# Delegated Payment Authorization Token — DPAT

The name is intentionally generic and internal to the POC.

---

## 7.1 What DPAT Means

DPAT does not represent an unrestricted card.

It represents:

```text
Customer Consent
+
Agent Identity
+
Merchant Scope
+
Order Scope
+
Maximum Amount
+
Currency
+
Expiration Time
+
Usage Restrictions
```

---

## 7.2 Example DPAT

```json
{
  "token_id": "DPAT_9XF83J",
  "authorization_id": "AUTH001",
  "customer_id": "USR001",
  "agent_id": "SHOP_AGENT_001",
  "merchant_id": "MERCHANT01",
  "order_id": "ORD7821",
  "max_amount": 117.99,
  "currency": "USD",
  "purpose": "ECOMMERCE_PURCHASE",
  "single_use": true,
  "issued_at": "2026-09-28T15:00:00Z",
  "expires_at": "2026-09-28T15:15:00Z",
  "status": "ACTIVE"
}
```

The agent receives only:

```text
DPAT_9XF83J
```

The sensitive authorization details remain in the payment authorization service.

---

# 8. Payment Authorization Service

## Responsibilities

The service must answer:

```text
Who approved this transaction?
Which agent is making the request?
Which merchant is allowed?
Which order is authorized?
What is the maximum amount?
Which currency is permitted?
When does authorization expire?
Has the authorization already been used?
Has it been revoked?
Does it require step-up approval?
```

---

## 8.1 Validation Rules

When a payment request arrives, validate in this order:

```text
1. Token exists
2. Token status = ACTIVE
3. Token has not expired
4. Token has not already been consumed
5. Agent identity matches
6. Merchant matches
7. Order matches
8. Currency matches
9. Requested amount <= authorized maximum
10. Customer consent exists
11. Policy checks pass
12. Risk checks pass
```

Only then:

```text
PAYMENT_AUTHORIZED
```

Otherwise:

```text
PAYMENT_DECLINED
```

---

# 9. Payment Request

The agent or merchant submits:

```json
{
  "token_id": "DPAT_9XF83J",
  "agent_id": "SHOP_AGENT_001",
  "merchant_id": "MERCHANT01",
  "order_id": "ORD7821",
  "amount": 117.99,
  "currency": "USD"
}
```

---

# 10. Payment Decision Example

## Valid request

```text
Authorized Amount: $117.99
Requested Amount:  $117.99
Merchant:          Correct
Agent:             Correct
Token Status:      Active
Expiry:            Valid
Customer Consent:  Present
```

Result:

```text
AUTHORIZED
```

---

## Invalid amount

```text
Authorized Amount: $117.99
Requested Amount:  $150.00
```

Result:

```text
DECLINED

Reason:
AMOUNT_EXCEEDS_AUTHORIZED_LIMIT
```

---

## Invalid merchant

```text
Authorized Merchant:
MERCHANT01

Request Merchant:
MERCHANT99
```

Result:

```text
DECLINED

Reason:
MERCHANT_NOT_AUTHORIZED
```

---

## Expired token

Result:

```text
DECLINED

Reason:
AUTHORIZATION_EXPIRED
```

---

# 11. Policy Engine

The policy engine should remain deterministic.

### Example policies

```text
Maximum POC transaction amount = $500

Only approved merchants allowed

Authorization expires after 15 minutes

Authorization is single-use

Different currency requires new approval

Changing merchant requires new approval

Changing order requires new approval

Amount increase requires user re-approval
```

### Decision output

```text
ALLOW
DENY
REQUIRE_USER_APPROVAL
REQUIRE_STEP_UP_AUTH
```

---

# 12. Risk Layer

For Phase 1, the risk layer can be simple.

### Example risk factors

```text
Known agent?
Known merchant?
Transaction amount abnormal?
Too many requests?
Token replay?
Merchant mismatch?
Multiple failed attempts?
Expired authorization?
```

### Simple risk output

```json
{
  "risk_score": 18,
  "risk_level": "LOW",
  "decision": "ALLOW"
}
```

Later phases can add:
- Fraud models
- Device intelligence
- Behavioral signals
- Agent reputation
- Merchant reputation
- Transaction velocity
- Historical spending patterns

---

# 13. Payment Execution

For the first POC, payment execution does not need real money.

Use one of the following:

### Option A — Simulated Payment Rail

```text
authorize_payment()
capture_payment()
refund_payment()
```

Return simulated responses.

### Option B — External Sandbox

Later connect the authorization gateway to:
- Stripe test mode
- Adyen sandbox
- PayPal sandbox
- Internal bank sandbox

The custom DPAT remains our authorization mechanism.

The external provider is only the downstream payment rail.

---

# 14. Audit Trail

Every important action should generate an event.

### Example

```text
15:01:02 USER_REQUEST_RECEIVED
15:01:04 INTENT_EXTRACTED
15:01:05 PRODUCT_SEARCH_STARTED
15:01:07 PRODUCTS_RETURNED
15:01:20 PRODUCT_SELECTED
15:01:22 CHECKOUT_CREATED
15:01:29 USER_APPROVED_PURCHASE
15:01:30 DPAT_CREATED
15:01:31 PAYMENT_REQUEST_RECEIVED
15:01:31 AGENT_VALIDATION_PASSED
15:01:31 MERCHANT_VALIDATION_PASSED
15:01:31 AMOUNT_VALIDATION_PASSED
15:01:31 EXPIRY_VALIDATION_PASSED
15:01:32 PAYMENT_AUTHORIZED
15:01:33 PAYMENT_COMPLETED
15:01:34 TOKEN_CONSUMED
15:01:35 ORDER_CONFIRMED
```

This is critical for a banking-oriented demonstration.

---

# 15. Suggested Database Model

## users

```text
user_id
name
status
created_at
```

## agents

```text
agent_id
agent_name
agent_type
trust_status
created_at
```

## merchants

```text
merchant_id
merchant_name
trust_status
created_at
```

## products

```text
product_id
merchant_id
name
brand
category
size
color
price
inventory
delivery_days
```

## orders

```text
order_id
user_id
merchant_id
product_id
amount
currency
status
created_at
```

## payment_authorizations

```text
authorization_id
user_id
agent_id
merchant_id
order_id
max_amount
currency
approved_at
expires_at
status
```

## delegated_tokens

```text
token_id
authorization_id
single_use
issued_at
expires_at
consumed_at
revoked_at
status
```

## payment_attempts

```text
payment_attempt_id
token_id
agent_id
merchant_id
order_id
requested_amount
currency
risk_score
decision
decline_reason
created_at
```

## audit_events

```text
event_id
user_id
agent_id
authorization_id
order_id
event_type
event_timestamp
metadata
```

---

# 16. API Design

## Product Search

```http
POST /api/products/search
```

## Checkout

```http
POST /api/orders/checkout
```

## User Approval

```http
POST /api/authorizations/approve
```

## Create DPAT

```http
POST /api/payment-authorizations/token
```

## Validate DPAT

```http
POST /api/payment-authorizations/validate
```

## Execute Payment

```http
POST /api/payments/execute
```

## Revoke Authorization

```http
POST /api/payment-authorizations/revoke
```

## Audit Events

```http
GET /api/audit/{order_id}
```

---

# 17. Implementation Phases

# Phase 1 — Basic Agentic Shopping Demo

### Goal

Show that the AI can understand a user's shopping request and retrieve relevant products.

### Build

- Chat UI
- LLM intent extraction
- Product database
- MCP server
- Product-search tool
- Product recommendations

### Output

```text
User Prompt
→ AI understands intent
→ MCP search
→ Product recommendations
```

### No payment yet.

---

# Phase 2 — Merchant and Checkout Flow

### Goal

Move from product discovery to a real checkout workflow.

### Build

- Product selection
- Merchant service
- Inventory check
- Quote calculation
- Tax / shipping simulation
- Order creation
- User approval page

### Output

```text
Product Selected
→ Merchant Quote
→ Order Created
→ Customer Approval
```

---

# Phase 3 — Custom Payment Authorization

### Goal

Introduce delegated payment authority.

### Build

- Authorization service
- User consent record
- DPAT generation
- Amount restriction
- Merchant restriction
- Order restriction
- Token expiry
- Single-use token behavior
- Token revocation

### Output

```text
User Approval
→ Authorization Created
→ DPAT Issued
```

This is the most important phase for the POC.

---

# Phase 4 — Agentic Payment Gateway

### Goal

Validate agent-initiated transactions independently from the LLM.

### Build

- Token validation
- Agent validation
- Merchant validation
- Amount validation
- Currency validation
- Expiry validation
- Replay prevention
- Policy engine
- Payment decision API

### Output

```text
Payment Request
→ Policy Checks
→ Authorization Decision
```

---

# Phase 5 — Payment Execution

### Goal

Complete the purchase.

### First version

Use simulated payment execution.

```text
Payment Authorized
→ Simulated Payment
→ Payment Success
```

### Later

Connect to an external test payment rail.

```text
Custom Authorization Gateway
→ Stripe / Adyen / PayPal / Bank Sandbox
```

The external provider should not own the authorization logic in this POC.

---

# Phase 6 — Risk and Security Enhancements

### Add

- Risk scoring
- Agent reputation
- Merchant trust score
- Velocity rules
- Step-up authentication
- Suspicious transaction detection
- Rate limiting
- Token replay detection
- Token revocation

---

# Phase 7 — Protocol and Multi-Agent Enhancements

Once the basic POC works, introduce:

- Buyer Agent
- Seller Agent
- Payment Agent
- MCP
- A2A communication
- ACP / UCP compatibility concepts
- Merchant discovery
- Agent identity framework

Do not make protocol standardization a dependency for the first POC.

---

# 18. One-Week POC Recommendation

Because the timeline is short, prioritize:

## Day 1

- Architecture
- Product data model
- Chat UI
- Intent extraction

## Day 2

- MCP server
- Product search
- Product recommendations

## Day 3

- Merchant checkout
- Order creation
- User approval

## Day 4

- DPAT service
- Authorization data model
- Token creation

## Day 5

- Payment validation
- Policy rules
- Decline scenarios

## Day 6

- Payment simulation
- Audit trail
- UI polish

## Day 7

- Demo flow
- Negative test cases
- Client storyline
- Architecture slides / documentation

---

# 19. Demo Scenarios

## Scenario 1 — Successful Purchase

```text
User budget: $120
Product total: $117.99

Result:
AUTHORIZED
```

## Scenario 2 — Amount Violation

```text
Authorized: $117.99
Requested: $150

Result:
DECLINED
```

## Scenario 3 — Merchant Violation

```text
Authorized Merchant: Merchant A
Request: Merchant B

Result:
DECLINED
```

## Scenario 4 — Expired Authorization

```text
Token validity: 15 minutes
Request after expiry

Result:
DECLINED
```

## Scenario 5 — Reused Token

```text
Token already consumed

Result:
DECLINED
```

These failure cases should be included in the demo because they clearly demonstrate why a delegated authorization layer is required.

---

# 20. Suggested Technology Stack

```text
Frontend
React or Streamlit

Backend
Python + FastAPI

LLM
OpenAI or another approved model

Agent
Python Agent / LangGraph if needed

Tool Integration
MCP

Database
SQLite for POC
PostgreSQL later

Authorization
Custom FastAPI service

Policy Engine
Python rules engine

Payment
Simulated payment service initially

Audit
Database-backed event log
```

---

# 21. Security Principles

For the POC and future design:

1. Never expose raw card credentials to the AI agent.
2. Never store sensitive credentials in LLM prompts.
3. Payment authority must be separate from AI reasoning.
4. Every authorization must have a clear owner.
5. Every authorization should be scoped.
6. Every token should expire.
7. Prefer single-use authorization.
8. Every payment decision should be auditable.
9. Policy rules should be deterministic.
10. High-risk transactions should require human approval.
11. Token replay should be prevented.
12. Authorization should be revocable.

---

# 22. What We Are Demonstrating to the Client

The demo is not intended to claim that we have built a complete production payment network.

It demonstrates the architecture required for safe agentic commerce:

```text
Natural Language Intent
        ↓
AI Shopping Agent
        ↓
Trusted Commerce Tools
        ↓
Merchant Interaction
        ↓
Human Consent
        ↓
Delegated Payment Authorization
        ↓
Policy-Controlled Payment Gateway
        ↓
Payment Execution
        ↓
Auditability
```

The key message is:

> AI agents can participate in commerce without receiving unrestricted financial credentials. A dedicated authorization layer can convert customer consent into a constrained, time-bound, merchant-bound, auditable payment permission.

---

# 23. Recommended Next Step

After this architecture is agreed upon, implementation should start with:

```text
Phase 1
Shopping Agent + MCP Product Search

then

Phase 2
Checkout + User Approval

then

Phase 3
Custom DPAT Authorization Service
```

The payment service should be added only after the authorization lifecycle is working correctly.

This keeps the POC simple, explainable, secure, and extensible.
