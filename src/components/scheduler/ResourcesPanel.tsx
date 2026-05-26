import { useMemo } from "react";
import type { ScheduleResult, Task } from "@/lib/scheduler/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  result: ScheduleResult;
  tasks: Task[];
  onTaskChange: (idx: number, patch: Partial<Task>) => void;
}

const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ResourcesPanel({ result, tasks, onTaskChange }: Props) {
  const duration = Math.max(result.projectDuration, 1);

  // Build per-day series in working-day units (0..duration-1)
  const { cumCost, cumEarned, perDayActual, resourceSeries, bac, ev, ac, pv, dataDay } =
    useMemo(() => {
      const cost = new Array(duration).fill(0);
      const earned = new Array(duration).fill(0);
      const actual = new Array(duration).fill(0);
      const resources: Record<string, number[]> = {};

      let bacSum = 0;
      let evSum = 0;
      let acSum = 0;

      for (const st of result.tasks) {
        const t = tasks.find((x) => x.id === st.id);
        if (!t) continue;
        const dur = Math.max(st.duration, 0);
        const budget = Number(t.budgetCost ?? 0);
        const actCost = Number(t.actualCost ?? 0);
        const pct = Math.max(0, Math.min(100, Number(t.percentComplete ?? 0))) / 100;
        bacSum += budget;
        evSum += budget * pct;
        acSum += actCost;
        if (dur > 0) {
          const dailyBudget = budget / dur;
          const dailyEarned = (budget * pct) / dur;
          const dailyActual = actCost / dur;
          for (let d = st.earlyStart; d < st.earlyStart + dur && d < duration; d++) {
            cost[d] += dailyBudget;
            earned[d] += dailyEarned;
            actual[d] += dailyActual;
          }
        }
        if (t.resourceName && t.resourceUnitsPerDay && dur > 0) {
          const key = t.resourceName.trim() || "Unassigned";
          if (!resources[key]) resources[key] = new Array(duration).fill(0);
          for (let d = st.earlyStart; d < st.earlyStart + dur && d < duration; d++) {
            resources[key][d] += t.resourceUnitsPerDay;
          }
        }
      }

      const cum = new Array(duration).fill(0);
      const cumE = new Array(duration).fill(0);
      let runC = 0;
      let runE = 0;
      for (let d = 0; d < duration; d++) {
        runC += cost[d];
        runE += earned[d];
        cum[d] = runC;
        cumE[d] = runE;
      }

      // Data date: clamp today vs project start to a working-day index.
      let dd = -1;
      if (result.projectStartDate) {
        const start = new Date(`${result.projectStartDate}T00:00:00.000Z`).getTime();
        const today = Date.now();
        const elapsedCal = Math.floor((today - start) / 86400000);
        // Approximation: scale calendar days to working days using ratio of duration / project span.
        // Simpler: assume working-day index ≈ elapsed * 5/7, clamped.
        dd = Math.max(0, Math.min(duration, Math.round(elapsedCal * (5 / 7))));
      }

      const pvAtDD = dd > 0 && dd <= duration ? cum[Math.min(dd - 1, duration - 1)] : bacSum;

      return {
        cumCost: cum,
        cumEarned: cumE,
        perDayActual: actual,
        resourceSeries: resources,
        bac: bacSum,
        ev: evSum,
        ac: acSum,
        pv: pvAtDD,
        dataDay: dd,
      };
    }, [result, tasks, duration]);

  const spi = pv > 0 ? ev / pv : 0;
  const cpi = ac > 0 ? ev / ac : 0;
  const eac = cpi > 0 ? bac / cpi : 0;

  // SVG sizing
  const W = 720;
  const Hh = 140; // histogram height
  const Hs = 160; // s-curve height
  const dayPx = Math.max(2, Math.floor((W - 60) / Math.max(duration, 1)));
  const chartW = 60 + dayPx * duration;

  const maxStack = Math.max(
    1,
    ...Array.from({ length: duration }, (_, d) =>
      Object.values(resourceSeries).reduce((s, arr) => s + arr[d], 0),
    ),
  );

  const maxCum = Math.max(1, cumCost[duration - 1] ?? 0);

  const resourceKeys = Object.keys(resourceSeries);
  const palette = ["var(--sched-graphite-strong)", "var(--sched-critical)", "var(--sched-validated)", "var(--sched-graphite)", "var(--sched-graphite-strong)", "var(--sched-near-critical)", "var(--sched-brass-deep)"];

  // EVM curves
  const pvPath = cumCost
    .map((v, d) => `${d === 0 ? "M" : "L"} ${60 + d * dayPx} ${Hs - 10 - (v / maxCum) * (Hs - 20)}`)
    .join(" ");
  const evPath = cumEarned
    .map((v, d) => `${d === 0 ? "M" : "L"} ${60 + d * dayPx} ${Hs - 10 - (v / maxCum) * (Hs - 20)}`)
    .join(" ");
  // Cumulative actual
  const cumAC: number[] = [];
  {
    let r = 0;
    for (let d = 0; d < duration; d++) {
      r += perDayActual[d];
      cumAC[d] = r;
    }
  }
  const acPath = cumAC
    .map((v, d) => `${d === 0 ? "M" : "L"} ${60 + d * dayPx} ${Hs - 10 - (v / maxCum) * (Hs - 20)}`)
    .join(" ");

  return (
    <section className="space-y-4 rounded border border-[var(--sched-surface-rule)] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
          Resources, cost & earned value
        </h3>
        <div className="text-xs text-[var(--sched-graphite)]">
          Data date: {dataDay >= 0 ? `d${dataDay}` : "n/a"}
        </div>
      </div>

      {/* EVM stats */}
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
        <Cell label="BAC" value={fmtMoney(bac)} />
        <Cell label="PV (data date)" value={fmtMoney(pv)} />
        <Cell label="EV" value={fmtMoney(ev)} />
        <Cell label="AC" value={fmtMoney(ac)} />
        <Cell
          label="SPI"
          value={spi ? spi.toFixed(2) : "—"}
          tone={spi >= 1 ? "good" : spi > 0 ? "bad" : undefined}
        />
        <Cell
          label="CPI"
          value={cpi ? cpi.toFixed(2) : "—"}
          tone={cpi >= 1 ? "good" : cpi > 0 ? "bad" : undefined}
        />
        <Cell label="EAC" value={eac ? fmtMoney(eac) : "—"} />
      </div>

      {/* Resource histogram */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
            Resource histogram (units / day)
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-[var(--sched-graphite)]">
            {resourceKeys.map((k, i) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ background: palette[i % palette.length] }}
                />
                {k}
              </span>
            ))}
            {resourceKeys.length === 0 ? (
              <span className="italic text-[var(--sched-graphite)]">
                Assign a resource + units/day below to populate.
              </span>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <svg width={chartW} height={Hh} className="block">
            {/* axis */}
            <line x1={60} x2={chartW} y1={Hh - 18} y2={Hh - 18} stroke="var(--sched-surface-rule)" />
            <text x={4} y={14} fontSize={10} fill="var(--sched-graphite)">
              {Math.ceil(maxStack)}
            </text>
            <text x={4} y={Hh - 22} fontSize={10} fill="var(--sched-graphite)">
              0
            </text>
            {Array.from({ length: duration }).map((_, d) => {
              let yOff = Hh - 18;
              return (
                <g key={d}>
                  {resourceKeys.map((k, i) => {
                    const v = resourceSeries[k][d];
                    if (v <= 0) return null;
                    const h = (v / maxStack) * (Hh - 30);
                    yOff -= h;
                    return (
                      <rect
                        key={k}
                        x={60 + d * dayPx + 0.5}
                        y={yOff}
                        width={Math.max(dayPx - 1, 1)}
                        height={h}
                        fill={palette[i % palette.length]}
                        opacity={0.9}
                      />
                    );
                  })}
                </g>
              );
            })}
            {dataDay >= 0 && dataDay <= duration ? (
              <line
                x1={60 + dataDay * dayPx}
                x2={60 + dataDay * dayPx}
                y1={4}
                y2={Hh - 18}
                stroke="var(--sched-critical)"
                strokeDasharray="3 3"
              />
            ) : null}
          </svg>
        </div>
      </div>

      {/* S-curve */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
            Cash flow S-curve
          </div>
          <div className="flex gap-3 text-[10px] text-[var(--sched-graphite)]">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[2px] w-4 bg-[var(--sched-graphite-strong)]" /> PV (planned)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[2px] w-4 bg-[var(--sched-validated)]" /> EV (earned)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[2px] w-4 bg-[var(--sched-critical)]" /> AC (actual)
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <svg width={chartW} height={Hs} className="block">
            <line x1={60} x2={chartW} y1={Hs - 10} y2={Hs - 10} stroke="var(--sched-surface-rule)" />
            <text x={4} y={14} fontSize={10} fill="var(--sched-graphite)">
              {fmtMoney(maxCum)}
            </text>
            <text x={4} y={Hs - 14} fontSize={10} fill="var(--sched-graphite)">
              $0
            </text>
            <path d={pvPath} fill="none" stroke="var(--sched-graphite-strong)" strokeWidth={1.5} />
            <path d={evPath} fill="none" stroke="var(--sched-validated)" strokeWidth={1.5} />
            <path d={acPath} fill="none" stroke="var(--sched-critical)" strokeWidth={1.5} />
            {dataDay >= 0 && dataDay <= duration ? (
              <line
                x1={60 + dataDay * dayPx}
                x2={60 + dataDay * dayPx}
                y1={4}
                y2={Hs - 10}
                stroke="var(--sched-critical)"
                strokeDasharray="3 3"
              />
            ) : null}
          </svg>
        </div>
      </div>

      {/* Per-task editor */}
      <div className="overflow-x-auto rounded border border-[var(--sched-surface-rule-soft)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--sched-surface-rule-soft)] uppercase tracking-wide text-[var(--sched-graphite)]">
            <tr>
              <th className="px-2 py-2 text-left">Task</th>
              <th className="px-2 py-2 text-left">Resource</th>
              <th className="px-2 py-2 text-right">Units/day</th>
              <th className="px-2 py-2 text-right">Budget</th>
              <th className="px-2 py-2 text-right">Actual</th>
              <th className="px-2 py-2 text-right">% Comp</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, idx) => (
              <tr key={t.id} className="border-t border-[var(--sched-surface-rule-soft)]">
                <td className="px-2 py-1">
                  <div className="font-mono text-[11px]">{t.id}</div>
                  <div className="text-[var(--sched-graphite)]">{t.name}</div>
                </td>
                <td className="px-2 py-1">
                  <Input
                    className="h-8"
                    value={t.resourceName ?? ""}
                    placeholder="e.g. Crew A"
                    onChange={(e) =>
                      onTaskChange(idx, { resourceName: e.target.value || undefined })
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    className="h-8 w-20 text-right"
                    type="number"
                    min={0}
                    step="0.5"
                    value={t.resourceUnitsPerDay ?? ""}
                    onChange={(e) =>
                      onTaskChange(idx, {
                        resourceUnitsPerDay:
                          e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    className="h-8 w-28 text-right"
                    type="number"
                    min={0}
                    value={t.budgetCost ?? ""}
                    onChange={(e) =>
                      onTaskChange(idx, {
                        budgetCost: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    className="h-8 w-28 text-right"
                    type="number"
                    min={0}
                    value={t.actualCost ?? ""}
                    onChange={(e) =>
                      onTaskChange(idx, {
                        actualCost: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </td>
                <td className="px-2 py-1 text-right text-[var(--sched-graphite)]">{t.percentComplete ?? 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const toneClass =
    tone === "good" ? "text-[var(--sched-validated)]" : tone === "bad" ? "text-[var(--sched-critical)]" : "text-[var(--sched-graphite-strong)]";
  return (
    <div className="rounded border border-[var(--sched-surface-rule-soft)] bg-[var(--sched-surface-rule-soft)] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">{label}</div>
      <div className={`text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
