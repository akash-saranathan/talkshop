import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, ChevronRight, CreditCard, MapPin, Package, Truck } from "lucide-react";
import { money, niceDate, shop, type Address, type OrderLine } from "../../api/shop";
import { Badge, Empty, Spinner } from "../../components/ui";

interface OrderView {
  id: string; created_at: string | null; total: number; delivery_date: string | null; delivery_method: string | null;
  lines: OrderLine[]; ship_to: Address | null; payment: { display: string } | null; tracking_number: string | null;
  subtotal: number; tax: number; shipping: number; delivery_status: string | null;
}

function toView(o: Record<string, unknown>): OrderView | null {
  if (!o.display_id) return null;               // only ShopSphere (Demo 1) orders
  return {
    id: String(o.display_id), created_at: (o.created_at as string) ?? null, total: Number(o.amount ?? o.total ?? 0),
    delivery_date: (o.delivery_date as string) ?? null, delivery_method: (o.delivery_method as string) ?? null,
    lines: (o.lines as OrderLine[]) ?? [], ship_to: (o.ship_to as Address) ?? null,
    payment: (o.payment as { display: string }) ?? null, tracking_number: (o.tracking_number as string) ?? null,
    subtotal: Number(o.subtotal ?? 0), tax: Number(o.tax ?? 0), shipping: Number(o.shipping ?? 0),
    delivery_status: (o.delivery_status as string) ?? null,
  };
}

const STATUS: Record<string, { label: string; tone: "good" | "accent" | "neutral" }> = {
  processing: { label: "Processing", tone: "neutral" }, shipped: { label: "On its way", tone: "accent" },
  delivered: { label: "Delivered", tone: "good" },
};

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  useEffect(() => {
    shop.orders().then((rows) => setOrders(rows.map(toView).filter(Boolean) as OrderView[])).catch(() => setOrders([]));
  }, []);

  if (!orders) return <Spinner label="Loading your orders…" />;
  return (
    <div className="mx-auto max-w-[960px] px-4 sm:px-6 pt-10">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">My orders</h1>
      {!orders.length ? (
        <Empty icon={<Package size={22} />} title="No orders yet">
          <p>When you place an order it'll show up here.</p>
          <Link to="/" className="inline-flex mt-4 h-11 px-6 items-center rounded-full bg-btn text-btn-ink text-sm font-medium">Start shopping</Link>
        </Empty>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {orders.map((o) => {
            const status = STATUS[o.delivery_status ?? "processing"] ?? STATUS.processing;
            return (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="flex items-center gap-5 rounded-3xl border border-line p-5 hover:border-line-strong transition-colors">
                  <div className="flex -space-x-4">
                    {o.lines.slice(0, 3).map((l) => (
                      <div key={l.sku} className="w-16 h-16 rounded-2xl bg-photo overflow-hidden border-2 border-canvas">
                        {l.image_url && <img src={l.image_url} alt="" className="h-full w-full object-cover" />}
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><p className="font-semibold">Order {o.id}</p><Badge tone={status.tone}>{status.label}</Badge></div>
                    <p className="text-sm text-muted line-clamp-1">{o.lines.map((l) => l.name).join(", ")}</p>
                    <p className="text-sm text-muted">{o.created_at ? `Placed ${niceDate(o.created_at)}` : ""}{o.delivery_date ? ` · Arrives ${niceDate(o.delivery_date)}` : ""}</p>
                  </div>
                  <p className="font-semibold tabular-nums">{money(o.total)}</p>
                  <ChevronRight size={18} className="text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const placed = params.get("placed") === "1";
  const [order, setOrder] = useState<OrderView | null | undefined>(undefined);
  useEffect(() => { shop.order(orderId).then((o) => setOrder(toView(o))).catch(() => setOrder(null)); }, [orderId]);

  if (order === undefined) return <Spinner label="Loading your order…" />;
  if (order === null) return <Empty title="Order not found"><Link to="/orders" className="underline">My orders</Link></Empty>;
  const status = STATUS[order.delivery_status ?? "processing"] ?? STATUS.processing;

  return (
    <div className="mx-auto max-w-[960px] px-4 sm:px-6 pt-10">
      {placed && (
        <div className="rounded-3xl bg-good-soft text-good p-6 flex items-start gap-4 mb-8">
          <CheckCircle2 size={28} className="shrink-0" />
          <div>
            <p className="text-lg font-semibold">Thank you! Your order is confirmed.</p>
            <p className="text-sm">Order {order.id}{order.delivery_date ? ` arrives ${niceDate(order.delivery_date)}` : ""}. We'll keep you posted.</p>
          </div>
        </div>
      )}
      <nav className="text-xs text-muted"><Link to="/orders" className="hover:underline">My orders</Link> / {order.id}</nav>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <h1 className="text-3xl font-semibold tracking-tight">Order {order.id}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      {order.created_at && <p className="text-muted text-sm mt-1">Placed {niceDate(order.created_at)}</p>}

      <div className="mt-8 grid md:grid-cols-3 gap-4">
        <div className="rounded-3xl border border-line p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold mb-2"><Truck size={16} /> Delivery</p>
          <p>{order.delivery_method === "express" ? "Express" : "Standard"}{order.delivery_date ? ` · ${niceDate(order.delivery_date)}` : ""}</p>
          {order.tracking_number && <p className="text-muted mt-1">Tracking {order.tracking_number}</p>}
        </div>
        <div className="rounded-3xl border border-line p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold mb-2"><MapPin size={16} /> Ship to</p>
          <p className="text-muted">{order.ship_to?.display ?? "—"}</p>
        </div>
        <div className="rounded-3xl border border-line p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold mb-2"><CreditCard size={16} /> Payment</p>
          <p>{order.payment?.display ?? "—"}</p><p className="text-good mt-1">Authorized</p>
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-line p-6">
        <ul className="divide-y divide-line">
          {order.lines.map((l) => (
            <li key={l.sku} className="py-4 first:pt-0 flex gap-4 items-center">
              <Link to={`/p/${l.product_id}`} className="w-20 h-20 rounded-2xl bg-photo overflow-hidden shrink-0">
                {l.image_url && <img src={l.image_url} alt={l.name} className="h-full w-full object-cover" />}
              </Link>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{l.name}</p>
                <p className="text-sm text-muted">{l.size ? `Size ${l.size} · ` : ""}{l.color} · Qty {l.quantity}</p>
              </div>
              <p className="font-semibold tabular-nums">{money(l.line_total)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-4 border-t border-line flex flex-col gap-1.5 text-sm max-w-xs ml-auto">
          <div className="flex justify-between"><span className="text-muted">Items</span><span className="tabular-nums">{money(order.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Delivery</span><span className="tabular-nums">{order.shipping ? money(order.shipping) : "Free"}</span></div>
          <div className="flex justify-between"><span className="text-muted">Tax</span><span className="tabular-nums">{money(order.tax)}</span></div>
          <div className="flex justify-between text-base font-semibold pt-2"><span>Total</span><span className="tabular-nums">{money(order.total)}</span></div>
        </div>
      </div>
    </div>
  );
}
