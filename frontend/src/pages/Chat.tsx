import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, MicOff } from "lucide-react";
import { streamChat, type AgentEvent, type ProductData } from "../api/chat";
import ProductCard from "../components/ProductCard";

interface Step {
  id: string;
  message: string;
  status: "running" | "done" | "error";
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [products, setProducts] = useState<ProductData[]>([]);
  const [recommendation, setRecommendation] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const sessionId = useRef(crypto.randomUUID());
  const closeStream = useRef<(() => void) | null>(null);

  // Cleanup SSE on unmount
  useEffect(() => () => { closeStream.current?.(); }, []);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || loading) return;

    // Reset state for new query
    setSteps([]);
    setProducts([]);
    setRecommendation("");
    setBlocked(null);
    setLoading(true);
    setInput("");

    // Close any existing stream
    closeStream.current?.();

    const close = streamChat(msg, sessionId.current, {
      onStep: (event: AgentEvent) => {
        setSteps((prev) => {
          const existing = prev.find((s) => s.message === event.message);
          if (event.type === "step_start") {
            if (existing) return prev;
            return [...prev, { id: event.ts, message: event.message, status: "running" }];
          }
          if (event.type === "step_done") {
            // Mark matching running step as done, or add if new
            const idx = [...prev].reverse().findIndex((s: Step) => s.status === "running");
            const actualIdx = idx >= 0 ? prev.length - 1 - idx : -1;
            if (actualIdx >= 0) {
              const updated = [...prev];
              updated[actualIdx] = { ...updated[actualIdx], message: event.message, status: "done" };
              return updated;
            }
            return [...prev, { id: event.ts, message: event.message, status: "done" }];
          }
          return prev;
        });
      },
      onRecommendation: (text, prods) => {
        setRecommendation(text);
        setProducts(prods);
      },
      onBlocked: (message) => {
        setBlocked(message);
        setLoading(false);
      },
      onError: (message) => {
        setSteps((prev) => [...prev, { id: Date.now().toString(), message, status: "error" }]);
        setLoading(false);
      },
      onDone: () => {
        setLoading(false);
      },
    });

    closeStream.current = close;
  }, [input, loading]);

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
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
            <span className="font-semibold text-[var(--color-primary)]">AgentCommerce</span>
          </div>
          <a href="/dashboard" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
            Dashboard ↗
          </a>
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* Agent steps */}
          <AnimatePresence>
            {steps.map((step, i) => (
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
          {blocked && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700"
            >
              ⛔ {blocked}
            </motion.div>
          )}

          {/* Recommendation text */}
          {recommendation && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text)]"
            >
              {recommendation}
            </motion.div>
          )}

          {/* Product cards grid */}
          {products.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {products.map((p, i) => (
                <ProductCard key={p.product_id} product={p} index={i} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {steps.length === 0 && !loading && products.length === 0 && (
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
