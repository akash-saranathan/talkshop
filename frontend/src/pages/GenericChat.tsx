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
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, LogOut, Activity, ChevronRight, ChevronLeft, Plus, Minus,
  ShoppingBag, CreditCard, CheckCircle2, AlertCircle, Store, Loader2, Circle,
  SlidersHorizontal, Star, Lock, LayoutDashboard, Trash2, Package, Scale, X,
  Sparkles, Trophy, Zap,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext";
import { authFetch, getToken } from "../api/client";
import ProtocolTracePanel, { type ProtocolEvent } from "../components/ProtocolTracePanel";
import { mockTokenize, formatCardNumber, formatExpiry, type TokenizedCard } from "../utils/mockTokenizer";
import { getProductImageUrl } from "../utils/productImages";

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

// ── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-[var(--color-primary-bg)] border border-[var(--color-primary)]/30 grid place-items-center shrink-0 text-[11px] font-bold text-[var(--color-primary)]">
        AI
      </div>
      <div className="flex items-center gap-1.5 rounded-xl rounded-tl-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] opacity-60 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }} />
        ))}
      </div>
    </div>
  );
}

// ── Skeleton product card ─────────────────────────────────────────────────────
function ProductCardSkeleton({ index }: { index: number }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3 flex flex-col gap-2 animate-pulse"
      style={{ animationDelay: `${index * 0.1}s` }}>
      <div className="h-28 rounded-lg bg-[var(--color-surface-2)]" />
      <div className="h-3 w-16 rounded bg-[var(--color-surface-2)]" />
      <div className="h-3 w-full rounded bg-[var(--color-surface-2)]" />
      <div className="h-3 w-3/4 rounded bg-[var(--color-surface-2)]" />
      <div className="flex justify-between mt-auto">
        <div className="h-4 w-12 rounded bg-[var(--color-surface-2)]" />
        <div className="h-7 w-16 rounded-lg bg-[var(--color-surface-2)]" />
      </div>
    </div>
  );
}

// ── Render bold markdown (**text**) ──────────────────────────────────────────
function MarkdownText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </span>
  );
}

// ── Compare modal — AI-powered, matches main branch ──────────────────────────

interface AiVerdict {
  winner_product_id: string;
  headline: string;
  reasoning: string;
  trade_offs: string[];
}

const NUMBER_PATTERN = /(\$[\d,]+(?:\.\d{1,2})?|\d+(?:\.\d+)?\/5|\d+(?:\.\d+)?-star|\d{1,3}(?:,\d{3})*\+?\s*reviews?)/gi;
function highlightNumbers(text: string) {
  return text.split(NUMBER_PATTERN).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-bold text-[var(--color-text)]">{part}</strong>
      : part
  );
}

const COMPARE_SPECS: { label: string; render: (p: Product) => React.ReactNode; highlight?: (p: Product, all: Product[]) => boolean }[] = [
  { label: "Price",    render: (p) => `$${p.price.toFixed(2)}`,
    highlight: (p, all) => p.price === Math.min(...all.map(x => x.price)) },
  { label: "Rating",   render: (p) => `★ ${p.rating.toFixed(1)}`,
    highlight: (p, all) => p.rating === Math.max(...all.map(x => x.rating)) },
  { label: "Merchant", render: (p) => p.merchant_name },
  { label: "Category", render: (p) => p.category || "—" },
  { label: "Variants", render: (p) => `${p.variants.filter(v => v.available).length} in stock` },
  { label: "In Stock", render: (p) => p.variants.some(v => v.available)
      ? <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Yes</span>
      : <span className="text-[10px] font-semibold text-rose-500 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">No</span> },
];

function CompareModal({ products, onClose, onSelect, selectable, selectedProductIds }: {
  products: Product[];
  onClose: () => void;
  onSelect: (p: Product) => void;
  selectable: boolean;
  selectedProductIds?: Set<string>;
}) {
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(true);

  useEffect(() => {
    setVerdictLoading(true);
    authFetch("/api/compare", {
      method: "POST",
      body: JSON.stringify({
        products: products.map((p) => ({
          product_id: p.id,
          title: p.title,
          brand: p.merchant_name,
          price: p.price,
          rating: p.rating,
          review_count: 0,
          delivery_days: 3,
          shipping_cost: 0,
          merchant_name: p.merchant_name,
        })),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setVerdict(data); })
      .catch(() => {})
      .finally(() => setVerdictLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 24, stiffness: 280 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <Scale size={15} className="text-[var(--color-primary)]" />
            <h2 className="font-semibold text-[var(--color-text)]">Compare {products.length} products</h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* AI Verdict */}
          <AnimatePresence mode="wait">
            {verdictLoading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="mx-5 my-4 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-4 py-3 flex items-center gap-3">
                <Sparkles size={16} className="text-[var(--color-primary)] shrink-0 animate-pulse" />
                <div className="flex items-center gap-2 text-sm text-[var(--color-primary)]">
                  <Loader2 size={13} className="animate-spin shrink-0" />
                  <span>AI is analysing these products…</span>
                </div>
              </motion.div>
            ) : verdict ? (
              <motion.div key="verdict" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="mx-5 my-4 rounded-xl border border-[var(--color-primary)]/30 bg-gradient-to-br from-[var(--color-primary)]/8 to-violet-500/5 px-4 py-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-[var(--color-primary)] shrink-0" />
                  <span className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">AI Recommendation</span>
                </div>
                {(() => {
                  const winner = products.find((p) => p.id === verdict.winner_product_id);
                  return winner ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <Trophy size={14} className="text-amber-500 shrink-0" />
                      <span className="text-sm font-semibold text-[var(--color-text)]">{verdict.headline}</span>
                    </div>
                  ) : null;
                })()}
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{highlightNumbers(verdict.reasoning)}</p>
                {verdict.trade_offs.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {verdict.trade_offs.map((t, i) => (
                      <li key={i} className="text-[11px] text-[var(--color-text-muted)] flex items-start gap-1.5">
                        <span className="text-[var(--color-border)] mt-0.5">•</span>
                        <span>{highlightNumbers(t)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Specs table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] w-28">Spec</th>
                  {products.map((p) => {
                    const isWinner = verdict?.winner_product_id === p.id;
                    const isSelected = selectedProductIds?.has(p.id);
                    return (
                      <th key={p.id} className={`px-4 py-3 text-center min-w-[160px] ${isWinner ? "bg-[var(--color-primary)]/5" : ""}`}>
                        {isWinner && (
                          <div className="flex items-center justify-center gap-1 mb-1.5">
                            <Trophy size={11} className="text-amber-500" />
                            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Best Pick</span>
                          </div>
                        )}
                        <div className={`w-16 h-16 rounded-lg overflow-hidden mx-auto mb-2 bg-[var(--color-surface-2)] ${isWinner ? "ring-2 ring-[var(--color-primary)]/40" : ""}`}>
                          <img src={getProductImageUrl(p.merchant_id, p.id)} alt={p.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                        <p className={`text-xs font-semibold line-clamp-2 leading-tight ${isWinner ? "text-[var(--color-primary)]" : "text-[var(--color-text)]"}`}>{p.title}</p>
                        {isSelected && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={8} /> Selected
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {COMPARE_SPECS.map((spec) => (
                  <tr key={spec.label} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-bg)] transition-colors">
                    <td className="px-5 py-2.5 text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{spec.label}</td>
                    {products.map((p) => {
                      const isBest = spec.highlight?.(p, products) ?? false;
                      return (
                        <td key={p.id} className={`px-4 py-2.5 text-center text-sm ${isBest ? "text-emerald-600 font-bold" : "text-[var(--color-text)]"}`}>
                          {spec.render(p)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action row */}
        {selectable && (
          <div className="grid px-5 py-4 gap-3 border-t border-[var(--color-border)] shrink-0"
            style={{ gridTemplateColumns: `7rem repeat(${products.length}, 1fr)` }}>
            <div className="flex items-center">
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Select</span>
            </div>
            {products.map((p) => {
              const isSelected = selectedProductIds?.has(p.id);
              const available = p.variants.some(v => v.available);
              return (
                <button key={p.id}
                  onClick={() => { onSelect(p); onClose(); }}
                  disabled={!available}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                    isSelected
                      ? "bg-emerald-500 text-white hover:bg-emerald-600"
                      : "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)]"
                  }`}>
                  {isSelected ? <><CheckCircle2 size={11} /> Selected</> : "Select for purchase"}
                </button>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="px-5 pb-3 flex items-center gap-4 text-[10px] text-[var(--color-text-muted)] shrink-0">
          <span className="flex items-center gap-1"><span className="text-emerald-600 font-bold">Green</span> = best value</span>
          <span className="flex items-center gap-1"><Star size={10} className="text-amber-500" /> <span className="text-amber-600 font-bold">Amber</span> = top rated</span>
          <span className="flex items-center gap-1"><Zap size={10} className="text-emerald-600" /> <span className="text-emerald-600 font-semibold">AI verdict above</span></span>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

// ── Product card (simplified — direct-purchase flow) ──────────────────────────

// Merchant brand colors used as fallback background
const MERCHANT_BG: Record<string, { grad: string }> = {
  nike:   { grad: "from-blue-500 to-blue-700"   },
  adidas: { grad: "from-slate-600 to-slate-800"  },
  zara:   { grad: "from-rose-400 to-rose-600"    },
  hm:     { grad: "from-pink-400 to-pink-600"    },
  fossil: { grad: "from-stone-500 to-stone-700"  },
  casio:  { grad: "from-teal-500 to-teal-700"    },
};

interface MatchTags { brand?: string; category?: string; color?: string; size?: string; max_price?: number }

function GenericProductCard({
  product, index, selectable, isSelected, onSelect, matchTags, inCompare, onToggleCompare,
}: {
  product: Product; index: number; selectable: boolean; isSelected?: boolean; onSelect: () => void;
  matchTags?: MatchTags | null; inCompare?: boolean; onToggleCompare?: () => void;
}) {
  const rankColors = ["bg-amber-400", "bg-slate-400", "bg-amber-700"];
  const merchantBadgeColors: Record<string, string> = {
    nike: "bg-blue-100 text-blue-700", adidas: "bg-sky-100 text-sky-700",
    zara: "bg-rose-100 text-rose-700", hm: "bg-pink-100 text-pink-700",
    fossil: "bg-stone-100 text-stone-700", casio: "bg-teal-100 text-teal-700",
  };
  const badgeClass = merchantBadgeColors[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const available = product.variants.some((v) => v.available);
  const fbGrad = (MERCHANT_BG[product.merchant_id] ?? { grad: "from-slate-400 to-slate-600" }).grad;
  const [imgOk, setImgOk] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`border rounded-xl p-3 flex flex-col gap-2 transition-colors ${
        isSelected
          ? "bg-emerald-50/40 border-emerald-300 shadow-sm shadow-emerald-100"
          : "bg-[var(--color-surface)] border-[var(--color-border)]"
      }`}
    >
      {/* Product image — Picsum seeded by product id; fallback to brand gradient */}
      <div className={`relative h-28 rounded-lg overflow-hidden ${!imgOk ? `bg-gradient-to-br ${fbGrad}` : "bg-[var(--color-surface-2)]"}`}>
        {imgOk && (
          <img
            src={getProductImageUrl(product.merchant_id, product.id)}
            alt={product.title}
            className="w-full h-full object-cover"
            onError={() => setImgOk(false)}
          />
        )}
        {!imgOk && (
          <div className="flex items-center justify-center h-full">
            <ShoppingBag size={32} className="text-white opacity-60" strokeWidth={1.5} />
          </div>
        )}
        {index < 3 && (
          <span className="absolute top-1 left-1 w-5 h-5 rounded-full text-[10px] font-bold grid place-items-center bg-black/40 text-white">
            #{index + 1}
          </span>
        )}
        {onToggleCompare && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
            title={inCompare ? "Remove from compare" : "Add to compare"}
            className={`absolute top-1 right-1 w-6 h-6 rounded-full border-2 text-[9px] font-bold grid place-items-center transition-all ${
              inCompare
                ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white shadow-md"
                : "bg-white/80 border-white/60 text-slate-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            }`}
          >
            {inCompare ? <Scale size={10} /> : <Scale size={10} />}
          </button>
        )}
      </div>

      <span className={`self-start text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badgeClass}`}>
        {product.merchant_name}
      </span>

      <p className="text-xs font-semibold text-[var(--color-text)] leading-tight line-clamp-2">{product.title}</p>

      {matchTags && (
        <div className="flex flex-wrap gap-1">
          {matchTags.category && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{matchTags.category}</span>}
          {matchTags.color    && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100">{matchTags.color}</span>}
          {matchTags.size     && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">Size {matchTags.size}</span>}
          {matchTags.max_price && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">Under ${matchTags.max_price}</span>}
        </div>
      )}

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
            disabled={!available && !isSelected}
            className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 ${
              isSelected
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] disabled:opacity-40"
            }`}
          >
            {isSelected ? <><CheckCircle2 size={11} /> Selected</> : <>+ Select</>}
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

const SESSION_KEY = "gc_session_v1";
interface PersistedSession {
  userId: string;
  conversation: { role: "user" | "agent"; text: string }[];
  flowState: FlowState;
  allProducts: Product[];
  orderInfo: OrderInfo | null;
  history: { query: string; orderLabel?: string; ts: string }[];
}
function loadSession(): Partial<PersistedSession> {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}"); } catch { return {}; }
}

export default function GenericChat() {
  const { user, logout, isGuest } = useAuth();
  const _saved = useMemo(() => {
    const saved = loadSession();
    // Discard session if it belongs to a different user
    if (saved.userId && user?.user_id && saved.userId !== user.user_id) return {};
    return saved;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Core flow state ──────────────────────────────────────────────────────
  const [flowState, setFlowState] = useState<FlowState>((_saved.flowState ?? "idle") as FlowState);
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [useAcp, setUseAcp] = useState(!isGuest);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [guardrailMsg, setGuardrailMsg] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Conversational messages: { role, text, partialIntent? }
  interface ConvMsg { role: "user" | "agent"; text: string; partialIntent?: Record<string, unknown> }
  const [conversation, setConversation] = useState<ConvMsg[]>(_saved.conversation ?? []);
  const [priorIntent, setPriorIntent] = useState<Record<string, unknown> | null>(null);
  // Resolved intent from LLM — used for match badges
  interface ResolvedIntent { brand?: string; category?: string; color?: string; size?: string; max_price?: number }
  const [resolvedIntent, setResolvedIntent] = useState<ResolvedIntent | null>(null);

  // ── Session history (sidebar) ─────────────────────────────────────────────
  interface HistoryEntry {
    query: string;
    orderLabel?: string;
    ts: string;
    snapshot?: {
      conversation: ConvMsg[];
      products: Product[];
      resolvedIntent: ResolvedIntent | null;
    };
  }
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    // Deduplicate by query, keeping the first (most recent) occurrence of each
    const seen = new Set<string>();
    return (_saved.history ?? []).filter((e) => {
      if (seen.has(e.query)) return false;
      seen.add(e.query);
      return true;
    });
  });

  // Tracks which history entry is currently active (for sidebar highlight)
  const [activeQuery, setActiveQuery] = useState<string | null>(null);

  // ── Protocol trace ───────────────────────────────────────────────────────
  const [protocolEvents, setProtocolEvents] = useState<ProtocolEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(true);

  // ── Products ─────────────────────────────────────────────────────────────
  const [allProducts, setAllProducts] = useState<Product[]>(_saved.allProducts ?? []);
  const [showAll, setShowAll] = useState(false);
  const [filterBrand, setFilterBrand] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"rating" | "price" | "fastest" | "best">("rating");
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  // ── Checkout ─────────────────────────────────────────────────────────────
  const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>((_saved.orderInfo as OrderInfo | null) ?? null);

  // ── Payment ──────────────────────────────────────────────────────────────
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);
  const [tokenizedCard, setTokenizedCard] = useState<TokenizedCard | null>(null);
  const [showNewCardForm, setShowNewCardForm] = useState(false);

  // ── (Order tracker removed — delivery status shown inline in order card) ──

  // ── Multi-product selection (agentic) ────────────────────────────────────
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);

  // ── Loyalty points ───────────────────────────────────────────────────────
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const esRef = useRef<EventSource | null>(null);
  const lastLaunchRef = useRef<{ q: string; ts: number }>({ q: "", ts: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Load instruments — for guest: selection list; for customer: auto-use first card
  useEffect(() => {
    authFetch("/api/generic/instruments")
      .then((r) => r.json())
      .then((data: Instrument[]) => {
        setInstruments(data);
        // Customers: auto-select the first registered card — no manual selection needed
        if (!isGuest && data.length > 0) setSelectedInstrument(data[0]);
      })
      .catch(() => {});
  }, [isGuest]);

  // Fetch loyalty balance (non-guest only)
  useEffect(() => {
    if (!isGuest) {
      authFetch("/api/loyalty")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => d && setLoyaltyBalance(d.balance))
        .catch(() => {});
    }
  }, [isGuest]);

  // Persist key session state so back-navigation restores it
  useEffect(() => {
    try {
      const data: PersistedSession = {
        userId: user?.user_id ?? "",
        conversation: conversation.map(({ role, text }) => ({ role, text })),
        flowState,
        allProducts,
        orderInfo,
        history,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch { /* storage quota exceeded — ignore */ }
  }, [conversation, flowState, allProducts, orderInfo, history]);

  // Customer: re-auto-select default card when payment step is reached (instruments already loaded)
  useEffect(() => {
    if (flowState === "payment_ready" && !isGuest && !selectedInstrument && instruments.length > 0) {
      setSelectedInstrument(instruments[0]);
    }
  }, [flowState, isGuest, instruments, selectedInstrument]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flowState, allProducts, checkoutInfo, orderInfo, protocolEvents.length, conversation.length]);

  // Snapshot: when products are displayed, save conversation + products into the history entry
  // so clicking that entry later restores instead of re-running.
  useEffect(() => {
    if (flowState === "products_shown" && activeQuery && allProducts.length > 0) {
      setHistory((h) => h.map((e) =>
        e.query === activeQuery
          ? { ...e, snapshot: { conversation, products: allProducts, resolvedIntent } }
          : e
      ));
    }
  // Only fire when flowState transitions to products_shown
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowState]);

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
    list = [...list].sort((a, b) => {
      if (sortMode === "price")   return a.price - b.price;
      if (sortMode === "fastest") return (a as any).delivery_days - (b as any).delivery_days;
      if (sortMode === "best")    return b.rating * 10 - (a.price / 10) - (b.rating * 10 - (b.price / 10));
      return b.rating - a.rating; // default: rating
    });
    return showAll ? list : list.slice(0, 3);
  }, [allProducts, filterBrand, sortMode, showAll]);

  const hiddenCount = useMemo(() => {
    const total = filterBrand
      ? allProducts.filter((p) => p.merchant_name === filterBrand).length
      : allProducts.length;
    return Math.max(0, total - (showAll ? total : 3));
  }, [allProducts, filterBrand, showAll]);

  // ── Agentic multi-product selection ──────────────────────────────────────
  const toggleProductSelection = (product: Product) => {
    setSelectedProducts((prev) =>
      prev.some((p) => p.id === product.id)
        ? prev.filter((p) => p.id !== product.id)
        : [...prev, product]
    );
  };

  const doneSelecting = () => {
    if (selectedProducts.length === 0) return;
    const names = selectedProducts.map((p) => p.title.split(" ").slice(0, 3).join(" ")).join(" & ");
    setConversation((prev) => [
      ...prev,
      { role: "user", text: `I'll take the ${names}` },
      { role: "agent", text: "Got it. I'll check availability and prepare the purchase — I'll handle the rest." },
    ]);
    selectProduct(selectedProducts[0]);
  };

  // ── Restore a saved history entry (no re-fetch) ──────────────────────────
  const restoreEntry = (entry: { query: string; snapshot?: { conversation: ConvMsg[]; products: Product[]; resolvedIntent: ResolvedIntent | null } }) => {
    if (!entry.snapshot) { launchSearch(entry.query); return; }
    esRef.current?.close();
    esRef.current = null;
    lastLaunchRef.current = { q: entry.query, ts: Date.now() };
    setActiveQuery(entry.query);
    setConversation(entry.snapshot.conversation);
    setAllProducts(entry.snapshot.products);
    setResolvedIntent(entry.snapshot.resolvedIntent);
    setFlowState("products_shown");
    setCheckoutInfo(null);
    setOrderInfo(null);
    setGuardrailMsg(null);
    setErrorMsg(null);
    setShowAll(false);
    setFilterBrand(null);
    setCompareSet(new Set());
    setCompareOpen(false);
    setSelectedProducts([]);
    setProtocolEvents([]);
  };

  // ── SSE session starter ───────────────────────────────────────────────────
  const launchSearch = (q: string) => {
    if (!q.trim()) return;

    // If this exact query is already streaming, ignore the click
    if (esRef.current && q === lastLaunchRef.current.q) return;
    lastLaunchRef.current = { q, ts: Date.now() };

    // Close any in-flight stream for a DIFFERENT query
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setQuery(""); // clear input immediately after submit
    setActiveQuery(q);
    // Save to sidebar history — skip if this query is already at the top
    setHistory((h) => {
      if (h.length > 0 && h[0].query === q) return h;
      return [{ query: q, ts: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) }, ...h];
    });

    const sid = crypto.randomUUID().replace(/-/g, "");
    setSessionId(sid);
    setFlowState("searching");
    setProtocolEvents([]);
    setAllProducts([]);
    setCheckoutInfo(null);
    setOrderInfo(null);
    setTokenizedCard(null);
    setSelectedInstrument(null);
    setShowNewCardForm(false);
    setErrorMsg(null);
    setGuardrailMsg(null);
    setConversation((prev) => [...prev, { role: "user", text: q }]);
    setShowAll(false);
    setFilterBrand(null);
    setCompareSet(new Set());
    setCompareOpen(false);
    setSelectedProducts([]);

    const token = getToken();
    const priorParam = priorIntent ? `&prior_intent=${encodeURIComponent(JSON.stringify(priorIntent))}` : "";
    const url = `/api/generic/stream?q=${encodeURIComponent(q)}&session_id=${sid}&use_acp=${useAcp}&token=${encodeURIComponent(token ?? "")}${priorParam}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("protocol_event", (ev) => {
      setProtocolEvents((prev) => [...prev, JSON.parse(ev.data)]);
    });

    es.addEventListener("chat_message", (ev) => {
      const data = JSON.parse(ev.data);
      setConversation((prev) => [...prev, { role: "agent", text: data.text, partialIntent: data.partial_intent }]);
      if (data.needs_clarification && data.partial_intent) {
        setPriorIntent(data.partial_intent);
      }
      setFlowState("idle");
      es.close();
    });

    es.addEventListener("intent_resolved", (ev) => {
      const data = JSON.parse(ev.data);
      setResolvedIntent(data);
    });

    es.addEventListener("products_ready", (ev) => {
      const data = JSON.parse(ev.data);
      setAllProducts(data.products ?? []);
      setPriorIntent(null); // intent fulfilled — clear for next search
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
      setHistory((h) => h.map((e, i) => i === 0 ? { ...e, orderLabel: data.order_label } : e));
      // Refresh loyalty balance after purchase
      if (!isGuest) {
        authFetch("/api/loyalty")
          .then((r) => r.ok ? r.json() : null)
          .then((d) => d && setLoyaltyBalance(d.balance))
          .catch(() => {});
      }
      es.close();
    });

    es.addEventListener("guardrail_block", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data ?? "{}");
        setGuardrailMsg(data.message ?? "That request can't be processed — I never share or expose payment credentials or personal data.");
      } catch {
        setGuardrailMsg("That request can't be processed — I never share or expose payment credentials or personal data.");
      }
      setFlowState("idle");
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

  const startSearch = (e: FormEvent) => { e.preventDefault(); launchSearch(query); };

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

    // Customer with new card → tokenized pm; customer with saved card or guest → instrument token
    const paymentData = useAcp && tokenizedCard
      ? { payment_method: tokenizedCard.pm, brand: tokenizedCard.brand, last4: tokenizedCard.last4 }
      : { payment_method: selectedInstrument!.payment_token, brand: selectedInstrument!.network, last4: selectedInstrument!.last4 };

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
    setAllProducts([]);
    setCheckoutInfo(null);
    setOrderInfo(null);
    setTokenizedCard(null);
    setSelectedInstrument(null);
    setShowNewCardForm(false);
    setErrorMsg(null);
    setGuardrailMsg(null);
    setConversation([]);
    setPriorIntent(null);
    setResolvedIntent(null);
    setProtocolEvents([]);
    setShowAll(false);
    setFilterBrand(null);
    setCompareSet(new Set());
    setCompareOpen(false);
    setSelectedProducts([]);
    setActiveQuery(null);
    lastLaunchRef.current = { q: "", ts: 0 };
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const canApprove = !!selectedInstrument || !!tokenizedCard;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      {sidebarCollapsed ? (
        <aside className="hidden md:flex flex-col w-10 border-r border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 items-center pt-3 gap-3">
          <button onClick={() => setSidebarCollapsed(false)} title="Expand sidebar"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
            <ChevronRight size={16} />
          </button>
          <Store size={15} className="text-[var(--color-primary)] opacity-60" />
        </aside>
      ) : (
      <aside className="hidden md:flex flex-col w-56 border-r border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-2 px-3 py-3.5 border-b border-[var(--color-border)]">
          <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)] text-white grid place-items-center shrink-0">
            <Store size={14} />
          </div>
          <span className="text-sm font-bold text-[var(--color-primary)]">Talkshop</span>
          <button onClick={() => setSidebarCollapsed(true)} title="Collapse"
            className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
            <ChevronLeft size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <button
            onClick={newSearch}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors mb-2"
          >
            <Plus size={14} /> New chat
          </button>

          {history.length > 0 && (
            <>
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide px-1 mb-1">Recent chats</p>
              {history.map((entry, i) => (
                <div key={i} className="group relative">
                  <button
                    onClick={() => restoreEntry(entry)}
                    className={`w-full text-left pl-3 pr-7 py-2 rounded-lg border transition-colors ${entry.query === activeQuery
                      ? "bg-[var(--color-primary-bg)] border-[var(--color-primary)]/30"
                      : "bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-surface-2)]"}`}>
                    <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2">{entry.query}</p>
                    {entry.orderLabel
                      ? <p className="text-[10px] text-emerald-600 mt-0.5">✓ {entry.orderLabel}</p>
                      : <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{entry.ts}</p>}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistory((h) => h.filter((e) => e.query !== entry.query));
                      if (entry.query === activeQuery) {
                        esRef.current?.close(); esRef.current = null;
                        setConversation([]); setAllProducts([]); setFlowState("idle");
                        setActiveQuery(null); lastLaunchRef.current = { q: "", ts: 0 };
                      }
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-text-muted)] hover:text-red-500 p-0.5"
                    title="Delete chat"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-3 pb-3 border-t border-[var(--color-border)] pt-3 space-y-1">
          <p className="text-xs font-medium text-[var(--color-text)] truncate">{user?.name}</p>
          {!isGuest && loyaltyBalance !== null && (
            <div className="flex items-center gap-1.5 mb-2">
              <Star size={11} className="fill-amber-400 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-600">{loyaltyBalance.toLocaleString()} pts</span>
            </div>
          )}
          <Link to="/dashboard"
            className="w-full flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors py-1">
            <LayoutDashboard size={13} /> Dashboard
          </Link>
          <button onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ } logout(); }}
            className="w-full flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors py-1">
            <LogOut size={13} /> Log out
          </button>
        </div>
      </aside>
      )}

      {/* ── Chat center ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <span className="text-sm font-semibold text-[var(--color-text)]">Intelligent Agentic Commerce</span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setTraceOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
            >
              <Activity size={13} />
              <span className="hidden sm:inline">Trace</span>
            </button>
            <button onClick={() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ } logout(); }}
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
                {!useAcp && (
                  <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-xs">
                    Guest mode — you'll select a payment method at checkout
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {["Nike running shoes", "Zara summer dress", "Casio watch under $80", "Adidas sneakers"].map((s) => (
                  <button key={s} onClick={() => launchSearch(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Conversation history — user queries + agent replies (chitchat, clarifying questions, guardrail blocks) */}
          {conversation.map((msg, i) => (
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-xs bg-[var(--color-primary)] text-white text-sm px-4 py-2.5 rounded-2xl rounded-br-sm">
                  {msg.text}
                </div>
              </div>
            ) : (
              <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-full bg-[var(--color-primary-bg)] border border-[var(--color-primary)]/30 grid place-items-center shrink-0 text-[11px] font-bold text-[var(--color-primary)]">
                  AI
                </div>
                <div className="flex-1 rounded-xl rounded-tl-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3">
                  <p className="text-sm text-[var(--color-text)] leading-relaxed"><MarkdownText text={msg.text} /></p>
                </div>
              </motion.div>
            )
          ))}

          {/* Guardrail block response */}
          {guardrailMsg && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-full bg-red-100 border border-red-200 grid place-items-center shrink-0">
                <Lock size={12} className="text-red-600" />
              </div>
              <div className="flex-1 rounded-xl rounded-tl-sm bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mb-1">Guardrails · Blocked</p>
                <p className="text-sm text-red-800 leading-relaxed">{guardrailMsg}</p>
              </div>
            </motion.div>
          )}

          {/* Searching indicator / typing animation */}
          {flowState === "searching" && <TypingIndicator />}

          {/* Agentic activity steps during checkout / ordering */}
          {(flowState === "checkout_loading" || flowState === "ordering") && (() => {
            const checkoutSteps = [
              { label: `${selectedProducts.length > 1 ? `${selectedProducts.length} items` : "Item"} confirmed`, done: true },
              { label: "Availability checked", done: protocolEvents.some(e => e.label === "catalog_results" || e.label === "task_result") },
              { label: "Purchase session created (UCP)", done: protocolEvents.some(e => e.label === "session_created") },
              { label: "Shipping & tax calculated", done: protocolEvents.some(e => e.label === "session_created") },
              { label: "Payment method ready", done: flowState === "ordering" },
            ];
            const orderingSteps = flowState === "ordering" ? [
              { label: "Authorization mandate chain (AP2)", done: protocolEvents.some(e => e.label === "all_mandates_submitted") },
              { label: "Delegated payment processed (ACP)", done: protocolEvents.some(e => e.label === "token_verified") },
              { label: "Placing order", done: false },
            ] : [];
            const steps = [...checkoutSteps, ...orderingSteps];
            const firstUndone = steps.findIndex(s => !s.done);
            return (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-full bg-[var(--color-primary-bg)] border border-[var(--color-primary)]/30 grid place-items-center shrink-0 text-[11px] font-bold text-[var(--color-primary)]">
                  AI
                </div>
                <div className="flex-1 rounded-xl rounded-tl-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3">
                  <p className="text-xs font-semibold text-[var(--color-text)] mb-2.5">
                    {flowState === "ordering" ? "Completing your purchase…" : "Preparing your purchase…"}
                  </p>
                  <div className="space-y-1.5">
                    {steps.map((step, i) => {
                      const isActive = i === firstUndone;
                      const isUpcoming = firstUndone !== -1 && i > firstUndone;
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {step.done
                            ? <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                            : isActive
                              ? <Loader2 size={11} className="animate-spin text-[var(--color-primary)] shrink-0" />
                              : <Circle size={11} className="text-[var(--color-text-muted)] opacity-20 shrink-0" />}
                          <span className={
                            step.done   ? "text-emerald-700" :
                            isActive    ? "text-[var(--color-text)]" :
                            isUpcoming  ? "text-[var(--color-text-muted)] opacity-40" :
                            "text-[var(--color-text-muted)]"
                          }>{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            );
          })()}

          {/* Skeleton cards while searching */}
          {flowState === "searching" && allProducts.length === 0 && protocolEvents.some(e => e.protocol === "A2A") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => <ProductCardSkeleton key={i} index={i} />)}
            </div>
          )}

          {/* Products */}
          {allProducts.length > 0 && flowState !== "idle" && (
            <div>
              {/* Intent badge */}
              {resolvedIntent && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-[10px] text-[var(--color-text-muted)] font-medium">AI matched:</span>
                  {resolvedIntent.brand    && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{resolvedIntent.brand}</span>}
                  {resolvedIntent.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{resolvedIntent.category}</span>}
                  {resolvedIntent.color    && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{resolvedIntent.color}</span>}
                  {resolvedIntent.size     && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Size {resolvedIntent.size}</span>}
                  {resolvedIntent.max_price && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Under ${resolvedIntent.max_price}</span>}
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  {allProducts.length} result{allProducts.length !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-0.5 bg-[var(--color-surface-2)] rounded-lg p-0.5 border border-[var(--color-border)]">
                  {(["rating", "price", "fastest", "best"] as const).map((mode) => (
                    <button key={mode}
                      onClick={() => setSortMode(mode)}
                      className={`text-[10px] px-2 py-1 rounded-md transition-colors font-medium ${
                        sortMode === mode
                          ? "bg-[var(--color-primary)] text-white"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      {mode === "rating" ? "★ Top" : mode === "price" ? "$ Low" : mode === "fastest" ? "⚡ Fast" : "✦ Best"}
                    </button>
                  ))}
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
                    isSelected={selectedProducts.some((sp) => sp.id === p.id)}
                    onSelect={() => toggleProductSelection(p)}
                    matchTags={resolvedIntent}
                    inCompare={compareSet.has(p.id)}
                    onToggleCompare={() => {
                      setCompareSet((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else if (next.size < 3) next.add(p.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>

              {/* Floating compare bar */}
              <AnimatePresence>
                {compareSet.size >= 2 && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-primary-bg)] px-4 py-3 flex items-center gap-3"
                  >
                    <Scale size={14} className="text-[var(--color-primary)] shrink-0" />
                    <span className="text-xs font-medium text-[var(--color-primary)] flex-1">
                      {compareSet.size} products selected for comparison
                      {compareSet.size < 3 && <span className="text-[var(--color-primary)]/60"> (add 1 more or compare now)</span>}
                    </span>
                    <button
                      onClick={() => setCompareSet(new Set())}
                      className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-2 py-1 rounded transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setCompareOpen(true)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-colors"
                    >
                      Compare →
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Selection summary — agentic purchase strip */}
              <AnimatePresence>
                {selectedProducts.length > 0 && flowState === "products_shown" && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/40 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-emerald-800">
                          {selectedProducts.length} item{selectedProducts.length !== 1 ? "s" : ""} selected
                          {" · "}
                          <span className="font-bold">
                            ${selectedProducts.reduce((s, p) => s + p.price, 0).toFixed(2)}
                          </span>
                          <span className="text-emerald-600 font-normal"> est.</span>
                        </p>
                        <p className="text-[11px] text-emerald-600 mt-0.5">
                          Add more, or let the agent prepare your purchase
                        </p>
                      </div>
                      <button
                        onClick={doneSelecting}
                        className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
                      >
                        Prepare purchase →
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Show more */}
              {hiddenCount > 0 && !showAll && (
                <button
                  onClick={() => setShowAll(true)}
                  className="mt-3 w-full py-2 rounded-xl border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  + {hiddenCount} more result{hiddenCount !== 1 ? "s" : ""}
                </button>
              )}

              {/* Follow-up suggestion chips */}
              {flowState === "products_shown" && resolvedIntent && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-[var(--color-text-muted)] self-center">Refine:</span>
                  {resolvedIntent.brand && (
                    <button onClick={() => launchSearch(`only ${resolvedIntent!.brand} products`)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                      Only {resolvedIntent.brand}
                    </button>
                  )}
                  {!resolvedIntent.max_price && (
                    <button onClick={() => launchSearch(`${resolvedIntent!.category ?? "products"} under $100`)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                      Under $100
                    </button>
                  )}
                  {!resolvedIntent.color && (
                    <button onClick={() => launchSearch(`black ${resolvedIntent!.category ?? "products"}`)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                      Black only
                    </button>
                  )}
                  <button onClick={() => launchSearch(`top rated ${resolvedIntent?.brand ?? ""} ${resolvedIntent?.category ?? "products"}`.trim())}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                    Top rated
                  </button>
                </div>
              )}
            </div>
          )}

          {/* READY TO PURCHASE — agent has done all the work, one confirm needed */}
          {checkoutInfo && flowState === "payment_ready" && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border-2 border-[var(--color-primary)]/30 bg-[var(--color-surface)] overflow-hidden shadow-sm">

              {/* Header */}
              <div className="px-4 py-3 bg-[var(--color-primary-bg)] border-b border-[var(--color-primary)]/20 flex items-center gap-2.5">
                <CheckCircle2 size={14} className="text-[var(--color-primary)] shrink-0" />
                <div>
                  <p className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wide">Ready to Purchase</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Agent has prepared everything · One confirmation needed</p>
                </div>
              </div>

              {/* Product */}
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Your selection</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-[var(--color-surface-2)]">
                    <img src={getProductImageUrl(checkoutInfo.product.merchant ?? "", checkoutInfo.product.id, 40, 40)}
                      alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)] leading-tight line-clamp-1">{checkoutInfo.product.title}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">{checkoutInfo.product.merchant}</p>
                  </div>
                  <p className="text-sm font-bold text-[var(--color-primary)] shrink-0">${checkoutInfo.totals.subtotal.toFixed(2)}</p>
                </div>
              </div>

              {/* Totals */}
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                {[
                  ["Shipping", checkoutInfo.totals.fulfillment],
                  ["Tax",      checkoutInfo.totals.tax],
                ].map(([label, amount]) => (
                  <div key={label as string} className="flex justify-between text-xs py-0.5 text-[var(--color-text-muted)]">
                    <span>{label as string}</span>
                    <span>${(amount as number).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold mt-1.5 pt-1.5 border-t border-[var(--color-border)]">
                  <span className="text-[var(--color-text)]">Total</span>
                  <span className="text-[var(--color-primary)]">${checkoutInfo.totals.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Payment */}
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Payment</p>
                {!isGuest ? (
                  selectedInstrument ? (
                    <div className="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
                      <CreditCard size={13} className="text-[var(--color-primary)] shrink-0" />
                      <span>{selectedInstrument.network} ···· {selectedInstrument.last4}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">exp {selectedInstrument.expiry}</span>
                      <Lock size={11} className="ml-auto text-[var(--color-text-muted)]" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <Loader2 size={11} className="animate-spin" /> Loading payment method…
                    </div>
                  )
                ) : (
                  <div className="space-y-1.5">
                    {instruments.map((inst) => (
                      <button key={inst.id} onClick={() => setSelectedInstrument(inst)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
                          selectedInstrument?.id === inst.id
                            ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)]"
                            : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50"
                        }`}>
                        <CreditCard size={13} className="text-[var(--color-text-muted)] shrink-0" />
                        <span className="font-medium flex-1 text-left">{inst.label} ···· {inst.last4}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">exp {inst.expiry}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Single confirm button */}
              <div className="px-4 pb-4 pt-3">
                <button
                  onClick={approvePay}
                  disabled={!canApprove}
                  className="w-full py-3.5 rounded-xl font-bold text-sm bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  <Lock size={14} /> Confirm Purchase · ${checkoutInfo.totals.total.toFixed(2)}
                </button>
                {!canApprove && isGuest && (
                  <p className="text-[11px] text-center text-[var(--color-text-muted)] mt-1.5">Select a payment card above</p>
                )}
              </div>
            </motion.div>
          )}

          {/* Order complete — full confirmation + delivery tracker */}
          {orderInfo && flowState === "complete" && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">

              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500">
                <CheckCircle2 size={18} className="text-white shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{orderInfo.order_label}</p>
                  <p className="text-[11px] text-emerald-100">{orderInfo.product.merchant}</p>
                </div>
                <span className="text-sm font-bold text-white">${orderInfo.totals.total?.toFixed(2)}</span>
              </div>

              {/* Product + payment */}
              <div className="px-4 py-3 border-b border-emerald-200 flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-emerald-200">
                  <img src={getProductImageUrl(orderInfo.product.merchant ?? "", orderInfo.product.id ?? orderInfo.order_id, 48, 48)}
                    alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-emerald-900 line-clamp-1">{orderInfo.product.title}</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Paid with {orderInfo.payment_display.brand} •••• {orderInfo.payment_display.last4}
                  </p>
                </div>
              </div>

              {/* Delivery stepper */}
              <div className="px-4 py-3 border-b border-emerald-200">
                <p className="text-[10px] font-semibold text-emerald-700 mb-3 uppercase tracking-wide">Delivery Status</p>
                <div className="flex items-center gap-0">
                  {["Order Placed", "Processing", "Shipped", "Out for Delivery", "Delivered"].map((step, i) => {
                    const active = i === 1; // "Processing" — order just placed
                    const done   = i === 0;
                    return (
                      <div key={step} className="flex-1 flex flex-col items-center gap-1">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all
                          ${done   ? "bg-emerald-500 border-emerald-500 text-white"  : ""}
                          ${active ? "bg-emerald-600 border-emerald-600 text-white ring-2 ring-emerald-300" : ""}
                          ${!done && !active ? "bg-white border-emerald-200 text-emerald-300" : ""}`}>
                          {done ? "✓" : i + 1}
                        </div>
                        <span className={`text-[9px] text-center leading-tight
                          ${done || active ? "text-emerald-700 font-medium" : "text-emerald-400"}`}>
                          {step}
                        </span>
                        {i < 4 && (
                          <div className={`absolute mt-3 h-0.5 w-full max-w-[calc(100%-24px)]
                            ${done ? "bg-emerald-400" : "bg-emerald-200"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-emerald-600 mt-3">
                  Estimated delivery: <strong>{(() => {
                    const d = new Date(); d.setDate(d.getDate() + 3);
                    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  })()}</strong>
                </p>
              </div>

              {/* AP2 mandate chain */}
              <div className="px-4 py-3 border-b border-emerald-200">
                <p className="text-[10px] font-semibold text-emerald-600 mb-1.5 uppercase tracking-wide">AP2 Mandate Chain</p>
                {[
                  ["Intent",  orderInfo.mandates.intent],
                  ["Cart",    orderInfo.mandates.cart],
                  ["Payment", orderInfo.mandates.payment],
                ].map(([label, id]) => (
                  <div key={label} className="flex items-center gap-1.5 text-[10px] text-emerald-700 py-0.5">
                    <span className="w-4 h-4 rounded-full bg-emerald-400 text-white text-[8px] font-bold grid place-items-center shrink-0">✓</span>
                    <span className="font-medium w-12 shrink-0">{label}</span>
                    <span className="text-[9px] font-mono text-emerald-600/70 truncate">{id.slice(0, 36)}…</span>
                  </div>
                ))}
              </div>

              {/* Loyalty points earned */}
              {!isGuest && loyaltyBalance !== null && orderInfo.totals?.total && (
                <div className="px-4 py-2.5 border-b border-emerald-200 flex items-center gap-2">
                  <Star size={13} className="fill-amber-400 text-amber-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-emerald-800">
                      +{Math.floor(orderInfo.totals.total)} loyalty points earned
                    </p>
                    <p className="text-[10px] text-emerald-600">Balance: {loyaltyBalance.toLocaleString()} pts</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200">
                    ⭐ pts
                  </span>
                </div>
              )}

              <div className="px-4 py-3 flex gap-2">
                <Link to="/dashboard"
                  className="flex-1 py-2 rounded-lg text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Package size={12} /> View in Dashboard
                </Link>
                <button onClick={newSearch}
                  className="flex-1 py-2 rounded-lg text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition-colors">
                  New search
                </button>
              </div>
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
              spellCheck
              autoComplete="off"
              className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
            />
            <button
              type="submit"
              disabled={!query.trim()}
              className="w-10 h-10 rounded-xl bg-[var(--color-primary)] text-white flex items-center justify-center hover:bg-[var(--color-primary-light)] disabled:opacity-40 transition-colors shrink-0"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      </main>

      {/* ── Compare modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {compareOpen && compareSet.size >= 2 && (
          <CompareModal
            products={allProducts.filter((p) => compareSet.has(p.id))}
            onClose={() => setCompareOpen(false)}
            onSelect={(p) => {
              const name = p.title.split(" ").slice(0, 3).join(" ");
              setConversation((prev) => [
                ...prev,
                { role: "user", text: `I'll take the ${name}` },
                { role: "agent", text: "Got it. I'll check availability and prepare the purchase — I'll handle the rest." },
              ]);
              setSelectedProducts([p]);
              selectProduct(p);
              setCompareOpen(false);
            }}
            selectable={flowState === "products_shown"}
            selectedProductIds={new Set(selectedProducts.map((p) => p.id))}
          />
        )}
      </AnimatePresence>

      {/* ── Right protocol trace panel ────────────────────────────────────── */}
      <AnimatePresence>
        {traceOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="hidden lg:flex flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shrink-0"
            style={{ width: 400 }}
          >
            <ProtocolTracePanel
              events={protocolEvents}
              flowState={flowState}
              productTitle={checkoutInfo?.product.title ?? orderInfo?.product.title}
              productMerchant={checkoutInfo?.product.merchant ?? orderInfo?.product.merchant}
              checkoutTotal={checkoutInfo?.totals.total ?? orderInfo?.totals?.total}
              orderLabel={orderInfo?.order_label}
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
