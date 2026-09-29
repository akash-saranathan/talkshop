import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import type { ProductData } from "../api/chat";
import { getProductVisual } from "../utils/productVisual";

interface Props {
  product: ProductData;
  index: number;
}

const MERCHANT_COLORS: Record<string, string> = {
  MERCHANT_A: "bg-blue-100 text-blue-700",
  MERCHANT_B: "bg-violet-100 text-violet-700",
  MERCHANT_C: "bg-emerald-100 text-emerald-700",
};

export default function ProductCard({ product, index }: Props) {
  const navigate = useNavigate();
  const badgeClass = MERCHANT_COLORS[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const visual = getProductVisual(product.title, product.category);
  const VisualIcon = visual.icon;

  const handleSelect = () => {
    navigate("/checkout", { state: { product } });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
    >
      {/* Product visual tile */}
      <div className={`h-28 rounded-lg grid place-items-center ${visual.bg}`}>
        <VisualIcon size={40} className={visual.fg} strokeWidth={1.5} />
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
      <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
        {product.rating > 0 && (
          <span>★ {product.rating.toFixed(1)}</span>
        )}
        {product.delivery_days && (
          <span>Ships {product.delivery_days}d</span>
        )}
        {product.size && <span>Size {product.size}</span>}
      </div>

      {/* Price + CTA */}
      <div className="flex items-center justify-between mt-auto">
        <span className="text-lg font-bold text-[var(--color-primary)]">
          ${product.price.toFixed(2)}
        </span>
        <button
          onClick={handleSelect}
          className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-light)] transition-colors"
        >
          Select
        </button>
      </div>
    </motion.div>
  );
}
