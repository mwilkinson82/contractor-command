import type { ScheduleResult } from "@/lib/scheduler/types";

export function OpenEndsReport({ result }: { result: ScheduleResult }) {
  const preds = new Set(result.dependencies.map((d) => d.to));
  const succs = new Set(result.dependencies.map((d) => d.from));
  const noPred = result.tasks.filter((t) => !preds.has(t.id));
  const noSucc = result.tasks.filter((t) => !succs.has(t.id));

  // First task may legitimately have no predecessor; last may have no successor.
  // Flag extras as open-ends.
  const danglingStarts = noPred.length > 1 ? noPred : [];
  const danglingEnds = noSucc.length > 1 ? noSucc : [];

  if (danglingStarts.length === 0 && danglingEnds.length === 0) {
    return (
      <div className="text-xs text-[var(--sched-graphite)]">
        No open ends — every activity is tied to a predecessor and a successor.
      </div>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      {danglingStarts.length > 0 ? (
        <div>
          <div className="font-semibold text-[var(--sched-graphite)]">Missing predecessors</div>
          <div className="font-mono">{danglingStarts.map((t) => t.id).join(", ")}</div>
        </div>
      ) : null}
      {danglingEnds.length > 0 ? (
        <div>
          <div className="font-semibold text-[var(--sched-graphite)]">Missing successors</div>
          <div className="font-mono">{danglingEnds.map((t) => t.id).join(", ")}</div>
        </div>
      ) : null}
    </div>
  );
}
