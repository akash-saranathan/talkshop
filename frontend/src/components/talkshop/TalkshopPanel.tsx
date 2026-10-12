/**
 * Talkshop AI — ShopSphere's assistant, docked on the right of every store page
 * (open by default on desktop; a bottom sheet on phones), minimisable to an
 * "Ask Talkshop" button. Mounted once in the store layout, so the
 * conversation carries on as the shopper moves between pages.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Info, Minus, RotateCcw, Sparkles, X } from "lucide-react";
import { ShopError } from "../../api/shop";
import { PasskeyCancelled, usePasskey } from "../../member/PasskeyContext";
import { useMember } from "../../member/MemberContext";
import type { Stage, TalkAction, TalkEvent } from "../../api/talkshop";
import type { Checkout } from "../../api/shop";
import type { TraceStep } from "../../talkshop/useTalkshop";
import { useTalkshopShared } from "../../talkshop/TalkshopContext";
import Composer from "./Composer";
import {
  AgentPaySetupCard, ApprovalCard, CartUpdatedCard, CheckoutCountdown, OptionChips, OrderConfirmedCard, PaymentStatusCard, QuickReplies,
  OrderTrackingCard, RecommendationCards, ReviewOrderCard, SecureDetailsCard, SelectedProduct, SignInCard, TrackLookupCard,
} from "./cards";
import { cx } from "../ui";

// Customer-friendly progress (Part 2): Find → Choose → Review → Approve → Done
const STEPS = ["Find", "Choose", "Review", "Approve", "Done"];
const STEP_OF: Record<Stage, number> = {
  GREETING: 0, SEARCHING: 0, RECOMMENDED: 1, PRODUCT_SELECTED: 1, ASK_SIZE: 1, ASK_COLOR: 1, VARIANT_CONFIRMED: 1,
  IN_CART: 1, OFFER_CHECKOUT: 1, CHECKOUT_DETAILS: 2, AWAITING_CONSENT: 2, PAYING: 3, ORDER_CONFIRMED: 4,
};
const AGENTS: Record<string, string> = {
  VibeCheck: "Understands the request", SneakPeek: "Searches the ShopSphere catalog only",
  CartUp: "Cart, offers & authoritative totals", GreenLight: "Consent + DPAT (scoped token)",
  PayIt: "12 DPAT checks, then the gateway", TrackIt: "Order, email & tracking",
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
          "lg:sticky lg:top-[var(--ss-header-h,4rem)] lg:inset-auto lg:h-[calc(100vh-var(--ss-header-h,4rem))] lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none")}>
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
  const { open: approving } = usePasskey();
  // While the passkey prompt is open the member is on the Approve step.
  const current = approving && stage === "AWAITING_CONSENT" ? 3 : STEP_OF[stage];
  return (
    <div className="border-b border-line px-4 pt-3 pb-3">
      <div className="lg:hidden mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong" />
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-full bg-talk text-white grid place-items-center"><Sparkles size={17} /></span>
        <div className="flex-1 min-w-0 leading-tight">
          <p className="font-semibold">Talkshop AI</p>
          <p className="text-xs text-muted">Your cardmember shopping assistant</p>
        </div>
        <IconBtn title="Developer trace: how Talkshop works" on={presenter} onClick={onPresenter}><Info size={16} /></IconBtn>
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
  const lastApproval = lastIndex(events, "approval_required");
  const lastSetup = lastIndex(events, "agent_pay_setup");
  const { approveAgentPayment, enrollAgentPay } = usePasskey();
  const member = useMember();
  const [vicError, setVicError] = useState<string | null>(null);

  // Visa path: ShopSphere's own passkey prompt approves this exact order; Talkshop
  // only receives the resulting instruction id with the go-ahead.
  const approve = async (ev: Extract<TalkEvent, { type: "approval_required" }>) => {
    setVicError(null);
    try {
      const id = await approveAgentPayment(ev.checkout_id, { amount: ev.amount, card: ev.payment ?? undefined }, ev.consent_mode);
      ts.send({ action: { type: "go_ahead", checkout_id: ev.checkout_id, instruction_id: id, label: "Approved with passkey" } });
    } catch (e) {
      if (e instanceof PasskeyCancelled) ts.send({ action: { type: "approval_cancelled", label: "Cancelled the approval" } });
      else setVicError(e instanceof ShopError ? `${e.message} Nothing was charged.` : "Approval failed. Nothing was charged.");
    }
  };
  const setup = async (ev: Extract<TalkEvent, { type: "agent_pay_setup" }>, card: string) => {
    setVicError(null);
    try {
      await enrollAgentPay(ev.card_account_id, card);
      void member.refresh();
      ts.send({ action: { type: "agent_pay_ready", label: "Set up Visa agent payments" } });
    } catch (e) {
      setVicError(e instanceof PasskeyCancelled || e instanceof ShopError ? e.message : "Setup didn't complete.");
    }
  };
  // Each auto-checkout countdown fires at most once, whatever re-renders after it.
  const countdownsFired = useRef(new Set<number>());

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
          case "approval_required":
            return <ApprovalCard key={i} amount={ev.amount} payment={ev.payment}
              active={it.index === lastApproval && stage === "AWAITING_CONSENT" && !busy && lastUser < it.index}
              autoStart={it.index >= ts.restoredCount} onApprove={() => approve(ev)} />;
          case "agent_pay_setup": {
            const reviewEv = events[lastReview];
            const card = reviewEv?.type === "checkout_ready" ? reviewEv.checkout.payment_method?.display ?? "Visa" : "Visa";
            return <AgentPaySetupCard key={i} active={it.index === lastSetup && stage === "AWAITING_CONSENT" && !busy && lastUser < it.index}
              onSetup={() => setup(ev, card)} />;
          }
          case "login_required":
            return <SignInCard key={i} reason={ev.reason}
              active={it.index === lastLogin && lastReview < it.index && lastDetails < it.index && lastUser < it.index} />;
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
      {vicError && <p className="self-start text-xs text-bad">{vicError}</p>}
    </div>
  );
}

/* ── Developer trace (presenter view) ──────────────────────────────────── */
const GUARDRAILS: { agent: string; checks: string[] }[] = [
  { agent: "Eligibility", checks: ["Every marketplace API: signed-in member with an active, eligible Chase credit card (simulated fixture)",
    "Guests → LOGIN_REQUIRED; checking-only → NO_ELIGIBLE_CARD (enforced on the server, not just hidden in the UI)"] },
  { agent: "VibeCheck", checks: ["Card numbers, CVC and expiry masked in the browser and again on the server",
    "Emails masked before the AI sees the history", "Input guardrail: keyword list + NeMo", "Not-sold blocker",
    "The AI may only pick an action allowed at this stage; payment is never one of them"] },
  { agent: "SneakPeek", checks: ["ShopSphere's catalog only (merchant-restricted search)", "Prices, stock, offers and points from the server",
    "AI relevance check (no unrelated cards)"] },
  { agent: "CartUp", checks: ["Exact size/colour stock check", "Server picks the member offer; totals + SHA-256 fingerprint are server-only",
    "Secure forms: details go to ShopSphere, the AI gets IDs", "Changing the order cancels any open Visa instruction"] },
  { agent: "GreenLight", checks: ["Approve and pay (tap, or typed GO AHEAD) + simulated passkey on the Visa path; no automatic payment",
    "Live stock and price refresh", "Spending policy: approved merchant, USD, up to $2,500",
    "DPAT: HMAC-SHA256 signed, 15 minutes, single use"] },
  { agent: "PayIt", checks: ["12 DPAT checks: exists · active · not expired · not used · agent · merchant · order · currency · limit · total · fingerprint · consent",
    "Visa path: 12 VIC-inspired controls, then a one-time purchase credential", "Gateway request with an idempotency key; decline / timeout = no order"] },
  { agent: "TrackIt", checks: ["Order created once, only after authorization; voided if creation fails",
    "Points and offers recorded once per order (no double redemption)", "Confirmation email", "Tracking"] },
];

const PROTOCOLS: { name: string; what: string; where: string }[] = [
  { name: "VIC", what: "Visa Intelligent Commerce (Visa's agent-payment capabilities)",
    where: "Inspired by: agent token, passkey step-up, authenticated instruction, controls, purchase credential, commerce signals. Local simulation, not connected to Visa, not VIC compliant." },
  { name: "VTS", what: "Visa Token Service", where: "Not used. Our agent tokens (vat_…) are random local values, not VTS or network tokens." },
  { name: "AP2", what: "Agent payments: proof the member approved this exact cart", where: "AP2-style consent record, DPAT and 12 checks. Local HMAC, not production-compliant." },
  { name: "ACP", what: "Agentic checkout", where: "ACP-style merchant-owned checkout (create / update / complete). Kept separate from the PSP credential." },
  { name: "UCP", what: "Common commerce capabilities", where: "UCP-inspired discovery, identity and orders over local REST/JSON. Not full UCP compliance." },
  { name: "MCP", what: "Model Context Protocol", where: "Not used in Demo 1: Talkshop picks from a fixed in-process tool list (MCP-style idea, no MCP client/server)." },
  { name: "A2A", what: "Agent-to-agent across companies", where: "Not needed: Demo 1's six agents run inside one app. (Demo 2 covers assistant → merchant agent.)" },
  { name: "TAP", what: "Visa Trusted Agent Protocol", where: "Not used: relevant when an independent external agent visits a merchant (Demo 2), not for an embedded merchant agent." },
];

const EMAIL_STEPS = [
  "Order created (only after the payment is authorized)",
  "Recipient: the member's account email",
  "Message written to the outbox: Order ID, items, total, status, tracking link (no card data)",
  "Real address + SMTP set in .env → sent in the background (TLS)",
  "Made-up address (.demo, example.com) or no SMTP → kept in the demo outbox",
  "Outbox records sent / failed; an email problem never undoes the order",
];

/** The Visa path's 12 milestones (brief §8), matched against real trace entries. */
const VIC_STEPS: { label: string; match: (t: TraceStep) => boolean }[] = [
  { label: "Cardmember eligibility", match: (t) => t.check === "VIC control 1/12 · Cardmember session + eligibility" },
  { label: "Visa card + agent token active", match: (t) => t.check === "VIC control 3/12 · Active agent token" },
  { label: "Checkout created", match: (t) => t.check === "Merchant-owned checkout" },
  { label: "Payment instruction authenticated", match: (t) => t.check === "VIC control 4/12 · Instruction authenticated" },
  { label: "GreenLight checks (DPAT 12/12)", match: (t) => t.check === "DPAT check 12/12 · Consent record exists" },
  { label: "VIC-inspired controls (12/12)", match: (t) => t.check === "VIC control 12/12 · Inventory + final checkout state" },
  { label: "Purchase credential issued", match: (t) => t.check === "Purchase credential issued" },
  { label: "Mock gateway request sent", match: (t) => t.check === "Gateway request sent" },
  { label: "Simulated Visa network controls", match: (t) => t.check === "Simulated Visa network" },
  { label: "Simulated Chase issuer", match: (t) => t.check === "Simulated Chase issuer" },
  { label: "Commerce signal recorded", match: (t) => t.check === "Commerce signal recorded" },
  { label: "Order confirmed", match: (t) => t.check === "Order confirmed" },
];

type InfoTab = "trace" | "vic" | "guardrails" | "protocols" | "email";

function PresenterTrace({ trace, onClose }: { trace: TraceStep[]; onClose: () => void }) {
  const [tab, setTab] = useState<InfoTab>("vic");
  const tabs: [InfoTab, string][] = [["vic", "Payment"], ["trace", "Live trace"], ["guardrails", "Guards"], ["protocols", "Protocols"], ["email", "Email"]];
  const chip = (r?: string) => r === "pass" ? "bg-good-soft text-good" : r === "blocked" ? "bg-bad-soft text-bad" : "bg-panel text-muted";
  // The latest purchase attempt: everything since the last consent gate.
  const startAt = (() => { for (let i = trace.length - 1; i >= 0; i--) if (trace[i].check === "Consent gate") return i; return -1; })();
  const attempt = startAt >= 0 ? trace.slice(Math.max(0, startAt - 4)) : [];
  const checkoutStep = [...trace.slice(0, startAt >= 0 ? startAt : trace.length)].reverse().find((t) => t.check === "Merchant-owned checkout");
  const vicRows = VIC_STEPS.map((s) => {
    const hit = s.label === "Checkout created" ? checkoutStep : attempt.find(s.match);
    return { label: s.label, step: hit };
  });
  const failed = attempt.find((t) => t.result === "blocked");
  const isVic = attempt.some((t) => t.agent === "VIC simulator");
  return (
    <div className="absolute inset-0 z-10 bg-canvas/97 backdrop-blur overflow-y-auto ss-scroll p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Developer trace</p>
        <button onClick={onClose} className="text-xs underline">Back to chat</button>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        Real backend steps, as they ran. <span className="font-medium text-ink">Local</span> = ShopSphere code that ran here;
        {" "}<span className="font-medium text-gold">Simulated</span> = a local stand-in for an external service (gateway, card
        network, issuer, VIC). No Visa or Chase system is called. Secrets are never shown.
      </p>
      <div role="tablist" className="grid grid-cols-5 rounded-full bg-panel p-1 text-[11px] font-medium">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cx("h-7 rounded-full", tab === key ? "bg-canvas shadow-card text-ink" : "text-muted hover:text-ink")}>{label}</button>
        ))}
      </div>

      {tab === "vic" && (
        <div className="flex flex-col gap-2">
          {startAt < 0 ? <p className="text-xs text-faint">Approve and pay for an order to see its payment lifecycle here.</p> : (
            <>
              <p className="text-xs text-muted">
                {isVic ? "Visa agent payment (VIC-inspired local simulation)" : "Standard card path (no VIC token services)"}
                {failed ? " · stopped at a failed check" : ""}
              </p>
              <ol className="flex flex-col gap-1.5">
                {(isVic ? vicRows : vicRows.filter((r) => !/VIC|credential|instruction|agent token|Commerce/.test(r.label))).map((r, i) => (
                  <li key={r.label} className="flex items-start gap-2 text-xs">
                    <span className="w-5 text-faint tabular-nums shrink-0">{i + 1}.</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{r.label}</span>
                      {r.step?.message && <span className="block text-muted leading-snug">{r.step.message}</span>}
                    </span>
                    <span className={cx("rounded-full px-1.5 text-[10px] font-semibold uppercase shrink-0",
                      r.step ? chip(r.step.result) : "bg-panel text-faint")}>
                      {r.step ? (r.step.result === "pass" ? (r.label.includes("issuer") ? "approved" : "passed") : r.step.result) : "—"}
                    </span>
                  </li>
                ))}
              </ol>
              {failed && <p className="text-xs text-bad">Blocked at: {failed.agent} · {failed.check}{failed.message ? ` (${failed.message})` : ""}</p>}
              {!isVic && <p className="text-[11px] text-muted">Mastercard and non-agent cards use GreenLight + PayIt + the gateway's card-on-file path.</p>}
            </>
          )}
        </div>
      )}

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
            <ol className="flex flex-col gap-2" aria-label="Live guardrail trace">
              {trace.map((t, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-faint tabular-nums w-10 shrink-0">{new Date(t.at).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="font-semibold text-talk">{t.agent}</span>
                      {t.check && t.check !== t.agent && <span className="font-medium text-ink">· {t.check}</span>}
                      {t.result && <span className={cx("rounded-full px-1.5 text-[10px] font-semibold uppercase", chip(t.result))}>{t.result}</span>}
                      {t.layer && <span className={cx("rounded-full px-1.5 text-[10px] font-semibold", t.layer === "simulated" ? "bg-gold-soft text-gold" : "bg-panel text-muted")}>
                        {t.layer === "simulated" ? "Simulated" : "Local"}</span>}
                      {t.protocol && <span className="rounded-full border border-line px-1.5 text-[10px] text-muted">{t.protocol}</span>}
                    </span>
                    {t.message && <span className="block text-muted leading-snug">{t.message}</span>}
                  </span>
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
          <p className="text-[11px] text-muted">How Demo 1 relates to each protocol. "Inspired" or "-style" means a local
            concept demo, not a certified or compliant implementation.</p>
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
