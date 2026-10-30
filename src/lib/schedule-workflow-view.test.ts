import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { prepareSchedule } from "./mcp/schedule-control";
import type { Activity } from "./mcp/living";
import { renderReportBody, type JobPayload } from "./report-pages";

const activity = (
  id: string,
  name: string,
  duration: number,
  pred: string | null,
  wbs: string,
): Activity => ({
  id,
  name,
  duration,
  start: null,
  finish: null,
  predecessors: pred ? [{ id: pred, type: "FS" }] : [],
  total_float: null,
  critical: null,
  pct_complete: 0,
  value: 0,
  sov_line: null,
  cost_code: null,
  wbs_id: wbs,
});
function fixture() {
  let data = prepareSchedule(null, 0, {
    operation: "recalculate",
    data_date: "2026-09-28",
    starter_wbs: true,
    settings: {
      project_start: "2026-09-28",
      default_calendar_id: "work",
      calendars: [{ id: "work", name: "Mon–Fri", work_days: 62, holidays: [], hours_per_day: 8 }],
      finish_convention: "inclusive-last-work-day",
      out_of_sequence: "retained-logic",
    },
    initial_activities: [
      activity("NTP", "Notice to proceed", 0, null, "general-requirements"),
      activity(
        "S-01",
        "Prepare and submit electrical package",
        5,
        "NTP",
        "submittals-prepare-submit",
      ),
      activity(
        "S-02",
        "Review and approve electrical package",
        10,
        "S-01",
        "submittals-review-approve",
      ),
      activity("P-01", "Release and fabricate switchgear", 20, "S-02", "procurement"),
      activity("C-01", "Install and terminate switchgear", 10, "P-01", "construction"),
      activity("C-02", "Inspect and commission", 2, "C-01", "construction"),
      activity("F-01", "Final handover", 0, "C-02", "closeout"),
      activity("M-02", "Early access milestone", 0, "NTP", "general-requirements"),
    ],
  }).data;
  data = prepareSchedule(data, 1, {
    operation: "baseline",
    data_date: "2026-09-28",
    baseline: { id: "BL1", name: "Synthetic accepted baseline", status: "accepted" },
  }).data;
  data = prepareSchedule(data, 2, {
    operation: "recalculate",
    data_date: "2026-10-08",
    updates: [
      { id: "NTP", actual_finish: "2026-09-28", remaining_duration: 0, pct_complete: 100 },
      {
        id: "S-01",
        actual_start: "2026-09-28",
        actual_finish: "2026-10-02",
        remaining_duration: 0,
        pct_complete: 100,
      },
      { id: "S-02", actual_start: "2026-10-05", remaining_duration: 9, pct_complete: 10 },
    ],
  }).data;
  data = prepareSchedule(data, 3, {
    operation: "tia",
    data_date: "2026-10-08",
    delay: {
      event_id: "SYN-E1",
      event_date: "2026-10-08",
      description: "Fictional redesign for visual QA",
      source_refs: ["synthetic fixture only"],
      assumptions: ["Five working days, fictional fixture"],
      add_activities: [
        activity("D-01", "Design revision and resubmittal", 5, "S-02", "submittals-prepare-submit"),
      ],
      replace_predecessors: [{ activity_id: "P-01", predecessors: [{ id: "D-01", type: "FS" }] }],
    },
  }).data;
  return {
    page: "schedule",
    job_number: "SYN-2026",
    job_name: "Fictional switchgear project",
    report: { found: true, version: 4, data_date: "2026-10-08", data },
  } as JobPayload;
}
const row = (html: string, id: string) =>
  html.match(new RegExp(`<tr id="activity-${id}">.*?</tr>`))?.[0] ?? "";
describe("controlled schedule page", () => {
  it("renders saved WBS, baseline beneath current bars, actual evidence, milestones and genuine links", () => {
    const input = fixture(),
      frozen = structuredClone(input),
      html = renderReportBody(input);
    expect(input).toEqual(frozen);
    expect(html).toContain("Work breakdown structure");
    expect(row(html, "S-01")).toContain("Submittals / Prepare and Submit");
    expect(row(html, "S-02")).toContain('data-actual-period="true"');
    expect(row(html, "P-01")).not.toContain('data-actual-period="true"');
    expect(row(html, "S-02")).not.toContain('data-progress="10"');
    expect(row(html, "NTP")).toContain('data-milestone="true"');
    expect(row(html, "D-01")).toContain("repeating-linear-gradient");
    expect(row(html, "C-01")).toContain('data-baseline="BL1"');
    expect(row(html, "C-01")).toContain("bottom:0;height:3px");
    expect(html).toContain('data-logic-from="D-01" data-logic-to="P-01"');
    expect(html).toContain('data-date-marker="true"');
    expect(html).toContain("overflow-x:auto");
    expect(html).not.toContain("NaN");
    mkdirSync("output/playwright", { recursive: true });
    writeFileSync(
      "output/playwright/synthetic-schedule.html",
      `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Athena schedule — synthetic QA</title></head><body style="font-family:Arial,sans-serif;margin:20px;color:#1E3A5F"><p style="color:#6B7280">PRIVATE LOCAL QA · fictional project and assumptions</p><h1 style="font-size:22px">SYN-2026 · Switchgear project</h1>${html}</body></html>`,
    );
  });
  it("escapes hierarchy names and activity text in the saved page", () => {
    const input = fixture();
    input.report.data!.activities![0].name = "<script>window.BAD=true</script>";
    const html = renderReportBody(input);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
