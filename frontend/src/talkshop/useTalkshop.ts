/**
 * Talkshop conversation state. The server keeps the real conversation
 * (stage + transcript); this mirrors it, streams new turns in, sends the
 * current ShopSphere page with every turn, and rebuilds from the server
 * after a reload.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, resetSession, streamTurn, type Stage, type TalkEvent, type TurnInput } from "../api/talkshop";
import { maskPaymentData } from "./redact";

const SESSION_KEY = "talkshop_panel_session";   // cleared on login/logout (AuthContext)

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = `ts-${crypto.randomUUID()}`;
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return `ts-${crypto.randomUUID()}`;
  }
}

export interface TraceStep { agent: string; message: string; at: number }
export type Page = Record<string, unknown>;

export function useTalkshop(getPage: () => Page) {
  const sid = useRef(sessionId());
  const pageRef = useRef(getPage);
  pageRef.current = getPage;
  const [events, setEvents] = useState<TalkEvent[]>([]);
  const [stage, setStage] = useState<Stage>("GREETING");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);

  const send = useCallback(async (input: TurnInput) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null); setStatus(null);
    try {
      const safe = input.text ? { ...input, text: maskPaymentData(input.text) } : input;   // card details never leave as chat
      await streamTurn(sid.current, { page: pageRef.current(), ...safe }, (ev) => {
        if (ev.type === "status") {
          setStatus(ev.message);
          setTrace((t) => [...t.slice(-60), { agent: ev.agent, message: ev.message, at: Date.now() }]);
        } else if (ev.type === "stage" || ev.type === "done") {
          setStage(ev.stage);
        } else {
          setEvents((list) => [...list, ev]);
        }
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false); setStatus(null);
    }
  }, []);

  // Rebuild from the server (survives reloads); greet on a brand-new conversation.
  useEffect(() => {
    let cancelled = false;
    getSession(sid.current)
      .then((s) => {
        if (cancelled) return;
        setStage(s.stage);
        const restored = s.transcript.filter((e) => e.type !== "stage");
        setEvents(restored);
        setReady(true);
        if (!restored.length) send({ action: { type: "greet" } });
      })
      .catch(() => { if (!cancelled) { setReady(true); send({ action: { type: "greet" } }); } });
    return () => { cancelled = true; };
  }, [send]);

  const restart = useCallback(async () => {
    if (busyRef.current) return;
    await resetSession(sid.current).catch(() => {});
    sid.current = `ts-${crypto.randomUUID()}`;
    try { sessionStorage.setItem(SESSION_KEY, sid.current); } catch { /* private mode */ }
    setEvents([]); setTrace([]); setStage("GREETING");
    send({ action: { type: "greet" } });
  }, [send]);

  return { events, stage, busy, status, trace, error, ready, send, restart };
}

export type Talkshop = ReturnType<typeof useTalkshop>;
