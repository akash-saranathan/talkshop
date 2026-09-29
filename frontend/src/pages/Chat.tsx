import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, MicOff, Store, LogOut } from "lucide-react";
import { streamChat, type AgentEvent, type ProductData } from "../api/chat";
import ProductCard from "../components/ProductCard";
import { useAuth } from "../auth/AuthContext";

interface Step {
  id: string;
  message: string;
  status: "running" | "done" | "error";
}

interface Turn {
  id: string;
  userMessage: string;
  steps: Step[];
  products: ProductData[];
  recommendation: string;
  blocked: string | null;
}

export default function Chat() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const sessionId = useRef(crypto.randomUUID());
  const closeStream = useRef<(() => void) | null>(null);
  const activeTurnId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Cleanup SSE on unmount
  useEffect(() => () => { closeStream.current?.(); }, []);

  // Auto-scroll to the newest turn, matching standard chat UX.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const updateActiveTurn = useCallback((updater: (turn: Turn) => Turn) => {
    const id = activeTurnId.current;
    if (!id) return;
    setTurns((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  }, []);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || loading) return;

    const turnId = crypto.randomUUID();
    activeTurnId.current = turnId;
    setTurns((prev) => [...prev, {
      id: turnId,
      userMessage: msg,
      steps: [],
      products: [],
      recommendation: "",
      blocked: null,
    }]);
    setLoading(true);
    setInput("");

    // Close any existing stream
    closeStream.current?.();

    const close = streamChat(msg, sessionId.current, {
      onStep: (event: AgentEvent) => {
        updateActiveTurn((turn) => {
          const prevSteps = turn.steps;
          if (event.type === "step_start") {
            if (prevSteps.find((s) => s.message === event.message)) return turn;
            return { ...turn, steps: [...prevSteps, { id: event.ts, message: event.message, status: "running" }] };
          }
          if (event.type === "step_done") {
            const idx = [...prevSteps].reverse().findIndex((s: Step) => s.status === "running");
            const actualIdx = idx >= 0 ? prevSteps.length - 1 - idx : -1;
            if (actualIdx >= 0) {
              const updated = [...prevSteps];
              updated[actualIdx] = { ...updated[actualIdx], message: event.message, status: "done" };
              return { ...turn, steps: updated };
            }
            return { ...turn, steps: [...prevSteps, { id: event.ts, message: event.message, status: "done" }] };
          }
          return turn;
        });
      },
      onRecommendation: (text, prods) => {
        updateActiveTurn((turn) => ({ ...turn, recommendation: text, products: prods }));
      },
      onBlocked: (message) => {
        updateActiveTurn((turn) => ({ ...turn, blocked: message }));
        setLoading(false);
      },
      onError: (message) => {
        updateActiveTurn((turn) => ({
          ...turn,
          steps: [...turn.steps, { id: Date.now().toString(), message, status: "error" }],
        }));
        setLoading(false);
      },
      onDone: () => {
        setLoading(false);
      },
    });

    closeStream.current = close;
  }, [input, loading, updateActiveTurn]);

  const handleMic = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "recording.webm");
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const { text } = await res.json();
          setInput(text);
        } catch {
          // transcription failed — leave input as-is
        }
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRef.current = recorder;
      setRecording(true);
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
        setRecording(false);
      }, 8000);
    } catch {
      // Mic permission denied
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Sidebar */}
      <aside className="w-56 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2">
        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
          Sessions
        </span>
        <button className="text-left text-sm px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white font-medium">
          Session 1
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)] text-white grid place-items-center">
              <Store size={14} />
            </div>
            <span className="font-semibold text-[var(--color-primary)]">Talkshop</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
              Dashboard ↗
            </a>
            <div className="flex items-center gap-2 text-sm border-l border-[var(--color-border)] pl-4">
              <span className="text-[var(--color-text-muted)]">{user?.name}</span>
              <button
                onClick={handleLogout}
                title="Log out"
                className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>

        {/* Content area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          {turns.map((turn) => {
            const isActiveTurn = loading && turn.id === activeTurnId.current;
            return (
              <div key={turn.id} className="flex flex-col gap-3">
                {/* User message bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[var(--color-primary)] text-white px-4 py-2.5 text-sm">
                    {turn.userMessage}
                  </div>
                </div>

                {/* Assistant response, with a Talkshop avatar */}
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] grid place-items-center shrink-0">
                    <Store size={14} />
                  </div>
                  <div className="flex-1 flex flex-col gap-3 min-w-0 pt-1">
                    {/* Typing indicator — shown until the first step event arrives */}
                    {isActiveTurn && turn.steps.length === 0 && (
                      <div className="flex items-center gap-1.5 h-5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" />
                      </div>
                    )}

                    {/* Agent steps */}
                    <AnimatePresence>
                      {turn.steps.map((step, i) => (
                        <motion.div
                          key={step.id + i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-center gap-3 text-sm"
                        >
                          {step.status === "done" ? (
                            <span className="text-[var(--color-success)] font-bold text-base">✓</span>
                          ) : step.status === "error" ? (
                            <span className="text-rose-500 font-bold text-base">✗</span>
                          ) : (
                            <span className="w-3 h-3 rounded-full bg-[var(--color-primary)] animate-pulse shrink-0" />
                          )}
                          <span
                            className={`${
                              step.status === "error"
                                ? "text-rose-500"
                                : "text-[var(--color-text-muted)]"
                            }`}
                          >
                            {step.message}
                          </span>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {/* Blocked message */}
                    {turn.blocked && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700"
                      >
                        ⛔ {turn.blocked}
                      </motion.div>
                    )}

                    {/* Recommendation / follow-up question text */}
                    {turn.recommendation && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text)] max-w-[85%]"
                      >
                        {turn.recommendation}
                      </motion.div>
                    )}

                    {/* Product cards grid */}
                    {turn.products.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {turn.products.map((p, i) => (
                          <ProductCard key={p.product_id} product={p} index={i} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {turns.length === 0 && (
            <p className="text-[var(--color-text-muted)] text-sm mt-12 text-center">
              Ask something to start shopping — e.g.{" "}
              <span className="italic">"Find running shoes size 10 under $100"</span>
            </p>
          )}
        </div>

        {/* Input bar */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={loading ? "Searching..." : "Ask something..."}
              disabled={loading}
              className="flex-1 bg-transparent text-sm outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50"
            />
            <button
              onClick={handleMic}
              disabled={loading}
              className={`p-1.5 rounded-lg transition-colors ${
                recording
                  ? "bg-rose-500 text-white animate-pulse"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
              } disabled:opacity-40`}
              title={recording ? "Stop recording" : "Voice input"}
            >
              {recording ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-colors disabled:opacity-40"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
