import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Loader, ChevronLeft, ChevronRight, Package } from "lucide-react";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";

interface Order {
  order_id: string;
  merchant: string;
  amount: number;
  status: "paid" | "blocked";
  product_title: string | null;
  product_category: string | null;
  product_image_url: string | null;
  created_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
}

/** Condensed live feed of recent orders alongside the chat — not a
 * duplicate of the full Dashboard, just a glanceable widget. */
export default function OrdersPanel({ collapsed, onToggleCollapse, width }: Props) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    authFetch("/api/orders")
      .then((res) => (res.ok ? res.json() : []))
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  if (collapsed) {
    return (
      <aside className="w-12 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center py-4 gap-4 shrink-0">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand orders"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <Package size={18} className="text-[var(--color-text-muted)]" />
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className="border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 overflow-y-auto shrink-0"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
          Your Orders
        </span>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse"
          className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-bg)] transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--color-text-muted)]">
          <Loader size={14} className="animate-spin" /> Loading...
        </div>
      ) : orders.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">
          No orders yet
        </p>
      ) : (
        orders.slice(0, 8).map((order) => {
          const visual = getProductVisual(order.product_title ?? "", order.product_category ?? "");
          const VisualIcon = visual.icon;
          return (
            <button
              key={order.order_id}
              onClick={() => navigate(`/payment-result/${order.order_id}`)}
              className="flex items-center gap-2.5 text-left rounded-xl border border-[var(--color-border)] p-2.5 hover:bg-[var(--color-bg)] transition-colors"
            >
              {order.product_image_url && !imageErrors.has(order.order_id) ? (
                <img
                  src={order.product_image_url}
                  alt={order.product_title ?? ""}
                  onError={() => setImageErrors((prev) => new Set(prev).add(order.order_id))}
                  className="w-9 h-9 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
                  <VisualIcon size={16} className={visual.fg} strokeWidth={1.5} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[var(--color-text)] truncate">
                  {order.product_title ?? order.order_id}
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {formatDate(order.created_at)} · ${order.amount.toFixed(2)}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                order.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}>
                {order.status === "paid" ? "✓" : "⛔"}
              </span>
            </button>
          );
        })
      )}

      <Link
        to="/dashboard"
        className="text-xs text-[var(--color-primary)] hover:underline text-center mt-1"
      >
        View all in Dashboard →
      </Link>
    </aside>
  );
}
