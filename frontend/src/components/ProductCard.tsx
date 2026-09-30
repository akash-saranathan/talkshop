import { useState } from "react";
import { motion } from "framer-motion";
import { Loader, Eye, Check } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual } from "../utils/productVisual";
import { addToCart } from "../api/cart";
import ProductDetailModal from "./ProductDetailModal";

interface Props {
  product: ProductData;
  index: number;
  selected?: boolean;
  onToggleSelect?: (product: ProductData) => void;
  onAdded?: () => void;
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

export default function ProductCard({ product, index, selected = false, onToggleSelect, onAdded }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const badgeClass = MERCHANT_COLORS[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const visual = getProductVisual(product.title, product.category);
  const VisualIcon = visual.icon;
  const showImage = product.image_url && !imageFailed;
  const rankBadge = index < 3 ? RANK_BADGE[index] : null;

  const handleAddToCart = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (adding || added) return;
    setAdding(true);
    try {
      await addToCart(product);
      setAdding(false);
      setAdded(true);
      onAdded?.();
      setTimeout(() => setAdded(false), 2000);
    } catch {
      setAdding(false);
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
        {product.rating > 0 && <span>★ {product.rating.toFixed(1)}</span>}
        {product.delivery_days && <span>Ships {product.delivery_days}d</span>}
        {product.size && <span>Size {product.size}</span>}
        {product.rank_score > 0 && (
          <span className="ml-auto text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded font-mono">
            {product.rank_score.toFixed(0)}pts
          </span>
        )}
      </div>

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
          <button
            onClick={handleAddToCart}
            disabled={adding}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              added
                ? "bg-[var(--color-success)] text-white"
                : "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] disabled:opacity-60"
            }`}
          >
            {adding ? <Loader size={13} className="animate-spin" /> : added ? <Check size={13} /> : null}
            {adding ? "Adding..." : added ? "Added ✓" : "Add to Cart"}
          </button>
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
