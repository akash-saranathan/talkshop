# Protocol Reality Guide — plain-English, for demo narration

This section exists so anyone narrating a demo can say, truthfully, exactly what's happening at each step — without overclaiming or underselling it. Written for a non-technical reader.

### The one-sentence version

**A2A, MCP, and UCP make real network calls to real servers running inside this same app — they're genuinely "over the wire," just not to a different company's computer. AP2, ACP, and the trust layer sign and verify with real ECDSA (P-256/SHA-256) public/private keypairs via Python's `cryptography` library — the only mock part left is that the keypairs are generated in memory for this demo process rather than issued by a real CA/HSM.**

### What each protocol actually does, and where

| Protocol | Plain-English job | Where it fires | Real or mimicked? |
|---|---|---|---|
| **A2A** (Agent2Agent) | The shopping assistant "talks to" each merchant's own agent to ask it to search its catalog | Every product search | **Real network call.** A genuine HTTP request goes out to that merchant's own server address and a genuine response comes back. |
| **MCP** (Model Context Protocol) | The standard way an AI agent calls a "tool" (search, check stock, get price) without the tool's raw code being exposed to the AI | Every product search, and every time a checkout is being built (price + stock check) | **Real protocol call.** A real MCP client connects to a real MCP server and calls the tool through the actual MCP handshake — not a shortcut function call. |
| **UCP** (Universal Commerce Protocol) | The merchant's own checkout system calculates and "locks in" the official subtotal/tax/shipping/total for this exact cart | The moment a product is selected and a checkout is being prepared | **Real network call.** A real HTTP request asks a real checkout endpoint to compute and return the locked total. |
| **AP2** (Agent Payments Protocol) | The customer's explicit, signed proof that they approved this exact purchase, for this exact amount | Twice: once when the cart is first shown (binds the cart), once when Authorize Payment is pressed (binds the payment) | **Real signing & verification.** A real ECDSA private key signs the mandate; a real public key verifies it before anything proceeds — same asymmetric-cryptography shape a production system would use, just a demo-generated keypair. |
| **ACP** (Agentic Commerce Protocol) | A one-time-use "permission slip" that lets the merchant charge a specific amount, and only that amount, and only once | Right after Authorize Payment, before the actual charge | **Real logic, real ECDSA signature.** The permission slip genuinely can't be reused, can't be stretched to a bigger amount, and its signature is verified against a real public key by the merchant before it charges anything. |
| **Trust layer** (not one of the 5 named protocols, but the gatekeeper for all of them) | Each merchant checks that the shopping assistant is who it claims to be before answering it at all, and enforces the agent's spending limit | Before every search and every checkout, and again at Authorize Payment | **Fully real.** Real ECDSA signature verification, real pass/fail checks, and a real (if demo-valued) $700 spending cap — never mocked. |

### What's still mimicked, and exactly how (no surprises)

- **The network calls are to ourselves.** Every "real" HTTP call above (A2A, MCP, UCP) is this one app calling its own other parts over `localhost` — it's genuinely a network round trip, with everything that implies (it can be slow, it can time out, it can fail), but it's not reaching an actual different company's servers, because Nike/Adidas/etc. are synthetic demo merchants that live inside this same app.
- **The keypairs are demo-generated, not CA/HSM-issued.** AP2, ACP, and the trust layer each sign with a real ECDSA (P-256) private key and verify with the matching public key via Python's `cryptography` library (`backend/ap2/adapter.py`, `backend/acp/delegated.py`, `backend/trust/credentials.py`) — this replaced the project's earlier HMAC shared-secret signing. The *cryptography* is genuinely real: sign with the private key, verify with the public key, reject on any mismatch or tampering. What's still a simplification is where the keypair comes from — it's generated fresh in memory when this app's process starts, not issued by a certificate authority or held in a hardware security module the way a production payment network would.
- **Card numbers never travel through any of this.** Whichever protocol step is running, the only payment information that ever moves between them is an opaque reference (like `pm_demo_nike` or `pp_auth_ab12cd`) — never a real card number, never a CVV. That boundary was never mocked.
- **PayPal is a realistic mock, not a connection to real PayPal.** The "Connect PayPal" flow looks and behaves like the real thing (handoff, sign-in, choose a funding source, approve) but there's no real PayPal account or server involved — it's a believable simulation that produces the same *kind* of result a real connection would. Currently hidden in the UI pending revisit.
- **Carrier/tracking numbers are invented, not real shipments.** UPS/USPS/FedEx/DHL tracking numbers shown after a purchase are generated to look plausible; no real package is ever created or tracked.

### The agent spending guardrail — what it's inspired by, and what it isn't

Visa Intelligent Commerce (VIC) is Visa's real initiative for securing AI-agent-initiated purchases. Conceptually, it brings together four things: a tokenized payment credential (the agent never sees a real card), authentication (a human genuinely authorized this), spending/transaction controls (the agent is only allowed to spend so much), and trusted-agent signals (the merchant can verify the request actually came from a legitimate, unaltered agent).

**This app does not call, integrate with, or claim to be Visa Intelligent Commerce.** It mimics those same four ideas with its own local pieces — some already existing, one newly added (the spending guardrail), one upgraded from a shared-secret to real asymmetric cryptography (the signing):

| The concept | What plays that role here |
|---|---|
| Protected / tokenized payment credential | The `payment_method_id` reference every payment method already reduces to (`pm_demo_nike`, a tokenized card, a loyalty-points-only order) — the raw PAN/CVC never exists past the browser's secure entry, and never reaches the agent, the LLM, A2A messages, the protocol trace, chat history, or logs. |
| Authentication / a human really authorized this | The **Authorize Payment** click — the only thing in the whole app that executes a charge. Nothing fires automatically; there is no second popup, no biometrics. |
| Spending / transaction controls | The **agent spending guardrail**: a fixed $700 cap per checkout (`AGENT_SPENDING_LIMIT` in `backend/trust/credentials.py`), checked against the amount actually due (after any loyalty redemption) both as a live preview on the order proposal and again, authoritatively, the instant Authorize Payment is clicked — before any AP2/ACP/DPAT work runs. Over the limit → blocked, nothing charged, reason shown plainly. |
| Trusted-agent / cryptographic signals | The Trust layer's `credential_signature_valid` check, now backed by real ECDSA signature verification (see above) — the merchant genuinely verifies, with a real public key, that the request came from an unaltered, correctly-signed agent credential before answering it. |

Where you see this live: the Live Trace panel's **Story** view gained two new rows that only appear once a checkout exists — **Loyalty** (points applied, if any) and **Security** (checkout amount vs. the $700 limit, payment-credential status, spending-limit pass/blocked, **cryptographic signature verified/failed**, user-approval status, payment-authorization status). The panel's **Live** tab (the raw event-by-event feed) also describes each security-related event in plain English now, with the full technical detail still available by clicking to expand it. No new tab was added — this lives inside the existing Live Trace / Agent Pipeline switcher, same as everything else. UI wording deliberately avoids "Visa"/"VIC encryption"/"integrated with Visa" — it says things like "protected/tokenized," "local cryptographic authorization," and "VIC-inspired" only in places meant to credit the idea, never to claim the integration.

### How this actually works, in simple words

- **No real card number ever touches the AI.** Whether you're an existing customer (saved card) or a new one (you type a card into the secure entry box), what the app actually keeps and uses afterward is a stand-in reference, like `pm_demo_nike` — not the real number. Same basic idea as Apple Pay or a "card on file" token.
- **There's a spending limit.** The shopping agent is only allowed to authorize up to $700 per order. If a checkout goes over that, it's blocked automatically and you're told why — before anything is signed or charged.
- **There's a real digital signature, not just a label.** When the app creates things like "this cart is approved" or "charge this amount," it signs that message with a real cryptographic key, and whoever checks it (the merchant side) verifies that signature with a matching key. If someone tampered with the message, or it wasn't signed by the real key, the signature check fails and nothing proceeds. This is genuine lock-and-key cryptography — same *kind* of math real payment systems use — just running locally for this demo instead of talking to an outside bank.
- **Nothing is charged until you click "Authorize Payment."** That click is the only thing in the whole app that spends money. No auto-approval, no hidden countdown.
- **You can watch all of this happen.** The Live Trace panel on the right shows each of these checks as they happen — spending check, signature check, your approval, the payment going through — in plain English, with the technical detail available if you click to expand it.

**The one tool doing the real work**: Python's `cryptography` library — specifically ECDSA (elliptic-curve signing, the same family of math used in real digital signatures), with SHA-256 hashing. The app generates its own private/public key pair when it starts up, signs with the private key, and verifies with the public key. No Visa software, no real bank or card network connection, nothing external — it's a local, self-contained simulation of the *idea* behind Visa's real system, not a connection to it.

### A worked example: buying Nike running shoes with Nike loyalty points

Walking through one purchase end to end, naming exactly which protocol does what. This reflects the app as it actually behaves today — no visible countdown, no auto-confirm, loyalty is a slider you control, and signature verification is real:

1. **You ask**: "Nike running shoes."
2. **Trust check** (real, ECDSA): the shopping assistant presents its credential to Nike's agent; Nike's agent verifies the credential's ECDSA signature against Talkshop's published public key and opens a trusted session. If the signature doesn't verify, nothing below happens — the Live Trace Security row would show `Cryptographic authorization failed`.
3. **A2A** (real network call): the assistant sends Nike's agent a real HTTP message asking it to search its catalog.
4. **MCP** (real protocol call): behind that search, the assistant calls the "search_products" tool through a real MCP connection — the actual mechanism by which an AI agent is allowed to call a tool safely.
5. Products come back and are shown to you. You pick a pair of shoes — this adds it to your cart.
6. **UCP** (real network call): a real checkout-session request is sent to lock in the subtotal, tax, shipping, and total for exactly this item and quantity.
7. **Loyalty redemption** (real logic, not a protocol): since you're a Nike member, the order proposal shows a points slider defaulted to "use all eligible points." You can drag it down to redeem fewer points, or to zero for card-only — each change recomputes the amount due live and re-binds the checkout (new hash, new AP2 Cart Mandate) via `POST /api/purchase/loyalty`. This changes the amount owed on a card, but it isn't AP2/ACP/UCP itself; it's a merchant-side decision that happens between UCP's total and the payment step.
8. **Agent spending guardrail** (real check, not a protocol): the amount actually due (after your loyalty choice) is checked against the agent's $700 delegated limit — shown live on the proposal and in the Live Trace Security row as `Spending limit: passed` or `blocked`. Over the limit blocks the order right here, before any signing happens.
9. **AP2 — Cart Mandate** (real ECDSA signing): a signed document is created proving this exact cart (product, quantity, total) is what's being proposed to you.
10. You see the order proposal and click **Authorize Payment** — the only thing that ever executes a charge. Nothing auto-confirms; nothing happens without this click.
11. **AP2 — Payment Mandate** (real ECDSA signing): a second signed document proves you personally approved paying the remaining amount (after points) using your saved card.
12. **ACP** (real logic, real ECDSA signature): a one-time "permission slip" is issued, scoped to that exact amount, that exact merchant, that exact order — signed, and verified by the merchant against the agent's public key, before it charges anything. It can never be reused or stretched.
13. The mock payment processor charges the card for the remaining amount. If points covered the whole order, **this step and the ACP step are skipped entirely** — there's no card to charge, so there's nothing to authorize on the card rails.
14. The order is confirmed, loyalty points are deducted (if used) and earned (on whatever was actually charged), the purchased item is removed from your cart, and a tracking number appears. The Live Trace Security row's last line flips to `Payment authorized`.

Every step above either genuinely happened the way it's described, or is explicitly flagged in this document as mimicked — nothing in that list is overstated.
