import { useState, useEffect, useRef } from "react";
import {
  Activity, GitBranch, CheckCircle2, Loader2, Circle,
  ShieldCheck, ShieldX, Bot, CreditCard, Package,
  Lock, Zap, AlertTriangle, Cpu, ArrowRight, User,
  ChevronDown, Store, Pause,
} from "lucide-react";

export interface ProtocolEvent {
  type: string;
  ts: string;
  source: string;
  target: string;
  protocol: string;
  direction: string;
  label: string;
  detail: Record<string, unknown>;
}

type FlowState =
  | "idle" | "searching" | "products_shown" | "checkout_loading"
  | "payment_ready" | "ordering" | "complete" | "error";

interface Props {
  events: ProtocolEvent[];
  flowState?: FlowState;
  productTitle?: string;
  productMerchant?: string;
  checkoutTotal?: number;
  orderLabel?: string;
}

// ── Protocol color palette ─────────────────────────────────────────────────────

const PC: Record<string, { badge: string; line: string; text: string; glow: string }> = {
  A2A:  { badge: "bg-blue-100 text-blue-700 border-blue-200",    line: "bg-blue-400",   text: "text-blue-600",   glow: "shadow-blue-100"   },
  UCP:  { badge: "bg-violet-100 text-violet-700 border-violet-200", line: "bg-violet-400", text: "text-violet-600", glow: "shadow-violet-100" },
  AP2:  { badge: "bg-amber-100 text-amber-700 border-amber-200",  line: "bg-amber-400",  text: "text-amber-600",  glow: "shadow-amber-100"  },
  ACP:  { badge: "bg-indigo-100 text-indigo-700 border-indigo-200", line: "bg-indigo-400", text: "text-indigo-600", glow: "shadow-indigo-100" },
};

// ── Flow node status ───────────────────────────────────────────────────────────

type NodeStatus = "upcoming" | "active" | "paused" | "done" | "error";

function getStatus(id: string, flowState: FlowState, events: ProtocolEvent[]): NodeStatus {
  const f = flowState;
  const hasStarted = f !== "idle";
  const isSearching = f === "searching";
  const isProductsShown = f === "products_shown";
  const isCheckoutLoading = f === "checkout_loading";
  const isPaymentReady = f === "payment_ready";
  const isOrdering = f === "ordering";
  const isComplete = f === "complete";
  const isError = f === "error";

  const hasA2ASend      = events.some(e => e.protocol === "A2A" && e.label === "message/send");
  const hasTaskResult   = events.some(e => e.protocol === "A2A" && e.label === "task_result");
  const hasCatalog      = events.some(e => e.protocol === "UCP" && (e.label === "catalog_search" || e.label === "catalog_results"));
  const hasUCPCreated   = events.some(e => e.label === "session_created" || e.label === "checkout_created");
  const hasAllMandates  = events.some(e => e.label === "ap2_payment_mandate" || e.label === "ap2_payment_authorization");
  const hasACPIssued    = events.some(e => e.label === "acp_spt_issued" || e.label === "acp_token_issued");
  const hasACPVerified  = events.some(e => e.label === "payment_executed" || e.label === "acp_token_verified");

  if (isError && id === "order") return "error";

  switch (id) {
    // ── Nodes
    case "user":
      return hasStarted ? "done" : "upcoming";

    case "merchant":
      if (!hasStarted) return "upcoming";
      if (hasTaskResult) return "done";
      if (hasA2ASend || isSearching) return "active";
      return "upcoming";

    case "products":
      if (isComplete || isOrdering || isPaymentReady || isCheckoutLoading) return "done";
      if (isProductsShown) return "done";
      if (hasTaskResult) return "active";
      return "upcoming";

    case "checkout":
      if (isComplete || isOrdering) return "done";
      if (isPaymentReady) return "paused";
      if (isCheckoutLoading || hasUCPCreated) return "active";
      return "upcoming";

    case "authz":
      if (isComplete) return "done";
      if (!isOrdering) return "upcoming";
      if (hasAllMandates) return "done";
      return "active";

    case "delpay":
      if (isComplete) return "done";
      if (!isOrdering) return "upcoming";
      if (hasACPVerified) return "done";
      if (hasACPIssued) return "active";
      if (hasAllMandates) return "active";
      return "upcoming";

    case "psp":
      if (isComplete) return "done";
      if (isOrdering && (hasACPVerified || hasAllMandates)) return "active";
      return "upcoming";

    case "order":
      return isComplete ? "done" : "upcoming";

    // ── Protocol arrows
    case "arr-a2a":
      if (!hasStarted) return "upcoming";
      if (hasTaskResult) return "done";
      return hasA2ASend || isSearching ? "active" : "upcoming";

    case "arr-ucp-cat":
      if (!hasStarted) return "upcoming";
      if (hasTaskResult) return "done";
      if (hasCatalog || isSearching) return "active";
      return "upcoming";

    case "arr-ucp-co":
      if (!hasTaskResult) return "upcoming";
      if (hasUCPCreated) return "done";
      if (isCheckoutLoading) return "active";
      return "upcoming";

    case "arr-ap2":
      if (!isOrdering && !isComplete) return "upcoming";
      if (hasAllMandates || isComplete) return "done";
      return "active";

    case "arr-acp":
      if (!isOrdering && !isComplete) return "upcoming";
      if (isComplete || hasACPVerified) return "done";
      if (hasACPIssued || hasAllMandates) return "active";
      return "upcoming";

    case "arr-psp":
      return isComplete ? "done" : "upcoming";

    case "arr-order":
      return isComplete ? "done" : "upcoming";

    // ── Pause markers
    case "pause-sel":
      if (isComplete || isOrdering || isPaymentReady || isCheckoutLoading) return "done";
      if (isProductsShown) return "paused";
      return "upcoming";

    case "pause-pay":
      if (isComplete || isOrdering) return "done";
      if (isPaymentReady) return "paused";
      return "upcoming";

    default: return "upcoming";
  }
}

// ── Node box ───────────────────────────────────────────────────────────────────

function NodeBox({
  label, subtitle, simulated, status, icon: Icon, onClick, selected,
}: {
  label: string; subtitle?: string; simulated?: boolean;
  status: NodeStatus; icon?: React.ComponentType<{ size?: number; className?: string }>;
  onClick?: () => void; selected?: boolean;
}) {
  const styles: Record<NodeStatus, string> = {
    upcoming: "border-[var(--color-border)] opacity-40",
    active:   "border-[var(--color-primary)] shadow-md shadow-[var(--color-primary)]/10",
    paused:   "border-amber-400 shadow-sm shadow-amber-100",
    done:     "border-emerald-300 bg-emerald-50/30",
    error:    "border-rose-400 bg-rose-50/20",
  };

  return (
    <div
      onClick={onClick}
      className={`w-full rounded-xl border-2 px-4 py-3 transition-all duration-300 bg-[var(--color-surface)] ${styles[status]} ${onClick ? "cursor-pointer hover:shadow-sm" : ""} ${selected ? "ring-2 ring-[var(--color-primary)]/40" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
            status === "done"   ? "bg-emerald-100 text-emerald-600" :
            status === "active" ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]" :
            status === "paused" ? "bg-amber-100 text-amber-600" :
            "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
          }`}>
            <Icon size={13} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-xs font-bold leading-tight ${
              status === "done"   ? "text-emerald-700" :
              status === "active" ? "text-[var(--color-text)]" :
              status === "paused" ? "text-amber-700" :
              "text-[var(--color-text-muted)]"
            }`}>{label}</p>
            {simulated && (
              <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 uppercase tracking-wide">
                Simulated
              </span>
            )}
          </div>
          {subtitle && (
            <p className={`text-[10px] mt-0.5 ${
              status === "done" ? "text-emerald-600" :
              status === "active" ? "text-[var(--color-text-muted)]" :
              "text-[var(--color-text-muted)] opacity-60"
            }`}>{subtitle}</p>
          )}
        </div>
        <div className="shrink-0">
          {status === "done"   && <CheckCircle2 size={14} className="text-emerald-500" />}
          {status === "active" && <Loader2 size={14} className="text-[var(--color-primary)] animate-spin" />}
          {status === "paused" && <Pause size={14} className="text-amber-500" />}
          {status === "upcoming" && <Circle size={12} className="text-[var(--color-text-muted)] opacity-20" />}
          {status === "error"  && <ShieldX size={14} className="text-rose-500" />}
        </div>
      </div>
    </div>
  );
}

// ── Protocol arrow connector ───────────────────────────────────────────────────

function ArrowConnector({ protocol, label, status }: {
  protocol: string | null; label: string | null; status: NodeStatus;
}) {
  const lineColor =
    status === "done"   ? "bg-emerald-400" :
    status === "active" && protocol ? (PC[protocol]?.line ?? "bg-[var(--color-border)]") :
    "bg-[var(--color-border)]";

  const badgeClass = protocol && (status === "active" || status === "done")
    ? PC[protocol]?.badge ?? ""
    : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border)]";

  return (
    <div className="flex flex-col items-center w-full py-0.5 gap-0">
      <div className={`w-px h-3 transition-colors duration-500 ${lineColor}`} />
      {protocol ? (
        <div className="flex flex-col items-center gap-0.5 py-1">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border transition-colors duration-300 ${badgeClass}`}>
            {protocol}
          </span>
          {label && (
            <span className={`text-[9px] transition-colors duration-300 ${
              status === "upcoming" ? "text-[var(--color-text-muted)] opacity-30" : "text-[var(--color-text-muted)]"
            }`}>{label}</span>
          )}
        </div>
      ) : (
        <div className={`w-px h-4 transition-colors duration-500 ${lineColor}`} />
      )}
      <div className={`w-px h-2 transition-colors duration-500 ${lineColor}`} />
      <ChevronDown size={10} className={`transition-colors duration-300 ${
        status === "done" ? "text-emerald-400" :
        status === "active" && protocol ? (PC[protocol]?.text ?? "text-[var(--color-text-muted)]") :
        "text-[var(--color-border)]"
      }`} />
    </div>
  );
}

// ── Pause marker ───────────────────────────────────────────────────────────────

function PauseMarker({ label, status }: { label: string; status: NodeStatus }) {
  const lineColor = status === "done" ? "bg-emerald-400" : "bg-[var(--color-border)]";

  return (
    <div className="flex flex-col items-center w-full py-0.5 gap-0">
      <div className={`w-px h-3 transition-colors duration-500 ${lineColor}`} />
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-300 ${
        status === "paused"   ? "bg-amber-50 border-amber-300 shadow-sm" :
        status === "done"     ? "bg-emerald-50 border-emerald-200 opacity-60" :
        "bg-[var(--color-surface-2)] border-[var(--color-border)] opacity-30"
      }`}>
        {status === "done" ? (
          <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
        ) : (
          <Pause size={10} className={status === "paused" ? "text-amber-500 shrink-0" : "text-[var(--color-text-muted)] shrink-0"} />
        )}
        <span className={`text-[10px] font-medium ${
          status === "paused" ? "text-amber-700" :
          status === "done"   ? "text-emerald-600" :
          "text-[var(--color-text-muted)]"
        }`}>{label}</span>
      </div>
      <div className={`w-px h-3 transition-colors duration-500 ${lineColor}`} />
    </div>
  );
}

// ── Flow view ──────────────────────────────────────────────────────────────────

// High-level flow: a fixed picture of the purchase, not built from live events.
function FlowView(_props: {
  events: ProtocolEvent[];
  flowState: FlowState;
  checkoutTotal?: number;
  orderLabel?: string;
  selectedStage: string | null;
  onSelectStage: (stage: string) => void;
}) {
  const steps: { title: string; detail: string; badge: string }[] = [
    { title: "You ask a question", detail: "For example: Nike running shoes under $150", badge: "You" },
    { title: "Agent connects to the merchant", detail: "Your agent connects to Nike's agent and shows its permission", badge: "A2A" },
    { title: "Products returned", detail: "Nike's catalog returns matching products, checked before use", badge: "UCP" },
    { title: "You select a product", detail: "Your agent asks Nike for a checkout", badge: "A2A" },
    { title: "Checkout created", detail: "Nike locks the price, tax, shipping and delivery date", badge: "UCP" },
    { title: "You approve", detail: "A signed record of the cart and of your approval", badge: "AP2" },
    { title: "Payment permission", detail: "A single-use token for this amount is sent to Nike", badge: "ACP" },
    { title: "Payment", detail: "Nike checks the token and approval, then the card is charged", badge: "PAYMENT" },
    { title: "Order confirmed", detail: "Nike confirms the order to your agent", badge: "A2A" },
  ];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <p className="text-[10px] text-center text-[var(--color-text-muted)] mb-3">High-level flow: one step per part of the purchase</p>
      <div className="flex flex-col items-stretch max-w-sm mx-auto">
        {steps.map((s, i) => (
          <div key={s.title}>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 flex items-start gap-3">
              <span className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-bold grid place-items-center">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[11px] font-semibold text-[var(--color-text)]">{s.title}</p>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)]">{s.badge}</span>
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] leading-snug">{s.detail}</p>
              </div>
            </div>
            {i < steps.length - 1 && <div className="text-center text-[var(--color-text-muted)] text-xs leading-none py-1">↓</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Narrative feed (Live tab) ──────────────────────────────────────────────────

interface NarrativeCard {
  icon: React.ReactNode;
  protocol: string;
  headline: string;
  what: string;
  highlight?: string;
  status: "progress" | "ok" | "warn" | "fail";
}

const PROTO_THEME: Record<string, { badge: string; badgeText: string; border: string; iconBg: string; iconText: string }> = {
  A2A:        { badge: "bg-blue-500",   badgeText: "text-white", border: "border-l-blue-500",   iconBg: "bg-blue-100",   iconText: "text-blue-600"   },
  UCP:        { badge: "bg-violet-500", badgeText: "text-white", border: "border-l-violet-500", iconBg: "bg-violet-100", iconText: "text-violet-600" },
  ACP:        { badge: "bg-indigo-500", badgeText: "text-white", border: "border-l-indigo-500", iconBg: "bg-indigo-100", iconText: "text-indigo-600" },
  AP2:        { badge: "bg-amber-500",  badgeText: "text-white", border: "border-l-amber-500",  iconBg: "bg-amber-100",  iconText: "text-amber-700"  },
  internal:   { badge: "bg-slate-400",  badgeText: "text-white", border: "border-l-slate-300",  iconBg: "bg-slate-100",  iconText: "text-slate-600"  },
  guardrails: { badge: "bg-rose-500",   badgeText: "text-white", border: "border-l-rose-400",   iconBg: "bg-rose-100",   iconText: "text-rose-600"   },
  REST:       { badge: "bg-teal-600",   badgeText: "text-white", border: "border-l-teal-500",   iconBg: "bg-teal-100",   iconText: "text-teal-700"   },
  UI:         { badge: "bg-slate-500",  badgeText: "text-white", border: "border-l-slate-400",  iconBg: "bg-slate-100",  iconText: "text-slate-600"  },
  TRUST:      { badge: "bg-emerald-600", badgeText: "text-white", border: "border-l-emerald-500", iconBg: "bg-emerald-100", iconText: "text-emerald-700" },
  HUMAN:      { badge: "bg-sky-600",    badgeText: "text-white", border: "border-l-sky-500",    iconBg: "bg-sky-100",    iconText: "text-sky-700"    },
  PAYMENT:    { badge: "bg-rose-600",   badgeText: "text-white", border: "border-l-rose-500",   iconBg: "bg-rose-100",   iconText: "text-rose-700"   },
  SECURITY:   { badge: "bg-amber-600",  badgeText: "text-white", border: "border-l-amber-500",  iconBg: "bg-amber-100",  iconText: "text-amber-700"  },
};

// Merchant name taken from the event itself, e.g. "NikeAgent" -> "Nike". Never hard-coded.
function merchantName(ev: ProtocolEvent): string {
  const other = ev.source.startsWith("Customer") ? ev.target : ev.source;
  const name = other.replace(/Agent$/i, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function toCard(ev: ProtocolEvent): NarrativeCard {
  const d = ev.detail ?? {};
  switch (ev.label) {
    case "input_check":
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: "progress",
        headline: "Input checks running",
        what: "Custom checks: empty input, length, profanity, malformed text, payment credential keywords." };
    case "input_validation_pass":
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: "ok",
        headline: "Security checks passed", what: "Your message passed the input checks." };
    case "input_blocked":
      return { icon: <ShieldX size={14} />, protocol: "guardrails", status: "fail",
        headline: "Blocked by custom input check",
        what: `Check that failed: ${String(d.check ?? "input")}.` };
    case "scope_pass":
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: "ok",
        headline: "Shopping request: PASS",
        what: "Your request is about shopping.",
        highlight: `Category: ${String(d.category ?? "commerce_allowed")}` };
    case "scope_blocked":
      return { icon: <ShieldX size={14} />, protocol: "guardrails", status: "fail",
        headline: "Shopping request: BLOCK",
        what: "Not a shopping request, or it asks for card details.",
        highlight: `Category: ${String(d.category ?? "")}` };
    case "scope_error":
      return { icon: <ShieldX size={14} />, protocol: "guardrails", status: "fail",
        headline: "Shopping check did not finish",
        what: "Request stopped for safety. Nothing was searched or charged." };
    case "intent_extraction":
      return { icon: <Bot size={14} />, protocol: "guardrails", status: "progress",
        headline: "Gemini extracting intent",
        what: "LLM extracts brand, category, size, color, price range from your message." };
    case "llm_error_fallback":
      return { icon: <AlertTriangle size={14} />, protocol: "guardrails", status: "warn",
        headline: "LLM fallback", what: "Gemini unavailable — regex parser used instead." };
    case "output_validation":
      return { icon: <Cpu size={14} />, protocol: "guardrails", status: "progress",
        headline: "Guardrails AI validating",
        what: "Checking Gemini output matches the ShoppingIntent schema." };
    case "schema_valid": {
      const parts = [
        d.brand && `Brand: ${d.brand}`,
        d.category && `Category: ${d.category}`,
        d.color && `Color: ${d.color}`,
        d.size && `Size: ${d.size}`,
        d.max_price && `Max: $${d.max_price}`,
      ].filter(Boolean);
      return { icon: <CheckCircle2 size={14} />, protocol: "guardrails", status: "ok",
        headline: "Request understood",
        what: "Brand, type, size and price were identified.",
        highlight: parts.length ? parts.join("  ·  ") : undefined };
    }
    case "merchant_routing": {
      const ms = (d.merchants as string[] | undefined) ?? [];
      return { icon: <ArrowRight size={14} />, protocol: "internal", status: "ok",
        headline: `Routing to ${ms.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(" & ")}`,
        what: "Shopping agent selected the most relevant merchant agents based on the intent.",
        highlight: ms.length > 1 ? `${ms.length} agents in parallel` : "1 agent" };
    }
    case "message/send": {
      const merchant = ev.target.replace(/Agent$/i, "");
      return { icon: <Zap size={14} />, protocol: "A2A", status: "progress",
        headline: `A2A → ${merchant} Agent`,
        what: `JSON-RPC 2.0 message/send to the ${merchant} agent card. The agent will query its catalog and respond.`,
        highlight: "A2A · JSON-RPC 2.0" };
    }
    case "catalog_search": {
      const merchant = String(d.merchant ?? ev.source.replace(/Agent$/i, ""));
      return { icon: <Package size={14} />, protocol: "UCP", status: "progress",
        headline: `UCP Catalog — ${merchant.charAt(0).toUpperCase() + merchant.slice(1)} searching`,
        what: "UCP Catalog capability: the merchant agent queries its product catalog for matching items.",
        highlight: `UCP · Catalog capability` };
    }
    case "catalog_results": {
      const count = Number(d.product_count ?? 0);
      const merchant = String(d.merchant ?? ev.target.replace(/Agent$/i, ""));
      return { icon: <Package size={14} />, protocol: "UCP", status: "ok",
        headline: `${merchantName(ev)} found ${count} products`,
        what: "Matching products from the merchant's catalog." };
    }
    case "task_result": {
      const count = Number(d.product_count ?? 0);
      const merchant = String(d.merchant ?? ev.source.replace(/Agent$/i, ""));
      return { icon: <Package size={14} />, protocol: "A2A", status: count > 0 ? "ok" : "warn",
        headline: "Products checked",
        what: count > 0
          ? "Each product was checked before use."
          : `${merchantName(ev)} found no matching products.` };
    }
    case "intent_mandate_signed":
      return { icon: <Lock size={14} />, protocol: "AP2", status: "ok",
        headline: "AP2 Intent Mandate signed",
        what: "AP2 mandate: you authorized this agent to shop on your behalf. First link in the authorization chain.",
        highlight: `ID: ${String(d.id ?? "").slice(0, 16)}…` };
    case "cart_mandate_signed":
      return { icon: <Lock size={14} />, protocol: "AP2", status: "ok",
        headline: "AP2 Cart Mandate signed",
        what: "AP2 mandate: exact product, price and quantity are locked. Any cart change would invalidate this mandate." };
    case "intent_mandate_verified":
    case "cart_mandate_verified":
    case "payment_mandate_verified": {
      const type = ev.label.replace("_verified", "").replace("_mandate", "").replace("_", " ");
      return { icon: <CheckCircle2 size={14} />, protocol: "AP2", status: "ok",
        headline: `AP2 ${type.charAt(0).toUpperCase() + type.slice(1)} Mandate verified ✓`,
        what: "AP2 verifier confirmed this mandate is authentic and unmodified." };
    }
    case "ap2_cart_mandate":
      return { icon: <Lock size={14} />, protocol: "AP2", status: "ok",
        headline: "AP2 cart mandate verified",
        what: "Signed by the checkout response. Bound to the checkout hash.",
        highlight: d.cart_mandate_id ? `${String(d.cart_mandate_id).slice(0, 26)}…` : undefined };
    case "ap2_payment_mandate":
      return { icon: <Lock size={14} />, protocol: "AP2", status: "ok",
        headline: "AP2 payment mandate issued",
        what: "Points at the DPAT authorization that approval created.",
        highlight: d.payment_ref ? `DPAT ${String(d.payment_ref)}` : undefined };
    case "acp_spt_issued":
      return { icon: <CreditCard size={14} />, protocol: "ACP", status: "ok",
        headline: "ACP shared payment token issued",
        what: "Derived from the DPAT authorization, with the same amount, currency and expiry.",
        highlight: d.maximum_amount_cents ? `Max $${(Number(d.maximum_amount_cents) / 100).toFixed(2)} · ${String(d.currency ?? "")}` : undefined };
    case "acp_spt_verified":
      return { icon: <CheckCircle2 size={14} />, protocol: "ACP", status: "ok",
        headline: "ACP token verified before payment",
        what: "Signature, amount, currency, expiry and seller checked." };
    case "payment_guardrails": {
      const checks = Array.isArray(d.checks) ? d.checks as Array<{ status: string }> : [];
      const failed = checks.filter((c) => c.status !== "pass").length;
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: failed ? "fail" : "ok",
        headline: failed ? "Payment guardrails blocked" : "Payment guardrails passed",
        what: "PayIt's 12 payment checks, run before the charge.",
        highlight: `${checks.length - failed}/${checks.length} checks passed` };
    }
    case "POST /checkout-sessions":
      return { icon: <Activity size={14} />, protocol: "UCP", status: "progress",
        headline: "UCP creating checkout session",
        what: `UCP Checkout: creating a session with ${d.merchant ?? "the merchant"} to lock exact totals.` };
    case "session_created": {
      const t = d.totals as Record<string, number> | undefined;
      return { icon: <CheckCircle2 size={14} />, protocol: "REST", status: "ok",
        headline: "Checkout totals",
        what: "Totals from POST /api/checkout/create, shown at payment.",
        highlight: t ? `$${t.subtotal?.toFixed(2)} + $${t.fulfillment?.toFixed(2)} ship + $${t.tax?.toFixed(2)} tax = $${t.total?.toFixed(2)}` : "Totals confirmed" };
    }
    case "order_created":
      return { icon: <Package size={14} />, protocol: "REST", status: "ok",
        headline: "Order created",
        what: `${merchantName(ev)} created your order.`,
        highlight: d.order_id ? `Order ${String(d.order_id)}` : undefined };
    case "POST /shared_payment/issued_tokens": {
      const c = d.constraints as Record<string, unknown> | undefined;
      const max = c?.maximum_amount ? `$${(Number(c.maximum_amount) / 100).toFixed(2)}` : "checkout total";
      return { icon: <CreditCard size={14} />, protocol: "ACP", status: "progress",
        headline: "ACP issuing delegated payment token",
        what: "ACP: minting a single-use token for delegated payment. Your card data never leaves your browser.",
        highlight: `Capped at ${max} · Single-use` };
    }
    case "dpat_issued":
      return { icon: <CreditCard size={14} />, protocol: "REST", status: "ok",
        headline: "GreenLight DPAT token issued",
        what: "Single-use DPAT token returned by POST /api/authorizations/approve.",
        highlight: d.token_id ? `Token ${String(d.token_id).slice(0, 14)}…` : undefined };
    case "payment_executed":
      return { icon: <CheckCircle2 size={14} />, protocol: "REST", status: d.status === "success" ? "ok" : "warn",
        headline: `Payment ${String(d.status ?? "result")}`,
        what: "Returned by POST /api/payments/execute.",
        highlight: d.order_id ? `Order ${String(d.order_id)}` : undefined };
    // ── Demo 2: agent trust ──
    case "a2a_connect":
      return { icon: <Zap size={14} />, protocol: "A2A", status: "ok",
        headline: `Customer agent connected to ${merchantName(ev)}`,
        what: `${merchantName(ev)} shared what its agent can do.`,
        highlight: Array.isArray(d.skills) ? `Skills: ${(d.skills as string[]).join(", ")}` : undefined };
    case "agent_identity_received":
      return { icon: <User size={14} />, protocol: "TRUST", status: "progress",
        headline: "Customer agent sent its credential",
        what: "Shows who the agent is and what you allowed it to do.",
        highlight: `${String(d.agent_id ?? "")} · ${String(d.talkshop_account ?? "")}` };
    case "agent_identity_verified":
      return { icon: <ShieldCheck size={14} />, protocol: "TRUST", status: "ok",
        headline: `${merchantName(ev)} verified the Customer agent`,
        what: "The agent is registered and its signature is valid." };
    case "agent_identity_failed":
      return { icon: <ShieldX size={14} />, protocol: "TRUST", status: "fail",
        headline: "Trust validation failed",
        what: `${String(d.reason ?? "The agent could not be verified")}. No catalog, checkout or payment.`,
        highlight: d.failed_check ? `Failed: ${String(d.failed_check)}` : undefined };
    case "delegation_verified":
      return { icon: <ShieldCheck size={14} />, protocol: "TRUST", status: "ok",
        headline: `${merchantName(ev)} confirmed you gave permission`,
        what: "The agent may shop for you. The merchant only sees a customer code.",
        highlight: d.customer_ref ? String(d.customer_ref) : undefined };
    case "scope_verified":
      return { icon: <ShieldCheck size={14} />, protocol: "TRUST", status: "ok",
        headline: `${merchantName(ev)} confirmed the action is allowed`,
        what: "Search, checkout and payment are within your permission.",
        highlight: Array.isArray(d.granted_scopes) ? (d.granted_scopes as string[]).join(" · ") : undefined };
    case "trusted_agent_session_created":
      return { icon: <Lock size={14} />, protocol: "TRUST", status: "ok",
        headline: `${merchantName(ev)} opened a trusted session`,
        what: d.merchant_relationship === "merchant_guest"
          ? `You are a guest at ${merchantName(ev)}.`
          : `You are a ${merchantName(ev)} member.`,
        highlight: d.trusted_session_id ? String(d.trusted_session_id) : undefined };
    case "trusted_session_verified":
      if (d.action === "checkout:create") {
        return { icon: <User size={14} />, protocol: "A2A", status: "ok",
          headline: "You selected a product",
          what: `The Customer agent sent the checkout request to ${merchantName(ev)}.` };
      }
      return { icon: <ShieldCheck size={14} />, protocol: "TRUST", status: "ok",
        headline: `Trusted session re-checked for ${String(d.action ?? "")}`,
        what: d.credential_signature_valid === true
          ? "The merchant re-verified the agent's credential, including its ECDSA cryptographic signature, before this sensitive action."
          : "The merchant re-verifies the agent's credential before each sensitive action.",
        highlight: d.credential_signature_valid === true ? "✓ Cryptographic signature verified" : undefined };
    case "trusted_session_rejected":
      return { icon: <ShieldX size={14} />, protocol: "TRUST", status: "fail",
        headline: "Merchant refused the agent",
        what: d.credential_signature_valid === false
          ? "Cryptographic authorization failed — the credential's ECDSA signature did not verify against the merchant's trusted public key."
          : String(d.reason ?? "No valid trusted session") };
    case "agent_spending_check": {
      const blocked = d.status === "blocked";
      const amount = `$${Number(d.checkout_amount ?? 0).toFixed(2)}`;
      const limit = `$${Number(d.agent_spending_limit ?? 0).toFixed(2)}`;
      const credential = String(d.payment_credential ?? "pending");
      const credLabel = credential === "tokenized"
        ? `payment credential protected/tokenized${d.payment_method_display ? ` (${d.payment_method_display})` : ""}`
        : credential === "points" ? "paid entirely with loyalty points — no card needed"
        : "awaiting secure payment entry";
      return { icon: <ShieldCheck size={14} />, protocol: "SECURITY", status: blocked ? "fail" : "ok",
        headline: blocked ? "Spending limit: blocked" : "Spending limit: passed",
        what: blocked
          ? "Amount is over the limit. Nothing charged."
          : "Amount is within the limit.",
        highlight: `${amount} of ${limit} limit` };
    }
    case "agent_spending_limit_exceeded":
      return { icon: <ShieldX size={14} />, protocol: "SECURITY", status: "fail",
        headline: "Blocked — agent spending limit exceeded",
        what: "Checked before any AP2/ACP/DPAT work ran, so nothing was signed or charged.",
        highlight: `$${Number(d.checkout_amount ?? 0).toFixed(2)} over the $${Number(d.agent_spending_limit ?? 0).toFixed(2)} limit` };
    // ── Demo 2: checkout and consent ──
    // Loyalty is a local lookup of the customer's points at Nike, not a network message.
    case "loyalty_balance":
      return { icon: <Package size={14} />, protocol: "internal", status: "ok",
        headline: `Your ${merchantName(ev)} points: ${Number(d.balance ?? 0).toLocaleString()}`,
        what: "You can choose whether to use them." };
    case "loyalty_redemption_applied":
      return { icon: <Package size={14} />, protocol: "internal", status: "ok",
        headline: "Points applied",
        what: "Points lower the amount charged to your card.",
        highlight: `${Number(d.points_redeemed ?? 0).toLocaleString()} points · −$${Number(d.value_redeemed ?? 0).toFixed(2)}` };
    case "checkout_created": {
      const t = d.totals as Record<string, number> | undefined;
      return { icon: <Package size={14} />, protocol: "A2A", status: "ok",
        headline: `${merchantName(ev)} created your checkout: ${t ? `$${t.total.toFixed(2)}` : ""}`,
        what: "Price, tax, shipping and delivery date are fixed.",
        highlight: d.delivery_date ? `Delivery ${String(d.delivery_date)}` : undefined };
    }
    case "ap2_checkout_bound":
      return { icon: <Lock size={14} />, protocol: "AP2", status: "ok",
        headline: "Cart saved for approval",
        what: "This is the exact cart you will approve." };
    case "order_proposal":
      return { icon: <Pause size={14} />, protocol: "HUMAN", status: "ok",
        headline: "Order proposal shown",
        what: "Waiting for the customer to authorize payment. Nothing is authorized yet.",
        highlight: d.payment_method ? String(d.payment_method) : undefined };
    case "customer_consent_received":
      return { icon: <User size={14} />, protocol: "HUMAN", status: "ok",
        headline: d.consent_mode === "auto_countdown" ? "Approved automatically" : "You approved the order",
        what: "Exact total and card confirmed.",
        highlight: typeof d.total === "number" ? `$${(d.total as number).toFixed(2)} · ${String(d.payment_method ?? "")}` : undefined };
    case "customer_consent_rejected":
      return { icon: <ShieldX size={14} />, protocol: "HUMAN", status: "fail",
        headline: "Approval did not match the checkout",
        what: "Nothing was authorized.", highlight: Array.isArray(d.mismatched) ? `Mismatch: ${(d.mismatched as string[]).join(", ")}` : undefined };
    case "ap2_payment_authorization":
      return { icon: <Lock size={14} />, protocol: "AP2", status: "ok",
        headline: "Approval saved",
        what: "A signed record of your approval." };
    case "ap2_evidence_verified":
      return { icon: <CheckCircle2 size={14} />, protocol: "AP2", status: "ok",
        headline: "AP2 evidence verified by the merchant", what: "Cart and payment evidence match the checkout and the token." };
    case "ap2_evidence_rejected":
      return { icon: <ShieldX size={14} />, protocol: "AP2", status: "fail",
        headline: "AP2 evidence rejected", what: "The evidence did not match this checkout." };
    case "acp_token_issued":
      return { icon: <CreditCard size={14} />, protocol: "ACP", status: "ok",
        headline: "One-time payment permission created",
        what: `For ${merchantName(ev)}, this amount only. Expires in 15 minutes. Your card details are never shared.`,
        highlight: typeof d.max_amount_cents === "number" ? `Max $${((d.max_amount_cents as number) / 100).toFixed(2)} · ${String(d.currency ?? "")}` : undefined };
    case "acp_token_verified":
      return { icon: <CheckCircle2 size={14} />, protocol: "ACP", status: "ok",
        headline: `${merchantName(ev)} checked the payment`, what: "The permission and your approval match this order." };
    case "acp_token_rejected":
      return { icon: <ShieldX size={14} />, protocol: "ACP", status: "fail",
        headline: "Payment token rejected", what: "The charge did not match the token's scope.",
        highlight: typeof d.charge_cents === "number" ? `Attempted $${((d.charge_cents as number) / 100).toFixed(2)}` : undefined };
    case "demo_tampered_charge":
      return { icon: <AlertTriangle size={14} />, protocol: "internal", status: "warn",
        headline: "Demo: charge attempt above the authorized amount",
        what: `Authorized $${String(d.authorized_total)} · attempted $${String(d.attempted_charge)}` };
    case "condition_changed":
      return { icon: <AlertTriangle size={14} />, protocol: "A2A", status: "warn",
        headline: "Merchant changed the delivery date",
        what: `${String(d.previous)} → ${String(d.new)}. Payment paused before any money moved.` };
    case "reconsent_required":
      return { icon: <Pause size={14} />, protocol: "HUMAN", status: "warn",
        headline: "Re-consent required", what: "The unused token stays unused until the customer answers." };
    case "reconsent_received":
      return { icon: <User size={14} />, protocol: "HUMAN", status: "ok",
        headline: "Customer accepted the new terms", what: "Fresh consent, bound to the updated checkout hash." };
    case "delegated_token_invalidated":
      return { icon: <ShieldX size={14} />, protocol: "ACP", status: "ok",
        headline: "Old payment token invalidated", what: "It was bound to the old terms." };
    case "checkout_cancelled":
      return { icon: <ShieldX size={14} />, protocol: "HUMAN", status: "warn",
        headline: "Checkout cancelled", what: "No payment and no order." };
    // ── Demo 2: payment and order ──
    case "internal_dpat_issued":
      return { icon: <Lock size={14} />, protocol: "PAYMENT", status: "ok",
        headline: "Internal enforcement token (DPAT)",
        what: "The verified delegated authorization is mapped to our internal single-use token. Not an industry protocol." };
    case "payment_checks": {
      const failed = Number(d.total ?? 0) - Number(d.passed ?? 0);
      return { icon: <ShieldCheck size={14} />, protocol: "PAYMENT", status: failed ? "fail" : "ok",
        headline: `${String(d.passed)}/${String(d.total)} deterministic payment checks`,
        what: "Run on the internal DPAT before the processor is allowed to charge." };
    }
    case "psp_result":
      return { icon: <CreditCard size={14} />, protocol: "PAYMENT", status: d.status === "success" ? "ok" : "fail",
        headline: d.status === "success" ? "Payment processed" : "Payment declined",
        what: "Card charged (simulated). All checks passed first.", highlight: d.payment_method ? String(d.payment_method) : undefined };
    case "payment_rejected":
      return { icon: <ShieldX size={14} />, protocol: "PAYMENT", status: "fail",
        headline: "Payment stopped", what: "No charge and no order.", highlight: `Reason: ${String(d.reason ?? "")}` };
    case "order_confirmed":
      return { icon: <CheckCircle2 size={14} />, protocol: "A2A", status: "ok",
        headline: `${merchantName(ev)} confirmed your order`,
        what: "Your order is confirmed.", highlight: d.order_id ? `Order ${String(d.order_id)}` : undefined };
    default:
      return { icon: <Activity size={14} />, protocol: ev.protocol || "internal", status: "ok",
        headline: ev.label.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        what: `${ev.source} → ${ev.target}` };
  }
}

function LiveCard({ card, index }: { card: NarrativeCard; index: number }) {
  const theme = PROTO_THEME[card.protocol] ?? PROTO_THEME.internal;
  return (
    <div
      className={`rounded-xl border border-[var(--color-border)] border-l-4 ${theme.border} bg-[var(--color-surface)] overflow-hidden`}
      style={{ animation: `fadeSlideIn 0.25s ease ${index * 0.025}s both` }}
    >
      <div className="px-3 py-2.5 flex items-start gap-2.5">
        <div className={`w-6 h-6 rounded-lg ${theme.iconBg} ${theme.iconText} flex items-center justify-center shrink-0 mt-0.5`}>
          {card.status === "progress" ? <Loader2 size={11} className="animate-spin" /> : card.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${theme.badge} ${theme.badgeText} shrink-0`}>
              {card.protocol}
            </span>
            <p className="text-[10px] font-semibold text-[var(--color-text)] leading-tight">{card.headline}</p>
          </div>
          <p className="text-[9px] text-[var(--color-text-muted)] leading-relaxed">{card.what}</p>
          {card.highlight && (
            <div className={`mt-1 inline-flex items-center text-[8px] font-mono font-medium px-1.5 py-0.5 rounded-md ${theme.iconBg} ${theme.iconText}`}>
              {card.highlight}
            </div>
          )}
        </div>
        <div className="shrink-0 mt-0.5">
          {card.status === "ok"       && <CheckCircle2 size={11} className="text-emerald-500" />}
          {card.status === "progress" && <Loader2 size={11} className="text-[var(--color-primary)] animate-spin" />}
          {card.status === "warn"     && <AlertTriangle size={11} className="text-amber-500" />}
          {card.status === "fail"     && <ShieldX size={11} className="text-rose-500" />}
        </div>
      </div>
    </div>
  );
}

function NarrativeFeed({ events }: { events: ProtocolEvent[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && followRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-5 py-10">
        <Activity size={16} className="text-[var(--color-text-muted)] opacity-30" />
        <p className="text-[10px] text-center text-[var(--color-text-muted)] opacity-50">
          Protocol events will appear here as each step executes
        </p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={() => {
        const el = listRef.current;
        if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
      className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1.5"
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {visibleLiveEvents(events).map((ev, i, shown) => {
        const card = toCard(ev);
        const settled = i < shown.length - 1;
        return <LiveRow key={i} ev={ev} card={settled && card.status === "progress" ? { ...card, status: "ok" } : card} index={i} />;
      })}
    </div>
  );
}

// ── Transaction summary strip ──────────────────────────────────────────────────

function TransactionSummary({ flowState, productTitle, productMerchant, checkoutTotal, orderLabel }: {
  flowState: FlowState;
  productTitle?: string;
  productMerchant?: string;
  checkoutTotal?: number;
  orderLabel?: string;
}) {
  if (flowState === "idle") return null;

  const steps: { label: string; done: boolean; active: boolean }[] = [
    { label: "Search",    done: !["idle","searching"].includes(flowState), active: flowState === "searching" },
    { label: "Checkout",  done: ["ordering","complete"].includes(flowState), active: ["checkout_loading","payment_ready"].includes(flowState) },
    { label: "Auth",      done: flowState === "complete", active: flowState === "ordering" },
    { label: "Order",     done: flowState === "complete", active: false },
  ];

  return (
    <div className="px-3 pt-2.5 pb-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
      {/* Product info */}
      {(productTitle || productMerchant) && (
        <div className="mb-2">
          {productMerchant && <p className="text-[9px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{productMerchant}</p>}
          {productTitle && <p className="text-[11px] font-semibold text-[var(--color-text)] truncate">{productTitle}</p>}
          {checkoutTotal && <p className="text-[11px] font-bold text-[var(--color-primary)] mt-0.5">${checkoutTotal.toFixed(2)}</p>}
          {orderLabel && <p className="text-[9px] text-emerald-600 font-medium mt-0.5">{orderLabel}</p>}
        </div>
      )}
      {/* Mini timeline */}
      <div className="flex items-center gap-1">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-1 flex-1">
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold transition-colors duration-300 ${
              step.done   ? "bg-emerald-100 text-emerald-700" :
              step.active ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]" :
              "text-[var(--color-text-muted)] opacity-40"
            }`}>
              {step.done && <CheckCircle2 size={8} />}
              {step.active && <Loader2 size={8} className="animate-spin" />}
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px ${step.done ? "bg-emerald-300" : "bg-[var(--color-border)]"}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Story view: the business flow in fixed rows (default view) ────────────────

type RowStatus = "upcoming" | "ok" | "fail" | "paused";

interface StoryRow {
  key: string;
  title: string;
  status: RowStatus;
  lines: string[];
  events: ProtocolEvent[];
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const money = (n: unknown) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

function buildStory(all: ProtocolEvent[]): StoryRow[] {
  // Only the current request: everything since the last time input checks started.
  let start = 0;
  all.forEach((e, i) => { if (e.label === "input_check") start = i; });
  const ev = all.slice(start);
  const find = (...labels: string[]) => ev.filter((e) => labels.includes(e.label));
  const last = (...labels: string[]) => { const f = find(...labels); return f.length ? f[f.length - 1] : undefined; };

  const routing = last("merchant_routing");
  const merchant = cap(((routing?.detail.merchants as string[] | undefined) ?? [])[0] ?? "Merchant");

  const rows: StoryRow[] = [];
  const add = (key: string, title: string, status: RowStatus, lines: string[], events: ProtocolEvent[]) =>
    rows.push({ key, title, status, lines, events });

  // 1. Your request
  const requestFail = last("input_blocked", "scope_blocked", "scope_error");
  const requestOk = last("input_validation_pass", "scope_pass");
  add("request", "Your request", requestFail ? "fail" : requestOk ? "ok" : "upcoming",
    requestFail ? ["Stopped by a safety check"] : requestOk ? ["Safe and about shopping"] : [],
    find("input_check", "input_validation_pass", "input_blocked", "scope_pass", "scope_blocked", "scope_error"));

  // 2. Understood
  const schema = last("schema_valid");
  const intent = (schema?.detail.intent ?? {}) as Record<string, unknown>;
  const understood = find("intent_extraction", "schema_valid");
  const described = [intent.brand, String(intent.category ?? "").replace(/_/g, " ")].filter(Boolean).join(" ");
  add("understood", "Understood", understood.length ? "ok" : "upcoming",
    understood.length ? [described || "Product request identified"] : [], understood);

  // 3. Merchant
  add("merchant", "Merchant", routing ? "ok" : "upcoming",
    routing ? [`${merchant} selected`] : [], find("merchant_routing"));

  // 4. Trust
  const session = last("trusted_agent_session_created");
  const trustFail = last("agent_identity_failed");
  add("trust", "Trust", trustFail ? "fail" : session ? "ok" : "upcoming",
    trustFail ? [`${merchant} could not verify your agent`]
      : session ? [`${merchant} verified your agent and your permission`,
          session.detail.merchant_relationship === "merchant_guest" ? "You are a guest" : "You are a member"]
      : [],
    find("a2a_connect", "agent_identity_received", "agent_identity_verified", "agent_identity_failed",
         "delegation_verified", "scope_verified", "trusted_agent_session_created"));

  // 5. Products
  const catalog = last("catalog_results");
  add("products", "Products", catalog ? "ok" : "upcoming",
    catalog ? [`${merchant} found ${catalog.detail.product_count} products`, "Each product checked before use"] : [],
    find("catalog_search", "catalog_results", "boundary_check", "task_result"));

  // 6. Checkout
  const checkout = last("checkout_created");
  const totals = (checkout?.detail.totals ?? {}) as Record<string, number>;
  const spend = last("agent_spending_check", "agent_spending_limit_exceeded");
  const pointsEv = last("loyalty_redemption_applied", "loyalty_choice_applied");
  const pts = Number(pointsEv?.detail.points_redeemed ?? 0);
  const overLimit = spend?.label === "agent_spending_limit_exceeded" || spend?.detail.status === "blocked";
  add("checkout", "Checkout", checkout ? "ok" : "upcoming",
    checkout ? [
      `${merchant} created your checkout: ${money(totals.total)}`,
      pts > 0 ? `${pts.toLocaleString()} points applied` : "",
      spend ? (overLimit ? "Over the spending limit" : "Within the spending limit") : "",
    ].filter(Boolean) : [],
    find("trusted_session_verified", "loyalty_balance", "loyalty_redemption_applied", "loyalty_choice_applied",
         "checkout_created", "agent_spending_check", "agent_spending_limit_exceeded"));

  // 7. Approval
  const approved = last("customer_consent_received");
  const approvalFail = last("customer_consent_rejected");
  const approvalRecord = last("ap2_payment_authorization");
  add("approval", "Your approval", approvalFail ? "fail" : approved ? "ok" : checkout ? "paused" : "upcoming",
    approvalFail ? ["Approval did not match the checkout"]
      : approved ? ["You approved the order", approvalRecord ? "Approval saved" : ""].filter(Boolean)
      : checkout ? ["Waiting for you to approve"] : [],
    find("ap2_checkout_bound", "customer_consent_received", "customer_consent_rejected", "ap2_payment_authorization"));

  // 8. Payment
  const token = last("acp_token_issued");
  const psp = last("psp_result");
  const pointsOnly = last("loyalty_settlement");
  const paymentFail = last("payment_rejected", "acp_token_rejected", "ap2_evidence_rejected");
  const paid = psp?.detail.status === "success";
  const paymentLines = paymentFail ? ["Payment stopped", "Nothing charged"]
    : pointsOnly ? ["Paid with points, no card charge"]
    : [
        token ? "One-time payment permission created" : "",
        last("acp_token_verified") ? `${merchant} checked the permission and your approval` : "",
        paid ? "Card charged" : "",
      ].filter(Boolean);
  add("payment", "Payment", paymentFail ? "fail" : paid || pointsOnly ? "ok" : approved ? "paused" : "upcoming",
    paymentLines,
    find("acp_token_issued", "acp_token_verified", "acp_token_rejected", "ap2_evidence_verified", "ap2_evidence_rejected",
         "payment_checks", "psp_result", "payment_rejected", "loyalty_settlement"));

  // 9. Order
  const order = last("order_created");
  const confirmed = last("order_confirmed");
  add("order", "Order", order ? "ok" : "upcoming",
    confirmed ? [`${merchant} confirmed your order`, `Order ${String(order?.detail.order_id ?? "")}`]
      : order ? [`${merchant} created your order`] : [],
    find("order_created", "order_confirmed"));

  return rows;
}

function StoryRowView({ row }: { row: StoryRow }) {
  const [open, setOpen] = useState(false);
  const tone = row.status === "ok" ? "border-l-emerald-500" : row.status === "fail" ? "border-l-rose-500"
    : row.status === "paused" ? "border-l-amber-500" : "border-l-[var(--color-border)] opacity-50";
  return (
    <div className={`rounded-lg border border-[var(--color-border)] border-l-4 ${tone} bg-[var(--color-surface)] px-3 py-2`}>
      <div className="flex items-start gap-2">
        <span className="w-20 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] pt-0.5">{row.title}</span>
        <div className="flex-1 min-w-0">
          {row.lines.length ? row.lines.map((l, i) => (
            <p key={i} className={`text-[10px] leading-snug ${i === 0 ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>{l}</p>
          )) : <p className="text-[10px] text-[var(--color-text-muted)]">—</p>}
        </div>
        {row.events.length > 0 && (
          <button onClick={() => setOpen((o) => !o)} className="text-[9px] text-[var(--color-primary)] hover:underline shrink-0">
            {open ? "Hide" : "View details"}
          </button>
        )}
      </div>
      {open && row.events.map((e, i) => <EventDetail key={i} ev={e} />)}
    </div>
  );
}

function StoryView({ events }: { events: ProtocolEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-5 py-10">
        <Activity size={16} className="text-[var(--color-text-muted)] opacity-30" />
        <p className="text-[10px] text-center text-[var(--color-text-muted)] opacity-50">The purchase story appears here as each step runs</p>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1.5">
      {buildStory(events).map((row) => <StoryRowView key={row.key} row={row} />)}
      <p className="text-[9px] text-[var(--color-text-muted)] pt-1 leading-relaxed">
        Protocol-style POC: A2A-style agent messages (in-process), UCP-style catalog and checkout, AP2-style authorization
        evidence, ACP-style scoped token. DPAT is internal enforcement, not an industry protocol. No card data is ever shown here.
      </p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

// ── Stage and event details ───────────────────────────────────────────────────

const STAGE_TITLE: Record<string, string> = {
  a2a: "A2A — merchant agents",
  catalog: "UCP Catalog",
  checkout: "UCP Checkout",
  authz: "AP2 — authorization evidence",
  acp: "ACP — scoped payment token",
  payment: "Payment",
  order: "Order",
};

function stageOf(ev: ProtocolEvent): string | null {
  if (ev.protocol === "A2A") return "a2a";
  if (ev.protocol === "UCP" && (ev.label === "catalog_search" || ev.label === "catalog_results")) return "catalog";
  if (["session_created", "ap2_cart_mandate", "checkout_created", "ap2_checkout_bound", "order_proposal"].includes(ev.label)) return "checkout";
  if (["ap2_payment_mandate", "dpat_issued", "customer_consent_received", "ap2_payment_authorization", "ap2_evidence_verified"].includes(ev.label)) return "authz";
  if (["acp_spt_issued", "acp_spt_verified", "acp_token_issued", "acp_token_verified", "acp_token_rejected"].includes(ev.label)) return "acp";
  if (["payment_guardrails", "payment_executed", "internal_dpat_issued", "payment_checks", "psp_result", "payment_rejected"].includes(ev.label)) return "payment";
  if (ev.label === "order_created" || ev.label === "order_confirmed") return "order";
  return null;
}

type CheckResult = { check: string; status: string; reason?: string | null };

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-[10px]">
      <span className="w-28 shrink-0 text-[var(--color-text-muted)]">{k}</span>
      <span className="text-[var(--color-text)] break-all">{v}</span>
    </div>
  );
}

function GuardrailChecks({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="space-y-1">
      {checks.map((c, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[10px]">
          {c.status === "pass"
            ? <CheckCircle2 size={10} className="text-emerald-500 mt-0.5 shrink-0" />
            : <ShieldX size={10} className="text-rose-500 mt-0.5 shrink-0" />}
          <span className="text-[var(--color-text)]">{c.check}</span>
          <span className="text-[var(--color-text-muted)]">
            {c.status === "pass" ? "PASS" : "BLOCKED"}{c.reason ? `: ${c.reason}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function durationText(value: unknown): string {
  if (typeof value !== "number") return "Not measured";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function EventDetail({ ev }: { ev: ProtocolEvent }) {
  const d = ev.detail ?? {};
  const endpoint = typeof d.endpoint === "string" ? d.endpoint : null;
  const checks = Array.isArray(d.checks) ? (d.checks as CheckResult[]) : null;
  const when = new Date(ev.ts);
  const inProcess = ev.protocol === "A2A" || ev.protocol === "UCP";
  return (
    <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
      <Field k="Event" v={ev.label} />
      <Field k="Sender → receiver" v={`${ev.source} → ${ev.target}`} />
      <Field k="Protocol" v={ev.protocol} />
      {(endpoint || inProcess) && (
        <Field k="Call" v={endpoint ?? "In-process call (not a network request)"} />
      )}
      <Field k="Timestamp" v={isNaN(when.getTime()) ? "Not recorded" : when.toLocaleTimeString()} />
      {typeof d.duration_ms === "number" && <Field k="Duration" v={durationText(d.duration_ms)} />}
      <p className="text-[9px] text-[var(--color-text-muted)] pt-1">
        Separate request and response payloads aren't captured for this event. The data below is what was recorded when it fired.
      </p>
      {checks && <GuardrailChecks checks={checks} />}
      <pre className="text-[9px] bg-[var(--color-surface-2)] rounded-lg p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
        {Object.keys(d).length > 0 ? JSON.stringify(d, null, 2) : "No data captured for this event."}
      </pre>
    </div>
  );
}

function StageDetail({ stage, events }: { stage: string; events: ProtocolEvent[] }) {
  const stageEvents = events.filter((e) => stageOf(e) === stage);
  const guardChecks = stageEvents.flatMap((e) => (Array.isArray(e.detail?.checks) ? (e.detail.checks as CheckResult[]) : []));
  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-3">
      <p className="text-[11px] font-bold text-[var(--color-text)]">{STAGE_TITLE[stage]}</p>
      {stageEvents.length === 0 ? (
        <p className="text-[10px] text-[var(--color-text-muted)]">No real events recorded for this stage yet.</p>
      ) : (
        stageEvents.map((ev, i) => (
          <div key={i}>
            <EventDetail ev={ev} />
          </div>
        ))
      )}
      <div>
        <p className="text-[10px] font-semibold text-[var(--color-text)] mb-1">Guardrails at this stage</p>
        {guardChecks.length === 0 ? (
          <p className="text-[10px] text-[var(--color-text-muted)]">No guardrail checks ran at this stage.</p>
        ) : (
          <GuardrailChecks checks={guardChecks} />
        )}
      </div>
    </div>
  );
}

// Live view only: demo-only, progress and redundant cards are hidden for the client demo.
// Story and Flow still read the full event list. Failure cards are never hidden here.
const LIVE_HIDDEN_LABELS = new Set<string>([
  // demo-only scenarios (delivery change, tampered charge, bad credential)
  "agent_identity_failed", "demo_tampered_charge", "acp_token_rejected", "condition_changed",
  "reconsent_required", "reconsent_received", "delegated_token_invalidated", "checkout_cancelled",
  // progress cards that are superseded by their result card
  "input_check", "intent_extraction", "message/send", "catalog_search",
  // redundant or internal: the single "Products checked" card replaces the boundary check
  "agent_identity_received", "internal_dpat_issued", "boundary_check",
  // merged into the approval and payment cards, so one AP2 card and no separate 12/12 card
  "payment_checks", "ap2_evidence_verified",
  // the checkout card and the approval card already say the checkout is waiting for you
  "order_proposal",
]);

// Repeated on every points-slider move: show only the latest state.
const LIVE_LATEST_ONLY_LABELS = new Set<string>(["loyalty_choice_applied", "agent_spending_check", "ap2_checkout_bound"]);

function visibleLiveEvents(events: ProtocolEvent[]): ProtocolEvent[] {
  const lastIndex = new Map<string, number>();
  events.forEach((ev, i) => {
    if (LIVE_LATEST_ONLY_LABELS.has(ev.label)) lastIndex.set(ev.label, i);
  });
  // The redemption card is stale once the customer has changed the points choice.
  const pointsChanged = events.some((ev) => ev.label === "loyalty_choice_applied");
  return events.filter((ev, i) => {
    if (LIVE_HIDDEN_LABELS.has(ev.label)) return false;
    if (ev.label === "loyalty_redemption_applied" && pointsChanged) return false;
    // the merchant's payment re-check is folded into "Nike verified the token and your approval"
    if (ev.label === "trusted_session_verified" && ev.detail?.action === "payment:execute") return false;
    if (LIVE_LATEST_ONLY_LABELS.has(ev.label)) return lastIndex.get(ev.label) === i;
    return true;
  });
}

function LiveRow({ ev, card, index }: { ev: ProtocolEvent; card: NarrativeCard; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div onClick={() => setOpen((o) => !o)} className="cursor-pointer">
        <LiveCard card={card} index={index} />
      </div>
      {open && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pb-3">
          <EventDetail ev={ev} />
        </div>
      )}
    </div>
  );
}

export default function ProtocolTracePanel({
  events, flowState = "idle",
  productTitle, productMerchant, checkoutTotal, orderLabel,
}: Props) {
  const [tab, setTab] = useState<"story" | "flow" | "live">("live");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Transaction summary */}
      <TransactionSummary
        flowState={flowState}
        productTitle={productTitle}
        productMerchant={productMerchant}
        checkoutTotal={checkoutTotal}
        orderLabel={orderLabel}
      />

      {/* Header + tabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
        <div className="flex items-center gap-1.5">
          <Activity size={11} className="text-[var(--color-primary)]" />
          <span className="text-[10px] font-bold text-[var(--color-text)]">Agent Activity</span>
          {events.length > 0 && (
            <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)]">
              {events.length}
            </span>
          )}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)] shadow-card text-[9px] font-bold">
          {(["live", "story", "flow"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                tab === t ? "bg-gradient-to-b from-[var(--color-primary-light)] to-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {t === "flow" ? <GitBranch size={8} /> : t === "story" ? <ShieldCheck size={8} /> : <Activity size={8} />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === "story" ? (
        <StoryView events={events} />
      ) : tab === "flow" ? (
        <FlowView
          events={events}
          flowState={flowState}
          checkoutTotal={checkoutTotal}
          orderLabel={orderLabel}
          selectedStage={selectedStage}
          onSelectStage={(stage) => setSelectedStage((cur) => (cur === stage ? null : stage))}
        />
      ) : (
        <NarrativeFeed events={events} />
      )}
    </div>
  );
}
