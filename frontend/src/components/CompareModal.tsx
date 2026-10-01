import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Star, Zap, ShoppingCart } from "lucide-react";
import type { ProductData } from "../api/chat";

interface Props {
  products: ProductData[];
  onClose: () => void;
  onAddToCart: (product: ProductData) => void;
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

export default function CompareModal({ products, onClose, onAddToCart }: Props) {
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
        className="w-full max-w-3xl bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-[var(--color-text)]">Compare {products.length} products</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Product thumbnails */}
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] w-28">
                  Spec
                </th>
                {products.map((p) => (
                  <th key={p.product_id} className="px-4 py-3 text-center min-w-[160px]">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.title} className="w-16 h-16 object-cover rounded-lg mx-auto mb-2" />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-[var(--color-bg)] mx-auto mb-2" />
                    )}
                    <p className="text-xs font-semibold text-[var(--color-text)] line-clamp-2 leading-tight">{p.title}</p>
                  </th>
                ))}
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

        {/* Add-to-cart row */}
        <div className="grid px-5 py-4 gap-3 border-t border-[var(--color-border)]"
          style={{ gridTemplateColumns: `7rem repeat(${products.length}, 1fr)` }}
        >
          <div className="flex items-center">
            <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Action</span>
          </div>
          {products.map((p) => (
            <button
              key={p.product_id}
              onClick={() => { onAddToCart(p); onClose(); }}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:bg-[var(--color-primary-light)] transition-colors"
            >
              <ShoppingCart size={13} /> Add to Cart
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="px-5 pb-3 flex items-center gap-4 text-[10px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1"><span className="text-[var(--color-success)] font-bold">Green</span> = best value</span>
          <span className="flex items-center gap-1"><Star size={10} className="text-amber-500" /> <span className="text-amber-600 font-bold">Amber</span> = top rated</span>
          <span className="flex items-center gap-1"><Zap size={10} className="text-[var(--color-success)]" /> <span className="text-[var(--color-success)] font-semibold">Green delivery</span> = fastest</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
