import { useEffect, useState } from "react";
import { Plus, MessageSquare, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { listChatSessions, deleteChatSession, type ChatSessionSummary } from "../api/chat";

interface Props {
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onSessionDeleted: (sessionId: string) => void;
  refreshKey: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
}

export default function ChatSidebar({
  activeSessionId,
  onSelectSession,
  onNewChat,
  onSessionDeleted,
  refreshKey,
  collapsed,
  onToggleCollapse,
  width,
}: Props) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listChatSessions().then(setSessions).catch(() => setSessions([]));
  }, [refreshKey]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(sessionId);
    try {
      await deleteChatSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      onSessionDeleted(sessionId);
    } catch {
      // silent
    } finally {
      setDeletingId(null);
    }
  };

  if (collapsed) {
    return (
      <aside className="w-12 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center py-4 gap-4 shrink-0">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expand chats"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          title="New Chat"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <Plus size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2 overflow-y-auto shrink-0"
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex-1 flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] font-medium transition-colors"
        >
          <Plus size={15} /> New Chat
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse"
          className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-bg)] transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1 px-1">
        Chats
      </span>

      {sessions.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] px-2 py-4 text-center">
          No conversations yet
        </p>
      ) : (
        sessions.map((s) => (
          <div
            key={s.session_id}
            className={`group flex items-center gap-1 rounded-lg transition-colors ${
              s.session_id === activeSessionId
                ? "bg-[var(--color-primary)]"
                : "hover:bg-[var(--color-bg)]"
            }`}
          >
            <button
              onClick={() => onSelectSession(s.session_id)}
              title={s.title}
              className={`flex items-center gap-2 text-left text-sm px-3 py-2 truncate flex-1 min-w-0 ${
                s.session_id === activeSessionId
                  ? "text-white font-medium"
                  : "text-[var(--color-text)]"
              }`}
            >
              <MessageSquare size={14} className="shrink-0" />
              <span className="truncate">{s.title}</span>
            </button>
            <button
              onClick={(e) => handleDelete(e, s.session_id)}
              disabled={deletingId === s.session_id}
              title="Delete chat"
              className={`shrink-0 p-1.5 mr-1 rounded opacity-0 group-hover:opacity-100 transition-all ${
                s.session_id === activeSessionId
                  ? "text-white/60 hover:text-white hover:bg-white/10"
                  : "text-[var(--color-text-muted)] hover:text-rose-500 hover:bg-rose-50"
              } disabled:opacity-30`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}
    </aside>
  );
}
