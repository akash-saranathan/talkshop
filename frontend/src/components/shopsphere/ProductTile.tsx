import { useState } from "react";
import { Link } from "react-router-dom";
import { MousePointerClick, Sparkles } from "lucide-react";
import { money, type Product } from "../../api/shop";
import { Badge, Rating, cx } from "../ui";

/** A product card in grids and rails. `picked` marks a Talkshop recommendation;
 *  `selected` the one the shopper chose in the chat. */
export default function ProductTile({ product, picked, selected, reason, priority }:
  { product: Product; picked?: boolean; selected?: boolean; reason?: string | null; priority?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const image = hover ?? product.image_url;
  return (
    <Link
      to={`/p/${product.product_id}`}
      data-product-tile={product.product_id}
      className={cx("group flex flex-col gap-3 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-talk transition-shadow",
        selected && "ring-2 ring-talk ring-offset-4 ring-offset-canvas")}
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-photo">
        {image && (
          <img src={image} alt={product.name} loading={priority ? "eager" : "lazy"}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {selected ? <Badge tone="talk"><MousePointerClick size={11} /> Selected in Talkshop</Badge>
            : picked && <Badge tone="talk"><Sparkles size={11} /> Talkshop pick</Badge>}
          {product.is_new && <Badge tone="accent">New</Badge>}
          {!product.in_stock && <Badge tone="bad">Sold out</Badge>}
        </div>
      </div>
      <div className="flex flex-col gap-1 px-0.5">
        {product.colors.length > 1 && (
          <div className="flex items-center gap-1.5 mb-0.5" onMouseLeave={() => setHover(null)}>
            {product.colors.map((c) => (
              <span key={c.name} title={c.name} onMouseEnter={() => setHover(c.image_url)}
                className="w-3.5 h-3.5 rounded-full border border-black/15" style={{ background: c.hex }} />
            ))}
          </div>
        )}
        {/* Price sits beside the name on wider cards, under it on phones so names aren't cut off */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-0.5 sm:gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted">{product.brand}</p>
            <h3 className="text-[15px] font-medium leading-snug text-ink line-clamp-2">{product.name}</h3>
          </div>
          <p className="text-[15px] font-semibold tabular-nums shrink-0">{money(product.price)}</p>
        </div>
        <Rating value={product.rating} count={product.review_count} />
        {reason && <p className="text-[13px] text-talk mt-1 leading-snug">{reason}</p>}
      </div>
    </Link>
  );
}
