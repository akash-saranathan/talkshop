/**
 * ShopSphere UI primitives — one look across the store and the Talkshop panel.
 * Ease-of-use rules (plan §4.3): one primary action per card, chips for
 * choices, unavailable options visible but disabled with a reason.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Loader2, Minus, Plus, Star } from "lucide-react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
export { cx };

type ButtonVariant = "primary" | "secondary" | "ghost" | "talk" | "danger";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-btn text-btn-ink hover:opacity-90",
  secondary: "border border-line-strong text-ink hover:border-ink bg-canvas",
  ghost: "text-ink hover:bg-panel",
  talk: "bg-talk text-white hover:opacity-90",
  danger: "text-bad hover:bg-bad-soft",
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all",
        "disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-talk",
        BUTTON[variant], sizes[size], className)}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Chip({ selected, disabled, children, className, title, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      {...rest}
      type="button"
      disabled={disabled}
      title={title ?? (disabled ? "Out of stock" : undefined)}
      aria-pressed={selected}
      className={cx("min-w-11 h-10 px-3 rounded-lg border text-sm font-medium transition-colors",
        selected ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink hover:border-ink",
        disabled && "line-through text-faint border-line hover:border-line cursor-not-allowed bg-panel",
        className)}
    >
      {children}
    </button>
  );
}

export function Swatch({ hex, label, selected, disabled, onClick, size = 30 }:
  { hex: string; label: string; selected?: boolean; disabled?: boolean; onClick?: () => void; size?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${label} — out of stock` : label}
      aria-label={label}
      aria-pressed={selected}
      className={cx("relative rounded-full p-[3px] border-2 transition-colors",
        selected ? "border-ink" : "border-transparent hover:border-line-strong", disabled && "opacity-40 cursor-not-allowed")}
    >
      <span className="block rounded-full border border-black/10" style={{ width: size, height: size, background: hex }} />
      {disabled && <span className="absolute inset-0 m-auto h-[2px] w-[80%] rotate-45 bg-faint rounded" />}
    </button>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, busy }:
  { value: number; onChange: (n: number) => void; min?: number; max?: number; busy?: boolean }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line-strong h-9">
      <button type="button" aria-label="Decrease" disabled={busy || value <= min} onClick={() => onChange(value - 1)}
        className="w-9 h-full grid place-items-center text-muted hover:text-ink disabled:opacity-30"><Minus size={14} /></button>
      <span className="w-6 text-center text-sm font-medium tabular-nums">{busy ? <Loader2 size={13} className="animate-spin inline" /> : value}</span>
      <button type="button" aria-label="Increase" disabled={busy || value >= max} onClick={() => onChange(value + 1)}
        className="w-9 h-full grid place-items-center text-muted hover:text-ink disabled:opacity-30"><Plus size={14} /></button>
    </div>
  );
}

export function Rating({ value, count, size = 13 }: { value: number; count?: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted">
      <Star size={size} className="fill-accent text-accent" />
      <span className="text-ink font-medium">{value.toFixed(1)}</span>
      {count !== undefined && <span>({count.toLocaleString()})</span>}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "bad" | "talk" }) {
  const tones = {
    neutral: "bg-panel-2 text-ink-soft", accent: "bg-accent-soft text-accent", good: "bg-good-soft text-good",
    bad: "bg-bad-soft text-bad", talk: "bg-talk-soft text-talk",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide", tones[tone])}>{children}</span>;
}

export function Field({ label, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5 text-sm", className)}>
      <span className="text-muted text-xs font-medium">{label}</span>
      <input {...rest} className={cx("h-11 rounded-xl border bg-canvas px-3.5 text-ink outline-none transition-colors",
        "placeholder:text-faint focus:border-ink", error ? "border-bad" : "border-line-strong")} />
      {error && <span className="text-xs text-bad">{error}</span>}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted text-sm">
      <Loader2 size={18} className="animate-spin" /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-xl bg-panel-2", className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-20 px-6">
      {icon && <div className="w-14 h-14 rounded-full bg-panel grid place-items-center text-muted">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="text-muted text-sm max-w-sm">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "bad", children }: { tone?: "bad" | "good" | "talk"; children: ReactNode }) {
  const tones = { bad: "bg-bad-soft text-bad", good: "bg-good-soft text-good", talk: "bg-talk-soft text-talk" };
  return <div className={cx("rounded-xl px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}
