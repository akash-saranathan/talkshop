import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CreditCard, Lock, MapPin, ShieldCheck, Truck } from "lucide-react";
import { money, niceDate, shop, ShopError, type Checkout } from "../../api/shop";
import { AddressForm, CardForm } from "../../components/shopsphere/CheckoutForms";
import { Button, Empty, Notice, Spinner, Stepper, cx } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { useCart } from "../../store/cart";

function Section({ n, title, icon, action, children }: { n: number; title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-3 font-semibold">
          <span className="w-7 h-7 rounded-full bg-panel grid place-items-center text-xs">{n}</span>
          <span className="text-muted">{icon}</span>{title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Radio({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={checked}
      className={cx("w-full flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
        checked ? "border-ink bg-panel" : "border-line hover:border-line-strong")}>
      <span className={cx("mt-0.5 w-4 h-4 rounded-full border-2 shrink-0", checked ? "border-ink bg-[radial-gradient(circle,var(--ss-ink)_45%,transparent_50%)]" : "border-line-strong")} />
      <span className="flex-1 min-w-0">{children}</span>
    </button>
  );
}

export default function CheckoutPage() {
  const { checkoutId = "" } = useParams();
  const { user } = useAuth();
  const { refresh } = useCart();
  const navigate = useNavigate();
  const [co, setCo] = useState<Checkout | null | undefined>(undefined);
  const [editing, setEditing] = useState<"address" | "card" | null>(null);
  const [adding, setAdding] = useState<"address" | "card" | null>(null);
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { shop.checkout(checkoutId).then(setCo).catch(() => setCo(null)); }, [checkoutId]);

  const change = async (changes: Parameters<typeof shop.updateCheckout>[1]) => {
    setBusy(true); setError(null);
    try { setCo(await shop.updateCheckout(checkoutId, changes)); setEditing(null); }
    catch (e) { setError(e instanceof ShopError ? e.message : "Couldn't update your order."); }
    finally { setBusy(false); }
  };

  const place = async () => {
    setPlacing(true); setError(null);
    try {
      const res = await shop.confirm(checkoutId);   // consent: this click IS the customer's go-ahead
      if (res.status === "authorized") {
        await refresh();
        navigate(`/orders/${res.order.order_id}?placed=1`);
        return;
      }
      setCo(res.checkout);
      setError(`Payment wasn't authorized: ${res.message} No order was created.`);
    } catch (e) {
      setError(e instanceof ShopError ? e.message : "Couldn't place your order. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  const back = async () => {
    try { await shop.cancelCheckout(checkoutId); } catch { /* already closed */ }
    navigate("/cart");
  };

  if (co === undefined) return <Spinner label="Preparing your order…" />;
  if (co === null) return <Empty title="Checkout not found"><Link to="/cart" className="underline">Back to cart</Link></Empty>;
  if (co.status !== "open") return (
    <Empty title={co.status === "paid" ? "This order has already been placed" : "This checkout was closed"}>
      <Link to={co.status === "paid" ? "/orders" : "/cart"} className="underline">{co.status === "paid" ? "View my orders" : "Back to cart"}</Link>
    </Empty>
  );

  const missing = co.issues.filter((i) => i.code === "NO_ADDRESS" || i.code === "NO_PAYMENT_METHOD").map((i) => i.message);
  const stock = co.issues.filter((i) => i.code === "OUT_OF_STOCK");

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 pt-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Checkout</h1>
        <button onClick={back} className="text-sm text-muted hover:text-ink">Back to cart</button>
      </div>

      <div className="mt-8 grid lg:grid-cols-[1fr_380px] gap-8 items-start">
        <div className="flex flex-col gap-5">
          <Section n={1} title="Shipping address" icon={<MapPin size={16} />}
            action={co.saved_addresses.length > 0 && !adding && (
              <button onClick={() => setEditing(editing === "address" ? null : "address")} className="text-sm font-medium underline">
                {editing === "address" ? "Done" : "Change"}
              </button>)}>
            {adding === "address" ? (
              <AddressForm defaultName={user?.name} onCancel={co.saved_addresses.length ? () => setAdding(null) : undefined}
                onSaved={(a) => { setAdding(null); change({ address_id: a.address_id }); }} />
            ) : editing === "address" ? (
              <div className="flex flex-col gap-2">
                {co.saved_addresses.map((a) => (
                  <Radio key={a.address_id} checked={a.address_id === co.address?.address_id} onClick={() => change({ address_id: a.address_id })}>
                    <span className="text-sm font-medium">{a.label}</span><span className="block text-sm text-muted">{a.display}</span>
                  </Radio>
                ))}
                <button onClick={() => setAdding("address")} className="self-start text-sm font-medium mt-1 hover:underline">+ Add a new address</button>
              </div>
            ) : co.address ? (
              <p className="text-sm"><span className="font-medium">{co.address.label}</span><span className="block text-muted">{co.address.display}</span></p>
            ) : (
              <AddressForm defaultName={user?.name} onSaved={(a) => change({ address_id: a.address_id })} />
            )}
          </Section>

          <Section n={2} title="Delivery" icon={<Truck size={16} />}>
            <div className="grid sm:grid-cols-2 gap-2">
              {co.delivery.options.map((o) => (
                <Radio key={o.method} checked={co.delivery.method === o.method} onClick={() => change({ delivery_method: o.method })}>
                  <span className="flex justify-between text-sm font-medium"><span>{o.label}</span><span>{o.price ? money(o.price) : "Free"}</span></span>
                  <span className="block text-sm text-muted">Arrives {niceDate(o.date)}</span>
                </Radio>
              ))}
            </div>
          </Section>

          <Section n={3} title="Payment" icon={<CreditCard size={16} />}
            action={co.saved_payment_methods.length > 0 && !adding && (
              <button onClick={() => setEditing(editing === "card" ? null : "card")} className="text-sm font-medium underline">
                {editing === "card" ? "Done" : "Change"}
              </button>)}>
            {adding === "card" ? (
              <CardForm onCancel={co.saved_payment_methods.length ? () => setAdding(null) : undefined}
                onSaved={(c) => { setAdding(null); change({ payment_method_id: c.payment_method_id }); }} />
            ) : editing === "card" ? (
              <div className="flex flex-col gap-2">
                {co.saved_payment_methods.map((c) => (
                  <Radio key={c.payment_method_id} checked={c.payment_method_id === co.payment_method?.payment_method_id}
                    onClick={() => change({ payment_method_id: c.payment_method_id })}>
                    <span className="text-sm font-medium">{c.display}</span>
                    <span className="block text-sm text-muted">Expires {String(c.exp_month).padStart(2, "0")}/{String(c.exp_year).slice(-2)}</span>
                  </Radio>
                ))}
                <button onClick={() => setAdding("card")} className="self-start text-sm font-medium mt-1 hover:underline">+ Add a new card</button>
              </div>
            ) : co.payment_method ? (
              <p className="text-sm"><span className="font-medium">{co.payment_method.display}</span>
                <span className="block text-muted">Expires {String(co.payment_method.exp_month).padStart(2, "0")}/{String(co.payment_method.exp_year).slice(-2)}</span></p>
            ) : (
              <CardForm onSaved={(c) => change({ payment_method_id: c.payment_method_id })} />
            )}
          </Section>

          <Section n={4} title={`Items (${co.item_count})`} icon={null}>
            <ul className="divide-y divide-line">
              {co.lines.map((l) => (
                <li key={l.line_id} className="py-4 first:pt-0 last:pb-0 flex gap-3 sm:gap-4 items-center">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-photo overflow-hidden shrink-0">
                    {l.image_url && <img src={l.image_url} alt={l.name} className="h-full w-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium line-clamp-2 sm:line-clamp-1">{l.name}</p>
                    <p className="text-sm text-muted">{l.size ? `${l.option_label} ${l.size} · ` : ""}{l.color}</p>
                    {!l.in_stock && <p className="text-sm text-bad">Not enough stock for this quantity.</p>}
                  </div>
                  {/* Price above the quantity on phones; side by side on wider screens */}
                  <div className="flex flex-col-reverse sm:flex-row items-end sm:items-center gap-2 sm:gap-4 shrink-0">
                    <Stepper value={l.quantity} busy={busy} onChange={(n) => change({ quantities: { [l.line_id]: n } })} />
                    <p className="sm:w-20 text-right font-semibold tabular-nums">{money(l.line_total)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-24 rounded-3xl border border-line p-6 flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Items</span><span className="tabular-nums">{money(co.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Delivery ({co.delivery.method === "express" ? "Express" : "Standard"})</span>
              <span className="tabular-nums">{co.shipping ? money(co.shipping) : "Free"}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax ({(co.tax_rate * 100).toFixed(2)}%)</span><span className="tabular-nums">{money(co.tax)}</span></div>
          </div>
          <div className="flex justify-between border-t border-line pt-4 text-lg font-semibold"><span>Total</span><span className="tabular-nums">{money(co.total)}</span></div>
          <p className="text-sm text-muted -mt-2">Arrives {niceDate(co.delivery.date)}</p>
          {missing.length > 0 && <Notice tone="talk">{missing.join(" ")}</Notice>}
          {stock.length > 0 && <Notice>{stock.map((s) => `${s.name}: only ${s.available} left.`).join(" ")}</Notice>}
          {error && <Notice>{error}</Notice>}
          <Button size="lg" onClick={place} loading={placing} disabled={!co.ready || busy}>
            <Lock size={15} /> Place order · {money(co.total)}
          </Button>
          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck size={14} className="shrink-0 mt-px" /> Your card is charged only when you place the order, after ShopSphere's payment security checks.
          </p>
        </aside>
      </div>
    </div>
  );
}
