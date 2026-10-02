# Agentic Commerce POC — Status

> Last updated: 2026-10-01

---

## Current Branch: `v2-upgrade`

---

## Version 1 (Frozen — `ts-version1` branch)
Full 5-phase POC with 6-agent pipeline, DPAT tokens, guardrails, and audit trail.

| Phase | Status |
|---|---|
| Phase 1 — Foundation & Infrastructure | ✅ Complete |
| Phase 2 — Agentic Discovery via MCP | ✅ Complete |
| Phase 3 — Checkout, Consent & DPAT | ✅ Complete |
| Phase 4 — Payment Execution & Dashboard | ✅ Complete |
| Phase 5 — Demo Polish & Scenarios | ✅ Complete |

---

## Version 2 — Conversational Commerce (`v2-upgrade` branch)

Single-page conversational interface with split-screen agent trace panel.

### Completed
- [x] Chase blue color palette (`#117ACA` primary, white light bg / black dark bg)
- [x] AgentTrailPanel restructured — two-column layout (AGENTS list + AGENT OUTPUT) matching reference design
- [x] Agent auto-selection — right panel auto-switches to the currently active agent
- [x] Structured agent output per agent (VibeCheck intent, SneakPeek results, GreenLight DPAT details, etc.)
- [x] Voice command routing — "choose first/second", "confirm", "cancel", "track my order" auto-send
- [x] Voice auto-send after silence — stops recording → sends message automatically after 1.5s silence
- [x] Voice command hint shown while mic is active
- [x] `activeProducts` and `activeIntent` passed from Chat to AgentTrailPanel for richer output
- [x] Collapsible right panel with arrow toggle

### Completed (continued)
- [x] Voice recording delay fixed — `interimResults=true` resets 1.5s timer on each word, fires ~1.5s after last spoken word (was 5-10s)
- [x] Agent recommendation focuses on #1 pick with "Want me to add to cart?" CTA
- [x] Top-ranked product auto-selected when results arrive
- [x] **Single-page conversational flow** — all of discovery → cart → payment → order confirmation → tracker happens in the chat (no page navigation)
- [x] InlineCheckout component: order summary card, animated DPAT processing steps, order confirmed with collapsible tracker
- [x] handleSend intercepts affirmative replies ("yes", "ok", "confirm"…) when product selected — bypasses LangGraph, starts inline checkout
- [x] Known Customer vs Guest landing page — two-CTA redesign
- [x] Guest card input form (number/expiry/CVC) vs saved card tiles for known users

### In Progress
- [ ] Loyalty points system (DB tables + agent awareness)
- [ ] History-based recommendations (reads past orders on login)

### Not Started
- [ ] Login page redesign (two CTAs: Known Customer / Guest)
- [ ] Loyalty points DB schema + backend service
- [ ] Post-purchase loyalty award + balance display in chat
- [ ] `status.md` updates after each feature (ongoing)

---

## Version 3 — Universal Agentic Commerce (future branch)

| Feature | Status |
|---|---|
| UCP merchant discovery | 🔮 Not started |
| ACP agent-to-bank token handshake | 🔮 Not started |
| APGP payment protocol | 🔮 Not started |
| X402 machine-to-machine micropayments | 🔮 Not started |
| Always-on wake word | 🔮 Not started |
| Facial recognition login | 🔮 Not started |
| Cross-merchant universal loyalty | 🔮 Not started |

---

## What's Next (V2 — immediate)
1. Redesign login page with Known Customer / Guest two-CTA layout
2. Convert multi-page routing to single-page state machine in Chat.tsx
3. Add loyalty points tables to SQLite schema
4. Wire loyalty balance into agent context on login
