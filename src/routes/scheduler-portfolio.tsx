import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueries, useQuery } from "@tanstack/react-query";
import { listSchedules, loadSchedule } from "@/lib/scheduler/persistence.functions";
import { calculateSchedule } from "@/lib/scheduler/engine";
import type { Schedule } from "@/lib/scheduler/types";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/scheduler-portfolio")({
  head: () => ({ meta: [{ title: "Portfolio Roll-up - AOS" }] }),
  component: PortfolioPage,
});

interface Row {
  id: string;
  name: string;
  finishDate?: string;
  durationDays: number;
  pctComplete: number;
  bac: number;
  ev: number;
  ac: number;
  spi: number | null;
  cpi: number | null;
  eac: number | null;
  criticalCount: number;
  totalCount: number;
  dataDate?: string;
  loading: boolean;
  error?: string;
}

function computeRow(meta: { id: string; name: string }, schedule: Schedule): Row {
  const result = calculateSchedule(schedule);
  let bac = 0;
  let ev = 0;
  let ac = 0;
  let pv = 0;
  let weightedPct = 0;
  let weightSum = 0;
  let criticalCount = 0;

  const dataDate = schedule.dataDate;
  const startDate = schedule.projectStartDate;

  for (const st of result.tasks) {
    const t = schedule.tasks.find((x) => x.id === st.id);
    if (!t) continue;
    const budget = Number(t.budgetCost ?? 0);
    const pct = Math.max(0, Math.min(100, Number(t.percentComplete ?? 0))) / 100;
    bac += budget;
    ev += budget * pct;
    ac += Number(t.actualCost ?? 0);

    // PV from data date: full budget if planned finish ≤ dataDate; pro-rated if in progress
    if (dataDate && startDate && budget > 0) {
      if (st.earlyFinishDate && st.earlyFinishDate <= dataDate) {
        pv += budget;
      } else if (st.earlyStartDate && st.earlyStartDate <= dataDate) {
        const dur = Math.max(st.duration, 1);
        // crude calendar-day proration is fine for portfolio summary
        const ms =
          (new Date(dataDate).getTime() - new Date(st.earlyStartDate).getTime()) / 86400000;
        const frac = Math.max(0, Math.min(1, ms / dur));
        pv += budget * frac;
      }
    }

    const weight = budget > 0 ? budget : Math.max(st.duration, 1);
    weightedPct += pct * weight;
    weightSum += weight;
    if (st.isCritical) criticalCount += 1;
  }

  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = cpi && cpi > 0 ? bac / cpi : null;

  return {
    id: meta.id,
    name: meta.name,
    finishDate: result.projectFinishDate,
    durationDays: result.projectDuration,
    pctComplete: weightSum > 0 ? (weightedPct / weightSum) * 100 : 0,
    bac,
    ev,
    ac,
    spi,
    cpi,
    eac,
    criticalCount,
    totalCount: result.tasks.length,
    dataDate,
    loading: false,
  };
}

function PortfolioPage() {
  const listFn = useServerFn(listSchedules);
  const loadFn = useServerFn(loadSchedule);

  const list = useQuery({ queryKey: ["schedules"], queryFn: () => listFn() });
  const schedules = useMemo(() => list.data?.schedules ?? [], [list.data?.schedules]);

  const queries = useQueries({
    queries: schedules.map((s) => ({
      queryKey: ["schedule", s.id],
      queryFn: () => loadFn({ data: { id: s.id } }),
      enabled: !!s.id,
    })),
  });

  const rows: Row[] = useMemo(() => {
    return schedules.map((s, i) => {
      const q = queries[i];
      if (!q || q.isLoading) {
        return {
          id: s.id,
          name: s.name,
          durationDays: 0,
          pctComplete: 0,
          bac: 0,
          ev: 0,
          ac: 0,
          spi: null,
          cpi: null,
          eac: null,
          criticalCount: 0,
          totalCount: 0,
          loading: true,
        };
      }
      if (q.error || !q.data) {
        return {
          id: s.id,
          name: s.name,
          durationDays: 0,
          pctComplete: 0,
          bac: 0,
          ev: 0,
          ac: 0,
          spi: null,
          cpi: null,
          eac: null,
          criticalCount: 0,
          totalCount: 0,
          loading: false,
          error: (q.error as Error | null)?.message ?? "Failed to load",
        };
      }
      return computeRow({ id: s.id, name: s.name }, q.data.schedule);
    });
  }, [schedules, queries]);

  const totals = useMemo(() => {
    const t = { bac: 0, ev: 0, ac: 0, eac: 0, projects: rows.length, atRisk: 0, critical: 0 };
    for (const r of rows) {
      t.bac += r.bac;
      t.ev += r.ev;
      t.ac += r.ac;
      t.eac += r.eac ?? r.bac;
      t.critical += r.criticalCount;
      if ((r.spi !== null && r.spi < 0.95) || (r.cpi !== null && r.cpi < 0.95)) t.atRisk += 1;
    }
    return t;
  }, [rows]);

  const fmtMoney = (n: number) =>
    n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

  return (
    <div className="min-h-screen bg-[#f7f4ed] px-4 py-8 text-[var(--sched-graphite-strong)] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <Link
            to="/scheduler"
            className="inline-flex items-center gap-1 text-xs text-[#776e5e] hover:text-[var(--sched-graphite-strong)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Scheduler
          </Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#7a6a4d]">
            CPM Workbench · Multi-project view
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Portfolio roll-up</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5c574e]">
            Every active schedule, one screen. Finish dates, schedule and cost performance,
            critical-path concentration.
          </p>
        </header>

        {/* Totals */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Projects" value={String(totals.projects)} />
          <Stat
            label="At risk"
            value={String(totals.atRisk)}
            tone={totals.atRisk > 0 ? "warn" : undefined}
          />
          <Stat label="BAC" value={fmtMoney(totals.bac)} />
          <Stat label="Forecast (EAC)" value={fmtMoney(totals.eac)} />
        </div>

        {list.isLoading ? (
          <p className="text-sm text-[#776e5e]">Loading portfolio…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[#776e5e]">No schedules yet. Create one from the Scheduler.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-[#d8cdb8] bg-white">
            <table className="w-full text-sm">
              <thead className="bg-[#eee6d7] text-left text-[11px] uppercase tracking-wide text-[var(--sched-graphite)]">
                <tr>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Finish</th>
                  <th className="px-3 py-2">% Complete</th>
                  <th className="px-3 py-2">SPI</th>
                  <th className="px-3 py-2">CPI</th>
                  <th className="px-3 py-2">BAC</th>
                  <th className="px-3 py-2">EAC</th>
                  <th className="px-3 py-2">Critical</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#eee6d7] hover:bg-[#faf6ec]">
                    <td className="px-3 py-2">
                      <Link
                        to="/scheduler"
                        className="font-medium text-[var(--sched-graphite-strong)] underline-offset-2 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.dataDate ? (
                        <div className="text-[11px] text-[#776e5e]">Data date {r.dataDate}</div>
                      ) : null}
                      {r.error ? <div className="text-[11px] text-[var(--sched-critical)]">{r.error}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.loading ? (
                        <span className="text-[#776e5e]">…</span>
                      ) : (
                        <>
                          {r.finishDate ?? "—"}
                          <div className="text-[11px] text-[#776e5e]">{r.durationDays}d total</div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#eee6d7]">
                          <div
                            className="h-full bg-[var(--sched-graphite-strong)]"
                            style={{ width: `${Math.min(100, r.pctComplete)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums">{r.pctComplete.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Pi value={r.spi} />
                    </td>
                    <td className="px-3 py-2">
                      <Pi value={r.cpi} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtMoney(r.bac)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.eac !== null ? (
                        <span
                          className={
                            r.eac > r.bac * 1.05
                              ? "text-[var(--sched-critical)]"
                              : r.eac < r.bac * 0.95
                                ? "text-[#2f7a3e]"
                                : ""
                          }
                        >
                          {fmtMoney(r.eac)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={
                          r.criticalCount > 0 ? "font-medium text-[var(--sched-critical)]" : "text-[#776e5e]"
                        }
                      >
                        {r.criticalCount}/{r.totalCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
  return (
    <div className="rounded border border-[#d8cdb8] bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#776e5e]">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold ${
          tone === "warn" ? "text-[var(--sched-critical)]" : tone === "good" ? "text-[#2f7a3e]" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Pi({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#776e5e]">—</span>;
  const tone = value >= 1 ? "text-[#2f7a3e]" : value >= 0.95 ? "text-[#9b7400]" : "text-[var(--sched-critical)]";
  return <span className={`tabular-nums ${tone}`}>{value.toFixed(2)}</span>;
}
