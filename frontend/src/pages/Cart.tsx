import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader, Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { getCart, updateCartItemQuantity, removeFromCart, type CartItemData } from "../api/cart";
import { getProductVisual } from "../utils/productVisual";

export default function Cart() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItemData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    getCart()
      .then((data) => {
        setItems(data);
        // Everything starts checked — with one item this means Proceed
        // works immediately with no extra clicking.
        setSelected(new Set(data.map((i) => i.cart_item_id)));
      })
      .catch(() => setError("Couldn't load your cart. Please try again in a moment."))
      .finally(() => setLoading(false));
  }, []);

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
      // Revert on failure
      setItems((prev) => prev.map((i) => (i.cart_item_id === item.cart_item_id ? { ...i, quantity: item.quantity } : i)));
    }
  };

  const handleRemove = async (cartItemId: string) => {
    const previous = items;
    setItems((prev) => prev.filter((i) => i.cart_item_id !== cartItemId));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(cartItemId);
      return next;
    });
    try {
      await removeFromCart(cartItemId);
    } catch {
      setItems(previous);
    }
  };

  const selectedItems = items.filter((i) => selected.has(i.cart_item_id));
  const subtotal = selectedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const handleCheckout = () => {
    if (selectedItems.length === 0) return;
    navigate("/checkout", { state: { items: selectedItems } });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Loader size={24} className="animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] p-6">
      <div className="flex items-center gap-4 mb-1">
        <a
          href="/"
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ArrowLeft size={15} /> Back to Chat
        </a>
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
          <a
            href="/"
            className="px-5 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:bg-[var(--color-primary-light)] transition-colors"
          >
            Start shopping
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mt-2">
          {/* Item list */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            {items.map((item, index) => {
              const visual = getProductVisual(item.title, item.category);
              const VisualIcon = visual.icon;
              const showImage = item.image_url && !imageErrors.has(item.cart_item_id);
              const isChecked = selected.has(item.cart_item_id);

              return (
                <motion.div
                  key={item.cart_item_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
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
                      <span>Ships {item.delivery_days}d</span>
                      {item.size && <span>Size {item.size}</span>}
                      {item.color && <span>{item.color}</span>}
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
            })}
          </div>

          {/* Order summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h2 className="font-semibold text-[var(--color-text)] mb-4">Order Summary</h2>

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

              <div className="flex justify-between items-center border-t border-[var(--color-border)] pt-3 mt-3 font-semibold text-base">
                <span>Subtotal</span>
                <span className="text-[var(--color-primary)]">${subtotal.toFixed(2)}</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {selectedItems.length} of {items.length} item{items.length === 1 ? "" : "s"} selected
              </p>

              <button
                type="button"
                onClick={handleCheckout}
                disabled={selectedItems.length === 0}
                className="w-full mt-4 px-5 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-light)] disabled:opacity-40 transition-colors"
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
