import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, CheckCircle, XCircle, Clock, Loader, AlertTriangle } from "lucide-react";
import type { ProductData } from "../api/chat";

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

function useCountdown(expiresAt: string | null): string {
  const [remaining, setRemaining] = useState("--:--");

  useEffect(() => {
    if (!expiresAt) return;
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

export default function Checkout() {
  const navigate = useNavigate();
  const location = useLocation();
  const product = location.state?.product as ProductData | undefined;

  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only once a token has been issued — an execute failure at this point
  // still has a valid order/token, so it's shown inline with a retry option
  // instead of collapsing to the full-page error view.
  const [executeError, setExecuteError] = useState<string | null>(null);

  const countdown = useCountdown(expiresAt);

  // Step 1: build checkout as soon as we have a product
  useEffect(() => {
    if (!product) {
      setError("No product selected. Go back and choose a product.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/checkout/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: product.product_id,
            merchant_id: product.merchant_id,
            quantity: 1,
            user_id: "USR001",
          }),
        });
        if (!res.ok) {
          throw new Error(await readErrorDetail(res, "Checkout creation failed"));
        }
        const data: CheckoutData = await res.json();
        setCheckout(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [product]);

  // Step 3: charge the already-issued token. Split out from approval so a
  // failure here can be retried without re-running /authorizations/approve.
  const runExecute = useCallback(async (checkout: CheckoutData, token: string) => {
    setExecuting(true);
    setExecuteError(null);
    try {
      const execRes = await fetch("/api/payments/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_id: token,
          checkout_id: checkout.checkout_id,
          checkout_hash: checkout.checkout_hash,
          merchant_id: checkout.merchant_id,
          merchant_name: checkout.merchant_name,
          total: checkout.total,
          currency: checkout.currency,
          user_id: "USR001",
          product_id: checkout.product_id,
          product_title: checkout.product_title,
          subtotal: checkout.subtotal,
          tax: checkout.tax,
          shipping: checkout.shipping,
        }),
      });
      if (!execRes.ok) {
        throw new Error(await readErrorDetail(execRes, "Payment execution failed"));
      }
      const execData = await execRes.json();

      if (execData.status === "success") {
        navigate(`/payment-result/${execData.order_id}`, {
          state: {
            status: "success",
            tokenId: token,
            orderId: execData.order_id,
            amount: execData.amount,
            merchant: execData.merchant,
            summary: execData.summary,
          }
        });
      } else {
        navigate(`/payment-result/${execData.order_id}`, {
          state: {
            status: "blocked",
            blockedReason: execData.blocked_reason,
            orderId: execData.order_id,
          }
        });
      }
    } catch (e) {
      setExecuteError((e as Error).message);
    } finally {
      setExecuting(false);
    }
  }, [navigate]);

  // Step 2: user clicks Approve
  const handleApprove = useCallback(async () => {
    if (!checkout || approving || approved) return;
    setApproving(true);
    try {
      const res = await fetch("/api/authorizations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkout_id: checkout.checkout_id,
          checkout_hash: checkout.checkout_hash,
          merchant_id: checkout.merchant_id,
          total: checkout.total,
          currency: checkout.currency,
          user_id: "USR001",
          product_id: checkout.product_id,
          product_title: checkout.product_title,
          merchant_name: checkout.merchant_name,
          subtotal: checkout.subtotal,
          tax: checkout.tax,
          shipping: checkout.shipping,
        }),
      });
      if (!res.ok) {
        throw new Error(await readErrorDetail(res, "Authorization failed"));
      }
      const data = await res.json();
      setTokenId(data.token_id);
      setExpiresAt(data.expires_at);
      setApproved(true);
      setApproving(false);

      await runExecute(checkout, data.token_id);
    } catch (e) {
      setError((e as Error).message);
      setApproving(false);
    }
  }, [checkout, approving, approved, runExecute]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Loader size={24} className="animate-spin text-[var(--color-primary)]" />
        <span className="ml-3 text-sm text-[var(--color-text-muted)]">Building your order...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex flex-col items-center justify-center gap-4">
        <p className="text-rose-500 text-sm">{error}</p>
        <button onClick={() => navigate("/")} className="text-sm text-[var(--color-primary)] underline">
          Back to search
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <h1 className="text-xl font-semibold text-[var(--color-primary)] mb-6">
        Checkout &amp; Authorization
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">

        {/* Order Summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)]"
        >
          <h2 className="font-semibold mb-4 text-[var(--color-text)]">Order Summary</h2>
          <p className="font-medium text-[var(--color-text)]">{checkout?.product_title}</p>
          <p className="text-sm text-[var(--color-text-muted)]">Merchant: {checkout?.merchant_name}</p>
          {checkout?.size && (
            <p className="text-sm text-[var(--color-text-muted)] mb-4">Size: {checkout.size}</p>
          )}

          <div className="space-y-1 text-sm border-t border-[var(--color-border)] pt-3 mt-3">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Item</span>
              <span>${checkout?.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Tax</span>
              <span>${checkout?.tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Shipping</span>
              <span>{checkout?.shipping === 0 ? "Free" : `$${checkout?.shipping.toFixed(2)}`}</span>
            </div>
            <div className="flex justify-between font-semibold text-base border-t border-[var(--color-border)] pt-2 mt-2">
              <span>Total</span>
              <span>${checkout?.total.toFixed(2)}</span>
            </div>
          </div>

          <p className="text-sm text-[var(--color-text-muted)] mt-3">Visa ●●●● 4242 ✓</p>

          {executeError && (
            <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-left">
              <AlertTriangle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700">{executeError}</p>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {executeError ? (
              <button
                onClick={() => checkout && tokenId && runExecute(checkout, tokenId)}
                disabled={executing}
                className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {executing && <Loader size={14} className="animate-spin" />}
                {executing ? "Retrying..." : "Retry Payment"}
              </button>
            ) : (
              <button
                onClick={handleApprove}
                disabled={approving || executing || approved}
                className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {(approving || executing) && <Loader size={14} className="animate-spin" />}
                {executing
                  ? "Processing Payment..."
                  : approving
                  ? "Authorizing..."
                  : approved
                  ? "Approved ✓"
                  : "Approve Purchase"}
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              disabled={approving || executing || (approved && !executeError)}
              className="w-full py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors"
            >
              Cancel
            </button>
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
              Scoped Authorization
            </p>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Merchant: {checkout?.merchant_name}
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Max Amount: ${checkout?.total.toFixed(2)}
            </div>
            <div className={`flex items-center gap-2 text-sm ${approved ? "text-[var(--color-success)]" : "text-[var(--color-text-muted)]"}`}>
              <Clock size={14} />
              {approved
                ? `Expires in: ${countdown}`
                : "Expires in: 15:00 (after approval)"}
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Single use only
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> Checkout hash bound
            </div>
          </div>

          {tokenId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-mono break-all"
            >
              Token: {tokenId}
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
