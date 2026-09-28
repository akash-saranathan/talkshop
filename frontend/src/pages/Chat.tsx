import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, MicOff } from "lucide-react";

interface AgentStep {
  id: string;
  agent: string;
  message: string;
  status: "pending" | "running" | "done";
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);

  const handleSend = () => {
    if (!input.trim()) return;
    // Phase 2: will trigger SSE stream to /api/chat/stream
    setSteps([
      { id: "1", agent: "VibeCheck", message: "Understanding your request...", status: "running" },
    ]);
    setInput("");
  };

  const handleMic = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const { text } = await res.json();
      setInput(text);
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.start();
    mediaRef.current = recorder;
    setRecording(true);
    setTimeout(() => { recorder.state === "recording" && recorder.stop(); setRecording(false); }, 8000);
  };

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Sidebar */}
      <aside className="w-56 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2">
        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Sessions</span>
        <button className="text-left text-sm px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white font-medium">
          Session 1
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
            <span className="font-semibold text-[var(--color-primary)]">AgentCommerce</span>
          </div>
          <a href="/dashboard" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
            Dashboard ↗
          </a>
        </header>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          <AnimatePresence>
            {steps.map((step) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 text-sm"
              >
                {step.status === "done" ? (
                  <span className="text-[var(--color-success)] font-bold">✓</span>
                ) : (
                  <span className="w-3 h-3 rounded-full bg-[var(--color-primary)] animate-pulse" />
                )}
                <span className="font-medium text-[var(--color-primary)]">{step.agent}</span>
                <span className="text-[var(--color-text-muted)]">{step.message}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {steps.length === 0 && (
            <p className="text-[var(--color-text-muted)] text-sm mt-8 text-center">
              Ask something to start shopping — e.g. "Find running shoes size 10 under $100"
            </p>
          )}
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask something..."
              className="flex-1 bg-transparent text-sm outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
            />
            <button
              onClick={handleMic}
              className={`p-1.5 rounded-lg transition-colors ${recording ? "bg-rose-500 text-white animate-pulse" : "text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"}`}
              title={recording ? "Stop recording" : "Voice input"}
            >
              {recording ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              onClick={handleSend}
              className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-colors"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
