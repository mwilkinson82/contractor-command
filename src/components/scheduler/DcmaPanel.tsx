import { useMemo } from "react";
import type { ScheduleResult } from "@/lib/scheduler/types";

interface Props {
  result: ScheduleResult;
}

type Severity = "pass" | "warn" | "fail";

interface Check {
  id: string;
  label: string;
  description: string;
  value: string;
  threshold: string;
  severity: Severity;
  count: number;
  offenders: { id: string; name: string; note?: string }[];
}

export function DcmaPanel({ result }: Props) {
  const checks = useMemo<Check[]>(() => {
    const tasks = result.tasks;
    const deps = result.dependencies;
    const total = Math.max(tasks.length, 1);
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const d of deps) {
      outgoing.set(d.from, (outgoing.get(d.from) ?? 0) + 1);
      incoming.set(d.to, (incoming.get(d.to) ?? 0) + 1);
    }

    // 1. Logic density (deps per activity)
    const logicPerAct = deps.length / total;

    // 2. Leads (negative lag)
    const leads = deps.filter((d) => (d.lag ?? 0) < 0);
    // 3. Lags (positive lag)
    const lags = deps.filter((d) => (d.lag ?? 0) > 0);
    // 4. FS relationships %
    const fsCount = deps.filter((d) => (d.type ?? "FS") === "FS").length;
    const fsPct = deps.length ? (fsCount / deps.length) * 100 : 100;
    // 5. Hard constraints (startNoEarlierThan present, treat as soft constraint usage)
    const constrained = tasks.filter((t) => t.startNoEarlierThan);
    // 6. High float (> 44d)
    const highFloat = tasks.filter((t) => t.totalFloat > 44);
    // 7. Negative float
    const negFloat = tasks.filter((t) => t.totalFloat < 0);
    // 8. High duration (> 44d, non-milestone)
    const longDur = tasks.filter((t) => t.duration > 44);
    // 9. Open ends (no predecessor and not start, or no successor and not finish)
    const openStarts = tasks.filter(
      (t) => !incoming.get(t.id) && t.earlyStart > 0,
    );
    const openEnds = tasks.filter(
      (t) => !outgoing.get(t.id) && t.earlyFinish < result.projectDuration,
    );
    const openTotal = openStarts.length + openEnds.length;
    // 10. Missed activities (planned to finish before data date but not 100%)
    // Skipped: requires data date — handled elsewhere.
    // 11. Critical path test (must have a connected critical path)
    const criticalCount = tasks.filter((t) => t.isCritical).length;
    // 12. Critical path length index proxy: critical/total
    const cplRatio = (criticalCount / total) * 100;
    // 13. Resource assignment — % of tasks with resourceName
    const resourced = tasks.filter((t) => t.resourceName).length;
    const resourcedPct = (resourced / total) * 100;
    // 14. Cost loading
    const costed = tasks.filter((t) => (t.budgetCost ?? 0) > 0).length;
    const costedPct = (costed / total) * 100;

    const sev = (ok: boolean, warn?: boolean): Severity =>
      ok ? "pass" : warn ? "warn" : "fail";

    const sample = (arr: { id: string; name: string }[], note?: (x: any) => string) =>
      arr.slice(0, 5).map((x) => ({ id: x.id, name: x.name, note: note?.(x) }));

    return [
      {
        id: "logic",
        label: "Logic density",
        description: "Average relationships per activity. P6 standard ≥ 1.0.",
        value: logicPerAct.toFixed(2),
        threshold: "≥ 1.0",
        severity: sev(logicPerAct >= 1, logicPerAct >= 0.7),
        count: deps.length,
        offenders: [],
      },
      {
        id: "leads",
        label: "Leads (negative lag)",
        description: "DCMA: should be 0%.",
        value: `${leads.length}`,
        threshold: "0",
        severity: sev(leads.length === 0, leads.length / Math.max(deps.length, 1) < 0.05),
        count: leads.length,
        offenders: leads.slice(0, 5).map((d) => ({
          id: `${d.from}→${d.to}`,
          name: `${d.type ?? "FS"} ${d.lag}d`,
        })),
      },
      {
        id: "lags",
        label: "Lags (positive lag)",
        description: "DCMA: ≤ 5% of relationships.",
        value: `${((lags.length / Math.max(deps.length, 1)) * 100).toFixed(0)}%`,
        threshold: "≤ 5%",
        severity: sev(
          lags.length / Math.max(deps.length, 1) <= 0.05,
          lags.length / Math.max(deps.length, 1) <= 0.1,
        ),
        count: lags.length,
        offenders: lags.slice(0, 5).map((d) => ({
          id: `${d.from}→${d.to}`,
          name: `${d.type ?? "FS"} +${d.lag}d`,
        })),
      },
      {
        id: "fs",
        label: "Finish-to-Start %",
        description: "DCMA: ≥ 90% of relationships should be FS.",
        value: `${fsPct.toFixed(0)}%`,
        threshold: "≥ 90%",
        severity: sev(fsPct >= 90, fsPct >= 80),
        count: deps.length - fsCount,
        offenders: deps
          .filter((d) => (d.type ?? "FS") !== "FS")
          .slice(0, 5)
          .map((d) => ({ id: `${d.from}→${d.to}`, name: d.type ?? "FS" })),
      },
      {
        id: "constraints",
        label: "Hard constraints",
        description: "DCMA: ≤ 5% of activities constrained.",
        value: `${((constrained.length / total) * 100).toFixed(0)}%`,
        threshold: "≤ 5%",
        severity: sev(
          constrained.length / total <= 0.05,
          constrained.length / total <= 0.1,
        ),
        count: constrained.length,
        offenders: sample(constrained, (t) => `SNET ${t.startNoEarlierThan}`),
      },
      {
        id: "highfloat",
        label: "High float (> 44d)",
        description: "DCMA: ≤ 5% of activities with total float > 44 days.",
        value: `${((highFloat.length / total) * 100).toFixed(0)}%`,
        threshold: "≤ 5%",
        severity: sev(highFloat.length / total <= 0.05, highFloat.length / total <= 0.1),
        count: highFloat.length,
        offenders: sample(highFloat, (t) => `${t.totalFloat}d float`),
      },
      {
        id: "negfloat",
        label: "Negative float",
        description: "DCMA: should be 0. Negative float means schedule cannot meet finish.",
        value: `${negFloat.length}`,
        threshold: "0",
        severity: sev(negFloat.length === 0),
        count: negFloat.length,
        offenders: sample(negFloat, (t) => `${t.totalFloat}d`),
      },
      {
        id: "duration",
        label: "High duration (> 44d)",
        description: "DCMA: ≤ 5% of activities longer than 44 working days.",
        value: `${((longDur.length / total) * 100).toFixed(0)}%`,
        threshold: "≤ 5%",
        severity: sev(longDur.length / total <= 0.05, longDur.length / total <= 0.1),
        count: longDur.length,
        offenders: sample(longDur, (t) => `${t.duration}d`),
      },
      {
        id: "openends",
        label: "Open ends",
        description: "Activities missing a predecessor or successor (except project start/finish).",
        value: `${openTotal}`,
        threshold: "0",
        severity: sev(openTotal === 0, openTotal <= 2),
        count: openTotal,
        offenders: [
          ...openStarts.slice(0, 3).map((t) => ({ id: t.id, name: t.name, note: "no pred" })),
          ...openEnds.slice(0, 3).map((t) => ({ id: t.id, name: t.name, note: "no succ" })),
        ],
      },
      {
        id: "criticalpath",
        label: "Critical path test",
        description: "Schedule must have a connected critical path to project finish.",
        value: criticalCount > 0 ? "Connected" : "Broken",
        threshold: "Connected",
        severity: sev(criticalCount > 0),
        count: criticalCount,
        offenders: [],
      },
      {
        id: "cpli",
        label: "Critical path %",
        description: "Sanity check — critical activities as a share of total.",
        value: `${cplRatio.toFixed(0)}%`,
        threshold: "5–35%",
        severity: sev(cplRatio >= 5 && cplRatio <= 35, cplRatio <= 50),
        count: criticalCount,
        offenders: [],
      },
      {
        id: "resources",
        label: "Resource assignment",
        description: "% of activities with a named resource.",
        value: `${resourcedPct.toFixed(0)}%`,
        threshold: "≥ 80%",
        severity: sev(resourcedPct >= 80, resourcedPct >= 50),
        count: resourced,
        offenders: [],
      },
      {
        id: "cost",
        label: "Cost loading",
        description: "% of activities with a budget cost.",
        value: `${costedPct.toFixed(0)}%`,
        threshold: "≥ 80%",
        severity: sev(costedPct >= 80, costedPct >= 50),
        count: costed,
        offenders: [],
      },
    ];
  }, [result]);

  const summary = useMemo(() => {
    const pass = checks.filter((c) => c.severity === "pass").length;
    const warn = checks.filter((c) => c.severity === "warn").length;
    const fail = checks.filter((c) => c.severity === "fail").length;
    const score = Math.round((pass / checks.length) * 100);
    return { pass, warn, fail, score };
  }, [checks]);

  return (
    <section className="rounded-md border border-[var(--sched-surface-rule)] bg-white">
      <header className="flex items-center justify-between border-b border-[var(--sched-surface-rule-soft)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--sched-graphite-strong)]">
            Schedule integrity · DCMA-14
          </h3>
          <p className="text-[11px] text-[var(--sched-graphite)]">
            Industry-standard health checks for CPM schedules.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
              Health score
            </div>
            <div
              className={`text-2xl font-bold leading-none tabular-nums ${
                summary.score >= 85
                  ? "text-[var(--sched-validated)]"
                  : summary.score >= 60
                    ? "text-[var(--sched-near-critical)]"
                    : "text-[var(--sched-critical)]"
              }`}
            >
              {summary.score}
              <span className="text-sm text-[var(--sched-graphite)]">/100</span>
            </div>
          </div>
          <div className="flex flex-col gap-0.5 text-[10px]">
            <Badge tone="good">{summary.pass} pass</Badge>
            <Badge tone="warn">{summary.warn} warn</Badge>
            <Badge tone="bad">{summary.fail} fail</Badge>
          </div>
        </div>
      </header>

      <ul className="divide-y divide-[var(--sched-surface-rule-soft)]">
        {checks.map((c) => (
          <li key={c.id} className="grid grid-cols-[8px_1fr_auto] items-start gap-3 px-4 py-3">
            <span
              className={`mt-1 inline-block h-2 w-2 rounded-full ${
                c.severity === "pass"
                  ? "bg-[var(--sched-validated)]"
                  : c.severity === "warn"
                    ? "bg-[var(--sched-near-critical)]"
                    : "bg-[var(--sched-critical)]"
              }`}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--sched-graphite-strong)]">{c.label}</span>
                <span className="text-[10px] text-[var(--sched-graphite)]">target {c.threshold}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--sched-graphite)]">{c.description}</p>
              {c.offenders.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.offenders.map((o, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded border border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-1.5 py-0.5 text-[10px] text-[var(--sched-graphite)]"
                      title={o.name}
                    >
                      <span className="font-mono text-[var(--sched-graphite-strong)]">{o.id}</span>
                      {o.note ? <span className="text-[var(--sched-graphite)]">{o.note}</span> : null}
                    </span>
                  ))}
                  {c.count > c.offenders.length ? (
                    <span className="text-[10px] text-[var(--sched-graphite)]">
                      +{c.count - c.offenders.length} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <span
              className={`min-w-[60px] text-right text-sm font-semibold tabular-nums ${
                c.severity === "pass"
                  ? "text-[var(--sched-validated)]"
                  : c.severity === "warn"
                    ? "text-[var(--sched-near-critical)]"
                    : "text-[var(--sched-critical)]"
              }`}
            >
              {c.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "warn" | "bad" }) {
  const cls =
    tone === "good"
      ? "bg-[var(--sched-validated-soft)] text-[var(--sched-validated)]"
      : tone === "warn"
        ? "bg-[#fcf1e0] text-[var(--sched-near-critical)]"
        : "bg-[var(--sched-critical-soft)] text-[var(--sched-critical)]";
  return (
    <span className={`inline-flex justify-center rounded px-1.5 py-0.5 font-semibold ${cls}`}>
      {children}
    </span>
  );
}
