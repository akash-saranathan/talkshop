/**
 * InlineOrderTracker — shows all past orders with real delivery status
 * inside the chat, triggered by "track my orders", "where's my package" etc.
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Loader, ChevronDown, ChevronUp, Truck, MapPin,
  CheckCircle, Clock, ExternalLink, Copy, Check,
} from "lucide-react";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";

interface Order {
  order_id: string;
  merchant: string;
  amount: number;
  status: "paid" | "blocked";
  created_at: string | null;
  product_title: string | null;
  product_category: string | null;
  product_image_url: string | null;
  tracking_number: string | null;
  delivery_status: "processing" | "shipped" | "delivered" | null;
  estimated_delivery: string | null;
}

// ── Tracker step definitions ─────────────────────────────────────────────────

const STEPS: { id: string; label: string; icon: typeof Package }[] = [
  { id: "placed",   label: "Order Placed",    icon: Package },
  { id: "process",  label: "Processing",      icon: Clock },
  { id: "shipped",  label: "Shipped",         icon: Truck },
  { id: "transit",  label: "Out for Delivery",icon: MapPin },
  { id: "delivered",label: "Delivered",       icon: CheckCircle },
];

function getStepIndex(delivery_status: Order["delivery_status"]): number {
  if (!delivery_status) return 0; // only "placed"
  if (delivery_status === "processing") return 1;
  if (delivery_status === "shipped")    return 2;
  if (delivery_status === "delivered")  return 4; // skip straight to delivered
  return 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatExpected(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0)  return "Delivered";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function statusConfig(order: Order): { label: string; dot: string; badge: string } {
  if (order.status === "blocked") return { label: "Blocked",    dot: "bg-rose-500",    badge: "bg-rose-100 text-rose-700 border-rose-200" };
  const ds = order.delivery_status;
  if (ds === "delivered")  return { label: "Delivered",    dot: "bg-[var(--color-success)]", badge: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (ds === "shipped")    return { label: "Shipped",       dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700 border-blue-200" };
  if (ds === "processing") return { label: "Processing",   dot: "bg-amber-400",  badge: "bg-amber-100 text-amber-700 border-amber-200" };
  return                         { label: "Order Placed",  dot: "bg-[var(--color-primary)]", badge: "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/20" };
}

// ── Copy-to-clipboard mini button ────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
      title="Copy tracking number"
    >
      {copied ? <Check size={11} className="text-[var(--color-success)]" /> : <Copy size={11} />}
    </button>
  );
}

// ── Single order row (collapsible) ───────────────────────────────────────────

function OrderRow({ order, defaultOpen }: { order: Order; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const visual = getProductVisual(order.product_title ?? "", order.product_category ?? "");
  const Icon = visual.icon;
  const cfg = statusConfig(order);
  const activeStep = getStepIndex(order.delivery_status);
  const isPaid = order.status === "paid";

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
      {/* Row header — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-3 hover:bg-[var(--color-surface-2)] transition-colors text-left"
      >
        {/* Product thumbnail */}
        {order.product_image_url ? (
          <img
            src={order.product_image_url}
            alt={order.product_title ?? ""}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            className="w-9 h-9 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
            <Icon size={16} className={visual.fg} strokeWidth={1.5} />
          </div>
        )}

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)] truncate leading-snug">
            {order.product_title ?? order.order_id}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            {order.merchant} · ${order.amount.toFixed(2)} · {formatDate(order.created_at)}
          </p>
        </div>

        {/* Status badge */}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${cfg.badge}`}>
          {cfg.label}
        </span>

        {/* ETA */}
        {isPaid && order.estimated_delivery && (
          <span className="text-[11px] text-[var(--color-text-muted)] shrink-0 hidden sm:block">
            {formatExpected(order.estimated_delivery)}
          </span>
        )}

        {open ? <ChevronUp size={14} className="text-[var(--color-text-muted)] shrink-0" /> : <ChevronDown size={14} className="text-[var(--color-text-muted)] shrink-0" />}
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 pt-1 border-t border-[var(--color-border)]">

              {/* Delivery ETA row */}
              {isPaid && (
                <div className="flex items-center justify-between mb-3 text-sm">
                  <span className="text-[var(--color-text-muted)]">
                    {order.delivery_status === "delivered" ? "Delivered on" : "Estimated arrival"}
                  </span>
                  <span className={`font-semibold ${
                    order.delivery_status === "delivered"
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-primary)]"
                  }`}>
                    {order.delivery_status === "delivered"
                      ? formatDate(order.estimated_delivery)
                      : formatExpected(order.estimated_delivery)}
                  </span>
                </div>
              )}

              {/* Progress stepper */}
              {isPaid && (
                <div className="flex items-start gap-0 mb-3">
                  {STEPS.map((step, i) => {
                    const done    = i <= activeStep;
                    const active  = i === activeStep;
                    const isLast  = i === STEPS.length - 1;
                    const StepIcon = step.icon;
                    return (
                      <div key={step.id} className="flex-1 flex flex-col items-center">
                        {/* Dot + connector line */}
                        <div className="flex items-center w-full">
                          {/* Left line */}
                          <div className={`flex-1 h-0.5 ${i === 0 ? "invisible" : done ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]"}`} />
                          {/* Dot */}
                          <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            done
                              ? active
                                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white shadow-sm shadow-[var(--color-primary)]/30"
                                : "border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]/40"
                          }`}>
                            <StepIcon size={12} />
                          </div>
                          {/* Right line */}
                          <div className={`flex-1 h-0.5 ${isLast ? "invisible" : done && !active ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]"}`} />
                        </div>
                        {/* Label */}
                        <p className={`text-[9px] font-medium text-center mt-1 leading-tight px-0.5 ${
                          active ? "text-[var(--color-primary)]" : done ? "text-[var(--color-success)]" : "text-[var(--color-text-muted)]/40"
                        }`}>
                          {step.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tracking number + order ID row */}
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1">
                  Order&nbsp;
                  <span className="font-mono text-[var(--color-text)]">#{order.order_id.slice(0, 8).toUpperCase()}</span>
                </span>
                {order.tracking_number && (
                  <span className="flex items-center gap-1">
                    Tracking:&nbsp;
                    <span className="font-mono text-[var(--color-text)]">{order.tracking_number}</span>
                    <CopyButton value={order.tracking_number} />
                  </span>
                )}
              </div>

              {/* Blocked reason */}
              {order.status === "blocked" && (
                <p className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  This order was blocked by the AI guardrail. No charge was made.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function InlineOrderTracker() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    authFetch("/api/orders")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setOrders)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 flex items-center gap-3 max-w-sm"
      >
        <Loader size={16} className="animate-spin text-[var(--color-primary)] shrink-0" />
        <span className="text-sm text-[var(--color-text-muted)]">Loading your orders…</span>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 max-w-sm text-sm text-rose-600"
      >
        Couldn't load your orders. Please try again.
      </motion.div>
    );
  }

  const paid  = orders.filter((o) => o.status === "paid");
  const inFlight = paid.filter((o) => o.delivery_status !== "delivered");
  const delivered = paid.filter((o) => o.delivery_status === "delivered");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden max-w-lg w-full"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[var(--color-primary)] text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={16} />
          <span className="text-sm font-semibold">Your Orders</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/80">
          {inFlight.length > 0 && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full font-medium">
              {inFlight.length} on the way
            </span>
          )}
          {delivered.length > 0 && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full font-medium">
              {delivered.length} delivered
            </span>
          )}
          {orders.length === 0 && <span>No orders yet</span>}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
          <Package size={28} className="text-[var(--color-text-muted)]/40" />
          <p className="text-sm text-[var(--color-text-muted)]">You haven't placed any orders yet.</p>
          <p className="text-xs text-[var(--color-text-muted)]/70">Find something you love and buy it right here in chat!</p>
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-2">
          {/* Active/in-flight orders first */}
          {inFlight.length > 0 && (
            <>
              {inFlight.length > 0 && delivered.length > 0 && (
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider px-1 mt-0.5">
                  In Transit
                </p>
              )}
              {inFlight.map((o, i) => (
                <OrderRow key={o.order_id} order={o} defaultOpen={i === 0} />
              ))}
            </>
          )}

          {/* Delivered orders */}
          {delivered.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider px-1 mt-1">
                Delivered
              </p>
              {delivered.map((o) => (
                <OrderRow key={o.order_id} order={o} defaultOpen={false} />
              ))}
            </>
          )}

          {/* Blocked orders (collapsed at bottom) */}
          {orders.filter((o) => o.status === "blocked").map((o) => (
            <OrderRow key={o.order_id} order={o} defaultOpen={false} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {orders.length} order{orders.length !== 1 ? "s" : ""} total
        </span>
        <a
          href="/dashboard"
          className="flex items-center gap-1 text-[11px] text-[var(--color-primary)] hover:underline font-medium"
        >
          Full dashboard <ExternalLink size={10} />
        </a>
      </div>
    </motion.div>
  );
}
