import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, CheckCircle, XCircle, Clock } from "lucide-react";

export default function Checkout() {
  const navigate = useNavigate();
  const [approved, setApproved] = useState(false);

  // Phase 3: checkout object will come from LangGraph state via SSE
  const checkout = {
    product: "Nike Pegasus 41",
    merchant: "RunnerWorld",
    size: "11 · Black",
    subtotal: 109.00,
    tax: 8.99,
    shipping: 0.00,
    total: 117.99,
    maskedCard: "4242",
    delivery: "October 2",
    expiresIn: "14:47",
    merchant_id: "MERCHANT_A",
    max_amount: 117.99,
  };

  const handleApprove = () => {
    setApproved(true);
    // Phase 3: POST /api/authorizations/approve then navigate to result
    setTimeout(() => navigate("/payment-result"), 1500);
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <h1 className="text-xl font-semibold text-[var(--color-primary)] mb-6">Checkout &amp; Authorization</h1>
      <div className="grid grid-cols-2 gap-6 max-w-3xl">

        {/* Order Summary */}
        <div className="rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)]">
          <h2 className="font-semibold mb-4 text-[var(--color-text)]">Order Summary</h2>
          <p className="font-medium">{checkout.product}</p>
          <p className="text-sm text-[var(--color-text-muted)]">Merchant: {checkout.merchant}</p>
          <p className="text-sm text-[var(--color-text-muted)] mb-4">{checkout.size}</p>
          <div className="space-y-1 text-sm border-t border-[var(--color-border)] pt-3">
            <div className="flex justify-between"><span>Item</span><span>${checkout.subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>${checkout.tax.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Shipping</span><span>${checkout.shipping.toFixed(2)}</span></div>
            <div className="flex justify-between font-semibold text-base border-t border-[var(--color-border)] pt-2 mt-2">
              <span>Total</span><span>${checkout.total.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mt-3">Visa ●●●● {checkout.maskedCard} ✓</p>
          <p className="text-sm text-[var(--color-text-muted)]">Delivery: {checkout.delivery}</p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={handleApprove}
              disabled={approved}
              className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] disabled:opacity-50 transition-colors"
            >
              {approved ? "Processing..." : "Approve Purchase"}
            </button>
            <button
              onClick={() => navigate("/")}
              className="w-full py-2 rounded-xl border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Authorization Panel */}
        <div className="rounded-2xl border border-[var(--color-border)] p-5 bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-[var(--color-primary)]" />
            <h2 className="font-semibold text-[var(--color-text)]">Payment Authorization</h2>
          </div>
          <div className="space-y-2 mb-4">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Agent Access</p>
            <div className="flex items-center gap-2 text-sm text-rose-500"><XCircle size={14}/> Card number (never exposed)</div>
            <div className="flex items-center gap-2 text-sm text-rose-500"><XCircle size={14}/> CVV (never exposed)</div>
            <div className="flex items-center gap-2 text-sm text-rose-500"><XCircle size={14}/> Banking credentials</div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Scoped Authorization</p>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]"><CheckCircle size={14}/> Merchant: {checkout.merchant}</div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]"><CheckCircle size={14}/> Max Amount: ${checkout.max_amount.toFixed(2)}</div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]"><Clock size={14}/> Expires in: {checkout.expiresIn}</div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]"><CheckCircle size={14}/> Single use only</div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-success)]"><CheckCircle size={14}/> Checkout hash bound</div>
          </div>
        </div>
      </div>
    </div>
  );
}
