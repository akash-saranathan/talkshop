# Talkshop Live Trace: Client Demo Guide

This guide explains the **Live** tab of the Agent Activity panel: what each card means, where the step runs, and what is real versus simulated. It is written for the presenter.

Example used throughout: a Nike product → checkout → approval → **Visa •••• 4001** → order.

---

## 1. Read this first

| Tab | Use it for |
|---|---|
| **Story** | Presenting. One row per stage, with **View details** to open the events behind each row. |
| **Live** | Evidence. One card per event, in order. Open it when a client asks "show me that step". |
| **Flow** | Not used in the client demo. |

**Cards hidden from Live** (they still run and still appear in Story):
- Progress cards: "Input checks running", "Gemini extracting intent", the message sent to Nike, "UCP Catalog — searching"
- Demo-only cards: bad credential, charge above the authorised amount, payment token rejected, delivery date changed, re-consent, old token invalidated, checkout cancelled
- Duplicates and internal steps: the identity-received card, the DPAT card, the separate 12/12 checks card, the boundary check card, the order proposal card, the payment re-check card, and the separate AP2 evidence-verified card
- Repeated slider steps: only the latest state is shown
- Loyalty redemption: hidden once you change the points choice

---

## 2. Who does what, and where it runs

In this demo, **everything runs in one backend process**, so the parties are simulated.

| Party | Role in the demo | Where it runs | In production |
|---|---|---|---|
| **Customer** | Searches, selects, approves | Browser | The customer |
| **Talkshop agent** | Input checks, intent, trust credential, AP2 records, ACP token | Our backend | Our platform |
| **Nike** | Verifies agent, catalog, checkout, token, order | Our backend, simulated as a separate merchant | Nike's own systems |
| **Card processor** | Charges the card | Mock processor in our backend | Payment provider, card network and issuing bank |

**Is it on Nike's side, ours, or the payment network's?**
- Input checks, intent, the agent credential, AP2 records and the ACP token are **our side**.
- Trust checks, catalog, checkout, token verification and order creation are **Nike's side**. Simulated here.
- The charge is the **payment provider's side**. Here it is a mock. No Visa, Mastercard or bank system is called.

---

## 3. The journey, card by card

### Search

**1. Custom input checks passed** · *guardrails* · our side
Deterministic checks run first: empty input, length, harsh language, malformed characters, personal data, and card-detail keywords. Any failure stops the request.

**2. Commerce scope check: PASS** · *guardrails* · our side
One Gemini classification call decides whether the message is about shopping. Off-topic and card-detail requests are blocked. If the check cannot complete, the message is **blocked**.

**3. Intent validated** · *guardrails* · our side
The extracted brand, category, size and price are validated against the intent schema. This card appears only when the Guardrails AI library is installed on the server.

**4. Routing to Nike** · *internal* · our side
The brand you named selects the merchant. Without a brand, the agent routes by category.

**5. Connected to Nike's agent** · *A2A* · our side
The agent reads Nike's agent card: its name and skills. Demo: an in-process call.

**6. Nike verified your shopping agent** · *trust* · Nike's side
Nike checks the agent is registered, comes from Talkshop, has a valid ECDSA signature, and has not expired. This confirms the agent is ours. It does not confirm you are a customer. See section 5.

**7. Nike confirmed you authorised this agent** · *trust* · Nike's side
Nike checks the signed permission names this agent and carries a pseudonymous customer code. Nike sees the code, not your account.

**8. Nike confirmed the request is allowed** · *trust* · Nike's side
The action (`catalog:read`, `checkout:create`, `payment:execute`) and the merchant are inside the permission. Amounts are checked against the $700 agent limit.

**9. Nike opened a trusted session** · *trust* · Nike's side
Nike's record that the agent passed checks. Checkout and payment require it. Membership is decided here: member or guest.

**10. UCP Catalog returned 56 products** · *UCP* · Nike's side
Nike's catalog returns matching products as data.

**11. Products checked** · *A2A* · our side
Our side checks each product: the price must be above zero. The merchant-label check is a placeholder, because the label is taken from the agent we asked, not from Nike's signed answer. Only checked products reach the agent.

### Checkout (after you select a product)

**12. You selected a product** · *A2A* · our agent to Nike
Your agent sends the checkout request to Nike. Nike re-checks the signed permission for `checkout:create` before creating anything. *(This card is shown in Live; the check runs in the backend.)*

**13. Your Nike points: 985** · *internal* · Nike's side (member only)
Nike's points balance, so you can choose to use it. In the demo it is read from our loyalty table.

**14. Nike created your checkout: $140.65** · *A2A* · Nike's side
Nike locked the price, tax, shipping and delivery date (UCP) and returned them to the Talkshop agent. Sent over HTTP in the demo.

**15. AP2 checkout bound** · *AP2* · our side
A signed cart record ties the product, quantity, merchant and total to the checkout fingerprint. This fixes what you are asked to approve. It is not an approval.

**16. Loyalty points applied** · *internal* (only if you use points)
Points cover part of the total: 10 points = $1. Shown only when you have not changed the points choice.

**17. You chose points: 110 used** · *HUMAN* (only if you changed the slider)
Each change re-signs the cart. Live shows only the latest state. *(Rename to be confirmed.)*

**18. Agent spending check: passed** · *SECURITY* · our side
The amount due, after points, is checked against the agent's $700 per-checkout limit. The card status is shown as tokenised. Over-limit approvals are refused before any payment step.

### Approval and payment

**19. Customer approved** · *HUMAN* · you
You clicked **Authorize Payment** for this exact checkout, total and card. This is the only approval.

**20. Your approval recorded (AP2)** · *AP2* · our side
A signed record that you approved this checkout and amount. Created only after approval.

**21. Payment token created (ACP)** · *ACP* · our side
A single-use token for Nike: this merchant, this checkout, this amount, USD, expiring in 15 minutes. The agent never sees the card.

**22. Nike verified the token and your approval** · *ACP* · Nike's side
Nike checks the token's signature, merchant, checkout, amount, currency and expiry, and checks the approval record matches. Nike also re-checks the agent's permission for `payment:execute` in the backend before charging. If the approval check fails, a red "AP2 evidence rejected" card appears.

**23. Payment processed** · *PAYMENT* · payment provider (simulated)
The token is marked used. The 12 payment checks run first, and only if all pass does the processor charge the card. The card shown is Visa •••• 4001, the last four digits only.

**24. Order created at Nike** · *REST* · Nike's side
Nike creates the order with a tracking number and delivery date. Points are earned on the cash paid.

**25. Nike confirmed your order** · *A2A* · Nike to our agent
Nike returns the final order, and the agent shows it to you.

---

## 4. Guardrails, layer by layer

| Layer | What it stops | Where | Card in Live |
|---|---|---|---|
| Custom input checks | Empty, too long, abusive, malformed, personal data, card keywords | Our side, deterministic | Custom input checks passed |
| Commerce scope check | Off-topic requests and card-detail requests | Our side, one Gemini call | Commerce scope check: PASS |
| Intent schema | Malformed structured intent | Our side | Intent validated (when installed) |
| Agent trust | Unregistered agents, forged or expired credentials, out-of-scope actions | Nike's side, deterministic, ECDSA | Nike verified your shopping agent / authorised / allowed |
| Spending check | Charges above the $700 limit | Our side, before payment | Agent spending check |
| Approval binding | Approval that does not match the checkout | Nike's side | Customer approved |
| Token and approval check | Replayed, expired, mismatched or tampered payments | Nike's side | Nike verified the token and your approval |
| 12 payment checks | Anything that fails before the processor is called | Our side, internal | Payment processed (12 checks run inside) |

**Fail-closed rule:** if the scope check cannot complete, the request is blocked, not allowed through.

---

## 5. Trust: how the agent and the customer are checked

**Checking the agent (is our chatbot valid?)**
Nike checks, in code, that the agent is registered, comes from Talkshop, has a valid ECDSA signature, and has not expired. It checks again at selection and at payment.

**Checking the customer (are you a Nike customer?)**
This is a separate lookup:
1. The permission carries a pseudonymous code for you (`cust_…`), made by hashing your Talkshop ID with the platform name.
2. Nike looks that code up in its member list.
3. If found, you are a **member**: points and any saved card are available. If not, you are a **guest**.
4. The result is saved in the trusted session. Selection and payment read the saved result.

**Name and email are never used.** The code is an ID, not your personal details.

**Real time vs demo**
- *Real time:* you link your Nike account to Talkshop once. Nike checks its own customer record for that link.
- *Demo:* a hard-coded member list, seeded with demo data. No Nike login or account link exists.

---

## 6. Where ECDSA is used

ECDSA (Elliptic Curve Digital Signature Algorithm, P-256 with SHA-256) is a signature method. Talkshop signs with a private key only it holds. Anyone with the matching public key can check a signature, but cannot create one.

Where it is used in the code:

| Use | What is signed | Who checks it |
|---|---|---|
| **Agent credential** (permission slip) | Agent identity and permission | Nike, at search, selection and payment |
| **ACP payment token** | The token's terms (merchant, checkout, amount, expiry) | Nike, before charging |
| **AP2 records** | Cart and approval evidence | Nike, before charging |

Our internal enforcement step (DPAT) and some internal records use **HMAC**, a shared-secret signature used only inside our system.

**Demo note:** the signing keys are generated in memory when the server starts. In production, the private key would sit in secure key storage.

**Why ECDSA?** Nike needs to check the signature without being able to create one. A shared secret (HMAC) would let Nike forge signatures too.

---

## 7. Payment: the token, the internal step, and the 12 checks

**The token (ACP)**
- Single-use, signed with ECDSA, bound to Nike, this checkout, this amount and currency, and expires in 15 minutes.
- The agent never sees the card.

**DPAT (internal)**
Talkshop's own single-use enforcement token. It is not an industry standard. It is derived from the verified token, and the 12 checks run against it.

**The 12 payment checks** (run before the processor is called)
1. token_exists
2. token_active
3. token_not_expired
4. token_not_consumed
5. agent_id_match
6. merchant_id_match
7. order_id_match
8. currency_match
9. amount_within_limit
10. amount_matches_checkout
11. checkout_hash_match
12. consent_exists

If any check fails, nothing is charged and no order is created.

---

## 8. Scenarios

**A. Nike member, card only.** Membership is read, no points are applied, and the card is charged the full total.

**B. Nike member, partial points.** Amount due = total − points ÷ 10. Example: $140.65 total, 110 points → $11.00 covered → **$129.65 charged**.

**C. Nike member, all points.** Points cover the whole order. Amount due is $0, so there is no token, no processor and no 12 checks. Nike's loyalty record settles the order.

**D. Guest merchant (for example Adidas).** No points, no saved card. The spending card reads "awaiting secure payment entry", and the customer enters a card on a secure step.

**Multiple items in a cart.** The current code creates one checkout per item, so each item gets its own approval. The intended design is one checkout and one approval per merchant, with items from the same merchant combined. This is not built yet. For the demo, use one product.

---

## 9. Protocols: what each one is for

| Protocol | Role here | What the official sources say |
|---|---|---|
| **A2A** | Messages between the customer agent and the merchant agent | An agent-to-agent message standard. |
| **MCP** | The merchant's tools: inventory and price lookups | A tool standard for AI systems. |
| **UCP** | The shared format for catalog search and checkout (price, tax, shipping, delivery) | Standard for catalogs and checkouts. It does **not** approve transactions or move money. Its transports include REST, MCP and A2A. |
| **AP2** | Signed records: what was bought, and that you approved it | Google's open protocol. Its official repository is mainly code samples, so the record types are described in secondary sources. It is a record of authorisation, not a payment network. |
| **ACP** | A scoped payment token passed from the agent to the merchant | Developed by OpenAI and Stripe. Official page: an open standard for passing secure payment tokens. Still in beta. The exact limits in our demo are our own design, not the spec. |
| **x402** | Pays for API access over HTTP, using HTTP 402 "Payment Required" | Mainly crypto-native payments. Not used for card checkouts. Not used in this demo. |

**Why not one plain API?** A plain API could do one charge, but nothing proves the customer approved it, and the caller gets broad access. The protocols separate the roles: the checkout (UCP), the proof of approval (AP2), and a narrow permission to charge (ACP).

**Why do we need AP2 and ACP?**
- AP2 proves **you agreed**.
- ACP gives **permission to charge**.

**Where do AP2 and ACP run?** In our agent, and Nike checks them. The card networks and banks do not read them. Between Nike and the bank, the charge uses established card standards: ISO 8583 messages, EMVCo payment tokens, 3-D Secure, and PCI DSS.

---

## 10. The spending check, and the Visa mimic

**What we built:** a fixed $700 limit per checkout. Any amount due above it is refused before payment, and the customer can adjust the order and try again.

**What Visa Intelligent Commerce does (public sources):** the consumer sets spending limits and conditions for an agent, can restrict merchant categories, and can require real-time approval. Agents receive tokens rather than card numbers, which can be revoked. Visa's product page says the product is still being deployed.

**What we mimic:** the idea of a per-agent spending control set by the customer. We do not call any Visa system. The $700 is a demo number, the same for every customer.

**Honest differences from a real rollout:**
- The real limit is set by the customer, and can be per day or per month.
- Points count toward the limit in our demo. A real system would need a policy decision on that.
- Repeated checkouts are each checked against the limit, so five $600 orders would each pass.

**For the client:** "The customer sets a spending limit for the agent. Our demo fixes it at $700 per checkout, to show how a control works. A real limit would be set by the customer."

---

## 11. Is the flow correct?

Yes. Search, trust, product check, checkout, approval, the AP2 and ACP steps, the merchant's check, payment and confirmation all happen in the right order, and each card is a real recorded event.

**Limits to state, not hide:**
- The merchant, the trust checks and the processor run in our backend.
- The search and checkout calls are HTTP calls to our own server acting as Nike.
- The signing keys are demo keys.
- The scope check is one Gemini call. If Gemini is down, the message is blocked.
- The intent card appears only when Guardrails AI is installed on the server.
- The points balance comes from our loyalty table.
- Multi-item carts are not yet one checkout.
- The Story line "card number & CVC never leave the browser" is fixed text. Verify it before saying it.

---

## 12. Card wording review

Some headings are still technical or inconsistent. Proposed changes, **not yet applied**:

| Current heading | Problem | Proposed |
|---|---|---|
| ✓ Customer agent identity verified | Tick in heading, and says "customer" for the agent | Nike verified your shopping agent |
| ✓ Customer delegation verified | Tick in heading | Nike confirmed you authorised this agent |
| ✓ Scope verified | Tick in heading, vague | Nike confirmed the request is allowed |
| Trusted session established | Technical | Nike opened a trusted session |
| Customer Agent → Nike Agent (hidden in Live) | Technical | Connected to Nike's agent |
| AP2 checkout bound | Jargon first | Cart evidence bound to checkout (AP2) |
| Products checked | Good, but the merchant-label check is a placeholder | Keep, and describe carefully |
| Nike Agent → Customer Agent: ORDER_CONFIRMED | Technical | Nike confirmed your order |
| Agent spending check: passed | Good | Keep |
| You chose points: 110 used | Not yet renamed | Confirm |

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **A2A** | Agent-to-agent messages, sent as JSON-RPC 2.0 requests. |
| **AP2** | Signed records of what was bought and what was approved. |
| **ACP** | A scoped, single-use payment token passed to the merchant. |
| **UCP** | Shared format for catalogs and checkouts. |
| **MCP** | Standard for AI systems to call tools, here inventory and price. |
| **ECDSA** | Signature method. Only the private-key holder can sign, anyone can check. |
| **HMAC** | Shared-secret signature, used only inside our system. |
| **Credential** | The signed permission slip the agent presents. |
| **Pseudonymous code** | A stable code (`cust_…`) that stands in for your identity. |
| **Trusted session** | Nike's record that the agent passed its checks. |
| **Member / guest** | Member: you have a Nike account, points and maybe a saved card. Guest: no account. |
| **Scope** | The actions and limits you allowed. |
| **Spending limit** | The $700 cap per checkout. |
| **Checkout fingerprint** | A hash (SHA-256) of the checkout. Any change breaks it. |
| **Cart evidence** | The signed AP2 cart record. |
| **Approval record** | The signed AP2 record of your approval. |
| **Token** | The single-use ACP payment credential. |
| **DPAT** | Our internal single-use enforcement token. Not an industry standard. |
| **Tokenised** | The card is referenced by a token, not its number. |
| **Visa •••• 4001** | Brand and last four digits only. |
| **Mock processor** | A simulated payment provider. No card network is called. |

---

## 14. Quick answers for the client

- **Where does the purchase happen?** Checkout and payment are on Nike's side, but in this demo everything runs in Talkshop's backend, and the charge goes to a simulated processor.
- **Do you store my card?** No. The agent never sees it. Only the brand, last four digits and a payment-method reference are used.
- **What stops a charge above what I approved?** The approval is tied to the checkout fingerprint, the token is tied to the exact amount, and Nike checks both before charging.
- **Can the agent buy without asking?** No. Nothing is charged until you approve the exact checkout.
- **Why not one API?** The roles are separated: checkout, proof of approval, and permission to charge.
- **Is my name or email shared with Nike?** No. Nike sees a pseudonymous code.

---

## Appendix: changes made for this demo

- The scope check now calls Gemini directly, fails closed, and no longer shows a PASS for a check that did not run.
- Live hides the demo-only, progress and duplicate cards in section 1.
- "Payment authorized" is split into "Customer approved" and "Payment processed".
- The checkout card shows UCP for the checkout and A2A for the return to the agent.
- Loyalty cards show as internal lookups, not A2A messages.
- The payment re-check is folded into the token-and-approval check in Live.
- Story and the backend are unchanged in behaviour.
