import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CheckCircle, XOctagon, Shield, Loader, Wallet } from "lucide-react";
import { motion } from "framer-motion";
import { authFetch } from "../api/client";

interface SuccessState {
  status: "success";
  tokenId?: string;
  orderId: string;
  amount: number;
  merchant: string;
  summary?: string;
  walletBalance?: number;
}

interface BlockedState {
  status: "blocked";
  blockedReason: string;
  orderId?: string;
}

type ResultState = SuccessState | BlockedState;

export default function PaymentResult() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams<{ orderId: string }>();
  const routerState = location.state as ResultState | null;

  const [state, setState] = useState<ResultState | null>(routerState);
  const [loading, setLoading] = useState(!routerState);
  const [notFound, setNotFound] = useState(false);

  // If we navigated here without state (Dashboard link, refresh, direct URL),
  // fetch the real order instead of guessing at its outcome.
  useEffect(() => {
    if (routerState || !orderId) return;
    (async () => {
      try {
        const res = await authFetch(`/api/orders/${orderId}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error("Failed to load order");
        const data = await res.json();
        if (data.status === "confirmed") {
          const walletRes = await authFetch("/api/wallet");
          const walletData = walletRes.ok ? await walletRes.json() : null;
          setState({
            status: "success",
            orderId: data.order_id,
            amount: data.amount,
            merchant: data.merchant_name,
            walletBalance: walletData?.balance,
          });
        } else {
          setState({
            status: "blocked",
            orderId: data.order_id,
            blockedReason: data.reason ?? data.status,
          });
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId, routerState]);

  const isSuccess = state?.status === "success";

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Loader size={24} className="animate-spin text-[var(--color-primary)]" />
        <span className="ml-3 text-sm text-[var(--color-text-muted)]">Loading order...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 max-w-md w-full text-center"
      >
        {isSuccess && state?.status === "success" ? (
          <>
            <CheckCircle size={48} className="text-[var(--color-success)] mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[var(--color-success)] mb-1">ORDER CONFIRMED</h1>
            {state.summary && (
              <p className="text-sm text-[var(--color-text-muted)] mb-6">{state.summary}</p>
            )}

            <div className="space-y-2 text-sm text-left mb-6">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Order</span>
                <span className="font-mono font-medium">{state.orderId}</span>
              </div>
              {state.tokenId && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">DPAT Token</span>
                  <span className="font-mono text-xs text-emerald-600 break-all max-w-[200px] text-right">{state.tokenId}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Amount</span>
                <span className="font-medium">${state.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Merchant</span>
                <span className="font-medium">{state.merchant}</span>
              </div>
            </div>

            {state.walletBalance !== undefined && (
              <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-3 mb-4 flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
                  <Wallet size={13} /> Wallet balance after this purchase
                </span>
                <span className="font-semibold text-[var(--color-text)]">${state.walletBalance.toFixed(2)}</span>
              </div>
            )}

            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 mb-6 flex items-start gap-2 text-left">
              <Shield size={14} className="text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-700">
                Payment processed through DPAT authorization. Card credentials were never exposed to the agent.
              </p>
            </div>
          </>
        ) : state?.status === "blocked" ? (
          <>
            <XOctagon size={48} className="text-[var(--color-blocked,#ef4444)] mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[var(--color-blocked,#ef4444)] mb-6">PAYMENT BLOCKED</h1>
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 mb-6 text-sm text-left space-y-2">
              <div>
                <span className="text-[var(--color-text-muted)] text-xs uppercase tracking-wider">Guardrail</span>
                <p className="font-mono font-semibold text-rose-600 mt-0.5">{state.blockedReason}</p>
              </div>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              The agent cannot override this restriction.<br />No funds were moved. Event logged to audit.
            </p>
          </>
        ) : (
          <>
            <XOctagon size={48} className="text-[var(--color-text-muted)] mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[var(--color-text)] mb-1">
              {notFound ? "Order Not Found" : "No Order Information"}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              {notFound
                ? `No order matches "${orderId}".`
                : "This page needs an order to show. Start a new purchase or check the dashboard."}
            </p>
          </>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface)] transition-colors"
          >
            View Audit Trail
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-light)] transition-colors"
          >
            {isSuccess ? "Continue Shopping" : "New Session"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
