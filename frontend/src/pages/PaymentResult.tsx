import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle, XOctagon, Shield } from "lucide-react";
import { motion } from "framer-motion";

interface SuccessState {
  status: "success";
  tokenId: string;
  orderId: string;
  amount: number;
  merchant: string;
  summary: string;
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
  const state = location.state as ResultState | null;

  const isSuccess = state?.status === "success";

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
            <p className="text-sm text-[var(--color-text-muted)] mb-6">{state.summary}</p>

            <div className="space-y-2 text-sm text-left mb-6">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Order</span>
                <span className="font-mono font-medium">{state.orderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">DPAT Token</span>
                <span className="font-mono text-xs text-emerald-600 break-all max-w-[200px] text-right">{state.tokenId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Amount</span>
                <span className="font-medium">${state.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">Merchant</span>
                <span className="font-medium">{state.merchant}</span>
              </div>
            </div>

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
          /* Fallback: navigated here directly without state */
          <>
            <CheckCircle size={48} className="text-[var(--color-success)] mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[var(--color-success)] mb-6">ORDER CONFIRMED</h1>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">Your purchase was authorized and processed.</p>
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
