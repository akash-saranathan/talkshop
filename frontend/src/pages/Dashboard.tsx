import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Loader, Wallet as WalletIcon, Package, Truck, PackageCheck, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";

type DeliveryStatus = "processing" | "shipped" | "delivered";

interface Order {
  order_id: string;
  merchant: string;
  amount: number;
  status: "paid" | "blocked";
  reason?: string;
  created_at: string | null;
  product_title: string | null;
  product_category: string | null;
  product_image_url: string | null;
  tracking_number: string | null;
  delivery_status: DeliveryStatus | null;
  estimated_delivery: string | null;
}

interface WalletBalance {
  balance: number;
  currency: string;
}

interface AuditEvent {
  event_id: string;
  event_type: string;
  agent_id: string | null;
  timestamp: string | null;
}

const DELIVERY_BADGE: Record<DeliveryStatus, { label: string; icon: LucideIcon; className: string }> = {
  processing: { label: "Processing", icon: Package, className: "bg-slate-100 text-slate-600" },
  shipped: { label: "Shipped", icon: Truck, className: "bg-blue-100 text-blue-700" },
  delivered: { label: "Delivered", icon: PackageCheck, className: "bg-emerald-100 text-emerald-700" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [auditData, setAuditData] = useState<Record<string, AuditEvent[]>>({});
  const [auditLoading, setAuditLoading] = useState<Set<string>>(new Set());

  const toggleAudit = async (orderId: string) => {
    if (expandedAudit === orderId) { setExpandedAudit(null); return; }
    setExpandedAudit(orderId);
    if (auditData[orderId]) return;
    setAuditLoading((prev) => new Set(prev).add(orderId));
    try {
      const res = await authFetch(`/api/audit/${orderId}`);
      const events: AuditEvent[] = res.ok ? await res.json() : [];
      setAuditData((prev) => ({ ...prev, [orderId]: events }));
    } catch {
      setAuditData((prev) => ({ ...prev, [orderId]: [] }));
    } finally {
      setAuditLoading((prev) => { const s = new Set(prev); s.delete(orderId); return s; });
    }
  };

  useEffect(() => {
    Promise.all([
      authFetch("/api/orders").then((res) => {
        if (!res.ok) throw new Error("Failed to load orders");
        return res.json();
      }),
      authFetch("/api/wallet").then((res) => {
        if (!res.ok) throw new Error("Failed to load wallet");
        return res.json();
      }),
    ])
      .then(([ordersData, walletData]: [Order[], WalletBalance]) => {
        setOrders(ordersData);
        setWallet(walletData);
      })
      .catch(() => setError("Couldn't load your dashboard. Please try again in a moment."))
      .finally(() => setLoading(false));
  }, []);

  const approved = orders.filter((o) => o.status === "paid").length;
  const blocked = orders.filter((o) => o.status === "blocked").length;
  const totalSpend = orders.filter((o) => o.status === "paid")
    .reduce((sum, o) => sum + o.amount, 0);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
          >
            <ArrowLeft size={15} /> Back to Chat
          </a>
          <h1 className="text-xl font-semibold text-[var(--color-primary)]">Commerce Intelligence</h1>
        </div>
        <button
          disabled
          aria-disabled="true"
          title="Coming soon"
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] opacity-40 cursor-not-allowed border border-[var(--color-border)] rounded-lg px-3 py-1.5"
        >
          <Download size={14} /> Export
        </button>
      </div>

      {/* Wallet hero card */}
      <div className="rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] text-white p-6 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-white/80 flex items-center gap-1.5 mb-1">
            <WalletIcon size={14} /> Wallet Balance
          </p>
          <p className="text-3xl font-bold">
            {loading ? "—" : wallet ? `$${wallet.balance.toFixed(2)}` : "$0.00"}
          </p>
        </div>
        <p className="text-xs text-white/70 max-w-[220px] text-right">
          Backs every DPAT token this agent is authorized to spend from — never a real card.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
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

      {/* Order history */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-text-muted)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <Loader size={16} className="animate-spin" /> Loading orders...
        </div>
      ) : error ? (
        <div className="py-10 text-center text-sm text-rose-500 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-muted)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          No orders yet — complete a purchase to see it here.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => {
            const visual = getProductVisual(order.product_title ?? "", order.product_category ?? "");
            const VisualIcon = visual.icon;
            const delivery = order.delivery_status ? DELIVERY_BADGE[order.delivery_status] : null;
            const DeliveryIcon = delivery?.icon;

            return (
              <div
                key={order.order_id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-0"
              >
              <div className="flex items-center gap-4">
                {/* Product visual — real photo when available, icon tile otherwise */}
                {order.product_image_url && !imageErrors.has(order.order_id) ? (
                  <img
                    src={order.product_image_url}
                    alt={order.product_title ?? ""}
                    onError={() => setImageErrors((prev) => new Set(prev).add(order.order_id))}
                    className="w-14 h-14 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div className={`w-14 h-14 rounded-xl grid place-items-center shrink-0 ${visual.bg}`}>
                    <VisualIcon size={26} className={visual.fg} strokeWidth={1.5} />
                  </div>
                )}

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[var(--color-text)] truncate">
                      {order.product_title ?? order.order_id}
                    </p>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${
                      order.status === "paid"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                    }`}>
                      {order.status === "paid" ? "✓ PAID" : "⛔ BLOCKED"}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {order.merchant} · {order.order_id} · {formatDate(order.created_at)}
                  </p>

                  {order.status === "blocked" && order.reason && (
                    <p className="text-xs text-rose-500 font-mono mt-1">{order.reason}</p>
                  )}

                  {delivery && DeliveryIcon && (
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${delivery.className}`}>
                        <DeliveryIcon size={12} /> {delivery.label}
                      </span>
                      {order.tracking_number && (
                        <span className="text-xs text-[var(--color-text-muted)] font-mono">
                          {order.tracking_number}
                        </span>
                      )}
                      {order.estimated_delivery && (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          Est. {formatDate(order.estimated_delivery)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Amount + trail toggle */}
                <div className="text-right shrink-0">
                  <p className="font-semibold text-[var(--color-text)]">${order.amount.toFixed(2)}</p>
                  <button
                    onClick={() => toggleAudit(order.order_id)}
                    className="text-xs text-[var(--color-primary)] hover:underline mt-1 flex items-center gap-0.5 ml-auto"
                  >
                    Audit {expandedAudit === order.order_id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </button>
                </div>
              </div> {/* end inner flex row */}

              {/* Inline audit trail */}
              {expandedAudit === order.order_id && (
                <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                  {auditLoading.has(order.order_id) ? (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <Loader size={12} className="animate-spin" /> Loading audit trail...
                    </div>
                  ) : (auditData[order.order_id] ?? []).length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)]">No audit events found.</p>
                  ) : (
                    <div className="flex flex-col gap-2 relative">
                      <div className="absolute left-[5px] top-1 bottom-1 w-px bg-[var(--color-border)]" />
                      {(auditData[order.order_id] ?? []).map((ev) => (
                        <div key={ev.event_id} className="flex items-start gap-3 pl-4 relative">
                          <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]/20 border border-[var(--color-primary)]/40 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-xs font-mono text-[var(--color-text)]">{ev.event_type}</span>
                            {ev.agent_id && (
                              <span className="text-[10px] text-[var(--color-text-muted)] ml-2">via {ev.agent_id}</span>
                            )}
                            {ev.timestamp && (
                              <span className="text-[10px] text-[var(--color-text-muted)] ml-2">
                                {new Date(ev.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => navigate(`/payment-result/${order.order_id}`)}
                    className="text-xs text-[var(--color-primary)] hover:underline mt-3 block"
                  >
                    Full payment result →
                  </button>
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
