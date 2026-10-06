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
  const hasUCPCreated   = events.some(e => e.label === "session_created");
  const hasAllMandates  = events.some(e => e.label === "auth_ui_complete");
  const hasACPIssued    = events.some(e => e.label === "dpat_issued");
  const hasACPVerified  = events.some(e => e.label === "payment_executed");

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

function FlowView({ events, flowState, checkoutTotal, orderLabel, selectedStage, onSelectStage }: {
  events: ProtocolEvent[];
  flowState: FlowState;
  checkoutTotal?: number;
  orderLabel?: string;
  selectedStage: string | null;
  onSelectStage: (stage: string) => void;
}) {
  const pick = (stage: string) => ({ onClick: () => onSelectStage(stage), selected: selectedStage === stage });
  const merchantNames = [...new Set(
    events
      .filter(e => e.protocol === "A2A" && e.label === "message/send")
      .map(e => e.target.replace(/Agent$/i, "").trim())
  )];
  const merchantLabel = merchantNames.length > 0
    ? merchantNames.join(" · ")
    : "Merchant Agent";

  const checkoutSubtitle = checkoutTotal
    ? `$${checkoutTotal.toFixed(2)} · tax + shipping locked`
    : "Cart · Tax · Shipping · Totals";

  const orderSubtitle = orderLabel ?? "Order created";

  const productCount = (() => {
    const counts = events
      .filter(e => e.label === "task_result")
      .map(e => Number(e.detail?.product_count ?? 0));
    const total = counts.reduce((a, b) => a + b, 0);
    return total > 0 ? `${total} products found` : "Search results";
  })();

  const s = (id: string) => getStatus(id, flowState, events);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="flex flex-col items-stretch">

        {/* USER */}
        <NodeBox label="You" subtitle="Shopping request" status={s("user")} icon={User} />

        {/* A2A → Merchant */}
        <ArrowConnector protocol="A2A" label="Agent Communication" status={s("arr-a2a")} />
        <NodeBox label={merchantLabel} subtitle="Receives search request" simulated status={s("merchant")} icon={Store} {...pick("a2a")} />

        {/* UCP Catalog → Products */}
        <ArrowConnector protocol="UCP" label="Catalog" status={s("arr-ucp-cat")} />
        <NodeBox label="Product Catalog" subtitle={productCount} status={s("products")} icon={Package} {...pick("catalog")} />

        {/* Pause: product selection */}
        <PauseMarker label="You select a product" status={s("pause-sel")} />

        {/* UCP Checkout → Checkout */}
        <ArrowConnector protocol="UCP" label="Checkout" status={s("arr-ucp-co")} />
        <NodeBox label="Checkout Session" subtitle={checkoutSubtitle} status={s("checkout")} icon={ShieldCheck} {...pick("checkout")} />

        {/* Pause: approve & pay */}
        <PauseMarker label="You review & approve payment" status={s("pause-pay")} />

        {/* AP2 → Authorization */}
        <ArrowConnector protocol="AP2" label="Authorization" status={s("arr-ap2")} />
        <NodeBox label="Payment Authorization" subtitle="Approval in UI (browser step)" status={s("authz")} icon={Lock} {...pick("authz")} />

        {/* ACP → Delegated Payment */}
        <ArrowConnector protocol="ACP" label="Delegated Payment" status={s("arr-acp")} />
        <NodeBox label="Delegated Payment" subtitle="GreenLight DPAT token (REST)" status={s("delpay")} icon={CreditCard} {...pick("acp")} />

        {/* → PSP */}
        <ArrowConnector protocol={null} label={null} status={s("arr-psp")} />
        <NodeBox label="PSP" subtitle="Payment execution (REST)" simulated status={s("psp")} icon={Zap} {...pick("payment")} />

        {/* → Order */}
        <ArrowConnector protocol={null} label={null} status={s("arr-order")} />
        <NodeBox label="Order" subtitle={orderLabel ? orderSubtitle : "Confirmed"} status={s("order")} icon={CheckCircle2} {...pick("order")} />

      </div>
      {selectedStage && <StageDetail stage={selectedStage} events={events} />}
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
};

function toCard(ev: ProtocolEvent): NarrativeCard {
  const d = ev.detail ?? {};
  switch (ev.label) {
    case "input_check":
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: "progress",
        headline: "Input checks running",
        what: "Custom checks: empty input, length, profanity, malformed text, payment credential keywords." };
    case "input_validation_pass":
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: "ok",
        headline: "Custom input checks passed ✓", what: "Every custom input check ran and passed." };
    case "input_blocked":
      return { icon: <ShieldX size={14} />, protocol: "guardrails", status: "fail",
        headline: "Blocked by custom input check",
        what: `Check that failed: ${String(d.check ?? "input")}.` };
    case "nemo_pass":
      return { icon: <ShieldCheck size={14} />, protocol: "guardrails", status: "ok",
        headline: "NeMo Guardrails · Commerce Scope: PASS",
        what: "Policy evaluated by NeMo Guardrails. Classification engine: Gemini.",
        highlight: `Category: ${String(d.category ?? "commerce_allowed")}` };
    case "nemo_blocked":
      return { icon: <ShieldX size={14} />, protocol: "guardrails", status: "fail",
        headline: "NeMo Guardrails · Commerce Scope: BLOCK",
        what: "Policy evaluated by NeMo Guardrails. Classification engine: Gemini.",
        highlight: `Category: ${String(d.category ?? "")}` };
    case "nemo_unavailable":
      return { icon: <AlertTriangle size={14} />, protocol: "guardrails", status: "warn",
        headline: "NeMo Guardrails not executed",
        what: "NeMo was unavailable, so only the custom input checks ran." };
    case "nemo_error":
      return { icon: <AlertTriangle size={14} />, protocol: "guardrails", status: "warn",
        headline: "NeMo Guardrails error",
        what: "NeMo raised an error, so the semantic check did not complete." };
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
        headline: "Intent validated",
        what: "Guardrails AI confirmed the structured intent. Merchant agents will be queried.",
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
        headline: `UCP Catalog returned ${count} products`,
        what: `${merchant.charAt(0).toUpperCase() + merchant.slice(1)}'s UCP Catalog responded with ${count} matching product${count !== 1 ? "s" : ""}.` };
    }
    case "task_result": {
      const count = Number(d.product_count ?? 0);
      const merchant = String(d.merchant ?? ev.source.replace(/Agent$/i, ""));
      return { icon: <Package size={14} />, protocol: "A2A", status: count > 0 ? "ok" : "warn",
        headline: `A2A ← ${merchant.charAt(0).toUpperCase() + merchant.slice(1)}: ${count} products`,
        what: count > 0
          ? `A2A task result received. ${merchant.charAt(0).toUpperCase() + merchant.slice(1)} agent returned ${count} products.`
          : `${merchant} agent found no matching products.` };
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
    case "auth_ui_complete":
      return { icon: <Lock size={14} />, protocol: "UI", status: "ok",
        headline: "Approval confirmed in the UI",
        what: "Browser step. No AP2 message was exchanged." };
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
        headline: "Order recorded",
        what: "Order returned by POST /api/payments/execute.",
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
      {events.map((ev, i) => {
        const card = toCard(ev);
        const settled = i < events.length - 1;
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

// ── Main component ─────────────────────────────────────────────────────────────

// ── Stage and event details ───────────────────────────────────────────────────

const STAGE_TITLE: Record<string, string> = {
  a2a: "A2A — merchant agents",
  catalog: "UCP Catalog",
  checkout: "UCP Checkout",
  authz: "AP2 — approval (browser step)",
  acp: "ACP — delegated payment (DPAT)",
  payment: "Payment",
  order: "Order",
};

function stageOf(ev: ProtocolEvent): string | null {
  if (ev.protocol === "A2A") return "a2a";
  if (ev.protocol === "UCP" && (ev.label === "catalog_search" || ev.label === "catalog_results")) return "catalog";
  if (ev.label === "session_created") return "checkout";
  if (ev.label === "auth_ui_complete") return "authz";
  if (ev.label === "dpat_issued") return "acp";
  if (ev.label === "payment_executed") return "payment";
  if (ev.label === "order_created") return "order";
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
        {stage === "payment" ? (
          <p className="text-[10px] text-[var(--color-text-muted)]">Payment guardrail results aren't returned to the browser yet.</p>
        ) : guardChecks.length === 0 ? (
          <p className="text-[10px] text-[var(--color-text-muted)]">No guardrail checks ran at this stage.</p>
        ) : (
          <GuardrailChecks checks={guardChecks} />
        )}
      </div>
    </div>
  );
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
  const [tab, setTab] = useState<"flow" | "live">("live");
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
        <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)] text-[9px] font-bold">
          {(["flow", "live"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                tab === t ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {t === "flow" ? <GitBranch size={8} /> : <Activity size={8} />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === "flow" ? (
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
