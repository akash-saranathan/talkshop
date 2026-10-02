import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, Square, X, LogOut, ShoppingCart, Sparkles, ArrowUpDown, Star, Zap, TrendingDown, GitCompare, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { streamChat, getSessionMessages, attachImage, type AgentEvent, type ProductData, type ChatMessageRecord } from "../api/chat";
import { getCart, addToCart, removeFromCart, type CartItemData } from "../api/cart";
import { authFetch } from "../api/client";
import ProductCard from "../components/ProductCard";
import SkeletonProductCard from "../components/SkeletonProductCard";
import CompareModal from "../components/CompareModal";
import CartDrawer from "../components/CartDrawer";
import ChatSidebar from "../components/ChatSidebar";
import AgentTrailPanel from "../components/AgentTrailPanel";
import ThemeToggle from "../components/ThemeToggle";
import InlineCheckout, { SAVED_CARDS, type InlineCheckoutData, type CheckoutData as InlineCheckoutDataShape } from "../components/InlineCheckout";
import { useAuth } from "../auth/AuthContext";
import { getProductVisual } from "../utils/productVisual";

// ── Intent parsing ──────────────────────────────────────────────────────────

interface SimpleIntent {
  color?: string;
  size?: string;
  maxPrice?: number;
  brand?: string;
}

const KNOWN_COLORS = ["black","white","blue","red","green","grey","gray","navy","pink","orange","yellow","purple","brown","beige","floral"];
const KNOWN_BRANDS = ["nike","adidas","new balance","brooks","asics","saucony","hoka","puma","reebok","on running","mizuno","sony","apple","samsung","bose","jabra","garmin","bcbg","zara","h&m","converse","vans","jordan"];

function parseSimpleIntent(message: string): SimpleIntent {
  const m = message.toLowerCase();
  const intent: SimpleIntent = {};
  for (const c of KNOWN_COLORS) { if (m.includes(c)) { intent.color = c; break; } }
  const sizeMatch = m.match(/\bsize\s+(\w+)\b/i) ?? m.match(/\bin\s+(xs|s|m|l|xl|xxl)\b/i);
  if (sizeMatch) intent.size = sizeMatch[1].toUpperCase();
  const priceMatch = m.match(/under\s+\$?(\d+)/i) ?? m.match(/\$?(\d+)\s+or\s+less/i) ?? m.match(/below\s+\$?(\d+)/i);
  if (priceMatch) intent.maxPrice = parseInt(priceMatch[1]);
  for (const b of KNOWN_BRANDS) { if (m.includes(b)) { intent.brand = b.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "); break; } }
  return intent;
}

function computeMatchTags(intent: SimpleIntent, product: ProductData): string[] {
  const tags: string[] = [];
  if (intent.color && product.color?.toLowerCase().includes(intent.color)) tags.push(intent.color);
  if (intent.size && product.size?.toLowerCase() === intent.size.toLowerCase()) tags.push(`size ${intent.size}`);
  if (intent.maxPrice && product.price <= intent.maxPrice) tags.push(`under $${intent.maxPrice}`);
  if (intent.brand && product.brand?.toLowerCase().includes(intent.brand.toLowerCase())) tags.push(intent.brand);
  return tags;
}

function generateFollowUpChips(products: ProductData[], intent: SimpleIntent): string[] {
  const chips: string[] = [];
  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))] as string[];
  if (brands.length > 1) {
    chips.push(`Only ${brands[0]}`);
    if (brands[1] && chips.length < 3) chips.push(`Only ${brands[1]}`);
  }
  const prices = products.map(p => p.price).sort((a, b) => a - b);
  const spread = prices[prices.length - 1] - prices[0];
  if (spread > prices[0] * 0.4 && !intent.maxPrice) {
    chips.push(`Under $${Math.round(prices[0] + spread * 0.5)}`);
  }
  const fastCount = products.filter(p => p.delivery_days <= 2).length;
  if (fastCount > 0 && fastCount < products.length) chips.push("Fastest delivery only");
  if (products.length > 1 && chips.length < 4) chips.push("Which one should I buy?");
  return chips.slice(0, 4);
}

type SortMode = "match" | "price" | "rating" | "delivery";

function sortProducts(products: ProductData[], mode: SortMode): ProductData[] {
  const arr = [...products];
  if (mode === "price") return arr.sort((a, b) => a.price - b.price);
  if (mode === "rating") return arr.sort((a, b) => b.rating - a.rating);
  if (mode === "delivery") return arr.sort((a, b) => a.delivery_days - b.delivery_days);
  return arr.sort((a, b) => b.rank_score - a.rank_score);
}

// ── Turn types ───────────────────────────────────────────────────────────────

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
  intent: SimpleIntent;
  checkout?: InlineCheckoutData;
}

function isAffirmativeInput(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!?.]+$/, "");
  return /^(yes|yeah|yep|sure|ok|okay|confirm|add to cart|proceed|pay|go ahead|do it|sounds good|add it|let's do it|lets do it|add)$/.test(t);
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
      intent: parseSimpleIntent(userMsg.content),
    });
  }
  return turns;
}

export default function Chat() {
  const navigate = useNavigate();
  const { user, logout, isGuest } = useAuth();
  const [input, setInput] = useState("");
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [sessionCartCount, setSessionCartCount] = useState(0);
  const [sessionCartIds, setSessionCartIds] = useState<Set<string>>(new Set());
  const [sessionCartItems, setSessionCartItems] = useState<CartItemData[]>([]);
  const [cartPanelOpen, setCartPanelOpen] = useState(false);
  const [turnSortModes, setTurnSortModes] = useState<Map<string, SortMode>>(new Map());
  const [selectedProducts, setSelectedProducts] = useState<Map<string, ProductData>>(new Map());
  const [showCompare, setShowCompare] = useState(false);
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(256);
  const [rightWidth, setRightWidth] = useState(288);
  const resizingRef = useRef<"left" | "right" | null>(null);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(32).fill(4));
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Distinguishes "the browser ended the session on its own" (e.g. after a
  // pause — should silently resume so it feels continuous) from "the user
  // clicked Stop/Cancel" (should actually end).
  const stoppingRef = useRef(false);
  const autoSendRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always points to the latest handleSend — lets recognition callbacks call
  // it directly without capturing a stale closure.
  const handleSendRef = useRef<(() => void) | null>(null);
  // Same pattern for doCheckoutSummary — avoids TDZ when handleSend references it.
  const doCheckoutSummaryRef = useRef<((userText: string, product: ProductData) => void) | null>(null);
  // Tracks the last agent-recommended product so "yes/ok" can trigger checkout
  // without relying on the selected-products visual state.
  const lastRecommendedProductRef = useRef<ProductData | null>(null);
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
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
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
    setSessionCartCount(0);
    setSessionCartIds(new Set());
    setSessionCartItems([]);
    setCartPanelOpen(false);
    try { sessionStorage.removeItem("talkshop_session_cart_ids"); } catch { /* noop */ }
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
    setSessionCartCount(0);
    setSessionCartIds(new Set());
    setSessionCartItems([]);
    setCartPanelOpen(false);
    try { sessionStorage.removeItem("talkshop_session_cart_ids"); } catch { /* noop */ }
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

  const handleSessionDeleted = useCallback((deletedId: string) => {
    if (deletedId === sessionIdRef.current) {
      handleNewChat();
    }
  }, [handleNewChat]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    // ── Inline checkout intercepts ──────────────────────────────────────────
    // User said "yes" after agent recommended a product → bypass LangGraph, start checkout
    if (isAffirmativeInput(msg) && lastRecommendedProductRef.current) {
      doCheckoutSummaryRef.current?.(msg, lastRecommendedProductRef.current);
      lastRecommendedProductRef.current = null;
      return;
    }

    // Always persist the active session so returning from Dashboard/Cart
    // restores this chat, even if the user never clicked a sidebar session.
    switchToSession(sessionIdRef.current);

    const turnId = crypto.randomUUID();
    const imageForTurn = pastedImage;
    const parsedIntent = parseSimpleIntent(msg);
    activeTurnId.current = turnId;
    setTurns((prev) => [...prev, {
      id: turnId,
      userMessage: msg,
      image: imageForTurn ?? undefined,
      steps: [],
      products: [],
      recommendation: "",
      blocked: null,
      intent: parsedIntent,
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
        const capturedId = activeTurnId.current;
        // Set products immediately
        setTurns((prev) => prev.map((t) =>
          t.id === capturedId ? { ...t, products: prods } : t
        ));
        // Remember the top-ranked product so affirmative replies ("yes", "ok") can trigger checkout.
        if (prods.length > 0) {
          lastRecommendedProductRef.current = prods[0];
        }
        // Stream recommendation text word-by-word (ChatGPT-style)
        const words = text.split(" ");
        words.forEach((_, i) => {
          const partial = words.slice(0, i + 1).join(" ");
          const isLast = i === words.length - 1;
          setTimeout(() => {
            setTurns((prev) => prev.map((t) =>
              t.id === capturedId
                ? { ...t, recommendation: partial + (isLast ? "" : " ▍") }
                : t
            ));
          }, i * 40);
        });
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
        // Mark any still-running steps done so their spinners clear.
        updateActiveTurn((turn) => ({
          ...turn,
          steps: turn.steps.map((s) => s.status === "running" ? { ...s, status: "done" } : s),
        }));
        setSidebarRefreshKey((k) => k + 1);
      },
    });

    closeStream.current = close;
  }, [input, loading, pastedImage, updateActiveTurn]);

  // Keep the ref always pointing at the current handleSend so recognition
  // callbacks can fire it without stale-closure issues.
  handleSendRef.current = handleSend;

  // ── Inline checkout flow ──────────────────────────────────────────────────

  // Step 1: user said "yes" to agent's cart question → create checkout summary turn
  const doCheckoutSummary = useCallback(async (userText: string, product: ProductData) => {
    setInput("");
    setPastedImage(null);
    setLoading(true);
    setSelectedProducts(new Map());

    const turnId = crypto.randomUUID();
    activeTurnId.current = turnId;

    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        userMessage: userText,
        steps: [{ id: "c1", message: "Preparing your order...", status: "running" as const }],
        products: [],
        recommendation: "",
        blocked: null,
        intent: {},
        checkout: {
          phase: "setup" as const,
          product,
          selectedCard: SAVED_CARDS[0].id,
          isGuest,
          guestCard: isGuest ? { number: "", expiry: "", cvc: "", name: "" } : undefined,
        },
      },
    ]);

    try {
      await addToCart(product);
      const res = await authFetch("/api/checkout/create", {
        method: "POST",
        body: JSON.stringify({
          product_id: product.product_id,
          merchant_id: product.merchant_id,
          quantity: 1,
        }),
      });
      if (!res.ok) throw new Error("Checkout creation failed");
      const checkoutData: InlineCheckoutDataShape = await res.json();

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                steps: [{ id: "c1", message: "Order ready", status: "done" as const }],
                checkout: {
                  phase: "summary" as const,
                  product,
                  checkoutData,
                  selectedCard: SAVED_CARDS[0].id,
                  isGuest,
                  guestCard: isGuest ? { number: "", expiry: "", cvc: "", name: "" } : undefined,
                },
              }
            : t
        )
      );
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                steps: [],
                checkout: {
                  phase: "failed" as const,
                  product,
                  selectedCard: SAVED_CARDS[0].id,
                  error: "Could not prepare your order. Please try again.",
                },
              }
            : t
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);
  // Keep the ref current on every render so callers never see a stale closure.
  doCheckoutSummaryRef.current = doCheckoutSummary;

  // Step 2: user clicked "Confirm & Pay" → run DPAT + payment inline
  const doPayment = useCallback(async (
    turnId: string,
    checkoutData: InlineCheckoutDataShape,
    selectedCard: string,
    product: ProductData,
  ) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? {
              ...t,
              checkout: {
                ...t.checkout!,
                phase: "processing" as const,
                processingSteps: [
                  { label: "GreenLight issuing DPAT authorization…", status: "running" as const },
                  { label: "DPAT token ready", status: "pending" as const },
                  { label: "PayIt executing payment…", status: "pending" as const },
                  { label: "TrackIt recording your order…", status: "pending" as const },
                ],
              },
            }
          : t
      )
    );
    setLoading(true);

    const updateSteps = (steps: Array<{ label: string; status: "pending" | "running" | "done" | "error" }>) => {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, checkout: { ...t.checkout!, processingSteps: steps } } : t
        )
      );
    };

    try {
      // GreenLight: approve authorization
      const approveRes = await authFetch("/api/authorizations/approve", {
        method: "POST",
        body: JSON.stringify({
          checkout_id: checkoutData.checkout_id,
          checkout_hash: checkoutData.checkout_hash,
          merchant_id: checkoutData.merchant_id,
          total: checkoutData.total,
          currency: checkoutData.currency,
          product_id: checkoutData.product_id,
          product_title: checkoutData.product_title,
          merchant_name: checkoutData.merchant_name,
          subtotal: checkoutData.subtotal,
          tax: checkoutData.tax,
          shipping: checkoutData.shipping,
        }),
      });
      if (!approveRes.ok) throw new Error("Authorization failed");
      const approveData = await approveRes.json();

      updateSteps([
        { label: "GreenLight — authorization approved", status: "done" },
        { label: "DPAT token issued", status: "done" },
        { label: "PayIt executing payment…", status: "running" },
        { label: "TrackIt recording your order…", status: "pending" },
      ]);

      // PayIt: execute payment
      const execRes = await authFetch("/api/payments/execute", {
        method: "POST",
        body: JSON.stringify({
          token_id: approveData.token_id,
          checkout_id: checkoutData.checkout_id,
          checkout_hash: checkoutData.checkout_hash,
          merchant_id: checkoutData.merchant_id,
          merchant_name: checkoutData.merchant_name,
          total: checkoutData.total,
          currency: checkoutData.currency,
          product_id: checkoutData.product_id,
          product_title: checkoutData.product_title,
          subtotal: checkoutData.subtotal,
          tax: checkoutData.tax,
          shipping: checkoutData.shipping,
          payment_method: "card",
        }),
      });
      if (!execRes.ok) throw new Error("Payment failed");
      const execData = await execRes.json();

      updateSteps([
        { label: "GreenLight — authorization approved", status: "done" },
        { label: "DPAT token issued", status: "done" },
        { label: "Payment processed successfully", status: "done" },
        { label: "TrackIt — order recorded", status: "done" },
      ]);

      // Small delay so the user sees all steps green before flipping to confirmed
      await new Promise((r) => setTimeout(r, 600));

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                checkout: {
                  phase: "confirmed" as const,
                  product,
                  selectedCard,
                  orderId: execData.order_id,
                  confirmedTotal: execData.amount,
                },
              }
            : t
        )
      );

      // Clear session cart
      setCartCount(0);
      setSessionCartCount(0);
      setSessionCartIds(new Set());
      setSessionCartItems([]);
      setCartPanelOpen(false);
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                checkout: {
                  ...t.checkout!,
                  phase: "failed" as const,
                  error: "Payment failed. Please check your card details and try again.",
                },
              }
            : t
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Cancel inline checkout — marks the turn as cancelled
  const cancelCheckout = useCallback((turnId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? { ...t, checkout: { ...t.checkout!, phase: "cancelled" as const } }
          : t
      )
    );
  }, []);

  // Update selected card within a checkout turn
  const updateCheckoutCard = useCallback((turnId: string, cardId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, checkout: { ...t.checkout!, selectedCard: cardId } } : t
      )
    );
  }, []);

  // Update guest card fields within a checkout turn
  const updateGuestCard = useCallback((turnId: string, card: NonNullable<InlineCheckoutData["guestCard"]>) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, checkout: { ...t.checkout!, guestCard: card } } : t
      )
    );
  }, []);

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
    // Interim results fire as you speak (near real-time), so we can detect
    // silence accurately: reset the 1.5s timer on every event.  Without this,
    // Chrome with continuous=true waits 5-7 s before delivering a "final"
    // result — the silence timer never even starts until then.
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let newText = "";
      let hasActivity = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        hasActivity = true;
        if (!event.results[i].isFinal) continue;
        const transcript = event.results[i][0].transcript.trim();
        if (transcript) newText += (newText ? " " : "") + transcript;
      }

      // Accumulate only final text into the input field.
      if (newText) {
        setInput((prev) => (prev ? `${prev} ${newText}` : newText));
      }

      // Voice command routing on final results — instant send.
      if (newText) {
        const isCommand = /^(choose|select|pick)\s+(first|second|third|1st|2nd|3rd)/i.test(newText.trim()) ||
          /^(yes|confirm|approve|proceed|go ahead)\.?$/i.test(newText.trim()) ||
          /^(cancel|no|stop|go back)\.?$/i.test(newText.trim()) ||
          /^track\s+(my\s+)?order/i.test(newText.trim());

        if (isCommand) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          autoSendRef.current = true;
          stoppingRef.current = true;
          recognitionRef.current?.stop();
          return;
        }
      }

      // Reset the silence timer on ANY speech activity (interim = user still
      // speaking).  The timer fires 1.5 s after the very last word, which is
      // when interim events stop flowing.
      if (hasActivity) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          autoSendRef.current = true;
          stoppingRef.current = true;
          recognitionRef.current?.stop();
        }, 1500);
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
        if (autoSendRef.current) {
          autoSendRef.current = false;
          // Small delay so React can flush the setInput call from onresult
          // before handleSend reads the input value.
          setTimeout(() => { handleSendRef.current?.(); }, 100);
        }
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

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  };

  // Stop = finalize whatever was heard so far (onresult still fires, then onend).
  const handleStopRecording = () => {
    clearSilenceTimer();
    stoppingRef.current = true;
    recognitionRef.current?.stop();
  };

  // Cancel = discard the recording entirely, no transcript inserted.
  const handleCancelRecording = () => {
    clearSilenceTimer();
    autoSendRef.current = false;
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
              Order Tracker ↗
            </a>
            <button
              onClick={() => setShowCartDrawer(true)}
              className="relative text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
              title="Cart"
            >
              <ShoppingCart size={18} />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-semibold grid place-items-center">
                  {cartCount}
                </span>
              )}
            </button>
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

                    {/* Inline checkout card — shown when user confirmed a product */}
                    {turn.checkout && (
                      <InlineCheckout
                        {...turn.checkout}
                        onConfirm={() => {
                          if (turn.checkout?.checkoutData) {
                            doPayment(turn.id, turn.checkout.checkoutData, turn.checkout.selectedCard, turn.checkout.product);
                          }
                        }}
                        onCancel={() => cancelCheckout(turn.id)}
                        onCardChange={(cardId) => updateCheckoutCard(turn.id, cardId)}
                        onGuestCardChange={(card) => updateGuestCard(turn.id, card)}
                      />
                    )}

                    {/* Skeleton cards — shown while the active turn is loading */}
                    {isActiveTurn && turn.products.length === 0 && turn.steps.length > 0 && (
                      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="w-64 shrink-0"><SkeletonProductCard /></div>
                        ))}
                      </div>
                    )}

                    {/* Intent badge — what the AI understood */}
                    {turn.products.length > 0 && Object.keys(turn.intent).length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">AI matched:</span>
                        {turn.intent.color && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium capitalize">{turn.intent.color}</span>}
                        {turn.intent.size && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium">size {turn.intent.size}</span>}
                        {turn.intent.maxPrice && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium">under ${turn.intent.maxPrice}</span>}
                        {turn.intent.brand && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium">{turn.intent.brand}</span>}
                      </div>
                    )}

                    {/* Sort bar + product grid */}
                    {turn.products.length > 0 && (() => {
                      const sortMode = turnSortModes.get(turn.id) ?? "match";
                      const sorted = sortProducts(turn.products, sortMode);
                      const setSortMode = (m: SortMode) => setTurnSortModes(prev => new Map(prev).set(turn.id, m));
                      return (
                        <div className="flex flex-col gap-2">
                          {/* Sort bar */}
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] text-[var(--color-text-muted)] mr-1">Sort:</span>
                            {([
                              { key: "match", label: "Best Match", icon: <ArrowUpDown size={10} /> },
                              { key: "price", label: "↓ Price", icon: <TrendingDown size={10} /> },
                              { key: "rating", label: "Top Rated", icon: <Star size={10} /> },
                              { key: "delivery", label: "Fastest", icon: <Zap size={10} /> },
                            ] as { key: SortMode; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
                              <button
                                key={key}
                                onClick={() => setSortMode(key)}
                                className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                                  sortMode === key
                                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                                    : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                                }`}
                              >
                                {icon} {label}
                              </button>
                            ))}
                          </div>
                          {/* Cards — horizontal scroll row */}
                          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                            {sorted.map((p, i) => (
                              <div key={p.product_id} className="w-64 shrink-0">
                                <ProductCard
                                  product={p}
                                  index={i}
                                  selected={selectedProducts.has(p.product_id)}
                                  onToggleSelect={handleToggleSelect}
                                  matchTags={computeMatchTags(turn.intent, p)}
                                  onAdded={(cartItem) => {
                                    getCart().then((items) => setCartCount(items.length)).catch(() => {});
                                    if (cartItem) {
                                      setSessionCartCount((n) => n + 1);
                                      setSessionCartIds((prev) => new Set(prev).add(cartItem.cart_item_id));
                                      setSessionCartItems((prev) => {
                                        if (prev.some((i) => i.cart_item_id === cartItem.cart_item_id)) return prev;
                                        return [...prev, cartItem];
                                      });
                                    }
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Follow-up chips */}
                    {turn.products.length > 0 && !isActiveTurn && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[10px] text-[var(--color-text-muted)]">Ask:</span>
                        {generateFollowUpChips(turn.products, turn.intent).map((chip) => (
                          <button
                            key={chip}
                            onClick={() => { setInput(chip); textareaRef.current?.focus(); }}
                            className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-primary)]/40 text-[var(--color-primary)] bg-[var(--color-primary)]/5 hover:bg-[var(--color-primary)]/15 hover:border-[var(--color-primary)] transition-all font-medium"
                          >
                            {chip}
                          </button>
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
                  "Blue running shoes arriving in 2 days",
                  "Wireless headphones with great reviews",
                  "Dress for a formal occasion",
                  "Blue polo shirt in size M",
                  "Sony noise cancelling earbuds",
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

        {/* Inline cart panel — collapsible, shows session items without leaving chat */}
        <AnimatePresence>
          {sessionCartItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mx-6 mb-2 rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-surface)] overflow-hidden"
            >
              {/* Header — always visible */}
              <button
                onClick={() => setCartPanelOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--color-bg)] transition-colors"
              >
                <div className="flex items-center gap-2 text-sm text-[var(--color-primary)] font-semibold">
                  <ShoppingCart size={15} />
                  <span>{sessionCartItems.length} item{sessionCartItems.length !== 1 ? "s" : ""} in your cart</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    ${sessionCartItems.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2)}
                  </span>
                  {cartPanelOpen ? <ChevronUp size={14} className="text-[var(--color-primary)]" /> : <ChevronDown size={14} className="text-[var(--color-primary)]" />}
                </div>
              </button>

              {/* Expanded item list */}
              <AnimatePresence>
                {cartPanelOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 flex flex-col gap-2 border-t border-[var(--color-border)]">
                      {sessionCartItems.map((item) => {
                        const visual = getProductVisual(item.title, item.category);
                        const ItemIcon = visual.icon;
                        return (
                          <div key={item.cart_item_id} className="flex items-center gap-3 pt-2">
                            <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
                              <ItemIcon size={16} className={visual.fg} strokeWidth={1.5} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-[var(--color-text)] line-clamp-1">{item.title}</p>
                              <p className="text-[10px] text-[var(--color-text-muted)]">${item.price.toFixed(2)} · qty {item.quantity}</p>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  await removeFromCart(item.cart_item_id);
                                  setSessionCartItems((prev) => prev.filter((i) => i.cart_item_id !== item.cart_item_id));
                                  setSessionCartIds((prev) => { const s = new Set(prev); s.delete(item.cart_item_id); return s; });
                                  setSessionCartCount((n) => Math.max(0, n - 1));
                                  getCart().then((items) => setCartCount(items.length)).catch(() => {});
                                } catch { /* noop */ }
                              }}
                              className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors p-1 shrink-0"
                              title="Remove"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => {
                          setCartPanelOpen(false);
                          const item = sessionCartItems[0];
                          const product: ProductData = {
                            product_id: item.product_id,
                            merchant_id: item.merchant_id,
                            merchant_name: item.merchant_name,
                            title: item.title,
                            brand: item.brand,
                            category: item.category,
                            price: item.price,
                            currency: item.currency,
                            size: item.size,
                            color: item.color,
                            available: true,
                            inventory: 1,
                            delivery_days: item.delivery_days,
                            rating: item.rating,
                            review_count: 0,
                            shipping_cost: 0,
                            rank_score: 0,
                            source: "cart",
                            image_url: item.image_url,
                            weight_grams: null,
                            cushioning: null,
                          };
                          doCheckoutSummaryRef.current?.("Checkout from cart", product);
                        }}
                        className="mt-1 w-full py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-dark)] transition-colors flex items-center justify-center gap-1.5"
                      >
                        <ShoppingCart size={13} /> Checkout in Chat
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Compare bar — only shown when 2-4 products are selected */}
        {selectedProducts.size >= 2 && selectedProducts.size <= 4 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="mx-6 mb-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] px-4 py-2.5 flex items-center justify-between shadow-sm"
          >
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <GitCompare size={15} className="text-[var(--color-primary)]" />
              <span>{selectedProducts.size} products selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedProducts(new Map())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => setShowCompare(true)}
                className="flex items-center gap-1.5 text-sm font-semibold bg-[var(--color-primary)] text-white px-3 py-1.5 rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
              >
                <GitCompare size={13} /> Compare
              </button>
            </div>
          </motion.div>
        )}

        {/* Compare modal */}
        {showCompare && selectedProducts.size >= 2 && (
          <CompareModal
            products={Array.from(selectedProducts.values())}
            onClose={() => setShowCompare(false)}
            onAddToCart={(product) => {
              addToCart(product).then(() => {
                getCart().then((items) => setCartCount(items.length)).catch(() => {});
              }).catch(() => {});
            }}
          />
        )}

        {/* Cart drawer */}
        <CartDrawer
          open={showCartDrawer}
          onClose={() => {
            setShowCartDrawer(false);
            getCart().then((items) => setCartCount(items.length)).catch(() => {});
          }}
          sessionCartIds={sessionCartIds}
          onCheckout={(cartItem: CartItemData) => {
            setShowCartDrawer(false);
            const product: ProductData = {
              product_id: cartItem.product_id,
              merchant_id: cartItem.merchant_id,
              merchant_name: cartItem.merchant_name,
              title: cartItem.title,
              brand: cartItem.brand,
              category: cartItem.category,
              price: cartItem.price,
              currency: cartItem.currency,
              size: cartItem.size,
              color: cartItem.color,
              available: true,
              inventory: 1,
              delivery_days: cartItem.delivery_days,
              rating: cartItem.rating,
              review_count: 0,
              shipping_cost: 0,
              rank_score: 0,
              source: "cart",
              image_url: cartItem.image_url,
              weight_grams: null,
              cushioning: null,
            };
            doCheckoutSummaryRef.current?.("Checkout", product);
          }}
        />

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
            <>
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
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 text-center">
              Say <span className="font-medium text-[var(--color-primary)]">"choose first"</span> · <span className="font-medium text-[var(--color-primary)]">"confirm"</span> · <span className="font-medium text-[var(--color-primary)]">"cancel"</span> to act hands-free
            </p>
          </>
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
        activeProducts={turns.find((t) => t.id === activeTurnId.current)?.products}
        activeIntent={turns.find((t) => t.id === activeTurnId.current)?.intent}
        activeRecommendation={turns.find((t) => t.id === activeTurnId.current)?.recommendation}
      />
    </div>
  );
}
