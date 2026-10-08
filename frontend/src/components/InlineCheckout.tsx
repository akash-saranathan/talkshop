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
import { CheckCircle, ChevronDown, ChevronUp, Package, Truck, MapPin, Loader, Lock, X, ShieldCheck, CalendarClock, AlertTriangle, UserCheck, CreditCard, Eye, EyeOff, Star } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual, type ProductVisual } from "../utils/productVisual";
import { detectBrand } from "../utils/mockTokenizer";

// ── Shared types (also used by Chat.tsx) ─────────────────────────────────────

export interface PaymentMethod {
  payment_method_id: string;
  provider?: "card" | "paypal" | string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
  merchant_id?: string | null;
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
  loyalty?: {
    balance: number; is_member: boolean; merchant_name: string;
    points_redeemed?: number; value_redeemed?: number; amount_due?: number; fully_covered?: boolean;
  } | null;
}

export interface ConfirmedOrder {
  order_id: string;
  merchant_name: string;
  product_title: string;
  size?: string | null;
  color?: string | null;
  total: number;
  amount_paid?: number;
  loyalty_points_redeemed?: number;
  loyalty_value?: number;
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
  onConnectPayPal?: () => Promise<string | null>;          // mocked PayPal handoff; resolves to error, or null
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

// ── Secure payment entry (isolated surface — raw card data never leaves the browser) ──

function maskNumber(formatted: string): string {
  const digits = formatted.replace(/\D/g, "");
  if (digits.length < 4) return formatted;
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

function CardPreview({ number, expiry, name, brand, focused }: { number: string; expiry: string; name: string; brand: string; focused: boolean }) {
  const digits = number.replace(/\D/g, "");
  const shown = digits.length === 0
    ? "•••• •••• •••• ••••"
    : focused
      ? formatCardNumber(number).padEnd(19, "•").replace(/(.{4})/g, "$1 ").trim()
      : maskNumber(number);
  return (
    <div className="relative rounded-xl p-4 h-40 flex flex-col justify-between text-white overflow-hidden shadow-lg"
      style={{ background: "linear-gradient(135deg, #1a2b4a 0%, #2d4a7c 55%, #3b6098 100%)" }}>
      <div className="absolute -right-6 -top-8 w-32 h-32 rounded-full bg-white/10" />
      <div className="absolute right-8 top-10 w-20 h-20 rounded-full bg-white/5" />
      <div className="flex items-center justify-between">
        <div className="w-9 h-6 rounded-md bg-gradient-to-br from-amber-200 to-amber-400/80" />
        <span className="text-sm font-semibold tracking-wide">{brand}</span>
      </div>
      <div className="font-mono text-base tracking-[0.12em] tabular-nums">{shown}</div>
      <div className="flex items-end justify-between text-[11px]">
        <div className="min-w-0">
          <p className="opacity-60 uppercase tracking-wider text-[9px]">Card holder</p>
          <p className="truncate max-w-[10rem] uppercase tracking-wide">{name || "YOUR NAME"}</p>
        </div>
        <div className="text-right">
          <p className="opacity-60 uppercase tracking-wider text-[9px]">Expires</p>
          <p className="tabular-nums">{expiry || "MM/YY"}</p>
        </div>
      </div>
    </div>
  );
}

function SecurePaymentModal({
  onClose, onAddCard, onConnectPayPal, merchantName, total, currency,
}: {
  onClose: () => void;
  onAddCard: (card: CardInput) => Promise<string | null>;
  onConnectPayPal?: () => Promise<string | null>;
  merchantName: string;
  total: number;
  currency: string;
}) {
  const [tab, setTab] = useState<"card" | "paypal">("card");
  const [card, setCard] = useState<CardInput>({ number: "", expiry: "", cvc: "", name: "" });
  const [numberFocused, setNumberFocused] = useState(false);
  const [showCvc, setShowCvc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payPalStep, setPayPalStep] = useState<"intro" | "connecting" | "review">("intro");
  const [payPalFunding, setPayPalFunding] = useState<"balance" | "card">("balance");
  const brand = detectBrand(card.number.replace(/\D/g, ""));
  const amount = `${currency === "USD" ? "$" : currency + " "}${total.toFixed(2)}`;
  const inputCls = "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]";

  const submitCard = async () => {
    if (card.number.replace(/\s/g, "").length < 13) { setError("Please enter a valid card number."); return; }
    if (!/^\d{2}\/\d{2}$/.test(card.expiry)) { setError("Expiry must be MM/YY (e.g. 09/27)."); return; }
    if (card.cvc.length < 3) { setError("CVC must be 3 or 4 digits."); return; }
    if (card.name.trim().length < 2) { setError("Please enter the name as it appears on your card."); return; }
    setBusy(true);
    const err = await onAddCard(card);
    setBusy(false);
    // On error keep what was typed so the customer can correct one field. On
    // success the modal closes immediately; only the reference was ever sent.
    if (err) { setError(err); return; }
    onClose();
  };

  const approvePayPal = async () => {
    if (!onConnectPayPal) return;
    setBusy(true); setError(null);
    const err = await onConnectPayPal();
    setBusy(false);
    if (err) { setError(err); return; }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop does not close the form — only X or Cancel do, so a stray
          click while entering card details never discards what was typed. */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="relative w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] overflow-hidden"
      >
        {/* Header: trust-forward */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)] bg-gradient-to-b from-[var(--color-primary)]/5 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[var(--color-primary)]/10 grid place-items-center">
                <ShieldCheck size={16} className="text-[var(--color-primary)]" />
              </span>
              <div className="leading-tight">
                <p className="font-semibold text-sm text-[var(--color-text)]">Secure payment</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">Pay {merchantName} · {amount}</p>
              </div>
            </div>
            <button onClick={onClose} disabled={busy} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"><X size={16} /></button>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800/40 rounded-lg px-2.5 py-1.5">
            <Lock size={11} className="shrink-0" />
            <span>Encrypted entry. Your details are never shown to the assistant, shared with the merchant, or stored on our servers.</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {([["card", "Card"], ["paypal", "PayPal"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); setError(null); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                tab === id ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]"
                           : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "card" ? (
          <form onSubmit={(e) => { e.preventDefault(); void submitCard(); }}>
            <div className="px-5 py-4 space-y-3">
              <CardPreview number={card.number} expiry={card.expiry} name={card.name} brand={brand} focused={numberFocused} />
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Card number</label>
                <div className="relative">
                  <input type="text" inputMode="numeric" maxLength={19} placeholder="4242 4242 4242 4242"
                    value={numberFocused ? card.number : (card.number ? maskNumber(card.number) : "")}
                    onFocus={() => setNumberFocused(true)} onBlur={() => setNumberFocused(false)}
                    onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })}
                    className={inputCls + " pr-16 font-mono tracking-wide"} autoComplete="off" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--color-text-muted)]">{brand}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Expiry</label>
                  <input type="text" inputMode="numeric" maxLength={5} placeholder="MM/YY" value={card.expiry}
                    onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} className={inputCls} autoComplete="off" />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">CVC</label>
                  <div className="relative">
                    <input type={showCvc ? "text" : "password"} inputMode="numeric" maxLength={4} placeholder="···" value={card.cvc}
                      onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "") })} className={inputCls + " pr-9"} autoComplete="off" />
                    <button type="button" onClick={() => setShowCvc((v) => !v)} tabIndex={-1}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                      {showCvc ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Name on card</label>
                <input type="text" placeholder="John Carter" value={card.name}
                  onChange={(e) => setCard({ ...card, name: e.target.value })} className={inputCls} autoComplete="off" />
              </div>
              {error && <p className="text-xs text-rose-500 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="px-5 py-4 border-t border-[var(--color-border)] flex gap-2.5">
              <button type="button" onClick={onClose} disabled={busy}
                className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">Cancel</button>
              <button type="submit" disabled={busy}
                className="flex-[2] py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy ? <Loader size={13} className="animate-spin" /> : <Lock size={13} />} Save card
              </button>
            </div>
          </form>
        ) : (
          <div className="px-5 py-4">
            {payPalStep === "intro" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-5 flex flex-col items-center text-center gap-2">
                  <span className="text-lg font-bold"><span className="text-[#003087]">Pay</span><span className="text-[#009cde]">Pal</span></span>
                  <p className="text-xs text-[var(--color-text-muted)] leading-snug">
                    You'll be taken to PayPal to approve {amount} to {merchantName}. We never see your PayPal login — only an authorization comes back.
                  </p>
                </div>
                {error && <p className="text-xs text-rose-500 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-lg px-3 py-2">{error}</p>}
                <div className="flex gap-2.5">
                  <button type="button" onClick={onClose} disabled={busy}
                    className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">Cancel</button>
                  <button type="button" onClick={() => { setPayPalStep("connecting"); setTimeout(() => setPayPalStep("review"), 1300); }}
                    className="flex-[2] py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"
                    style={{ background: "#0070ba" }}>
                    Continue with PayPal
                  </button>
                </div>
              </div>
            ) : payPalStep === "connecting" ? (
              <div className="rounded-xl border border-[#0070ba]/30 bg-[var(--color-bg)] px-4 py-10 flex flex-col items-center justify-center gap-3 text-center">
                <Loader size={22} className="animate-spin" style={{ color: "#0070ba" }} />
                <span className="text-lg font-bold"><span className="text-[#003087]">Pay</span><span className="text-[#009cde]">Pal</span></span>
                <p className="text-xs text-[var(--color-text-muted)]">Securely connecting to PayPal…</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* PayPal-hosted review: already signed in (no password here — the
                    handoff happens on PayPal's side), choose a funding source, approve. */}
                <div className="rounded-xl border border-[#0070ba]/30 overflow-hidden">
                  <div className="px-4 py-2.5 text-white text-sm font-semibold flex items-center justify-between" style={{ background: "#0070ba" }}>
                    <span><span className="text-white">Pay</span><span className="text-sky-200">Pal</span></span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-normal opacity-90"><Lock size={9} /> Secure</span>
                  </div>
                  <div className="px-4 py-3 bg-[var(--color-bg)] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                        <span className="w-7 h-7 rounded-full bg-[#0070ba]/10 grid place-items-center text-[#0070ba] font-bold text-xs">JC</span>
                        <div className="leading-tight">
                          <p className="font-medium">John Carter</p>
                          <p className="text-[11px] text-[var(--color-text-muted)]">john@gmail.com</p>
                        </div>
                      </div>
                      <span className="text-[11px] text-emerald-600 font-medium">Signed in</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-[var(--color-text-muted)] mb-1">Pay with</p>
                      <div className="space-y-1.5">
                        {([
                          ["balance", "PayPal balance", "$240.00 available"],
                          ["card", "Visa •••• 2468", "Linked to PayPal"],
                        ] as const).map(([id, label, sub]) => (
                          <button key={id} type="button" onClick={() => setPayPalFunding(id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                              payPalFunding === id ? "border-[#0070ba] bg-[#0070ba]/5" : "border-[var(--color-border)]"}`}>
                            <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 grid place-items-center ${payPalFunding === id ? "border-[#0070ba]" : "border-[var(--color-border)]"}`}>
                              {payPalFunding === id && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#0070ba" }} />}
                            </span>
                            <span className="flex-1">
                              <span className="block text-[var(--color-text)]">{label}</span>
                              <span className="block text-[11px] text-[var(--color-text-muted)]">{sub}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-[var(--color-border)]">
                      <span className="text-[var(--color-text-muted)]">Pay to {merchantName}</span>
                      <span className="font-semibold text-[var(--color-text)]">{amount}</span>
                    </div>
                  </div>
                </div>
                {error && <p className="text-xs text-rose-500 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-lg px-3 py-2">{error}</p>}
                <div className="flex gap-2.5">
                  <button type="button" onClick={onClose} disabled={busy}
                    className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">Cancel</button>
                  <button type="button" onClick={() => void approvePayPal()} disabled={busy}
                    className="flex-[2] py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: "#0070ba" }}>
                    {busy ? <Loader size={13} className="animate-spin" /> : null} Agree &amp; Continue
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}

// ── Phases ───────────────────────────────────────────────────────────────────

function SetupCard() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card px-5 py-4 flex items-center gap-3 max-w-sm">
      <span className="w-9 h-9 rounded-full bg-[var(--color-primary)]/10 grid place-items-center shrink-0">
        <Loader size={16} className="animate-spin text-[var(--color-primary)]" />
      </span>
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

function PayGlyph({ method }: { method: PaymentMethod }) {
  if (method.provider === "paypal") return <span className="text-xs font-bold"><span className="text-[#003087]">Pay</span><span className="text-[#009cde]">Pal</span></span>;
  return <CreditCard size={15} className="text-[var(--color-text-muted)]" />;
}

function ProposalCard(props: Props & { checkoutData: CheckoutData }) {
  const { product, checkoutData: co, paymentMethods, paymentMethodId,
    onPaymentMethodChange, onAddCard, onConnectPayPal, onGoAhead, onCancel, auto, onPauseToggle, onPauseAuto } = props;
  const [showPayModal, setShowPayModal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Saved methods are merchant-scoped: only this merchant's methods are offered.
  const merchantMethods = paymentMethods.filter((m) => m.merchant_id === co.merchant_id);
  const selected = merchantMethods.find((m) => m.payment_method_id === paymentMethodId) ?? null;
  const merchantGuest = co.merchant_relationship === "merchant_guest";
  const redeemedPts = co.loyalty?.points_redeemed ?? 0;
  const payable = redeemedPts > 0 ? (co.loyalty?.amount_due ?? co.total) : co.total;
  const fullyCovered = !!co.loyalty?.fully_covered || payable <= 0.005;

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-[var(--color-primary)]/20 bg-[var(--color-surface)] shadow-card overflow-hidden max-w-sm w-full">
        <div className="px-4 py-3 bg-gradient-to-r from-[var(--color-primary-dark)] to-[var(--color-primary)] text-white flex items-center gap-2">
          <Package size={16} />
          <span className="text-sm font-semibold tracking-tight">Order proposal from {co.merchant_name}</span>
        </div>

        <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <ProductThumb product={product} imageUrl={co.image_url} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)] leading-snug line-clamp-2">{co.product_title}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {[co.size ? `Size ${co.size}` : null, co.color, `Qty ${co.quantity}`].filter(Boolean).join(" · ")}
            </p>
            {merchantGuest && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/40">
                <UserCheck size={11} /> Guest checkout with {co.merchant_name} · your Talkshop account stays private
              </p>
            )}
          </div>
        </div>

        <div className="px-4 py-3 space-y-1.5 border-b border-[var(--color-border)]">
          <Row label="Subtotal" value={`$${co.subtotal.toFixed(2)}`} />
          <Row label="Shipping" value={co.shipping === 0 ? "FREE" : `$${co.shipping.toFixed(2)}`} accent={co.shipping === 0} />
          <Row label="Tax" value={`$${co.tax.toFixed(2)}`} />
          {redeemedPts > 0 ? (
            <>
              <Row label="Order total" value={`$${co.total.toFixed(2)}`} />
              <Row label={`${co.loyalty!.merchant_name} points (−${redeemedPts.toLocaleString()})`}
                value={`−$${(co.loyalty!.value_redeemed ?? 0).toFixed(2)}`} accent />
              <Row label="Amount due" value={`$${payable.toFixed(2)}`} strong />
            </>
          ) : (
            <Row label="Total" value={`$${co.total.toFixed(2)}`} strong />
          )}
        </div>

        {co.delivery_display && (
          <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2 text-sm">
            <CalendarClock size={15} className="text-[var(--color-primary)] shrink-0" />
            <span className="text-[var(--color-text-muted)]">Delivery</span>
            <span className="ml-auto font-medium text-[var(--color-text)]">{co.delivery_display}</span>
          </div>
        )}

        {co.loyalty && co.loyalty.is_member && (
          <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2.5 rounded-xl px-3 py-2 bg-gradient-to-r from-amber-50 dark:from-amber-950/40 to-amber-100/60 dark:to-amber-900/20 border border-amber-200/80 dark:border-amber-800/40">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-500 grid place-items-center shrink-0 shadow-sm">
                <Star size={13} className="text-white" fill="currentColor" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-[var(--color-text)]">{co.loyalty.merchant_name} Rewards</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-300/80">Member benefit</p>
              </div>
              <span className="ml-auto text-sm font-bold text-amber-700 dark:text-amber-300 tabular-nums">{co.loyalty.balance.toLocaleString()} <span className="text-[10px] font-semibold">pts</span></span>
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Pay with</p>
          {fullyCovered ? (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-gradient-to-r from-amber-50 dark:from-amber-950/40 to-amber-100/50 dark:to-amber-900/20 text-sm text-amber-800 dark:text-amber-300 shadow-sm">
              <Star size={15} className="text-amber-500 shrink-0" fill="currentColor" />
              <span className="flex-1 font-medium">Covered in full by {co.loyalty?.merchant_name} points</span>
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 rounded-full">no card needed</span>
            </div>
          ) : selected ? (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.04] text-sm text-[var(--color-text)]">
              <PayGlyph method={selected} />
              <span className="flex-1">{selected.display}</span>
              {selected.provider !== "paypal" && (
                <span className="text-xs text-[var(--color-text-muted)]">{String(selected.exp_month).padStart(2, "0")}/{String(selected.exp_year).slice(-2)}</span>
              )}
              <button onClick={() => { onPauseAuto?.(); setShowPicker((v) => !v); }} className="text-xs font-medium text-[var(--color-primary)] hover:underline">Change</button>
            </div>
          ) : (
            <button onClick={() => { onPauseAuto?.(); setShowPayModal(true); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-[var(--color-primary)]/40 text-sm text-[var(--color-primary)] font-medium hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5">
              <Lock size={14} /> Pay securely
            </button>
          )}
          {showPicker && (
            <div className="mt-2 space-y-1">
              {merchantMethods.filter((m) => m.payment_method_id !== paymentMethodId).map((m) => (
                <button key={m.payment_method_id} onClick={() => { onPaymentMethodChange(m.payment_method_id); setShowPicker(false); }}
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:border-[var(--color-primary)]">
                  <PayGlyph method={m} /> {m.display}
                </button>
              ))}
              <button onClick={() => { onPauseAuto?.(); setShowPicker(false); setShowPayModal(true); }}
                className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-[var(--color-primary)] hover:underline">+ Use a different method</button>
            </div>
          )}
        </div>

        {/* Auto GO AHEAD countdown hidden — the order continues silently after a
            short delay once a payment method is ready. */}
        <div className="px-4 py-3 space-y-2">
          <button onClick={onGoAhead} disabled={!selected && !fullyCovered}
            className="w-full py-2.5 rounded-xl bg-gradient-to-b from-[var(--color-primary-light)] to-[var(--color-primary)] text-white text-sm font-bold tracking-wide shadow-raised hover:brightness-105 active:brightness-95 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none">
            {fullyCovered ? "GO AHEAD · Pay with points" : `GO AHEAD · $${payable.toFixed(2)}`}
          </button>
          <p className="text-[11px] text-[var(--color-text-muted)] text-center leading-snug">
            {fullyCovered
              ? `GO AHEAD places this order with ${co.merchant_name}, paid in full with your ${co.loyalty?.merchant_name} points.`
              : `GO AHEAD authorizes exactly $${payable.toFixed(2)} to ${co.merchant_name} for this order${selected ? `, paid with ${selected.display}` : ""}${redeemedPts > 0 ? ` (after ${redeemedPts.toLocaleString()} points)` : ""}.`}
            {auto && !auto.paused
              ? " It continues automatically in a moment — or cancel to stop it."
              : " Nothing is charged before you click."}
          </p>
          <button onClick={onCancel} className="w-full text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showPayModal && (
          <SecurePaymentModal
            onClose={() => setShowPayModal(false)}
            onAddCard={onAddCard}
            onConnectPayPal={onConnectPayPal}
            merchantName={co.merchant_name}
            total={co.total}
            currency={co.currency}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ProcessingCard({ steps }: { steps: ProcessingStep[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card px-4 py-4 max-w-sm w-full space-y-3">
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
            <span className="w-4 h-4 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-500 dark:text-rose-400 text-[10px] grid place-items-center shrink-0 font-bold">✗</span>
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
      className="rounded-2xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 shadow-card px-4 py-3 max-w-sm w-full space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">The merchant changed a term</p>
          <p className="text-sm text-amber-900 dark:text-amber-200 mt-0.5">{message}</p>
          <p className="text-[11px] text-amber-800 dark:text-amber-300/80 mt-1">Payment is paused. Nothing has been charged.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => decide("yes")}
          className="flex-1 py-2 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold disabled:opacity-60">YES, continue</button>
        <button disabled={busy} onClick={() => decide("no")}
          className="flex-1 py-2 rounded-xl border border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-200 text-sm font-semibold disabled:opacity-60">NO, cancel</button>
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
      className="rounded-2xl border border-[var(--color-success)]/30 bg-[var(--color-surface)] shadow-card overflow-hidden max-w-sm w-full">
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
        <div className="flex justify-between text-sm pt-1"><span className="text-[var(--color-text-muted)]">Order total</span><span className="font-semibold">${order.total.toFixed(2)}</span></div>
        {(order.loyalty_points_redeemed ?? 0) > 0 && (
          <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">{order.merchant_name} points used</span>
            <span className="text-amber-600 dark:text-amber-400">−{(order.loyalty_points_redeemed ?? 0).toLocaleString()} pts (−${(order.loyalty_value ?? 0).toFixed(2)})</span></div>
        )}
        <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Charged</span>
          <span>{(order.amount_paid ?? order.total) <= 0.005 ? "$0.00 (paid with points)" : `$${(order.amount_paid ?? order.total).toFixed(2)}${order.payment_method ? ` · ${order.payment_method}` : ""}`}</span></div>
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
        className="rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-950/30 shadow-card px-4 py-3 max-w-sm text-sm text-rose-700 dark:text-rose-300 space-y-1">
        <div className="flex items-start gap-2"><span className="shrink-0">⚠️</span><span>{error ?? "Something went wrong. Please try again."}</span></div>
        {errorReason && <p className="text-[11px] font-mono text-rose-500 pl-6">Reason: {errorReason}</p>}
        <p className="text-[11px] text-rose-600 dark:text-rose-400/80 pl-6">No payment was taken and no order was created.</p>
      </motion.div>
    );
  }
  if (phase === "cancelled") {
    return <div className="text-sm text-[var(--color-text-muted)] italic">{note ?? "Checkout cancelled. Nothing was charged."}</div>;
  }
  return null;
}
