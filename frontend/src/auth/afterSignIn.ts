/**
 * Where a shopper goes after logging in. Checkout started as a visitor is
 * remembered here and finished after sign-in: the cart lines they selected
 * (renamed by the server's cart merge) go straight into a checkout.
 */
import { shop } from "../api/shop";

const PENDING_KEY = "ss_pending_checkout";

export function rememberCheckout(lineIds: string[]) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(lineIds)); } catch { /* private mode */ }
}

/** Continue as guest (Phase 10): the remembered cart lines go into a guest
 *  checkout; no account is created. Returns the path to go to. */
export async function continueAsGuest(): Promise<string> {
  try {
    const pending: string[] = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]");
    if (pending.length) {
      const co = await shop.createCheckout([...new Set(pending)], true);
      sessionStorage.removeItem(PENDING_KEY);
      return `/checkout/${co.checkout_id}`;
    }
  } catch { /* fall back to the cart */ }
  return "/cart";
}

/** Returns the path to go to after signing in. */
export async function afterSignIn(next: string | null, merged: Record<string, string>): Promise<string> {
  if (next === "checkout") {
    try {
      const pending: string[] = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]");
      sessionStorage.removeItem(PENDING_KEY);
      const ids = [...new Set(pending.map((id) => merged[id] ?? id))];
      if (ids.length) return `/checkout/${(await shop.createCheckout(ids)).checkout_id}`;
    } catch { /* fall back to the cart */ }
    return "/cart";
  }
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
