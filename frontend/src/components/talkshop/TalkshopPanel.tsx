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
import { useTalkshop, type TraceStep } from "../../talkshop/useTalkshop";
import Composer from "./Composer";
import {
  CartUpdatedCard, OptionChips, OrderConfirmedCard, PaymentStatusCard, QuickReplies,
  RecommendationCards, ReviewOrderCard, SelectedProduct,
} from "./cards";
import { cx } from "../ui";

const OPEN_KEY = "talkshop_panel_open";
const STEPS = ["Search", "Choose", "Size", "Colour", "Cart", "Review", "Done"];
const STEP_OF: Record<Stage, number> = {
  GREETING: 0, SEARCHING: 0, RECOMMENDED: 1, PRODUCT_SELECTED: 1, ASK_SIZE: 2, ASK_COLOR: 3, VARIANT_CONFIRMED: 3,
  IN_CART: 4, OFFER_CHECKOUT: 4, AWAITING_CONSENT: 5, PAYING: 5, ORDER_CONFIRMED: 6,
};
const AGENTS: Record<string, string> = {
  VibeCheck: "Understands the request", SneakPeek: "Searches the ShopSphere catalog",
  CartUp: "Cart & checkout", GreenLight: "Consent + one-time payment token",
  PayIt: "12 security checks, then charges", TrackIt: "Creates the order",
};

function isDesktop() { return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches; }

export default function TalkshopPanel() {
  const ts = useTalkshop();
  const [open, setOpen] = useState(() => {
    try { const saved = localStorage.getItem(OPEN_KEY); return saved === null ? isDesktop() : saved === "1"; }
    catch { return isDesktop(); }
  });
  const [presenter, setPresenter] = useState(false);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* private mode */ } }, [open]);

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

function Conversation({ ts }: { ts: ReturnType<typeof useTalkshop> }) {
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
            active={it.index === lastReview && stage === "AWAITING_CONSENT"} />
        );
        const ev = it.ev;
        switch (ev.type) {
          case "suggestions":
            return <QuickReplies key={i} active={it.index === lastSuggest && lastUser < it.index && !busy}
              choices={ev.chips.map((c) => ({ value: c, label: c, primary: false }))} onPick={(c) => ts.send({ text: c.label })} />;
          case "recommendations":
            return <RecommendationCards key={i} products={ev.products} onAct={act}
              active={it.index === lastRecs && !busy && !["AWAITING_CONSENT", "PAYING"].includes(stage)} />;
          case "product_selected":
            return <SelectedProduct key={i} event={ev} />;
          case "ask_option":
            return <OptionChips key={i} option={ev.option} label={ev.label} choices={ev.choices} onAct={act}
              active={it.index === lastAsk && !busy && stage === (ev.option === "size" ? "ASK_SIZE" : "ASK_COLOR")} />;
          case "cart_updated":
            return <CartUpdatedCard key={i} cart={ev.cart} lineId={ev.added_line_id} />;
          case "offer_checkout":
            return <QuickReplies key={i} choices={ev.choices}
              active={it.index === lastOffer && lastOffer > lastReview && !busy && (stage === "OFFER_CHECKOUT" || stage === "IN_CART")}
              onPick={(c) => act({ type: c.value === "checkout" ? "checkout" : "keep_shopping", label: c.label })} />;
          case "order_confirmed":
            return <OrderConfirmedCard key={i} order={ev.order} />;
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
function PresenterTrace({ trace, onClose }: { trace: TraceStep[]; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 bg-canvas/97 backdrop-blur overflow-y-auto ss-scroll p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">How Talkshop works</p>
        <button onClick={onClose} className="text-xs underline">Back to chat</button>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        Talkshop decides what should happen; ShopSphere's services do it. Payment runs as plain code, never the AI,
        and only after you tap GO AHEAD.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(AGENTS).map(([name, role]) => (
          <div key={name} className="rounded-xl border border-line px-2.5 py-2">
            <p className="text-xs font-semibold text-talk">{name}</p><p className="text-[11px] text-muted leading-snug">{role}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Live trace</p>
        {trace.length === 0 ? <p className="text-xs text-faint">Steps appear here as Talkshop works.</p> : (
          <ol className="flex flex-col gap-1.5">
            {trace.map((t, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span className="text-faint tabular-nums w-14 shrink-0">{new Date(t.at).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</span>
                <span className="font-semibold text-talk w-20 shrink-0">{t.agent}</span>
                <span className="text-ink-soft">{t.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
