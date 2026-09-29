/**
 * SSE client for /api/chat/stream.
 * Connects to the LangGraph streaming endpoint and invokes callbacks
 * for each event type as they arrive.
 */

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
}

export interface ChatCallbacks {
  onStep: (event: AgentEvent) => void;
  onRecommendation: (text: string, products: ProductData[]) => void;
  onBlocked: (message: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export function streamChat(message: string, sessionId: string, callbacks: ChatCallbacks): () => void {
  const params = new URLSearchParams({ message, session_id: sessionId });
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
        case "recommendation":
          callbacks.onRecommendation(
            event.message,
            (event.data as { products?: ProductData[] })?.products ??
              (Array.isArray(event.data) ? (event.data as ProductData[]) : [])
          );
          break;
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
