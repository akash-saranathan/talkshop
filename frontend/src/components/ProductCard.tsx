import { useState } from "react";
import { motion } from "framer-motion";
import { Loader, Eye, Plus, Minus } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual } from "../utils/productVisual";
import { addToCart, updateCartItemQuantity, removeFromCart, type CartItemData } from "../api/cart";
import ProductDetailModal from "./ProductDetailModal";

interface Props {
  product: ProductData;
  index: number;
  selected?: boolean;
  onToggleSelect?: (product: ProductData) => void;
  onAdded?: (item?: CartItemData) => void;
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
  MERCHANT_A: "bg-blue-100 text-blue-700",
  MERCHANT_B: "bg-violet-100 text-violet-700",
  MERCHANT_C: "bg-emerald-100 text-emerald-700",
};

const RANK_BADGE: Record<number, { label: string; className: string }> = {
  0: { label: "#1", className: "bg-amber-400 text-white" },
  1: { label: "#2", className: "bg-slate-400 text-white" },
  2: { label: "#3", className: "bg-amber-700 text-white" },
};

export default function ProductCard({ product, index, selected = false, onToggleSelect, onAdded, matchTags }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState(0);
  const [cartItemId, setCartItemId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const badgeClass = MERCHANT_COLORS[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const visual = getProductVisual(product.title, product.category);
  const VisualIcon = visual.icon;
  const showImage = product.image_url && !imageFailed;
  const rankBadge = index < 3 ? RANK_BADGE[index] : null;

  const handleAddToCart = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (adding) return;
    setAdding(true);
    try {
      const item = await addToCart(product);
      setCartItemId(item.cart_item_id);
      setQty(1);
      onAdded?.(item);
    } catch {
      // silent — don't crash the card
    } finally {
      setAdding(false);
    }
  };

  const handleIncrement = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (updating || !cartItemId) return;
    setUpdating(true);
    try {
      const newQty = qty + 1;
      await updateCartItemQuantity(cartItemId, newQty);
      setQty(newQty);
      onAdded?.();
    } catch {
      // silent
    } finally {
      setUpdating(false);
    }
  };

  const handleDecrement = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (updating || !cartItemId) return;
    setUpdating(true);
    try {
      if (qty <= 1) {
        await removeFromCart(cartItemId);
        setQty(0);
        setCartItemId(null);
        onAdded?.();
      } else {
        const newQty = qty - 1;
        await updateCartItemQuantity(cartItemId, newQty);
        setQty(newQty);
        onAdded?.();
      }
    } catch {
      // silent
    } finally {
      setUpdating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={`bg-[var(--color-surface)] rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-all ${
        selected
          ? "border-2 border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20"
          : "border border-[var(--color-border)]"
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
          <img
            src={product.image_url!}
            alt={product.title}
            onError={() => setImageFailed(true)}
            onClick={() => setShowDetail(true)}
            className="h-28 w-full rounded-lg object-cover cursor-pointer"
          />
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
          {matchTags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 px-1.5 py-0.5 rounded-full">
              ✓ {tag}
            </span>
          ))}
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
              {adding ? "Adding..." : "Add to Cart"}
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
    </motion.div>
  );
}
