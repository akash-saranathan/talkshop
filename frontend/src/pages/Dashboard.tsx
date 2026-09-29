import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader } from "lucide-react";

interface Transaction {
  order_id: string;
  merchant: string;
  amount: number;
  status: "paid" | "blocked";
  reason?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/orders?user_id=USR001")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load orders");
        return res.json();
      })
      .then((data: Transaction[]) => setTransactions(data))
      .catch(() => setError("Couldn't load orders. Is the backend running?"))
      .finally(() => setLoading(false));
  }, []);

  const approved = transactions.filter((t) => t.status === "paid").length;
  const blocked = transactions.filter((t) => t.status === "blocked").length;
  const totalSpend = transactions.filter((t) => t.status === "paid")
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-[var(--color-primary)]">Commerce Intelligence</h1>
        <button
          disabled
          aria-disabled="true"
          title="Coming soon"
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] opacity-40 cursor-not-allowed border border-[var(--color-border)] rounded-lg px-3 py-1.5"
        >
          <Download size={14} /> Export
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Sessions", value: transactions.length },
          { label: "Approved", value: approved, color: "text-[var(--color-success)]" },
          { label: "Blocked", value: blocked, color: "text-[var(--color-blocked)]" },
          { label: "Total Spend", value: `$${totalSpend.toFixed(2)}` },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
            <p className={`text-2xl font-bold ${kpi.color ?? "text-[var(--color-text)]"}`}>{kpi.value}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Transaction table */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-text-muted)]">
            <Loader size={16} className="animate-spin" /> Loading orders...
          </div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-rose-500">{error}</div>
        ) : transactions.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
            No orders yet — complete a purchase to see it here.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Order</th>
                <th className="text-left px-5 py-3">Merchant</th>
                <th className="text-left px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Reason</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.order_id} className="border-b border-[var(--color-border)] hover:bg-white/60 transition-colors">
                  <td className="px-5 py-3 font-medium">{tx.order_id}</td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">{tx.merchant}</td>
                  <td className="px-5 py-3">${tx.amount.toFixed(2)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      tx.status === "paid"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                    }`}>
                      {tx.status === "paid" ? "✓ PAID" : "⛔ BLOCKED"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)] font-mono text-xs">{tx.reason ?? "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => navigate(`/payment-result/${tx.order_id}`)}
                      className="text-xs text-[var(--color-primary)] hover:underline"
                    >
                      View Trail →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
