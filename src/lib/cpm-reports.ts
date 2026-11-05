/**
 * Written reports on a calculated schedule: the DCMA 14-point health check, the update narrative and the
 * lookahead by float path. Pure: reads saved results only. Every sentence states what the saved schedule
 * shows; none assigns responsibility, concurrency or entitlement.
 */
import {
  compareActivities,
  ganttModel,
  ganttSummary,
  PATH_COLORS,
  shortDay,
  workDaysBetween,
  type GanttInput,
  type GanttRow,
} from "./cpm-gantt";

type Model = ReturnType<typeof ganttModel>;
const DAY = 86_400_000;
const INK = "#1E3A5F",
  INK2 = "#4D6480",
  MUTED = "#6B7280",
  LINE2 = "#EDF1F6";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const day = (v: string | null | undefined): number | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
};
const wd = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? "working day" : "working days"}`;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export type HealthCheck = {
  id: number;
  name: string;
  /** What passes, in DCMA's terms. */
  threshold: string;
  /** Activities or relationships that fail the test. */
  count: number;
  /** What the count is measured against. */
  of: number;
  /** Percent, or the index value for CPLI and BEI. */
  value: number | null;
  status: "pass" | "fail" | "not-run";
  note?: string;
  activity_ids: string[];
};

/** The DCMA 14-point assessment on the saved calculation. Incomplete activities only, as DCMA measures. */
export function scheduleHealth(input: GanttInput): HealthCheck[] {
  const m = ganttModel(input);
  const open = m.rows.filter((r) => !r.done);
  const tasks = open.filter((r) => !r.milestone);
  const links = open.flatMap((r) => (r.a.predecessors ?? []).map((p) => ({ r, p })));
  const hasSucc = (r: GanttRow) => (m.succ.get(r.a.id) ?? []).length > 0;
  const first = m.rows.filter((r) => !(r.a.predecessors ?? []).length);
  const finishIds = new Set(m.rows.filter((r) => !hasSucc(r)).map((r) => r.a.id));
  // The project's own start and finish are allowed one open end each.
  const lastId = m.longest[m.longest.length - 1];
  const openEnds = open.filter(
    (r) =>
      (!(r.a.predecessors ?? []).length && !(first.length === 1 && first[0] === r)) ||
      (!hasSucc(r) && !(r.a.id === lastId || (finishIds.size === 1 && finishIds.has(r.a.id)))),
  );
  const leads = links.filter((l) => (l.p.lag ?? 0) < 0);
  const lags = links.filter((l) => (l.p.lag ?? 0) > 0);
  const notFs = links.filter((l) => (l.p.type ?? "FS") !== "FS");
  const hard = open.filter((r) => !!r.a.finish_no_later_than);
  const highFloat = open.filter((r) => (r.tf ?? 0) > 44);
  const negFloat = open.filter((r) => (r.tf ?? 0) < 0);
  const remaining = (r: GanttRow) => r.a.remaining_duration ?? r.a.duration ?? 0;
  const highDur = tasks.filter((r) => remaining(r) > 44);
  const dd = m.dd;
  const invalid =
    dd === null
      ? []
      : m.rows.filter((r) => {
          const as = day(r.a.actual_start),
            af = day(r.a.actual_finish);
          if ((as !== null && as > dd) || (af !== null && af > dd)) return true;
          if (r.done) return false;
          // Remaining work cannot be forecast before the data date.
          if (r.finish !== null && r.finish < dd) return true;
          return !r.started && r.start !== null && r.start < dd;
        });
  const pctCheck = (
    id: number,
    name: string,
    fail: GanttRow[],
    of: number,
    limit: number,
    threshold: string,
  ): HealthCheck => ({
    id,
    name,
    threshold,
    count: fail.length,
    of,
    value: pct(fail.length, of),
    status: pct(fail.length, of) <= limit ? "pass" : "fail",
    activity_ids: fail.map((r) => r.a.id),
  });
  const ids = (list: { r: GanttRow }[]) => [...new Set(list.map((l) => l.r.a.id))];
  const out: HealthCheck[] = [
    pctCheck(1, "Logic", openEnds, open.length, 5, "5% or fewer open ends"),
    {
      id: 2,
      name: "Leads",
      threshold: "No negative lags",
      count: leads.length,
      of: links.length,
      value: pct(leads.length, links.length),
      status: leads.length ? "fail" : "pass",
      activity_ids: ids(leads),
    },
    {
      id: 3,
      name: "Lags",
      threshold: "5% or fewer relationships with lag",
      count: lags.length,
      of: links.length,
      value: pct(lags.length, links.length),
      status: pct(lags.length, links.length) <= 5 ? "pass" : "fail",
      activity_ids: ids(lags),
    },
    {
      id: 4,
      name: "Relationship types",
      threshold: "90% or more finish-to-start",
      count: notFs.length,
      of: links.length,
      value: links.length ? Math.round((1 - notFs.length / links.length) * 1000) / 10 : 100,
      status: !links.length || notFs.length / links.length <= 0.1 ? "pass" : "fail",
      note: "Value is the finish-to-start share; the count is the other types.",
      activity_ids: ids(notFs),
    },
    pctCheck(5, "Hard constraints", hard, open.length, 5, "5% or fewer finish-no-later-than"),
    pctCheck(6, "High float", highFloat, open.length, 5, "5% or fewer over 44 WD"),
    {
      ...pctCheck(7, "Negative float", negFloat, open.length, 0, "None below zero"),
      status: negFloat.length ? "fail" : "pass",
    },
    pctCheck(8, "High duration", highDur, tasks.length, 5, "5% or fewer over 44 WD remaining"),
    {
      ...pctCheck(
        9,
        "Invalid dates",
        invalid,
        m.rows.length,
        0,
        "No actuals after, or forecasts before, the data date",
      ),
      status: invalid.length ? "fail" : "pass",
    },
    {
      id: 10,
      name: "Resources",
      threshold: "Activities carry resources or cost",
      count: 0,
      of: tasks.length,
      value: null,
      status: "not-run",
      note: "Not checked: Athena schedules are not resource loaded.",
      activity_ids: [],
    },
  ];
  // 11 and 14 need a baseline.
  const base = m.baseline;
  if (base && dd !== null) {
    const due = m.rows.filter((r) => {
      const bf = day(r.base?.finish);
      return bf !== null && bf <= dd;
    });
    const missed = due.filter((r) => {
      const af = day(r.a.actual_finish);
      return !r.done || (af !== null && af > day(r.base!.finish)!);
    });
    const doneDue = due.filter((r) => r.done).length;
    out.push(
      {
        id: 11,
        name: "Missed tasks",
        threshold: "5% or fewer baseline-due tasks finished late",
        count: missed.length,
        of: due.length,
        value: pct(missed.length, due.length),
        status: pct(missed.length, due.length) <= 5 ? "pass" : "fail",
        activity_ids: missed.map((r) => r.a.id),
      },
      {
        id: 14,
        name: "Baseline execution index (BEI)",
        threshold: "0.95 or higher",
        count: doneDue,
        of: due.length,
        value: due.length ? Math.round((doneDue / due.length) * 100) / 100 : null,
        status: !due.length || doneDue / due.length >= 0.95 ? "pass" : "fail",
        note: due.length ? undefined : "No baseline task was due by the data date.",
        activity_ids: [],
      },
    );
  } else
    out.push(
      ...[11, 14].map(
        (id): HealthCheck => ({
          id,
          name: id === 11 ? "Missed tasks" : "Baseline execution index (BEI)",
          threshold: id === 11 ? "5% or fewer baseline-due tasks finished late" : "0.95 or higher",
          count: 0,
          of: 0,
          value: null,
          status: "not-run",
          note: "Needs an accepted baseline.",
          activity_ids: [],
        }),
      ),
    );
  out.push({
    id: 12,
    name: "Critical path test",
    threshold: "A continuous longest path from the data date to completion",
    count: m.longest.length,
    of: m.longest.length,
    value: null,
    status: m.longest.length ? "pass" : "fail",
    note: m.longest.length
      ? "Traced through driving relationships by Athena's calculation."
      : "No longest path in the saved calculation.",
    activity_ids: [],
  });
  // CPLI = (critical path length + float to the contract or baseline finish) / critical path length.
  // A contract completion that disagrees with the baseline finish waits to be confirmed, so the
  // index is measured to the baseline finish rather than to a date that may hide delay.
  const mismatch = ganttSummary(m).completionMismatch !== null;
  const useContract = m.cc !== null && !mismatch;
  const target = useContract ? m.cc : m.baselineFinish;
  if (dd !== null && m.forecast !== null && target !== null) {
    const cpl = workDaysBetween(dd, m.forecast, m.projectCal);
    const tf = workDaysBetween(m.forecast, target, m.projectCal);
    const cpli = cpl > 0 ? Math.round(((cpl + tf) / cpl) * 100) / 100 : null;
    out.push({
      id: 13,
      name: "Critical path length index (CPLI)",
      threshold: "0.95 or higher",
      count: tf,
      of: cpl,
      value: cpli,
      status: cpli === null || cpli >= 0.95 ? "pass" : "fail",
      note: useContract
        ? "Measured to the contract completion."
        : mismatch
          ? "Measured to the baseline finish, because the contract completion on file disagrees with it."
          : "Measured to the baseline finish.",
      activity_ids: [],
    });
  } else
    out.push({
      id: 13,
      name: "Critical path length index (CPLI)",
      threshold: "0.95 or higher",
      count: 0,
      of: 0,
      value: null,
      status: "not-run",
      note: "Needs a contract completion or baseline finish.",
      activity_ids: [],
    });
  return out.sort((a, b) => a.id - b.id);
}

export type LookaheadGroup = { label: string; rank: number | null; rows: GanttRow[] };
/** Remaining work that falls in the window after the data date, grouped by float path (1 = longest path). */
export function lookaheadByPath(input: GanttInput, weeks = 3): LookaheadGroup[] {
  const m = ganttModel(input);
  if (m.dd === null) return [];
  const end = m.dd + weeks * 7 * DAY;
  const inWindow = m.rows.filter(
    (r) => !r.done && r.start !== null && r.finish !== null && r.start < end && r.finish >= m.dd!,
  );
  const groups = new Map<number | null, GanttRow[]>();
  for (const r of inWindow) (groups.get(r.path) ?? groups.set(r.path, []).get(r.path)!).push(r);
  return [...groups.entries()]
    .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
    .map(([rank, rows]) => ({
      rank,
      label: rank === 1 ? "Longest path" : rank ? `Float path ${rank}` : "Other activities",
      rows: rows.sort((x, y) => (x.start ?? 0) - (y.start ?? 0) || (x.tf ?? 0) - (y.tf ?? 0)),
    }));
}

/** The update narrative, as paragraphs. Each one rests on saved results; none assigns responsibility. */
export function scheduleNarrative(input: GanttInput): string[] {
  const m = ganttModel(input);
  const s = ganttSummary(m);
  const out: string[] = [];
  const ddText = m.dd === null ? "the saved data date" : `the ${shortDay(m.dd)} data date`;
  if (m.forecast !== null) {
    const rel = (n: number, what: string) =>
      n === 0 ? `on ${what}` : `${wd(n)} ${n > 0 ? "after" : "before"} ${what}`;
    // Lead with the logic-driven forecast against the plan, so delay shows whatever the contract says.
    const parts: string[] = [];
    const same = m.cc !== null && m.cc === m.baselineFinish;
    if (s.versusBaseline !== null)
      parts.push(
        `That is ${rel(s.versusBaseline, `the baseline finish${same ? " and contract completion" : ""} of ${shortDay(m.baselineFinish)}`)}${s.versusBaseline > 0 ? ", a delay" : ""}.`,
      );
    if (same) {
      // Both yardsticks are the same date, so one sentence covers them.
    } else if (s.completionMismatch !== null)
      parts.push(
        `The contract completion on file, ${shortDay(m.cc)}, is ${wd(s.completionMismatch)} ${s.completionMismatch > 0 ? "after" : "before"} that baseline finish, so it isn't used to measure delay until the contract date is confirmed.`,
      );
    else if (s.versusContract !== null)
      parts.push(
        s.versusBaseline !== null
          ? `Against the contract completion of ${shortDay(m.cc)}, it is ${s.versusContract === 0 ? "on time" : `${wd(s.versusContract)} ${s.versusContract > 0 ? "late" : "early"}`}.`
          : `That is ${rel(s.versusContract, `the contract completion of ${shortDay(m.cc)}`)}.`,
      );
    if (!parts.length)
      parts.push("No contract completion or baseline is saved to measure it against.");
    out.push(
      `As of ${ddText}, the schedule forecasts completion on ${shortDay(m.forecast)}, driven by its logic and recorded progress. ${parts.join(" ")}`,
    );
  }
  if (m.prior) {
    const changes = compareActivities(m, m.prior.activities);
    const finished = changes.filter((c) => c.notes.includes("Finished")).length;
    const started = changes.filter((c) => c.notes.includes("Started")).length;
    const priorFinish = Math.max(
      ...m.prior.activities.map((a) => day(a.finish) ?? 0).filter((t) => t > 0),
    );
    const moved =
      m.forecast !== null && Number.isFinite(priorFinish)
        ? workDaysBetween(priorFinish, m.forecast, m.projectCal)
        : null;
    const slips = changes.filter((c) => (c.finish_variance ?? 0) > 0).length;
    out.push(
      `Since the last update (data date ${shortDay(day(m.prior.data_date))}), ${started} ${started === 1 ? "activity" : "activities"} started and ${finished} finished. ${moved === null ? "" : moved === 0 ? "The forecast completion did not move." : `The forecast completion moved ${wd(moved)} ${moved > 0 ? "later" : "earlier"}.`}${slips ? ` ${slips} ${slips === 1 ? "activity is" : "activities are"} forecast to finish later than in that update.` : ""}`.trim(),
    );
  }
  const lp = (m.floatPaths[0]?.activity_ids ?? m.longest)
    .map((id) => m.byId.get(id))
    .filter((r): r is GanttRow => !!r);
  if (lp.length) {
    const tf = m.floatPaths[0]?.total_float ?? lp[lp.length - 1].tf;
    out.push(
      `The longest path runs through ${(lp.length > 4 ? [lp[0], ...lp.slice(1, -1).map((r) => ({ ...r, a: { ...r.a, name: "" } })), lp[lp.length - 1]] : lp).map((r) => `${r.a.id}${r.a.name ? ` ${r.a.name}` : ""}`).join(", then ")}${tf === null || tf === undefined ? "" : `, with total float of ${tf < 0 ? "minus " : ""}${wd(tf)}`}.`,
    );
  }
  const near = m.floatPaths.slice(1);
  if (near.length)
    out.push(
      `The next ${near.length === 1 ? "path" : `${near.length} paths`}: ${near
        .map(
          (p) =>
            `float path ${p.rank} (${p.activity_ids.slice(0, 3).join(", ")}${p.activity_ids.length > 3 ? " and more" : ""}) with ${p.total_float < 0 ? "minus " : ""}${wd(p.total_float)} of float`,
        )
        .join("; ")}.`,
    );
  const reg = input.control.delay_register ?? [];
  if (reg.length)
    out.push(
      `${reg.length} delay ${reg.length === 1 ? "event has" : "events have"} been modeled: ${reg
        .map(
          (d) =>
            `${d.event_id} moved the modeled completion ${d.impact_project_work_days >= 0 ? "" : "minus "}${wd(d.impact_project_work_days)} (${d.impact_calendar_days} calendar days) at the ${shortDay(day(d.data_date))} update`,
        )
        .join(
          "; ",
        )}. These are isolated fragnet results; they do not decide responsibility or entitlement.`,
    );
  const look = lookaheadByPath(input);
  const n = look.reduce((t, g) => t + g.rows.length, 0);
  if (n) {
    const onLp = look.find((g) => g.rank === 1)?.rows.length ?? 0;
    out.push(
      `In the three weeks after the data date, ${n} ${n === 1 ? "activity has" : "activities have"} work scheduled, ${onLp} on the longest path.`,
    );
  }
  const health = scheduleHealth(input);
  const failed = health.filter((h) => h.status === "fail");
  const ran = health.filter((h) => h.status !== "not-run").length;
  out.push(
    failed.length
      ? `${ran - failed.length} of ${ran} schedule health checks pass. To review: ${failed.map((h) => `${h.name.replace(/ \(.*\)$/, "").toLowerCase()} (${h.id === 13 || h.id === 14 ? h.value : h.count})`).join(", ")}.`
      : `All ${ran} schedule health checks that could run pass.`,
  );
  return out;
}

const style = `<style>.cpmr{color:${INK};font-size:12px}.cpmr h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em}.cpmr p{margin:0 0 8px;line-height:1.5}.cpmr .cpm-tbl{overflow-x:auto}.cpmr table{border-collapse:collapse;width:100%;min-width:560px}.cpmr th{text-align:left;color:${MUTED};font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;padding:5px 6px;white-space:nowrap}.cpmr td{padding:5px 6px;border-top:1px solid ${LINE2};vertical-align:top}.cpmr td:first-child,.cpmr th:first-child{position:sticky;left:0;background:#fff;z-index:1}.cpmr .cpm-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.cpmr .cpm-mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap}.cpmr .cpmr-sub{color:${INK2}}.cpmr .cpmr-g td{font-weight:700;padding-top:10px}.cpmr .cpmr-pass{color:#1F8A5B;font-weight:700}.cpmr .cpmr-fail{color:#B42318;font-weight:700}.cpmr .cpmr-nr{color:${MUTED}}</style>`;

export function narrativeHtml(input: GanttInput): string {
  const paras = scheduleNarrative(input);
  if (!paras.length) return "";
  return `${style}<div class="cpmr" id="cpm-narrative"><h2>SCHEDULE NARRATIVE</h2>${paras.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="cpmr-sub">Written from the saved calculation. Add the causes and the steps being taken before it goes to the owner.</p></div>`;
}

export function healthHtml(input: GanttInput): string {
  const checks = scheduleHealth(input);
  const ran = checks.filter((c) => c.status !== "not-run");
  const passed = ran.filter((c) => c.status === "pass").length;
  const val = (c: HealthCheck) =>
    c.value === null ? "" : c.id === 13 || c.id === 14 ? c.value.toFixed(2) : `${c.value}%`;
  const rows = checks
    .map(
      (c) =>
        `<tr data-health="${c.id}"><td class="cpm-n">${c.id}</td><td>${esc(c.name)}</td><td class="cpmr-sub">${esc(c.threshold)}</td><td class="cpm-n">${c.status === "not-run" || c.id === 12 ? "" : `${c.id === 13 || c.id === 14 ? "" : `${c.count} of ${c.of} · `}${esc(val(c))}`}</td><td class="${c.status === "pass" ? "cpmr-pass" : c.status === "fail" ? "cpmr-fail" : "cpmr-nr"}">${c.status === "pass" ? "Pass" : c.status === "fail" ? "Review" : "Not run"}</td><td class="cpmr-sub">${esc([c.note, c.activity_ids.length ? c.activity_ids.slice(0, 8).join(", ") + (c.activity_ids.length > 8 ? ` and ${c.activity_ids.length - 8} more` : "") : ""].filter(Boolean).join(" · "))}</td></tr>`,
    )
    .join("");
  return `${style}<div class="cpmr" id="cpm-health"><h2>SCHEDULE HEALTH (DCMA 14-POINT)</h2><p class="cpmr-sub">${passed} of ${ran.length} checks pass on remaining work.</p><div class="cpm-tbl"><table><thead><tr><th class="cpm-n">#</th><th>Check</th><th>Passes when</th><th class="cpm-n">Result</th><th>Status</th><th>Activities and notes</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

export function lookaheadHtml(input: GanttInput, weeks = 3): string {
  const groups = lookaheadByPath(input, weeks);
  if (!groups.length) return "";
  const m = ganttModel(input);
  const rows = groups
    .map((g) => {
      const color = g.rank ? (PATH_COLORS[(g.rank - 1) % PATH_COLORS.length] ?? INK) : INK2;
      return `<tr class="cpmr-g" data-look-path="${g.rank ?? "other"}"><td colspan="6" style="color:${color}">${esc(g.label)} · ${g.rows.length}</td></tr>${g.rows
        .map(
          (r) =>
            `<tr data-look="${esc(r.a.id)}"><td class="cpm-mono">${esc(r.a.id)}</td><td>${esc(r.a.name)}</td><td class="cpm-n">${esc(shortDay(r.start))}${r.started ? " A" : ""}</td><td class="cpm-n">${esc(shortDay(r.finish))}</td><td class="cpm-n">${esc(r.a.remaining_duration ?? r.a.duration ?? "")}</td><td class="cpm-n"${(r.tf ?? 0) < 0 ? ' style="color:#B42318;font-weight:700"' : ""}>${esc(r.tf ?? "")}</td></tr>`,
        )
        .join("")}`;
    })
    .join("");
  return `${style}<div class="cpmr" id="cpm-lookahead"><h2>${weeks}-WEEK LOOKAHEAD BY PATH</h2><p class="cpmr-sub">${esc(`${shortDay(m.dd)} to ${shortDay(m.dd === null ? null : m.dd + (weeks * 7 - 1) * DAY)}, remaining work only, longest path first.`)}</p><div class="cpm-tbl"><table><thead><tr><th>ID</th><th>Activity</th><th class="cpm-n">Start</th><th class="cpm-n">Finish</th><th class="cpm-n" title="Remaining working days">Rem. WD</th><th class="cpm-n">Total float</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
