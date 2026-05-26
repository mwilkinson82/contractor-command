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
    <div data-scheduler-kpi className="flex shrink-0 items-stretch overflow-x-auto border-b border-[var(--sched-surface-rule)] bg-[var(--sched-surface)] px-5 py-1.5">

      <Cell label="Activities" value={kpis.total.toString()} sub={`${kpis.notStarted} not started`} />
      <Divider />
      <Cell
        label="Critical"
        value={kpis.critical.toString()}
        sub={`+${kpis.nearCrit} near-critical`}
        tone={kpis.critical > 0 ? "critical" : undefined}
      />
      <Divider />
      <Cell label="In progress" value={kpis.inProg.toString()} sub={`${kpis.completed} complete`} />
      <Divider />
      <Cell
        label="% Complete"
        value={`${kpis.pctComplete}%`}
        sub="earned ÷ budget"
      />
      <Divider />
      <Cell
        label="SPI"
        value={kpis.spi ? kpis.spi.toFixed(2) : "—"}
        sub={kpis.spi ? (kpis.spi >= 1 ? "on / ahead" : "behind") : "no data date"}
        tone={kpis.spi ? (kpis.spi >= 1 ? undefined : "critical") : undefined}
      />
      <Divider />
      <Cell
        label="CPI"
        value={kpis.cpi ? kpis.cpi.toFixed(2) : "—"}
        sub={kpis.cpi ? (kpis.cpi >= 1 ? "under / on budget" : "over budget") : "no cost actuals"}
        tone={kpis.cpi ? (kpis.cpi >= 1 ? undefined : "critical") : undefined}
      />
      <Divider />
      <Cell
        label="Finish"
        value={result.projectFinishDate ?? "—"}
        sub={`${result.projectDuration} d duration`}
        wide
      />
      {kpis.bac > 0 ? (
        <>
          <Divider />
          <Cell
            label="Earned · Budget"
            value={fmtMoney(kpis.ev)}
            sub={`of ${fmtMoney(kpis.bac)}`}
          />
        </>
      ) : null}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-3 w-px self-stretch bg-[var(--sched-surface-rule)]" />;
}

function Cell({
  label,
  value,
  sub,
  tone,
  wide,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "critical" | "good";
  wide?: boolean;
}) {
  const valueTone =
    tone === "critical"
      ? "text-[var(--sched-critical)]"
      : tone === "good"
        ? "text-[var(--sched-validated)]"
        : "text-[var(--sched-graphite-strong)]";
  return (
    <div className={`flex shrink-0 flex-col justify-center ${wide ? "min-w-[7.5rem]" : "min-w-[4.5rem]"}`}>
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--sched-graphite)]">
        {label}
      </span>
      <span data-kpi-value className={`mt-0.5 text-[16px] font-semibold leading-none tabular-nums tracking-tight ${valueTone}`}>
        {value}
      </span>
      {sub ? (
        <span className="mt-0.5 text-[9.5px] leading-tight text-[var(--sched-graphite-soft)]">{sub}</span>
      ) : null}
    </div>
  );
}
