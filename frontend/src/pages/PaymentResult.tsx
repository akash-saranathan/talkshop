import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XOctagon } from "lucide-react";

export default function PaymentResult() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // Phase 4: will read result from router state / query param
  const status = params.get("status") ?? "success";
  const isSuccess = status === "success";

  const success = {
    order: "ORD-7821",
    transaction: "TXN-9001",
    amount: "$117.99",
    merchant: "RunnerWorld",
    delivery: "October 2",
  };

  const blocked = {
    guardrail: "AMOUNT_EXCEEDS_AUTHORIZED_LIMIT",
    authorized: "$117.99",
    requested: "$150.00",
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 max-w-md w-full text-center">
        {isSuccess ? (
          <>
            <CheckCircle size={48} className="text-[var(--color-success)] mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[var(--color-success)] mb-6">ORDER CONFIRMED</h1>
            <div className="space-y-2 text-sm text-left mb-6">
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Order</span><span className="font-medium">{success.order}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Transaction</span><span className="font-medium">{success.transaction}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Amount</span><span className="font-medium">{success.amount}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Merchant</span><span className="font-medium">{success.merchant}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Delivery</span><span className="font-medium">{success.delivery}</span></div>
            </div>
          </>
        ) : (
          <>
            <XOctagon size={48} className="text-[var(--color-blocked)] mx-auto mb-4" />
            <h1 className="text-xl font-bold text-[var(--color-blocked)] mb-6">PAYMENT BLOCKED</h1>
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 mb-6 text-sm text-left space-y-2">
              <div><span className="text-[var(--color-text-muted)]">Guardrail</span><p className="font-mono font-semibold text-rose-600">{blocked.guardrail}</p></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Authorized</span><span>{blocked.authorized}</span></div>
              <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Requested</span><span className="text-rose-600 font-medium">{blocked.requested}</span></div>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              The agent cannot override this restriction.<br />No funds were moved. Event logged to audit.
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
      </div>
    </div>
  );
}
