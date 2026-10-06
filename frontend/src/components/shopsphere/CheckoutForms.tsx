/** Inline "add address" / "add card" forms — used by the checkout page and
 *  (Phase 5) Talkshop's review card for customers without saved details. */
import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { shop, ShopError, type Address, type Card } from "../../api/shop";
import { Button, Field, Notice } from "../ui";

export function AddressForm({ onSaved, onCancel, defaultName }: { onSaved: (a: Address) => void; onCancel?: () => void; defaultName?: string }) {
  const [f, setF] = useState({ full_name: defaultName ?? "", line1: "", line2: "", city: "", state: "", postal_code: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try { onSaved(await shop.addAddress({ ...f, make_default: true })); }
    catch (err) { setError(err instanceof ShopError ? err.message : "Couldn't save that address."); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <Field label="Full name" value={f.full_name} onChange={set("full_name")} required className="col-span-2" autoComplete="name" />
      <Field label="Address" value={f.line1} onChange={set("line1")} required className="col-span-2" autoComplete="address-line1" />
      <Field label="Apartment, suite (optional)" value={f.line2} onChange={set("line2")} className="col-span-2" autoComplete="address-line2" />
      <Field label="City" value={f.city} onChange={set("city")} required autoComplete="address-level2" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="State" value={f.state} onChange={set("state")} required maxLength={2} placeholder="TX" autoComplete="address-level1" />
        <Field label="ZIP" value={f.postal_code} onChange={set("postal_code")} required placeholder="78704" autoComplete="postal-code" />
      </div>
      {error && <div className="col-span-2"><Notice>{error}</Notice></div>}
      <div className="col-span-2 flex gap-2">
        <Button type="submit" loading={saving}>Save address</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

export function CardForm({ onSaved, onCancel }: { onSaved: (c: Card) => void; onCancel?: () => void }) {
  const [f, setF] = useState({ number: "", expiry: "", cvc: "", cardholder_name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = f.expiry.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
    if (!m) { setError("Expiry should look like 08/29."); return; }
    setSaving(true); setError(null);
    try {
      // The card goes straight to ShopSphere for tokenization; only the masked
      // result (id, brand, last 4) comes back. Wipe the raw fields at once.
      const saved = await shop.addCard({ number: f.number, exp_month: Number(m[1]), exp_year: Number(m[2]), cvc: f.cvc,
        cardholder_name: f.cardholder_name, make_default: true });
      setF({ number: "", expiry: "", cvc: "", cardholder_name: "" });
      onSaved(saved);
    } catch (err) { setError(err instanceof ShopError ? err.message : "Couldn't save that card."); }
    finally { setSaving(false); }
  };
  const fmtNumber = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
  const fmtExpiry = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <Field label="Card number" inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: fmtNumber(e.target.value) })}
        required className="col-span-2" placeholder="4242 4242 4242 4242" autoComplete="off" />
      <Field label="Expiry" inputMode="numeric" value={f.expiry} onChange={(e) => setF({ ...f, expiry: fmtExpiry(e.target.value) })}
        required placeholder="MM/YY" autoComplete="off" />
      <Field label="CVC" inputMode="numeric" type="password" value={f.cvc} maxLength={4}
        onChange={(e) => setF({ ...f, cvc: e.target.value.replace(/\D/g, "") })} required placeholder="123" autoComplete="off" />
      <Field label="Name on card" value={f.cardholder_name} onChange={(e) => setF({ ...f, cardholder_name: e.target.value })}
        required className="col-span-2" autoComplete="off" />
      <p className="col-span-2 flex items-center gap-1.5 text-xs text-muted">
        <Lock size={12} /> Only the card's last 4 digits are stored. The full number and CVC are never kept.
      </p>
      {error && <div className="col-span-2"><Notice>{error}</Notice></div>}
      <div className="col-span-2 flex gap-2">
        <Button type="submit" loading={saving}>Save card</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
