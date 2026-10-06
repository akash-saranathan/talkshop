/**
 * SSE client for /api/chat/stream.
 * Connects to the LangGraph streaming endpoint and invokes callbacks
 * for each event type as they arrive.
 */
import { authFetch, getToken } from "./client";

export interface AgentEvent {
  type: "step_start" | "step_done" | "blocked" | "error" | "recommendation" | "done";
  message: string;
  data?: unknown;
  ts: string;
}

export interface ProductData {
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
  available: boolean;
  inventory: number;
  delivery_days: number;
  rating: number;
  review_count: number;
  shipping_cost: number;
  rank_score: number;
  source: string;
  image_url: string | null;
  weight_grams: number | null;
  cushioning: string | null;
}

export interface ChatSessionSummary {
  session_id: string;
  title: string;
  updated_at: string | null;
}

export interface ChatMessageRecord {
  role: "user" | "assistant";
  content: string;
  products: ProductData[];
  blocked_reason: string | null;
  created_at: string | null;
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const res = await authFetch("/api/chat/sessions");
  if (!res.ok) throw new Error("Failed to load chat sessions");
  return res.json();
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  const res = await authFetch(`/api/chat/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error("Failed to load chat session");
  return res.json();
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await authFetch(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete chat session");
}

// Stashes a pasted image server-side for the next message in this session —
// EventSource (used by streamChat) can only issue GET, so the image can't
// ride along in that request.
export async function attachImage(sessionId: string, imageBase64: string): Promise<void> {
  const res = await authFetch("/api/chat/attach-image", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, image_base64: imageBase64 }),
  });
  if (!res.ok) throw new Error("Failed to attach image");
}

export interface ChatAction {
  type: "show_cart" | "add_to_cart" | "checkout" | "remove_from_cart" | "show_more";
  product_idx?: number;
}

export interface ChatCallbacks {
  onStep: (event: AgentEvent) => void;
  onRecommendation: (text: string, products: ProductData[], action?: ChatAction) => void;
  onBlocked: (message: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
  onProtocolEvent?: (event: Record<string, unknown>) => void;
}

export function streamChat(message: string, sessionId: string, callbacks: ChatCallbacks): () => void {
  // EventSource can't set custom headers, so the token travels as a query
  // param here — the backend's get_current_user() accepts either.
  const token = getToken();
  const params = new URLSearchParams({ message, session_id: sessionId, ...(token ? { token } : {}) });
  const url = `/api/chat/stream?${params}`;
  const es = new EventSource(url);

  const handle = (raw: string) => {
    try {
      const event: AgentEvent = JSON.parse(raw);
      switch (event.type) {
        case "step_start":
        case "step_done":
          callbacks.onStep(event);
          break;
        case "recommendation": {
          const recData = event.data as { products?: ProductData[]; action?: ChatAction } | ProductData[];
          const recProducts = Array.isArray(recData)
            ? (recData as ProductData[])
            : ((recData as { products?: ProductData[] })?.products ?? []);
          const recAction = Array.isArray(recData)
            ? undefined
            : (recData as { action?: ChatAction })?.action;
          callbacks.onRecommendation(event.message, recProducts, recAction);
          break;
        }
        case "blocked":
          callbacks.onBlocked(event.message);
          break;
        case "error":
          callbacks.onError(event.message);
          break;
        case "done":
          callbacks.onDone();
          break;
      }
    } catch {
      // Ignore malformed events
    }
  };

  es.addEventListener("step_start", (e) => handle(e.data));
  es.addEventListener("step_done", (e) => handle(e.data));
  es.addEventListener("recommendation", (e) => handle(e.data));
  es.addEventListener("blocked", (e) => handle(e.data));
  es.addEventListener("protocol_event", (e) => {
    try {
      callbacks.onProtocolEvent?.(JSON.parse((e as MessageEvent).data));
    } catch {
      // Ignore malformed events
    }
  });
  es.addEventListener("error", (e) => {
    // The native EventSource auto-reconnects after "error" unless closed —
    // one backend hiccup would otherwise retry indefinitely and spam duplicate errors.
    es.close();
    if ((e as MessageEvent).data) handle((e as MessageEvent).data);
    else callbacks.onError("Connection error");
  });
  es.addEventListener("done", () => {
    callbacks.onDone();
    es.close();
  });

  return () => es.close();
}
