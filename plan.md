# UI/UX Enhancement Plan
**Branch:** `enhancement/ui-ux-polish`
**Goal:** Professional, demo-ready agentic commerce chatbot for JPMC/Citi client presentation.

---

## Task Tracker

| # | Task | Category | Effort | Status |
|---|------|----------|--------|--------|
| 1 | Fix mic duplicate transcription | Bug fix | 30 min | ✅ Done |
| 2 | Guardrail blocked message — human tone + PII refusal | UX copy | 20 min | ✅ Done |
| 3 | Agent persona names in step messages | UX copy | 30 min | ✅ Done |
| 4 | Suggestion chips on empty chat state | Cosmetic | 30 min | ✅ Done |
| 5 | Multi-select products → floating checkout bar | UX flow | 2 hrs | ⏳ Pending |
| 6 | Fix irrelevant product results (category filter tighten) | Bug fix | 1 hr | ✅ Done |
| 7 | Expand local seed data (~120 products, all categories) | Data | 2 hrs | ✅ Done |
| 8 | DummyJSON free product API adapter (no key needed) | Backend | 1 hr | ⏳ Pending |
| 9 | Delivery / size / color filters wired end-to-end | Backend | 2 hrs | ✅ Done |
| 10 | Agent trail right panel (live agent activity per query) | Frontend | 4 hrs | ⏳ Pending |
| 11 | Card selection on checkout (multi-card wallet) | Frontend | 3 hrs | ⏳ Pending |
| 12 | Dashboard rebuild — table + inline audit trail expand | Frontend | 4 hrs | ⏳ Pending |
| 13 | Ranked recommendation cards with score explanation | Frontend | 3 hrs | ⏳ Pending |
| 14 | Dark / light mode toggle | Cosmetic | 1 hr | ⏳ Pending |
| 15 | Logo left-aligned, header polish | Cosmetic | 15 min | ⏳ Pending |

---

## Update Log

| Date | Task # | What changed |
|------|--------|--------------|
| 2026-09-30 | — | Branch created, plan initialized |
| 2026-09-30 | 1 | `isFinal` check in `onresult` — stops duplicate mic transcriptions |
| 2026-09-30 | 2 | Guardrail copy rewritten — friendly PII refusal + scope guard message |
| 2026-09-30 | 3 | All 7 workflow step messages now name VibeCheck / SneakPeek by role |
| 2026-09-30 | 4 | Empty chat state replaced with heading + 6 suggestion chips |
| 2026-09-30 | 6 | CATEGORY_ALIASES dict + strict filter in `sneakpeek.py`; VibeCheck prompt updated with 11 canonical categories and user-word mappings |
| 2026-09-30 | 7 | `data/products.json` expanded from 80 → 137 products across 11 categories with real brand names, Pexels images, colors, delivery days |
| 2026-09-30 | 9 | Color and delivery_days constraint filters added to `filter_products()`; color match bonus (+12pts) added to `rank_products()` |

---

## Design Principles
- Every screen should work for a first-time viewer with zero explanation
- Agent names (VibeCheck, SneakPeek, CartUp, GreenLight) should be visible and meaningful
- Error states must be as polished as happy paths
- No placeholder text in production-facing copy
- Mobile-width layout must not break (16px gutters, no horizontal scroll)
