/**
 * Track Order (Phase 10): anyone can follow an order with its Order ID and the
 * email used for it. Guests have no account, so this is how they see their
 * order after checkout. A wrong ID or email gets the same neutral message.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Mail, MapPin, Package } from "lucide-react";
import { money, niceDate, shop, ShopError, type ConfirmationEmail, type TrackedOrder } from "../../api/shop";
import { ShipmentProgress } from "../../components/shopsphere/ShipmentProgress";
import { Badge, Button, Field, Notice } from "../../components/ui";

const TONE: Record<string, "good" | "accent" | "neutral"> = { delivered: "good", shipped: "accent", out_for_delivery: "accent" };

export default function TrackOrderPage() {
  const [params] = useSearchParams();
  const state = (useLocation().state ?? {}) as { orderId?: string; email?: string; placed?: boolean };
  const [orderId, setOrderId] = useState(state.orderId ?? params.get("order") ?? "");
  const [email, setEmail] = useState(state.email ?? "");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [mail, setMail] = useState<ConfirmationEmail | null>(null);
  const [showMail, setShowMail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placed = !!state.placed;

  const lookup = async (id = orderId, addr = email) => {
    setLoading(true); setError(null); setMail(null); setShowMail(false);
    try { setOrder(await shop.track(id.trim(), addr.trim())); }
    catch (e) { setOrder(null); setError(e instanceof ShopError ? e.message : "Couldn't look up that order. Please try again."); }
    finally { setLoading(false); }
  };

  // Straight from a guest checkout: show the order without retyping anything.
  useEffect(() => { if (state.orderId && state.email) lookup(state.orderId, state.email); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => { e.preventDefault(); lookup(); };

  const toggleMail = async () => {
    if (showMail) { setShowMail(false); return; }
    if (!mail && order) {
      try { setMail(await shop.trackEmail(order.order_id, email.trim())); }
      catch { setMail(null); }
    }
    setShowMail(true);
  };

  const advance = async () => {
    if (!order) return;
    setAdvancing(true);
    try { setOrder(await shop.trackAdvance(order.order_id, email.trim())); }
    finally { setAdvancing(false); }
  };

  return (
    <div className="mx-auto max-w-[960px] px-4 sm:px-6 pt-10">
      <nav className="text-xs text-muted"><Link to="/" className="hover:underline">Home</Link> / Track order</nav>

      {placed && order && (
        <div className="mt-4 rounded-3xl bg-good-soft text-good p-6 flex items-start gap-4">
          <CheckCircle2 size={28} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-semibold">Order confirmed. Thank you for your purchase.</p>
            <p className="text-sm">Order ID: <span className="font-semibold tabular-nums">{order.order_id}</span></p>
            <p className="text-sm break-words">A confirmation email has been sent to {email}.</p>
            <p className="text-sm">You can track your order any time using your Order ID and checkout email.</p>
          </div>
        </div>
      )}

      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-4">Track your order</h1>
      <p className="text-muted mt-1">Enter your Order ID and the email you used at checkout.</p>

      <form onSubmit={submit} className="mt-6 grid sm:grid-cols-[1fr_1.4fr_auto] gap-3 items-end">
        <Field id="track-order-id" label="Order ID" value={orderId} onChange={(e) => setOrderId(e.target.value)}
          required placeholder="SS-12345" autoComplete="off" />
        <Field id="track-email" label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          required placeholder="you@example.com" autoComplete="email" />
        <Button type="submit" size="lg" loading={loading}>Track order</Button>
      </form>
      {error && <div className="mt-4"><Notice>{error}</Notice></div>}

      {order && (
        <div className="mt-8 flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">Order {order.order_id}</h2>
            <Badge tone={TONE[order.shipment.status] ?? "neutral"}>{order.shipment.status_label}</Badge>
            {order.guest && <span className="text-xs text-muted">Guest order</span>}
          </div>
          {order.created_at && <p className="text-sm text-muted -mt-3">Placed {niceDate(order.created_at)}</p>}

          <div className="grid md:grid-cols-[1.1fr_1fr] gap-5 items-start">
            <section className="rounded-3xl border border-line p-6 min-w-0">
              <h3 className="font-semibold mb-4">Shipping progress</h3>
              <ShipmentProgress shipment={order.shipment} />
              <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">Demo control: move the simulated shipment to its next step.</p>
                <Button size="sm" variant="secondary" onClick={advance} loading={advancing} disabled={order.shipment.status === "delivered"}>
                  Next shipping step
                </Button>
              </div>
            </section>

            <div className="flex flex-col gap-5 min-w-0">
              <section className="rounded-3xl border border-line p-6">
                <h3 className="flex items-center gap-2 font-semibold mb-3"><Package size={16} /> Items</h3>
                <ul className="flex flex-col gap-3">
                  {order.lines.map((l, i) => (
                    <li key={i} className="flex gap-3 items-center">
                      <div className="w-14 h-14 rounded-xl bg-photo overflow-hidden shrink-0">
                        {l.image_url && <img src={l.image_url} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-1">{l.name}</p>
                        <p className="text-xs text-muted">{l.size ? `Size ${l.size} · ` : ""}{l.color} · Qty {l.quantity}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{money(l.line_total)}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 pt-4 border-t border-line flex flex-col gap-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted">Items</span><span className="tabular-nums">{money(order.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Delivery</span><span className="tabular-nums">{order.shipping ? money(order.shipping) : "Free"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Tax</span><span className="tabular-nums">{money(order.tax)}</span></div>
                  <div className="flex justify-between font-semibold pt-1"><span>Total</span><span className="tabular-nums">{money(order.total)}</span></div>
                </div>
              </section>
              <section className="rounded-3xl border border-line p-6 text-sm flex flex-col gap-3">
                <p className="flex items-center gap-2"><MapPin size={15} className="text-muted" />
                  Shipping to {[order.ship_to.city, order.ship_to.state].filter(Boolean).join(", ") || "—"}</p>
                <p className="flex items-center gap-2"><CreditCard size={15} className="text-muted" />
                  {order.payment?.display ?? "—"} · <span className="text-good">Payment {order.payment_status === "authorized" ? "completed" : order.payment_status}</span></p>
                <button type="button" onClick={toggleMail} className="self-start inline-flex items-center gap-2 font-medium hover:underline">
                  <Mail size={15} /> {showMail ? "Hide confirmation email" : "View confirmation email"}
                </button>
              </section>
            </div>
          </div>

          {showMail && (
            <section className="rounded-3xl border border-line p-6 min-w-0">
              <p className="text-xs text-muted mb-3">Demo outbox: this is the email ShopSphere sent. A real store would deliver it to the inbox.</p>
              {mail ? (
                <>
                  <p className="text-sm"><span className="text-muted">To:</span> {mail.to}</p>
                  <p className="text-sm font-semibold mt-1">{mail.subject}</p>
                  <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-soft">{mail.body}</pre>
                </>
              ) : <p className="text-sm text-muted">No confirmation email was found for this order.</p>}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
