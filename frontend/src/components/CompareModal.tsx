import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Star, Zap, ShoppingCart, Sparkles, Trophy, Loader, Minus, Plus } from "lucide-react";
import type { ProductData } from "../api/chat";
import type { CartItemData } from "../api/cart";
import { authFetch } from "../api/client";

interface Props {
  products: ProductData[];
  onClose: () => void;
  // Same cart state the product cards read, so both always agree on what's
  // in the cart and in what quantity.
  cartItemByProduct: Map<string, CartItemData>;
  onAddToCart: (product: ProductData) => Promise<void>;
  onSetQuantity: (item: CartItemData, quantity: number) => Promise<void>;
}

// Add-to-cart button that turns into a quantity stepper once the product is
// in the cart — mirrors the ProductCard control.
function CartAction({ product, cartItem, onAddToCart, onSetQuantity }: {
  product: ProductData;
  cartItem?: CartItemData;
  onAddToCart: Props["onAddToCart"];
  onSetQuantity: Props["onSetQuantity"];
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch { /* silent — keep the modal usable */ } finally { setBusy(false); }
  };

  if (!cartItem) {
    return (
      <button
        onClick={() => run(() => onAddToCart(product))}
        disabled={busy}
        className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:bg-[var(--color-primary-light)] disabled:opacity-60 transition-colors"
      >
        {busy ? <Loader size={13} className="animate-spin" /> : <ShoppingCart size={13} />}
        {busy ? "Selecting..." : "Select"}
      </button>
    );
  }

  const qty = cartItem.quantity;
  return (
    <div className="flex items-center justify-between gap-2 py-1 px-1 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary)]/5">
      <button
        onClick={() => run(() => onSetQuantity(cartItem, qty - 1))}
        disabled={busy}
        title={qty <= 1 ? "Remove from cart" : "Decrease quantity"}
        className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40"
      >
        <Minus size={13} />
      </button>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)]">
        {busy ? <Loader size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
        {qty} in cart
      </span>
      <button
        onClick={() => run(() => onSetQuantity(cartItem, qty + 1))}
        disabled={busy}
        title="Increase quantity"
        className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

interface AiVerdict {
  winner_product_id: string;
  headline: string;
  reasoning: string;
  trade_offs: string[];
}

// Makes the actual comparison figures ($49.99, 4.6/5, 8,921 reviews) pop out
// of the AI's prose instead of blending into the muted paragraph text.
const NUMBER_PATTERN = /(\$[\d,]+(?:\.\d{1,2})?|\d+(?:\.\d+)?\/5|\d+(?:\.\d+)?-star|\d{1,3}(?:,\d{3})*\+?\s*reviews?)/gi;

function highlightNumbers(text: string) {
  return text.split(NUMBER_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-bold text-[var(--color-text)]">{part}</strong>
    ) : (
      part
    )
  );
}

function getDeliveryLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SPEC_ROWS: Array<{ label: string; key: keyof ProductData; format?: (v: unknown) => string }> = [
  { label: "Price",     key: "price",         format: (v) => `$${(v as number).toFixed(2)}` },
  { label: "Rating",    key: "rating",         format: (v) => `★ ${(v as number).toFixed(1)}` },
  { label: "Reviews",   key: "review_count",   format: (v) => `${v as number}` },
  { label: "Brand",     key: "brand",          format: (v) => (v as string) || "—" },
  { label: "Color",     key: "color",          format: (v) => (v as string) || "—" },
  { label: "Size",      key: "size",           format: (v) => (v as string) || "—" },
  { label: "Arrives",   key: "delivery_days",  format: (v) => getDeliveryLabel(v as number) },
  { label: "Shipping",  key: "shipping_cost",  format: (v) => (v as number) === 0 ? "Free" : `$${(v as number).toFixed(2)}` },
  { label: "Merchant",  key: "merchant_name",  format: (v) => (v as string) || "—" },
];

export default function CompareModal({ products, onClose, cartItemByProduct, onAddToCart, onSetQuantity }: Props) {
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(true);

  useEffect(() => {
    setVerdictLoading(true);
    authFetch("/api/compare", {
      method: "POST",
      body: JSON.stringify({
        products: products.map((p) => ({
          product_id: p.product_id,
          title: p.title,
          brand: p.brand,
          price: p.price,
          rating: p.rating,
          review_count: p.review_count,
          delivery_days: p.delivery_days,
          shipping_cost: p.shipping_cost,
          color: p.color,
          size: p.size,
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

  // Highlight the column with the best value for price (lowest) and rating (highest)
  const bestPrice = Math.min(...products.map((p) => p.price));
  const bestRating = Math.max(...products.map((p) => p.rating));
  const fastestDelivery = Math.min(...products.map((p) => p.delivery_days));

  const cellHighlight = (key: keyof ProductData, product: ProductData): string => {
    if (key === "price" && product.price === bestPrice) return "text-[var(--color-success)] font-bold";
    if (key === "rating" && product.rating === bestRating) return "text-amber-600 font-bold";
    if (key === "delivery_days" && product.delivery_days === fastestDelivery) return "text-[var(--color-success)] font-semibold";
    return "";
  };

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
          <h2 className="font-semibold text-[var(--color-text)]">Compare {products.length} products</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable middle: AI verdict + comparison table. Add-to-cart and
            the legend stay pinned below, outside this scroll area, so the
            buttons are never hidden off the bottom of a tall comparison. */}
        <div className="flex-1 overflow-y-auto min-h-0">

        {/* AI Verdict panel */}
        <AnimatePresence mode="wait">
          {verdictLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mx-5 my-4 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-4 py-3 flex items-center gap-3"
            >
              <Sparkles size={16} className="text-[var(--color-primary)] shrink-0 animate-pulse" />
              <div className="flex items-center gap-2 text-sm text-[var(--color-primary)]">
                <Loader size={13} className="animate-spin shrink-0" />
                <span>AI is analysing these products...</span>
              </div>
            </motion.div>
          ) : verdict ? (
            <motion.div
              key="verdict"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-5 my-4 rounded-xl border border-[var(--color-primary)]/30 bg-gradient-to-br from-[var(--color-primary)]/8 to-violet-500/5 px-4 py-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-[var(--color-primary)] shrink-0" />
                <span className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">AI Recommendation</span>
              </div>
              {/* Winner highlight */}
              {(() => {
                const winner = products.find((p) => p.product_id === verdict.winner_product_id);
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

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Product thumbnails */}
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] w-28">
                  Spec
                </th>
                {products.map((p) => {
                  const isWinner = verdict?.winner_product_id === p.product_id;
                  return (
                    <th key={p.product_id} className={`px-4 py-3 text-center min-w-[160px] ${isWinner ? "bg-[var(--color-primary)]/5" : ""}`}>
                      {isWinner && (
                        <div className="flex items-center justify-center gap-1 mb-1.5">
                          <Trophy size={11} className="text-amber-500" />
                          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Best Pick</span>
                        </div>
                      )}
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.title} className={`w-16 h-16 object-cover rounded-lg mx-auto mb-2 ${isWinner ? "ring-2 ring-[var(--color-primary)]/40" : ""}`} />
                      ) : (
                        <div className={`w-16 h-16 rounded-lg bg-[var(--color-bg)] mx-auto mb-2 ${isWinner ? "ring-2 ring-[var(--color-primary)]/40" : ""}`} />
                      )}
                      <p className={`text-xs font-semibold line-clamp-2 leading-tight ${isWinner ? "text-[var(--color-primary)]" : "text-[var(--color-text)]"}`}>{p.title}</p>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {SPEC_ROWS.map(({ label, key, format }) => (
                <tr key={key} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-bg)] transition-colors">
                  <td className="px-5 py-2.5 text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {label}
                  </td>
                  {products.map((p) => {
                    const raw = p[key];
                    const display = format ? format(raw) : String(raw ?? "—");
                    const highlight = cellHighlight(key, p);
                    return (
                      <td key={p.product_id} className={`px-4 py-2.5 text-center text-sm ${highlight || "text-[var(--color-text)]"}`}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        </div>
        {/* End scrollable middle — action row and legend below are pinned, always visible */}

        {/* Add-to-cart row */}
        <div className="grid px-5 py-4 gap-3 border-t border-[var(--color-border)] shrink-0"
          style={{ gridTemplateColumns: `7rem repeat(${products.length}, 1fr)` }}
        >
          <div className="flex items-center">
            <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Action</span>
          </div>
          {products.map((p) => (
            <CartAction
              key={p.product_id}
              product={p}
              cartItem={cartItemByProduct.get(p.product_id)}
              onAddToCart={onAddToCart}
              onSetQuantity={onSetQuantity}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="px-5 pb-3 flex items-center gap-4 text-[10px] text-[var(--color-text-muted)] shrink-0">
          <span className="flex items-center gap-1"><span className="text-[var(--color-success)] font-bold">Green</span> = best value</span>
          <span className="flex items-center gap-1"><Star size={10} className="text-amber-500" /> <span className="text-amber-600 font-bold">Amber</span> = top rated</span>
          <span className="flex items-center gap-1"><Zap size={10} className="text-[var(--color-success)]" /> <span className="text-[var(--color-success)] font-semibold">Green delivery</span> = fastest</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
