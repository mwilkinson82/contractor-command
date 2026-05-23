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
    <div className="flex shrink-0 items-stretch gap-2 border-b border-[#e6dfd0] bg-white px-4 py-2 text-xs">
      <Tile label="Activities" value={kpis.total.toString()} sub={`${kpis.notStarted} not started`} />
      <Tile
        label="Critical"
        value={kpis.critical.toString()}
        sub={`+${kpis.nearCrit} near-crit`}
        accent="bg-[#b42318]"
      />
      <Tile
        label="In progress"
        value={kpis.inProg.toString()}
        sub={`${kpis.completed} done`}
        accent="bg-[#5b8bd6]"
      />
      <Tile
        label="% Complete"
        value={`${kpis.pctComplete}%`}
        sub={kpis.bac > 0 ? `EV ${fmtMoney(kpis.ev)} / ${fmtMoney(kpis.bac)}` : "no cost loaded"}
        accent="bg-[#3d8a5c]"
      />
      <Tile
        label="SPI"
        value={kpis.spi ? kpis.spi.toFixed(2) : "—"}
        sub={kpis.spi ? (kpis.spi >= 1 ? "on / ahead" : "behind plan") : "set data date"}
        tone={kpis.spi ? (kpis.spi >= 1 ? "good" : "bad") : undefined}
      />
      <Tile
        label="CPI"
        value={kpis.cpi ? kpis.cpi.toFixed(2) : "—"}
        sub={kpis.cpi ? (kpis.cpi >= 1 ? "under budget" : "over budget") : "no actuals"}
        tone={kpis.cpi ? (kpis.cpi >= 1 ? "good" : "bad") : undefined}
      />
      <Tile
        label="Finish"
        value={result.projectFinishDate ?? "—"}
        sub={`${result.projectDuration}d total`}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
  accent?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-[#2f7a3e]"
      : tone === "bad"
        ? "text-[#b42318]"
        : "text-[#1f241f]";
  return (
    <div className="relative flex min-w-[120px] flex-1 flex-col justify-center rounded-md border border-[#e6dfd0] bg-[#faf8f3] px-3 py-1.5">
      {accent ? (
        <span className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r ${accent}`} />
      ) : null}
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[#7a6a4d]">
        {label}
      </div>
      <div className={`text-base font-semibold leading-tight tabular-nums ${toneClass}`}>
        {value}
      </div>
      {sub ? (
        <div className="truncate text-[10px] text-[#776e5e]">{sub}</div>
      ) : null}
    </div>
  );
}
