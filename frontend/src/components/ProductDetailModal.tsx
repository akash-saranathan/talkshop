import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { ProductData } from "../api/chat";
import { getProductVisual } from "../utils/productVisual";

interface Props {
  product: ProductData;
  adding: boolean;
  onClose: () => void;
  onSelect: () => void;
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[var(--color-text-muted)] text-xs">{label}</p>
      <p className="font-medium text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export default function ProductDetailModal({ product, adding, onClose, onSelect }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const visual = getProductVisual(product.title, product.category);
  const VisualIcon = visual.icon;
  const showImage = product.image_url && !imageFailed;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="absolute top-4 right-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <X size={20} />
        </button>

        {showImage ? (
          <img
            src={product.image_url!}
            alt={product.title}
            onError={() => setImageFailed(true)}
            className="w-full h-56 object-contain bg-[#f3f2ef] rounded-xl mb-4"
          />
        ) : (
          <div className={`w-full h-56 rounded-xl grid place-items-center mb-4 ${visual.bg}`}>
            <VisualIcon size={56} className={visual.fg} strokeWidth={1.5} />
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {product.merchant_name}
          </span>
          {product.shipping_cost === 0 && (
            <span className="text-xs text-[var(--color-success)] font-medium">Free shipping</span>
          )}
        </div>

        <h2 className="text-lg font-semibold text-[var(--color-text)] leading-snug mb-1">
          {product.title}
        </h2>
        {product.brand && (
          <p className="text-sm text-[var(--color-text-muted)] mb-4">{product.brand}</p>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-5 border-t border-[var(--color-border)] pt-4">
          <SpecRow label="Price" value={`$${product.price.toFixed(2)}`} />
          {product.rating > 0 && (
            <SpecRow
              label="Rating"
              value={`★ ${product.rating.toFixed(1)} (${product.review_count.toLocaleString()} reviews)`}
            />
          )}
          {product.size && <SpecRow label="Size" value={product.size} />}
          {product.color && <SpecRow label="Color" value={product.color} />}
          {product.weight_grams != null && <SpecRow label="Weight" value={`${product.weight_grams}g`} />}
          {product.cushioning && <SpecRow label="Cushioning" value={product.cushioning} />}
          <SpecRow label="Delivery" value={`${product.delivery_days} day${product.delivery_days === 1 ? "" : "s"}`} />
          <SpecRow
            label="Availability"
            value={product.available ? `${product.inventory} in stock` : "Out of stock"}
          />
        </div>

        <button
          type="button"
          onClick={onSelect}
          disabled={adding || !product.available}
          className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-light)] disabled:opacity-50 transition-colors"
        >
          {adding ? "Selecting..." : !product.available ? "Out of stock" : "Select"}
        </button>
      </motion.div>
    </div>
  );
}
