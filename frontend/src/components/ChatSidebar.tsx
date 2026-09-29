import { useEffect, useState } from "react";
import { Plus, MessageSquare } from "lucide-react";
import { listChatSessions, type ChatSessionSummary } from "../api/chat";

interface Props {
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  refreshKey: number;
}

export default function ChatSidebar({ activeSessionId, onSelectSession, onNewChat, refreshKey }: Props) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);

  useEffect(() => {
    listChatSessions().then(setSessions).catch(() => setSessions([]));
  }, [refreshKey]);

  return (
    <aside className="w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2 overflow-y-auto shrink-0">
      <button
        onClick={onNewChat}
        className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] font-medium mb-2 transition-colors"
      >
        <Plus size={15} /> New Chat
      </button>

      <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1 px-1">
        Chats
      </span>

      {sessions.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] px-2 py-4 text-center">
          No conversations yet
        </p>
      ) : (
        sessions.map((s) => (
          <button
            key={s.session_id}
            onClick={() => onSelectSession(s.session_id)}
            title={s.title}
            className={`flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg truncate transition-colors ${
              s.session_id === activeSessionId
                ? "bg-[var(--color-primary)] text-white font-medium"
                : "text-[var(--color-text)] hover:bg-[var(--color-bg)]"
            }`}
          >
            <MessageSquare size={14} className="shrink-0" />
            <span className="truncate">{s.title}</span>
          </button>
        ))
      )}
    </aside>
  );
}
