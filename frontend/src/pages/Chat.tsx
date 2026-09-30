import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, Square, X, LogOut, ShoppingCart, Sparkles, ArrowRight } from "lucide-react";
import { streamChat, getSessionMessages, attachImage, type AgentEvent, type ProductData, type ChatMessageRecord } from "../api/chat";
import { getCart, addToCart } from "../api/cart";
import ProductCard from "../components/ProductCard";
import ChatSidebar from "../components/ChatSidebar";
import AgentTrailPanel from "../components/AgentTrailPanel";
import ThemeToggle from "../components/ThemeToggle";
import { useAuth } from "../auth/AuthContext";

interface Step {
  id: string;
  message: string;
  status: "running" | "done" | "error";
}

interface Turn {
  id: string;
  userMessage: string;
  image?: string;
  steps: Step[];
  products: ProductData[];
  recommendation: string;
  blocked: string | null;
}

// Pasted screenshots can be huge — downscale before it ever leaves the
// browser, both for a snappy paste and a small request body.
async function resizeImageForUpload(file: Blob, maxDim = 768, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Map robotic agent step messages to first-person friendly text.
// Returns null to suppress zero-count noise steps.
function humanizeStep(message: string): string | null {
  const m = message.toLowerCase();

  // Suppress zero-product noise
  if (/\b0 products?\b/.test(m) || /catalogued 0/.test(m) || /top 0 picks/.test(m)) return null;

  // VibeCheck
  if (m.includes("vibecheck")) {
    if (m.includes("all clear") || m.includes("ready to shop")) return "Let me figure out what you're looking for...";
    if (m.includes("understood") || m.includes("looking for")) {
      const hit = message.match(/[Ll]ooking for (.+)/);
      return hit ? `Got it! I'm searching for ${hit[1]}...` : "On it! Starting the search...";
    }
    if (m.includes("writing") || m.includes("recommendation")) return "Picking the best options for you...";
    if (m.includes("chitchat") || m.includes("greeting") || m.includes("no products")) return "Hey there! What can I help you find?";
  }

  // SneakPeek
  if (m.includes("sneakpeek")) {
    const found = message.match(/found (\d+) products? across (\d+)/i);
    if (found) {
      const n = parseInt(found[1]);
      if (n === 0) return null;
      return `Found ${n} option${n !== 1 ? "s" : ""} across ${found[2]} store${found[2] !== "1" ? "s" : ""}!`;
    }
    const top = message.match(/top (\d+) picks/i);
    if (top) {
      const n = parseInt(top[1]);
      if (n === 0) return null;
      return `Here are your top ${n} picks!`;
    }
    return null;
  }

  // CartUp / GreenLight / PayIt / TrackIt
  if (m.includes("cartup")) return "Setting up your order...";
  if (m.includes("greenlight")) return m.includes("authorized") || m.includes("approved") ? "Transaction approved!" : "Running security checks...";
  if (m.includes("payit")) return m.includes("success") || m.includes("confirm") ? "Payment confirmed!" : "Processing payment securely...";
  if (m.includes("trackit")) return "Your order is confirmed and on its way!";

  return message;
}

function messagesToTurns(messages: ChatMessageRecord[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i += 2) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];
    if (!userMsg || userMsg.role !== "user") continue;
    turns.push({
      id: crypto.randomUUID(),
      userMessage: userMsg.content,
      steps: [],
      products: assistantMsg?.products ?? [],
      recommendation: assistantMsg?.content ?? "",
      blocked: assistantMsg?.blocked_reason ?? null,
    });
  }
  return turns;
}

export default function Chat() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [input, setInput] = useState("");
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [selectedProducts, setSelectedProducts] = useState<Map<string, ProductData>>(new Map());
  const [addingToCheckout, setAddingToCheckout] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(256);
  const [rightWidth, setRightWidth] = useState(288);
  const resizingRef = useRef<"left" | "right" | null>(null);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(32).fill(4));
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [autoCheckoutIn, setAutoCheckoutIn] = useState<number | null>(null);
  const autoCheckoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAddedItemRef = useRef<import("../api/cart").CartItemData | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Distinguishes "the browser ended the session on its own" (e.g. after a
  // pause — should silently resume so it feels continuous) from "the user
  // clicked Stop/Cancel" (should actually end).
  const stoppingRef = useRef(false);
  // sessionIdRef is the source of truth read inside async streaming
  // callbacks (avoids stale-closure bugs); currentSessionId mirrors it so
  // the sidebar can reactively highlight the active thread.
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const [currentSessionId, setCurrentSessionId] = useState<string>(sessionIdRef.current);
  const closeStream = useRef<(() => void) | null>(null);
  const activeTurnId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow the textarea with its content instead of scrolling a single line.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Refresh the cart badge on mount and whenever the tab regains focus —
  // covers coming back from Cart/Checkout after adding, removing, or buying.
  useEffect(() => {
    const refreshCartCount = () => {
      getCart().then((items) => setCartCount(items.length)).catch(() => {});
    };
    refreshCartCount();
    window.addEventListener("focus", refreshCartCount);
    return () => window.removeEventListener("focus", refreshCartCount);
  }, []);

  // Drag-to-resize for the left/right panels — separate from collapse,
  // for when the user wants the panel narrower but still visible.
  const startResize = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const MIN_WIDTH = 200;
    const MAX_WIDTH = 420;
    const clamp = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v));

    const onMouseMove = (e: MouseEvent) => {
      if (resizingRef.current === "left") {
        setLeftWidth(clamp(e.clientX));
      } else if (resizingRef.current === "right") {
        setRightWidth(clamp(window.innerWidth - e.clientX));
      }
    };
    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Cleanup SSE + mic + checkout timer on unmount
  useEffect(() => () => {
    closeStream.current?.();
    stoppingRef.current = true;
    recognitionRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (autoCheckoutTimerRef.current) clearInterval(autoCheckoutTimerRef.current);
  }, []);

  // Auto-scroll to the newest turn, matching standard chat UX.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const updateActiveTurn = useCallback((updater: (turn: Turn) => Turn) => {
    const id = activeTurnId.current;
    if (!id) return;
    setTurns((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  }, []);

  const switchToSession = useCallback((id: string) => {
    sessionIdRef.current = id;
    setCurrentSessionId(id);
    // sessionStorage (not localStorage) so it persists within this tab
    // (cart → back → chat restores session) but clears on fresh tab open.
    try { sessionStorage.setItem("talkshop_session", id); } catch { /* noop */ }
  }, []);

  const handleNewChat = useCallback(() => {
    closeStream.current?.();
    setLoading(false);
    activeTurnId.current = null;
    switchToSession(crypto.randomUUID());
    setTurns([]);
  }, [switchToSession]);

  // Shared by "click a session in the sidebar" and "restore on page load" —
  // loads a session's messages, falling back to a fresh chat if it no
  // longer exists (deleted, or belonged to a session that never got saved).
  const loadSession = useCallback(async (id: string) => {
    switchToSession(id);
    try {
      const messages = await getSessionMessages(id);
      setTurns(messagesToTurns(messages));
    } catch {
      switchToSession(crypto.randomUUID());
      setTurns([]);
    }
  }, [switchToSession]);

  const handleSelectSession = useCallback(async (clickedId: string) => {
    if (clickedId === sessionIdRef.current) return;
    closeStream.current?.();
    setLoading(false);
    activeTurnId.current = null;
    await loadSession(clickedId);
  }, [loadSession]);

  // Restore session within the same browser tab (e.g. returning from /cart).
  // sessionStorage clears on new-tab / browser-restart so the app starts fresh there.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("talkshop_session");
      if (saved) loadSession(saved);
    } catch { /* noop */ }
    // Mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerCheckoutCountdown = useCallback((item?: import("../api/cart").CartItemData) => {
    if (item) lastAddedItemRef.current = item;
    if (autoCheckoutTimerRef.current) clearInterval(autoCheckoutTimerRef.current);
    setAutoCheckoutIn(10);
    let remaining = 10;
    autoCheckoutTimerRef.current = setInterval(() => {
      remaining -= 1;
      setAutoCheckoutIn(remaining);
      if (remaining <= 0) {
        clearInterval(autoCheckoutTimerRef.current!);
        autoCheckoutTimerRef.current = null;
        setAutoCheckoutIn(null);
        // Navigate with just the added item as state so Checkout doesn't need
        // to load the whole cart — feels instant and avoids showing stale items.
        const checkoutItems = lastAddedItemRef.current ? [lastAddedItemRef.current] : [];
        navigate("/checkout", { state: { items: checkoutItems } });
      }
    }, 1000);
  }, [navigate]);

  const cancelCheckoutCountdown = useCallback(() => {
    if (autoCheckoutTimerRef.current) { clearInterval(autoCheckoutTimerRef.current); autoCheckoutTimerRef.current = null; }
    setAutoCheckoutIn(null);
  }, []);

  const handleSessionDeleted = useCallback((deletedId: string) => {
    if (deletedId === sessionIdRef.current) {
      handleNewChat();
    }
  }, [handleNewChat]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    // Always persist the active session so returning from Dashboard/Cart
    // restores this chat, even if the user never clicked a sidebar session.
    switchToSession(sessionIdRef.current);

    const turnId = crypto.randomUUID();
    const imageForTurn = pastedImage;
    activeTurnId.current = turnId;
    setTurns((prev) => [...prev, {
      id: turnId,
      userMessage: msg,
      image: imageForTurn ?? undefined,
      steps: [],
      products: [],
      recommendation: "",
      blocked: null,
    }]);
    setLoading(true);
    setInput("");
    setPastedImage(null);

    // Close any existing stream
    closeStream.current?.();

    if (imageForTurn) {
      try {
        await attachImage(sessionIdRef.current, imageForTurn.split(",")[1] ?? "");
      } catch {
        updateActiveTurn((turn) => ({
          ...turn,
          steps: [...turn.steps, {
            id: Date.now().toString(),
            message: "Couldn't attach the image — continuing with text only.",
            status: "error",
          }],
        }));
      }
    }

    const close = streamChat(msg, sessionIdRef.current, {
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
        // The backend just persisted this turn (and maybe created a new
        // session) — refresh the sidebar so it shows up without a manual reload.
        setSidebarRefreshKey((k) => k + 1);
      },
    });

    closeStream.current = close;
  }, [input, loading, pastedImage, updateActiveTurn]);

  const BAR_COUNT = 32;

  // Real mic amplitude drives the waveform bars — separate from
  // SpeechRecognition (which only returns text, not audio levels) so the
  // user gets visible proof the mic is actually picking up their voice.
  const startLevelMeter = (stream: MediaStream) => {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const groupSize = Math.ceil(data.length / BAR_COUNT);
    let lastUpdate = 0;

    const tick = (time: number) => {
      analyser.getByteFrequencyData(data);
      if (time - lastUpdate > 60) {
        lastUpdate = time;
        setAudioLevels(
          Array.from({ length: BAR_COUNT }, (_, i) => {
            const group = data.slice(i * groupSize, (i + 1) * groupSize);
            const avg = group.reduce((s, v) => s + v, 0) / (group.length || 1);
            return Math.max(4, Math.round((avg / 255) * 100));
          })
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopLevelMeter = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setAudioLevels(Array(BAR_COUNT).fill(4));
  };

  const handleMic = async () => {
    setMicError(null);

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setMicError("Voice input needs Chrome or Edge — not supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setMicError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser's site settings and try again."
          : "Couldn't access the microphone."
      );
      return;
    }
    micStreamRef.current = stream;
    startLevelMeter(stream);

    stoppingRef.current = false;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    // Keep listening across natural pauses — only the Stop/Cancel buttons
    // should end the session, not a moment of silence mid-sentence.
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let newText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const transcript = event.results[i][0].transcript.trim();
        if (transcript) newText += (newText ? " " : "") + transcript;
      }
      if (newText) {
        setInput((prev) => (prev ? `${prev} ${newText}` : newText));
      }
    };

    recognition.onerror = (event) => {
      // "aborted" = user cancelled; "no-speech" = a pause, not a failure —
      // onend will auto-resume for both. Anything else is a real failure.
      if (event.error === "aborted" || event.error === "no-speech") return;
      stoppingRef.current = true;
      setMicError(
        event.error === "not-allowed"
          ? "Microphone access was denied. Allow it in your browser's site settings and try again."
          : "Couldn't access the microphone."
      );
    };

    recognition.onend = () => {
      if (stoppingRef.current) {
        stopLevelMeter();
        setRecording(false);
        return;
      }
      // Chrome ended the session on its own (e.g. after a pause) even
      // though continuous=true — resume transparently so it never feels
      // like it stopped listening.
      try {
        recognition.start();
      } catch {
        // A start() already in flight — safe to ignore.
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  // Stop = finalize whatever was heard so far (onresult still fires, then onend).
  const handleStopRecording = () => {
    stoppingRef.current = true;
    recognitionRef.current?.stop();
  };

  // Cancel = discard the recording entirely, no transcript inserted.
  const handleCancelRecording = () => {
    stoppingRef.current = true;
    setMicError(null);
    recognitionRef.current?.abort();
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleToggleSelect = useCallback((product: ProductData) => {
    setSelectedProducts((prev) => {
      const next = new Map(prev);
      if (next.has(product.product_id)) next.delete(product.product_id);
      else next.set(product.product_id, product);
      return next;
    });
  }, []);

  const handleBuySelected = useCallback(async () => {
    if (addingToCheckout || selectedProducts.size === 0) return;
    setAddingToCheckout(true);
    try {
      for (const product of selectedProducts.values()) {
        await addToCart(product);
      }
      setSelectedProducts(new Map());
      navigate("/cart");
    } catch {
      setAddingToCheckout(false);
    }
  }, [addingToCheckout, selectedProducts, navigate]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <ChatSidebar
        activeSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onSessionDeleted={handleSessionDeleted}
        refreshKey={sidebarRefreshKey}
        collapsed={leftCollapsed}
        onToggleCollapse={() => setLeftCollapsed((c) => !c)}
        width={leftWidth}
      />
      {!leftCollapsed && (
        <div
          onMouseDown={startResize("left")}
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)] transition-colors"
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
              Dashboard ↗
            </a>
            <a href="/cart" className="relative text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors" title="Cart">
              <ShoppingCart size={18} />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold grid place-items-center">
                  {cartCount}
                </span>
              )}
            </a>
            <ThemeToggle />
            <div className="flex items-center gap-2 text-sm border-l border-[var(--color-border)] pl-3">
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
                    {turn.image && (
                      <img src={turn.image} alt="Attached" className="w-40 h-40 object-cover rounded-lg mb-2" />
                    )}
                    {turn.userMessage}
                  </div>
                </div>

                {/* Assistant response — AI shopping agent avatar */}
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${
                    isActiveTurn
                      ? "bg-gradient-to-br from-[var(--color-primary)] to-violet-500 shadow-md shadow-[var(--color-primary)]/30"
                      : "bg-[var(--color-primary)]/15"
                  }`}>
                    <Sparkles size={14} className={isActiveTurn ? "text-white animate-pulse" : "text-[var(--color-primary)]"} />
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

                    {/* Agent steps — humanized first-person messages */}
                    <AnimatePresence>
                      {turn.steps.map((step, i) => {
                        const friendly = humanizeStep(step.message);
                        if (!friendly) return null;
                        return (
                          <motion.div
                            key={step.id + i}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-2.5 text-sm"
                          >
                            {step.status === "done" ? (
                              <span className="w-4 h-4 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] text-[10px] grid place-items-center shrink-0 font-bold">✓</span>
                            ) : step.status === "error" ? (
                              <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-500 text-[10px] grid place-items-center shrink-0 font-bold">✗</span>
                            ) : (
                              <span className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin shrink-0" />
                            )}
                            <span className={step.status === "error" ? "text-rose-500" : "text-[var(--color-text-muted)]"}>
                              {friendly}
                            </span>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    {/* Blocked message */}
                    {turn.blocked && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700 flex items-start gap-2"
                      >
                        <span className="shrink-0 mt-0.5">🛡️</span>
                        <span>{turn.blocked}</span>
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
                          <ProductCard
                            key={p.product_id}
                            product={p}
                            index={i}
                            selected={selectedProducts.has(p.product_id)}
                            onToggleSelect={handleToggleSelect}
                            onAdded={(cartItem) => {
                              getCart().then((items) => setCartCount(items.length)).catch(() => {});
                              triggerCheckoutCountdown(cartItem);
                            }}
                          />
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
            <div className="flex flex-col items-center gap-6 mt-16">
              <div className="text-center">
                <p className="text-lg font-semibold text-[var(--color-text)] mb-1">What are you shopping for?</p>
                <p className="text-sm text-[var(--color-text-muted)]">Ask me anything — I'll search across multiple stores and find the best options for you.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {[
                  "Running shoes size 10 under $100",
                  "Green shirt in size L",
                  "Laptop under $800",
                  "Wireless headphones with good reviews",
                  "Blue sneakers arriving within 3 days",
                  "Dress for a formal occasion",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="text-sm px-3 py-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Auto-checkout countdown toast — appears after "Add to Cart" */}
        <AnimatePresence>
          {autoCheckoutIn !== null && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="mx-6 mb-2 rounded-xl bg-gradient-to-r from-[var(--color-primary)] to-violet-600 text-white px-5 py-3 flex items-center justify-between shadow-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 grid place-items-center shrink-0">
                  <ShoppingCart size={15} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Item added! Heading to checkout...</p>
                  <p className="text-xs text-white/70">Taking you there in {autoCheckoutIn}s</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelCheckoutCountdown}
                  className="text-xs text-white/70 hover:text-white transition-colors px-2 py-1"
                >
                  Stay here
                </button>
                <button
                  onClick={() => {
                    cancelCheckoutCountdown();
                    const checkoutItems = lastAddedItemRef.current ? [lastAddedItemRef.current] : [];
                    navigate("/checkout", { state: { items: checkoutItems } });
                  }}
                  className="flex items-center gap-1.5 text-sm font-semibold bg-white text-[var(--color-primary)] px-3 py-1.5 rounded-lg hover:bg-white/90 transition-colors"
                >
                  Go now <ArrowRight size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating multi-select checkout bar */}
        {selectedProducts.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="mx-6 mb-2 rounded-xl bg-[var(--color-primary)] text-white px-4 py-3 flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-3">
              <ShoppingCart size={16} />
              <span className="text-sm font-medium">
                {selectedProducts.size} item{selectedProducts.size > 1 ? "s" : ""} selected
              </span>
              <span className="text-sm text-white/70">
                · ${Array.from(selectedProducts.values()).reduce((s, p) => s + p.price, 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedProducts(new Map())}
                className="text-xs text-white/70 hover:text-white transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleBuySelected}
                disabled={addingToCheckout}
                className="text-sm font-semibold bg-white text-[var(--color-primary)] px-3 py-1.5 rounded-lg hover:bg-white/90 transition-colors disabled:opacity-60"
              >
                {addingToCheckout ? "Adding..." : "Buy Selected"}
              </button>
            </div>
          </motion.div>
        )}

        {/* Input bar */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          {micError && (
            <p className="text-xs text-rose-500 mb-2">{micError}</p>
          )}
          {imageError && (
            <p className="text-xs text-rose-500 mb-2">{imageError}</p>
          )}
          {pastedImage && !recording && (
            <div className="relative inline-block mb-2">
              <img src={pastedImage} alt="Pasted" className="h-16 w-16 object-cover rounded-lg border border-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => setPastedImage(null)}
                title="Remove image"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--color-text)] text-[var(--color-surface)] grid place-items-center"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {recording ? (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <button
                type="button"
                onClick={handleCancelRecording}
                title="Cancel"
                className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors shrink-0"
              >
                <X size={18} />
              </button>
              <div className="flex-1 flex items-center gap-[2px] h-6 min-w-0">
                {audioLevels.map((level, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full bg-[var(--color-primary)] transition-[height] duration-75"
                    style={{ height: `${level}%` }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={handleStopRecording}
                title="Stop recording"
                className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white grid place-items-center hover:bg-[var(--color-primary-light)] transition-colors shrink-0"
              >
                <Square size={13} fill="currentColor" />
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onPaste={async (e) => {
                  if (!e.clipboardData) return; // let normal text paste proceed
                  const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
                  if (!item) return; // no image on the clipboard — let normal text paste proceed
                  e.preventDefault();
                  const file = item.getAsFile();
                  if (!file) return;
                  setImageError(null);
                  try {
                    setPastedImage(await resizeImageForUpload(file));
                  } catch {
                    setImageError("Couldn't read that image — try a different one.");
                  }
                }}
                placeholder={loading ? "Searching..." : "Ask something..."}
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent text-sm outline-none resize-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50 max-h-40 overflow-y-auto leading-relaxed"
              />
              <button
                type="button"
                onClick={handleMic}
                disabled={loading}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40"
                title="Voice input"
              >
                <Mic size={18} />
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-colors disabled:opacity-40"
              >
                <Send size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      {!rightCollapsed && (
        <div
          onMouseDown={startResize("right")}
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)] transition-colors"
        />
      )}
      <AgentTrailPanel
        collapsed={rightCollapsed}
        onToggleCollapse={() => setRightCollapsed((c) => !c)}
        width={rightWidth}
        activeTurnSteps={turns.find((t) => t.id === activeTurnId.current)?.steps ?? []}
        activeLoading={loading}
      />
    </div>
  );
}
