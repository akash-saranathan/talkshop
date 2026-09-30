import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader, Wallet as WalletIcon, Package, Truck, PackageCheck,
  ChevronDown, ChevronUp, ExternalLink, type LucideIcon,
} from "lucide-react";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";
import AppHeader from "../components/AppHeader";

type DeliveryStatus = "processing" | "shipped" | "delivered";
type FilterKey = "all" | "arrived";
type SortCol = "purchase_date" | "arrival_date";
type SortDir = "asc" | "desc";

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

interface WalletBalance { balance: number; currency: string; }

interface AuditEvent {
  event_id: string;
  event_type: string;
  agent_id: string | null;
  timestamp: string | null;
}

const DELIVERY_META: Record<DeliveryStatus, { label: string; icon: LucideIcon; cls: string }> = {
  processing: { label: "Processing", icon: Package,      cls: "bg-amber-100 text-amber-700" },
  shipped:    { label: "Shipped",    icon: Truck,        cls: "bg-blue-100 text-blue-700" },
  delivered:  { label: "Delivered",  icon: PackageCheck, cls: "bg-emerald-100 text-emerald-700" },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",     label: "All Orders" },
  { key: "arrived", label: "Arrived" },
];

function daysFromNow(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function applyFilter(orders: Order[], filter: FilterKey): Order[] {
  if (filter === "all") return orders;
  if (filter === "arrived") return orders.filter((o) => o.delivery_status === "delivered");
  return orders;
}

function formatDate(iso: string | null, short = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (short) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatExpected(iso: string | null): string {
  if (!iso) return "—";
  const days = daysFromNow(iso);
  if (days === null) return "—";
  if (days < 0) return "Delivered";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function AISummary({ orders, wallet }: { orders: Order[]; wallet: WalletBalance | null }) {
  const paid    = orders.filter((o) => o.status === "paid");
  const blocked = orders.filter((o) => o.status === "blocked");
  const inFlight = paid.filter((o) => o.delivery_status !== "delivered");

  if (orders.length === 0) return null;

  let insight = "";
  if (paid.length > 0 && inFlight.length > 0) {
    insight = `${inFlight.length} order${inFlight.length > 1 ? "s are" : " is"} in transit — all securely authorized.`;
  } else if (paid.length > 0) {
    insight = `All ${paid.length} order${paid.length > 1 ? "s have" : " has"} been delivered. Nothing in transit right now.`;
  } else if (blocked.length > 0) {
    insight = `${blocked.length} payment${blocked.length > 1 ? "s were" : " was"} blocked before any charge was made.`;
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 mb-5">
      <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">AI Summary</p>
      <p className="text-sm text-[var(--color-text)]">
        {wallet && <span className="font-semibold text-[var(--color-primary)]">${wallet.balance.toFixed(2)} remaining</span>}
        {wallet && insight && " · "}
        {insight}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [auditData, setAuditData] = useState<Record<string, AuditEvent[]>>({});
  const [auditLoading, setAuditLoading] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("purchase_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    Promise.all([
      authFetch("/api/orders").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      authFetch("/api/wallet").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([o, w]: [Order[], WalletBalance]) => { setOrders(o); setWallet(w); })
      .catch(() => setError("Couldn't load your dashboard — please try again."))
      .finally(() => setLoading(false));
  }, []);

  const toggleAudit = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (auditData[id]) return;
    setAuditLoading((s) => new Set(s).add(id));
    try {
      const r = await authFetch(`/api/audit/${id}`);
      const events: AuditEvent[] = r.ok ? await r.json() : [];
      setAuditData((d) => ({ ...d, [id]: events }));
    } catch {
      setAuditData((d) => ({ ...d, [id]: [] }));
    } finally {
      setAuditLoading((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const paid      = orders.filter((o) => o.status === "paid");
  const blocked   = orders.filter((o) => o.status === "blocked");
  const inTransit = paid.filter((o) => o.delivery_status !== "delivered");
  const arrived   = paid.filter((o) => o.delivery_status === "delivered");
  const spend     = paid.reduce((s, o) => s + o.amount, 0);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const visible = (() => {
    let result = applyFilter(orders, activeFilter);
    if (dateFrom) result = result.filter((o) => o.created_at && o.created_at >= dateFrom);
    if (dateTo)   result = result.filter((o) => o.created_at && o.created_at <= dateTo + "T23:59:59");
    return [...result].sort((a, b) => {
      const av = sortCol === "purchase_date" ? (a.created_at ?? "") : (a.estimated_delivery ?? "");
      const bv = sortCol === "purchase_date" ? (b.created_at ?? "") : (b.estimated_delivery ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  })();

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      <AppHeader title="My Orders" backHref="/" backLabel="Chat" />

      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <div className="rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] text-white p-4">
            <p className="text-xs text-white/70 flex items-center gap-1 mb-1"><WalletIcon size={12} /> Wallet</p>
            <p className="text-xl font-bold">{loading ? "—" : wallet ? `$${wallet.balance.toFixed(2)}` : "$0.00"}</p>
          </div>
          {[
            { label: "Items Ordered", value: paid.length,               cls: "text-[var(--color-primary)]" },
            { label: "In Transit",    value: inTransit.length,           cls: "text-blue-500" },
            { label: "Arrived",       value: arrived.length,             cls: "text-[var(--color-success)]" },
            { label: "Total Spent",   value: `$${spend.toFixed(2)}`,    cls: "text-[var(--color-text)]" },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <p className="text-xs text-[var(--color-text-muted)] mb-1">{k.label}</p>
              <p className={`text-xl font-bold ${k.cls}`}>{loading ? "—" : k.value}</p>
            </div>
          ))}
        </div>

        {/* AI Summary */}
        <AISummary orders={orders} wallet={wallet} />

        {/* Filter bar */}
        {!loading && !error && orders.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${
                  activeFilter === f.key
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]"
                }`}
              >
                {f.label}
                {f.key !== "all" && (
                  <span className="ml-1.5 text-[11px] opacity-70">
                    ({applyFilter(orders, f.key).length})
                  </span>
                )}
              </button>
            ))}
            <div className="flex items-center gap-1.5 ml-2 border-l border-[var(--color-border)] pl-3">
              <span className="text-xs text-[var(--color-text-muted)]">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
              />
              <span className="text-xs text-[var(--color-text-muted)]">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-xs text-[var(--color-text-muted)] hover:text-rose-500 transition-colors px-1"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {/* Orders table */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-text-muted)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <Loader size={16} className="animate-spin" /> Loading orders...
          </div>
        ) : error ? (
          <div className="py-16 text-center text-sm text-rose-500 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {error}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <Package size={32} className="mx-auto text-[var(--color-text-muted)] mb-3 opacity-40" />
            <p className="text-sm text-[var(--color-text-muted)]">No orders yet — start a conversation to find and buy products.</p>
            <a href="/" className="inline-block mt-4 text-sm text-[var(--color-primary)] hover:underline">Start shopping →</a>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <p className="text-sm text-[var(--color-text-muted)]">No orders match this filter.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2.5rem_1fr_7rem_9rem_7rem_8rem_2.5rem] items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <span />
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Product</span>
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Amount</span>
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Status</span>
              <button
                onClick={() => toggleSort("purchase_date")}
                className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hover:text-[var(--color-primary)] transition-colors"
              >
                Date
                <span className="opacity-60">{sortCol === "purchase_date" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
              </button>
              <button
                onClick={() => toggleSort("arrival_date")}
                className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hover:text-[var(--color-primary)] transition-colors"
              >
                Arrival
                <span className="opacity-60">{sortCol === "arrival_date" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
              </button>
              <span />
            </div>

            {/* Rows */}
            {visible.map((order, rowIdx) => {
              const visual = getProductVisual(order.product_title ?? "", order.product_category ?? "");
              const VisualIcon = visual.icon;
              const delivery = order.delivery_status ? DELIVERY_META[order.delivery_status] : null;
              const DelivIcon = delivery?.icon;
              const expanded = expandedId === order.order_id;
              const events: AuditEvent[] = auditData[order.order_id] ?? [];

              return (
                <div key={order.order_id} className={`border-b border-[var(--color-border)] last:border-b-0 ${rowIdx % 2 === 1 ? "bg-[var(--color-bg)]/40" : ""}`}>
                  {/* Main row */}
                  <div className="grid grid-cols-[2.5rem_1fr_7rem_9rem_7rem_8rem_2.5rem] items-center gap-3 px-5 py-3.5">
                    {/* Product thumb */}
                    {order.product_image_url && !imageErrors.has(order.order_id) ? (
                      <img
                        src={order.product_image_url}
                        alt=""
                        onError={() => setImageErrors((p) => new Set(p).add(order.order_id))}
                        className="w-9 h-9 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
                        <VisualIcon size={15} className={visual.fg} strokeWidth={1.5} />
                      </div>
                    )}

                    {/* Product + merchant */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">
                        {order.product_title ?? "—"}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-muted)] truncate">{order.merchant}</p>
                    </div>

                    {/* Amount */}
                    <span className="text-sm font-semibold text-[var(--color-text)]">${order.amount.toFixed(2)}</span>

                    {/* Status */}
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        order.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}>
                        {order.status === "paid" ? "✓ Authorized" : "⛔ Blocked"}
                      </span>
                      {delivery && DelivIcon && (
                        <span className={`inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[11px] font-semibold ${delivery.cls}`}>
                          <DelivIcon size={10} /> {delivery.label}
                        </span>
                      )}
                    </div>

                    {/* Purchase Date */}
                    <span className="text-xs text-[var(--color-text-muted)]">{formatDate(order.created_at, true)}</span>

                    {/* Expected Arrival */}
                    <span className={`text-xs font-medium ${
                      order.delivery_status === "delivered"
                        ? "text-[var(--color-success)]"
                        : daysFromNow(order.estimated_delivery) !== null && daysFromNow(order.estimated_delivery)! <= 2
                          ? "text-amber-600"
                          : "text-[var(--color-text-muted)]"
                    }`}>
                      {order.status === "paid" ? formatExpected(order.estimated_delivery) : "—"}
                    </span>

                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleAudit(order.order_id)}
                      className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-bg)] transition-colors"
                      title={expanded ? "Collapse details" : "Expand details"}
                    >
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {/* Expanded audit trail */}
                  {expanded && (
                    <div className="px-5 pb-4 pt-1 border-t border-[var(--color-border)]/60 bg-[var(--color-bg)]/30">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                          Audit Trail · {order.order_id}
                        </p>
                        <button
                          onClick={() => navigate(`/payment-result/${order.order_id}`)}
                          className="text-[11px] text-[var(--color-primary)] hover:underline flex items-center gap-1"
                        >
                          Full result <ExternalLink size={10} />
                        </button>
                      </div>

                      {order.status === "blocked" && order.reason && (
                        <p className="text-xs text-rose-500 font-mono mb-3 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
                          Blocked: {order.reason}
                        </p>
                      )}

                      {auditLoading.has(order.order_id) ? (
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                          <Loader size={12} className="animate-spin" /> Loading...
                        </div>
                      ) : events.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-muted)]">No audit events.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {events.map((ev, ei) => (
                            <div key={ev.event_id} className="flex items-center gap-2 text-xs">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                ev.event_type.includes("BLOCK") || ev.event_type.includes("FAIL")
                                  ? "bg-rose-400"
                                  : "bg-[var(--color-success)]"
                              }`} />
                              <span className="font-mono text-[var(--color-text)]">{ev.event_type}</span>
                              {ev.agent_id && <span className="text-[var(--color-text-muted)] shrink-0">· {ev.agent_id}</span>}
                              <span className="text-[var(--color-text-muted)] ml-auto shrink-0">
                                {ev.timestamp
                                  ? new Date(ev.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                                  : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {order.tracking_number && (
                        <p className="text-xs text-[var(--color-text-muted)] font-mono mt-3">
                          Tracking: {order.tracking_number}
                          {order.estimated_delivery && ` · Est. ${formatDate(order.estimated_delivery)}`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
