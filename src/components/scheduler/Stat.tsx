export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[#f7f4ed] px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
