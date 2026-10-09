import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Activity, CheckCircle2, XCircle,
  Loader2, Shield, Search, ShoppingBag, Key, CreditCard, Package,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";
import type { ProductData } from "../api/chat";

interface SimpleIntent {
  color?: string;
  size?: string;
  maxPrice?: number;
  brand?: string;
}

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
  activeProducts?: ProductData[];
  activeIntent?: SimpleIntent;
  activeRecommendation?: string;
  embedMode?: boolean;
}

type AgentId = "VibeCheck" | "SneakPeek" | "CartUp" | "GreenLight" | "PayIt" | "TrackIt";
type AgentStatus = "idle" | "running" | "done" | "error";

const PIPELINE: {
  id: AgentId;
  label: string;
  role: string;
  icon: React.ElementType;
  color: string;
  detail: string;
}[] = [
  { id: "VibeCheck",   label: "VibeCheck",   role: "Orchestrator",     icon: Shield,      color: "#6366f1", detail: "Parses intent, validates safety, classifies message type" },
  { id: "SneakPeek",  label: "SneakPeek",   role: "Product Search",   icon: Search,      color: "#0ea5e9", detail: "Queries merchant APIs, normalises, filters & ranks products" },
  { id: "CartUp",     label: "CartUp",      role: "Cart & Checkout",  icon: ShoppingBag, color: "#f59e0b", detail: "Builds cart entry, creates checkout session with merchant" },
  { id: "GreenLight", label: "GreenLight",  role: "Authorization",    icon: Key,         color: "#10b981", detail: "Issues DPAT token — single-use, scoped, card never exposed" },
  { id: "PayIt",      label: "PayIt",       role: "Payment",          icon: CreditCard,  color: "#8b5cf6", detail: "Executes payment with 12-point guardrail check" },
  { id: "TrackIt",    label: "TrackIt",     role: "Order Tracker",    icon: Package,     color: "#ef4444", detail: "Confirms order, updates audit log, sends notification" },
];

function getStatus(id: AgentId, steps: Step[]): AgentStatus {
  const mine = steps.filter((s) => s.message.toLowerCase().includes(id.toLowerCase()));
  if (mine.some((s) => s.status === "error"))   return "error";
  if (mine.some((s) => s.status === "running")) return "running";
  if (mine.some((s) => s.status === "done"))    return "done";
  return "idle";
}

function getAgentSteps(id: AgentId, steps: Step[]): Step[] {
  return steps.filter((s) => s.message.toLowerCase().includes(id.toLowerCase()));
}

function getAgentOutput(id: AgentId, steps: Step[], products?: ProductData[], intent?: SimpleIntent) {
  const mine = getAgentSteps(id, steps);
  const rows: { label: string; value: string; ok?: boolean }[] = [];

  if (id === "VibeCheck") {
    const intentStep = mine.find((s) => s.message.toLowerCase().includes("looking for"));
    if (intentStep) {
      const m = intentStep.message.match(/[Ll]ooking for (.+)/);
      if (m) rows.push({ label: "Query",         value: m[1] });
    }
    if (intent?.brand)    rows.push({ label: "Brand",   value: intent.brand });
    if (intent?.color)    rows.push({ label: "Color",   value: intent.color });
    if (intent?.size)     rows.push({ label: "Size",    value: intent.size });
    if (intent?.maxPrice) rows.push({ label: "Budget",  value: `≤ $${intent.maxPrice}` });
    const safe = mine.find((s) => s.message.toLowerCase().includes("all clear") || s.message.toLowerCase().includes("ready to shop"));
    if (safe) rows.push({ label: "Safety",  value: "Passed", ok: true });
    const follow = mine.find((s) => s.message.toLowerCase().includes("answering") || s.message.toLowerCase().includes("follow-up") || s.message.toLowerCase().includes("chitchat") || s.message.toLowerCase().includes("greeting"));
    if (follow) rows.push({ label: "Mode", value: "Conversational (no search)" });
  }

  if (id === "SneakPeek") {
    const found = mine.find((s) => s.message.match(/found (\d+)/i));
    if (found) {
      const m = found.message.match(/found (\d+) products? across (\d+)/i);
      if (m) {
        rows.push({ label: "Raw results",  value: `${m[1]} products` });
        rows.push({ label: "Merchants",    value: `${m[2]} sources` });
      }
    }
    if (products && products.length > 0) {
      rows.push({ label: "After filter",  value: `${products.length} shown` });
      const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))] as string[];
      if (brands.length) rows.push({ label: "Brands", value: brands.slice(0, 4).join(", ") });
      const lo = Math.min(...products.map((p) => p.price));
      const hi = Math.max(...products.map((p) => p.price));
      rows.push({ label: "Price range",   value: `$${lo.toFixed(0)} – $${hi.toFixed(0)}` });
      const top = products[0];
      if (top) rows.push({ label: "Top pick", value: `${top.title} · $${top.price}` });
    }
  }

  if (id === "CartUp") {
    const cartStep = mine.find((s) => s.message.toLowerCase().includes("cartup") || s.message.toLowerCase().includes("order"));
    if (cartStep) {
      rows.push({ label: "Status", value: cartStep.status === "done" ? "Created" : "Creating…", ok: cartStep.status === "done" });
      rows.push({ label: "Session",  value: "Merchant-scoped" });
    } else {
      rows.push({ label: "Status", value: "Waiting for product selection" });
    }
  }

  if (id === "GreenLight") {
    const step = mine.find((s) => s.message.toLowerCase().includes("greenlight"));
    if (step) {
      rows.push({ label: "DPAT token",  value: step.status === "done" ? "Issued" : "Generating…", ok: step.status === "done" });
      rows.push({ label: "Scope",       value: "Single merchant · 1 use" });
      rows.push({ label: "TTL",         value: "15 minutes" });
      rows.push({ label: "Card data",   value: "Never transmitted", ok: true });
    } else {
      rows.push({ label: "Status", value: "Awaiting user approval" });
    }
  }

  if (id === "PayIt") {
    const step = mine.find((s) => s.message.toLowerCase().includes("payit"));
    if (step) {
      rows.push({ label: "Payment",    value: step.status === "done" ? "Processed" : "Processing…", ok: step.status === "done" });
      rows.push({ label: "Guardrails", value: "12 / 12 passed", ok: true });
      rows.push({ label: "Method",     value: "DPAT-authorised card" });
    } else {
      rows.push({ label: "Status", value: "Awaiting authorization token" });
    }
  }

  if (id === "TrackIt") {
    const step = mine.find((s) => s.message.toLowerCase().includes("trackit"));
    if (step) {
      rows.push({ label: "Order",        value: step.status === "done" ? "Confirmed" : "Confirming…", ok: step.status === "done" });
      rows.push({ label: "Audit log",    value: "Updated", ok: true });
      rows.push({ label: "Notification", value: "Sent", ok: true });
    } else {
      rows.push({ label: "Status", value: "Awaiting payment result" });
    }
  }

  return rows;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pickActiveAgent(steps: Step[]): AgentId {
  const order: AgentId[] = ["TrackIt", "PayIt", "GreenLight", "CartUp", "SneakPeek", "VibeCheck"];
  for (const id of order) {
    const s = getStatus(id, steps);
    if (s === "running" || s === "done") return id;
  }
  return "VibeCheck";
}

// ── Node component for the pipeline flowchart ──────────────────────────────

function PipelineNode({
  agent, status, selected, onClick,
}: {
  agent: typeof PIPELINE[number];
  status: AgentStatus;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = agent.icon;
  const isRunning = status === "running";

  const ringColor =
    status === "done"    ? "ring-emerald-500/60" :
    status === "running" ? "ring-amber-400/70"   :
    status === "error"   ? "ring-red-500/60"     :
    "ring-[var(--color-border)]";

  const bgColor =
    status === "done"    ? "bg-emerald-500/10"  :
    status === "running" ? "bg-amber-400/10"    :
    status === "error"   ? "bg-red-500/10"      :
    "bg-[var(--color-border)]/20";

  const iconColor =
    status === "done"    ? "#10b981" :
    status === "running" ? "#f59e0b" :
    status === "error"   ? "#ef4444" :
    "var(--color-border)";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 group cursor-pointer outline-none transition-transform hover:scale-105 ${selected ? "scale-105" : ""}`}
      style={{ minWidth: 52 }}
    >
      <div className={`relative w-10 h-10 rounded-xl ring-2 flex items-center justify-center transition-all ${ringColor} ${bgColor} ${selected ? "shadow-raised" : "shadow-card"}`}>
        {isRunning && (
          <span className="absolute inset-0 rounded-xl ring-2 ring-amber-400/50 animate-ping" />
        )}
        <Icon size={16} style={{ color: selected ? agent.color : iconColor }} strokeWidth={1.8} />
        {/* Status badge */}
        <span className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[var(--color-surface)] flex items-center justify-center ${
          status === "done"    ? "bg-emerald-500" :
          status === "running" ? "bg-amber-400 animate-pulse" :
          status === "error"   ? "bg-red-500"    :
          "bg-[var(--color-border)]"
        }`}>
          {status === "done"    && <CheckCircle2 size={7} className="text-white" />}
          {status === "error"   && <XCircle size={7} className="text-white" />}
          {status === "running" && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
        </span>
      </div>
      <span className={`text-[9px] font-semibold leading-none text-center transition-colors ${
        selected ? "text-[var(--color-primary)]" : status === "idle" ? "text-[var(--color-text-muted)] opacity-50" : "text-[var(--color-text-muted)]"
      }`} style={{ maxWidth: 52 }}>
        {agent.id}
      </span>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AgentTrailPanel({
  collapsed,
  onToggleCollapse,
  width,
  activeTurnSteps,
  activeLoading,
  activeProducts,
  activeIntent,
  embedMode = false,
}: Props) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("VibeCheck");
  const [expandedAgents, setExpandedAgents] = useState<Set<AgentId>>(new Set(["VibeCheck"]));
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authFetch("/api/orders")
      .then((r) => (r.ok ? r.json() : []))
      .then(setOrders)
      .catch(() => setOrders([]));
  }, []);

  // Auto-switch to the active agent
  useEffect(() => {
    if (activeTurnSteps.length > 0) {
      const active = pickActiveAgent(activeTurnSteps);
      setSelectedAgent(active);
      setExpandedAgents((prev) => new Set([...prev, active]));
    }
  }, [activeTurnSteps]);

  const toggleExpand = (id: AgentId) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectedAgent(id);
  };

  if (collapsed) {
    return (
      <aside className="w-10 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center pt-4 gap-4 shrink-0">
        <button type="button" onClick={onToggleCollapse} title="Expand panel"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
          <ChevronLeft size={16} />
        </button>
        <Activity size={15} className="text-[var(--color-text-muted)]" />
      </aside>
    );
  }

  const doneCount = PIPELINE.filter((a) => getStatus(a.id, activeTurnSteps) === "done").length;
  const activeAgentMeta = PIPELINE.find((a) => a.id === selectedAgent)!;
  const outputRows = getAgentOutput(selectedAgent, activeTurnSteps, activeProducts, activeIntent);
  const activeSteps = getAgentSteps(selectedAgent, activeTurnSteps);

  const inner = (
    <>
      {!embedMode && (
        <div className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ background: "linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-white/10 grid place-items-center">
              <Activity size={13} className="text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-white leading-none tracking-wide">Agent Pipeline</p>
              <p className="text-[9px] text-white/60 mt-0.5 leading-none">Live execution trace</p>
            </div>
            {activeLoading && (
              <span className="flex items-center gap-1 ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[9px] text-amber-300 font-medium">Running</span>
              </span>
            )}
          </div>
          <button type="button" onClick={onToggleCollapse} title="Collapse"
            className="text-white/50 hover:text-white transition-colors">
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* ── Progress bar ── */}
      <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
            Pipeline Progress
          </span>
          <span className="text-[9px] text-[var(--color-text-muted)]">
            {doneCount} / {PIPELINE.length}
          </span>
        </div>
        <div className="h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-emerald-500 transition-all duration-500"
            style={{ width: `${(doneCount / PIPELINE.length) * 100}%` }}
          />
        </div>
      </div>

      {/* ── Pipeline flowchart ── */}
      <div className="px-3 py-3 border-b border-[var(--color-border)] shrink-0">
        <p className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">
          Agentic Flow
        </p>
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
          {PIPELINE.map((agent, i) => (
            <div key={agent.id} className="flex items-center gap-1">
              <PipelineNode
                agent={agent}
                status={getStatus(agent.id, activeTurnSteps)}
                selected={selectedAgent === agent.id}
                onClick={() => toggleExpand(agent.id)}
              />
              {i < PIPELINE.length - 1 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <div className={`h-px transition-colors duration-300 ${
                    getStatus(PIPELINE[i + 1].id, activeTurnSteps) !== "idle"
                      ? "bg-[var(--color-primary)]"
                      : "bg-[var(--color-border)]"
                  }`} style={{ width: 10 }} />
                  <svg width="6" height="8" viewBox="0 0 6 8" fill="none">
                    <path d="M1 1l4 3-4 3" stroke={
                      getStatus(PIPELINE[i + 1].id, activeTurnSteps) !== "idle"
                        ? "var(--color-primary)" : "var(--color-border)"
                    } strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Agent detail list (scrollable) ── */}
      <div ref={detailRef} className="flex-1 overflow-y-auto">

        {/* Selected agent detail */}
        <div className="border-b border-[var(--color-border)]">
          {/* Detail header */}
          <div
            className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-[var(--color-surface-2,var(--color-border))/20] transition-colors"
            onClick={() => toggleExpand(selectedAgent)}
            style={{ background: `${activeAgentMeta.color}10` }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${activeAgentMeta.color}20` }}>
                <activeAgentMeta.icon size={12} style={{ color: activeAgentMeta.color }} strokeWidth={2} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[var(--color-text)] leading-none">{activeAgentMeta.label}</p>
                <p className="text-[9px] text-[var(--color-text-muted)] mt-0.5 leading-none">{activeAgentMeta.role}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const s = getStatus(selectedAgent, activeTurnSteps);
                if (s === "running") return <Loader2 size={12} className="text-amber-500 animate-spin" />;
                if (s === "done")    return <CheckCircle2 size={12} className="text-emerald-500" />;
                if (s === "error")   return <XCircle size={12} className="text-red-500" />;
                return null;
              })()}
              {expandedAgents.has(selectedAgent) ? <ChevronUp size={12} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={12} className="text-[var(--color-text-muted)]" />}
            </div>
          </div>

          {expandedAgents.has(selectedAgent) && (
            <div className="px-4 pb-3 pt-1">
              {/* Description */}
              <p className="text-[10px] text-[var(--color-text-muted)] italic mb-3 leading-relaxed border-l-2 pl-2"
                style={{ borderColor: activeAgentMeta.color }}>
                {activeAgentMeta.detail}
              </p>

              {/* Key-value output */}
              {outputRows.length > 0 && (
                <div className="flex flex-col gap-0 mb-3 rounded-lg overflow-hidden border border-[var(--color-primary)]/15 shadow-card">
                  {outputRows.map((row, i) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-1.5 ${i % 2 === 0 ? "bg-[var(--color-bg)]" : "bg-[var(--color-surface)]"}`}>
                      <span className="text-[10px] font-semibold text-[var(--color-text-muted)] w-20 shrink-0">{row.label}</span>
                      <span className={`text-[11px] flex-1 font-medium leading-relaxed ${row.ok ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--color-text)]"}`}>
                        {row.ok && <span className="mr-1">✓</span>}{row.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Step trace */}
              {activeSteps.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">
                    {activeLoading ? "⚡ Live Steps" : "Step Trace"}
                  </p>
                  <div className="relative pl-4">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--color-border)]" />
                    <div className="flex flex-col gap-2">
                      {activeSteps.map((step, i) => (
                        <div key={step.id + i} className="flex items-start gap-2 relative">
                          <span className={`absolute left-[-13px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-surface)] shrink-0 ${
                            step.status === "done"    ? "bg-emerald-500" :
                            step.status === "error"   ? "bg-red-500"     :
                            "bg-amber-400 animate-pulse"
                          }`} />
                          <p className={`text-[10px] leading-snug ${
                            step.status === "running" ? "text-amber-600 dark:text-amber-400 font-medium" :
                            step.status === "done"    ? "text-[var(--color-text)]" :
                            "text-red-600"
                          }`}>
                            {step.message
                              .replace(new RegExp(selectedAgent, "gi"), "")
                              .replace(/\s*[–—-]\s*/g, " · ")
                              .trim()}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {outputRows.length === 0 && activeSteps.length === 0 && (
                <p className="text-[10px] text-[var(--color-text-muted)] italic">
                  This agent has not run yet in the current turn.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Other agents — compact row for each, always shown */}
        {PIPELINE.filter((a) => a.id !== selectedAgent).map((agent) => {
          const status = getStatus(agent.id, activeTurnSteps);
          const agentSteps = getAgentSteps(agent.id, activeTurnSteps);
          const expanded = expandedAgents.has(agent.id);
          return (
            <div key={agent.id} className="border-b border-[var(--color-border)]">
              <div
                className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-[var(--color-surface-2,var(--color-border))/10] transition-colors"
                onClick={() => toggleExpand(agent.id)}
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${agent.color}20` }}>
                    <agent.icon size={10} style={{ color: agent.color }} strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-[var(--color-text)] leading-none">{agent.label}</p>
                    <p className="text-[8px] text-[var(--color-text-muted)] leading-none mt-0.5">{agent.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {status === "running" && <Loader2 size={10} className="text-amber-500 animate-spin" />}
                  {status === "done"    && <CheckCircle2 size={10} className="text-emerald-500" />}
                  {status === "error"   && <XCircle size={10} className="text-red-500" />}
                  {expanded ? <ChevronUp size={10} className="text-[var(--color-text-muted)]" /> : <ChevronDown size={10} className="text-[var(--color-text-muted)]" />}
                </div>
              </div>

              {expanded && (
                <div className="px-4 pb-3">
                  {agentSteps.length > 0 ? (
                    <div className="relative pl-4">
                      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-[var(--color-border)]" />
                      <div className="flex flex-col gap-1.5">
                        {agentSteps.map((step, i) => (
                          <div key={step.id + i} className="flex items-start gap-1.5 relative">
                            <span className={`absolute left-[-13px] top-1.5 w-2 h-2 rounded-full shrink-0 ${
                              step.status === "done" ? "bg-emerald-500" : step.status === "error" ? "bg-red-500" : "bg-amber-400 animate-pulse"
                            }`} />
                            <p className={`text-[10px] leading-snug ${
                              step.status === "running" ? "text-amber-600 dark:text-amber-400 font-medium" :
                              step.status === "done"    ? "text-[var(--color-text)]" :
                              "text-red-500"
                            }`}>
                              {step.message.replace(new RegExp(agent.id, "gi"), "").replace(/\s*[–—-]\s*/g, " · ").trim()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-[var(--color-text-muted)] italic leading-relaxed border-l-2 pl-2"
                      style={{ borderColor: agent.color + "60" }}>
                      {agent.detail}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Recent orders */}
        {orders.length > 0 && (
          <div className="border-t border-[var(--color-border)] mt-auto">
            <div className="px-4 pt-3 pb-1">
              <p className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                Recent Orders
              </p>
            </div>
            {orders.slice(0, 3).map((order) => {
              const visual = getProductVisual(order.product_title ?? "", order.product_category ?? "");
              const VisualIcon = visual.icon;
              return (
                <button
                  key={order.order_id}
                  onClick={() => navigate(`/payment-result/${order.order_id}`)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-bg)] transition-colors text-left"
                >
                  {order.product_image_url && !imageErrors.has(order.order_id) ? (
                    <img
                      src={order.product_image_url}
                      alt=""
                      onError={() => setImageErrors((prev) => new Set(prev).add(order.order_id))}
                      className="w-7 h-7 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
                      <VisualIcon size={12} className={visual.fg} strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-[var(--color-text)] truncate">
                      {order.product_title ?? order.order_id}
                    </p>
                    <p className="text-[9px] text-[var(--color-text-muted)]">
                      {formatDate(order.created_at)} · ${order.amount.toFixed(2)}
                    </p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                    order.status === "paid"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                  }`}>
                    {order.status === "paid" ? "Paid" : "Failed"}
                  </span>
                </button>
              );
            })}
            <Link to="/dashboard"
              className="text-[10px] text-[var(--color-primary)] hover:underline block text-center py-2 border-t border-[var(--color-border)] mt-1">
              View all orders →
            </Link>
          </div>
        )}
      </div>
    </>
  );

  if (embedMode) return inner;

  return (
    <aside
      style={{ width }}
      className="border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden shrink-0"
    >
      {inner}
    </aside>
  );
}
