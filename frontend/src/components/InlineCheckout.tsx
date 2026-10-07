/**
 * InlineCheckout — the order proposal and its outcome, inside the chat.
 *
 * Phases:
 *   setup      → "Preparing your order..." while the merchant builds the checkout
 *   summary    → order proposal: merchant terms, delivery, masked payment method, GO AHEAD
 *   processing → authorization and payment steps running on the server
 *   reconsent  → the merchant changed a term (delivery date): YES / NO
 *   confirmed  → order confirmation with tracker
 *   failed     → structured rejection (nothing was charged)
 *   cancelled  → checkout cancelled
 *
 * Nothing is authorized or charged until the customer clicks GO AHEAD.
 * Card numbers never live here: a Talkshop guest's card goes straight to the
 * mock processor's tokenize endpoint and only a reference (brand + last4) comes back.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, ChevronDown, ChevronUp, Package, Truck, MapPin, Loader, Lock, X, ShieldCheck, CalendarClock, AlertTriangle, UserCheck } from "lucide-react";
import AutoStepBar from "./AutoStepBar";
import type { ProductData } from "../api/chat";
import { getProductVisual, type ProductVisual } from "../utils/productVisual";

// ── Shared types (also used by Chat.tsx) ─────────────────────────────────────

export interface PaymentMethod {
  payment_method_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  display: string;
}

export interface CheckoutData {
  checkout_id: string;
  merchant_id: string;
  merchant_name: string;
  product_id: string;
  product_title: string;
  quantity: number;
  size?: string | null;
  color?: string | null;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  checkout_hash: string;
  delivery_date?: string | null;
  delivery_display?: string | null;
  image_url?: string | null;
  trusted_session_id?: string;
  merchant_relationship?: "merchant_guest" | "merchant_member";
  talkshop_account?: "authenticated" | "talkshop_guest";
  payment_method?: PaymentMethod | null;
}

export interface ConfirmedOrder {
  order_id: string;
  merchant_name: string;
  product_title: string;
  size?: string | null;
  color?: string | null;
  total: number;
  delivery_display?: string | null;
  tracking_number?: string | null;
  payment_method?: string | null;
  points_earned?: number;
  loyalty_balance?: number;
}

export interface AutoState {
  secondsLeft: number;
  paused: boolean;
}

export interface ProcessingStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
}

export type InlineCheckoutPhase = "setup" | "summary" | "processing" | "reconsent" | "confirmed" | "failed" | "cancelled";

export interface InlineCheckoutData {
  phase: InlineCheckoutPhase;
  product: ProductData;
  checkoutData?: CheckoutData;
  paymentMethodId?: string;
  processingSteps?: ProcessingStep[];
  order?: ConfirmedOrder;
  reconsentMessage?: string;
  error?: string;
  errorReason?: string;
  note?: string;
}

export interface CardInput {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}

interface Props extends InlineCheckoutData {
  paymentMethods: PaymentMethod[];
  isTalkshopGuest: boolean;
  onPaymentMethodChange: (paymentMethodId: string) => void;
  onAddCard: (card: CardInput) => Promise<string | null>;  // resolves to an error message, or null
  onGoAhead: () => void;
  onCancel: () => void;
  onReconsent: (decision: "yes" | "no") => void;
  /** Visible auto GO AHEAD countdown on the proposal (paused / resumed by the customer). */
  auto?: AutoState;
  onPauseToggle?: () => void;
  /** Pause the countdown while the customer is changing something (card picker, add card). */
  onPauseAuto?: () => void;
}

// ── Card entry (Talkshop guest, or "use a different card") ──────────────────

function formatCardNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? digits.slice(0, 2) + "/" + digits.slice(2) : digits;
}

function CardModal({ onClose, onAddCard }: { onClose: () => void; onAddCard: (card: CardInput) => Promise<string | null> }) {
  const [card, setCard] = useState<CardInput>({ number: "", expiry: "", cvc: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputCls = "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]";

  const submit = async () => {
    if (card.number.replace(/\s/g, "").length < 13) { setError("Please enter a valid card number."); return; }
    if (!/^\d{2}\/\d{2}$/.test(card.expiry)) { setError("Expiry must be MM/YY (e.g. 09/27)."); return; }
    if (card.cvc.length < 3) { setError("CVC must be 3 or 4 digits."); return; }
    if (card.name.trim().length < 2) { setError("Please enter the name as it appears on your card."); return; }
    setBusy(true);
    const err = await onAddCard(card);
    setBusy(false);
    // Wipe the typed card from memory whatever happened; only the processor's reference is kept.
    setCard({ number: "", expiry: "", cvc: "", name: card.name });
    if (err) { setError(err); return; }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--color-primary)]" />
            <span className="font-semibold text-sm text-[var(--color-text)]">Add a card</span>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-start gap-1.5 text-xs text-[var(--color-text-muted)]">
              <Lock size={11} className="mt-0.5 shrink-0" />
              <span>Sent straight to the card processor, which returns a reference. The card number is never stored, shown to the AI, or shared with the merchant.</span>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Card number</label>
              <input type="text" inputMode="numeric" maxLength={23} placeholder="4242 4242 4242 4242" value={card.number}
                onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })} className={inputCls} autoComplete="off" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Expiry</label>
                <input type="text" inputMode="numeric" maxLength={5} placeholder="MM/YY" value={card.expiry}
                  onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} className={inputCls} autoComplete="off" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">CVC</label>
                <input type="password" inputMode="numeric" maxLength={4} placeholder="···" value={card.cvc}
                  onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "") })} className={inputCls} autoComplete="off" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Name on card</label>
              <input type="text" placeholder="Jane Smith" value={card.name}
                onChange={(e) => setCard({ ...card, name: e.target.value })} className={inputCls} autoComplete="off" />
            </div>
            {error && <p className="text-xs text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-[var(--color-border)] flex gap-2.5">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
            <button type="submit" disabled={busy}
              className="flex-[2] py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] disabled:opacity-60 flex items-center justify-center gap-2">
              {busy ? <Loader size={13} className="animate-spin" /> : <Lock size={13} />} Save card
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body,
  );
}

// ── Phases ───────────────────────────────────────────────────────────────────

function SetupCard() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 flex items-center gap-3 max-w-sm">
      <Loader size={18} className="animate-spin text-[var(--color-primary)] shrink-0" />
      <span className="text-sm text-[var(--color-text-muted)]">Asking the merchant for a checkout…</span>
    </motion.div>
  );
}

function ProductThumb({ product, imageUrl }: { product: ProductData; imageUrl?: string | null }) {
  const visual: ProductVisual = getProductVisual(product.title, product.category);
  const Icon = visual.icon;
  const src = imageUrl ?? product.image_url;
  if (src) return <img src={src} alt="" className="w-14 h-14 rounded-lg object-contain bg-[#f3f2ef] shrink-0" />;
  return <div className={`w-14 h-14 rounded-lg ${visual.bg} flex items-center justify-center shrink-0`}><Icon size={22} className={visual.fg} /></div>;
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${strong ? "font-bold text-[var(--color-text)] pt-1 border-t border-[var(--color-border)]" : "text-[var(--color-text-muted)]"}`}>
      <span>{label}</span>
      <span className={accent ? "text-[var(--color-success)] font-medium" : ""}>{value}</span>
    </div>
  );
}

function ProposalCard(props: Props & { checkoutData: CheckoutData }) {
  const { product, checkoutData: co, paymentMethods, paymentMethodId, isTalkshopGuest,
    onPaymentMethodChange, onAddCard, onGoAhead, onCancel, auto, onPauseToggle, onPauseAuto } = props;
  const [showCardModal, setShowCardModal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const selected = paymentMethods.find((m) => m.payment_method_id === paymentMethodId) ?? null;
  const merchantGuest = co.merchant_relationship === "merchant_guest";

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden max-w-sm w-full">
        <div className="px-4 py-3 bg-[var(--color-primary)] text-white flex items-center gap-2">
          <Package size={16} />
          <span className="text-sm font-semibold">Order proposal from {co.merchant_name}</span>
        </div>

        <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <ProductThumb product={product} imageUrl={co.image_url} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)] leading-snug line-clamp-2">{co.product_title}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {[co.size ? `Size ${co.size}` : null, co.color, `Qty ${co.quantity}`].filter(Boolean).join(" · ")}
            </p>
            {merchantGuest && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                <UserCheck size={11} /> Guest checkout with {co.merchant_name} · your Talkshop account stays private
              </p>
            )}
          </div>
        </div>

        <div className="px-4 py-3 space-y-1.5 border-b border-[var(--color-border)]">
          <Row label="Subtotal" value={`$${co.subtotal.toFixed(2)}`} />
          <Row label="Shipping" value={co.shipping === 0 ? "FREE" : `$${co.shipping.toFixed(2)}`} accent={co.shipping === 0} />
          <Row label="Tax" value={`$${co.tax.toFixed(2)}`} />
          <Row label="Total" value={`$${co.total.toFixed(2)}`} strong />
        </div>

        {co.delivery_display && (
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2 text-sm">
            <CalendarClock size={15} className="text-[var(--color-primary)] shrink-0" />
            <span className="text-[var(--color-text-muted)]">Delivery</span>
            <span className="ml-auto font-medium text-[var(--color-text)]">{co.delivery_display}</span>
          </div>
        )}

        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Pay with</p>
          {selected ? (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-sm text-[var(--color-text)]">
              <span>💳</span>
              <span className="flex-1">{selected.display}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{String(selected.exp_month).padStart(2, "0")}/{String(selected.exp_year).slice(-2)}</span>
              {(paymentMethods.length > 1 || !isTalkshopGuest) && (
                <button onClick={() => { onPauseAuto?.(); setShowPicker((v) => !v); }} className="text-xs font-medium text-[var(--color-primary)] hover:underline">Change</button>
              )}
            </div>
          ) : (
            <button onClick={() => { onPauseAuto?.(); setShowCardModal(true); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-[var(--color-primary)]/40 text-sm text-[var(--color-primary)] font-medium hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5">
              <Lock size={14} /> Add a card securely
            </button>
          )}
          {showPicker && (
            <div className="mt-2 space-y-1">
              {paymentMethods.filter((m) => m.payment_method_id !== paymentMethodId).map((m) => (
                <button key={m.payment_method_id} onClick={() => { onPaymentMethodChange(m.payment_method_id); setShowPicker(false); }}
                  className="w-full text-left px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:border-[var(--color-primary)]">
                  💳 {m.display}
                </button>
              ))}
              <button onClick={() => { onPauseAuto?.(); setShowPicker(false); setShowCardModal(true); }}
                className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-[var(--color-primary)] hover:underline">+ Use a different card</button>
            </div>
          )}
        </div>

        {auto && selected && onPauseToggle && (
          <AutoStepBar label="Auto GO AHEAD" secondsLeft={auto.secondsLeft} paused={auto.paused} onPauseToggle={onPauseToggle} />
        )}
        <div className="px-4 py-3 space-y-2">
          <button onClick={onGoAhead} disabled={!selected}
            className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-bold tracking-wide hover:bg-[var(--color-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed">
            GO AHEAD · ${co.total.toFixed(2)}
          </button>
          <p className="text-[11px] text-[var(--color-text-muted)] text-center leading-snug">
            GO AHEAD authorizes exactly ${co.total.toFixed(2)} to {co.merchant_name} for this order{selected ? `, paid with ${selected.display}` : ""}.
            {auto && !auto.paused
              ? " It happens automatically when the countdown ends — pause or cancel to stop it."
              : " Nothing is charged before you click."}
          </p>
          <button onClick={onCancel} className="w-full text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showCardModal && <CardModal onClose={() => setShowCardModal(false)} onAddCard={onAddCard} />}
      </AnimatePresence>
    </>
  );
}

function ProcessingCard({ steps }: { steps: ProcessingStep[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 max-w-sm w-full space-y-3">
      <div className="flex items-center gap-2 pb-1 border-b border-[var(--color-border)]">
        <span className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin shrink-0" />
        <span className="text-sm font-semibold text-[var(--color-text)]">Authorizing your order…</span>
      </div>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2.5 text-sm">
          {step.status === "done" ? (
            <span className="w-4 h-4 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] text-[10px] grid place-items-center shrink-0 font-bold">✓</span>
          ) : step.status === "running" ? (
            <span className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin shrink-0" />
          ) : step.status === "error" ? (
            <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-500 text-[10px] grid place-items-center shrink-0 font-bold">✗</span>
          ) : (
            <span className="w-4 h-4 rounded-full border border-[var(--color-border)] shrink-0" />
          )}
          <span className={step.status === "running" ? "text-[var(--color-text)] font-medium" : step.status === "error" ? "text-rose-500" : "text-[var(--color-text-muted)]"}>
            {step.label}
          </span>
        </div>
      ))}
    </motion.div>
  );
}

function ReconsentCard({ message, onReconsent }: { message: string; onReconsent: (d: "yes" | "no") => void }) {
  const [busy, setBusy] = useState(false);
  const decide = (d: "yes" | "no") => { setBusy(true); onReconsent(d); };
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 max-w-sm w-full space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900">The merchant changed a term</p>
          <p className="text-sm text-amber-900 mt-0.5">{message}</p>
          <p className="text-[11px] text-amber-800/80 mt-1">Payment is paused. Nothing has been charged.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => decide("yes")}
          className="flex-1 py-2 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold disabled:opacity-60">YES, continue</button>
        <button disabled={busy} onClick={() => decide("no")}
          className="flex-1 py-2 rounded-xl border border-amber-400 text-amber-900 text-sm font-semibold disabled:opacity-60">NO, cancel</button>
      </div>
    </motion.div>
  );
}

const TRACKER_STEPS = [
  { icon: Package, label: "Order Placed", desc: "Your order has been confirmed" },
  { icon: Loader, label: "Processing", desc: "Merchant is preparing your item" },
  { icon: Truck, label: "Shipped", desc: "Your order is on the way" },
  { icon: MapPin, label: "Out for Delivery", desc: "Almost there!" },
  { icon: CheckCircle, label: "Delivered", desc: "Enjoy your purchase!" },
];

function ConfirmedCard({ order }: { order: ConfirmedOrder }) {
  const [trackerOpen, setTrackerOpen] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border border-[var(--color-success)]/30 bg-[var(--color-surface)] overflow-hidden max-w-sm w-full">
      <div className="px-4 py-3 bg-[var(--color-success)]/10 border-b border-[var(--color-success)]/20 flex items-center gap-2.5">
        <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" />
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">Order confirmed</p>
          <p className="text-xs text-[var(--color-text-muted)]">{order.merchant_name} · Order {order.order_id}</p>
        </div>
      </div>
      <div className="px-4 py-3 border-b border-[var(--color-border)] space-y-1">
        <p className="text-sm font-medium text-[var(--color-text)]">{order.product_title}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{[order.size ? `Size ${order.size}` : null, order.color].filter(Boolean).join(" · ")}</p>
        <div className="flex justify-between text-sm pt-1"><span className="text-[var(--color-text-muted)]">Paid</span><span className="font-semibold">${order.total.toFixed(2)}</span></div>
        {order.payment_method && <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Payment</span><span>{order.payment_method}</span></div>}
        {order.delivery_display && <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Delivery</span><span className="font-medium text-[var(--color-primary)]">{order.delivery_display}</span></div>}
        {order.tracking_number && <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Tracking</span><span className="font-mono">{order.tracking_number}</span></div>}
      </div>
      {order.points_earned != null && order.points_earned > 0 && (
        <div className="px-4 py-2.5 border-b border-[var(--color-border)] text-xs">
          <span className="font-semibold">⭐ +{order.points_earned} loyalty points</span>
          {order.loyalty_balance != null && <span className="text-[var(--color-text-muted)]"> · balance {order.loyalty_balance} pts</span>}
        </div>
      )}
      <button onClick={() => setTrackerOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]">
        <span className="flex items-center gap-1.5"><Package size={12} /> Order Tracker</span>
        {trackerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <AnimatePresence>
        {trackerOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1">
              {TRACKER_STEPS.map((step, i) => {
                const done = i === 0;
                const Icon = step.icon;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${done ? "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]/40"}`}>
                        <Icon size={13} />
                      </div>
                      {i < TRACKER_STEPS.length - 1 && <div className={`w-0.5 h-6 mt-0.5 ${done ? "bg-[var(--color-success)]/40" : "bg-[var(--color-border)]"}`} />}
                    </div>
                    <div className="pt-1 pb-2">
                      <p className={`text-xs font-semibold ${done ? "text-[var(--color-success)]" : "text-[var(--color-text-muted)]/50"}`}>{step.label}</p>
                      <p className={`text-[11px] ${done ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)]/40"}`}>{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function InlineCheckout(props: Props) {
  const { phase, checkoutData, processingSteps, order, reconsentMessage, error, errorReason, note, onReconsent } = props;

  if (phase === "setup" || (phase === "summary" && !checkoutData)) return <SetupCard />;
  if (phase === "summary" && checkoutData) return <ProposalCard {...props} checkoutData={checkoutData} />;
  if (phase === "processing") return <ProcessingCard steps={processingSteps ?? []} />;
  if (phase === "reconsent") return <ReconsentCard message={reconsentMessage ?? "The merchant changed the order."} onReconsent={onReconsent} />;
  if (phase === "confirmed" && order) return <ConfirmedCard order={order} />;
  if (phase === "failed") {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 max-w-sm text-sm text-rose-700 space-y-1">
        <div className="flex items-start gap-2"><span className="shrink-0">⚠️</span><span>{error ?? "Something went wrong. Please try again."}</span></div>
        {errorReason && <p className="text-[11px] font-mono text-rose-500 pl-6">Reason: {errorReason}</p>}
        <p className="text-[11px] text-rose-600/80 pl-6">No payment was taken and no order was created.</p>
      </motion.div>
    );
  }
  if (phase === "cancelled") {
    return <div className="text-sm text-[var(--color-text-muted)] italic">{note ?? "Checkout cancelled. Nothing was charged."}</div>;
  }
  return null;
}
