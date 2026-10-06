import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, Square, X, LogOut, ShoppingCart, Sparkles, ArrowUpDown, Star, Zap, TrendingDown, GitCompare, ChevronDown, ChevronUp, Trash2, CheckCircle2, ShoppingBag, Activity, GitBranch, ChevronRight, ChevronLeft } from "lucide-react";
import { streamChat, getSessionMessages, attachImage, type AgentEvent, type ProductData, type ChatMessageRecord, type ChatAction } from "../api/chat";
import { getCart, addToCart, removeFromCart, updateCartItemQuantity, type CartItemData } from "../api/cart";
import { authFetch } from "../api/client";
import ProductCard from "../components/ProductCard";
import SkeletonProductCard from "../components/SkeletonProductCard";
import CompareModal from "../components/CompareModal";
import CartDrawer from "../components/CartDrawer";
import ChatSidebar from "../components/ChatSidebar";
import AgentTrailPanel from "../components/AgentTrailPanel";
import ProtocolTracePanel, { type ProtocolEvent } from "../components/ProtocolTracePanel";
import ThemeToggle from "../components/ThemeToggle";
import InlineCheckout, { SAVED_CARDS, type AutoState, type InlineCheckoutData, type CheckoutData as InlineCheckoutDataShape } from "../components/InlineCheckout";
import AutoStepBar from "../components/AutoStepBar";
import InlineOrderTracker from "../components/InlineOrderTracker";
import { useAuth } from "../auth/AuthContext";
import { getProductVisual } from "../utils/productVisual";
import { autocorrectOnType, autocorrectLastWord, type Correction } from "../utils/autocorrect";

// ── Intent parsing ──────────────────────────────────────────────────────────

interface SimpleIntent {
  color?: string;
  size?: string;
  maxPrice?: number;
  brand?: string;
}

const KNOWN_COLORS = ["black","white","blue","red","green","grey","gray","navy","pink","orange","yellow","purple","brown","beige","floral"];
const KNOWN_BRANDS = ["nike","adidas","new balance","brooks","asics","saucony","hoka","puma","reebok","on running","mizuno","sony","apple","samsung","bose","jabra","garmin","bcbg","zara","h&m","converse","vans","jordan"];

function parseSimpleIntent(message: string): SimpleIntent {
  const m = message.toLowerCase();
  const intent: SimpleIntent = {};
  for (const c of KNOWN_COLORS) { if (m.includes(c)) { intent.color = c; break; } }
  const sizeMatch = m.match(/\bsize\s+(\w+)\b/i) ?? m.match(/\bin\s+(xs|s|m|l|xl|xxl)\b/i);
  if (sizeMatch) intent.size = sizeMatch[1].toUpperCase();
  const priceMatch = m.match(/under\s+\$?(\d+)/i) ?? m.match(/\$?(\d+)\s+or\s+less/i) ?? m.match(/below\s+\$?(\d+)/i);
  if (priceMatch) intent.maxPrice = parseInt(priceMatch[1]);
  for (const b of KNOWN_BRANDS) { if (m.includes(b)) { intent.brand = b.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "); break; } }
  return intent;
}

function computeMatchTags(intent: SimpleIntent, product: ProductData): string[] {
  const tags: string[] = [];
  if (intent.color && product.color?.toLowerCase().includes(intent.color)) tags.push(intent.color);
  if (intent.size && product.size?.toLowerCase() === intent.size.toLowerCase()) tags.push(`size ${intent.size}`);
  if (intent.maxPrice && product.price <= intent.maxPrice) tags.push(`under $${intent.maxPrice}`);
  if (intent.brand && product.brand?.toLowerCase().includes(intent.brand.toLowerCase())) tags.push(intent.brand);
  return tags;
}

function generateFollowUpChips(products: ProductData[], intent: SimpleIntent): string[] {
  const chips: string[] = [];
  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))] as string[];
  if (brands.length > 1) {
    chips.push(`Only ${brands[0]}`);
    if (brands[1] && chips.length < 3) chips.push(`Only ${brands[1]}`);
  }
  const prices = products.map(p => p.price).sort((a, b) => a - b);
  const spread = prices[prices.length - 1] - prices[0];
  if (spread > prices[0] * 0.4 && !intent.maxPrice) {
    chips.push(`Under $${Math.round(prices[0] + spread * 0.5)}`);
  }
  const fastCount = products.filter(p => p.delivery_days <= 2).length;
  if (fastCount > 0 && fastCount < products.length) chips.push("Fastest delivery only");
  if (products.length > 1 && chips.length < 4) chips.push("Which one should I buy?");
  return chips.slice(0, 4);
}

type SortMode = "match" | "price" | "rating" | "delivery";

function sortProducts(products: ProductData[], mode: SortMode): ProductData[] {
  const arr = [...products];
  if (mode === "price") return arr.sort((a, b) => a.price - b.price);
  if (mode === "rating") return arr.sort((a, b) => b.rating - a.rating);
  if (mode === "delivery") return arr.sort((a, b) => a.delivery_days - b.delivery_days);
  return arr.sort((a, b) => b.rank_score - a.rank_score);
}

// ── Turn types ───────────────────────────────────────────────────────────────

interface Step {
  id: string;
  message: string;
  status: "running" | "done" | "error";
}

interface Turn {
  id: string;
  userMessage: string;
  image?: string;
  steps: Step[];
  products: ProductData[];
  recommendation: string;
  blocked: string | null;
  intent: SimpleIntent;
  checkout?: InlineCheckoutData;
  cartAdded?: { product: ProductData };
  showCartInline?: boolean;
  orderTracker?: boolean;
}

function renderWithBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold text-[var(--color-text)]">{part}</strong> : part
  );
}

function isAffirmativeInput(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!?.]+$/, "");
  return /^(yes|yeah|yep|sure|ok|okay|confirm|proceed|pay|go ahead|do it|sounds good|let's do it|lets do it|buy|buy it|buy now|ok proceed|yes proceed|yes please|yes buy it|ok buy it|continue|let's go|lets go|pay now|ok pay|yes pay)$/.test(t);
}

// Broader checkout intent — catches multi-word phrases like "add it to my cart",
// "lets move on to buying it", "make payment", "proceed to checkout", etc.
// Used in handleSend to intercept these before sending to the backend.
function isCheckoutIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(add\s+it|add\s+to\s+(my\s+)?cart|buy\s+it|purchase\s+it|place\s+order|proceed\s+to\s+(checkout|pay)|make\s+payment|complete\s+purchase|checkout|let'?s\s+buy|move\s+on\s+to\s+buy|go\s+ahead\s+and\s+(buy|pay)|ready\s+to\s+pay|want\s+to\s+buy)\b/.test(t);
}

// Explicit checkout phrases used when there's no active product ref — avoids
// triggering checkout on bare "ok"/"sure" which could be follow-up acks.
function isExplicitCheckoutPhrase(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!?.]+$/, "");
  return /^(proceed|ok proceed|yes proceed|buy it|buy now|checkout now|pay now|yes buy it|ok buy it|place order|let'?s\s+(buy|checkout|pay))$/.test(t)
    || isCheckoutIntent(text);
}

// Intercept "show cart" / "view cart" style messages so we never send them to
// the LangGraph backend (which has no way to fetch or display cart contents).
function isShowCartIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  // Standalone "cart" or "my cart"
  if (t === "cart" || t === "my cart") return true;
  // Message has a "view/show/open/check" word AND the word "cart"
  if (/\bcart\b/.test(t) && /\b(show|view|open|see|display|check|look at)\b/.test(t)) return true;
  // "what's in my cart" style
  if (/\bcart\b/.test(t) && /\b(what|whats)\b/.test(t)) return true;
  return false;
}

// "track my order", "where's my package", "order status" → show inline order tracker.
function isOrderTrackingIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/\border(s|er)?\b/.test(t) && /\b(track|status|where|when|check|show|my|all)\b/.test(t)) return true;
  if (/\b(track(ing)?|where('?s)?|when)\b/.test(t) && /\b(order|package|parcel|shipment|delivery)\b/.test(t)) return true;
  if (/^(my orders?|show orders?|all orders?|order history|order tracker)$/.test(t)) return true;
  if (/\b(delivery status|shipping status|when will (it|my order) arrive)\b/.test(t)) return true;
  return false;
}

// "add it", "add to cart", "add this" → add-to-cart (not checkout).
function isAddToCartPhrase(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!?.]+$/, "");
  if (/^(add to cart|add it|add this|add it to cart|add this to cart|add it to my cart|add this to my cart)$/.test(t)) return true;
  if (/\badd\s+(it|this|that)\s+(to\s+(my\s+)?cart)\b/.test(t)) return true;
  return false;
}

// Inline cart card — shown in chat after add-to-cart or when user asks to view cart.
const AUTO_SECONDS = 10;
const SESSION_CART_TIMER_ID = "session-cart";

interface AutoTimer extends AutoState {
  turnId: string;
  stage: "cart" | "checkout";
  product: ProductData;
}

function InlineCartCard({
  addedProduct,
  cartItems,
  onViewCart,
  auto,
  onPauseToggle,
}: {
  addedProduct?: ProductData;
  cartItems: import("../api/cart").CartItemData[];
  onViewCart: () => void;
  auto?: AutoState;
  onPauseToggle?: () => void;
}) {
  const visual = addedProduct ? getProductVisual(addedProduct.title, addedProduct.category) : null;
  const VisualIcon = visual?.icon;
  const total = cartItems.reduce((sum, item) => sum + item.price, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[var(--color-border)] overflow-hidden max-w-sm"
      style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}
    >
      {addedProduct && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]"
          style={{ background: "linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)" }}>
          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
          <p className="text-sm font-semibold text-emerald-700">Added to cart!</p>
        </div>
      )}
      {!addedProduct && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]"
          style={{ background: "linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)" }}>
          <ShoppingBag size={14} className="text-blue-600 shrink-0" />
          <p className="text-sm font-semibold text-blue-700">Your Cart</p>
        </div>
      )}

      {addedProduct && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
          {addedProduct.image_url ? (
            <img src={addedProduct.image_url} alt={addedProduct.title}
              className="w-11 h-11 rounded-lg object-cover shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (VisualIcon && visual) ? (
            <div className={`w-11 h-11 rounded-lg grid place-items-center shrink-0 ${visual.bg}`}>
              <VisualIcon size={16} className={visual.fg} strokeWidth={1.5} />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{addedProduct.title}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{addedProduct.merchant_name} · ${addedProduct.price.toFixed(2)}</p>
          </div>
        </div>
      )}

      {cartItems.length > 0 && (
        <div className="bg-[var(--color-bg)]">
          <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
              Cart · {cartItems.length} {cartItems.length === 1 ? "item" : "items"}
            </span>
            <span className="text-xs font-bold text-[var(--color-text)]">${total.toFixed(2)}</span>
          </div>
          {cartItems.slice(0, 4).map((item) => (
            <div key={item.cart_item_id}
              className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--color-border)]/60">
              <span className="text-xs text-[var(--color-text)] truncate flex-1 mr-2">{item.title}</span>
              <span className="text-xs font-semibold text-[var(--color-text)] shrink-0">${item.price.toFixed(2)}</span>
            </div>
          ))}
          {cartItems.length > 4 && (
            <p className="text-xs text-[var(--color-text-muted)] px-4 py-1.5 border-t border-[var(--color-border)]/60">
              +{cartItems.length - 4} more item{cartItems.length - 4 > 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {cartItems.length === 0 && !addedProduct && (
        <p className="px-4 py-3 text-sm text-[var(--color-text-muted)] bg-[var(--color-bg)]">Your cart is empty.</p>
      )}

      <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        <button onClick={onViewCart}
          className="flex-1 py-2 text-xs font-semibold rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors">
          View Cart
        </button>
      </div>
      {auto && (
        <AutoStepBar
          label="Checkout"
          secondsLeft={auto.secondsLeft}
          paused={auto.paused}
          onPauseToggle={onPauseToggle!}
        />
      )}
    </motion.div>
  );
}

function _parseOrdinalWord(w: string): number {
  const map: Record<string, number> = {
    first: 0, "1st": 0, "1": 0,
    second: 1, "2nd": 1, "2": 1,
    third: 2, "3rd": 2, "3": 2,
    fourth: 3, "4th": 3, "4": 3,
    fifth: 4, "5th": 4, "5": 4,
  };
  return map[w] ?? 0;
}

// Returns 0-based product index when the message contains an action word ("add",
// "buy", etc.) AND an ordinal — e.g. "add first one to cart" → 0.
function getOrdinalCheckoutTarget(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!/\b(add|buy|purchase|checkout|order|get)\b/.test(t)) return null;
  const m = t.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|[1-5])\b/);
  return m ? _parseOrdinalWord(m[1]) : null;
}

// Pasted screenshots can be huge — downscale before it ever leaves the
// browser, both for a snappy paste and a small request body.
async function resizeImageForUpload(file: Blob, maxDim = 768, quality = 0.7): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Map robotic agent step messages to first-person friendly text.
// Returns null to suppress zero-count noise steps.
function humanizeStep(message: string): string | null {
  const m = message.toLowerCase();

  // Suppress zero-product noise
  if (/\b0 products?\b/.test(m) || /catalogued 0/.test(m) || /top 0 picks/.test(m)) return null;

  // Suppress internal follow-up routing messages — right pane handles those
  if (m.includes("answering your question") || m.includes("follow-up question")) return null;

  // VibeCheck
  if (m.includes("vibecheck")) {
    if (m.includes("all clear") || m.includes("ready to shop")) return "Let me figure out what you're looking for...";
    if (m.includes("understood") || m.includes("looking for")) {
      const hit = message.match(/[Ll]ooking for (.+)/);
      return hit ? `Got it! I'm searching for ${hit[1]}...` : "On it! Starting the search...";
    }
    if (m.includes("writing") || m.includes("recommendation")) return "Picking the best options for you...";
    if (m.includes("chitchat") || m.includes("greeting") || m.includes("no products")) return "Hey there! What can I help you find?";
  }

  // SneakPeek
  if (m.includes("sneakpeek")) {
    const found = message.match(/found (\d+) products? across (\d+)/i);
    if (found) {
      const n = parseInt(found[1]);
      if (n === 0) return null;
      return `Found ${n} option${n !== 1 ? "s" : ""} across ${found[2]} store${found[2] !== "1" ? "s" : ""}!`;
    }
    const top = message.match(/top (\d+) picks/i);
    if (top) {
      const n = parseInt(top[1]);
      if (n === 0) return null;
      return `Here are your top ${n} picks!`;
    }
    return null;
  }

  // CartUp / GreenLight / PayIt / TrackIt
  if (m.includes("cartup")) return "Setting up your order...";
  if (m.includes("greenlight")) return m.includes("authorized") || m.includes("approved") ? "Transaction approved!" : "Running security checks...";
  if (m.includes("payit")) return m.includes("success") || m.includes("confirm") ? "Payment confirmed!" : "Processing payment securely...";
  if (m.includes("trackit")) return "Your order is confirmed and on its way!";

  return message;
}

function messagesToTurns(messages: ChatMessageRecord[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i += 2) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];
    if (!userMsg || userMsg.role !== "user") continue;
    turns.push({
      id: crypto.randomUUID(),
      userMessage: userMsg.content,
      steps: [],
      products: assistantMsg?.products ?? [],
      recommendation: assistantMsg?.content ?? "",
      blocked: assistantMsg?.blocked_reason ?? null,
      intent: parseSimpleIntent(userMsg.content),
    });
  }
  return turns;
}

export default function Chat() {
  const navigate = useNavigate();
  const { user, logout, isGuest } = useAuth();
  // Remembers the guest card entered during this session — never persisted to storage.
  const sessionGuestCardRef = useRef<import("../components/InlineCheckout").GuestCardInput | null>(null);
  const [input, setInput] = useState("");
  const [pastedImage, setPastedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const checkoutCreateMsRef = useRef(new Map<string, number>());
  const turnsRef = useRef<Turn[]>(turns);
  turnsRef.current = turns;
  const [autoTimer, setAutoTimer] = useState<AutoTimer | null>(null);
  const [loading, setLoading] = useState(false);
  // Product the agent just recommended and asked "Want me to add to cart?" —
  // drives the Add/Dismiss chips below the recommendation text.
  const [pendingCheckoutProduct, setPendingCheckoutProduct] = useState<ProductData | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [sessionCartCount, setSessionCartCount] = useState(0);
  // Incrementing this forces ProductCards to remount and reset their qty state after payment.
  const [productCardResetKey, setProductCardResetKey] = useState(0);
  const [sessionCartIds, setSessionCartIds] = useState<Set<string>>(new Set());
  const [sessionCartItems, setSessionCartItems] = useState<CartItemData[]>([]);
  const [cartPanelOpen, setCartPanelOpen] = useState(false);
  const [turnSortModes, setTurnSortModes] = useState<Map<string, SortMode>>(new Map());
  const [selectedProducts, setSelectedProducts] = useState<Map<string, ProductData>>(new Map());
  const [showCompare, setShowCompare] = useState(false);
  const [showCartDrawer, setShowCartDrawer] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(true);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightTab, setRightTab] = useState<"trace" | "pipeline">("trace");
  const [protocolEvents, setProtocolEvents] = useState<ProtocolEvent[]>([]);
  const [leftWidth, setLeftWidth] = useState(256);
  const [rightWidth, setRightWidth] = useState(() => Math.round((window.innerWidth - 48) * 0.40));
  const resizingRef = useRef<"left" | "right" | null>(null);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(32).fill(4));
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Distinguishes "the browser ended the session on its own" (e.g. after a
  // pause — should silently resume so it feels continuous) from "the user
  // clicked Stop/Cancel" (should actually end).
  const stoppingRef = useRef(false);
  const autoSendRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always points to the latest handleSend — lets recognition callbacks call
  // it directly without capturing a stale closure.
  const handleSendRef = useRef<((override?: string) => void) | null>(null);
  // Same pattern for doCheckoutSummary — avoids TDZ when handleSend references it.
  const doCheckoutSummaryRef = useRef<((userText: string, product: ProductData, alreadyAdded?: boolean) => void) | null>(null);
  const attachCheckoutToActiveTurnRef = useRef<((turnId: string, product: ProductData) => void) | null>(null);
  const doAddToCartRef = useRef<((userText: string, product: ProductData) => void) | null>(null);
  const attachAddToCartToActiveTurnRef = useRef<((turnId: string, product: ProductData) => void) | null>(null);
  // Tracks the last agent-recommended product so "yes/ok" can trigger checkout
  // without relying on the selected-products visual state.
  const lastRecommendedProductRef = useRef<ProductData | null>(null);
  // sessionIdRef is the source of truth read inside async streaming
  // callbacks (avoids stale-closure bugs); currentSessionId mirrors it so
  // the sidebar can reactively highlight the active thread.
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const [currentSessionId, setCurrentSessionId] = useState<string>(sessionIdRef.current);
  const closeStream = useRef<(() => void) | null>(null);
  const activeTurnId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // The autocorrect just applied — Backspace straight after it restores
  // what was actually typed (same as a phone keyboard).
  const lastCorrectionRef = useRef<Correction | null>(null);

  // Grow the textarea with its content instead of scrolling a single line.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // This chat's cart, keyed by product — the single source of truth for the
  // quantity shown on product cards and in the compare popup, so a change
  // made in one place shows up in the other.
  const cartItemByProduct = useMemo(
    () => new Map(sessionCartItems.map((i) => [i.product_id, i])),
    [sessionCartItems],
  );

  // Re-read the cart after any add/update/remove. Quantities come from the
  // server (adding a product that's already in the cart bumps its quantity
  // there), so local guesses can't drift from what will actually be bought.
  const syncSessionCart = useCallback(async (addedItemId?: string) => {
    const items = await getCart();
    setCartCount(items.length);
    if (addedItemId) setSessionCartIds((prev) => new Set(prev).add(addedItemId));
    setSessionCartItems((prev) => {
      const ids = new Set(prev.map((i) => i.cart_item_id));
      if (addedItemId) ids.add(addedItemId);
      return items.filter((i) => ids.has(i.cart_item_id));
    });
  }, []);

  const addProductToSessionCart = useCallback(async (product: ProductData) => {
    const item = await addToCart(product);
    await syncSessionCart(item.cart_item_id);
    setAutoTimer({ turnId: SESSION_CART_TIMER_ID, stage: "cart", secondsLeft: AUTO_SECONDS, paused: false, product });
  }, [syncSessionCart]);

  const setSessionCartQuantity = useCallback(async (item: CartItemData, quantity: number) => {
    if (quantity < 1) await removeFromCart(item.cart_item_id);
    else await updateCartItemQuantity(item.cart_item_id, quantity);
    await syncSessionCart();
    setAutoTimer((a) => (a?.stage === "cart" ? { ...a, secondsLeft: AUTO_SECONDS, paused: false } : a));
  }, [syncSessionCart]);


  // Refresh the cart badge on mount and whenever the tab regains focus —
  // covers coming back from Cart/Checkout after adding, removing, or buying.
  useEffect(() => {
    const refreshCartCount = () => {
      getCart().then((items) => setCartCount(items.length)).catch(() => {});
    };
    refreshCartCount();
    window.addEventListener("focus", refreshCartCount);
    return () => window.removeEventListener("focus", refreshCartCount);
  }, []);

  // Drag-to-resize for the left/right panels — separate from collapse,
  // for when the user wants the panel narrower but still visible.
  const startResize = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const MIN_WIDTH = 200;
    const MAX_WIDTH = 700;
    const clamp = (v: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v));

    const onMouseMove = (e: MouseEvent) => {
      if (resizingRef.current === "left") {
        setLeftWidth(clamp(e.clientX));
      } else if (resizingRef.current === "right") {
        setRightWidth(clamp(window.innerWidth - e.clientX));
      }
    };
    const onMouseUp = () => {
      resizingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Cleanup SSE + mic + checkout timer on unmount
  useEffect(() => () => {
    closeStream.current?.();
    stoppingRef.current = true;
    recognitionRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  }, []);

  // Reveal the newest content only as far as needed, and only when the user is
  // already near the bottom or has just sent a message, so their scrolling is respected.
  const followBottomRef = useRef(true);
  const lastTurnCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sentNewMessage = turns.length > lastTurnCountRef.current;
    lastTurnCountRef.current = turns.length;
    if (!sentNewMessage && !followBottomRef.current) return;
    const last = el.lastElementChild as HTMLElement | null;
    if (!last) return;
    const overflow = last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
    if (overflow > 0) el.scrollBy({ top: overflow + 24, behavior: "smooth" });
  }, [turns]);

  const updateActiveTurn = useCallback((updater: (turn: Turn) => Turn) => {
    const id = activeTurnId.current;
    if (!id) return;
    setTurns((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  }, []);

  const switchToSession = useCallback((id: string) => {
    sessionIdRef.current = id;
    setCurrentSessionId(id);
    // sessionStorage (not localStorage) so it persists within this tab
    // (cart → back → chat restores session) but clears on fresh tab open.
    try { sessionStorage.setItem("talkshop_session", id); } catch { /* noop */ }
  }, []);

  const handleNewChat = useCallback(() => {
    closeStream.current?.();
    setLoading(false);
    activeTurnId.current = null;
    switchToSession(crypto.randomUUID());
    setTurns([]);
    setProtocolEvents([]);
    setSessionCartCount(0);
    setSessionCartIds(new Set());
    setSessionCartItems([]);
    setCartPanelOpen(false);
    try { sessionStorage.removeItem("talkshop_session_cart_ids"); } catch { /* noop */ }
  }, [switchToSession]);

  // Shared by "click a session in the sidebar" and "restore on page load" —
  // loads a session's messages, falling back to a fresh chat if it no
  // longer exists (deleted, or belonged to a session that never got saved).
  const loadSession = useCallback(async (id: string) => {
    switchToSession(id);
    try {
      const messages = await getSessionMessages(id);
      const rawTurns = messagesToTurns(messages);

      // Restore confirmed order or in-progress checkout saved before navigation
      try {
        const orderSaved   = JSON.parse(sessionStorage.getItem(`talkshop_order_${id}`) ?? "null");
        const checkoutSaved = JSON.parse(sessionStorage.getItem(`talkshop_checkout_${id}`) ?? "null");
        const guestCardSaved = JSON.parse(sessionStorage.getItem(`talkshop_guestcard_${id}`) ?? "null");

        if (orderSaved?.orderId && orderSaved.product) {
          // Hide the search-results products for the ordered product
          for (const t of rawTurns) {
            if (t.products.some((p) => p.product_id === orderSaved.product.product_id)) {
              t.products = [];
              break;
            }
          }
          rawTurns.push({
            id: crypto.randomUUID(),
            userMessage: "Checkout",
            steps: [
              { id: "ca1",   message: "CartUp — checkout session ready",        status: "done" as const },
              { id: "pay-0", message: "GreenLight — authorization approved",     status: "done" as const },
              { id: "pay-1", message: "GreenLight — DPAT token issued",          status: "done" as const },
              { id: "pay-2", message: "PayIt — payment processed",               status: "done" as const },
              { id: "pay-3", message: "TrackIt — order recorded",                status: "done" as const },
            ],
            products: [],
            recommendation: "",
            blocked: null,
            intent: {},
            checkout: {
              phase: "confirmed" as const,
              product: orderSaved.product,
              selectedCard: orderSaved.selectedCard ?? SAVED_CARDS[0].id,
              orderId: orderSaved.orderId,
              confirmedTotal: orderSaved.amount,
              pointsEarned: orderSaved.pointsEarned,
              loyaltyBalance: orderSaved.loyaltyBalance,
            },
          });
        } else if (checkoutSaved?.checkoutData && checkoutSaved.product) {
          // Restore in-progress checkout summary
          rawTurns.push({
            id: crypto.randomUUID(),
            userMessage: "Checkout",
            steps: [{ id: "ca1", message: "CartUp — checkout session ready", status: "done" as const }],
            products: [],
            recommendation: "",
            blocked: null,
            intent: {},
            checkout: {
              phase: "summary" as const,
              product: checkoutSaved.product,
              checkoutData: checkoutSaved.checkoutData,
              selectedCard: checkoutSaved.selectedCard ?? SAVED_CARDS[0].id,
              isGuest,
              guestCard: guestCardSaved ?? (isGuest ? { number: "", expiry: "", cvc: "", name: "" } : undefined),
            },
          });
        }
      } catch { /* noop — always show at least the DB messages */ }

      setTurns(rawTurns);
    } catch {
      switchToSession(crypto.randomUUID());
      setTurns([]);
    }
  }, [switchToSession, isGuest]);

  const handleSelectSession = useCallback(async (clickedId: string) => {
    if (clickedId === sessionIdRef.current) return;
    closeStream.current?.();
    setLoading(false);
    activeTurnId.current = null;
    setSessionCartCount(0);
    setSessionCartIds(new Set());
    setSessionCartItems([]);
    setCartPanelOpen(false);
    try { sessionStorage.removeItem("talkshop_session_cart_ids"); } catch { /* noop */ }
    await loadSession(clickedId);
  }, [loadSession]);

  // Restore session within the same browser tab (e.g. returning from /cart).
  // sessionStorage clears on new-tab / browser-restart so the app starts fresh there.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("talkshop_session");
      if (saved) loadSession(saved);
    } catch { /* noop */ }
    // Mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSessionDeleted = useCallback((deletedId: string) => {
    if (deletedId === sessionIdRef.current) {
      handleNewChat();
    }
  }, [handleNewChat]);

  const handleSend = useCallback(async (override?: string) => {
    const msg = (override ?? input).trim();
    if (!msg || loading) return;

    // ── Add-to-cart intercept — "add it/this/to cart" → show cart card, not checkout ──
    if (isAddToCartPhrase(msg) && lastRecommendedProductRef.current) {
      doAddToCartRef.current?.(msg, lastRecommendedProductRef.current);
      // Keep lastRecommendedProductRef so the cart-added card's "Proceed to Checkout" still works
      return;
    }

    // ── Inline checkout intercepts ──────────────────────────────────────────
    // User said "yes"/checkout phrase after agent recommended a product → bypass LangGraph, start checkout
    if ((isAffirmativeInput(msg) || isCheckoutIntent(msg)) && lastRecommendedProductRef.current) {
      doCheckoutSummaryRef.current?.(msg, lastRecommendedProductRef.current);
      lastRecommendedProductRef.current = null;
      setPendingCheckoutProduct(null);
      return;
    }

    // ── Show-cart intercept — open drawer directly, no backend call ────────
    if (isShowCartIntent(msg)) {
      setInput("");
      const cartTurnId = crypto.randomUUID();
      setTurns((prev) => [...prev, {
        id: cartTurnId,
        userMessage: msg,
        steps: [],
        products: [],
        recommendation: "Here's your cart!",
        blocked: null,
        intent: {},
      }]);
      setShowCartDrawer(true);
      return;
    }

    // ── Order tracking intercept — show live tracker bubble in chat ──────
    if (isOrderTrackingIntent(msg)) {
      setInput("");
      const trackerTurnId = crypto.randomUUID();
      setTurns((prev) => [...prev, {
        id: trackerTurnId,
        userMessage: msg,
        steps: [],
        products: [],
        recommendation: "",
        blocked: null,
        intent: {},
        orderTracker: true,
      }]);
      return;
    }

    // ── Ordinal add/buy: "add first one to cart", "buy the second" ─────────
    const ordinalIdx = getOrdinalCheckoutTarget(msg);
    if (ordinalIdx !== null) {
      const lastTurnWithProducts = [...turns].reverse().find((t) => t.products.length > 0);
      const targetProduct = lastTurnWithProducts?.products[ordinalIdx];
      if (targetProduct) {
        setInput("");
        doCheckoutSummaryRef.current?.(msg, targetProduct);
        lastRecommendedProductRef.current = null;
        setPendingCheckoutProduct(null);
        return;
      }
    }

    // ── Checkout fallback: explicit buy/proceed with no active product ref ──
    // Falls back to session cart items, then last shown products, so "buy it"
    // and "ok proceed" still work after a compare/follow-up question cleared
    // the product ref.
    if (isExplicitCheckoutPhrase(msg) && !lastRecommendedProductRef.current) {
      if (sessionCartItems.length > 0) {
        const cartItem = sessionCartItems[0];
        const cartProduct: ProductData = {
          product_id: cartItem.product_id,
          merchant_id: cartItem.merchant_id,
          merchant_name: cartItem.merchant_name,
          title: cartItem.title,
          brand: cartItem.brand,
          category: cartItem.category,
          price: cartItem.price,
          currency: cartItem.currency,
          size: cartItem.size,
          color: cartItem.color,
          available: true,
          inventory: 1,
          delivery_days: cartItem.delivery_days,
          rating: cartItem.rating,
          review_count: 0,
          shipping_cost: 0,
          rank_score: 0,
          source: "cart",
          image_url: cartItem.image_url,
          weight_grams: null,
          cushioning: null,
        };
        setInput("");
        doCheckoutSummaryRef.current?.(msg, cartProduct);
        return;
      }
      const lastTurnWithProducts = [...turns].reverse().find((t) => t.products.length > 0);
      if (lastTurnWithProducts?.products[0]) {
        setInput("");
        doCheckoutSummaryRef.current?.(msg, lastTurnWithProducts.products[0]);
        return;
      }
    }

    // Starting a new search — clear any pending cart CTA
    setPendingCheckoutProduct(null);
    lastRecommendedProductRef.current = null;

    // Always persist the active session so returning from Dashboard/Cart
    // restores this chat, even if the user never clicked a sidebar session.
    switchToSession(sessionIdRef.current);

    const turnId = crypto.randomUUID();
    const imageForTurn = pastedImage;
    const parsedIntent = parseSimpleIntent(msg);
    activeTurnId.current = turnId;
    setTurns((prev) => [...prev, {
      id: turnId,
      userMessage: msg,
      image: imageForTurn ?? undefined,
      steps: [],
      products: [],
      recommendation: "",
      blocked: null,
      intent: parsedIntent,
    }]);
    setLoading(true);
    setInput("");
    setPastedImage(null);

    // Close any existing stream
    closeStream.current?.();
    setProtocolEvents([]);

    if (imageForTurn) {
      try {
        await attachImage(sessionIdRef.current, imageForTurn.split(",")[1] ?? "");
      } catch {
        updateActiveTurn((turn) => ({
          ...turn,
          steps: [...turn.steps, {
            id: Date.now().toString(),
            message: "Couldn't attach the image — continuing with text only.",
            status: "error",
          }],
        }));
      }
    }

    const close = streamChat(msg, sessionIdRef.current, {
      onStep: (event: AgentEvent) => {
        updateActiveTurn((turn) => {
          const prevSteps = turn.steps;
          if (event.type === "step_start") {
            if (prevSteps.find((s) => s.message === event.message)) return turn;
            return { ...turn, steps: [...prevSteps, { id: event.ts, message: event.message, status: "running" }] };
          }
          if (event.type === "step_done") {
            const idx = [...prevSteps].reverse().findIndex((s: Step) => s.status === "running");
            const actualIdx = idx >= 0 ? prevSteps.length - 1 - idx : -1;
            if (actualIdx >= 0) {
              const updated = [...prevSteps];
              updated[actualIdx] = { ...updated[actualIdx], message: event.message, status: "done" };
              return { ...turn, steps: updated };
            }
            return { ...turn, steps: [...prevSteps, { id: event.ts, message: event.message, status: "done" }] };
          }
          return turn;
        });
      },
      onRecommendation: (text, prods, action) => {
        const capturedId = activeTurnId.current;
        // Set products immediately
        setTurns((prev) => prev.map((t) =>
          t.id === capturedId ? { ...t, products: prods } : t
        ));
        // Remember the top-ranked product so affirmative replies ("yes", "ok") can trigger checkout.
        if (prods.length > 0) {
          lastRecommendedProductRef.current = prods[0];
          setPendingCheckoutProduct(prods[0]);
        }

        // For follow-up answers, prods is [] — resolve target product from turn history.
        const lastTurnWithProducts = [...turns].reverse().find((t) => t.products.length > 0);
        const resolveProduct = (idx: number): ProductData | undefined => {
          if (prods.length > idx) return prods[idx];
          return lastTurnWithProducts?.products[idx] ?? lastTurnWithProducts?.products[0];
        };

        // Open cart drawer + show inline if LLM said to view cart
        if (action?.type === "show_cart") {
          setShowCartDrawer(true);
          setTurns((prev) => prev.map((t) => t.id === capturedId ? { ...t, showCartInline: true } : t));
        }

        // Remove from cart: find matching cart item by product_id and remove it
        if (action?.type === "remove_from_cart") {
          const target = resolveProduct(action.product_idx ?? 0);
          if (target) {
            const cartItem = sessionCartItems.find((i) => i.product_id === target.product_id);
            if (cartItem) {
              removeFromCart(cartItem.cart_item_id)
                .then(() => {
                  setSessionCartItems((prev) => prev.filter((i) => i.cart_item_id !== cartItem.cart_item_id));
                  setSessionCartIds((prev) => { const s = new Set(prev); s.delete(cartItem.cart_item_id); return s; });
                  setSessionCartCount((n) => Math.max(0, n - 1));
                  getCart().then((items) => setCartCount(items.length)).catch(() => {});
                })
                .catch(() => {});
            }
          }
        }

        // Stream recommendation text word-by-word (ChatGPT-style)
        const words = text.split(" ");
        words.forEach((_, i) => {
          const partial = words.slice(0, i + 1).join(" ");
          const isLast = i === words.length - 1;
          setTimeout(() => {
            setTurns((prev) => prev.map((t) =>
              t.id === capturedId
                ? { ...t, recommendation: partial + (isLast ? "" : " ▍") }
                : t
            ));
          }, i * 40);
        });

        // Add to cart (no checkout summary) — shows inline cart card
        if (action?.type === "add_to_cart") {
          const actionProduct = resolveProduct(action.product_idx ?? 0);
          if (actionProduct) {
            setTimeout(() => {
              attachAddToCartToActiveTurnRef.current?.(capturedId!, actionProduct!);
            }, words.length * 40 + 200);
          }
        }

        // Trigger checkout after text finishes streaming
        if (action?.type === "checkout") {
          const actionProduct = resolveProduct(action.product_idx ?? 0);
          if (actionProduct) {
            setTimeout(() => {
              attachCheckoutToActiveTurnRef.current?.(capturedId!, actionProduct!);
            }, words.length * 40 + 200);
          }
        }
      },
      onProtocolEvent: (ev) => setProtocolEvents((prev) => [...prev, ev as unknown as ProtocolEvent]),
      onBlocked: (message) => {
        updateActiveTurn((turn) => ({ ...turn, blocked: message }));
        setLoading(false);
      },
      onError: (message) => {
        updateActiveTurn((turn) => ({
          ...turn,
          steps: [...turn.steps, { id: Date.now().toString(), message, status: "error" }],
        }));
        setLoading(false);
      },
      onDone: () => {
        setLoading(false);
        // Mark any still-running steps done so their spinners clear.
        updateActiveTurn((turn) => ({
          ...turn,
          steps: turn.steps.map((s) => s.status === "running" ? { ...s, status: "done" } : s),
        }));
        setSidebarRefreshKey((k) => k + 1);
      },
    });

    closeStream.current = close;
  }, [input, loading, pastedImage, updateActiveTurn, turns, sessionCartItems]);

  // Keep the ref always pointing at the current handleSend so recognition
  // callbacks can fire it without stale-closure issues.
  handleSendRef.current = handleSend;

  // ── Inline checkout flow ──────────────────────────────────────────────────

  // Step 1: user said "yes" to agent's cart question → create checkout summary turn
  const doCheckoutSummary = useCallback(async (userText: string, product: ProductData, alreadyAdded = false) => {
    setInput("");
    setPastedImage(null);
    setLoading(true);
    setSelectedProducts(new Map());
    setPendingCheckoutProduct(null);
    lastRecommendedProductRef.current = null;

    const turnId = crypto.randomUUID();
    activeTurnId.current = turnId;

    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        userMessage: userText,
        steps: [{ id: "c1", message: "CartUp — preparing your order...", status: "running" as const }],
        products: [],
        recommendation: "",
        blocked: null,
        intent: {},
        checkout: {
          phase: "setup" as const,
          product,
          selectedCard: SAVED_CARDS[0].id,
          isGuest,
          guestCard: isGuest ? (sessionGuestCardRef.current ?? { number: "", expiry: "", cvc: "", name: "" }) : undefined,
        },
      },
    ]);

    try {
      if (!alreadyAdded) await addToCart(product);
      const createStart = performance.now();
      const res = await authFetch("/api/checkout/create", {
        method: "POST",
        body: JSON.stringify({
          product_id: product.product_id,
          merchant_id: product.merchant_id,
          quantity: 1,
        }),
      });
      if (!res.ok) throw new Error("Checkout creation failed");
      const checkoutData: InlineCheckoutDataShape = await res.json();
      checkoutCreateMsRef.current.set(checkoutData.checkout_id, Math.round(performance.now() - createStart));

      // Persist so coming back from /cart restores this checkout without losing state
      try {
        sessionStorage.setItem(`talkshop_checkout_${sessionIdRef.current}`, JSON.stringify({
          product, checkoutData, selectedCard: SAVED_CARDS[0].id,
        }));
      } catch { /* noop */ }

      setAutoTimer({ turnId, stage: "checkout", secondsLeft: AUTO_SECONDS, paused: false, product });
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                steps: [{ id: "c1", message: "CartUp — checkout session ready", status: "done" as const }],
                checkout: {
                  phase: "summary" as const,
                  product,
                  checkoutData,
                  selectedCard: SAVED_CARDS[0].id,
                  isGuest,
                  guestCard: isGuest ? (sessionGuestCardRef.current ?? { number: "", expiry: "", cvc: "", name: "" }) : undefined,
                },
              }
            : t
        )
      );
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                steps: [],
                checkout: {
                  phase: "failed" as const,
                  product,
                  selectedCard: SAVED_CARDS[0].id,
                  error: "Could not prepare your order. Please try again.",
                },
              }
            : t
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);
  // Keep the ref current on every render so callers never see a stale closure.
  doCheckoutSummaryRef.current = doCheckoutSummary;

  // LLM-driven checkout: attaches checkout UI to the currently streaming turn
  // instead of creating a new turn, so one user message = one visual block.
  const attachCheckoutToActiveTurn = useCallback(async (turnId: string, product: ProductData) => {
    setLoading(true);
    setSelectedProducts(new Map());
    setPendingCheckoutProduct(null);
    lastRecommendedProductRef.current = null;

    setTurns((prev) => prev.map((t) => t.id === turnId ? {
      ...t,
      steps: [...t.steps, { id: "ca1", message: "CartUp — preparing your order...", status: "running" as const }],
    } : t));

    try {
      await addToCart(product);
      const res = await authFetch("/api/checkout/create", {
        method: "POST",
        body: JSON.stringify({ product_id: product.product_id, merchant_id: product.merchant_id, quantity: 1 }),
      });
      if (!res.ok) throw new Error("Checkout creation failed");
      const checkoutData: InlineCheckoutDataShape = await res.json();
      setCartCount((n) => n + 1);

      try {
        sessionStorage.setItem(`talkshop_checkout_${sessionIdRef.current}`, JSON.stringify({
          product, checkoutData, selectedCard: SAVED_CARDS[0].id,
        }));
      } catch { /* noop */ }

      setAutoTimer({ turnId, stage: "checkout", secondsLeft: AUTO_SECONDS, paused: false, product });
      setTurns((prev) => prev.map((t) => t.id === turnId ? {
        ...t,
        steps: t.steps.filter((s) => s.id !== "ca1").concat({ id: "ca1", message: "CartUp — checkout session ready", status: "done" as const }),
        checkout: {
          phase: "summary" as const, product, checkoutData,
          selectedCard: SAVED_CARDS[0].id, isGuest,
          guestCard: isGuest ? (sessionGuestCardRef.current ?? { number: "", expiry: "", cvc: "", name: "" }) : undefined,
        },
      } : t));
    } catch {
      setTurns((prev) => prev.map((t) => t.id === turnId ? {
        ...t,
        steps: t.steps.filter((s) => s.id !== "ca1"),
        checkout: {
          phase: "failed" as const, product, selectedCard: SAVED_CARDS[0].id,
          error: "Could not prepare your order. Please try again.",
        },
      } : t));
    } finally {
      setLoading(false);
    }
  }, [isGuest]);
  attachCheckoutToActiveTurnRef.current = attachCheckoutToActiveTurn;

  // Add to cart (frontend intercept — creates a new turn with a cart-added card)
  const doAddToCart = useCallback(async (userText: string, product: ProductData) => {
    setInput("");
    setLoading(true);
    const turnId = crypto.randomUUID();
    activeTurnId.current = turnId;
    setTurns((prev) => [...prev, {
      id: turnId,
      userMessage: userText,
      steps: [{ id: "ca1", message: "CartUp — adding to cart...", status: "running" as const }],
      products: [],
      recommendation: "",
      blocked: null,
      intent: {},
    }]);
    try {
      await addToCart(product);
      const cartItems = await getCart();
      setCartCount(cartItems.length);
      const newItem = cartItems.find((i) => i.product_id === product.product_id);
      if (newItem) {
        setSessionCartCount((n) => n + 1);
        setSessionCartIds((prev) => new Set(prev).add(newItem.cart_item_id));
        setSessionCartItems(cartItems);
      }
      setAutoTimer({ turnId, stage: "cart", secondsLeft: AUTO_SECONDS, paused: false, product });
      setTurns((prev) => prev.map((t) => t.id === turnId ? {
        ...t,
        steps: [{ id: "ca1", message: "CartUp — item added to cart", status: "done" as const }],
        recommendation: `Added **${product.title}** to your cart!`,
        cartAdded: { product },
      } : t));
    } catch {
      setTurns((prev) => prev.map((t) => t.id === turnId ? {
        ...t,
        steps: [],
        recommendation: "Sorry, couldn't add that to your cart. Please try again.",
      } : t));
    } finally {
      setLoading(false);
    }
  }, []);
  doAddToCartRef.current = doAddToCart;

  // Add to cart (LLM action — attaches cart-added card to the currently streaming turn)
  const attachAddToCartToActiveTurn = useCallback(async (turnId: string, product: ProductData) => {
    setTurns((prev) => prev.map((t) => t.id === turnId ? {
      ...t,
      steps: [...t.steps, { id: "ca1", message: "CartUp — adding to cart...", status: "running" as const }],
    } : t));
    try {
      await addToCart(product);
      const cartItems = await getCart();
      setCartCount(cartItems.length);
      const newItem = cartItems.find((i) => i.product_id === product.product_id);
      if (newItem) {
        setSessionCartCount((n) => n + 1);
        setSessionCartIds((prev) => new Set(prev).add(newItem.cart_item_id));
        setSessionCartItems(cartItems);
      }
      setAutoTimer({ turnId, stage: "cart", secondsLeft: AUTO_SECONDS, paused: false, product });
      setTurns((prev) => prev.map((t) => t.id === turnId ? {
        ...t,
        steps: t.steps.filter((s) => s.id !== "ca1").concat({ id: "ca1", message: "CartUp — item added to cart", status: "done" as const }),
        cartAdded: { product },
      } : t));
    } catch {
      setTurns((prev) => prev.map((t) => t.id === turnId ? {
        ...t,
        steps: t.steps.filter((s) => s.id !== "ca1"),
      } : t));
    }
  }, []);
  attachAddToCartToActiveTurnRef.current = attachAddToCartToActiveTurn;

  // Step 2: user clicked "Confirm & Pay" → run DPAT + payment inline
  const doPayment = useCallback(async (
    turnId: string,
    checkoutData: InlineCheckoutDataShape,
    selectedCard: string,
    product: ProductData,
  ) => {
    // Make this the active turn so the panel tracks payment steps
    activeTurnId.current = turnId;

    const initPS = [
      { label: "GreenLight — requesting DPAT authorization…", status: "running" as const },
      { label: "GreenLight — DPAT token ready", status: "pending" as const },
      { label: "PayIt — executing payment…", status: "pending" as const },
      { label: "TrackIt — recording your order…", status: "pending" as const },
    ];
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? {
              ...t,
              steps: [
                ...t.steps.filter((s) => s.id === "c1" || s.id === "ca1"),
                { id: "pay-0", message: "GreenLight — requesting DPAT authorization…", status: "running" as const },
              ],
              checkout: { ...t.checkout!, phase: "processing" as const, processingSteps: initPS },
            }
          : t
      )
    );
    setLoading(true);

    const card = SAVED_CARDS.find((c) => c.id === selectedCard) ?? SAVED_CARDS[0];
    const emitProto = (ev: Omit<ProtocolEvent, "type" | "ts">) =>
      setProtocolEvents((prev) => [...prev, { type: "protocol_event", ts: new Date().toISOString(), ...ev }]);
    emitProto({
      source: checkoutData.merchant_name, target: "UCP Checkout", protocol: "REST", direction: "in",
      label: "session_created", detail: {
        endpoint: "POST /api/checkout/create",
        duration_ms: checkoutCreateMsRef.current.get(checkoutData.checkout_id) ?? null,
        merchant: checkoutData.merchant_name,
        totals: { subtotal: checkoutData.subtotal, fulfillment: checkoutData.shipping, tax: checkoutData.tax, total: checkoutData.total },
      },
    });

    const updateSteps = (steps: Array<{ label: string; status: "pending" | "running" | "done" | "error" }>) => {
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const agentSteps = steps
            .filter((s) => s.status !== "pending")
            .map((s, i) => ({ id: `pay-${i}`, message: s.label, status: s.status as "running" | "done" | "error" }));
          return {
            ...t,
            steps: [...t.steps.filter((s) => s.id === "c1" || s.id === "ca1"), ...agentSteps],
            checkout: { ...t.checkout!, processingSteps: steps },
          };
        })
      );
    };

    try {
      // GreenLight: approve authorization
      const approveStart = performance.now();
      const approveRes = await authFetch("/api/authorizations/approve", {
        method: "POST",
        body: JSON.stringify({
          checkout_id: checkoutData.checkout_id,
          checkout_hash: checkoutData.checkout_hash,
          merchant_id: checkoutData.merchant_id,
          total: checkoutData.total,
          currency: checkoutData.currency,
          product_id: checkoutData.product_id,
          product_title: checkoutData.product_title,
          merchant_name: checkoutData.merchant_name,
          subtotal: checkoutData.subtotal,
          tax: checkoutData.tax,
          shipping: checkoutData.shipping,
        }),
      });
      if (!approveRes.ok) throw new Error("Authorization failed");
      const approveData = await approveRes.json();
      emitProto({
        source: "GreenLight", target: "ShoppingAgent", protocol: "REST", direction: "in",
        label: "dpat_issued", detail: {
          endpoint: "POST /api/authorizations/approve",
          token_id: approveData.token_id,
          authorization_id: approveData.authorization_id,
          expires_at: approveData.expires_at,
          duration_ms: Math.round(performance.now() - approveStart),
        },
      });
      emitProto({
        source: "ShoppingAgent", target: "PayIt", protocol: "UI", direction: "out",
        label: "auth_ui_complete", detail: { note: "Browser step: approval confirmed in the UI. No AP2 message was exchanged." },
      });

      updateSteps([
        { label: "GreenLight — authorization approved", status: "done" },
        { label: "GreenLight — DPAT token issued", status: "done" },
        { label: "PayIt — executing payment…", status: "running" },
        { label: "TrackIt — recording your order…", status: "pending" },
      ]);

      // PayIt: execute payment
      const execStart = performance.now();
      const execRes = await authFetch("/api/payments/execute", {
        method: "POST",
        body: JSON.stringify({
          token_id: approveData.token_id,
          checkout_id: checkoutData.checkout_id,
          checkout_hash: checkoutData.checkout_hash,
          merchant_id: checkoutData.merchant_id,
          merchant_name: checkoutData.merchant_name,
          total: checkoutData.total,
          currency: checkoutData.currency,
          product_id: checkoutData.product_id,
          product_title: checkoutData.product_title,
          subtotal: checkoutData.subtotal,
          tax: checkoutData.tax,
          shipping: checkoutData.shipping,
          payment_method: "card",
        }),
      });
      if (!execRes.ok) throw new Error("Payment failed");
      const execData = await execRes.json();
      emitProto({
        source: "PayIt", target: "ShoppingAgent", protocol: "REST", direction: "in",
        label: "payment_executed", detail: {
          endpoint: "POST /api/payments/execute",
          status: execData.status,
          order_id: execData.order_id,
          amount: execData.amount,
          transaction_id: execData.transaction_id ?? null,
          duration_ms: Math.round(performance.now() - execStart),
        },
      });
      emitProto({
        source: "TrackIt", target: "User", protocol: "REST", direction: "in",
        label: "order_created", detail: { endpoint: "POST /api/payments/execute", order_id: execData.order_id },
      });

      updateSteps([
        { label: "GreenLight — authorization approved", status: "done" },
        { label: "GreenLight — DPAT token issued", status: "done" },
        { label: "PayIt — payment processed", status: "done" },
        { label: "TrackIt — order recorded", status: "done" },
      ]);

      // Small delay so the user sees all steps green before flipping to confirmed
      await new Promise((r) => setTimeout(r, 600));

      // Persist confirmed order so session restore shows confirmation, not product cards
      try {
        sessionStorage.setItem(`talkshop_order_${sessionIdRef.current}`, JSON.stringify({
          orderId: execData.order_id,
          amount: execData.amount,
          product,
          selectedCard,
          pointsEarned: execData.points_earned ?? null,
          loyaltyBalance: execData.loyalty_balance ?? null,
        }));
        sessionStorage.removeItem(`talkshop_checkout_${sessionIdRef.current}`);
      } catch { /* noop */ }

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                checkout: {
                  phase: "confirmed" as const,
                  product,
                  selectedCard,
                  orderId: execData.order_id,
                  confirmedTotal: execData.amount,
                  pointsEarned: execData.points_earned ?? undefined,
                  loyaltyBalance: execData.loyalty_balance ?? undefined,
                },
              }
            : t
        )
      );

      // Clear session cart and reset all ProductCard qty states
      setCartCount(0);
      setSessionCartCount(0);
      setSessionCartIds(new Set());
      setSessionCartItems([]);
      setCartPanelOpen(false);
      setProductCardResetKey((k) => k + 1);
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                checkout: {
                  ...t.checkout!,
                  phase: "failed" as const,
                  error: "Payment failed. Please check your card details and try again.",
                },
              }
            : t
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const restartCheckoutTimer = useCallback((turnId: string) => {
    const t = turnsRef.current.find((x) => x.id === turnId);
    if (t?.checkout?.phase === "summary") {
      setAutoTimer({ turnId, stage: "checkout", secondsLeft: AUTO_SECONDS, paused: false, product: t.checkout.product });
    }
  }, []);

  // Update selected card within a checkout turn
  const updateCheckoutCard = useCallback((turnId: string, cardId: string) => {
    restartCheckoutTimer(turnId);
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, checkout: { ...t.checkout!, selectedCard: cardId } } : t
      )
    );
  }, []);

  // Update guest card fields and remember for the rest of the session
  const updateGuestCard = useCallback((turnId: string, card: NonNullable<InlineCheckoutData["guestCard"]>) => {
    sessionGuestCardRef.current = card;
    try { sessionStorage.setItem(`talkshop_guestcard_${sessionIdRef.current}`, JSON.stringify(card)); } catch { /* noop */ }
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, checkout: { ...t.checkout!, guestCard: card } } : t
      )
    );
    restartCheckoutTimer(turnId);
  }, [restartCheckoutTimer]);

  const togglePauseAuto = () =>
    setAutoTimer((a) => (a && (a.paused ? { ...a, paused: false, secondsLeft: AUTO_SECONDS } : { ...a, paused: true })));

  useEffect(() => {
    if (!autoTimer || autoTimer.paused) return;
    if (autoTimer.secondsLeft > 0) {
      const id = setTimeout(
        () => setAutoTimer((a) => (a && a.secondsLeft > 0 ? { ...a, secondsLeft: a.secondsLeft - 1 } : a)),
        1000,
      );
      return () => clearTimeout(id);
    }
    setAutoTimer(null);
    if (autoTimer.stage === "cart") {
      setPendingCheckoutProduct(null);
      lastRecommendedProductRef.current = null;
      doCheckoutSummaryRef.current?.("proceed to checkout", autoTimer.product, true);
      return;
    }
    const co = turnsRef.current.find((t) => t.id === autoTimer.turnId)?.checkout;
    if (!co?.checkoutData || (co.isGuest && !co.guestCard?.number)) return;
    doPayment(autoTimer.turnId, co.checkoutData, co.selectedCard, co.product);
  }, [autoTimer, doPayment]);

  const BAR_COUNT = 32;

  // Real mic amplitude drives the waveform bars — separate from
  // SpeechRecognition (which only returns text, not audio levels) so the
  // user gets visible proof the mic is actually picking up their voice.
  const startLevelMeter = (stream: MediaStream) => {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const groupSize = Math.ceil(data.length / BAR_COUNT);
    let lastUpdate = 0;

    const tick = (time: number) => {
      analyser.getByteFrequencyData(data);
      if (time - lastUpdate > 60) {
        lastUpdate = time;
        setAudioLevels(
          Array.from({ length: BAR_COUNT }, (_, i) => {
            const group = data.slice(i * groupSize, (i + 1) * groupSize);
            const avg = group.reduce((s, v) => s + v, 0) / (group.length || 1);
            return Math.max(4, Math.round((avg / 255) * 100));
          })
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopLevelMeter = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setAudioLevels(Array(BAR_COUNT).fill(4));
  };

  const handleMic = async () => {
    setMicError(null);

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setMicError("Voice input needs Chrome or Edge — not supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setMicError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser's site settings and try again."
          : "Couldn't access the microphone."
      );
      return;
    }
    micStreamRef.current = stream;
    startLevelMeter(stream);

    stoppingRef.current = false;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    // Interim results fire as you speak (near real-time), so we can detect
    // silence accurately: reset the 1.5s timer on every event.  Without this,
    // Chrome with continuous=true waits 5-7 s before delivering a "final"
    // result — the silence timer never even starts until then.
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let newText = "";
      let hasActivity = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        hasActivity = true;
        if (!event.results[i].isFinal) continue;
        const transcript = event.results[i][0].transcript.trim();
        if (transcript) newText += (newText ? " " : "") + transcript;
      }

      // Accumulate only final text into the input field.
      if (newText) {
        setInput((prev) => (prev ? `${prev} ${newText}` : newText));
      }

      // Voice command routing on final results — instant send.
      if (newText) {
        const isCommand = /^(choose|select|pick)\s+(first|second|third|1st|2nd|3rd)/i.test(newText.trim()) ||
          /^(yes|confirm|approve|proceed|go ahead)\.?$/i.test(newText.trim()) ||
          /^(cancel|no|stop|go back)\.?$/i.test(newText.trim()) ||
          /^track\s+(my\s+)?order/i.test(newText.trim());

        if (isCommand) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          autoSendRef.current = true;
          stoppingRef.current = true;
          recognitionRef.current?.stop();
          return;
        }
      }

      // Reset the silence timer on ANY speech activity (interim = user still
      // speaking).  The timer fires 1.5 s after the very last word, which is
      // when interim events stop flowing.
      if (hasActivity) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          autoSendRef.current = true;
          stoppingRef.current = true;
          recognitionRef.current?.stop();
        }, 1500);
      }
    };

    recognition.onerror = (event) => {
      // "aborted" = user cancelled; "no-speech" = a pause, not a failure —
      // onend will auto-resume for both. Anything else is a real failure.
      if (event.error === "aborted" || event.error === "no-speech") return;
      stoppingRef.current = true;
      setMicError(
        event.error === "not-allowed"
          ? "Microphone access was denied. Allow it in your browser's site settings and try again."
          : "Couldn't access the microphone."
      );
    };

    recognition.onend = () => {
      if (stoppingRef.current) {
        stopLevelMeter();
        setRecording(false);
        if (autoSendRef.current) {
          autoSendRef.current = false;
          // Small delay so React can flush the setInput call from onresult
          // before handleSend reads the input value.
          setTimeout(() => { handleSendRef.current?.(); }, 100);
        }
        return;
      }
      // Chrome ended the session on its own (e.g. after a pause) even
      // though continuous=true — resume transparently so it never feels
      // like it stopped listening.
      try {
        recognition.start();
      } catch {
        // A start() already in flight — safe to ignore.
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  };

  // Stop = finalize whatever was heard so far (onresult still fires, then onend).
  const handleStopRecording = () => {
    clearSilenceTimer();
    stoppingRef.current = true;
    recognitionRef.current?.stop();
  };

  // Cancel = discard the recording entirely, no transcript inserted.
  const handleCancelRecording = () => {
    clearSilenceTimer();
    autoSendRef.current = false;
    stoppingRef.current = true;
    setMicError(null);
    recognitionRef.current?.abort();
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!showProfile) return;
    const handler = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfile(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProfile]);

  // Fetch loyalty balance when profile menu opens (registered users only)
  useEffect(() => {
    if (!showProfile || isGuest) return;
    authFetch("/api/loyalty")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setLoyaltyBalance(d.balance); })
      .catch(() => {});
  }, [showProfile, isGuest]);

  const handleToggleSelect = useCallback((product: ProductData) => {
    setSelectedProducts((prev) => {
      const next = new Map(prev);
      if (next.has(product.product_id)) next.delete(product.product_id);
      else next.set(product.product_id, product);
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <ChatSidebar
        activeSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onSessionDeleted={handleSessionDeleted}
        refreshKey={sidebarRefreshKey}
        collapsed={leftCollapsed}
        onToggleCollapse={() => setLeftCollapsed((c) => !c)}
        width={leftWidth}
      />
      {!leftCollapsed && (
        <div
          onMouseDown={startResize("left")}
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)] transition-colors"
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)] grid place-items-center shrink-0">
                <Sparkles size={13} className="text-white" />
              </div>
              <div className="leading-none">
                <p className="text-sm font-bold text-[var(--color-text)] tracking-tight">TalkShop</p>
                <p className="text-[10px] text-[var(--color-text-muted)] font-medium">Agentic Commerce Intelligence</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Dashboard */}
            <Link
              to="/dashboard"
              className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
            >
              Dashboard
            </Link>

            {/* Daylight */}
            <ThemeToggle />

            {/* Profile */}
            <div className="relative" ref={profileMenuRef}>
              <button
                onClick={() => setShowProfile((v) => !v)}
                className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
                title="Profile"
              >
                <div className="w-6 h-6 rounded-full bg-[var(--color-primary-bg)] text-[var(--color-primary)] text-[11px] font-bold grid place-items-center select-none">
                  {user?.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <ChevronDown size={12} className={`transition-transform duration-150 ${showProfile ? "rotate-180" : ""}`} />
              </button>

              {showProfile && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg z-50 overflow-hidden">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-[var(--color-border)]">
                    <p className="text-sm font-semibold text-[var(--color-text)] truncate">{user?.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{user?.email}</p>
                  </div>
                  {/* Loyalty points (registered users only) */}
                  {!isGuest && (
                    <div className="px-4 py-2.5 flex items-center gap-2.5 border-b border-[var(--color-border)]">
                      <Star size={13} className="text-amber-400 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-text)]">
                          {loyaltyBalance !== null ? `${loyaltyBalance} pts` : "— pts"}
                        </p>
                        <p className="text-[10px] text-[var(--color-text-muted)]">Loyalty balance</p>
                      </div>
                    </div>
                  )}
                  {/* Logout */}
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                  >
                    <LogOut size={13} />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content area */}
        <div
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (el) followBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          }}
          className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6"
        >
          {turns.map((turn) => {
            const isActiveTurn = loading && turn.id === activeTurnId.current;
            return (
              <div key={turn.id} className="flex flex-col gap-3">
                {/* User message bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[var(--color-primary)] text-white px-4 py-2.5 text-sm">
                    {turn.image && (
                      <img src={turn.image} alt="Attached" className="w-40 h-40 object-cover rounded-lg mb-2" />
                    )}
                    {turn.userMessage}
                  </div>
                </div>

                {/* Assistant response — AI shopping agent avatar */}
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${
                    isActiveTurn
                      ? "bg-gradient-to-br from-[var(--color-primary)] to-violet-500 shadow-md shadow-[var(--color-primary)]/30"
                      : "bg-[var(--color-primary)]/15"
                  }`}>
                    <Sparkles size={14} className={isActiveTurn ? "text-white animate-pulse" : "text-[var(--color-primary)]"} />
                  </div>
                  <div className="flex-1 flex flex-col gap-3 min-w-0 pt-1">
                    {/* Typing indicator — shown until the first step event arrives */}
                    {isActiveTurn && turn.steps.length === 0 && (
                      <div className="flex items-center gap-1.5 h-5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" />
                      </div>
                    )}

                    {/* Agent steps — humanized first-person messages */}
                    <AnimatePresence>
                      {turn.steps.map((step, i) => {
                        const friendly = humanizeStep(step.message);
                        if (!friendly) return null;
                        return (
                          <motion.div
                            key={step.id + i}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-2.5 text-sm"
                          >
                            {step.status === "done" ? (
                              <span className="w-4 h-4 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] text-[10px] grid place-items-center shrink-0 font-bold">✓</span>
                            ) : step.status === "error" ? (
                              <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-500 text-[10px] grid place-items-center shrink-0 font-bold">✗</span>
                            ) : (
                              <span className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent animate-spin shrink-0" />
                            )}
                            <span className={step.status === "error" ? "text-rose-500" : "text-[var(--color-text-muted)]"}>
                              {friendly}
                            </span>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    {/* Blocked message */}
                    {turn.blocked && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700 flex items-start gap-2"
                      >
                        <span className="shrink-0 mt-0.5">🛡️</span>
                        <span>{turn.blocked}</span>
                      </motion.div>
                    )}

                    {/* Recommendation / follow-up question text */}
                    {turn.recommendation && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text)] max-w-[85%]"
                      >
                        {renderWithBold(turn.recommendation)}
                      </motion.div>
                    )}

                    {/* Inline cart card — shown after add-to-cart or "show cart" */}
                    {(turn.cartAdded || turn.showCartInline) && (
                      <InlineCartCard
                        addedProduct={turn.cartAdded?.product}
                        cartItems={sessionCartItems}
                        onViewCart={() => setShowCartDrawer(true)}
                        auto={autoTimer?.turnId === turn.id && autoTimer.stage === "cart" ? autoTimer : undefined}
                        onPauseToggle={togglePauseAuto}
                      />
                    )}

                    {/* Inline checkout card — shown when user confirmed a product */}
                    {turn.checkout && (
                      <InlineCheckout
                        {...turn.checkout}
                        auto={autoTimer?.turnId === turn.id && autoTimer.stage === "checkout" ? autoTimer : undefined}
                        onPauseToggle={togglePauseAuto}
                        onCardChange={(cardId) => updateCheckoutCard(turn.id, cardId)}
                        onGuestCardChange={(card) => updateGuestCard(turn.id, card)}
                      />
                    )}

                    {/* Track orders button — appears after a purchase is confirmed */}
                    {turn.checkout?.phase === "confirmed" && (
                      <motion.button
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => {
                          setTurns((prev) => [...prev, {
                            id: crypto.randomUUID(),
                            userMessage: "Track my orders",
                            steps: [],
                            products: [],
                            recommendation: "",
                            blocked: null,
                            intent: {},
                            orderTracker: true,
                          }]);
                        }}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-full border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors self-start"
                      >
                        📦 Track my orders
                      </motion.button>
                    )}

                    {/* Inline order tracker — shown when user asks to track orders */}
                    {turn.orderTracker && <InlineOrderTracker />}

                    {/* Skeleton cards — only while a product search is in progress (not for follow-up Q&A) */}
                    {isActiveTurn && turn.products.length === 0 && turn.steps.some(s => s.message.toLowerCase().includes("sneakpeek") || s.message.toLowerCase().includes("searching")) && (
                      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="w-64 shrink-0"><SkeletonProductCard /></div>
                        ))}
                      </div>
                    )}

                    {/* Intent badge — what the AI understood */}
                    {turn.products.length > 0 && Object.keys(turn.intent).length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">AI matched:</span>
                        {turn.intent.color && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium capitalize">{turn.intent.color}</span>}
                        {turn.intent.size && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium">size {turn.intent.size}</span>}
                        {turn.intent.maxPrice && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium">under ${turn.intent.maxPrice}</span>}
                        {turn.intent.brand && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 font-medium">{turn.intent.brand}</span>}
                      </div>
                    )}

                    {/* Sort bar + product grid */}
                    {turn.products.length > 0 && (() => {
                      const sortMode = turnSortModes.get(turn.id) ?? "match";
                      const sorted = sortProducts(turn.products, sortMode);
                      const setSortMode = (m: SortMode) => setTurnSortModes(prev => new Map(prev).set(turn.id, m));
                      return (
                        <div className="flex flex-col gap-2">
                          {/* Sort bar */}
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[10px] text-[var(--color-text-muted)] mr-1">Sort:</span>
                            {([
                              { key: "match", label: "Best Match", icon: <ArrowUpDown size={10} /> },
                              { key: "price", label: "↓ Price", icon: <TrendingDown size={10} /> },
                              { key: "rating", label: "Top Rated", icon: <Star size={10} /> },
                              { key: "delivery", label: "Fastest", icon: <Zap size={10} /> },
                            ] as { key: SortMode; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
                              <button
                                key={key}
                                onClick={() => setSortMode(key)}
                                className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                                  sortMode === key
                                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                                    : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                                }`}
                              >
                                {icon} {label}
                              </button>
                            ))}
                          </div>
                          {/* Cards — horizontal scroll row */}
                          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                            {sorted.map((p, i) => (
                              <div key={`${p.product_id}-${productCardResetKey}`} className="w-64 shrink-0">
                                <ProductCard
                                  product={p}
                                  index={i}
                                  selected={selectedProducts.has(p.product_id)}
                                  onToggleSelect={handleToggleSelect}
                                  matchTags={computeMatchTags(turn.intent, p)}
                                  cartItem={cartItemByProduct.get(p.product_id)}
                                  onAddToCart={addProductToSessionCart}
                                  onSetQuantity={setSessionCartQuantity}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Follow-up chips */}
                    {turn.products.length > 0 && !isActiveTurn && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[10px] text-[var(--color-text-muted)]">Ask:</span>
                        {generateFollowUpChips(turn.products, turn.intent).map((chip) => (
                          <button
                            key={chip}
                            onClick={() => { setInput(chip); textareaRef.current?.focus(); }}
                            className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--color-primary)]/40 text-[var(--color-primary)] bg-[var(--color-primary)]/5 hover:bg-[var(--color-primary)]/15 hover:border-[var(--color-primary)] transition-all font-medium"
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {turns.length === 0 && (
            <div className="flex flex-col items-center gap-6 mt-16">
              <div className="text-center">
                <p className="text-lg font-semibold text-[var(--color-text)] mb-1">What are you shopping for?</p>
                <p className="text-sm text-[var(--color-text-muted)]">Ask me anything — I'll search across multiple stores and find the best options for you.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {[
                  "Running shoes, size 10, under $100",
                  "Nike running shoes",
                  "Zara summer dress",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSendRef.current?.(suggestion)}
                    className="text-sm px-3 py-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Inline cart panel — collapsible, shows session items without leaving chat */}
        <AnimatePresence>
          {sessionCartItems.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="relative mx-6 mb-2 rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-surface)]"
            >
              {/* Header — always visible */}
              <button
                onClick={() => setShowCartDrawer(true)}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-[var(--color-bg)] transition-colors"
              >
                <div className="flex items-center gap-2 text-sm text-[var(--color-primary)] font-semibold">
                  <ShoppingCart size={15} />
                  <span>{sessionCartItems.length} item{sessionCartItems.length !== 1 ? "s" : ""} in your cart</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    ${sessionCartItems.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2)}
                  </span>
                  <ChevronRight size={14} className="text-[var(--color-primary)]" />
                </div>
              </button>
              {autoTimer?.turnId === SESSION_CART_TIMER_ID && (
                <AutoStepBar
                  label="Checkout"
                  secondsLeft={autoTimer.secondsLeft}
                  paused={autoTimer.paused}
                  onPauseToggle={togglePauseAuto}
                />
              )}

            </motion.div>
          )}
        </AnimatePresence>

        {/* Compare bar — only shown when 2-4 products are selected */}
        {selectedProducts.size >= 2 && selectedProducts.size <= 4 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="mx-6 mb-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] px-4 py-2.5 flex items-center justify-between shadow-sm"
          >
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <GitCompare size={15} className="text-[var(--color-primary)]" />
              <span>{selectedProducts.size} products selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedProducts(new Map())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => setShowCompare(true)}
                className="flex items-center gap-1.5 text-sm font-semibold bg-[var(--color-primary)] text-white px-3 py-1.5 rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
              >
                <GitCompare size={13} /> Compare
              </button>
            </div>
          </motion.div>
        )}

        {/* Compare modal */}
        {showCompare && selectedProducts.size >= 2 && (
          <CompareModal
            products={Array.from(selectedProducts.values())}
            onClose={() => setShowCompare(false)}
            cartItemByProduct={cartItemByProduct}
            onAddToCart={addProductToSessionCart}
            onSetQuantity={setSessionCartQuantity}
          />
        )}

        {/* Cart drawer */}
        <CartDrawer
          open={showCartDrawer}
          onClose={() => {
            setShowCartDrawer(false);
            getCart().then((items) => setCartCount(items.length)).catch(() => {});
          }}
          sessionCartIds={sessionCartIds}
        />

        {/* Input bar */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          {micError && (
            <p className="text-xs text-rose-500 mb-2">{micError}</p>
          )}
          {imageError && (
            <p className="text-xs text-rose-500 mb-2">{imageError}</p>
          )}
          {pastedImage && !recording && (
            <div className="relative inline-block mb-2">
              <img src={pastedImage} alt="Pasted" className="h-16 w-16 object-cover rounded-lg border border-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => setPastedImage(null)}
                title="Remove image"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--color-text)] text-[var(--color-surface)] grid place-items-center"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {recording ? (
            <>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <button
                type="button"
                onClick={handleCancelRecording}
                title="Cancel"
                className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors shrink-0"
              >
                <X size={18} />
              </button>
              <div className="flex-1 flex items-center gap-[2px] h-6 min-w-0">
                {audioLevels.map((level, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full bg-[var(--color-primary)] transition-[height] duration-75"
                    style={{ height: `${level}%` }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={handleStopRecording}
                title="Stop recording"
                className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white grid place-items-center hover:bg-[var(--color-primary-light)] transition-colors shrink-0"
              >
                <Square size={13} fill="currentColor" />
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 text-center">
              Say <span className="font-medium text-[var(--color-primary)]">"choose first"</span> · <span className="font-medium text-[var(--color-primary)]">"confirm"</span> · <span className="font-medium text-[var(--color-primary)]">"cancel"</span> to act hands-free
            </p>
          </>
          ) : (
            <div className="flex items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  const correction = autocorrectOnType(input, e.target.value);
                  lastCorrectionRef.current = correction;
                  setInput(correction ? correction.corrected : e.target.value);
                }}
                onKeyDown={(e) => {
                  const last = lastCorrectionRef.current;
                  if (e.key === "Backspace" && last && input === last.corrected) {
                    e.preventDefault();
                    lastCorrectionRef.current = null;
                    setInput(last.original);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const fixed = autocorrectLastWord(input);
                    if (fixed === input) {
                      handleSend();
                    } else {
                      // Send after the corrected text has rendered — handleSendRef
                      // then points at a handleSend that sees it.
                      setInput(fixed);
                      setTimeout(() => handleSendRef.current?.(), 0);
                    }
                  }
                }}
                onPaste={async (e) => {
                  if (!e.clipboardData) return; // let normal text paste proceed
                  const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
                  if (!item) return; // no image on the clipboard — let normal text paste proceed
                  e.preventDefault();
                  const file = item.getAsFile();
                  if (!file) return;
                  setImageError(null);
                  try {
                    setPastedImage(await resizeImageForUpload(file));
                  } catch {
                    setImageError("Couldn't read that image — try a different one.");
                  }
                }}
                placeholder={loading ? "Searching..." : "Ask something..."}
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent text-sm outline-none resize-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50 max-h-40 overflow-y-auto leading-relaxed"
              />
              <button
                type="button"
                onClick={handleMic}
                disabled={loading}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-40"
                title="Voice input"
              >
                <Mic size={18} />
              </button>
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-colors disabled:opacity-40"
              >
                <Send size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      {!rightCollapsed && (
        <div
          onMouseDown={startResize("right")}
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-primary)] transition-colors"
        />
      )}
      {(() => {
        const activeTurn = turns.find((t) => t.id === activeTurnId.current);
        const sessionSteps = turns.flatMap((t) => t.steps);
        const displaySteps = loading
          ? (activeTurn?.steps.length ? activeTurn.steps : sessionSteps)
          : sessionSteps;
        const lastTurnWithProducts = [...turns].reverse().find((t) => t.products.length > 0);
        const lastTurnWithIntent   = [...turns].reverse().find((t) => Object.keys(t.intent).length > 0);

        if (rightCollapsed) {
          return (
            <aside className="w-10 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center pt-4 gap-4 shrink-0">
              <button type="button" onClick={() => setRightCollapsed(false)} title="Expand panel"
                className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors">
                <ChevronLeft size={16} />
              </button>
              <Activity size={15} className="text-[var(--color-text-muted)]" />
            </aside>
          );
        }

        return (
          <aside
            style={{ width: rightWidth }}
            className="border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden shrink-0"
          >
            {/* Shared header with toggle */}
            <div className="flex items-center justify-between px-3 py-2.5 shrink-0"
              style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)" }}>
              <div className="flex rounded-lg overflow-hidden border border-white/20 text-[9px] font-bold">
                {([
                  { id: "trace",    label: "Live Trace",     icon: <Activity size={9} /> },
                  { id: "pipeline", label: "Agent Pipeline", icon: <GitBranch size={9} /> },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setRightTab(t.id)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${
                      rightTab === t.id
                        ? "bg-white/20 text-white"
                        : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {t.icon}{t.label}
                    {t.id === "pipeline" && loading && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-0.5" />
                    )}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setRightCollapsed(true)} title="Collapse"
                className="text-white/50 hover:text-white transition-colors ml-2">
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Panel content */}
            {rightTab === "trace" ? (
              <ProtocolTracePanel
                events={protocolEvents}
                flowState={
                  protocolEvents.some((e) => e.label === "order_created") ? "complete"
                  : protocolEvents.some((e) => e.label === "session_created") ? (loading ? "ordering" : "payment_ready")
                  : loading ? "searching"
                  : turns.some((t) => t.products.length > 0) ? "products_shown"
                  : "idle"
                }
              />
            ) : (
              <AgentTrailPanel
                collapsed={false}
                onToggleCollapse={() => {}}
                width={rightWidth}
                activeTurnSteps={displaySteps}
                activeLoading={loading}
                activeProducts={lastTurnWithProducts?.products}
                activeIntent={lastTurnWithIntent?.intent}
                activeRecommendation={activeTurn?.recommendation}
                embedMode={true}
              />
            )}
          </aside>
        );
      })()}
    </div>
  );
}
