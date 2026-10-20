interface Props {
  label: string;
  secondsLeft: number;
  paused: boolean;
  onPauseToggle: () => void;
  /** Skip the rest of the wait and open the checkout summary now. Does not authorise payment. */
  onProceedNow?: () => void;
}

export default function AutoStepBar({ label, secondsLeft, paused, onPauseToggle, onProceedNow }: Props) {
  const btn = "px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors";
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--color-border)]">
      <span className="flex-1 text-xs text-[var(--color-text-muted)]">
        {paused ? `${label} paused` : `${label} in ${secondsLeft}s`}
      </span>
      {onProceedNow && (
        <button onClick={onProceedNow} className={btn}>Proceed now</button>
      )}
      <button onClick={onPauseToggle} className={btn}>
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
