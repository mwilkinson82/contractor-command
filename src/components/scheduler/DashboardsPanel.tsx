import { useMemo } from "react";
import type { ScheduleResult, Task } from "@/lib/scheduler/types";
import { ResourcesPanel } from "./ResourcesPanel";

interface Props {
  result: ScheduleResult;
  tasks: Task[];
  onTaskChange: (idx: number, patch: Partial<Task>) => void;
  dataDate?: string;
}

export function DashboardsPanel({ result, tasks, onTaskChange, dataDate }: Props) {
  const { floatBuckets, criticalChain, longest } = useMemo(() => {
    const buckets = [
      { label: "Critical (0d)", min: 0, max: 0, color: "var(--sched-critical)", count: 0 },
      { label: "1–5d", min: 1, max: 5, color: "var(--sched-near-critical)", count: 0 },
      { label: "6–15d", min: 6, max: 15, color: "var(--sched-brass)", count: 0 },
      { label: "16–30d", min: 16, max: 30, color: "#5b8bd6", count: 0 },
      { label: "30d+", min: 31, max: Infinity, color: "var(--sched-validated)", count: 0 },
    ];
    for (const t of result.tasks) {
      const f = t.totalFloat;
      for (const b of buckets) {
        if (f >= b.min && f <= b.max) {
          b.count++;
          break;
        }
      }
    }
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const chain = result.tasks
      .filter((t) => t.isCritical)
      .sort((a, b) => a.earlyStart - b.earlyStart);
    const longest = result.tasks
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);
    return { floatBuckets: buckets, max, criticalChain: chain, longest };
  }, [result.tasks]);

  const ddIso = dataDate;
  const ddTime = ddIso ? new Date(`${ddIso}T00:00:00.000Z`).getTime() : null;
  const lookahead = useMemo(() => {
    if (!ddTime) return [] as typeof result.tasks;
    const end = ddTime + 21 * 86400000;
    return result.tasks
      .filter((t) => {
        if (!t.earlyStartDate) return false;
        const s = new Date(`${t.earlyStartDate}T00:00:00.000Z`).getTime();
        return s >= ddTime && s <= end && (t.percentComplete ?? 0) < 100;
      })
      .sort((a, b) => (a.earlyStartDate ?? "").localeCompare(b.earlyStartDate ?? ""))
      .slice(0, 12);
  }, [result.tasks, ddTime]);

  const maxBar = Math.max(1, ...floatBuckets.map((b) => b.count));

  return (
    <div className="space-y-4 p-4">
      {/* Top row: float distribution + critical chain */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-[#e6dfd0] bg-white p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#7a6a4d]">
            Total float distribution
          </h3>
          <div className="space-y-2">
            {floatBuckets.map((b) => (
              <div key={b.label} className="flex items-center gap-3 text-xs">
                <span className="w-24 text-[#5c574e]">{b.label}</span>
                <div className="relative h-5 flex-1 rounded bg-[var(--sched-ivory)]">
                  <div
                    className="absolute inset-y-0 left-0 rounded transition-all"
                    style={{
                      width: `${(b.count / maxBar) * 100}%`,
                      background: b.color,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-[11px] font-semibold text-[var(--sched-graphite-strong)]">
                  {b.count}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-[#776e5e]">
            Healthier schedules show a fat tail of high-float activities and a tight critical band.
          </p>
        </section>

        <section className="rounded-md border border-[#e6dfd0] bg-white p-4">
          <h3 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#7a6a4d]">
            <span>Critical path</span>
            <span className="text-[10px] font-normal normal-case text-[#776e5e]">
              {criticalChain.length} activities
            </span>
          </h3>
          {criticalChain.length === 0 ? (
            <p className="text-xs text-[#9c8b6e]">
              No critical path computed yet. Add dependencies between activities.
            </p>
          ) : (
            <ol className="max-h-56 space-y-1 overflow-auto pr-1">
              {criticalChain.map((t, i) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--sched-ivory)]"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--sched-critical)]/10 font-mono text-[10px] font-semibold text-[var(--sched-critical)]">
                    {i + 1}
                  </span>
                  <span className="font-mono text-[10px] text-[#5c574e]">{t.id}</span>
                  <span className="flex-1 truncate text-[var(--sched-graphite-strong)]">{t.name}</span>
                  <span className="font-mono text-[10px] text-[#776e5e]">{t.duration}d</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Lookahead + longest */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-[#e6dfd0] bg-white p-4">
          <h3 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#7a6a4d]">
            <span>3-week look-ahead</span>
            <span className="text-[10px] font-normal normal-case text-[#776e5e]">
              {ddIso ? `from ${ddIso}` : "set data date"}
            </span>
          </h3>
          {lookahead.length === 0 ? (
            <p className="text-xs text-[#9c8b6e]">
              {ddIso
                ? "No upcoming activities in the next 21 days."
                : "Set a data date to see what's coming up."}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-[#7a6a4d]">
                <tr>
                  <th className="pb-1 text-left">ID</th>
                  <th className="pb-1 text-left">Activity</th>
                  <th className="pb-1 text-right">Start</th>
                  <th className="pb-1 text-right">Dur</th>
                </tr>
              </thead>
              <tbody>
                {lookahead.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-t border-[#f3eede] ${t.isCritical ? "bg-[#fef2f0]" : ""}`}
                  >
                    <td className="py-1 font-mono text-[10px] text-[#5c574e]">{t.id}</td>
                    <td className="py-1 text-[var(--sched-graphite-strong)]">{t.name}</td>
                    <td className="py-1 text-right text-[10px] text-[#5c574e]">
                      {t.earlyStartDate}
                    </td>
                    <td className="py-1 text-right text-[10px] font-medium text-[#3d3527]">
                      {t.duration}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-md border border-[#e6dfd0] bg-white p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#7a6a4d]">
            Longest activities
          </h3>
          <ul className="space-y-1.5">
            {longest.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[10px] text-[#5c574e]">{t.id}</span>
                <span className="flex-1 truncate text-[var(--sched-graphite-strong)]">{t.name}</span>
                <div className="relative h-3 w-32 rounded bg-[var(--sched-ivory)]">
                  <div
                    className="absolute inset-y-0 left-0 rounded"
                    style={{
                      width: `${(t.duration / Math.max(longest[0].duration, 1)) * 100}%`,
                      background: t.isCritical ? "var(--sched-critical)" : "var(--sched-graphite-strong)",
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-[11px] font-semibold text-[var(--sched-graphite-strong)]">
                  {t.duration}d
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Full EVM block */}
      <ResourcesPanel result={result} tasks={tasks} onTaskChange={onTaskChange} />
    </div>
  );
}
