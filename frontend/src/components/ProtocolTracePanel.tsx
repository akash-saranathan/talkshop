/**
 * ProtocolTracePanel — right-column live trace of every protocol message.
 *
 * Protocol color coding:
 *   A2A      blue    — agent-to-agent communication envelope
 *   UCP      violet  — commerce capabilities (checkout sessions)
 *   ACP      indigo  — shared payment token issuance
 *   AP2      amber   — verifiable credential mandates
 *   internal slate   — internal routing / merchant registry
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Activity } from "lucide-react";

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

interface Props {
  events: ProtocolEvent[];
}

const PROTOCOL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  A2A:      { bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500"   },
  UCP:      { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500" },
  ACP:      { bg: "bg-indigo-100", text: "text-indigo-700", dot: "bg-indigo-500" },
  AP2:      { bg: "bg-amber-100",  text: "text-amber-700",  dot: "bg-amber-500"  },
  internal: { bg: "bg-slate-100",  text: "text-slate-600",  dot: "bg-slate-400"  },
};

function AgentInteractionCard({ event, index }: { event: ProtocolEvent; index: number }) {
  const [open, setOpen] = useState(false);
  const colors = PROTOCOL_COLORS[event.protocol] ?? PROTOCOL_COLORS.internal;
  const hasDetail = Object.keys(event.detail ?? {}).length > 0;
  const ts = new Date(event.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-[var(--color-surface-2)] transition-colors ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
      >
        {/* Protocol badge */}
        <span className={`mt-0.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
          {event.protocol}
        </span>

        {/* Main row */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-[var(--color-text)] truncate max-w-[70px]" title={event.source}>
              {event.source.replace("Agent", "").replace("Adapter", "").replace("GenericShopping", "Agent")}
            </span>
            <span className="text-[var(--color-text-muted)] shrink-0">{event.direction}</span>
            <span className="text-[var(--color-text-muted)] truncate max-w-[70px]" title={event.target}>
              {event.target.replace("Agent", "").replace("Adapter", "").replace("GenericShopping", "Agent")}
            </span>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">{event.label}</p>
        </div>

        {/* Right: timestamp + expand */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <span className="text-[10px] text-[var(--color-text-muted)]">{ts}</span>
          {hasDetail && (
            open ? <ChevronDown size={12} className="text-[var(--color-text-muted)]" />
                 : <ChevronRight size={12} className="text-[var(--color-text-muted)]" />
          )}
        </div>
      </button>

      {/* Detail JSON */}
      {open && hasDetail && (
        <pre className="px-3 pb-2.5 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)] overflow-x-auto leading-relaxed">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function ProtocolTracePanel({ events }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)] shrink-0">
        <Activity size={14} className="text-[var(--color-primary)]" />
        <span className="text-xs font-semibold text-[var(--color-text)]">Protocol Trace</span>
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded-full">
          {events.length}
        </span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-2 gap-y-1 px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        {Object.entries(PROTOCOL_COLORS).map(([proto, c]) => (
          <span key={proto} className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
            {proto}
          </span>
        ))}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--color-text-muted)] gap-1">
            <Activity size={20} strokeWidth={1.5} />
            <p className="text-xs">Waiting for protocol events…</p>
          </div>
        ) : (
          events.map((ev, i) => <AgentInteractionCard key={i} event={ev} index={i} />)
        )}
      </div>
    </div>
  );
}
