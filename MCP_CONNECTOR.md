# TalkShop as an MCP Connector (ChatGPT / Claude)

Written for: the TalkShop developer deciding what to build next.

---

## 1. Short answer

**Not yet.** Today an external LLM can *search, price, and quote* through TalkShop, but it **cannot complete a purchase**.

What exists today:

- A real MCP server is already mounted at `/mcp/` in `backend/main.py` (Streamable HTTP, stateless).
- It exposes 7 tools from `backend/mcp/server.py`: `search_products`, `get_product`, `check_inventory`, `get_price`, `calculate_shipping`, `create_checkout`, `get_order_status`.
- It has **no authentication**. `create_checkout` takes a `user_id` argument that defaults to `"USR001"`. Do not publish this as-is: anyone who can reach the URL can act as that user.

What is missing for "Can you buy this via TalkShop?" to work:

1. **Customer identity** for the external LLM (currently only the TalkShop JWT, which the MCP layer ignores).
2. **Purchase tools** (cart, trusted session, checkout proposal, loyalty, payment method, GO AHEAD).
3. **A consent step a human actually performs** on TalkShop. TalkShop's design (`backend/purchase/service.py`) records *GO AHEAD* as the customer's explicit approval of an exact checkout. An LLM must not be able to press it for them.
4. **A public HTTPS URL.** ChatGPT and Claude's cloud connect from their servers, so `localhost` will not work without a tunnel or deployment.

---

## 2. Architecture to aim for

```
ChatGPT / Claude (cloud)
        │  MCP over HTTPS  (OAuth or bearer token)
        ▼
TalkShop MCP layer  ── /mcp/   (new tools: discovery + cart + checkout proposal)
        │  calls the same service functions the web app uses
        ▼
TalkShop backend (FastAPI, SQLite, DPAT/AP2/ACP guardrails — unchanged)
        │
        ▼
Human confirmation on TalkShop web page  →  POST /api/purchase/go-ahead
```

Key rule: the LLM **proposes**, the human **approves** on TalkShop, and only then does payment run.

---

## 3. Endpoint map: TalkShop capability → MCP tool

Existing REST endpoints (all verified in `backend/routers/`):

| Capability | MCP tool (proposed) | Existing endpoint | Auth |
|---|---|---|---|
| Search products | `search_products` | `GET /api/products?category=&merchant_id=` (and `/mcp` `search_products`) | none needed for reads |
| Product details / price / stock | `get_product` | `GET /api/products/{product_id}` | none |
| Merchants list | `list_merchants` | `GET /api/merchants`, `GET /api/merchants/{merchant_id}` | none |
| Shipping and totals | `calculate_shipping` | `POST /ucp/checkout-sessions` (locks totals) | optional `member_token` |
| View cart | `get_cart` | `GET /api/cart` | user |
| Add to cart | `add_to_cart` | `POST /api/cart/items` | user |
| Change / remove cart line | `update_cart_item`, `remove_cart_item` | `PATCH /api/cart/items/{cart_item_id}`, `DELETE /api/cart/items/{cart_item_id}` | user |
| Open trusted merchant session | `open_trust_session` | `POST /api/trust/session` | user |
| Build checkout proposal | `create_purchase_proposal` | `POST /api/purchase/checkout` | user |
| Apply loyalty points | `apply_loyalty` | `POST /api/purchase/loyalty` | user |
| Saved payment methods (read only) | `list_payment_methods` | `GET /api/payment-methods` | user |
| Accept re-consent after merchant change | `reconsent` | `POST /api/purchase/reconsent` | user (see §5) |
| Order list / detail | `list_orders`, `get_order` | `GET /api/orders`, `GET /api/orders/{order_id}` | user |
| Wallet balance | `get_wallet` | `GET /api/wallet` | user |
| Loyalty balance | `get_loyalty` | `GET /api/loyalty?merchant_id=` | user |
| Who am I | `get_me` | `GET /api/auth/me` | user |
| Link merchant account | `link_merchant_start`, `link_merchant_verify`, `link_merchant_approve` | `POST /api/merchant-link/start`, `/verify`, `/approve` | user |
| **Authorize payment (GO AHEAD)** | **Do not expose as a tool.** Return a link to the TalkShop page instead. | `POST /api/purchase/go-ahead` | user + human click |

Endpoints that must **stay browser-only** (never expose to an LLM):

- `POST /api/psp/payment-methods`: card registration. Raw card data must never pass through a chat model.
- `POST /api/psp/paypal-connect`
- `POST /api/merchant/payments`: merchant charges a delegated token. Merchant-side only.
- `POST /api/authorizations/approve`, `/revoke`, `/validate`: internal guardrail and consent plumbing.
- `POST /api/auth/reset-password`, `/api/auth/register`: account management.

Current `/mcp` tools that need fixing before exposure:

- `create_checkout(user_id="USR001")`: remove the `user_id` parameter. Derive the user from the authenticated token.
- `get_order_status`: scope to the authenticated user.
- `check_inventory` / `get_price` / `calculate_shipping`: fine to keep, but read from the same source as the web app.

---

## 4. Steps to connect (once the tools above exist)

### 4a. Step-by-step: host, expose `/mcp/`, and connect Claude

Run everything from the repo root, `d:\VIRTUSA\Work\talkshop`. Terminal 1 runs the backend and terminal 2 runs the tunnel. Both stay open.

**Step 1: Set the MCP token (once)**

1. If you don't have `.env` yet, copy `.env.example` to `.env` and fill in the keys it lists, such as the LLM API key.
2. Generate a token:
   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
3. Put it in `.env` as `MCP_BEARER_TOKEN=<that value>`. You'll paste the same value into Claude in step 7.

**Step 2: Install (once)**

1. `pip install -r requirements.txt`
2. `winget install --id Cloudflare.cloudflared`
   If `winget` isn't available, download `cloudflared-windows-amd64.exe` from Cloudflare's GitHub releases and rename it to `cloudflared.exe`.

**Step 3: Start the backend (terminal 1)**

```powershell
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

You should see `[LLM] Using ...` in the output.

**Step 4: Check the backend locally**

1. Open `http://localhost:8000/`. Expected: `{"status":"ok", ...}`.
2. Without a token, MCP must refuse you:
   ```powershell
   curl.exe -i -X POST http://localhost:8000/mcp/
   ```
   Expected: `401`.
3. With the token, MCP must accept you:
   ```powershell
   curl.exe -i -X POST http://localhost:8000/mcp/ -H "Authorization: Bearer <your token>"
   ```
   Expected: any status other than `401`. The empty body may return a different error, which is fine. It means the token was accepted.

If the app's own product search fails after this step, check that `MCP_BEARER_TOKEN` is set in `.env`. The backend uses `/mcp/` internally too.

**Step 5: Expose it (terminal 2). Pick one option.**

- **Option A, Quick Tunnel (free, no domain, random URL):**
  ```powershell
  cloudflared tunnel --url http://localhost:8000
  ```
  Copy the `https://random-words-1234.trycloudflare.com` address it prints. This exposes the whole backend, not only `/mcp/`, and the address changes on every restart.

- **Option B, named tunnel (fixed URL, only `/mcp` exposed, needs a domain on Cloudflare):**
  ```powershell
  cloudflared tunnel login
  cloudflared tunnel create talkshop
  cloudflared tunnel route dns talkshop mcp.yourdomain.com
  ```
  Create `%USERPROFILE%\.cloudflared\config.yml`:
  ```yaml
  tunnel: talkshop
  credentials-file: C:\Users\DELL\.cloudflared\<tunnel-id>.json
  ingress:
    - hostname: mcp.yourdomain.com
      path: ^/mcp
      service: http://localhost:8000
    - service: http_status:404
  ```
  Then run it:
  ```powershell
  cloudflared tunnel run talkshop
  ```
  Everything except `/mcp` returns 404 through this address, so the login and order APIs stay off the public internet.

**Step 6: Check the public address**

1. Option A only: open `https://<your-address>/` in a browser. Expected: `{"status":"ok", ...}`.
2. Both options:
   ```powershell
   curl.exe -i -X POST https://<your-address>/mcp/ -H "Authorization: Bearer <your token>"
   ```
   Expected: not `401`. With Option B, the root URL returns 404 by design.

**Step 7: Add the connector in Claude on the web**

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. URL: `https://<your-address>/mcp/`. The trailing slash matters.
3. Authentication: enter the bearer token, the same value as `MCP_BEARER_TOKEN`. If the form only offers OAuth or no authentication, stop here. The bearer check won't work with that form, so see section 5.
4. Save. Custom connectors need a paid plan.

**Step 8: Test**

1. Start a new chat and enable the TalkShop connector.
2. Try: "Search TalkShop for running shoes and show the prices."
3. Approve each tool call the first time it runs.

**Step 9: After the demo**

1. Press Ctrl+C in both terminals to stop the backend and the tunnel.
2. With Option A, the next start gives a new address, so update the connector URL. With Option B, the address stays the same.

**Troubleshooting**

- `uvicorn: command not found` or `No module named backend`: you're not in the repo root, or packages aren't installed.
- Port 8000 in use: stop the other process, or use another port and point the tunnel at it.
- Public address doesn't load: the backend or the tunnel has stopped. Both must stay open.
- Claude can't connect: check the URL ends in `/mcp/` and is the current tunnel address.
- Claude shows no tools: remove the connector, add it again, and start a new chat.

**Before sharing the URL:** the MCP server has no login, so anyone with the link can call its tools. Keep the URL private, stop the tunnel when done, and add authentication before a wider demo.

### 4b. Claude

Option 1, Claude Desktop, local stdio bridge (works with `localhost` directly):

1. Open Claude Desktop → Settings → Developer → Edit Config. This opens `claude_desktop_config.json`.
2. Add:
   ```json
   {
     "mcpServers": {
       "talkshop": {
         "command": "npx",
         "args": ["mcp-remote", "http://localhost:8000/mcp/"]
       }
     }
   }
   ```
3. Restart Claude Desktop. The TalkShop tools should appear under the tools (hammer) icon.

Option 2, claude.ai web or mobile, hosted (needs the public HTTPS URL):

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. Paste `https://<your-host>/mcp/`.
3. Complete the sign-in step if the connector asks for OAuth (see §5).
4. Enable the connector in a chat. Each tool call shows an approval prompt the first time.

Plan note: custom connectors require a paid Claude plan. Check current plan rules.

### 4c. ChatGPT

1. ChatGPT → Settings → Apps (may appear as **Connectors** in some versions).
2. Turn on **Developer mode** (under Advanced settings). This is required for custom MCP servers.
3. Create a new app / connector and enter the MCP server URL `https://<your-host>/mcp/`.
4. Choose authentication. Use OAuth if implemented (see §5), otherwise a bearer token.
5. Start a new chat, enable the connector, and ask for a purchase.

Plan note: developer mode for custom MCP servers requires a paid ChatGPT plan. UI labels change often; match them against the current app.

### 4d. Hosting (for others to use it)

- Deploy the backend to any host with HTTPS (Render, Railway, Fly.io, Azure App Service, or a VM behind Caddy/nginx).
- Set `CORS` origins only if the web UI is also hosted.
- Persist the SQLite file or move to Postgres. The current app seeds data on startup.
- Keep `.env` secrets (LLM keys, JWT secret) out of the repo. `.env.example` already exists.

---

## 5. What must be built first

**a) Authentication for MCP (required before any user-facing exposure)**

- Add OAuth 2.1 with PKCE. Endpoints needed:
  - `/.well-known/oauth-protected-resource` (points to the auth server)
  - `/.well-known/oauth-authorization-server`
  - `/authorize` (login page on TalkShop, reusing `POST /api/auth/login`)
  - `/token` (exchange code for an access token; can reuse the existing JWT from `backend/auth/security.py`)
  - `/register` (dynamic client registration, if you want ChatGPT/Claude to self-register)
- Until OAuth exists, the fallback is a per-user bearer token that the user pastes into the connector's header settings. Acceptable for a demo, not for public use.
- Every MCP tool must read the user from the token, never from a parameter.

**b) Purchase tools with a human-in-the-loop gate**

1. The LLM calls `create_purchase_proposal`. The tool calls `POST /api/trust/session` and `POST /api/purchase/checkout` and returns a summary (items, total, payment method, merchant).
2. The tool **does not** call `go-ahead`. It returns a link to the TalkShop checkout page (`/checkout`, which is login-protected) so the user can open the pending checkout there. The checkout ID must be carried in the link or the page must look up the user's pending checkout. Confirm which one before building.
3. The user presses GO AHEAD on TalkShop. That records the consent with `consent_mode="click"` and runs the existing payment flow.
4. The LLM can then call `get_order` to report the result.

Why: `backend/purchase/service.py` records `GO AHEAD` as "Authorize Payment clicked: I authorize this exact checkout." If an LLM triggers it, the audit trail would falsely show a human approval. The MCP client's own tool-approval prompt is not the same as TalkShop's consent record.

**c) Remove the default-user and raw-data paths from MCP**

- No `user_id` tool parameters.
- No card fields. Payment is only by `payment_method_id` (reference) and loyalty points.

**d) Decide the trust story for the external agent**

- Today TalkShop issues a "customer agent credential" in `backend/trust/credentials.py`. For an external agent, decide whether ChatGPT or Claude counts as the customer agent (likely yes, with the credential bound to the OAuth client ID) and document it for the demo.

---

## 6. Test checklist (run once the steps above are done)

- [ ] `tools/list` over MCP returns only the intended tools (no `create_checkout` with `user_id`, no `go-ahead`).
- [ ] Calling a user-scoped tool without a token returns 401.
- [ ] A user cannot read another user's orders, cart, or loyalty by changing an argument.
- [ ] `create_purchase_proposal` returns a checkout link and does not charge anything.
- [ ] Opening the link and pressing GO AHEAD creates an order and an audit event with `consent_mode="click"`.
- [ ] Declining or leaving the page does not change the order state.
- [ ] Merchant price change between proposal and GO AHEAD triggers the re-consent path.

---

## 7. Open decisions for you

1. Use OAuth (proper) or a bearer token (faster for the demo)?
2. Should the buy step always require the TalkShop page, or can the connector show an in-chat confirmation for small amounts?
3. Which merchants to expose first? (All six are in `data/merchants.json`.)
4. Host publicly for the demo, or demo locally with a tunnel?

---

## 8. Reference files

- MCP server: `backend/mcp/server.py`, mounted in `backend/main.py`
- MCP client used internally: `backend/mcp/client.py`
- Auth dependency: `backend/auth/dependencies.py`
- Purchase flow: `backend/routers/purchase.py`, `backend/purchase/service.py`
- Authorization / DPAT: `backend/routers/authorizations.py`
- Cart: `backend/routers/cart.py`
- Products and merchants: `backend/routers/products.py`, `backend/routers/merchants.py`
- Orders, wallet, loyalty: `backend/routers/payments.py`, `backend/routers/loyalty.py`
- Merchant linking: `backend/routers/merchant_link.py`
