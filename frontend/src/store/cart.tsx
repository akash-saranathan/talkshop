/**
 * One ShopSphere cart for the whole app. The header badge, the cart page and
 * (Phase 6) the Talkshop panel all read this; anything that changes the cart
 * calls setCart() with the server's response so they stay in step.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { shop, type Cart } from "../api/shop";
import { useAuth } from "../auth/AuthContext";

interface CartState {
  cart: Cart | null;
  count: number;
  bumpKey: number;           // changes whenever items are added → header badge animates
  refresh: () => Promise<void>;
  setCart: (cart: Cart, opts?: { bump?: boolean }) => void;
}

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [cart, setCartState] = useState<Cart | null>(null);
  const [bumpKey, setBumpKey] = useState(0);

  const refresh = useCallback(async () => {
    try { setCartState(await shop.cart()); } catch { /* signed out or offline — badge just stays as is */ }
  }, []);

  const setCart = useCallback((next: Cart, opts?: { bump?: boolean }) => {
    setCartState(next);
    if (opts?.bump) setBumpKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (user) refresh();
    else setCartState(null);
  }, [user, refresh]);

  return (
    <CartContext.Provider value={{ cart, count: cart?.item_count ?? 0, bumpKey, refresh, setCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
