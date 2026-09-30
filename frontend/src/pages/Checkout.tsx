import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, CheckCircle, XCircle, Clock, Loader, AlertTriangle, RotateCcw, CreditCard } from "lucide-react";
import type { CartItemData } from "../api/cart";
import { removeFromCart } from "../api/cart";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";
import AppHeader from "../components/AppHeader";

interface CheckoutData {
  checkout_id: string;
  merchant_id: string;
  merchant_name: string;
  product_id: string;
  product_title: string;
  quantity: number;
  size: string | null;
  color: string | null;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  checkout_hash: string;
}

type ItemStatus = "queued" | "creating" | "authorizing" | "paying" | "success" | "blocked" | "error";

interface QueueEntry {
  item: CartItemData;
  status: ItemStatus;
  checkoutData?: CheckoutData;
  tokenId?: string;
  expiresAt?: string;
  orderId?: string;
  amount?: number;
  reason?: string;
}

// Reads the error `detail` from a response body, tolerating a non-JSON
// body (e.g. an HTML error page from a flaky proxy) instead of throwing
// a raw "Unexpected token <" parse error at the user.
async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.detail || fallback;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

function useCountdown(expiresAt: string | null | undefined): string {
  const [remaining, setRemaining] = useState("--:--");

  useEffect(() => {
    if (!expiresAt) { setRemaining("--:--"); return; }
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("00:00"); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: "Queued",
  creating: "Building order...",
  authorizing: "Authorizing...",
  paying: "Processing payment...",
  success: "Paid",
  blocked: "Blocked",
  error: "Failed",
};

const STATUS_CLASS: Record<ItemStatus, string> = {
  queued: "bg-slate-100 text-slate-500",
  creating: "bg-blue-100 text-blue-700",
  authorizing: "bg-blue-100 text-blue-700",
  paying: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  blocked: "bg-rose-100 text-rose-700",
  error: "bg-rose-100 text-rose-700",
};

const MOCK_CARDS = [
  { id: "card_visa_4242",  network: "Visa",       last4: "4242", expiry: "09/27", isDefault: true },
  { id: "card_mc_8317",   network: "Mastercard", last4: "8317", expiry: "03/26", isDefault: false },
  { id: "card_amex_5591", network: "Amex",       last4: "5591", expiry: "11/28", isDefault: false },
];

export default function Checkout() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialItems = (location.state?.items as CartItemData[] | undefined) ?? [];

  const [queue, setQueue] = useState<QueueEntry[]>(
    initialItems.map((item) => ({ item, status: "queued" as ItemStatus }))
  );
  const [started, setStarted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState(MOCK_CARDS[0].id);

  const active = activeIndex !== null ? queue[activeIndex] : null;
  const countdown = useCountdown(active?.expiresAt);

  const updateEntry = (index: number, patch: Partial<QueueEntry>) => {
    setQueue((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  // Runs the exact same create -> approve -> execute sequence the old
  // single-item Checkout used, just once per cart item instead of once
  // overall — the DPAT/guardrail backend is untouched either way.
  const processItem = async (index: number, item: CartItemData) => {
    setActiveIndex(index);
    updateEntry(index, { status: "creating", reason: undefined });
    try {
      const createRes = await authFetch("/api/checkout/create", {
        method: "POST",
        body: JSON.stringify({ product_id: item.product_id, merchant_id: item.merchant_id, quantity: item.quantity }),
      });
      if (!createRes.ok) throw new Error(await readErrorDetail(createRes, "Checkout creation failed"));
      const checkoutData: CheckoutData = await createRes.json();
      updateEntry(index, { status: "authorizing", checkoutData });

      const approveRes = await authFetch("/api/authorizations/approve", {
        method: "POST",
        body: JSON.stringify({
          checkout_id: checkoutData.checkout_id,
          checkout_hash: checkoutData.checkout_hash,
          merchant_id: checkoutData.merchant_id,
          total: checkoutData.total,
          currency: checkoutData.currency,
          product_id: checkoutData.product_id,
          product_title: checkoutData.product_title,
          merchant_name: checkoutData.merchant_name,
          subtotal: checkoutData.subtotal,
          tax: checkoutData.tax,
          shipping: checkoutData.shipping,
        }),
      });
      if (!approveRes.ok) throw new Error(await readErrorDetail(approveRes, "Authorization failed"));
      const approveData = await approveRes.json();
      updateEntry(index, { status: "paying", tokenId: approveData.token_id, expiresAt: approveData.expires_at });

      const execRes = await authFetch("/api/payments/execute", {
        method: "POST",
        body: JSON.stringify({
          token_id: approveData.token_id,
          checkout_id: checkoutData.checkout_id,
          checkout_hash: checkoutData.checkout_hash,
          merchant_id: checkoutData.merchant_id,
          merchant_name: checkoutData.merchant_name,
          total: checkoutData.total,
          currency: checkoutData.currency,
          product_id: checkoutData.product_id,
          product_title: checkoutData.product_title,
          subtotal: checkoutData.subtotal,
          tax: checkoutData.tax,
          shipping: checkoutData.shipping,
        }),
      });
      if (!execRes.ok) throw new Error(await readErrorDetail(execRes, "Payment execution failed"));
      const execData = await execRes.json();

      if (execData.status === "success") {
        updateEntry(index, { status: "success", orderId: execData.order_id, amount: execData.amount });
        removeFromCart(item.cart_item_id).catch(() => {});
      } else {
        updateEntry(index, { status: "blocked", orderId: execData.order_id, reason: execData.blocked_reason });
      }
    } catch (e) {
      updateEntry(index, { status: "error", reason: (e as Error).message });
    }
  };

  const handleApproveAll = async () => {
    if (started) return;
    setStarted(true);
    setProcessing(true);
    for (let i = 0; i < initialItems.length; i++) {
      await processItem(i, initialItems[i]);
    }
    setProcessing(false);
  };

  const handleRetry = async (index: number) => {
    await processItem(index, initialItems[index]);
  };

  if (initialItems.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
        <AppHeader title="Checkout" backHref="/cart" backLabel="Cart" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-rose-500 text-sm">No items selected. Go back to your cart and pick something to buy.</p>
          <button onClick={() => navigate("/cart")} className="text-sm text-[var(--color-primary)] underline">
            Back to cart
          </button>
        </div>
      </div>
    );
  }

  const succeeded = queue.filter((e) => e.status === "success").length;
  const finished = started && !processing;
  const [redirectIn, setRedirectIn] = useState<number | null>(null);

  // Auto-redirect to chat 3s after all items are done processing, if at least one succeeded.
  useEffect(() => {
    if (!finished || succeeded === 0) return;
    setRedirectIn(3);
    const interval = setInterval(() => {
      setRedirectIn((c) => {
        if (c === null || c <= 1) { clearInterval(interval); return null; }
        return c - 1;
      });
    }, 1000);
    const timeout = setTimeout(() => navigate("/"), 3000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [finished, succeeded, navigate]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      <AppHeader title="Checkout & Authorization" backHref="/cart" backLabel="Cart" />
      <div className="flex-1 p-6">

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">

        {/* Order queue */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)]"
        >
          <h2 className="font-semibold mb-4 text-[var(--color-text)]">
            Order Summary {queue.length > 1 && `(${queue.length} items)`}
          </h2>

          <div className="flex flex-col gap-3">
            {queue.map((entry, index) => {
              const visual = getProductVisual(entry.item.title, entry.item.category);
              const VisualIcon = visual.icon;
              return (
                <div key={entry.item.cart_item_id} className="flex items-center gap-3">
                  {entry.item.image_url ? (
                    <img src={entry.item.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
                      <VisualIcon size={16} className={visual.fg} strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">{entry.item.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {entry.item.merchant_name} · ${(entry.checkoutData?.total ?? entry.item.price * entry.item.quantity).toFixed(2)}
                    </p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ${STATUS_CLASS[entry.status]}`}>
                    {STATUS_LABEL[entry.status]}
                  </span>
                  {entry.status === "error" && (
                    <button
                      type="button"
                      onClick={() => handleRetry(index)}
                      title="Retry"
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors shrink-0"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {active?.status === "blocked" && active.reason && (
            <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-left">
              <AlertTriangle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700">{active.reason}</p>
            </div>
          )}

          {/* Card selector */}
          <div className="mt-4">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CreditCard size={12} /> Payment Method
            </p>
            <div className="flex flex-col gap-1.5">
              {MOCK_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  disabled={started}
                  onClick={() => setSelectedCard(card.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm text-left transition-colors disabled:cursor-default ${
                    selectedCard === card.id
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-text)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40"
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                    selectedCard === card.id
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                      : "border-[var(--color-border)]"
                  }`} />
                  <span className="font-medium text-xs">{card.network}</span>
                  <span className="text-xs">●●●● {card.last4}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{card.expiry}</span>
                  {card.isDefault && (
                    <span className="text-[10px] text-[var(--color-success)] font-semibold">Default</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {!started ? (
              <button
                onClick={handleApproveAll}
                className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] transition-colors flex items-center justify-center gap-2"
              >
                Approve Purchase{queue.length > 1 ? ` (${queue.length} items)` : ""}
              </button>
            ) : processing ? (
              <button
                disabled
                className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm opacity-70 flex items-center justify-center gap-2"
              >
                <Loader size={14} className="animate-spin" /> Processing...
              </button>
            ) : (
              <div className="text-center py-2">
                <p className="text-sm font-semibold text-[var(--color-success)]">
                  {succeeded > 0 ? `${succeeded} of ${queue.length} purchased ✓` : "Purchase complete"}
                </p>
                {redirectIn !== null && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Returning to chat in {redirectIn}s...
                  </p>
                )}
              </div>
            )}
            <button
              onClick={() => navigate(finished ? "/" : "/cart")}
              disabled={processing}
              className="w-full py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors"
            >
              {finished ? "Back to Chat" : "Cancel"}
            </button>
            {finished && (
              <button
                onClick={() => navigate("/dashboard")}
                className="w-full py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                View in Dashboard
              </button>
            )}
          </div>
        </motion.div>

        {/* Authorization Panel */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)]"
        >
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-[var(--color-primary)]" />
            <h2 className="font-semibold text-[var(--color-text)]">Payment Authorization</h2>
          </div>

          <div className="space-y-1.5 mb-5">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Agent Access
            </p>
            <div className="flex items-center gap-2 text-sm text-rose-500">
              <XCircle size={14} /> Card number (never exposed)
            </div>
            <div className="flex items-center gap-2 text-sm text-rose-500">
              <XCircle size={14} /> CVV (never exposed)
            </div>
            <div className="flex items-center gap-2 text-sm text-rose-500">
              <XCircle size={14} /> Banking credentials
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Scoped Authorization {queue.length > 1 && "(current item)"}
            </p>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Merchant: {active?.checkoutData?.merchant_name ?? "—"}
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Max Amount: {active?.checkoutData ? `$${active.checkoutData.total.toFixed(2)}` : "—"}
            </div>
            <div className={`flex items-center gap-2 text-sm ${active?.tokenId ? "text-[var(--color-success)]" : "text-[var(--color-text-muted)]"}`}>
              <Clock size={14} />
              {active?.tokenId ? `Expires in: ${countdown}` : "Expires in: 15:00 (after approval)"}
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Single use only
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Checkout hash bound
            </div>
          </div>

          {active?.tokenId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-mono break-all"
            >
              Token: {active.tokenId}
            </motion.div>
          )}
        </motion.div>
      </div>
      </div>
    </div>
  );
}
