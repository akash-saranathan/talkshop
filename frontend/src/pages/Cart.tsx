import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader, Minus, Plus, Trash2, ShoppingCart, Wallet, CreditCard } from "lucide-react";
import { getCart, updateCartItemQuantity, removeFromCart, type CartItemData } from "../api/cart";
import { authFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getProductVisual } from "../utils/productVisual";

interface WalletBalance { balance: number; currency: string; }

const MOCK_CARDS = [
  { last4: "4242", brand: "Visa",       gradient: "from-blue-500 to-blue-700" },
  { last4: "8317", brand: "Mastercard", gradient: "from-rose-500 to-rose-700" },
  { last4: "5591", brand: "Amex",       gradient: "from-emerald-500 to-emerald-700" },
];

function getArrivalDate(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return "Arrives today";
  if (days === 1) return "Arrives tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `Arrives ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function readSessionCartIds(): Set<string> {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem("talkshop_session_cart_ids") || "[]"));
  } catch {
    return new Set();
  }
}

export default function Cart() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItemData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  // Guests pay by card only — the wallet option isn't offered to them.
  const { isGuest } = useAuth();
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "card">(isGuest ? "card" : "wallet");
  const [selectedCard, setSelectedCard] = useState("4242");
  const [sessionCartIds] = useState<Set<string>>(readSessionCartIds);

  useEffect(() => {
    Promise.all([
      getCart(),
      isGuest ? Promise.resolve(null) : authFetch("/api/wallet").then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([data, w]) => {
        setItems(data);
        if (w) setWallet(w);
        // Auto-select session items; if no session data, select everything
        const toCheck = sessionCartIds.size > 0
          ? data.filter((i) => sessionCartIds.has(i.cart_item_id))
          : data;
        setSelected(new Set(toCheck.map((i) => i.cart_item_id)));
      })
      .catch(() => setError("Couldn't load your cart. Please try again in a moment."))
      .finally(() => setLoading(false));
  }, [sessionCartIds, isGuest]);

  const toggleSelected = (cartItemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cartItemId)) next.delete(cartItemId);
      else next.add(cartItemId);
      return next;
    });
  };

  const handleQuantityChange = async (item: CartItemData, delta: number) => {
    const newQuantity = item.quantity + delta;
    if (newQuantity < 1) return;
    setItems((prev) => prev.map((i) => (i.cart_item_id === item.cart_item_id ? { ...i, quantity: newQuantity } : i)));
    try {
      await updateCartItemQuantity(item.cart_item_id, newQuantity);
    } catch {
      setItems((prev) => prev.map((i) => (i.cart_item_id === item.cart_item_id ? { ...i, quantity: item.quantity } : i)));
    }
  };

  const handleRemove = async (cartItemId: string) => {
    const previous = items;
    setItems((prev) => prev.filter((i) => i.cart_item_id !== cartItemId));
    setSelected((prev) => { const next = new Set(prev); next.delete(cartItemId); return next; });
    try {
      await removeFromCart(cartItemId);
    } catch {
      setItems(previous);
    }
  };

  const selectedItems = items.filter((i) => selected.has(i.cart_item_id));
  const subtotal = selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const walletInsufficient = paymentMethod === "wallet" && wallet !== null && wallet.balance < subtotal;

  const handleCheckout = () => {
    if (selectedItems.length === 0 || walletInsufficient) return;
    navigate("/checkout", { state: { items: selectedItems, paymentMethod, selectedCard } });
  };

  const sessionItems = items.filter((i) => sessionCartIds.has(i.cart_item_id));
  const previousItems = items.filter((i) => !sessionCartIds.has(i.cart_item_id));
  const hasSplit = sessionCartIds.size > 0 && previousItems.length > 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Loader size={24} className="animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  const renderItem = (item: CartItemData, index: number) => {
    const visual = getProductVisual(item.title, item.category);
    const VisualIcon = visual.icon;
    const showImage = item.image_url && !imageErrors.has(item.cart_item_id);
    const isChecked = selected.has(item.cart_item_id);
    const arrivalLabel = getArrivalDate(item.delivery_days);

    return (
      <motion.div
        key={item.cart_item_id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.04 }}
        className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow"
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => toggleSelected(item.cart_item_id)}
          className="w-4 h-4 accent-[var(--color-primary)] shrink-0"
        />

        {showImage ? (
          <img
            src={item.image_url!}
            alt={item.title}
            onError={() => setImageErrors((prev) => new Set(prev).add(item.cart_item_id))}
            className="w-24 h-24 rounded-xl object-cover shrink-0"
          />
        ) : (
          <div className={`w-24 h-24 rounded-xl grid place-items-center shrink-0 ${visual.bg}`}>
            <VisualIcon size={32} className={visual.fg} strokeWidth={1.5} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[var(--color-text)] truncate">{item.title}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{item.merchant_name}</p>
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)] mt-1.5">
            {item.rating > 0 && <span>★ {item.rating.toFixed(1)}</span>}
            {arrivalLabel && (
              <span className={item.delivery_days <= 2 ? "text-[var(--color-success)] font-medium" : ""}>
                {item.delivery_days <= 2 ? "⚡ " : ""}{arrivalLabel}
              </span>
            )}
            {item.size && <span>Size {item.size}</span>}
            {item.color && <span className="capitalize">{item.color}</span>}
          </div>
          <p className="text-sm font-medium text-[var(--color-text)] mt-2">
            ${item.price.toFixed(2)}
            {item.quantity > 1 && <span className="text-[var(--color-text-muted)] font-normal"> each</span>}
          </p>
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleRemove(item.cart_item_id)}
            title="Remove"
            className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors"
          >
            <Trash2 size={16} />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleQuantityChange(item, -1)}
              disabled={item.quantity <= 1}
              className="w-7 h-7 rounded-lg border border-[var(--color-border)] grid place-items-center text-[var(--color-text-muted)] hover:text-[var(--color-primary)] disabled:opacity-40 transition-colors"
            >
              <Minus size={13} />
            </button>
            <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
            <button
              type="button"
              onClick={() => handleQuantityChange(item, 1)}
              className="w-7 h-7 rounded-lg border border-[var(--color-border)] grid place-items-center text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>
          <p className="font-bold text-[var(--color-primary)]">
            ${(item.price * item.quantity).toFixed(2)}
          </p>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <div className="flex items-center gap-4 mb-1">
        <Link
          to="/chat"
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ArrowLeft size={15} /> Back to Chat
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-[var(--color-primary)] mb-1">Your Cart</h1>
      {items.length > 0 && (
        <p className="text-sm text-[var(--color-text-muted)] mb-6">
          {items.length} item{items.length === 1 ? "" : "s"} in your cart
        </p>
      )}

      {error && <p className="text-sm text-rose-500 mb-4">{error}</p>}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-28 text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-primary)]/10 grid place-items-center">
            <ShoppingCart size={28} className="text-[var(--color-primary)]" />
          </div>
          <div>
            <p className="font-medium text-[var(--color-text)]">Your cart is empty</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Ask the assistant for something and hit Select to add it here.
            </p>
          </div>
          <Link
            to="/chat"
            className="px-5 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] transition-colors"
          >
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mt-2">
          {/* Item list */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {hasSplit ? (
              <>
                {/* Current session items */}
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Added This Session
                  </p>
                  <div className="flex flex-col gap-3">
                    {sessionItems.map((item, i) => renderItem(item, i))}
                  </div>
                </div>

                {/* Previous items */}
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Earlier
                  </p>
                  <div className="flex flex-col gap-3">
                    {previousItems.map((item, i) => renderItem(item, sessionItems.length + i))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((item, i) => renderItem(item, i))}
              </div>
            )}
          </div>

          {/* Order summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-[var(--color-text)]">Order Summary</h2>

              {/* Item list */}
              {selectedItems.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No items selected</p>
              ) : (
                <div className="flex flex-col gap-1.5 text-sm max-h-48 overflow-y-auto pr-1">
                  {selectedItems.map((i) => (
                    <div key={i.cart_item_id} className="flex justify-between gap-2">
                      <span className="text-[var(--color-text-muted)] truncate">
                        {i.title} {i.quantity > 1 && `× ${i.quantity}`}
                      </span>
                      <span className="shrink-0">${(i.price * i.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center border-t border-[var(--color-border)] pt-3 font-semibold text-base">
                <span>Subtotal</span>
                <span className="text-[var(--color-primary)]">${subtotal.toFixed(2)}</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] -mt-3">
                {selectedItems.length} of {items.length} item{items.length === 1 ? "" : "s"} selected
              </p>

              {/* Payment method */}
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Payment Method
                </p>
                <div className={`grid gap-2 mb-3 ${isGuest ? "grid-cols-1" : "grid-cols-2"}`}>
                  {!isGuest && <button
                    type="button"
                    onClick={() => setPaymentMethod("wallet")}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      paymentMethod === "wallet"
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                    }`}
                  >
                    <Wallet size={15} /> Wallet
                  </button>}
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("card")}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      paymentMethod === "card"
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                    }`}
                  >
                    <CreditCard size={15} /> Card
                  </button>
                </div>

                {paymentMethod === "wallet" && wallet && (
                  <div className={`rounded-xl p-3 flex items-center justify-between text-sm border ${
                    wallet.balance >= subtotal
                      ? "bg-[var(--color-success)]/5 border-[var(--color-success)]/20"
                      : "bg-amber-50 border-amber-200"
                  }`}>
                    <span className="text-[var(--color-text-muted)]">Balance</span>
                    <span className={`font-semibold ${wallet.balance >= subtotal ? "text-[var(--color-success)]" : "text-amber-600"}`}>
                      ${wallet.balance.toFixed(2)}
                    </span>
                  </div>
                )}

                {paymentMethod === "card" && (
                  <div className="flex flex-col gap-2">
                    {MOCK_CARDS.map((card) => (
                      <label
                        key={card.last4}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                          selectedCard === card.last4
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
                            : "border-[var(--color-border)] hover:border-[var(--color-primary)]/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="card"
                          value={card.last4}
                          checked={selectedCard === card.last4}
                          onChange={() => setSelectedCard(card.last4)}
                          className="accent-[var(--color-primary)]"
                        />
                        <div className={`w-8 h-5 rounded bg-gradient-to-r ${card.gradient} shrink-0`} />
                        <span className="text-sm text-[var(--color-text)]">
                          {card.brand} ••••{card.last4}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {walletInsufficient && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
                  Wallet balance (${wallet!.balance.toFixed(2)}) is less than your subtotal — switch to Card or remove items.
                </p>
              )}
              <button
                type="button"
                onClick={handleCheckout}
                disabled={selectedItems.length === 0 || walletInsufficient}
                className="w-full px-5 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Proceed to Checkout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
