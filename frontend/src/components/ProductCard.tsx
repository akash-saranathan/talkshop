import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader, Eye, Plus, Minus, X, ZoomIn } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual } from "../utils/productVisual";
import type { CartItemData } from "../api/cart";
import ProductDetailModal from "./ProductDetailModal";

interface Props {
  product: ProductData;
  index: number;
  selected?: boolean;
  onToggleSelect?: (product: ProductData) => void;
  // Owned by the Chat page so the card and the compare popup always show the
  // same quantity — the card never tracks cart state on its own.
  cartItem?: CartItemData;
  onAddToCart?: (product: ProductData) => Promise<void>;
  onSetQuantity?: (item: CartItemData, quantity: number) => Promise<void>;
  matchTags?: string[];
}

function getDeliveryLabel(days: number): string {
  if (days === 0) return "Arrives today";
  if (days === 1) return "Arrives tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `Arrives ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

const MERCHANT_COLORS: Record<string, string> = {
  MERCHANT_A: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300",
  MERCHANT_B: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300",
  MERCHANT_C: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
};

const MERCHANT_TRUST: Record<string, { tier: "Premium" | "Verified"; ships: string; returns: string }> = {
  MERCHANT_A: { tier: "Verified", ships: "Ships in 24h", returns: "30-day returns" },
  MERCHANT_B: { tier: "Verified", ships: "Ships in 48h", returns: "14-day returns" },
  MERCHANT_C: { tier: "Premium",  ships: "Ships same day", returns: "60-day returns" },
};

const RANK_BADGE: Record<number, { label: string; className: string }> = {
  0: { label: "#1", className: "bg-amber-400 text-white" },
  1: { label: "#2", className: "bg-slate-400 text-white" },
  2: { label: "#3", className: "bg-amber-700 text-white" },
};

export default function ProductCard({ product, index, selected = false, onToggleSelect, matchTags, cartItem, onAddToCart, onSetQuantity }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const qty = cartItem?.quantity ?? 0;
  const [updating, setUpdating] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const badgeClass = MERCHANT_COLORS[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const trust = MERCHANT_TRUST[product.merchant_id];
  const visual = getProductVisual(product.title, product.category);
  const VisualIcon = visual.icon;
  const showImage = product.image_url && !imageFailed;
  const rankBadge = index < 3 ? RANK_BADGE[index] : null;

  const handleAddToCart = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (adding || !onAddToCart) return;
    setAdding(true);
    try {
      await onAddToCart(product);
    } catch {
      // silent — don't crash the card
    } finally {
      setAdding(false);
    }
  };

  const changeQuantity = async (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    if (updating || !cartItem || !onSetQuantity) return;
    setUpdating(true);
    try {
      await onSetQuantity(cartItem, qty + delta);
    } catch {
      // silent
    } finally {
      setUpdating(false);
    }
  };
  const handleIncrement = (e: React.MouseEvent) => changeQuantity(e, 1);
  const handleDecrement = (e: React.MouseEvent) => changeQuantity(e, -1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={`bg-[var(--color-surface)] rounded-xl p-4 flex flex-col gap-3 shadow-card hover:shadow-card-hover hover:border-[var(--color-primary)]/40 transition-all duration-200 ${
        selected
          ? "border-2 border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20"
          : "border border-[var(--color-primary)]/15"
      }`}
    >
      {/* Product visual */}
      <div className="relative">
        {rankBadge && (
          <span className={`absolute top-1.5 left-1.5 z-10 w-7 h-7 rounded-full text-[11px] font-bold grid place-items-center shadow-sm ${rankBadge.className}`}>
            {rankBadge.label}
          </span>
        )}
        {onToggleSelect && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(product); }}
            className={`absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded border-2 grid place-items-center transition-colors ${
              selected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                : "border-white bg-white/80"
            }`}
            title={selected ? "Deselect" : "Select for bulk checkout"}
          >
            {selected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
          </button>
        )}
        {showImage ? (
          <div className="relative group/img">
            <img
              src={product.image_url!}
              alt={product.title}
              onError={() => setImageFailed(true)}
              onClick={() => setShowLightbox(true)}
              className="h-36 w-full rounded-lg object-contain bg-[#f3f2ef] cursor-zoom-in"
            />
            <div
              onClick={() => setShowLightbox(true)}
              className="absolute inset-0 rounded-lg bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center cursor-zoom-in"
            >
              <ZoomIn size={20} className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow-md" />
            </div>
          </div>
        ) : (
          <div
            onClick={() => setShowDetail(true)}
            className={`h-28 rounded-lg grid place-items-center cursor-pointer ${visual.bg}`}
          >
            <VisualIcon size={40} className={visual.fg} strokeWidth={1.5} />
          </div>
        )}
      </div>

      {/* Merchant badge */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {product.merchant_name}
        </span>
        {product.shipping_cost === 0 && (
          <span className="text-xs text-[var(--color-success)] font-medium">Free shipping</span>
        )}
      </div>
      {/* Trust details: ships + returns */}
      {trust && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
          <span>🚚 {trust.ships}</span>
          <span>·</span>
          <span>↩ {trust.returns}</span>
        </div>
      )}

      {/* Title */}
      <p className="text-sm font-semibold text-[var(--color-text)] leading-tight line-clamp-2">
        {product.title}
      </p>

      {/* Details row */}
      <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--color-text-muted)]">
        {product.rating > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="text-amber-400">★</span> {product.rating.toFixed(1)}
            {product.review_count > 0 && <span className="text-[var(--color-text-muted)]/60">({product.review_count})</span>}
          </span>
        )}
        {product.size && <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">Size {product.size}</span>}
        {product.color && <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] capitalize">{product.color}</span>}
      </div>

      {/* Match tags — what the AI matched for this result */}
      {matchTags && matchTags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {matchTags.map((tag) => {
            const reason = tag.startsWith("under $")
              ? `Price $${product.price.toFixed(2)} is within your ${tag} budget`
              : tag.startsWith("size ")
              ? `This product comes in your requested ${tag}`
              : product.color?.toLowerCase().includes(tag.toLowerCase())
              ? `Color "${product.color}" matches your "${tag}" filter`
              : `Brand "${product.brand}" matches your "${tag}" filter`;
            return (
              <span
                key={tag}
                title={reason}
                className="relative inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 px-1.5 py-0.5 rounded-full cursor-help"
              >
                ✓ {tag}
              </span>
            );
          })}
        </div>
      )}

      {/* Delivery urgency */}
      {product.delivery_days != null && (
        <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1">
          <span className={product.delivery_days <= 2 ? "text-[var(--color-success)]" : ""}>
            {product.delivery_days <= 2 ? "⚡" : "📦"}
          </span>
          <span className={product.delivery_days <= 2 ? "text-[var(--color-success)] font-medium" : ""}>
            {getDeliveryLabel(product.delivery_days)}
          </span>
        </p>
      )}

      {/* Price + CTA */}
      <div className="flex items-center justify-between mt-auto">
        <span className="text-lg font-bold text-[var(--color-primary)]">
          ${product.price.toFixed(2)}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDetail(true)}
            title="View details"
            className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-colors"
          >
            <Eye size={16} />
          </button>

          {qty > 0 ? (
            <div className="flex items-center gap-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              <button
                onClick={handleDecrement}
                disabled={updating}
                className="w-8 h-8 flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40"
              >
                {updating && qty === 1 ? <Loader size={12} className="animate-spin" /> : <Minus size={13} />}
              </button>
              <span className="text-sm font-semibold text-[var(--color-text)] w-6 text-center">{qty}</span>
              <button
                onClick={handleIncrement}
                disabled={updating}
                className="w-8 h-8 flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40"
              >
                {updating && qty > 0 ? <Loader size={12} className="animate-spin" /> : <Plus size={13} />}
              </button>
            </div>
          ) : (
            <button
              onClick={handleAddToCart}
              disabled={adding}
              className="text-sm px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] disabled:opacity-60"
            >
              {adding ? <Loader size={13} className="animate-spin" /> : null}
              {adding ? "Selecting..." : "Select"}
            </button>
          )}
        </div>
      </div>

      {showDetail && (
        <ProductDetailModal
          product={product}
          adding={adding}
          onClose={() => setShowDetail(false)}
          onSelect={handleAddToCart}
        />
      )}

      {/* Image lightbox */}
      {showLightbox && product.image_url && createPortal(
        <AnimatePresence>
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLightbox(false)}
            className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-2xl max-h-[80vh] flex flex-col items-center gap-3"
            >
              <img
                src={product.image_url}
                alt={product.title}
                className="max-w-full max-h-[70vh] rounded-xl object-contain shadow-2xl"
              />
              <p className="text-white/80 text-sm font-medium text-center">{product.title}</p>
              <button
                onClick={() => setShowLightbox(false)}
                className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
              >
                <X size={16} className="text-white" />
              </button>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
}
