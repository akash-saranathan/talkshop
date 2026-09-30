import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader, AlertTriangle, RotateCcw, Lock } from "lucide-react";
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
  const locationItems = (location.state?.items as CartItemData[] | undefined) ?? null;
  const locationPaymentMethod = (location.state?.paymentMethod as "wallet" | "card" | undefined) ?? "card";
  const locationSelectedCard = (location.state?.selectedCard as string | undefined);

  const [initialItems, setInitialItems] = useState<CartItemData[]>(locationItems ?? []);
  const [cartLoading, setCartLoading] = useState(!locationItems);
  const [queue, setQueue] = useState<QueueEntry[]>(
    (locationItems ?? []).map((item) => ({ item, status: "queued" as ItemStatus }))
  );
  const [started, setStarted] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "card">(locationPaymentMethod);
  const [selectedCard, setSelectedCard] = useState(locationSelectedCard ?? MOCK_CARDS[0].id);
  const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);
  const [redirectIn, setRedirectIn] = useState<number | null>(null);

  // Fetch wallet balance for the payment method picker
  useEffect(() => {
    authFetch("/api/wallet").then((r) => r.ok ? r.json() : null).then((w) => { if (w) setWallet(w); }).catch(() => {});
  }, []);

  // Fall back to loading cart from API when no items passed via navigate state
  // (e.g. when auto-checkout countdown fires directly to /checkout).
  useEffect(() => {
    if (locationItems) return;
    import("../api/cart").then(({ getCart }) =>
      getCart().then((items) => {
        setInitialItems(items);
        setQueue(items.map((item) => ({ item, status: "queued" as ItemStatus })));
      }).catch(() => {}).finally(() => setCartLoading(false))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (cartLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
        <AppHeader title="Checkout" backHref="/cart" backLabel="Cart" />
        <div className="flex-1 flex items-center justify-center">
          <Loader size={24} className="animate-spin text-[var(--color-primary)]" />
        </div>
      </div>
    );
  }

  if (initialItems.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
        <AppHeader title="Checkout" backHref="/cart" backLabel="Cart" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-rose-500 text-sm">Your cart is empty. Add items from the chat first.</p>
          <button onClick={() => navigate("/")} className="text-sm text-[var(--color-primary)] underline">
            Back to shopping
          </button>
        </div>
      </div>
    );
  }

  const succeeded = queue.filter((e) => e.status === "success").length;
  const finished = started && !processing;
  const checkoutTotal = queue.reduce((s, e) => s + (e.checkoutData?.total ?? e.item.price * e.item.quantity), 0);
  const walletInsufficient = paymentMethod === "wallet" && wallet !== null && wallet.balance < checkoutTotal;

  // Auto-redirect to dashboard 10s after all items are done processing, if at least one succeeded.
  useEffect(() => {
    if (!finished || succeeded === 0) return;
    setRedirectIn(10);
    const interval = setInterval(() => {
      setRedirectIn((c) => {
        if (c === null || c <= 1) { clearInterval(interval); return null; }
        return c - 1;
      });
    }, 1000);
    const timeout = setTimeout(() => navigate("/dashboard"), 10000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [finished, succeeded, navigate]);

  // Derive a readable payment label to show (read-only)
  const payingWith = paymentMethod === "wallet"
    ? `Wallet${wallet ? ` · $${wallet.balance.toFixed(2)} balance` : ""}`
    : (() => { const c = MOCK_CARDS.find((c) => c.id === selectedCard); return c ? `${c.network} ••••${c.last4}` : "Card"; })();

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      <AppHeader title="Order Summary" backHref="/cart" backLabel="Cart" />

      <div className="flex-1 p-6 flex flex-col items-start">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)] flex flex-col gap-4"
        >
          {/* Item list */}
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
                    <button type="button" onClick={() => handleRetry(index)} title="Retry"
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors shrink-0">
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div className="border-t border-[var(--color-border)] pt-3 flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between font-semibold text-base">
              <span className="text-[var(--color-text)]">Total</span>
              <span className="text-[var(--color-primary)]">${checkoutTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span>Paying with</span>
              <span className="font-medium text-[var(--color-text)]">{payingWith}</span>
            </div>
          </div>

          {/* Blocked reason */}
          {active?.status === "blocked" && active.reason && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700">{active.reason}</p>
            </div>
          )}

          {/* CTA */}
          <div className="flex flex-col gap-2">
            {!started ? (
              <>
                {walletInsufficient && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
                    Wallet balance (${wallet!.balance.toFixed(2)}) is less than the order total — go back to Cart and switch to Card.
                  </p>
                )}
                <button
                  onClick={handleApproveAll}
                  disabled={walletInsufficient}
                  className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Approve Purchase{queue.length > 1 ? ` (${queue.length} items)` : ""}
                </button>
              </>
            ) : processing ? (
              <button disabled className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm opacity-70 flex items-center justify-center gap-2">
                <Loader size={14} className="animate-spin" /> Processing...
              </button>
            ) : (
              <div className="text-center py-2">
                <p className="text-sm font-semibold text-[var(--color-success)]">
                  {succeeded > 0 ? `${succeeded} of ${queue.length} purchased ✓` : "Purchase complete"}
                </p>
                {redirectIn !== null && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Opening your order tracker in {redirectIn}s...</p>
                )}
              </div>
            )}
            <button onClick={() => navigate(finished ? "/dashboard" : "/cart")} disabled={processing}
              className="w-full py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors">
              {finished ? "View Order Tracker" : "Cancel"}
            </button>
            <button onClick={() => navigate("/")} disabled={processing}
              className="w-full py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors">
              Back to Chat
            </button>
          </div>
        </motion.div>
      </div>

      {/* Security footer */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
        <div className="max-w-md flex items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1.5 shrink-0">
            <Lock size={12} className="text-[var(--color-success)]" />
            <span className="text-[var(--color-success)] font-medium">AI-Secured</span>
          </div>
          <span>·</span>
          <span>Card details never reach the AI pipeline</span>
          <span>·</span>
          <span>One-time scoped authorization per purchase</span>
        </div>
      </div>
    </div>
  );
}
