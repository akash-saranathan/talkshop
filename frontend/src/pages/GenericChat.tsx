/**
 * GenericChat — Phase 3 frontend for the v3 generic agent.
 *
 * Layout: [Sidebar] | [Chat center] | [Protocol Trace]
 *
 * Protocol selector (header toggle):
 *   A2A + UCP + ACP + AP2  → Case 1: customer with inline hosted card fields
 *   A2A + UCP + AP2        → Case 2: pre-registered demo instruments (guest)
 *
 * Human-in-the-loop pauses:
 *   1. product_selection — user picks a product from the grid
 *   2. approve_pay       — user confirms totals + provides payment
 */
import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, LogOut, Activity, ChevronRight, ChevronLeft, Plus, Minus,
  ShoppingBag, CreditCard, CheckCircle2, AlertCircle, Store, Loader2,
  SlidersHorizontal, Star, Lock,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { authFetch, getToken } from "../api/client";
import ProtocolTracePanel, { type ProtocolEvent } from "../components/ProtocolTracePanel";
import { mockTokenize, formatCardNumber, formatExpiry, type TokenizedCard } from "../utils/mockTokenizer";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Variant { size: string; color: string; available: boolean; inventory: number }

interface Product {
  id: string;
  title: string;
  price: number;
  rating: number;
  merchant_id: string;
  merchant_name: string;
  category: string;
  image_url?: string;
  variants: Variant[];
  description?: string;
}

interface CheckoutInfo {
  ucp_session_id: string;
  product: { id: string; title: string; price: number; merchant: string; variant?: object };
  totals: { subtotal: number; fulfillment: number; tax: number; total: number };
  use_acp: boolean;
}

interface OrderInfo {
  order_id: string;
  order_label: string;
  order_url?: string;
  totals: Record<string, number>;
  product: { id: string; title: string; merchant: string };
  payment_display: { brand: string; last4: string; token_type: string };
  mandates: { intent: string; cart: string; payment: string };
}

interface Instrument {
  id: string;
  network: string;
  last4: string;
  label: string;
  expiry: string;
  payment_token: string;
}

type FlowState =
  | "idle"
  | "searching"
  | "products_shown"
  | "checkout_loading"
  | "payment_ready"
  | "ordering"
  | "complete"
  | "error";

// ── Protocol stack label helper ───────────────────────────────────────────────

function ProtocolStack({ useAcp }: { useAcp: boolean }) {
  const protocols = useAcp
    ? ["A2A", "UCP", "ACP", "AP2"]
    : ["A2A", "UCP", "AP2"];
  const colors: Record<string, string> = {
    A2A: "bg-blue-100 text-blue-700", UCP: "bg-violet-100 text-violet-700",
    ACP: "bg-indigo-100 text-indigo-700", AP2: "bg-amber-100 text-amber-700",
  };
  return (
    <div className="flex items-center gap-1">
      {protocols.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[p]}`}>{p}</span>
          {i < protocols.length - 1 && <ChevronRight size={10} className="text-[var(--color-text-muted)]" />}
        </span>
      ))}
    </div>
  );
}

// ── Product card (simplified — direct-purchase flow) ──────────────────────────

function GenericProductCard({
  product, index, selectable, onSelect,
}: { product: Product; index: number; selectable: boolean; onSelect: () => void }) {
  const rankColors = ["bg-amber-400", "bg-slate-400", "bg-amber-700"];
  const merchantColors: Record<string, string> = {
    nike: "bg-blue-100 text-blue-700", adidas: "bg-sky-100 text-sky-700",
    zara: "bg-rose-100 text-rose-700", hm: "bg-pink-100 text-pink-700",
    fossil: "bg-stone-100 text-stone-700", casio: "bg-teal-100 text-teal-700",
  };
  const badgeClass = merchantColors[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const available = product.variants.some((v) => v.available);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3 flex flex-col gap-2"
    >
      {/* Visual placeholder */}
      <div className="relative h-20 rounded-lg bg-[var(--color-surface-2)] flex items-center justify-center">
        {index < 3 && (
          <span className={`absolute top-1 left-1 w-5 h-5 rounded-full text-[10px] font-bold grid place-items-center text-white ${rankColors[index]}`}>
            #{index + 1}
          </span>
        )}
        <ShoppingBag size={28} className="text-[var(--color-text-muted)]" strokeWidth={1.5} />
      </div>

      <span className={`self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badgeClass}`}>
        {product.merchant_name}
      </span>

      <p className="text-xs font-semibold text-[var(--color-text)] leading-tight line-clamp-2">{product.title}</p>

      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
        <span className="text-amber-400">★</span>
        <span>{product.rating.toFixed(1)}</span>
        {product.variants.length > 0 && (
          <span className="ml-auto">{product.variants.length} variant{product.variants.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto">
        <span className="text-sm font-bold text-[var(--color-primary)]">${product.price.toFixed(2)}</span>
        {selectable ? (
          <button
            onClick={onSelect}
            disabled={!available}
            className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] disabled:opacity-40 transition-colors"
          >
            Select
          </button>
        ) : (
          <span className="text-[10px] text-[var(--color-text-muted)]">{available ? "In stock" : "Out of stock"}</span>
        )}
      </div>
    </motion.div>
  );
}

// ── Inline hosted payment fields (Case 1 — ACP path) ─────────────────────────

function MockHostedPaymentField({ onTokenize }: { onTokenize: (card: TokenizedCard) => void }) {
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const handleTokenize = () => {
    setErr(null);
    try {
      if (!expiry || expiry.length < 4) throw new Error("Enter a valid expiry");
      if (cvv.length < 3) throw new Error("Enter a valid CVV");
      const result = mockTokenize(cardNumber);
      onTokenize(result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const inputCls = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] font-mono";

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Lock size={11} />
        <span>Card fields are isolated — data never leaves your browser</span>
      </div>
      <input
        value={cardNumber}
        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
        placeholder="4111 1111 1111 1111"
        maxLength={19}
        className={inputCls}
        autoComplete="off"
      />
      <div className="flex gap-2">
        <input
          value={expiry}
          onChange={(e) => setExpiry(formatExpiry(e.target.value))}
          placeholder="MM/YY"
          maxLength={5}
          className={inputCls + " flex-1"}
          autoComplete="off"
        />
        <input
          value={cvv}
          onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="CVV"
          maxLength={4}
          className={inputCls + " flex-1"}
          autoComplete="off"
        />
      </div>
      {err && <p className="text-xs text-rose-500">{err}</p>}
      <button
        onClick={handleTokenize}
        className="py-2 rounded-lg text-xs font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text)] transition-colors"
      >
        Tokenize card securely
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GenericChat() {
  const { user, logout, isGuest } = useAuth();

  // ── Core flow state ──────────────────────────────────────────────────────
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [useAcp, setUseAcp] = useState(!isGuest);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Protocol trace ───────────────────────────────────────────────────────
  const [protocolEvents, setProtocolEvents] = useState<ProtocolEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(true);

  // ── Products ─────────────────────────────────────────────────────────────
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [filterBrand, setFilterBrand] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"rating" | "price">("rating");

  // ── Checkout ─────────────────────────────────────────────────────────────
  const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);

  // ── Payment ──────────────────────────────────────────────────────────────
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const [tokenizedCard, setTokenizedCard] = useState<TokenizedCard | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const esRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Load pre-registered instruments for Case 2
  useEffect(() => {
    authFetch("/api/generic/instruments")
      .then((r) => r.json())
      .then(setInstruments)
      .catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flowState, allProducts, checkoutInfo, orderInfo, protocolEvents.length]);

  // Cleanup SSE on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  // ── Filtered / sorted product list ───────────────────────────────────────
  const brands = useMemo(
    () => [...new Set(allProducts.map((p) => p.merchant_name))],
    [allProducts]
  );

  const displayProducts = useMemo(() => {
    let list = filterBrand
      ? allProducts.filter((p) => p.merchant_name === filterBrand)
      : allProducts;
    list = [...list].sort((a, b) =>
      sortMode === "price" ? a.price - b.price : b.rating - a.rating
    );
    return showAll ? list : list.slice(0, 3);
  }, [allProducts, filterBrand, sortMode, showAll]);

  const hiddenCount = useMemo(() => {
    const total = filterBrand
      ? allProducts.filter((p) => p.merchant_name === filterBrand).length
      : allProducts.length;
    return Math.max(0, total - (showAll ? total : 3));
  }, [allProducts, filterBrand, showAll]);

  // ── SSE session starter ───────────────────────────────────────────────────
  const startSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || flowState !== "idle") return;

    const sid = crypto.randomUUID().replace(/-/g, "");
    setSessionId(sid);
    setFlowState("searching");
    setProtocolEvents([]);
    setAllProducts([]);
    setCheckoutInfo(null);
    setOrderInfo(null);
    setTokenizedCard(null);
    setSelectedInstrument(null);
    setErrorMsg(null);
    setShowAll(false);
    setFilterBrand(null);

    const token = getToken();
    const url = `/api/generic/stream?q=${encodeURIComponent(query)}&session_id=${sid}&use_acp=${useAcp}&token=${encodeURIComponent(token ?? "")}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("protocol_event", (ev) => {
      setProtocolEvents((prev) => [...prev, JSON.parse(ev.data)]);
    });

    es.addEventListener("products_ready", (ev) => {
      const data = JSON.parse(ev.data);
      setAllProducts(data.products ?? []);
    });

    es.addEventListener("human_pause", (ev) => {
      const data = JSON.parse(ev.data);
      if (data.pause_type === "product_selection") setFlowState("products_shown");
      if (data.pause_type === "approve_pay")       setFlowState("payment_ready");
    });

    es.addEventListener("checkout_ready", (ev) => {
      const data = JSON.parse(ev.data);
      setCheckoutInfo(data);
    });

    es.addEventListener("order_complete", (ev) => {
      const data = JSON.parse(ev.data);
      setOrderInfo(data);
      setFlowState("complete");
      es.close();
    });

    es.addEventListener("error", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? "{}");
        setErrorMsg(data.message ?? "An error occurred");
      } catch {
        setErrorMsg("An unexpected error occurred");
      }
      setFlowState("error");
      es.close();
    });

    es.addEventListener("done", () => es.close());

    es.onerror = () => {
      if (flowState === "searching") {
        setErrorMsg("Connection lost — please try again.");
        setFlowState("error");
      }
    };
  };

  // ── Resume: product selected ──────────────────────────────────────────────
  const selectProduct = async (product: Product) => {
    setFlowState("checkout_loading");
    try {
      await authFetch("/api/generic/resume", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          action: "select_product",
          data: { product_id: product.id, quantity: 1 },
        }),
      });
    } catch {
      setErrorMsg("Failed to select product — please try again.");
      setFlowState("error");
    }
  };

  // ── Resume: approve & pay ─────────────────────────────────────────────────
  const approvePay = async () => {
    setFlowState("ordering");

    const paymentData = useAcp
      ? { payment_method: tokenizedCard!.pm, brand: tokenizedCard!.brand, last4: tokenizedCard!.last4 }
      : { payment_token: selectedInstrument!.payment_token, brand: selectedInstrument!.network, last4: selectedInstrument!.last4 };

    try {
      await authFetch("/api/generic/resume", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, action: "approve_pay", data: paymentData }),
      });
    } catch {
      setErrorMsg("Payment failed — please try again.");
      setFlowState("error");
    }
  };

  const newSearch = () => {
    esRef.current?.close();
    esRef.current = null;
    setFlowState("idle");
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const canApprove = useAcp ? !!tokenizedCard : !!selectedInstrument;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 border-r border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-[var(--color-border)]">
          <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)] text-white grid place-items-center shrink-0">
            <Store size={14} />
          </div>
          <span className="text-sm font-bold text-[var(--color-primary)]">Talkshop</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <button
            onClick={newSearch}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <Plus size={14} /> New search
          </button>
          {query && flowState !== "idle" && (
            <div className="mt-3">
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-1.5">Current</p>
              <div className="px-3 py-2 rounded-lg bg-[var(--color-primary-bg)] border border-[var(--color-primary)]/20">
                <p className="text-xs text-[var(--color-text)] line-clamp-2">{query}</p>
              </div>
            </div>
          )}
        </div>

        <div className="px-3 pb-3 border-t border-[var(--color-border)] pt-3">
          <p className="text-xs text-[var(--color-text-muted)] truncate mb-2">{user?.name}</p>
          <button onClick={logout}
            className="w-full flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors py-1">
            <LogOut size={13} /> Log out
          </button>
        </div>
      </aside>

      {/* ── Chat center ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <span className="text-sm font-semibold text-[var(--color-text)]">Generic Agent</span>

          {/* Protocol mode toggle */}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">Mode:</span>
            <button
              onClick={() => setUseAcp((v) => !v)}
              disabled={flowState !== "idle"}
              title={useAcp ? "Click to switch to pre-registered instruments" : "Click to switch to card + ACP"}
              className="flex items-center"
            >
              <ProtocolStack useAcp={useAcp} />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setTraceOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
            >
              <Activity size={13} />
              <span className="hidden sm:inline">Trace</span>
            </button>
            <button onClick={logout}
              className="md:hidden text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* Idle state */}
          {flowState === "idle" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4"
            >
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-primary)] text-white grid place-items-center">
                <Store size={26} />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-bold text-[var(--color-text)]">What are you looking for?</h2>
                <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-xs">
                  {useAcp
                    ? "Customer mode — you'll enter card details securely at checkout (ACP SPT)"
                    : "Guest mode — you'll select a pre-registered demo card at checkout"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {["Nike running shoes", "Zara summer dress", "Casio watch under $80", "Adidas sneakers"].map((s) => (
                  <button key={s} onClick={() => setQuery(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Query bubble */}
          {flowState !== "idle" && (
            <div className="flex justify-end">
              <div className="max-w-xs bg-[var(--color-primary)] text-white text-sm px-4 py-2.5 rounded-2xl rounded-br-sm">
                {query}
              </div>
            </div>
          )}

          {/* Searching indicator */}
          {(flowState === "searching" || flowState === "checkout_loading" || flowState === "ordering") && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
              <Loader2 size={16} className="animate-spin text-[var(--color-primary)]" />
              <span>
                {flowState === "searching"         && "Searching merchants via A2A…"}
                {flowState === "checkout_loading"  && "Creating UCP checkout session…"}
                {flowState === "ordering"          && "Processing AP2 mandates + completing order…"}
              </span>
            </motion.div>
          )}

          {/* Products */}
          {allProducts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  {allProducts.length} result{allProducts.length !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal size={12} className="text-[var(--color-text-muted)]" />
                  <button
                    onClick={() => setSortMode((m) => m === "rating" ? "price" : "rating")}
                    className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors flex items-center gap-1"
                  >
                    <Star size={11} /> {sortMode === "rating" ? "Rating" : "Price"}
                  </button>
                </div>
              </div>

              {/* Brand filter chips */}
              {brands.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <button
                    onClick={() => setFilterBrand(null)}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${!filterBrand ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/50"}`}
                  >
                    All
                  </button>
                  {brands.map((b) => (
                    <button key={b} onClick={() => setFilterBrand(filterBrand === b ? null : b)}
                      className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${filterBrand === b ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/50"}`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              )}

              {/* Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {displayProducts.map((p, i) => (
                  <GenericProductCard
                    key={p.id}
                    product={p}
                    index={i}
                    selectable={flowState === "products_shown"}
                    onSelect={() => selectProduct(p)}
                  />
                ))}
              </div>

              {/* Show more */}
              {hiddenCount > 0 && !showAll && (
                <button
                  onClick={() => setShowAll(true)}
                  className="mt-3 w-full py-2 rounded-xl border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  + {hiddenCount} more result{hiddenCount !== 1 ? "s" : ""}
                </button>
              )}
            </div>
          )}

          {/* Checkout totals + payment */}
          {checkoutInfo && flowState === "payment_ready" && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">

              {/* Product summary */}
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Order Summary</p>
                <p className="text-sm font-semibold text-[var(--color-text)] mt-1">{checkoutInfo.product.title}</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">{checkoutInfo.product.merchant}</p>
              </div>

              {/* Totals */}
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                {[
                  ["Subtotal",  checkoutInfo.totals.subtotal],
                  ["Shipping",  checkoutInfo.totals.fulfillment],
                  ["Tax (8%)",  checkoutInfo.totals.tax],
                ] .map(([label, amount]) => (
                  <div key={label as string} className="flex justify-between text-xs py-0.5">
                    <span className="text-[var(--color-text-muted)]">{label as string}</span>
                    <span className="text-[var(--color-text)]">${(amount as number).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[var(--color-border)] mt-1.5">
                  <span>Total</span>
                  <span className="text-[var(--color-primary)]">${checkoutInfo.totals.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Payment section */}
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-1.5">
                  <CreditCard size={12} /> Payment
                </p>

                {useAcp ? (
                  /* Case 1: inline hosted fields → ACP SPT */
                  tokenizedCard ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                      <Lock size={12} /> Card tokenized — {tokenizedCard.brand} •••• {tokenizedCard.last4}
                    </div>
                  ) : (
                    <MockHostedPaymentField onTokenize={setTokenizedCard} />
                  )
                ) : (
                  /* Case 2: pre-registered demo instruments */
                  <div className="space-y-2">
                    {instruments.map((inst) => (
                      <button key={inst.id} onClick={() => setSelectedInstrument(inst)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-sm transition-colors ${
                          selectedInstrument?.id === inst.id
                            ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)]"
                            : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50"
                        }`}
                      >
                        <CreditCard size={14} className="text-[var(--color-text-muted)]" />
                        <span className="font-medium">{inst.label}</span>
                        <span className="text-[var(--color-text-muted)] text-xs">•••• {inst.last4}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">exp {inst.expiry}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Approve button */}
              <div className="px-4 pb-4">
                <button
                  onClick={approvePay}
                  disabled={!canApprove}
                  className="w-full py-3 rounded-xl font-semibold text-sm bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  <Lock size={14} /> Approve & Pay ${checkoutInfo.totals.total.toFixed(2)}
                </button>
                {!canApprove && (
                  <p className="text-[11px] text-center text-[var(--color-text-muted)] mt-1">
                    {useAcp ? "Tokenize your card above to continue" : "Select a payment instrument above"}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {/* Order complete */}
          {orderInfo && flowState === "complete" && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-800">{orderInfo.order_label}</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    {orderInfo.product.title} · {orderInfo.product.merchant}
                  </p>
                </div>
              </div>

              {/* Total */}
              <div className="text-xs text-emerald-700 flex gap-4">
                <span>Total paid: <strong>${orderInfo.totals.total?.toFixed(2)}</strong></span>
                <span>{orderInfo.payment_display.brand} •••• {orderInfo.payment_display.last4}</span>
              </div>

              {/* Mandate chain summary */}
              <div className="rounded-lg bg-white/60 border border-emerald-100 px-3 py-2">
                <p className="text-[10px] font-semibold text-emerald-600 mb-1.5">AP2 Mandate Chain</p>
                {[
                  ["Intent", orderInfo.mandates.intent],
                  ["Cart",   orderInfo.mandates.cart],
                  ["Payment",orderInfo.mandates.payment],
                ].map(([label, id]) => (
                  <div key={label} className="flex items-start gap-1.5 text-[10px] text-emerald-700 py-0.5">
                    <span className="font-medium w-12 shrink-0">{label}</span>
                    <span className="text-[9px] font-mono text-emerald-600/80 break-all">{id.slice(0, 42)}…</span>
                  </div>
                ))}
              </div>

              <button onClick={newSearch}
                className="w-full py-2 rounded-lg text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition-colors">
                Start new search
              </button>
            </motion.div>
          )}

          {/* Error */}
          {flowState === "error" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
              <AlertCircle size={16} className="text-rose-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-rose-700">{errorMsg ?? "Something went wrong"}</p>
                <button onClick={newSearch}
                  className="mt-2 text-xs text-rose-600 hover:text-rose-800 underline">
                  Try again
                </button>
              </div>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Search input */}
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shrink-0">
          <form onSubmit={startSearch} className="flex gap-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are you looking for? (e.g. Nike shoes, Zara dress…)"
              disabled={flowState !== "idle"}
              className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!query.trim() || flowState !== "idle"}
              className="w-10 h-10 rounded-xl bg-[var(--color-primary)] text-white flex items-center justify-center hover:bg-[var(--color-primary-light)] disabled:opacity-40 transition-colors shrink-0"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      </main>

      {/* ── Right protocol trace panel ────────────────────────────────────── */}
      <AnimatePresence>
        {traceOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden lg:flex flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shrink-0"
            style={{ width: 280 }}
          >
            <ProtocolTracePanel events={protocolEvents} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
