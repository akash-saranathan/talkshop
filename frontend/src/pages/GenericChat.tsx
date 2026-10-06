import { Bot } from "lucide-react";

// Full implementation in Phase 3.
// This placeholder confirms routing works and auth guard is in place.
export default function GenericChat() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
        <Bot size={40} className="text-[var(--color-primary)]" />
        <p className="text-sm font-medium">Generic Shopping Agent</p>
        <p className="text-xs">Phase 3 — coming soon</p>
      </div>
    </div>
  );
}
