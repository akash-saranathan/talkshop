import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Loader, Eye } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual } from "../utils/productVisual";
import { addToCart } from "../api/cart";
import ProductDetailModal from "./ProductDetailModal";

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
  const [imageFailed, setImageFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const badgeClass = MERCHANT_COLORS[product.merchant_id] ?? "bg-slate-100 text-slate-600";
  const visual = getProductVisual(product.title, product.category);
  const VisualIcon = visual.icon;
  const showImage = product.image_url && !imageFailed;

  const handleSelect = async () => {
    if (adding) return;
    setAdding(true);
    try {
      await addToCart(product);
      navigate("/cart");
    } catch {
      setAdding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
    >
      {/* Product visual — real photo when available, icon tile otherwise */}
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDetail(true)}
            title="View details"
            className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-colors"
          >
            <Eye size={16} />
          </button>
          <button
            onClick={handleSelect}
            disabled={adding}
            className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-light)] transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {adding && <Loader size={13} className="animate-spin" />}
            {adding ? "Adding..." : "Select"}
          </button>
        </div>
      </div>

      {showDetail && (
        <ProductDetailModal
          product={product}
          adding={adding}
          onClose={() => setShowDetail(false)}
          onSelect={handleSelect}
        />
      )}
    </motion.div>
  );
}
