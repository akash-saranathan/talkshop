import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { shop, type Product, type ProductQuery } from "../../api/shop";
import ProductTile from "../../components/shopsphere/ProductTile";
import TalkshopPicks from "../../components/talkshop/TalkshopPicks";
import { useTalkshopShared } from "../../talkshop/TalkshopContext";
import { Chip, Empty, Skeleton, Swatch, cx } from "../../components/ui";

const PAGES: Record<string, { title: string; blurb: string; query: ProductQuery }> = {
  women: { title: "Women", blurb: "Shoes, clothing and accessories for her.", query: { gender: "women" } },
  men: { title: "Men", blurb: "Shoes, clothing and accessories for him.", query: { gender: "men" } },
  shoes: { title: "Shoes", blurb: "Runners, sneakers, boots and more.", query: { department: "shoes" } },
  clothing: { title: "Clothing", blurb: "Everyday layers, denim and dresses.", query: { department: "clothing" } },
  accessories: { title: "Accessories", blurb: "Bags, watches, sunglasses and small leather goods.", query: { department: "accessories" } },
  electronics: { title: "Electronics", blurb: "Headphones, phones, laptops and wearables.", query: { department: "electronics" } },
  new: { title: "New arrivals", blurb: "The latest additions to ShopSphere.", query: { new: true } },
};

const PRICES = [
  { key: "u50", label: "Under $50", min: undefined, max: 50 },
  { key: "50-100", label: "$50 – $100", min: 50, max: 100 },
  { key: "100-200", label: "$100 – $200", min: 100, max: 200 },
  { key: "200+", label: "$200+", min: 200, max: undefined },
];
const SORTS = [
  { value: "relevance", label: "Featured" }, { value: "new", label: "Newest" }, { value: "rating", label: "Top rated" },
  { value: "price_asc", label: "Price: low to high" }, { value: "price_desc", label: "Price: high to low" },
] as const;

export default function Category() {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? undefined;
  const page = q ? { title: `Results for “${q}”`, blurb: "", query: { q } } : PAGES[slug];
  const price = PRICES.find((p) => p.key === params.get("price"));
  const color = params.get("color") ?? undefined;
  const size = params.get("size") ?? undefined;
  const sort = (params.get("sort") ?? (q ? "relevance" : "relevance")) as ProductQuery["sort"];

  const [base, setBase] = useState<Product[] | null>(null);      // unfiltered — feeds the filter options
  const [items, setItems] = useState<Product[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { picks, selectedId } = useTalkshopShared();
  const pickIds = new Set(picks.map((p) => p.product_id));

  useEffect(() => {
    if (!page) return;
    setBase(null);
    shop.products({ ...page.query }).then(setBase).catch(() => setBase([]));
  }, [slug, q]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!page) return;
    setItems(null);
    shop.products({ ...page.query, color, size, min_price: price?.min, max_price: price?.max, sort })
      .then(setItems).catch(() => setItems([]));
  }, [slug, q, color, size, price?.key, sort]);  // eslint-disable-line react-hooks/exhaustive-deps

  const colors = useMemo(() => {
    const seen = new Map<string, string>();
    (base ?? []).forEach((p) => p.colors.forEach((c) => seen.set(c.name, c.hex)));
    return [...seen.entries()];
  }, [base]);
  const sizes = useMemo(() => {
    const all = new Set<string>();
    (base ?? []).filter((p) => p.department === "shoes" || p.department === "clothing")
      .forEach((p) => p.sizes.forEach((s) => all.add(s)));
    const order = ["XS", "S", "M", "L", "XL", "XXL"];
    return [...all].sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || (Number(a) - Number(b)) || a.localeCompare(b));
  }, [base]);

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value && next.get(key) !== value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const active = [price && { key: "price", label: price.label }, color && { key: "color", label: color },
    size && { key: "size", label: `Size ${size}` }].filter(Boolean) as { key: string; label: string }[];

  if (!page) return <Empty title="Page not found"><Link to="/" className="underline">Back to ShopSphere</Link></Empty>;

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-10">
      <div className="flex flex-col gap-2">
        <nav className="text-xs text-muted"><Link to="/" className="hover:underline">Home</Link> / {page.title}</nav>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{page.title}</h1>
        {page.blurb && <p className="text-muted">{page.blurb}</p>}
      </div>

      <div className="-mx-4 sm:-mx-6"><TalkshopPicks /></div>

      <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 mt-6 py-3 bg-canvas/90 backdrop-blur border-b border-line flex items-center gap-3">
        <button onClick={() => setShowFilters((s) => !s)}
          className={cx("inline-flex items-center gap-2 h-9 px-4 rounded-full border text-sm font-medium",
            showFilters ? "border-ink" : "border-line-strong hover:border-ink")}>
          <SlidersHorizontal size={15} /> Filters{active.length ? ` (${active.length})` : ""}
        </button>
        <div className="flex gap-2 overflow-x-auto ss-scroll">
          {active.map((a) => (
            <button key={a.key} onClick={() => set(a.key)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-panel text-sm whitespace-nowrap">
              {a.label} <X size={13} />
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="hidden sm:block text-sm text-muted whitespace-nowrap">{items ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""}</span>
        <select value={sort} onChange={(e) => set("sort", e.target.value === "relevance" ? undefined : e.target.value)}
          className="h-9 rounded-full border border-line-strong bg-canvas px-3 text-sm outline-none" aria-label="Sort">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {showFilters && (
        <div className="grid gap-6 sm:grid-cols-3 py-6 border-b border-line">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-3">Price</p>
            <div className="flex flex-wrap gap-2">
              {PRICES.map((p) => <Chip key={p.key} selected={price?.key === p.key} onClick={() => set("price", p.key)}>{p.label}</Chip>)}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-3">Colour</p>
            <div className="flex flex-wrap gap-1">
              {colors.map(([name, hex]) => <Swatch key={name} label={name} hex={hex} selected={color === name} onClick={() => set("color", name)} size={24} />)}
            </div>
          </div>
          {sizes.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-3">Size</p>
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => <Chip key={s} selected={size === s} onClick={() => set("size", s)}>{s}</Chip>)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-10">
        {items === null && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}
        {items?.map((p, i) => <ProductTile key={p.product_id} product={p} priority={i < 4}
          picked={pickIds.has(p.product_id)} selected={p.product_id === selectedId} />)}
      </div>
      {items?.length === 0 && (
        <Empty title="Nothing matches those filters">
          Try removing a filter{q ? " or searching for something else" : ""}.
        </Empty>
      )}
    </div>
  );
}
