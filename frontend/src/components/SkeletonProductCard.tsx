export default function SkeletonProductCard() {
  return (
    <div className="bg-[var(--color-surface)] rounded-xl p-4 flex flex-col gap-3 border border-[var(--color-border)] shadow-card animate-pulse">
      <div className="h-28 rounded-lg bg-[var(--color-border)]" />
      <div className="flex items-center justify-between">
        <div className="h-4 w-20 rounded-full bg-[var(--color-border)]" />
        <div className="h-3 w-16 rounded bg-[var(--color-border)]" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3.5 w-full rounded bg-[var(--color-border)]" />
        <div className="h-3.5 w-3/4 rounded bg-[var(--color-border)]" />
      </div>
      <div className="flex gap-2">
        <div className="h-3 w-10 rounded bg-[var(--color-border)]" />
        <div className="h-3 w-14 rounded bg-[var(--color-border)]" />
        <div className="h-3 w-12 rounded bg-[var(--color-border)]" />
      </div>
      <div className="flex items-center justify-between mt-auto">
        <div className="h-6 w-16 rounded bg-[var(--color-border)]" />
        <div className="h-8 w-24 rounded-lg bg-[var(--color-border)]" />
      </div>
    </div>
  );
}
