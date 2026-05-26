import { useMemo } from "react";
import type { ScheduleResult, Task } from "@/lib/scheduler/types";

interface Props {
  result: ScheduleResult;
  tasks: Task[];
  dataDate?: string;
}

const fmtMoney = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
    : `$${Math.round(n)}`;

export function ScheduleKpiBar({ result, tasks, dataDate }: Props) {
  const kpis = useMemo(() => {
    const total = result.tasks.length;
    let bac = 0;
    let ev = 0;
    let ac = 0;
    let pvAtDD = 0;

    const ddTime = dataDate ? new Date(`${dataDate}T00:00:00.000Z`).getTime() : null;

    for (const st of result.tasks) {
      const t = tasks.find((x) => x.id === st.id);
      if (!t) continue;
      const budget = Number(t.budgetCost ?? 0);
      const actCost = Number(t.actualCost ?? 0);
      const pct = Math.max(0, Math.min(100, Number(t.percentComplete ?? 0))) / 100;
      bac += budget;
      ev += budget * pct;
      ac += actCost;

      // PV: planned value as of dataDate (linear earn over baseline duration)
      if (ddTime && st.earlyStartDate && st.earlyFinishDate && st.duration > 0) {
        const s = new Date(`${st.earlyStartDate}T00:00:00.000Z`).getTime();
        const f = new Date(`${st.earlyFinishDate}T00:00:00.000Z`).getTime();
        if (ddTime <= s) {
          // not planned yet
        } else if (ddTime >= f) {
          pvAtDD += budget;
        } else {
          pvAtDD += budget * ((ddTime - s) / Math.max(f - s, 1));
        }
      }
    }

    const spi = pvAtDD > 0 ? ev / pvAtDD : 0;
    const cpi = ac > 0 ? ev / ac : 0;

    const critical = result.tasks.filter((t) => t.isCritical).length;
    const nearCrit = result.tasks.filter((t) => !t.isCritical && t.totalFloat <= 5).length;
    const completed = result.tasks.filter((t) => (t.percentComplete ?? 0) >= 100).length;
    const inProg = result.tasks.filter((t) => {
      const p = t.percentComplete ?? 0;
      return p > 0 && p < 100;
    }).length;
    const notStarted = total - completed - inProg;

    const pctComplete = total > 0 ? Math.round((ev / Math.max(bac, 1)) * 100) : 0;

    return {
      total,
      critical,
      nearCrit,
      completed,
      inProg,
      notStarted,
      spi,
      cpi,
      bac,
      ev,
      ac,
      pctComplete,
    };
  }, [result, tasks, dataDate]);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--sched-surface-rule)] bg-[var(--sched-surface)] px-4 py-1 text-[11px] text-[var(--sched-graphite)]">
      <Pill label="Activities" value={kpis.total.toString()} sub={`${kpis.notStarted} ns`} />
      <Pill label="Critical" value={kpis.critical.toString()} sub={`+${kpis.nearCrit} nc`} dot="var(--sched-critical)" />
      <Pill label="In progress" value={kpis.inProg.toString()} sub={`${kpis.completed} done`} dot="var(--sched-graphite-strong)" />
      <Pill label="% Complete" value={`${kpis.pctComplete}%`} dot="var(--sched-validated)" />
      <Pill label="SPI" value={kpis.spi ? kpis.spi.toFixed(2) : "—"} tone={kpis.spi ? (kpis.spi >= 1 ? "good" : "bad") : undefined} />
      <Pill label="CPI" value={kpis.cpi ? kpis.cpi.toFixed(2) : "—"} tone={kpis.cpi ? (kpis.cpi >= 1 ? "good" : "bad") : undefined} />
      <Pill label="Finish" value={result.projectFinishDate ?? "—"} sub={`${result.projectDuration}d`} />
      {kpis.bac > 0 ? (
        <Pill label="EV" value={fmtMoney(kpis.ev)} sub={`/ ${fmtMoney(kpis.bac)}`} />
      ) : null}
    </div>
  );
}

function Pill({
  label,
  value,
  sub,
  tone,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
  dot?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-[var(--sched-validated)]"
      : tone === "bad"
        ? "text-[var(--sched-critical)]"
        : "text-[var(--sched-graphite-strong)]";
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot ? <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot }} /> : null}
      <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">{label}</span>
      <span className={`font-semibold tabular-nums ${toneClass}`}>{value}</span>
      {sub ? <span className="text-[10px] text-[var(--sched-graphite-soft)]">{sub}</span> : null}
    </span>
  );
}
