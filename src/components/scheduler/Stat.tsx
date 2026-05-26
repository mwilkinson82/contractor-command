export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[var(--sched-surface-rule-soft)] px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
