import type { ScheduleResult, ScheduledTask } from "./types";

export type ReportKind =
  | "critical"
  | "float"
  | "lookahead"
  | "full"
  | "gantt";

export interface ReportOptions {
  kind: ReportKind;
  /** For look-ahead: number of working/calendar days into the future from data date. */
  lookAheadDays?: number;
  /** Inline SVG markup for Gantt report. */
  ganttSvg?: string;
  /** Optional data date offset (project day index). Defaults to 0. */
  dataDate?: number;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return iso;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableRows(tasks: ScheduledTask[]): string {
  return tasks
    .map(
      (t) => `
      <tr class="${t.isCritical ? "crit" : ""}">
        <td class="mono">${escapeHtml(t.id)}</td>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.wbs ?? "")}</td>
        <td class="num">${t.duration}</td>
        <td class="num">${t.percentComplete ?? 0}%</td>
        <td>${fmtDate(t.earlyStartDate)}</td>
        <td>${fmtDate(t.earlyFinishDate)}</td>
        <td class="num">${t.totalFloat}</td>
      </tr>`,
    )
    .join("");
}

function filterTasks(result: ScheduleResult, opts: ReportOptions): ScheduledTask[] {
  const tasks = [...result.tasks];
  switch (opts.kind) {
    case "critical":
      return tasks.filter((t) => t.isCritical).sort((a, b) => a.earlyStart - b.earlyStart);
    case "float":
      return tasks.sort((a, b) => a.totalFloat - b.totalFloat || a.earlyStart - b.earlyStart);
    case "lookahead": {
      const window = opts.lookAheadDays ?? 21;
      const dataDate = opts.dataDate ?? 0;
      return tasks
        .filter((t) => t.earlyFinish >= dataDate && t.earlyStart <= dataDate + window)
        .sort((a, b) => a.earlyStart - b.earlyStart);
    }
    case "full":
    case "gantt":
    default:
      return tasks.sort((a, b) => a.earlyStart - b.earlyStart);
  }
}

function reportTitle(opts: ReportOptions): string {
  switch (opts.kind) {
    case "critical":
      return "Critical Path Report";
    case "float":
      return "Total Float Report";
    case "lookahead":
      return `${opts.lookAheadDays ?? 21}-Day Look-Ahead`;
    case "gantt":
      return "Gantt Chart";
    case "full":
    default:
      return "Full Schedule";
  }
}

export function buildReportHtml(
  result: ScheduleResult,
  opts: ReportOptions,
): string {
  const title = reportTitle(opts);
  const subtitle = [
    result.name,
    result.projectStartDate ? `Start ${result.projectStartDate}` : null,
    result.projectFinishDate ? `Finish ${result.projectFinishDate}` : null,
    `${result.projectDuration} working days`,
  ]
    .filter(Boolean)
    .join(" · ");

  const body =
    opts.kind === "gantt"
      ? `<div class="gantt">${opts.ganttSvg ?? "<p>No Gantt available.</p>"}</div>`
      : `<table>
          <thead>
            <tr>
              <th>ID</th><th>Activity</th><th>WBS</th>
              <th class="num">Dur</th><th class="num">%</th>
              <th>Start</th><th>Finish</th><th class="num">TF</th>
            </tr>
          </thead>
          <tbody>${tableRows(filterTasks(result, opts))}</tbody>
        </table>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} · ${escapeHtml(result.name)}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif; color: #1f241f; margin: 24px; }
  header { border-bottom: 2px solid #1f241f; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  .eyebrow { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #7a6a4d; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #5c574e; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #e8e1cf; text-align: left; vertical-align: top; }
  th { background: #eee6d7; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #675d4b; }
  .num { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  tr.crit td { color: #b42318; font-weight: 600; }
  .gantt { overflow: visible; }
  .gantt svg { max-width: 100%; height: auto; }
  footer { margin-top: 24px; font-size: 10px; color: #7a6a4d; border-top: 1px solid #e8e1cf; padding-top: 8px; }
  .print-btn { position: fixed; top: 12px; right: 12px; background: #1f241f; color: white; border: 0; padding: 8px 14px; border-radius: 4px; font-size: 12px; cursor: pointer; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  <header>
    <div class="eyebrow">CPM Workbench · AOS</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">${escapeHtml(subtitle)}</div>
  </header>
  ${body}
  <footer>Generated ${new Date().toLocaleString()} · AOS Scheduler</footer>
  <script>setTimeout(function(){ window.focus(); }, 100);</script>
</body>
</html>`;
}

export function openReportWindow(html: string): void {
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
