import { ArrowLeft, Store } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

interface Props {
  title?: string;
  backHref?: string;
  backLabel?: string;
  right?: React.ReactNode;
}

export default function AppHeader({ title, backHref, backLabel = "Back", right }: Props) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
      <div className="flex items-center gap-4">
        {backHref && (
          <a
            href={backHref}
            className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
          >
            <ArrowLeft size={14} /> {backLabel}
          </a>
        )}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)] text-white grid place-items-center shrink-0">
            <Store size={14} />
          </div>
          <span className="font-semibold text-[var(--color-primary)]">Talkshop</span>
        </div>
        {title && (
          <span className="text-sm text-[var(--color-text-muted)] border-l border-[var(--color-border)] pl-4">
            {title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <ThemeToggle />
      </div>
    </header>
  );
}
