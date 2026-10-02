/**
 * InlineCheckout — renders checkout phases directly inside the chat bubble.
 *
 * Phases:
 *   setup      → "Building your order..." loading spinner
 *   summary    → order breakdown + card picker + Confirm/Cancel buttons
 *   processing → animated DPAT / payment pipeline steps
 *   confirmed  → success with collapsible order tracker
 *   failed     → error message
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, ChevronDown, ChevronUp, CreditCard, Package, Truck, MapPin, Loader } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual, type ProductVisual } from "../utils/productVisual";

// ── Saved cards (mock — real app would fetch from user profile) ─────────────

export const SAVED_CARDS = [
  { id: "card_visa_4242",  network: "Visa",       last4: "4242", expiry: "09/27", isDefault: true  },
  { id: "card_mc_8317",   network: "Mastercard", last4: "8317", expiry: "03/26", isDefault: false },
  { id: "card_amex_5591", network: "Amex",       last4: "5591", expiry: "11/28", isDefault: false },
];

// ── Shared types (also exported for Chat.tsx to use) ─────────────────────────

export interface CheckoutData {
  checkout_id: string;
  merchant_id: string;
  merchant_name: string;
  product_id: string;
  product_title: string;
  quantity: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  checkout_hash: string;
}

export interface ProcessingStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
}

export type InlineCheckoutPhase = "setup" | "summary" | "processing" | "confirmed" | "failed" | "cancelled";

export interface GuestCardInput {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
}

export interface InlineCheckoutData {
  phase: InlineCheckoutPhase;
  product: ProductData;
  checkoutData?: CheckoutData;
  selectedCard: string;
  isGuest?: boolean;
  guestCard?: GuestCardInput;
  orderId?: string;
  confirmedTotal?: number;
  error?: string;
  processingSteps?: ProcessingStep[];
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props extends InlineCheckoutData {
  onConfirm: () => void;
  onCancel: () => void;
  onCardChange: (cardId: string) => void;
  onGuestCardChange?: (card: GuestCardInput) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cardNetworkIcon(network: string): string {
  if (network === "Visa") return "💳";
  if (network === "Mastercard") return "🔴";
  if (network === "Amex") return "🟦";
  return "💳";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SetupCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 flex items-center gap-3 max-w-sm"
    >
      <Loader size={18} className="animate-spin text-[var(--color-primary)] shrink-0" />
      <span className="text-sm text-[var(--color-text-muted)]">Preparing your order…</span>
    </motion.div>
  );
}

function GuestCardForm({ card, onChange }: { card: GuestCardInput; onChange: (c: GuestCardInput) => void }) {
  const inputCls = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]";
  return (
    <div className="space-y-2">
      <input
        type="text"
        maxLength={19}
        placeholder="Card number (e.g. 4242 4242 4242 4242)"
        value={card.number}
        onChange={(e) => onChange({ ...card, number: e.target.value.replace(/[^\d ]/g, "") })}
        className={inputCls}
      />
      <div className="flex gap-2">
        <input
          type="text"
          maxLength={5}
          placeholder="MM/YY"
          value={card.expiry}
          onChange={(e) => onChange({ ...card, expiry: e.target.value })}
          className={inputCls}
        />
        <input
          type="text"
          maxLength={4}
          placeholder="CVC"
          value={card.cvc}
          onChange={(e) => onChange({ ...card, cvc: e.target.value.replace(/\D/g, "") })}
          className={inputCls}
        />
      </div>
      <input
        type="text"
        placeholder="Name on card"
        value={card.name}
        onChange={(e) => onChange({ ...card, name: e.target.value })}
        className={inputCls}
      />
    </div>
  );
}

function SummaryCard({
  product, checkoutData, selectedCard, onCardChange, onConfirm, onCancel,
  isGuest, guestCard, onGuestCardChange,
}: {
  product: ProductData;
  checkoutData: CheckoutData;
  selectedCard: string;
  onCardChange: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isGuest?: boolean;
  guestCard?: GuestCardInput;
  onGuestCardChange?: (c: GuestCardInput) => void;
}) {
  const visual: ProductVisual = getProductVisual(product.title, product.category);
  const ProductIcon = visual.icon;
  const freeShipping = checkoutData.shipping === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden max-w-sm w-full"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[var(--color-primary)] text-white flex items-center gap-2">
        <Package size={16} />
        <span className="text-sm font-semibold">Order Summary</span>
      </div>

      {/* Product row */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <div className={`w-12 h-12 rounded-lg ${visual.bg} flex items-center justify-center shrink-0`}>
          <ProductIcon size={22} className={visual.fg} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)] leading-snug line-clamp-2">
            {product.title}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {[product.brand, product.size, product.color].filter((v): v is string => v != null).join(" · ")}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {product.merchant_name} · ⭐ {product.rating} · {product.delivery_days}d delivery
          </p>
        </div>
      </div>

      {/* Price breakdown */}
      <div className="px-4 py-3 space-y-1.5 border-b border-[var(--color-border)]">
        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
          <span>Subtotal</span>
          <span>${checkoutData.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
          <span>Shipping</span>
          <span className={freeShipping ? "text-[var(--color-success)] font-medium" : ""}>
            {freeShipping ? "FREE" : `$${checkoutData.shipping.toFixed(2)}`}
          </span>
        </div>
        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
          <span>Tax</span>
          <span>${checkoutData.tax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm font-bold text-[var(--color-text)] pt-1 border-t border-[var(--color-border)]">
          <span>Total</span>
          <span>${checkoutData.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Card picker / guest card form */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
          {isGuest ? "Enter card details" : "Pay with"}
        </p>
        {isGuest ? (
          <GuestCardForm
            card={guestCard ?? { number: "", expiry: "", cvc: "", name: "" }}
            onChange={(c) => onGuestCardChange?.(c)}
          />
        ) : (
          <div className="space-y-1.5">
            {SAVED_CARDS.map((card) => (
              <button
                key={card.id}
                onClick={() => onCardChange(card.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  selectedCard === card.id
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-text)]"
                    : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/50"
                }`}
              >
                <span>{cardNetworkIcon(card.network)}</span>
                <span className="flex-1 text-left">
                  {card.network} ···· {card.last4}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">{card.expiry}</span>
                {card.isDefault && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium">Default</span>
                )}
                {selectedCard === card.id && (
                  <span className="w-4 h-4 rounded-full bg-[var(--color-primary)] grid place-items-center shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 flex gap-2.5">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-[2] py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] transition-colors flex items-center justify-center gap-2"
        >
          <CreditCard size={14} />
          Confirm & Pay ${checkoutData.total.toFixed(2)}
        </button>
      </div>
    </motion.div>
  );
}

function ProcessingCard({ steps }: { steps: ProcessingStep[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 max-w-sm w-full space-y-3"
    >
      <div className="flex items-center gap-2 pb-1 border-b border-[var(--color-border)]">
        <span className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin shrink-0" />
        <span className="text-sm font-semibold text-[var(--color-text)]">Processing payment…</span>
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
          <span className={
            step.status === "done" ? "text-[var(--color-text-muted)]" :
            step.status === "running" ? "text-[var(--color-text)] font-medium" :
            step.status === "error" ? "text-rose-500" :
            "text-[var(--color-text-muted)]/50"
          }>
            {step.label}
          </span>
        </div>
      ))}
    </motion.div>
  );
}

const TRACKER_STEPS = [
  { icon: Package,  label: "Order Placed",      desc: "Your order has been confirmed" },
  { icon: Loader,   label: "Processing",         desc: "Merchant is preparing your item" },
  { icon: Truck,    label: "Shipped",             desc: "Your order is on the way" },
  { icon: MapPin,   label: "Out for Delivery",   desc: "Almost there!" },
  { icon: CheckCircle, label: "Delivered",       desc: "Enjoy your purchase!" },
];

function ConfirmedCard({
  product, orderId, confirmedTotal, deliveryDays,
}: {
  product: ProductData;
  orderId: string;
  confirmedTotal: number;
  deliveryDays: number;
}) {
  const [trackerOpen, setTrackerOpen] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border border-[var(--color-success)]/30 bg-[var(--color-surface)] overflow-hidden max-w-sm w-full"
    >
      {/* Success header */}
      <div className="px-4 py-3 bg-[var(--color-success)]/10 border-b border-[var(--color-success)]/20 flex items-center gap-2.5">
        <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" />
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">Payment Successful!</p>
          <p className="text-xs text-[var(--color-text-muted)]">Order #{orderId} · ${confirmedTotal.toFixed(2)}</p>
        </div>
      </div>

      {/* Summary line */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-sm text-[var(--color-text)]">
          <span className="font-medium">{product.title}</span> is on its way!
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Estimated delivery: <span className="font-medium text-[var(--color-primary)]">{deliveryDays} business days</span>
        </p>
      </div>

      {/* Collapsible tracker */}
      <button
        onClick={() => setTrackerOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <span className="flex items-center gap-1.5"><Package size={12} /> Order Tracker</span>
        {trackerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence>
        {trackerOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-0">
              {TRACKER_STEPS.map((step, i) => {
                const isActive = i === 0;
                const isDone = i === 0;
                const Icon = step.icon;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isDone
                          ? "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]"
                          : isActive
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]/40"
                      }`}>
                        <Icon size={13} />
                      </div>
                      {i < TRACKER_STEPS.length - 1 && (
                        <div className={`w-0.5 h-6 mt-0.5 ${isDone ? "bg-[var(--color-success)]/40" : "bg-[var(--color-border)]"}`} />
                      )}
                    </div>
                    <div className="pt-1 pb-2">
                      <p className={`text-xs font-semibold ${isDone ? "text-[var(--color-success)]" : isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]/50"}`}>
                        {step.label}
                      </p>
                      <p className={`text-[11px] ${isDone || isActive ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)]/40"}`}>
                        {step.desc}
                      </p>
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

// ── Main export ───────────────────────────────────────────────────────────────

export default function InlineCheckout(props: Props) {
  const { phase, product, checkoutData, selectedCard, onCardChange, onConfirm, onCancel,
    processingSteps, orderId, confirmedTotal, error, isGuest, guestCard, onGuestCardChange } = props;

  if (phase === "setup") {
    return <SetupCard />;
  }

  if (phase === "summary" && checkoutData) {
    return (
      <SummaryCard
        product={product}
        checkoutData={checkoutData}
        selectedCard={selectedCard}
        onCardChange={onCardChange}
        onConfirm={onConfirm}
        onCancel={onCancel}
        isGuest={isGuest}
        guestCard={guestCard}
        onGuestCardChange={onGuestCardChange}
      />
    );
  }

  if (phase === "summary" && !checkoutData) {
    return <SetupCard />;
  }

  if (phase === "processing") {
    return <ProcessingCard steps={processingSteps ?? []} />;
  }

  if (phase === "confirmed" && orderId && confirmedTotal !== undefined) {
    return (
      <ConfirmedCard
        product={product}
        orderId={orderId}
        confirmedTotal={confirmedTotal}
        deliveryDays={product.delivery_days ?? 3}
      />
    );
  }

  if (phase === "failed") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 max-w-sm text-sm text-rose-700 flex items-start gap-2"
      >
        <span className="shrink-0 mt-0.5">⚠️</span>
        <span>{error ?? "Something went wrong. Please try again."}</span>
      </motion.div>
    );
  }

  if (phase === "cancelled") {
    return (
      <div className="text-sm text-[var(--color-text-muted)] italic">Order cancelled.</div>
    );
  }

  return null;
}
