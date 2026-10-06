/**
 * ShopSphere merchant services (Demo 1) — typed client for backend/routers/shop.py
 * and products.py. The website and the Talkshop panel both use these.
 */
import { authFetch } from "./client";

export interface ColorOption { name: string; hex: string; image_url: string | null; in_stock: boolean }
export interface Product {
  product_id: string; slug: string; merchant_id: string; name: string; brand: string;
  department: string; category: string; subcategory: string; gender: "women" | "men" | "unisex";
  description: string; tags: string[]; price: number; currency: string; rating: number; review_count: number;
  is_new: boolean; delivery_days: number; option_label: string; image_url: string | null;
  colors: ColorOption[]; sizes: string[]; in_stock: boolean;
}
export interface Variant { sku: string; size: string | null; color: string; color_hex: string; stock: number; in_stock: boolean; image_url: string | null }
export interface ProductDetail extends Product { variants: Variant[] }
export interface Availability {
  product_id: string; option_label: string; has_sizes: boolean;
  sizes: { size: string; available: boolean }[];
  colors: { name: string; hex: string; image_url: string | null; available: boolean }[];
  selected: { sku: string | null; size: string | null; color: string; stock: number; available: boolean; image_url: string | null } | null;
}
export interface CartLine {
  line_id: string; sku: string; product_id: string; name: string; brand: string; size: string | null; color: string;
  option_label: string; quantity: number; unit_price: number; line_total: number; image_url: string | null;
  delivery_days: number; stock: number; in_stock: boolean;
}
export interface Cart { lines: CartLine[]; item_count: number; subtotal: number; currency: string }
export interface Address {
  address_id: string; label: string; full_name: string; line1: string; line2: string | null; city: string;
  state: string; postal_code: string; country: string; is_default: boolean; display: string;
}
export interface Card {
  payment_method_id: string; brand: string; last4: string; exp_month: number; exp_year: number;
  cardholder_name: string; is_default: boolean; display: string;
}
export interface CheckoutLine {
  line_id: string; sku: string; product_id: string; name: string; brand: string; size: string | null; color: string;
  option_label: string; quantity: number; unit_price: number; line_total: number; image_url: string | null; in_stock: boolean;
}
export interface DeliveryOption { method: "standard" | "express"; label: string; price: number; date: string }
export interface CheckoutIssue { code: string; message?: string; name?: string; available?: number }
export interface Checkout {
  checkout_id: string; status: "open" | "consented" | "paid" | "cancelled"; lines: CheckoutLine[]; item_count: number;
  subtotal: number; tax: number; tax_rate: number; shipping: number; total: number; currency: string;
  delivery: { method: "standard" | "express"; date: string; options: DeliveryOption[] };
  address: Address | null; payment_method: Card | null; saved_addresses: Address[]; saved_payment_methods: Card[];
  issues: CheckoutIssue[]; ready: boolean; checkout_hash: string;
}
export interface OrderLine { sku: string; product_id: string; name: string; size: string | null; color: string; quantity: number; unit_price: number; line_total: number; image_url: string | null }
export interface Order {
  order_id: string; internal_order_id: string; status: string; payment_status: string | null; lines: OrderLine[];
  subtotal: number; tax: number; shipping: number; total: number; currency: string;
  delivery_method: string | null; delivery_date: string | null; ship_to: Address | null;
  payment: { brand: string; last4: string; display: string } | null; tracking_number: string | null; created_at: string | null;
}
export type ConfirmResult =
  | { status: "authorized"; order: Order; transaction_id: string }
  | { status: "declined" | "blocked" | "order_failed"; reason: string; message: string; checkout: Checkout };

export class ShopError extends Error {
  code: string; status: number; detail: Record<string, unknown>;
  constructor(status: number, detail: Record<string, unknown>) {
    super(String(detail.message ?? "Something went wrong"));
    this.code = String(detail.code ?? "ERROR"); this.status = status; this.detail = detail;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "object" && body.detail ? body.detail : { message: body.detail ?? res.statusText };
    throw new ShopError(res.status, detail);
  }
  return res.json();
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface ProductQuery {
  q?: string; department?: string; category?: string; subcategory?: string; gender?: string; brand?: string;
  color?: string; size?: string; min_price?: number; max_price?: number; new?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating" | "new"; limit?: number;
}

export const shop = {
  products: (query: ProductQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") params.set(k, String(v)); });
    return call<Product[]>(`/api/products?${params}`);
  },
  product: (id: string) => call<ProductDetail>(`/api/products/${id}`),
  availability: (id: string, size?: string | null, color?: string | null) => {
    const params = new URLSearchParams();
    if (size) params.set("size", size);
    if (color) params.set("color", color);
    return call<Availability>(`/api/products/${id}/availability?${params}`);
  },

  cart: () => call<Cart>("/api/cart/lines"),
  addToCart: (sku: string, quantity = 1) => call<Cart & { added_line_id: string }>("/api/cart/lines", json("POST", { sku, quantity })),
  setQuantity: (lineId: string, quantity: number) => call<Cart>(`/api/cart/lines/${lineId}`, json("PATCH", { quantity })),
  removeLine: (lineId: string) => call<Cart>(`/api/cart/lines/${lineId}`, json("DELETE")),

  addresses: () => call<Address[]>("/api/me/addresses"),
  addAddress: (a: Omit<Address, "address_id" | "is_default" | "display" | "country" | "label" | "line2"> & { line2?: string; label?: string; make_default?: boolean }) =>
    call<Address>("/api/me/addresses", json("POST", a)),
  deleteAddress: (id: string) => call<{ deleted: string }>(`/api/me/addresses/${id}`, json("DELETE")),
  cards: () => call<Card[]>("/api/me/payment-methods"),
  deleteCard: (id: string) => call<{ deleted: string }>(`/api/me/payment-methods/${id}`, json("DELETE")),
  addCard: (c: { number: string; exp_month: number; exp_year: number; cvc: string; cardholder_name: string; make_default?: boolean }) =>
    call<Card>("/api/me/payment-methods", json("POST", c)),

  createCheckout: (lineIds: string[]) => call<Checkout>("/api/checkouts", json("POST", { line_ids: lineIds })),
  checkout: (id: string) => call<Checkout>(`/api/checkouts/${id}`),
  updateCheckout: (id: string, changes: { delivery_method?: string; address_id?: string; payment_method_id?: string; quantities?: Record<string, number> }) =>
    call<Checkout>(`/api/checkouts/${id}`, json("PATCH", changes)),
  cancelCheckout: (id: string) => call<Checkout>(`/api/checkouts/${id}/cancel`, json("POST")),
  confirm: (id: string) => call<ConfirmResult>(`/api/checkouts/${id}/confirm`, json("POST", { consent: true })),

  orders: () => call<(Record<string, unknown> & { display_id?: string })[]>("/api/orders"),
  order: (id: string) => call<Record<string, unknown> & Partial<Order> & { display_id?: string; amount?: number }>(`/api/orders/${id}`),
};

export const DEPARTMENTS = [
  { slug: "women", label: "Women", query: { gender: "women" } },
  { slug: "men", label: "Men", query: { gender: "men" } },
  { slug: "shoes", label: "Shoes", query: { department: "shoes" } },
  { slug: "accessories", label: "Accessories", query: { department: "accessories" } },
  { slug: "electronics", label: "Electronics", query: { department: "electronics" } },
] as const;

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function niceDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" });
}
