// Simulated merchant sign-in, shown over the chat. The chat never sees the email or
// the code: they go only to the merchant's endpoints, and the chat gets the result back.
import { useState, type KeyboardEvent } from "react";
import { approveLink, startLink, verifyLink } from "../api/accountLink";

interface Props {
  merchantId: string;
  merchantName: string;
  onClose: () => void;
  onEvents: (events: unknown[]) => void;  // trace events from the merchant (no email or code in them)
  onLinked: () => void;
}

type Step = "email" | "code" | "approve";

export default function LinkAccountModal({ merchantId, merchantName, onClose, onEvents, onLinked }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitEmail = async () => {
    setBusy(true);
    const res = await startLink(merchantId, email);
    setBusy(false);
    if (res.ok) {
      setNoAccount(false);
      setStep("code");
      setMessage(res.message);
    } else {
      setNoAccount(true);
      setMessage(res.message);
      onEvents(res.events ?? []);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    const res = await verifyLink(merchantId, email, code);
    setBusy(false);
    if (res.ok) {
      setStep("approve");
      setMessage(null);
    } else {
      setMessage(res.message);
    }
  };

  const approve = async () => {
    setBusy(true);
    const res = await approveLink(merchantId, email, code);
    setBusy(false);
    if (res.ok) {
      onEvents(res.events ?? []);
      onLinked();
    } else {
      setMessage(res.message);
    }
  };

  // Enter moves the sign-in forward, the same as pressing the step's button.
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || busy) return;
    e.preventDefault();
    if (step === "email" && email.trim()) void submitEmail();
    else if (step === "code" && code.length === 6) void submitCode();
  };

  const inputCls ="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]";
  const btnPrimary = "px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white disabled:opacity-50";
  const btnGhost = "px-4 py-2 rounded-lg text-sm font-medium border border-[var(--color-border)] text-[var(--color-text)]";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="w-[min(420px,92vw)] rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg p-5 flex flex-col gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Simulated merchant sign-in</p>
          <h2 className="text-base font-semibold text-[var(--color-text)] mt-1">Sign in to {merchantName}</h2>
        </div>

        {step === "email" && (
          <>
            <label className="text-xs text-[var(--color-text-muted)]">Email for your {merchantName} account</label>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="off" onKeyDown={onEnter} />
          </>
        )}

        {step === "code" && (
          <>
            <p className="text-sm text-[var(--color-text)]">We sent a one-time code to {email}.</p>
            <input className={inputCls} inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={onEnter} placeholder="6-digit code" autoComplete="off" />
          </>
        )}

        {step === "approve" && (
          <p className="text-sm text-[var(--color-text)]">
            Approve sharing your {merchantName} membership with Talkshop for shopping here. Your email and code are not shared.
          </p>
        )}

        {message && (
          <p className={`text-xs ${noAccount || message.startsWith("Incorrect") ? "text-red-600 dark:text-red-400" : "text-[var(--color-text-muted)]"}`}>
            {message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
          {noAccount && (
            <button className={btnGhost} onClick={onClose}>Continue as guest</button>
          )}
          {step === "email" && (
            <button className={btnPrimary} onClick={submitEmail} disabled={busy || !email.trim()}>Continue</button>
          )}
          {step === "code" && (
            <button className={btnPrimary} onClick={submitCode} disabled={busy || code.length !== 6}>Continue</button>
          )}
          {step === "approve" && (
            <button className={btnPrimary} onClick={approve} disabled={busy}>Approve sharing</button>
          )}
        </div>
      </div>
    </div>
  );
}
