/** The cards Talkshop draws inside the panel (plan §6.1). Each renders a
 *  server event as-is — prices, stock, totals and order ids are never
 *  computed here. Only the latest card of a kind is interactive. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, CheckCircle2, CreditCard, Loader2, Lock, MapPin, ShieldCheck, ShoppingBag, Truck, UserRound, XCircle } from "lucide-react";
import type { OptionChoice, TalkAction, TalkEvent } from "../../api/talkshop";
import { money, niceDate, type Cart, type Checkout, type Order, type Product, type TrackedOrder } from "../../api/shop";
import { ShipmentProgress } from "../shopsphere/ShipmentProgress";
import { AddressForm, CardForm, GuestDetailsForm } from "../shopsphere/CheckoutForms";
import { Button, Field, Notice, Rating, Stepper, cx } from "../ui";
import { useAuth } from "../../auth/AuthContext";
import { RESUME_KEY } from "../../talkshop/TalkshopContext";

type Act = (action: TalkAction & { label?: string }) => void;

function Shell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-line bg-canvas overflow-hidden", className)}>{children}</div>;
}

/* ── Top 3 ─────────────────────────────────────────────────────────────── */
export function RecommendationCards({ products, active, onAct }:
  { products: (Product & { reason?: string | null })[]; active: boolean; onAct: Act }) {
  return (
    <div className="flex flex-col gap-2">
      {products.map((p, i) => (
        <Shell key={p.product_id} className="flex gap-3 p-2.5">
          <div className="relative w-20 h-20 shrink-0 rounded-xl bg-photo overflow-hidden">
            {p.image_url && <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />}
            <span className="absolute left-1 top-1 w-5 h-5 rounded-full bg-canvas/90 text-[11px] font-semibold grid place-items-center">{i + 1}</span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex justify-between gap-2">
              <p className="text-sm font-medium leading-tight line-clamp-1">{p.name}</p>
              <p className="text-sm font-semibold tabular-nums shrink-0">{money(p.price)}</p>
            </div>
            <Rating value={p.rating} size={11} />
            {p.reason && <p className="text-xs text-muted leading-snug mt-0.5 line-clamp-2">{p.reason}</p>}
            <div className="mt-auto pt-1.5 flex items-center gap-3">
              <Button size="sm" variant={active ? "primary" : "secondary"} disabled={!active}
                onClick={() => onAct({ type: "select", product_id: p.product_id, label: p.name })}>Select</Button>
              <Link to={`/p/${p.product_id}`} className="text-xs text-muted hover:text-ink inline-flex items-center gap-0.5">
                View on ShopSphere <ArrowUpRight size={12} />
              </Link>
            </div>
          </div>
        </Shell>
      ))}
    </div>
  );
}

/* ── Selected product header ───────────────────────────────────────────── */
export function SelectedProduct({ event }: { event: Extract<TalkEvent, { type: "product_selected" }> }) {
  const p = event.product;
  return (
    <Shell className="flex items-center gap-3 p-2.5">
      <div className="w-12 h-12 rounded-lg bg-photo overflow-hidden shrink-0">{p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" />}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-muted">{event.from_page ? "From this page" : "Selected"}</p>
        <p className="text-sm font-medium line-clamp-1">{p.name}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums">{money(p.price)}</p>
    </Shell>
  );
}

/* ── Size / colour chips ───────────────────────────────────────────────── */
export function OptionChips({ option, label, choices, active, onAct }:
  { option: "size" | "color"; label: string; choices: OptionChoice[]; active: boolean; onAct: Act }) {
  const pick = (c: OptionChoice) => onAct({ type: option === "size" ? "choose_size" : "choose_color", value: c.value,
    label: option === "size" ? `${label} ${c.value}` : c.value });
  if (option === "color") {
    return (
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button key={c.value} type="button" disabled={!active || !c.available} onClick={() => pick(c)}
            title={c.available ? c.value : `${c.value} — out of stock`}
            className={cx("flex items-center gap-2 h-10 pl-1.5 pr-3 rounded-full border text-sm transition-colors",
              c.available ? "border-line-strong hover:border-ink" : "border-line text-faint line-through",
              !active && "opacity-50 cursor-default")}>
            {c.image_url ? <img src={c.image_url} alt="" className="w-7 h-7 rounded-full object-cover bg-photo" />
              : <span className="w-6 h-6 rounded-full border border-black/10" style={{ background: c.hex }} />}
            {c.value}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {choices.map((c) => (
        <button key={c.value} type="button" disabled={!active || !c.available} onClick={() => pick(c)}
          title={c.available ? undefined : "Out of stock"}
          className={cx("min-w-10 h-9 px-2.5 rounded-lg border text-sm font-medium transition-colors",
            c.available ? "border-line-strong hover:border-ink hover:bg-panel" : "border-line text-faint line-through bg-panel",
            !active && "opacity-50 cursor-default")}>
          {c.value}
        </button>
      ))}
    </div>
  );
}

/* ── Added to cart ─────────────────────────────────────────────────────── */
export function CartUpdatedCard({ cart, lineId }: { cart: Cart; lineId: string }) {
  const line = cart.lines.find((l) => l.line_id === lineId);
  if (!line) return null;
  return (
    <Shell className="p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-good mb-2"><Check size={14} /> Added to your ShopSphere cart</p>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-photo overflow-hidden shrink-0">{line.image_url && <img src={line.image_url} alt="" className="h-full w-full object-cover" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium line-clamp-1">{line.name}</p>
          <p className="text-xs text-muted">{line.size ? `${line.option_label} ${line.size} · ` : ""}{line.color} · Qty {line.quantity}</p>
        </div>
        <p className="text-sm font-semibold tabular-nums">{money(line.line_total)}</p>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-line flex justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1"><ShoppingBag size={13} /> {cart.item_count} item{cart.item_count === 1 ? "" : "s"} in cart</span>
        <span>Cart subtotal <span className="text-ink font-medium tabular-nums">{money(cart.subtotal)}</span></span>
      </div>
    </Shell>
  );
}

/* ── Quick replies (checkout offer, suggestions) ───────────────────────── */
export function QuickReplies({ choices, active, onPick }:
  { choices: { value: string; label: string; primary?: boolean }[]; active: boolean; onPick: (c: { value: string; label: string }) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((c, i) => (
        <Button key={c.value} size="sm" variant={active && (c.primary ?? i === 0) ? "talk" : "secondary"} disabled={!active}
          onClick={() => onPick(c)}>{c.label}</Button>
      ))}
    </div>
  );
}

/* ── Auto-checkout countdown ───────────────────────────────────────────── */

export const AUTO_CHECKOUT_SECONDS = 10;

/** After an item is added: move to checkout automatically in 10 seconds unless
 *  the shopper taps Keep shopping. Checkout only opens the review card; paying
 *  still needs GO AHEAD. Pauses if the shopper starts typing to Talkshop. */
export function CheckoutCountdown({ onPick }: { onPick: (c: { value: string; label: string }) => void }) {
  const [left, setLeft] = useState(AUTO_CHECKOUT_SECONDS);
  const [paused, setPaused] = useState(false);
  const fired = useRef(false);
  const [draining, setDraining] = useState(false);       // the bar empties smoothly over the whole countdown
  useEffect(() => { const f = requestAnimationFrame(() => setDraining(true)); return () => cancelAnimationFrame(f); }, []);
  const pick = (c: { value: string; label: string }) => {
    if (fired.current) return;
    fired.current = true;
    onPick(c);
  };

  useEffect(() => {
    if (paused) return;
    if (left <= 0) { pick({ value: "checkout", label: "Continue to checkout" }); return; }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, paused]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {       // typing to Talkshop means the shopper is busy — don't move on without them
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.matches?.("textarea, input") && el.closest("[aria-label='Talkshop assistant']")) setPaused(true);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  return (
    <div className="rounded-2xl border border-talk/40 bg-talk-soft/40 p-3.5 flex flex-col gap-2.5">
      <p className="sr-only" role="status">
        {paused ? "Automatic checkout paused." : `Moving to checkout in ${AUTO_CHECKOUT_SECONDS} seconds. Tap Keep shopping to stay.`}
      </p>
      <p aria-hidden="true" className="text-sm font-medium tabular-nums">{paused ? "Auto-checkout paused" : `Moving to checkout in ${left}s`}</p>
      {!paused && (
        <div aria-hidden="true" className="h-1 rounded-full bg-line overflow-hidden">
          <div className="h-full bg-talk transition-[width] ease-linear motion-reduce:transition-none"
            style={{ width: draining ? "0%" : "100%", transitionDuration: `${AUTO_CHECKOUT_SECONDS}s` }} />
        </div>
      )}
      <p className="text-xs text-muted leading-snug">
        {paused ? "Check out whenever you're ready." : "Want to keep shopping? Tap Keep shopping."} Nothing is charged until you tap GO AHEAD.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="talk" onClick={() => pick({ value: "checkout", label: "Checkout now" })}>Checkout now</Button>
        <Button size="sm" variant="secondary" onClick={() => pick({ value: "keep_shopping", label: "Keep shopping" })}>Keep shopping</Button>
      </div>
    </div>
  );
}

/* ── Review your order (the consent gate) ──────────────────────────────── */
export function ReviewOrderCard({ checkout: co, active, busy, onAct }: { checkout: Checkout; active: boolean; busy: boolean; onAct: Act }) {
  const [changing, setChanging] = useState<"address" | "card" | null>(null);
  const [adding, setAdding] = useState<"address" | "card" | null>(null);
  const live = active && co.status === "open";
  const update = (changes: Omit<Extract<TalkAction, { type: "update_checkout" }>, "type">) =>
    onAct({ type: "update_checkout", ...changes });
  const needsAddress = !co.address, needsCard = !co.payment_method;

  return (
    <Shell className={cx(live && "border-talk/50 shadow-card")}>
      <div className="px-4 py-3 bg-panel flex items-center justify-between">
        <p className="text-xs font-bold tracking-[0.16em]">REVIEW YOUR ORDER</p>
        {co.status === "cancelled" && <span className="text-xs text-muted">Cancelled</span>}
        {co.status === "paid" && <span className="text-xs text-good font-medium">Placed</span>}
      </div>
      <div className="p-4 flex flex-col gap-3">
        {co.lines.map((l) => (
          <div key={l.line_id} className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-photo overflow-hidden shrink-0">{l.image_url && <img src={l.image_url} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium line-clamp-1">{l.name}</p>
              <p className="text-xs text-muted">{l.size ? `${l.option_label} ${l.size} · ` : ""}{l.color}</p>
              {live ? <div className="mt-1"><Stepper value={l.quantity} busy={busy} max={10}
                onChange={(n) => update({ quantities: { [l.line_id]: n } })} /></div>
                : <p className="text-xs text-muted">Qty {l.quantity}</p>}
            </div>
            <p className="text-sm font-semibold tabular-nums">{money(l.line_total)}</p>
          </div>
        ))}

        <div className="border-t border-line pt-3 flex flex-col gap-1 text-sm">
          <Row label="Product" value={money(co.subtotal)} />
          <Row label={`Tax`} value={money(co.tax)} />
          {co.shipping > 0 && <Row label="Express delivery" value={money(co.shipping)} />}
          <div className="flex justify-between font-semibold text-[15px] pt-1.5 border-t border-line mt-1"><span>Total</span><span className="tabular-nums">{money(co.total)}</span></div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted"><Truck size={13} /> Delivery</p>
          <div className="grid grid-cols-2 gap-1.5">
            {co.delivery.options.map((o) => (
              <button key={o.method} type="button" disabled={!live || busy}
                onClick={() => o.method !== co.delivery.method && update({ delivery_method: o.method })}
                className={cx("text-left rounded-xl border px-3 py-2 text-xs transition-colors",
                  co.delivery.method === o.method ? "border-ink bg-panel" : "border-line hover:border-line-strong", !live && "cursor-default")}>
                <span className="flex justify-between font-medium text-ink"><span>{o.label}</span><span>{o.price ? money(o.price) : "Free"}</span></span>
                <span className="text-muted">{niceDate(o.date)}</span>
              </button>
            ))}
          </div>
        </div>

        {co.guest?.email && (
          <p className="text-xs text-muted -mb-1">Guest checkout · confirmation to <span className="text-ink">{co.guest.email}</span></p>
        )}
        <Detail icon={<MapPin size={13} />} label="Ship to" value={co.address?.display}
          canChange={live && co.saved_addresses.length > 0} onChange={() => { setChanging(changing === "address" ? null : "address"); setAdding(null); }} />
        {live && changing === "address" && (
          <Choices items={co.saved_addresses.map((a) => ({ id: a.address_id, label: `${a.label} · ${a.line1}`, on: a.address_id === co.address?.address_id }))}
            onPick={(id) => { update({ address_id: id }); setChanging(null); }} onAdd={() => { setAdding("address"); setChanging(null); }} addLabel="+ New address" />
        )}
        {live && (adding === "address" || needsAddress) && (
          <div className="rounded-xl border border-line p-3"><AddressForm onCancel={needsAddress ? undefined : () => setAdding(null)}
            onSaved={(a) => { setAdding(null); update({ address_id: a.address_id }); }} /></div>
        )}

        <Detail icon={<CreditCard size={13} />} label="Payment" value={co.payment_method?.display}
          canChange={live && (co.saved_payment_methods.length > 0 || !!co.wallet)} onChange={() => { setChanging(changing === "card" ? null : "card"); setAdding(null); }} />
        {live && changing === "card" && (
          <Choices items={[
              ...(co.wallet ? [{ id: "wallet", label: `ShopSphere Wallet · ${money(co.wallet.balance)}`, on: co.pay_with === "wallet" }] : []),
              ...co.saved_payment_methods.map((c) => ({ id: c.payment_method_id, label: c.display,
                on: co.pay_with !== "wallet" && c.payment_method_id === co.payment_method?.payment_method_id })),
            ]}
            onPick={(id) => { update(id === "wallet" ? { pay_with: "wallet" } : { payment_method_id: id }); setChanging(null); }}
            onAdd={() => { setAdding("card"); setChanging(null); }} addLabel="+ New card" />
        )}
        {live && (adding === "card" || needsCard) && (
          <div className="rounded-xl border border-line p-3"><CardForm allowSave={!co.guest} onCancel={needsCard ? undefined : () => setAdding(null)}
            onSaved={(c) => { setAdding(null); update({ payment_method_id: c.payment_method_id }); }} /></div>
        )}

        {co.issues.filter((i) => i.code === "OUT_OF_STOCK").map((i) => (
          <p key={i.name} className="text-xs text-bad">{i.name}: only {i.available} left.</p>
        ))}

        {live && (
          <>
            <Button size="lg" variant="talk" className="w-full tracking-wide" disabled={!co.ready || busy}
              onClick={() => onAct({ type: "go_ahead", checkout_id: co.checkout_id, label: "GO AHEAD" })}>
              <Lock size={15} /> GO AHEAD · {money(co.total)}
            </Button>
            <button type="button" disabled={busy} onClick={() => onAct({ type: "cancel_checkout", label: "Cancel order" })}
              className="text-xs text-muted hover:text-ink -mt-1">Cancel</button>
            <p className="flex items-start gap-1.5 text-[11px] text-muted leading-snug">
              <ShieldCheck size={13} className="shrink-0" /> Nothing is charged until you tap GO AHEAD. Talkshop never sees your card number.
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-muted">{label}</span><span className="tabular-nums">{value}</span></div>;
}

function Detail({ icon, label, value, canChange, onChange }: { icon: ReactNode; label: string; value?: string; canChange: boolean; onChange: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">{icon} {label}</p>
        <p className={cx("leading-snug", value ? "text-ink" : "text-faint")}>{value ?? "Not added yet"}</p>
      </div>
      {canChange && <button type="button" onClick={onChange} className="text-xs font-medium underline shrink-0">Change</button>}
    </div>
  );
}

function Choices({ items, onPick, onAdd, addLabel }: { items: { id: string; label: string; on: boolean }[]; onPick: (id: string) => void; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex flex-col gap-1 -mt-1">
      {items.map((it) => (
        <button key={it.id} type="button" onClick={() => onPick(it.id)}
          className={cx("text-left text-xs rounded-lg border px-3 py-2", it.on ? "border-ink bg-panel" : "border-line hover:border-line-strong")}>{it.label}</button>
      ))}
      <button type="button" onClick={onAdd} className="self-start text-xs font-medium hover:underline mt-0.5">{addLabel}</button>
    </div>
  );
}

/* ── Payment status ────────────────────────────────────────────────────── */
const STEPS = ["processing", "authorizing", "authorized"] as const;
export function PaymentStatusCard({ state, payment, message }: { state: string; payment: string | null; message?: string }) {
  const failed = state === "declined" || state === "failed";
  const reached = failed ? 1 : STEPS.indexOf(state as (typeof STEPS)[number]);
  const labels = ["Processing your order", "Authorizing payment", "Payment authorized"];
  return (
    <Shell className="p-4">
      <p className="text-xs text-muted mb-3">Payment: <span className="text-ink font-medium">{payment ?? "—"}</span></p>
      <ol className="flex flex-col gap-2.5">
        {labels.map((l, i) => {
          const done = !failed && i <= reached, current = !failed && i === reached && state !== "authorized";
          const fail = failed && i === 2;
          return (
            <li key={l} className="flex items-center gap-2.5 text-sm">
              {fail ? <XCircle size={18} className="text-bad" /> : current ? <Loader2 size={18} className="animate-spin text-talk" />
                : done || (failed && i < 2) ? <CheckCircle2 size={18} className="text-good" /> : <span className="w-[18px] h-[18px] rounded-full border-2 border-line" />}
              <span className={cx(fail && "text-bad font-medium", state === "authorized" && i === 2 && "font-semibold text-good")}>
                {fail ? "Payment not authorized" : l}
              </span>
            </li>
          );
        })}
      </ol>
      {failed && message && <p className="text-xs text-bad mt-2.5">{message}</p>}
    </Shell>
  );
}

/* ── Order confirmed ───────────────────────────────────────────────────── */
export function OrderConfirmedCard({ order, email }: { order: Order; email?: string | null }) {
  return (
    <Shell className="border-good/40">
      <div className="px-4 py-3 bg-good-soft text-good flex items-center gap-2">
        <CheckCircle2 size={18} /><p className="text-sm font-bold tracking-wide">ORDER CONFIRMED</p>
        <span className="ml-auto text-sm font-semibold">{order.order_id}</span>
      </div>
      <div className="p-4 flex flex-col gap-3 text-sm">
        {order.lines.map((l) => (
          <div key={l.sku} className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-photo overflow-hidden shrink-0">{l.image_url && <img src={l.image_url} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <p className="font-medium line-clamp-1">{l.name}</p>
              <p className="text-xs text-muted">{l.size ? `${l.size} – ` : ""}{l.color} · Qty {l.quantity}</p>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <Row label="Total" value={money(order.total)} />
          <Row label="Paid with" value={order.payment?.display ?? "—"} />
          <Row label="Expected delivery" value={niceDate(order.delivery_date)} />
        </div>
        {email && <p className="text-xs text-muted">Confirmation emailed to <span className="text-ink break-all">{email}</span></p>}
        {order.guest ? (
          <Link to={`/track?order=${encodeURIComponent(order.order_id)}`}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-full border border-line-strong text-sm font-medium hover:border-ink">
            Track your order <ArrowUpRight size={14} />
          </Link>
        ) : (
          <Link to={`/orders/${order.order_id}`}
            className="inline-flex items-center justify-center gap-1.5 h-10 rounded-full border border-line-strong text-sm font-medium hover:border-ink">
            View in My Orders <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
    </Shell>
  );
}

/* ── Sign in to check out (visitors) ───────────────────────────────────── */
const DEMO = { email: "kaajal@shopsphere.demo", password: "demo1234" };

/** ShopSphere's own secure forms, shown when an order is missing an address or
 *  a card. They post straight to ShopSphere (profile API / card tokenization)
 *  and hand Talkshop only the saved id, never the address or card details, so
 *  nothing typed here reaches the chat history or the LLM. */
export function SecureDetailsCard({ checkoutId, needs, guest, wallet, active, onAct }:
  { checkoutId: string; needs: { guest?: boolean; address: boolean; payment: boolean }; guest?: boolean;
    wallet?: { balance: number; enough: boolean } | null; active: boolean; onAct: Act }) {
  const { user } = useAuth();
  const step = needs.guest ? "guest" : needs.address ? "address" : "payment";
  if (!active) {
    return <p className="self-start text-xs text-muted inline-flex items-center gap-1.5"><Lock size={12} />
      {step === "guest" ? "Your details" : step === "address" ? "Shipping address" : "Card"} handled in ShopSphere's secure form</p>;
  }
  return (
    <Shell className="border-talk/50 shadow-card">
      <div className="px-4 py-3 bg-panel flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.16em]">
          <ShieldCheck size={15} className="text-talk" /> {step === "payment" ? "SECURE PAYMENT" : "SECURE SHOPSPHERE CHECKOUT"}
        </p>
        {(needs.address || needs.guest) && needs.payment && <span className="text-[11px] text-muted shrink-0">Step 1 of 2</span>}
      </div>
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm font-medium">{step === "guest" ? "Your details" : step === "address" ? "Shipping address" : "Add a card"}</p>
        {step === "guest" && (
          <p className="text-xs text-muted -mt-2">Checking out as a guest: no account is created. Your confirmation goes to this email.</p>
        )}
        {step === "guest"
          ? <GuestDetailsForm checkoutId={checkoutId}
              onSaved={() => onAct({ type: "details_added", label: "Details added" })} />
          : step === "address"
          ? <AddressForm defaultName={user?.name}
              onSaved={(a) => onAct({ type: "details_added", address_id: a.address_id, label: "Shipping address added" })} />
          : <CardForm allowSave={!guest} onSaved={(c) => onAct({ type: "details_added", payment_method_id: c.payment_method_id, label: `Card added · ${c.display}` })} />}
        {step === "payment" && wallet && (
          <button type="button" disabled={!wallet.enough}
            onClick={() => onAct({ type: "details_added", pay_with: "wallet", label: "Pay with ShopSphere Wallet" })}
            className="self-start text-sm font-medium hover:underline disabled:opacity-50 disabled:no-underline">
            Or pay with your ShopSphere Wallet ({money(wallet.balance)} available)
          </button>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-muted leading-snug">
          <ShieldCheck size={13} className="shrink-0" />
          {step !== "payment"
            ? "This information is sent directly to ShopSphere checkout and is not processed as chat content."
            : "Card details go directly to ShopSphere's payment partner and are replaced with a secure token. Talkshop only sees the card type and last 4 digits."}
        </p>
        <button type="button" onClick={() => onAct({ type: "cancel_checkout", label: "Not now" })}
          className="text-xs text-muted hover:text-ink">Not now</button>
      </div>
    </Shell>
  );
}

export function SignInCard({ active, onGuest }: { active: boolean; onGuest?: () => void }) {
  const { login, register, isCustomer, user } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isCustomer) {
    return <p className="self-start text-xs text-good inline-flex items-center gap-1.5"><Check size={13} /> Signed in as {user?.name}</p>;
  }
  if (!active) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // After sign-in the panel reloads this conversation and continues to checkout.
      sessionStorage.setItem(RESUME_KEY, "checkout");
      if (mode === "login") await login(email, password); else await register(name, email, password);
    } catch (err) {
      sessionStorage.removeItem(RESUME_KEY);
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Shell className="border-talk/50 shadow-card">
      <div className="px-4 py-3 bg-panel flex items-center gap-2">
        <UserRound size={15} className="text-talk" /><p className="text-xs font-bold tracking-[0.16em]">SIGN IN TO CHECK OUT</p>
      </div>
      <form onSubmit={submit} className="p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 rounded-full bg-panel p-1 text-xs font-medium">
          {(["login", "register"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); }}
              className={cx("h-8 rounded-full", mode === m ? "bg-canvas shadow-card text-ink" : "text-muted")}>
              {m === "login" ? "Log in" : "Create account"}
            </button>
          ))}
        </div>
        {mode === "register" && <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {error && <Notice>{error}</Notice>}
        <Button type="submit" variant="talk" loading={busy}>{mode === "login" ? "Log in & continue" : "Create account & continue"}</Button>
        {mode === "login" && (
          <button type="button" onClick={() => { setEmail(DEMO.email); setPassword(DEMO.password); }} className="text-xs text-muted hover:text-ink">
            Use demo account ({DEMO.email})
          </button>
        )}
        <p className="text-[11px] text-muted text-center">Your cart and this conversation come with you.</p>
        {onGuest && (
          <>
            <div className="flex items-center gap-3 text-[11px] text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
            <Button type="button" variant="secondary" onClick={onGuest}>Continue as guest</Button>
            <p className="text-[11px] text-muted text-center -mt-1">No account needed. We'll email your confirmation.</p>
          </>
        )}
      </form>
    </Shell>
  );
}

/* ── Orders already placed (Phase 11) ──────────────────────────────────── */

/** Order ID + email, straight to ShopSphere's order lookup (like the website's
 *  Track Order). The email is sent with the lookup, not as chat text, so it
 *  never reaches the LLM. */
export function TrackLookupCard({ orderId, active, onAct }: { orderId: string | null; active: boolean; onAct: Act }) {
  const [id, setId] = useState(orderId ?? "");
  const [email, setEmail] = useState("");
  if (!active) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const order = id.trim().toUpperCase();
    onAct({ type: "track_order", order_id: order, email: email.trim(), label: `Track order ${order}` });
  };
  return (
    <Shell className="border-talk/50 shadow-card">
      <div className="px-4 py-3 bg-panel flex items-center gap-2">
        <Truck size={15} className="text-talk" /><p className="text-xs font-bold tracking-[0.16em]">TRACK YOUR ORDER</p>
      </div>
      <form onSubmit={submit} className="p-4 flex flex-col gap-3">
        <Field label="Order ID" value={id} onChange={(e) => setId(e.target.value)} required placeholder="SS-12345" autoComplete="off" />
        <Field label="Email used for the order" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          required placeholder="you@example.com" autoComplete="email" />
        <Button type="submit" variant="talk">Show my order</Button>
        <p className="flex items-start gap-1.5 text-[11px] text-muted leading-snug">
          <ShieldCheck size={13} className="shrink-0" /> Your email is only used to find your order and keep it private.
        </p>
      </form>
    </Shell>
  );
}

export function OrderTrackingCard({ order }: { order: TrackedOrder }) {
  return (
    <Shell>
      <div className="px-4 py-3 bg-panel flex items-center justify-between gap-2">
        <p className="text-xs font-bold tracking-[0.16em]">ORDER {order.order_id}</p>
        <span className="text-xs font-medium text-talk">{order.shipment.status_label}</span>
      </div>
      <div className="p-4 flex flex-col gap-4 text-sm">
        {order.lines.map((l, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-photo overflow-hidden shrink-0">{l.image_url && <img src={l.image_url} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <p className="font-medium line-clamp-1">{l.name}</p>
              <p className="text-xs text-muted">{l.size ? `${l.size} · ` : ""}{l.color} · Qty {l.quantity}</p>
            </div>
            <p className="font-semibold tabular-nums">{money(l.line_total)}</p>
          </div>
        ))}
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <Row label="Total" value={money(order.total)} />
          <Row label="Paid with" value={order.payment?.display ?? "—"} />
          <Row label="Shipping to" value={[order.ship_to.city, order.ship_to.state].filter(Boolean).join(", ") || "—"} />
        </div>
        <ShipmentProgress shipment={order.shipment} />
        <Link to={`/track?order=${encodeURIComponent(order.order_id)}`}
          className="inline-flex items-center justify-center gap-1.5 h-10 rounded-full border border-line-strong text-sm font-medium hover:border-ink">
          Open in Track Order <ArrowUpRight size={14} />
        </Link>
      </div>
    </Shell>
  );
}
