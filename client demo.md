# Talkshop Demo Guide: Live, Story and Flow

This guide explains what each part of the Agent Activity panel shows, in plain words, and where each step runs. It is for the presenter.

Example used throughout: a Nike product bought with Visa •••• 4001, with optional loyalty points.

---

# Part A: Presenter script

Read this as a talk track. Lines in quotes are what you say. "Card" is what appears on screen. "If asked" gives the answer to have ready.

## A1. Opening (about 2 minutes)

> "Most AI assistants on a website can answer questions. Very few can buy something for you safely. Today I'll show you how Talkshop does a real purchase, step by step, and why each step is there."

**The question every bank will ask first:** why not a normal chatbot?

## A2. Why not a generic chatbot, or a private model?

| Option | What it does well | What it cannot do safely |
|---|---|---|
| **Hosted generic chatbot on a website** | Answers questions, compares products | It cannot prove who the customer is, who the merchant is, or that you approved a specific charge. It has no spending limit and no audit trail. |
| **Private LLM inside the bank or company** | Keeps data in-house, can be tuned | Same gap. A model can write "I bought it", but nothing proves the merchant agreed, that the amount is right, or that you approved it. |
| **Talkshop (this demo)** | Uses an AI model to understand the request, and uses rules and standards for everything that involves money | Slower to build, and it needs the merchant to take part. |

**Say:** "The AI model is good at understanding what you want. It is not the thing we trust with money. Everything that moves money goes through rules, signatures and standards that anyone can check afterwards."

**Advantages to name:**
- **Safe to spend:** the agent can only buy what you approved, within a limit, once.
- **Proof:** every approval and every payment has a signed record.
- **Privacy:** the merchant never sees your name, email or card number.
- **Works with many merchants:** the same format and checks work across merchants.
- **Audit trail:** each step appears in Live, so you can show what happened.

**If asked: "Why not just use an API?"** A plain API call can charge a card, but nothing proves you approved it, and whoever holds the key has broad access. We separate those roles on purpose. See section A6.

## A3. What you will type

Type this, exactly:

> **"Find me Nike running shoes under $150, size 9."**

**Say:** "I'm going to ask for something specific, and I'll show what happens behind every line of the panel on the right."

## A4. Walking through the right-hand panel

Open **Live** and read each card when it appears. Pause after each stage.

### Stage 1: Checking your request

**Card: "Security checks passed"**
- **Say:** "Before any AI reads your message, simple rules check it: no empty input, no abuse, no personal data, and no card details typed into the chat."
- **Why:** card numbers should never go into a chat. This stops them at the door.
- **If asked: "Is this AI?"** No. These checks are fixed rules.

**Card: "Shopping request: PASS"**
- **Say:** "A second check asks whether this is a shopping request. If someone asked for a poem, the agent would refuse. If the check cannot finish, we stop the request. We don't let it through."
- **Why:** the agent should only act on shopping requests.
- **If asked: "What if the AI is down?"** The request stops and you're told to try again. Nothing is bought.

**Card: "Request understood"**
- **Say:** "The AI reads the sentence and pulls out the brand, the product type, the size and the price. The result is checked against a fixed format."
- **Why:** the AI turns your words into structured data, so the next steps can work with exact values.
- **If asked: "Could the AI make up a size?"** The output must fit the fixed format. If it doesn't, the request is rejected.

### Stage 2: Connecting to the merchant

**Card: "Routing to Nike"**
- **Say:** "Because you named Nike, the agent asks only Nike. It doesn't spam other shops."
- **Why:** you asked for one brand, so only that merchant should see the request.

**Card: "Customer agent connected to Nike"**
- **Say:** "Our agent reads Nike's agent card. That's a short public description of what Nike's agent can do."
- **Why:** agents from different companies need a standard way to find out what the other can do. This is what A2A is for.
- **If asked: "Is this a real network connection?"** In this demo, the connection runs inside our system. In production it's an HTTP call across the internet.

**Card: "Nike verified the Customer agent"**
- **Say:** "Nike checks that our agent is one it recognises, that it comes from Talkshop, and that its signature is valid. The signature is ECDSA. It is a digital seal that only Talkshop can make and that anyone can check."
- **Why:** Nike must know it is talking to a genuine agent, not a script pretending to be one.
- **If asked: "Does this check that I'm a customer?"** No. This proves the agent is genuine. Your permission is checked on the next card, and membership is checked after that.

**Card: "Nike confirmed you gave permission"**
- **Say:** "Your permission names this agent and includes a customer code. Nike sees the code, not your name, email or account."
- **Why:** you have to say which agent acts for you. Nike only needs to know that the permission is real.
- **If asked: "What is the customer code?"** A stable code made from your Talkshop ID. It cannot be turned back into your identity.

**Card: "Nike confirmed the action is allowed"**
- **Say:** "The permission lists what the agent may do: search, checkout and payment, within a limit. Searching is allowed. Payment is only allowed later, within the limit."
- **Why:** an agent should only do what you allowed, and no more.

**Card: "Nike opened a trusted session"**
- **Say:** "Nike records that this agent passed its checks. It also records whether you are a member or a guest. This card says 'You are a guest at Nike' in this demo."
- **Why:** checkout and payment need this record. Membership decides whether you get points or a saved card.
- **If asked: "How does Nike know I'm a member?"** Every merchant starts unlinked, so a new checkout is a guest checkout. The customer links the Nike account once: a "Link your Nike account" button opens a sign-in pop-up, the customer enters their email and a one-time code, and approves sharing. Nike checks its own member records and returns a member token. From then on, Nike decides member or guest from that token. Your name and email are never sent to the chat.
- **If asked: "What if I'm not a Nike member?"** The sign-in says "No account found", and the customer can continue as a guest. In the demo, only John's email has a Nike account.

### Stage 3: Products

**Card: "Nike found 56 products"**
- **Say:** "Nike's catalogue returns every matching product. This is the UCP format: each product has a title, a price, sizes and colours, in a standard shape."
- **Why:** a standard format means any agent can read any merchant's products.

**Card: "Products checked"**
- **Say:** "Before the agent uses any product, it checks the price is valid. A product with no real price is removed."
- **Why:** an agent should not trust a merchant's answer without checking it.
- **If asked: "Do you verify that the products really come from Nike?"** Not yet. In this demo, the merchant label is set by our own code, so it is a placeholder. In production, Nike would sign its answer, and we would verify the signature. Be open about this.

### Stage 4: Selection and checkout

**Card: "You selected a product"**
- **Say:** "Now I select the product. This is the moment the agent asks Nike to create a checkout. Nothing is charged yet."
- **Why:** choosing a product is not the same as paying. This separation matters.
- **If asked: "Does selecting it charge me?"** No. Nothing is charged until you approve, later on.

**Card: "Points checked"** (members only)
- **Say:** "Nike tells us how many points are available and how many are pending. You choose whether to use the available ones."
- **Why:** points belong to Nike, so Nike's figure is the one that counts.
- **If asked: "Where does this number come from?"** In this demo, Nike's answer comes from a stand-in for Nike's records. Nike also does the points-to-dollar conversion and returns the new total.

**Card: "Points applied"** (if you did not change the points slider)
- **Say:** "Nike applies these points and returns the new total, which is what the approval covers. Ten points are worth one dollar in this demo."

**Card: "Nike created your checkout: $140.65"**
- **Say:** "Nike locks the price, tax, shipping and delivery date. This is the UCP checkout. The figure you see now is the figure you'll approve. Nike sets it, not our agent."
- **Why:** the price you approve must be the price that gets charged.
- **If asked: "We already had the price from the product list. Why do we need a checkout?"** The product list price can be out of date. The checkout adds tax and shipping, checks stock and locks the total.
- **If asked: "Why is it UCP and not a plain API?"** UCP is the shared shape for products and checkouts. Any agent that understands it can read Nike's checkout the same way it reads anyone else's.

**Card: "Cart saved for approval"**
- **Say:** "This is a signed record of the exact cart: the product, the quantity, the merchant and the total. It is tied to a fingerprint of the checkout. If anyone changes one number, the fingerprint no longer matches."
- **Why:** it fixes exactly what you are asked to approve. It is not an approval yet.
- **Protocol:** AP2 is the signed-record standard.

**Card: "Spending limit: passed"**
- **Say:** "The amount due, after points, is within the agent's limit of $700 per checkout. If it were over, the agent would stop here, and nothing would be charged."
- **Why:** this stops an agent from spending more than the customer allowed, even if you approve it by mistake. The card shows the amount and the limit.
- **If asked: "Is $700 a real rule?"** No. It is a demo value, set in our code. A real limit would be chosen by the customer. We copy the idea of the spending controls Visa describes publicly, but we do not call any Visa system.
- **If asked: "Do points count toward the limit?"** In the demo, yes, because only the cash part is charged. A real system would need a rule for this. We flag it openly.

### Stage 5: Your approval

**Card: "You approved the order"**
- **Say:** "This is the step that matters most. I click Authorize Payment. My approval is tied to this exact total, this card and this checkout."
- **Why:** the agent cannot pay on its own. You approve, every time.
- **If asked: "What if the countdown runs out?"** The countdown only opens the checkout summary. It never approves payment. You can pause it, or press "Proceed now" to skip the wait. Payment still needs your Authorize Payment click.

**Card: "Approval saved"**
- **Say:** "A signed record of your approval is created now. It says you approved this exact cart, this amount and this card."
- **Why:** if you dispute the charge later, this record shows what you approved. That is the proof.
- **Protocol:** AP2 again, now for the approval.

### Stage 6: Payment

**Card: "One-time payment permission created"**
- **Say:** "Now our agent creates a payment token. It is for Nike only, for this amount only, and it can be used once. It expires in 15 minutes. The card number is never in it, and the agent never sees the card."
- **Why:** this is the only thing Nike receives. If it leaked, it could not be reused or used for another order.
- **Protocol:** ACP, the scoped token standard.
- **If asked: "Why not just send the card number to Nike?"** Then Nike would hold your card, and anyone who got into Nike's systems could use it. A token limits the damage to one payment.

**Card: "Nike checked the payment"**
- **Say:** "Nike checks the token: is it genuine, is it for Nike, this checkout, this amount, and not expired. It also checks that your approval matches. If anything is wrong, nothing is charged."
- **Why:** the merchant must not trust the agent alone. It checks the proof and the permission together.
- **If asked: "Does Nike check my permission again here?"** Yes, in the backend, before charging. It isn't shown as a separate card to keep the panel short.

**Card: "Payment processed"**
- **Say:** "The card is charged now. It is a simulated processor in this demo. Before the charge, twelve internal checks ran: the token exists and is active, it hasn't been used, the amount and currency match, and the approval exists."
- **Why:** nothing should move money unless every check passes.
- **If asked: "Where does the money really go?"** A payment provider sends the charge through the card network, which goes to your bank. Visa, Mastercard and banks are not called in this demo.

### Stage 7: Order

**Card: "Order created"**
- **Say:** "Nike creates the order, with a tracking number and a delivery date. Loyalty points are earned on the cash paid."

**Card: "Nike confirmed your order"**
- **Say:** "The final confirmation goes back to our agent, and the agent shows it to you. The order is saved and appears on the dashboard."
- **Why:** the agent's record and the merchant's record must match.

## A5. Closing (about 1 minute)

> "So in one purchase, the AI understood what you wanted, but it did not spend your money. Rules and standards did. Nike checked the agent, your permission and your approval, and only then did the charge happen. Every step is recorded, so each one can be checked."

## A6. Why standards, not one simple API

Use this when the client asks why we need several protocols.

| Question | Answer |
|---|---|
| **Why not one API call?** | One call can charge a card, but it proves nothing about your approval, and the caller has broad access. |
| **Why UCP for products and checkout?** | It is the shared shape for products, prices and totals. Any agent that knows the shape can use any merchant. |
| **Why A2A?** | It is how two agents find each other and exchange messages. It is the connection, not the checkout. |
| **Why AP2?** | It is the signed proof of what was bought and that you approved it. It proves the agreement, not the payment. |
| **Why ACP?** | It is the single-use, scoped payment permission. It limits what the merchant can charge. |
| **Why both AP2 and ACP?** | AP2 proves you agreed. ACP gives permission to charge. Separate records can be checked separately. |
| **Why MCP?** | It lets the merchant's systems expose inventory and price lookups as tools. |
| **Why not x402?** | x402 pays for API access over HTTP, mainly with crypto. It is not used for card checkouts. |

**Say:** "These are not competing products. They are roles: finding the agent, describing the deal, proving the approval, and limiting the payment."

## A7. Questions to expect, with answers

**About trust and identity**
- **Who checks that the chatbot is genuine?** The merchant does, with a signature check that only Talkshop can make.
- **Who checks that I'm a customer?** The merchant does. It checks the member token it issued when you linked your account. Your name and email are not sent to the chat.
- **Is the customer check real?** In the demo, the merchant's member records, the sign-in code and the tokens are stand-ins in our backend. In production, you link your account once and the merchant checks its own records.
- **What can the agent do without asking me?** Search. It cannot pay without your approval, and every payment has a limit and a single use.

**About the AI**
- **Does the AI decide what I pay?** No. It only reads your request. The price comes from the merchant, and the approval comes from you.
- **What if the AI misunderstands?** You see the request summary and the checkout before you approve. You can cancel.
- **Is the AI blocked from seeing my card?** Yes. Card details never reach the chat or the agent.

**About money and approval**
- **Can it be charged twice?** The token is single-use. A second attempt is refused.
- **What if the price changes?** The checkout is locked. A change breaks the fingerprint, and you must approve again.
- **What if the payment fails?** Nothing is charged and no order is created. The reason is shown.
- **Is there a limit?** Yes. In the demo, $700 per checkout, set in code. A real system lets the customer set it.

**About data and privacy**
- **What does the merchant learn about me?** Only a customer code, plus the order. Not your name, email or card number.
- **Where is the card stored?** Only the brand, last four digits and a reference are kept. The full number is never stored by the agent or shown in the trace.
- **Is my data sent to an outside AI service?** The intent and scope checks send your message to Gemini. In production, you would choose the model and region, and review its terms.

**About standards and maturity**
- **Are these real standards?** UCP, AP2 and ACP are published by their owners, but several are new and still changing. Our demo follows their ideas and uses our own demo keys.
- **What is simulated?** The merchant, the processor, the membership list, the signing keys and the network calls between agents. Each is named openly in the demo.
- **What's next?** Connect to a real merchant's checkout, a real payment provider, and a real account link. We'd also add a daily spending limit.

**About the demo itself**
- **Can the agent buy more than one item?** Yes, from one merchant. It asks for one approval for the whole cart.
- **What about two merchants?** Two separate checkouts, two approvals, two orders.
- **Why does the card form fill itself in?** The browser may fill saved card details. The app's form starts empty.

**Closing line for questions:** "The short answer is that the AI can help you choose, but the rules, the signatures and your approval are what make the purchase safe."

---

# Part B: Reference

## 1. The three tabs

| Tab | Use it for | What it shows |
|---|---|---|
| **Story** | Presenting the flow | Nine stages, one row each. **View details** opens the events behind a row. |
| **Live** | Showing evidence | One card per event, in order. Open a card to see its details. |
| **Flow** | Explaining the big picture | The nine steps of the purchase, top to bottom. |

Use **Story** first, **Flow** if you want a picture, and **Live** when a client asks to see a specific step.

**Trace per chat:** the Live, Story and Flow views are kept for each chat in the browser tab. A refresh or a switch back to the chat shows the same steps. A new browser or device starts empty.

---

## 2. Who does what, and where it runs

In this demo, everything runs in one backend, so the other parties are simulated.

| Party | Role | Where it runs in the demo | In production |
|---|---|---|---|
| **You** | Ask, select, approve | Browser | You |
| **Customer agent** | Checks input, reads intent, creates the permission and the payment token, records approval | Talkshop backend | Talkshop platform |
| **Merchant (Nike)** | Verifies the agent, lists products, locks the checkout, checks the token, creates the order | Talkshop backend, simulated | Nike's own systems |
| **Payment processor** | Charges the card | Mock processor | Payment provider, then card network, then your bank |

**Where is each step?**
- Input checks, intent, the permission, the approval record and the payment token: **our side**.
- Trust checks, products, checkout, token check and the order: **Nike's side**, simulated here.
- The charge: **the payment provider's side**. Visa, Mastercard and banks are not called in this demo.

---

## 3. Live: every card, in order

Live shows one card per event. Cards are grouped by stage below. Titles are shown exactly as they appear. Names in brackets come from the merchant or the event.

### Stage 1: Your request

**Security checks passed**
Your message passed the safety checks: no empty input, no abusive language, no personal data, and no request for card details. These checks are rule-based, not AI.

**Shopping request: PASS**
A Gemini classification confirms the message is about shopping. If it isn't, the card reads "Shopping request: BLOCK" and the message is refused. If the check cannot finish, the request is stopped, not allowed through. The card shows the category.

**Request understood**
The brand, product type, size and price were identified from your message. This card appears when the intent is checked against its schema.

### Stage 2: Connecting to the merchant

**Routing to [Merchant]**
The brand you named selects the merchant. Without a brand, the agent chooses by category. The chip shows how many merchants were asked.

**Customer agent connected to [Merchant]**
Our agent reads the merchant's agent card, which lists its name and what it can do.

**[Merchant] verified the Customer agent**
The merchant checks that the agent is registered, that it comes from Talkshop, and that its signature is valid. This shows the agent is genuine. It does not show who you are.

**[Merchant] confirmed you gave permission**
The permission names this agent and carries a pseudonymous customer code (`cust_…`). The merchant sees the code, not your account, name or email.

**[Merchant] confirmed the action is allowed**
The action (search, checkout or payment) and the merchant are inside what you allowed. Amounts must be within the $700 agent limit.

**[Merchant] opened a trusted session**
The merchant's record that the agent passed its checks. Checkout and payment need it. The card says whether you are a member or a guest. A guest sees "You are a guest at [Merchant]". A member sees "You are a [Merchant] member".

### Stage 3: Products

**[Merchant] found [N] products**
The merchant's catalogue returns the matching items.

**Products checked**
Each product is checked before the agent uses it. The price must be above zero. The merchant label check is a placeholder in this demo: it does not verify Nike's signature, because Nike's answer is not signed yet.

### Stage 4: Selection and checkout

**You selected a product**
Your agent asks the merchant for a checkout. Nike checks the permission again before it creates anything. This check is in the backend. The card shows the request.

**Points checked** (members only)
The merchant's answer: points available and pending. In the demo, the merchant's answer comes from a stand-in for its records.

**Points applied** (only if you did not change the points slider)
The merchant applies the points and returns the discount and the new total. The approval covers that total. 10 points = $1 in this demo.

**[Merchant] created your checkout: $[total]**
The merchant locks the price, tax, shipping and delivery date. Sent over HTTP to the merchant's checkout endpoint (UCP). If the cart has several items, this one checkout covers all of them.

**Cart saved for approval**
A signed cart record binds the products, quantities and total to a fingerprint of the checkout (AP2). This fixes what you are asked to approve. It is not an approval.

**Spending limit: passed**
The amount due, after points, is within the agent's $700 limit per checkout. If it is over the limit, the card reads "Spending limit: blocked", and nothing is charged. The chips show the amount and the limit.

### Stage 5: Your approval

**Loyalty Choice Applied** (only when you move the points slider)
Records your choice of points. The cart is signed again for the new amount. Live shows only the latest state.

**You approved the order**
You clicked **Authorize Payment**, or the countdown ran out with no pause or cancel. The approval is tied to this exact total and card. Nothing is charged before this card.

**Approval saved**
The signed approval record (AP2). It is created only after you approve.

### Stage 6: Payment

**One-time payment permission created**
A single-use token (ACP) for [Merchant]. It works for this amount and this checkout only, and expires in 15 minutes. Your card details are never shared with the agent.

**[Merchant] checked the payment**
Nike checks the token: signature, merchant, checkout, amount, currency and expiry. It also checks that your approval record matches this order. Nike also re-checks the agent's permission for payment before charging. That check runs in the backend.

**Payment processed**
Card charged (simulated). All payment checks passed first. The card shown is Visa •••• 4001. The 12 payment checks run before the processor is called.

### Stage 7: Order

**Order created**
[Merchant] created your order. For a multi-item cart, one order covers every item.

**[Merchant] confirmed your order**
The final order, returned to your agent and shown to you.

### Cards hidden in Live

These still happen and still appear in Story's details. They are hidden to keep Live short:
- progress cards (input checks running, intent being extracted, the message sent to the merchant, the catalogue search)
- the identity-received card, the internal DPAT card, the boundary check card, the order proposal card, the separate AP2 evidence-verified card, the 12-checks card
- the payment re-check card (merged into "[Merchant] checked the payment")
- repeated points-slider cards (only the latest is shown)
- demo-only cards: bad credential, charge above the authorised amount, payment token rejected, delivery date change, re-consent, old token invalidated, checkout cancelled

**Failure cards are never hidden:** blocked input, blocked scope, trust failure, approval mismatch, payment stopped.

---

## 4. Story: nine rows

Story groups the same events into nine rows. Each row has up to three short lines. **View details** opens the events behind it.

| Row | What it says | Status colour |
|---|---|---|
| **Your request** | Safe and about shopping, or stopped by a safety check | green / red |
| **Understood** | The product you asked for | green |
| **Merchant** | Which merchant was selected | green |
| **Trust** | The merchant verified your agent and your permission. You are a member or a guest. | green / red |
| **Products** | How many products, each checked before use | green |
| **Checkout** | The merchant created your checkout, the points applied, and whether you are within the spending limit | green |
| **Your approval** | You approved the order, or waiting for you | green / amber |
| **Payment** | Permission created, merchant checked it, card charged. Or payment stopped, nothing charged. | green / red |
| **Order** | The merchant created and confirmed your order | green |

Amber means waiting for you. Red means stopped. Grey means not reached yet.

---

## 5. Flow: the nine steps

The Flow tab is a fixed picture, not built from live events. It is the same every time:

1. **You ask a question.**
2. **Agent connects to the merchant (A2A).** The agent shows its permission and the merchant checks it.
3. **Products returned.** The merchant's catalogue (UCP format) is searched over MCP, and the matching items come back to your agent. The A2A request carries the search. Each item is checked before use.
4. **You select a product (A2A).** Your agent asks the merchant for a checkout.
5. **Checkout created (UCP).** The merchant reads stock and price over MCP, then locks the price, tax, shipping and delivery date.
6. **You approve (AP2).** A signed record of the cart and of your approval.
7. **Payment permission (ACP).** A single-use token for this amount is sent to the merchant.
8. **Payment.** The merchant checks the token and approval, then the card is charged.
9. **Order confirmed (A2A).** The merchant confirms the order to your agent.

The protocol labels say which standard each step follows. A2A is the agent-to-agent message. UCP is the product and checkout format. MCP is how the agent calls the merchant's tools for product search, stock and price. AP2 is the signed approval record. ACP is the single-use payment token.

---

## 6. One cart, one checkout, one order

- Several items from **one merchant** become **one checkout** with one total.
- You approve **once** for the whole cart.
- The payment is **one charge** for the total.
- The order lists **every item**. The orders list shows "N items".
- Items from **different merchants** become **one checkout per merchant**, each with its own approval and order.

Each item keeps its own quantity, size and price on the checkout and on the confirmation.

---

## 7. ECDSA: where it is used

ECDSA (Elliptic Curve Digital Signature Algorithm, P-256 with SHA-256) is a digital signature. Talkshop signs with a private key only it holds. Anyone with the matching public key can check a signature, but cannot create one.

| Use | What is signed | Who checks it |
|---|---|---|
| **The permission** (agent credential) | Agent identity and permission | The merchant, at search, selection and payment |
| **The payment token** (ACP) | Merchant, checkout, amount, expiry | The merchant, before charging |
| **The approval records** (AP2) | Cart and approval evidence | The merchant, before charging |

Our internal enforcement step and some internal records use **HMAC**, a shared-secret signature used only inside our system.

**Why ECDSA?** The merchant must be able to check a signature without being able to create one. A shared secret would let the merchant forge signatures too.

**Demo note:** the signing keys are created in memory when the server starts. In production, the private key would be held in secure key storage.

---

## 8. VIC mimic: the spending limit

**What we built:** a fixed $700 limit for each checkout. An amount due above it is refused before any payment step. The customer can change the order and try again.

**What Visa Intelligent Commerce does (public sources):** the consumer sets spending limits and conditions for an agent, can restrict merchant categories, and can require real-time approval. Agents receive tokens rather than card numbers, and tokens can be revoked. Visa describes the product as still being deployed.

**What we copy:** the idea that the customer sets a spending control for the agent, checked before payment. We do not call any Visa system.

**Where the demo differs:**
- The $700 is a fixed demo number for every customer. A real limit is set by the customer.
- Points count toward the limit in the demo. A real system would need a rule for this.
- Each checkout is checked separately. Several smaller orders can each pass, so a real system would also need a daily or monthly limit.

**For the client:** "The customer sets a spending limit for the agent. Any order above it is refused before payment. Our demo fixes the limit at $700 per checkout to show how the control works."

---

## 9. The protocols, and what each one is for

| Protocol | Role here | What the official sources say |
|---|---|---|
| **A2A** | Messages between the customer agent and the merchant agent | An agent-to-agent message standard. |
| **MCP** | The merchant's tools: product search, stock and price lookups | A standard for AI systems to call tools. |
| **UCP** | The product and checkout format: price, tax, shipping, delivery | A standard for catalogues and checkouts. It does not approve transactions or move money. |
| **AP2** | Signed records: what was bought and that you approved it | Google's open protocol. Its official repository is mainly code, so record types come from secondary sources. It is a record of authorisation, not a payment network. |
| **ACP** | A single-use payment token passed from the agent to the merchant | Developed by OpenAI and Stripe. Official page: an open standard for passing secure payment tokens. Still in beta. Our limits (amount, single use, 15 minutes) are our own design. |
| **x402** | Pays for API access over HTTP | Mainly crypto-native payments. Not used for card checkouts or in this demo. |

**Why not one plain API?** One API call could make a charge, but nothing would prove you approved it, and the caller would have broad access. The protocols separate the roles: the checkout (UCP), the proof of approval (AP2), and a narrow permission to charge (ACP).

**Why AP2 and ACP both?** AP2 proves you agreed. ACP gives permission to charge.

**Where do AP2 and ACP run?** On our side, and the merchant checks them. The card networks and banks do not read them. Between the merchant and the bank, the charge uses established card standards: ISO 8583 messages, EMVCo payment tokens, 3-D Secure and PCI DSS.

---

## 9a. MCP: the merchant's tools

MCP (Model Context Protocol) is a standard way for an AI system to call a set of named tools. Here, Nike's commerce server exposes its product and stock data as tools, and our agent calls them instead of reading the catalogue directly.

**The server exposes 7 tools:**

| Tool | What it does | Used in the flow? |
|---|---|---|
| `search_products` | Finds products matching the request | Yes, during search |
| `get_product` | Looks up one product by ID | No |
| `check_inventory` | Checks stock and delivery time for a product and size | Yes, when building the checkout |
| `get_price` | Returns the current price for a product and size | Yes, when building the checkout |
| `calculate_shipping` | Returns the shipping cost for a product | No (a wrapper exists, not called yet) |
| `create_checkout` | Creates a checkout | No (checkout uses the UCP endpoint instead) |
| `get_order_status` | Returns the status of an order | No |

**Resources and prompts:** none are exposed in this demo.

**What to say:** "The merchant publishes its stock and prices as tools. Our agent asks for the current price and stock when it builds the checkout, so the figure it shows is the merchant's live figure, not a copy."

**Why this matters:** the price the customer approves comes from the merchant's tool, not from the AI, and not from a stored list.

**Caveat:** in the demo the tools run inside our backend, and the merchant is simulated. In production, Nike would run its own MCP server.

**Not shown in Live:** the MCP calls do not have their own Live card or Story row. The product list and the stock and price checks appear through the products and checkout cards. Explain MCP when a client asks how the product list or the stock check works.

## 10. Scenarios

**A. Member, card only.** Points are shown but not applied. The card is charged the full total.

**B. Member, partial points.** Amount due = total − points ÷ 10. Example: $140.65 total, 110 points → $11.00 covered → **$129.65 charged**.

**C. Member, all points.** The points cover the whole order. The amount due is $0, so there is no token, no processor and no payment checks. The merchant's loyalty record settles the order.

**D. Guest (for example, Adidas, or a Nike customer who has not linked).** No points, no saved card. The card is entered at a secure step. The checkout offers "Link your [Merchant] account". The trust card says "You are a guest at [Merchant]".

**E. Linked member.** After the sign-in pop-up, the checkout is re-checked as a member, with points and the saved card. The saved card is charged by the merchant through its own payment provider, with no Talkshop token.

**F. Several items, two merchants.** Items are split by merchant. Each merchant gets its own checkout, its own approval, its own payment and its own order. A member at one merchant and a guest at another is handled separately.

**E. Several items, one merchant.** One checkout, one approval, one payment, one order listing every item.

**F. Items from two merchants.** Two checkouts, two approvals, two orders.

---

## 11. Is the flow correct?

Yes. The order is: input checks, scope check, intent, merchant selection, trust, products, selection, checkout, approval, permission, merchant check, payment, order, and confirmation. Each card is a real recorded event.

**Limits to state openly:**
- The merchant, the trust checks, the checkout and the processor run in our backend.
- Search and checkout are HTTP calls to our own server acting as the merchant.
- The signing keys are demo keys.
- The scope check and the intent step both call Gemini. If Gemini is slow or down, the request is stopped and the chat says so.
- The intent card only appears when Guardrails AI is installed on the server.
- The points balance comes from our loyalty table in the demo.
- The Story line "card number and CVC never leave the browser" is fixed text. Confirm it before repeating it to a bank.

---

## 12. Presenter notes

- **Countdown:** after an item is added from the product list, the cart strip shows "Checking out in 5s" with Pause and Proceed now buttons. Pause freezes it; Resume restarts it at 5 seconds. Proceed now opens the checkout summary at once. Neither button approves payment.
- **Settings:** the profile menu has a Settings panel with the demo controls: linked accounts (with Unlink), "Reset demo links", and "Reset demo points". Keep these off the main screen during the talk.
- **Sign-in code:** the demo one-time code is fixed. Say so if the client asks how it works.
- **Card fields:** the browser may fill in saved card details. The form starts empty in the app. Use a private window if you need it blank.
- **Slow AI message:** "The AI service is responding slowly" means Gemini did not answer in time. Wait a moment and try again.
- **Loyalty card title:** the points choice card still reads "Loyalty Choice Applied". Rename it to "You chose points" if you want it simpler.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **A2A** | Messages between agents. |
| **AP2** | Signed records of what was bought and what was approved. |
| **ACP** | A single-use payment token passed to the merchant. |
| **UCP** | The product and checkout format. |
| **MCP** | A standard for AI systems to call tools: product search, stock and price. |
| **ECDSA** | A digital signature. Only the private-key holder can sign, anyone can check. |
| **HMAC** | A shared-secret signature, used only inside our system. |
| **Permission (credential)** | The signed permission the agent shows the merchant. |
| **Pseudonymous code** | A stable code (`cust_…`) that stands in for your identity. |
| **Trusted session** | The merchant's record that the agent passed its checks. |
| **Member / guest** | Member: you have a merchant account, points and maybe a saved card. Guest: no account. |
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

## 14. Quick answers

- **Where does the purchase happen?** Checkout and payment are on the merchant's side. In this demo, everything runs in Talkshop's backend and the charge goes to a simulated processor.
- **Do you store my card?** No. The agent never sees it. Only the brand, last four digits and a payment reference are used.
- **What stops a charge above what I approved?** The approval is tied to the checkout fingerprint, the token is tied to the exact amount, and the merchant checks both before charging.
- **Can the agent buy without asking?** No. Nothing is charged until you approve the exact checkout.
- **Why not one API?** The roles are separated: checkout, proof of approval, and permission to charge.
- **Is my name or email shared with the merchant?** No. The merchant sees a pseudonymous code.
- **Can I buy several items at once?** Yes, from one merchant. You approve once for the whole cart.

---

## Appendix: what changed for this demo

- The scope check calls Gemini directly and fails closed. It never shows PASS for a check that did not run.
- Live hides demo-only, progress and duplicate cards. Approval and payment are split into "You approved the order" and "Payment processed".
- Merchant and agent names come from each event, not from hard-coded text.
- Story is simplified to nine rows. Flow is a fixed nine-step picture.
- The trace is saved per chat in the browser tab.
- A cart from one merchant is one checkout, one approval, and one order. This is on the `feature/multi-product-checkout` branch.
