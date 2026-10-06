/**
 * Makes ShopSphere and Talkshop one product (plan §5). Shared by the panel
 * and every store page:
 *   I1/I3  the shopper and the current page go with every Talkshop turn
 *   I2     Talkshop's cart changes update the header badge and cart page
 *   I4     "Ask Talkshop about this" opens the panel on that product
 *   I5     Talkshop's top 3 show on the storefront as "Talkshop picks"
 *   I6     the product selected in chat is highlighted on the page
 *   I9     a new order refreshes My Orders
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { TalkEvent } from "../api/talkshop";
import type { Product } from "../api/shop";
import { useCart } from "../store/cart";
import { useTalkshop, type Page, type Talkshop } from "./useTalkshop";
import { TALKSHOP_ASK_EVENT } from "./bridge";

const OPEN_KEY = "talkshop_panel_open";
export const RESUME_KEY = "talkshop_resume";

export function pageFromLocation(pathname: string, search: string): Page {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return { type: "home" };
  if (parts[0] === "c" && parts[1]) return { type: "category", department: parts[1] };
  if (parts[0] === "p" && parts[1]) return { type: "product", product_id: parts[1] };
  if (parts[0] === "search") return { type: "search", query: new URLSearchParams(search).get("q") ?? "" };
  return { type: parts[0] };                       // cart, checkout, orders
}

interface TalkshopShared extends Talkshop {
  open: boolean;
  setOpen: (open: boolean) => void;
  picks: (Product & { reason?: string | null })[];
  selectedId: string | null;
  ordersVersion: number;
  ask: (productId: string, name?: string) => void;
}

const Ctx = createContext<TalkshopShared | null>(null);

function isDesktop() { return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches; }

export function TalkshopProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const page = useMemo(() => pageFromLocation(location.pathname, location.search), [location.pathname, location.search]);
  const pageRef = useRef(page);
  pageRef.current = page;
  const ts = useTalkshop(() => pageRef.current);
  const { setCart, refresh: refreshCart } = useCart();
  const [ordersVersion, setOrdersVersion] = useState(0);
  const [open, setOpenState] = useState(() => {
    try { const saved = localStorage.getItem(OPEN_KEY); return saved === null ? isDesktop() : saved === "1"; }
    catch { return isDesktop(); }
  });
  const setOpen = useCallback((o: boolean) => {
    setOpenState(o);
    try { localStorage.setItem(OPEN_KEY, o ? "1" : "0"); } catch { /* private mode */ }
  }, []);

  // React to what Talkshop does — only to new events, not ones restored on reload.
  const processed = useRef(-1);
  useEffect(() => {
    if (!ts.ready) return;
    if (processed.current < 0) { processed.current = ts.events.length; return; }
    const fresh = ts.events.slice(processed.current);
    processed.current = ts.events.length;
    for (const ev of fresh) {
      if (ev.type === "cart_updated") setCart(ev.cart, { bump: true });
      if (ev.type === "order_confirmed") { refreshCart(); setOrdersVersion((v) => v + 1); }
      if (ev.type === "product_selected") {
        // Point at the product on the page if it's there
        setTimeout(() => document.querySelector(`[data-product-tile="${ev.product.product_id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
      }
    }
  }, [ts.events, ts.ready, setCart, refreshCart]);

  // Signed in from Talkshop's sign-in card: carry on to checkout.
  useEffect(() => {
    if (!ts.ready) return;
    try {
      if (sessionStorage.getItem(RESUME_KEY) === "checkout") {
        sessionStorage.removeItem(RESUME_KEY);
        ts.send({ action: { type: "checkout" } });
      }
    } catch { /* private mode */ }
  }, [ts.ready]);  // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh conversation follows the shopper: greet again for the new page
  // until they've actually said something.
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    if (!ts.ready || ts.busy) return;
    if (!ts.events.some((e) => e.type === "user_message")) ts.restart();
  }, [page]);  // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useCallback((productId: string, name?: string) => {
    setOpen(true);
    ts.send({ action: { type: "ask_about", product_id: productId, label: name ? `Help me choose: ${name}` : "Help me choose this" } });
  }, [setOpen, ts]);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const { productId, name } = (e as CustomEvent<{ productId: string; name?: string }>).detail;
      ask(productId, name);
    };
    window.addEventListener(TALKSHOP_ASK_EVENT, onAsk);
    return () => window.removeEventListener(TALKSHOP_ASK_EVENT, onAsk);
  }, [ask]);

  const { picks, selectedId } = useMemo(() => {
    let picks: (Product & { reason?: string | null })[] = [];
    let selectedId: string | null = null;
    ts.events.forEach((ev: TalkEvent) => {
      if (ev.type === "recommendations") { picks = ev.products; selectedId = null; }
      if (ev.type === "product_selected") selectedId = ev.product.product_id;
    });
    return { picks, selectedId };
  }, [ts.events]);

  return <Ctx.Provider value={{ ...ts, open, setOpen, picks, selectedId, ordersVersion, ask }}>{children}</Ctx.Provider>;
}

export function useTalkshopShared(): TalkshopShared {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTalkshopShared must be used inside TalkshopProvider");
  return ctx;
}
