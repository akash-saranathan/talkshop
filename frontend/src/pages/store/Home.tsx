import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { shop, type Product } from "../../api/shop";
import ProductTile from "../../components/shopsphere/ProductTile";
import TalkshopPicks from "../../components/talkshop/TalkshopPicks";
import { useTalkshopShared } from "../../talkshop/TalkshopContext";
import { Skeleton } from "../../components/ui";

const DEPT_TILES = [
  { slug: "shoes", label: "Shoes", blurb: "Runners, sneakers & boots", query: { department: "shoes" } },
  { slug: "women", label: "Women", blurb: "Dresses, knits & denim", query: { gender: "women", department: "clothing" } },
  { slug: "accessories", label: "Accessories", blurb: "Bags, watches & shades", query: { department: "accessories" } },
  { slug: "electronics", label: "Electronics", blurb: "Audio, phones & laptops", query: { department: "electronics" } },
];

export default function StoreHome() {
  const [arrivals, setArrivals] = useState<Product[] | null>(null);
  const [hero, setHero] = useState<Product[]>([]);
  const [tiles, setTiles] = useState<Record<string, Product | undefined>>({});
  const { picks, selectedId } = useTalkshopShared();
  const pickIds = new Set(picks.map((p) => p.product_id));

  useEffect(() => {
    shop.products({ new: true, sort: "rating", limit: 8 }).then(setArrivals).catch(() => setArrivals([]));
    shop.products({ category: "running_shoes", sort: "rating", limit: 3 }).then(setHero).catch(() => {});
    Promise.all(DEPT_TILES.map((t) => shop.products({ ...t.query, sort: "rating", limit: 1 })))
      .then((res) => setTiles(Object.fromEntries(DEPT_TILES.map((t, i) => [t.slug, res[i][0]]))))
      .catch(() => {});
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 pt-6">
        <div className="relative overflow-hidden rounded-3xl bg-panel">
          <div className="grid lg:grid-cols-2 items-center gap-8 p-8 sm:p-12 lg:p-16">
            <div className="flex flex-col gap-5 max-w-lg">
              <p className="text-xs font-semibold tracking-[0.25em] text-accent">SHOP NEW ARRIVALS</p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
                Fresh styles for every day.
              </h1>
              <p className="text-muted text-[17px] leading-relaxed">
                New running shoes, easy layers and everyday tech. Picked, priced and ready to ship.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link to="/c/new" className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-btn text-btn-ink text-[15px] font-medium hover:opacity-90">
                  Shop new arrivals <ArrowRight size={16} />
                </Link>
                <Link to="/c/shoes" className="inline-flex items-center h-12 px-6 rounded-full border border-line-strong text-[15px] font-medium hover:border-ink">
                  Explore shoes
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 h-[340px] sm:h-[420px]">
              {hero.length ? hero.slice(0, 3).map((p, i) => (
                <Link key={p.product_id} to={`/p/${p.product_id}`}
                  className={`relative overflow-hidden rounded-2xl bg-photo ${i === 0 ? "row-span-2" : ""}`}>
                  <img src={p.image_url ?? ""} alt={p.name} className="h-full w-full object-cover hover:scale-[1.03] transition-transform duration-500" />
                  <span className="absolute left-3 bottom-3 rounded-full bg-canvas/90 backdrop-blur px-3 py-1 text-xs font-medium text-ink">{p.name}</span>
                </Link>
              )) : <><Skeleton className="row-span-2" /><Skeleton /><Skeleton /></>}
            </div>
          </div>
        </div>
      </section>

      {/* Reassurance strip */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 mt-6 grid sm:grid-cols-3 gap-3">
        {[
          { icon: <Truck size={18} />, title: "Free standard delivery", text: "Express available for $9.99" },
          { icon: <RotateCcw size={18} />, title: "30-day returns", text: "Easy, no-questions returns" },
          { icon: <ShieldCheck size={18} />, title: "Secure checkout", text: "Every payment security-checked" },
        ].map((b) => (
          <div key={b.title} className="flex items-center gap-3 rounded-2xl border border-line px-5 py-4">
            <span className="w-9 h-9 rounded-full bg-panel grid place-items-center text-ink">{b.icon}</span>
            <div><p className="text-sm font-medium">{b.title}</p><p className="text-xs text-muted">{b.text}</p></div>
          </div>
        ))}
      </section>

      <TalkshopPicks />

      {/* New arrivals */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 mt-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-muted">JUST IN</p>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-1">New arrivals</h2>
          </div>
          <Link to="/c/new" className="text-sm font-medium inline-flex items-center gap-1 hover:underline">View all <ArrowRight size={14} /></Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-10">
          {arrivals ? arrivals.map((p, i) => <ProductTile key={p.product_id} product={p} priority={i < 4}
              picked={pickIds.has(p.product_id)} selected={p.product_id === selectedId} />)
            : Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}
        </div>
      </section>

      {/* Departments */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 mt-20">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Shop by department</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {DEPT_TILES.map((t) => (
            <Link key={t.slug} to={`/c/${t.slug}`} className="group relative overflow-hidden rounded-2xl bg-photo aspect-[4/5]">
              {tiles[t.slug]?.image_url && (
                <img src={tiles[t.slug]!.image_url!} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
              )}
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/55 to-transparent text-white">
                <p className="text-lg font-semibold">{t.label}</p>
                <p className="text-sm text-white/80">{t.blurb}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
