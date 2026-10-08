/**
 * Talkshop — ShopSphere's assistant, docked on the right of every store page
 * (open by default on desktop; a bottom sheet on phones), minimisable to an
 * "Ask Talkshop" button. Mounted once in the store layout, so the
 * conversation carries on as the shopper moves between pages.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Info, Minus, RotateCcw, Sparkles, X } from "lucide-react";
import type { Stage, TalkAction, TalkEvent } from "../../api/talkshop";
import type { Checkout } from "../../api/shop";
import type { TraceStep } from "../../talkshop/useTalkshop";
import { useTalkshopShared } from "../../talkshop/TalkshopContext";
import Composer from "./Composer";
import {
  CartUpdatedCard, CheckoutCountdown, OptionChips, OrderConfirmedCard, PaymentStatusCard, QuickReplies,
  OrderTrackingCard, RecommendationCards, ReviewOrderCard, SecureDetailsCard, SelectedProduct, SignInCard, TrackLookupCard,
} from "./cards";
import { cx } from "../ui";

const STEPS = ["Search", "Choose", "Size", "Colour", "Cart", "Review", "Done"];
const STEP_OF: Record<Stage, number> = {
  GREETING: 0, SEARCHING: 0, RECOMMENDED: 1, PRODUCT_SELECTED: 1, ASK_SIZE: 2, ASK_COLOR: 3, VARIANT_CONFIRMED: 3,
  IN_CART: 4, OFFER_CHECKOUT: 4, CHECKOUT_DETAILS: 5, AWAITING_CONSENT: 5, PAYING: 5, ORDER_CONFIRMED: 6,
};
const AGENTS: Record<string, string> = {
  VibeCheck: "Understands the request", SneakPeek: "Searches the ShopSphere catalog",
  CartUp: "Cart & checkout", GreenLight: "Consent + one-time payment token",
  PayIt: "12 security checks, then charges", TrackIt: "Creates the order",
};

export default function TalkshopPanel() {
  const ts = useTalkshopShared();
  const { open, setOpen } = ts;
  const [presenter, setPresenter] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed z-50 bottom-5 right-5 inline-flex items-center gap-2 h-12 pl-4 pr-5 rounded-full bg-talk text-white shadow-float hover:opacity-95">
        <Sparkles size={18} /> <span className="text-sm font-semibold">Ask Talkshop</span>
      </button>
    );
  }

  return (
    <>
      <div className="lg:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
      <aside
        aria-label="Talkshop assistant"
        className={cx("z-50 flex flex-col bg-canvas border-line",
          "fixed inset-x-0 bottom-0 h-[88vh] rounded-t-3xl border-t shadow-float",
          "lg:sticky lg:top-16 lg:inset-auto lg:h-[calc(100vh-4rem)] lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none")}>
        <Header stage={ts.stage} onMinimise={() => setOpen(false)} onRestart={ts.restart}
          presenter={presenter} onPresenter={() => setPresenter((p) => !p)} />
        <div className="relative flex-1 min-h-0">
          <Conversation ts={ts} />
          {presenter && <PresenterTrace trace={ts.trace} onClose={() => setPresenter(false)} />}
        </div>
        <Composer disabled={ts.busy} onSend={(text, image) => ts.send(image ? { text, image_base64: image } : { text })} />
      </aside>
    </>
  );
}

function Header({ stage, onMinimise, onRestart, presenter, onPresenter }:
  { stage: Stage; onMinimise: () => void; onRestart: () => void; presenter: boolean; onPresenter: () => void }) {
  const current = STEP_OF[stage];
  return (
    <div className="border-b border-line px-4 pt-3 pb-3">
      <div className="lg:hidden mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-full bg-talk text-white grid place-items-center"><Sparkles size={17} /></span>
        <div className="flex-1 min-w-0 leading-tight">
          <p className="font-semibold">Talkshop</p>
          <p className="text-xs text-muted">ShopSphere assistant</p>
        </div>
        <IconBtn title="How Talkshop works" on={presenter} onClick={onPresenter}><Info size={16} /></IconBtn>
        <IconBtn title="New conversation" onClick={onRestart}><RotateCcw size={15} /></IconBtn>
        <IconBtn title="Minimise" onClick={onMinimise}><span className="hidden lg:block"><Minus size={17} /></span><span className="lg:hidden"><X size={17} /></span></IconBtn>
      </div>
      <ol className="mt-3 flex items-center gap-1" aria-label="Your progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1 flex flex-col items-center gap-1" aria-current={i === current ? "step" : undefined}>
            <span className={cx("h-1 w-full rounded-full transition-colors", i <= current ? "bg-talk" : "bg-line")} />
            <span className={cx("text-[10px]", i === current ? "text-talk font-semibold" : "text-faint")}>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function IconBtn({ title, on, onClick, children }: { title: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={cx("w-8 h-8 grid place-items-center rounded-full transition-colors", on ? "bg-talk-soft text-talk" : "text-muted hover:text-ink hover:bg-panel")}>
      {children}
    </button>
  );
}

/* ── Conversation ──────────────────────────────────────────────────────── */

type Item =
  | { kind: "user"; text: string; image?: boolean }
  | { kind: "bot"; text: string }
  | { kind: "event"; ev: TalkEvent; index: number }
  | { kind: "review"; checkout: Checkout; index: number }
  | { kind: "payment"; ev: Extract<TalkEvent, { type: "payment_status" }> };

function buildItems(events: TalkEvent[]): Item[] {
  const items: Item[] = [];
  events.forEach((ev, index) => {
    if (ev.type === "user_message") items.push({ kind: "user", text: ev.text, image: ev.image });
    else if (ev.type === "message") items.push({ kind: "bot", text: ev.text });
    else if (ev.type === "checkout_ready") {
      // Re-shown review (e.g. after typing "go ahead") moves down instead of duplicating
      const prev = items.findIndex((it) => it.kind === "review" && it.checkout.checkout_id === ev.checkout.checkout_id);
      if (prev >= 0) items.splice(prev, 1);
      items.push({ kind: "review", checkout: ev.checkout, index });
    }
    else if (ev.type === "checkout_updated") {
      for (let i = items.length - 1; i >= 0; i--) {     // newest review of this checkout shows the latest state
        const it = items[i];
        if (it.kind === "review" && it.checkout.checkout_id === ev.checkout.checkout_id) { it.checkout = ev.checkout; break; }
      }
    } else if (ev.type === "payment_status") {
      const prev = items[items.length - 1];
      if (prev?.kind === "payment") prev.ev = ev; else items.push({ kind: "payment", ev });
    } else if (ev.type !== "variant_confirmed") items.push({ kind: "event", ev, index });
  });
  return items;
}

function lastIndex(events: TalkEvent[], type: TalkEvent["type"]) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === type) return i;
  return -1;
}

function Conversation({ ts }: { ts: ReturnType<typeof useTalkshopShared> }) {
  const { events, stage, busy, status, error } = ts;
  const items = useMemo(() => buildItems(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  // Scroll only the chat — never the store page behind it.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, busy, status]);

  const act = (action: TalkAction & { label?: string }) => { if (!busy) ts.send({ action }); };
  const lastUser = lastIndex(events, "user_message");
  const lastRecs = lastIndex(events, "recommendations");
  const lastAsk = lastIndex(events, "ask_option");
  const lastOffer = lastIndex(events, "offer_checkout");
  const lastReview = lastIndex(events, "checkout_ready");
  const lastSuggest = lastIndex(events, "suggestions");
  const lastLogin = lastIndex(events, "login_required");
  const lastDetails = lastIndex(events, "checkout_details_needed");
  const lastTrackForm = lastIndex(events, "track_order_form");
  // Each auto-checkout countdown fires at most once, whatever re-renders after it.
  const countdownsFired = useRef(new Set<number>());
  // Each checkout is paid automatically at most once: after a decline (or any
  // GO AHEAD) the shopper decides, so a declined card is never retried on its own.
  const autoPaid = useRef(new Set<string>());

  return (
    <div ref={scroller} className="absolute inset-0 overflow-y-auto ss-scroll px-4 py-4 flex flex-col gap-3 [&>*]:shrink-0">
      {items.map((it, i) => {
        if (it.kind === "user") return (
          <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-ink text-canvas px-3.5 py-2 text-sm">
            {it.image && <span className="opacity-70">📷 </span>}{it.text}
          </div>
        );
        if (it.kind === "bot") return (
          <div key={i} className="self-start max-w-[92%] rounded-2xl rounded-bl-md bg-panel px-3.5 py-2 text-sm leading-relaxed">{it.text}</div>
        );
        if (it.kind === "payment") return <PaymentStatusCard key={i} state={it.ev.state} payment={it.ev.payment} message={it.ev.message} />;
        if (it.kind === "review") return (
          <ReviewOrderCard key={i} checkout={it.checkout} busy={busy} onAct={act}
            active={it.index === lastReview && stage === "AWAITING_CONSENT"}
            autoPay={it.index >= ts.restoredCount && !autoPaid.current.has(it.checkout.checkout_id)
              && !events.slice(it.index).some((e) => e.type === "payment_status")}
            onAutoPay={(id) => autoPaid.current.add(id)} />
        );
        const ev = it.ev;
        switch (ev.type) {
          case "suggestions":
            return <QuickReplies key={i} active={it.index === lastSuggest && lastUser < it.index && !busy}
              choices={ev.chips.map((c) => ({ value: c, label: c, primary: !!ev.chip_actions?.[c] }))}
              onPick={(c) => { const a = ev.chip_actions?.[c.label]; ts.send(a ? { action: { ...a, label: c.label } } : { text: c.label }); }} />;
          case "recommendations":
            return <RecommendationCards key={i} products={ev.products} onAct={act}
              active={it.index === lastRecs && !busy && !["CHECKOUT_DETAILS", "AWAITING_CONSENT", "PAYING"].includes(stage)} />;
          case "product_selected":
            return <SelectedProduct key={i} event={ev} />;
          case "ask_option":
            return <OptionChips key={i} option={ev.option} label={ev.label} choices={ev.choices} onAct={act}
              active={it.index === lastAsk && !busy && stage === (ev.option === "size" ? "ASK_SIZE" : "ASK_COLOR")} />;
          case "cart_updated":
            return <CartUpdatedCard key={i} cart={ev.cart} lineId={ev.added_line_id} />;
          case "offer_checkout": {
            const live = it.index === lastOffer && lastOffer > lastReview && !busy && (stage === "OFFER_CHECKOUT" || stage === "IN_CART");
            const pick = (c: { value: string; label: string }) => {
              countdownsFired.current.add(it.index);
              act({ type: c.value === "checkout" ? "checkout" : "keep_shopping", label: c.label });
            };
            // The step after this offer has already happened (a tap, the auto-checkout,
            // the sign-in card): the offer is done — never count down again.
            const settled = lastUser > it.index || lastLogin > it.index;
            const counting = live && !settled && stage === "OFFER_CHECKOUT"
              && it.index >= ts.restoredCount && !countdownsFired.current.has(it.index);
            if (counting) return <CheckoutCountdown key={i} onPick={pick} />;
            return <QuickReplies key={i} choices={ev.choices} active={live && !settled} onPick={pick} />;
          }
          case "order_confirmed":
            return <OrderConfirmedCard key={i} order={ev.order} email={ev.email} />;
          case "track_order_form":
            return <TrackLookupCard key={i} orderId={ev.order_id} onAct={act}
              active={it.index === lastTrackForm && lastUser < it.index && !busy} />;
          case "order_tracking":
            return <OrderTrackingCard key={i} order={ev.order} />;
          case "checkout_details_needed":
            return <SecureDetailsCard key={i} checkoutId={ev.checkout_id} needs={ev.needs} guest={ev.guest} wallet={ev.wallet} onAct={act}
              active={it.index === lastDetails && stage === "CHECKOUT_DETAILS" && !busy} />;
          case "login_required":
            return <SignInCard key={i} active={it.index === lastLogin && lastReview < it.index && lastDetails < it.index}
              onGuest={() => act({ type: "checkout", guest: true, label: "Continue as guest" })} />;
          default:
            return null;
        }
      })}
      {busy && (
        <div className="self-start flex items-center gap-2 rounded-2xl bg-panel px-3.5 py-2.5 text-sm text-muted">
          <span className="flex gap-1">{[0, 1, 2].map((d) => (
            <span key={d} className="w-1.5 h-1.5 rounded-full bg-talk animate-bounce" style={{ animationDelay: `${d * 120}ms` }} />))}</span>
          {status ?? "Thinking…"}
        </div>
      )}
      {error && <p className="self-start text-xs text-bad">{error}</p>}
    </div>
  );
}

/* ── Presenter view ────────────────────────────────────────────────────── */
const GUARDRAILS: { agent: string; checks: string[] }[] = [
  { agent: "VibeCheck", checks: ["Card numbers, CVC and expiry masked in the browser and again on the server",
    "Emails masked before the AI sees the history", "Input guardrail: keyword list + NeMo",
    "Not-sold blocker", "The AI may only pick an action allowed at this stage; payment is never one of them"] },
  { agent: "SneakPeek", checks: ["Prices, stock and ratings only from the catalog", "AI relevance check (no unrelated cards)"] },
  { agent: "CartUp", checks: ["Exact size/colour stock check", "Login, sign up or guest at checkout",
    "Merchant-calculated total + SHA-256 fingerprint", "Secure forms: details go to ShopSphere, the AI gets IDs",
    "Ownership check on saved address/card"] },
  { agent: "GreenLight", checks: ["Consent gate: GO AHEAD (tap or 3-second countdown with Stop)",
    "Live stock and price refresh", "Spending policy: approved merchant, USD, up to $2,500",
    "One-time token: HMAC-SHA256 signed, 15 minutes, single use"] },
  { agent: "PayIt", checks: ["12 checks: token exists · active · not expired · not used · right agent · right merchant · "
    + "right order · right currency · within limit · equals checkout total · fingerprint unchanged · consent exists",
    "Charge saved card token or wallet; decline = no order"] },
  { agent: "TrackIt", checks: ["Order created only after authorization; payment voided if creation fails",
    "Guarded stock decrement, points spent/earned", "Confirmation email (see Email)",
    "Tracking: own orders when logged in, Order ID + email for guests"] },
];

const PROTOCOLS: { name: string; what: string; where: string }[] = [
  { name: "MCP", what: "The AI uses tools from a fixed list", where: "VibeCheck picks search / select / checkout; code runs it" },
  { name: "UCP", what: "Common store capabilities", where: "Product discovery, identity (log in / guest), order tracking" },
  { name: "ACP", what: "Merchant-owned checkout session + delegated payment", where: "Create / update / complete checkout; card → token" },
  { name: "AP2", what: "Proof the shopper approved this exact cart", where: "Consent record, signed scoped token, 12 checks, audit log" },
  { name: "A2A", what: "Agents from different companies", where: "Not implemented: the agents hand off inside one app" },
];

const EMAIL_STEPS = [
  "Order created (only after the payment is authorized)",
  "Recipient: the customer's account email, or the guest's checkout email",
  "Message written to the outbox: Order ID, items, total, status, tracking link (no card data)",
  "Real address + SMTP set in .env → sent in the background via Gmail (TLS, App Password)",
  "Made-up address (.demo, example.com) or no SMTP → kept in the demo outbox",
  "Outbox records sent / failed; an email problem never undoes the order",
  "Viewable on Track order → View confirmation email",
];

type InfoTab = "trace" | "guardrails" | "protocols" | "email";

function PresenterTrace({ trace, onClose }: { trace: TraceStep[]; onClose: () => void }) {
  const [tab, setTab] = useState<InfoTab>("trace");
  const tabs: [InfoTab, string][] = [["trace", "Live trace"], ["guardrails", "Guardrails"], ["protocols", "Protocols"], ["email", "Email"]];
  const chip = (r?: string) => r === "pass" ? "bg-good-soft text-good" : r === "blocked" ? "bg-bad-soft text-bad" : "bg-panel text-muted";
  return (
    <div className="absolute inset-0 z-10 bg-canvas/97 backdrop-blur overflow-y-auto ss-scroll p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">How Talkshop works</p>
        <button onClick={onClose} className="text-xs underline">Back to chat</button>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        Talkshop decides what should happen; ShopSphere's services do it. Everything that touches money or private
        data is plain code with fixed checks, never the AI.
      </p>
      <div role="tablist" className="grid grid-cols-4 rounded-full bg-panel p-1 text-[11px] font-medium">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cx("h-7 rounded-full", tab === key ? "bg-canvas shadow-card text-ink" : "text-muted hover:text-ink")}>{label}</button>
        ))}
      </div>

      {tab === "trace" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(AGENTS).map(([name, role]) => (
              <div key={name} className="rounded-xl border border-line px-2 py-1.5">
                <p className="text-[11px] font-semibold text-talk">{name}</p><p className="text-[10px] text-muted leading-snug">{role}</p>
              </div>
            ))}
          </div>
          {trace.length === 0 ? <p className="text-xs text-faint">Each step and guardrail appears here as Talkshop works.</p> : (
            <ol className="flex flex-col gap-1.5" aria-label="Live guardrail trace">
              {trace.map((t, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-faint tabular-nums w-11 shrink-0">{new Date(t.at).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</span>
                  <span className="font-semibold text-talk w-[4.5rem] shrink-0">{t.agent}</span>
                  {t.check ? (
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="font-medium text-ink">{t.check}</span>
                        <span className={cx("rounded-full px-1.5 text-[10px] font-semibold uppercase", chip(t.result))}>{t.result}</span>
                        {t.protocol && <span className="rounded-full border border-line px-1.5 text-[10px] text-muted">{t.protocol}</span>}
                      </span>
                      {t.message && <span className="block text-muted leading-snug">{t.message}</span>}
                    </span>
                  ) : <span className="text-ink-soft">{t.message}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === "guardrails" && (
        <div className="flex flex-col gap-2.5">
          {GUARDRAILS.map((g) => (
            <div key={g.agent} className="rounded-xl border border-line p-2.5">
              <p className="text-xs font-semibold text-talk mb-1">{g.agent}</p>
              <ul className="flex flex-col gap-0.5 text-[11px] text-ink-soft leading-snug list-disc pl-4">
                {g.checks.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab === "protocols" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted">Inspired by these protocols, not a certified implementation of them.</p>
          {PROTOCOLS.map((p) => (
            <div key={p.name} className="rounded-xl border border-line p-2.5 text-[11px]">
              <p className="text-xs font-semibold"><span className="text-talk">{p.name}</span> · {p.what}</p>
              <p className="text-muted leading-snug mt-0.5">{p.where}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "email" && (
        <ol className="flex flex-col gap-1.5 text-[11px] text-ink-soft leading-snug list-decimal pl-4">
          {EMAIL_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
    </div>
  );
}
