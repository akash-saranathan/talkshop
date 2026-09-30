import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";

interface Step {
  id: string;
  message: string;
  status: "running" | "done" | "error";
}

interface Order {
  order_id: string;
  amount: number;
  status: "paid" | "blocked";
  product_title: string | null;
  product_category: string | null;
  product_image_url: string | null;
  created_at: string | null;
}

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  activeTurnSteps: Step[];
  activeLoading: boolean;
}

const AGENTS = [
  { id: "VibeCheck", role: "Orchestrator", desc: "Intent & safety" },
  { id: "SneakPeek", role: "Product Search", desc: "Discovery & ranking" },
  { id: "CartUp",    role: "Checkout",       desc: "Order building" },
  { id: "GreenLight",role: "Authorization",  desc: "DPAT issuance" },
  { id: "PayIt",     role: "Payment",        desc: "Execution" },
  { id: "TrackIt",   role: "Order Tracker",  desc: "Confirmation" },
] as const;

type AgentStatus = "idle" | "running" | "done";

function agentStatus(agentId: string, steps: Step[]): AgentStatus {
  const mine = steps.filter((s) => s.message.includes(agentId));
  if (mine.some((s) => s.status === "running")) return "running";
  if (mine.some((s) => s.status === "done")) return "done";
  return "idle";
}

function lastMessage(agentId: string, steps: Step[]): string | null {
  const mine = [...steps].reverse().find((s) => s.message.includes(agentId));
  return mine?.message ?? null;
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "running")
    return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  if (status === "done")
    return <span className="w-2 h-2 rounded-full bg-[var(--color-success)] shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-[var(--color-border)] shrink-0" />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AgentTrailPanel({ collapsed, onToggleCollapse, width, activeTurnSteps, activeLoading }: Props) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    authFetch("/api/orders")
      .then((res) => (res.ok ? res.json() : []))
      .then(setOrders)
      .catch(() => setOrders([]))
  }, []);

  if (collapsed) {
    return (
      <aside className="w-12 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center py-4 gap-4 shrink-0">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand panel"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <Activity size={18} className="text-[var(--color-text-muted)]" />
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className="border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden shrink-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[var(--color-border)] shrink-0">
        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
          Agent Activity
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

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {/* Agent roster */}
        <div className="flex flex-col gap-1.5">
          {AGENTS.map((agent) => {
            const status = agentStatus(agent.id, activeTurnSteps);
            const last = lastMessage(agent.id, activeTurnSteps);
            return (
              <div
                key={agent.id}
                className={`rounded-lg px-3 py-2 flex items-start gap-2.5 transition-colors ${
                  status !== "idle"
                    ? "bg-[var(--color-bg)] border border-[var(--color-border)]"
                    : "opacity-50"
                }`}
              >
                <StatusDot status={status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold text-[var(--color-text)]">{agent.id}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{agent.role}</span>
                  </div>
                  {last ? (
                    <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">{last}</p>
                  ) : (
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{agent.desc}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live step trail for active query */}
        {(activeTurnSteps.length > 0 || activeLoading) && (
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              {activeLoading ? "Live Trace" : "Last Trace"}
            </p>
            <div className="flex flex-col gap-1.5 relative">
              <div className="absolute left-[5px] top-2 bottom-2 w-px bg-[var(--color-border)]" />
              {activeTurnSteps.map((step, i) => (
                <div key={step.id + i} className="flex items-start gap-2 pl-4 relative">
                  <span className={`absolute left-0 top-1 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-surface)] shrink-0 ${
                    step.status === "done" ? "bg-[var(--color-success)]" :
                    step.status === "error" ? "bg-[var(--color-blocked)]" :
                    "bg-amber-400 animate-pulse"
                  }`} />
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-tight">{step.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent orders mini list */}
        {orders.length > 0 && (
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Recent Orders
            </p>
            <div className="flex flex-col gap-1.5">
              {orders.slice(0, 5).map((order) => {
                const visual = getProductVisual(order.product_title ?? "", order.product_category ?? "");
                const VisualIcon = visual.icon;
                return (
                  <button
                    key={order.order_id}
                    onClick={() => navigate(`/payment-result/${order.order_id}`)}
                    className="flex items-center gap-2 text-left rounded-lg p-2 hover:bg-[var(--color-bg)] transition-colors"
                  >
                    {order.product_image_url && !imageErrors.has(order.order_id) ? (
                      <img
                        src={order.product_image_url}
                        alt=""
                        onError={() => setImageErrors((prev) => new Set(prev).add(order.order_id))}
                        className="w-7 h-7 rounded-md object-cover shrink-0"
                      />
                    ) : (
                      <div className={`w-7 h-7 rounded-md grid place-items-center shrink-0 ${visual.bg}`}>
                        <VisualIcon size={12} className={visual.fg} strokeWidth={1.5} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-[var(--color-text)] truncate">
                        {order.product_title ?? order.order_id}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {formatDate(order.created_at)} · ${order.amount.toFixed(2)}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold shrink-0 ${
                      order.status === "paid" ? "text-[var(--color-success)]" : "text-[var(--color-blocked)]"
                    }`}>
                      {order.status === "paid" ? "✓" : "✗"}
                    </span>
                  </button>
                );
              })}
            </div>
            <a href="/dashboard" className="text-[11px] text-[var(--color-primary)] hover:underline block text-center mt-2">
              View all →
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
