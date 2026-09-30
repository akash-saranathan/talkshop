/**
 * Cart API client — typed helpers over /api/cart, mirroring the authFetch
 * pattern already used in chat.ts.
 */
import { authFetch } from "./client";
import type { ProductData } from "./chat";

export interface CartItemData {
  cart_item_id: string;
  product_id: string;
  merchant_id: string;
  merchant_name: string;
  title: string;
  brand: string | null;
  category: string;
  price: number;
  currency: string;
  size: string | null;
  color: string | null;
  image_url: string | null;
  rating: number;
  delivery_days: number;
  quantity: number;
  added_at: string | null;
}

export async function addToCart(product: ProductData, quantity = 1): Promise<CartItemData> {
  const res = await authFetch("/api/cart/items", {
    method: "POST",
    body: JSON.stringify({
      product_id: product.product_id,
      merchant_id: product.merchant_id,
      merchant_name: product.merchant_name,
      title: product.title,
      brand: product.brand,
      category: product.category,
      price: product.price,
      currency: product.currency,
      size: product.size,
      color: product.color,
      image_url: product.image_url,
      rating: product.rating,
      delivery_days: product.delivery_days,
      quantity,
    }),
  });
  if (!res.ok) throw new Error("Failed to add item to cart");
  return res.json();
}

export async function getCart(): Promise<CartItemData[]> {
  const res = await authFetch("/api/cart");
  if (!res.ok) throw new Error("Failed to load cart");
  return res.json();
}

export async function updateCartItemQuantity(cartItemId: string, quantity: number): Promise<CartItemData> {
  const res = await authFetch(`/api/cart/items/${cartItemId}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity }),
  });
  if (!res.ok) throw new Error("Failed to update cart item");
  return res.json();
}

export async function removeFromCart(cartItemId: string): Promise<void> {
  const res = await authFetch(`/api/cart/items/${cartItemId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove cart item");
}
