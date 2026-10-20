// Demo controls, opened from the profile menu (Settings). Not on the main chat screen.
import { useEffect, useState } from "react";
import { getLinks, resetLinks, resetPoints, unlinkMerchant, type LinkStatus } from "../api/accountLink";

const MERCHANT_NAMES: Record<string, string> = {
  nike: "Nike", zara: "Zara", fossil: "Fossil", adidas: "Adidas", hm: "H&M", casio: "Casio",
};

interface Props {
  onClose: () => void;
  onChanged?: () => void;
}

export default function DemoControls({ onClose, onChanged }: Props) {
  const [links, setLinks] = useState<LinkStatus[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setLinks(await getLinks());

  useEffect(() => { void refresh(); }, []);

  const run = async (action: () => Promise<{ message: string }>) => {
    setBusy(true);
    const res = await action();
    setNote(res.message);
    await refresh();
    setBusy(false);
    onChanged?.();
  };

  const btn = "px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="w-[min(480px,94vw)] rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Settings</h2>
          <button className={btn} onClick={onClose}>Close</button>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Demo controls</p>
          <p className="text-xs font-medium text-[var(--color-text)] mb-1">Linked accounts</p>
          <ul className="flex flex-col gap-1.5">
            {links.map((l) => (
              <li key={l.merchant_id} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-text)]">{MERCHANT_NAMES[l.merchant_id] ?? l.merchant_id}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-xs ${l.linked ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--color-text-muted)]"}`}>
                    {l.linked ? "Linked" : "Not linked"}
                  </span>
                  {l.linked && (
                    <button className={btn} disabled={busy}
                      onClick={() => run(() => unlinkMerchant(l.merchant_id))}>Unlink</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={busy} onClick={() => run(resetLinks)}>Reset demo links</button>
          <button className={btn} disabled={busy} onClick={() => run(resetPoints)}>Reset demo points</button>
        </div>

        {note && <p className="text-xs text-[var(--color-text-muted)]">{note}</p>}
      </div>
    </div>
  );
}
