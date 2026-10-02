import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShoppingBag, Trash2, Loader, ShoppingCart } from "lucide-react";
import { getCart, removeFromCart, updateCartItemQuantity, type CartItemData } from "../api/cart";
import { authFetch } from "../api/client";
import { getProductVisual } from "../utils/productVisual";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionCartIds?: Set<string>;
  onCheckout?: (item: CartItemData) => void;
}

function getArrivalLabel(days: number): string {
  if (days === 0) return "Arrives today";
  if (days === 1) return "Arrives tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `Arrives ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function CartDrawer({ open, onClose, sessionCartIds, onCheckout }: Props) {
  const [items, setItems] = useState<CartItemData[]>([]);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Cart and wallet load independently — a slow/missing wallet row never
    // blocks the cart items from appearing.
    getCart()
      .then((cartItems) => setItems(cartItems))
      .catch(() => {})
      .finally(() => setLoading(false));
    authFetch("/api/wallet")
      .then((r) => r.ok ? r.json() : null)
      .then((w) => { if (w) setWallet(w); })
      .catch(() => {});
  }, [open]);

  const handleRemove = async (id: string) => {
    setRemoving((prev) => new Set(prev).add(id));
    try {
      await removeFromCart(id);
      setItems((prev) => prev.filter((i) => i.cart_item_id !== id));
    } catch {/* noop */}
    setRemoving((prev) => { const s = new Set(prev); s.delete(id); return s; });
  };

  const handleQtyChange = async (item: CartItemData, delta: number) => {
    const newQty = item.quantity + delta;
    if (newQty <= 0) { handleRemove(item.cart_item_id); return; }
    try {
      const updated = await updateCartItemQuantity(item.cart_item_id, newQty);
      setItems((prev) => prev.map((i) => i.cart_item_id === item.cart_item_id ? updated : i));
    } catch {/* noop */}
  };

  const sessionItems = sessionCartIds && sessionCartIds.size > 0
    ? items.filter((i) => sessionCartIds.has(i.cart_item_id))
    : items;
  const previousItems = sessionCartIds && sessionCartIds.size > 0
    ? items.filter((i) => !sessionCartIds.has(i.cart_item_id))
    : [];
  const hasSplit = previousItems.length > 0;

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);

  const handleCheckout = () => {
    const target = sessionItems[0] ?? items[0];
    if (target && onCheckout) {
      onClose();
      onCheckout(target);
    } else {
      onClose();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/40"
          />

          {/* Drawer */}
          <motion.div
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[91] w-80 bg-[var(--color-surface)] border-l border-[var(--color-border)] flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border)] shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingBag size={17} className="text-[var(--color-primary)]" />
                <span className="font-semibold text-[var(--color-text)]">Your Cart</span>
                {items.length > 0 && (
                  <span className="text-xs bg-[var(--color-primary)] text-white rounded-full px-1.5 py-0.5 font-medium">
                    {items.reduce((s, i) => s + i.quantity, 0)}
                  </span>
                )}
              </div>
              <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader size={20} className="animate-spin text-[var(--color-primary)]" />
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">
                  <ShoppingBag size={32} className="mx-auto mb-3 opacity-30" />
                  <p>Your cart is empty</p>
                  <p className="text-xs mt-1">Add items from the chat to get started</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {hasSplit && sessionItems.length > 0 && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Added this session</p>
                  )}
                  {(hasSplit ? sessionItems : items).map((item) => (
                    <CartItemRow key={item.cart_item_id} item={item} removing={removing} onRemove={handleRemove} onQtyChange={handleQtyChange} />
                  ))}
                  {hasSplit && previousItems.length > 0 && (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mt-1 pt-2 border-t border-[var(--color-border)]">Previously added</p>
                      {previousItems.map((item) => (
                        <CartItemRow key={item.cart_item_id} item={item} removing={removing} onRemove={handleRemove} onQtyChange={handleQtyChange} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="px-4 py-4 border-t border-[var(--color-border)] shrink-0 flex flex-col gap-3">
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-[var(--color-text)]">Subtotal</span>
                  <span className="text-[var(--color-primary)]">${subtotal.toFixed(2)}</span>
                </div>
                {wallet && (
                  <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                    <span>Wallet balance</span>
                    <span className={wallet.balance >= subtotal ? "text-[var(--color-success)]" : "text-amber-600"}>
                      ${wallet.balance.toFixed(2)}
                    </span>
                  </div>
                )}
                <button
                  onClick={handleCheckout}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] transition-colors"
                >
                  <ShoppingCart size={15} /> Checkout
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

function CartItemRow({
  item,
  removing,
  onRemove,
  onQtyChange,
}: {
  item: CartItemData;
  removing: Set<string>;
  onRemove: (id: string) => void;
  onQtyChange: (item: CartItemData, delta: number) => void;
}) {
  const visual = getProductVisual(item.title, item.category);
  const VisualIcon = visual.icon;
  const isRemoving = removing.has(item.cart_item_id);

  return (
    <div className={`flex gap-3 transition-opacity ${isRemoving ? "opacity-40" : ""}`}>
      {item.image_url ? (
        <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
      ) : (
        <div className={`w-12 h-12 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
          <VisualIcon size={18} className={visual.fg} strokeWidth={1.5} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2 leading-tight">{item.title}</p>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{getArrivalLabel(item.delivery_days)}</p>
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1 border border-[var(--color-border)] rounded-lg overflow-hidden">
            <button
              onClick={() => onQtyChange(item, -1)}
              disabled={isRemoving}
              className="w-6 h-6 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] text-sm font-medium transition-colors"
            >−</button>
            <span className="text-xs font-medium text-[var(--color-text)] w-5 text-center">{item.quantity}</span>
            <button
              onClick={() => onQtyChange(item, +1)}
              disabled={isRemoving}
              className="w-6 h-6 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] text-sm font-medium transition-colors"
            >+</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-primary)]">
              ${(item.price * item.quantity).toFixed(2)}
            </span>
            <button
              onClick={() => onRemove(item.cart_item_id)}
              disabled={isRemoving}
              className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors"
            >
              {isRemoving ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
