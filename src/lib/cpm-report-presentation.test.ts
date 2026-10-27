import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderReportBody, type JobPayload } from "./report-pages";
import { identifiedDelayActivityId } from "./mcp/styled-views";
import { CPM_GANTT_SPEC, activityLine, type Activity } from "./mcp/living";

const source: JobPayload = {
  page: "schedule",
  job_name: "Synthetic QA",
  report: {
    found: true,
    data_date: "2026-01-12",
    data: {
      tia: { fragnet: "D1" },
      activities: [
        {
          id: "A",
          name: "Unstarted",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: false,
          pct_complete: 0,
        },
        {
          id: "B",
          name: "Critical",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: true,
          pct_complete: 0,
        },
        {
          id: "C",
          name: "Partial",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: false,
          pct_complete: 30,
        },
        {
          id: "D",
          name: "Partial critical",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: true,
          pct_complete: 70,
        },
        {
          id: "E",
          name: "Complete",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: true,
          pct_complete: 100,
        },
        {
          id: "D1",
          name: "Permitting",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: true,
          pct_complete: 20,
          duration: 8,
        },
        {
          id: "D99",
          name: "Delay wording alone",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: false,
          pct_complete: 0,
        },
        {
          id: "U",
          name: "Unknown",
          start: "2026-01-05",
          finish: "2026-01-15",
          critical: null,
          pct_complete: null,
        },
      ],
    },
  },
};
const row = (html: string, id: string) =>
  html.match(new RegExp(`<tr id="activity-${id}">.*?</tr>`))?.[0] ?? "";
describe("Athena CPM presentation", () => {
  it("draws saved percentages, remaining criticality, and explicit delay without changing source data", () => {
    const original = JSON.stringify(source);
    for (const date of ["2025-12-01", "2026-01-12", "2027-01-01"]) {
      const h = renderReportBody({ ...source, report: { ...source.report, data_date: date } });
      expect(row(h, "A")).toContain("background:#16834A");
      expect(row(h, "B")).toContain("background:#C12D2D");
      expect(row(h, "C")).toContain('data-progress="30"');
      expect(row(h, "D")).toContain('data-progress="70"');
      expect(row(h, "E")).toContain('data-progress="100"');
      expect(row(h, "D1")).toContain("repeating-linear-gradient");
      expect(row(h, "D1")).toContain("Permitting · 8 WD");
      expect(row(h, "D99")).not.toContain("repeating-linear-gradient");
      expect(row(h, "U")).toContain("Progress Needed · Criticality Needed");
      expect(h).toContain("Data date");
    }
    expect(JSON.stringify(source)).toBe(original);
  });
  it("renders only zero-duration activities as colored diamonds and removes the full-width track", () => {
    const activities = [
      { id: "MG", name: "Noncritical milestone", duration: 0, critical: false, pct_complete: 0 },
      { id: "MR", name: "Critical milestone", duration: 0, critical: true, pct_complete: 0 },
      {
        id: "MB",
        name: "Completed critical milestone",
        duration: 0,
        critical: true,
        pct_complete: 100,
      },
      {
        id: "MU",
        name: "Unknown progress milestone",
        duration: 0,
        critical: true,
        pct_complete: null,
      },
      { id: "DAY", name: "One-day task", duration: 1, critical: false, pct_complete: 0 },
      {
        id: "NULL",
        name: "Unspecified duration",
        duration: null,
        critical: false,
        pct_complete: 0,
      },
    ].map((a) => ({ ...a, start: "2026-01-05", finish: "2026-01-05", total_float: 0 }));
    const fixture: JobPayload = { page: "schedule", report: { found: true, data: { activities } } };
    const before = JSON.stringify(fixture);
    const h = renderReportBody(fixture);
    for (const [id, color] of [
      ["MG", "#16834A"],
      ["MR", "#C12D2D"],
      ["MB", "#2563EB"],
      ["MU", "#9CA3AF"],
    ]) {
      const html = row(h, id);
      expect(html).toContain('data-milestone="true"');
      expect(html).toContain("left:clamp(6px,");
      expect(html).toContain(`background:${color}`);
      expect(html).not.toContain("data-progress=");
    }
    for (const id of ["DAY", "NULL"]) {
      expect(row(h, id)).not.toContain('data-milestone="true"');
      expect(row(h, id)).toContain('data-progress="0"');
    }
    expect(h).not.toContain("height:14px;background:#F3F4F6");
    expect(h).toContain("Milestone");
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it("aligns calendar month boundaries, ticks and bars across a year and leap day", () => {
    const activities = [
      {
        id: "BOUND",
        name: "Boundary",
        duration: 3,
        start: "2024-12-31",
        finish: "2025-01-02",
        total_float: -2,
        critical: true,
        pct_complete: 30,
      },
      {
        id: "LEAP",
        name: "Leap",
        duration: 0,
        start: "2024-02-29",
        finish: "2024-02-29",
        total_float: 0,
        critical: false,
        pct_complete: 0,
      },
    ];
    const fixture: JobPayload = { page: "schedule", report: { found: true, data: { activities } } };
    const before = JSON.stringify(fixture);
    const html = renderReportBody(fixture);
    for (const label of [
      "Activity ID",
      "Activity",
      "Duration",
      "Start",
      "Finish",
      "Float",
      "Feb 2024",
      "Dec 2024",
      "Jan 2025",
    ])
      expect(html).toContain(label);
    const offset = (pattern: RegExp) => Number(html.match(pattern)?.[1]);
    const dateOffset = (iso: string) =>
      ((Date.parse(`${iso}T00:00:00Z`) - Date.parse("2024-02-01T00:00:00Z")) /
        (Date.parse("2025-02-01T00:00:00Z") - Date.parse("2024-02-01T00:00:00Z"))) *
      100;
    expect(offset(/data-month="2025-01" style="position:absolute;left:([\d.]+)%/)).toBeCloseTo(
      dateOffset("2025-01-01"),
      4,
    );
    expect(offset(/data-tick="2025-01-08" style="position:absolute;left:([\d.]+)%/)).toBeCloseTo(
      dateOffset("2025-01-08"),
      4,
    );
    expect(
      offset(
        /data-bar-start="2024-12-31" data-bar-finish="2025-01-02" style="position:absolute;left:([\d.]+)%/,
      ),
    ).toBeCloseTo(dateOffset("2024-12-31"), 4);
    expect(html).toContain(`#D1D5DB ${dateOffset("2025-01-01").toFixed(4)}%`);
    expect(html).toContain(`#EBEDF0 ${dateOffset("2025-01-08").toFixed(4)}%`);
    expect(row(html, "BOUND")).toContain("12/31/2024");
    expect(row(html, "BOUND")).toContain("01/02/2025");
    expect(row(html, "LEAP")).toContain("02/29/2024");
    expect(row(html, "BOUND")).toContain(">-2</td>");
    expect(row(html, "LEAP")).toContain('data-milestone="true"');
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it("keeps missing and invalid dates visible without plotting or inventing duration and float", () => {
    const fixture: JobPayload = { page: "schedule", report: { found: true, data: { activities: [
      { id: "MISSING", name: "Missing", start: null, finish: "2026-01-06", duration: null, total_float: null },
      { id: "BAD", name: "Bad date", start: "2026-02-30", finish: "2026-03-03", duration: 1, total_float: 0 },
      { id: "REVERSED", name: "Reversed", start: "2026-04-02", finish: "2026-04-01", duration: 2, total_float: 4 },
    ] } } };
    const html = renderReportBody(fixture);
    expect(row(html, "MISSING")).toContain("Dates needed");
    expect(row(html, "MISSING").match(/Needed/g)?.length).toBeGreaterThanOrEqual(3);
    expect(row(html, "BAD")).toContain("Invalid date");
    expect(row(html, "REVERSED")).toContain("Check dates");
    expect(html).toContain("Timeline needs saved dates");
    expect(html).not.toContain("data-bar-start=");
    expect(html).not.toContain('data-milestone="true"');
  });
  it("keeps the existing calendar-day interpretation of saved timestamps", () => {
    const fixture: JobPayload = { page: "schedule", report: { found: true, data: { activities: [
      { id: "TIME", name: "Timestamp", start: "2026-01-05T12:00:00Z", finish: "2026-01-06T12:00:00Z", duration: 2, total_float: 0, critical: false, pct_complete: 0 },
    ] } } };
    expect(row(renderReportBody(fixture), "TIME")).toContain('data-bar-start="2026-01-05T12:00:00Z"');
    expect(row(renderReportBody(fixture), "TIME")).toContain("01/05/2026");
  });
  it("labels data-date range honestly and draws blue only within the unchanged axis", () => {
    const render = (data_date: string | null) =>
      renderReportBody({ ...source, report: { ...source.report, data_date } });
    const within = render("2026-01-12");
    expect(within).toContain('data-date-range="within">Data date: 01/12/2026');
    expect(row(within, "A")).toContain(
      'data-date-marker="true" style="position:absolute;left:35.4839%',
    );
    expect(row(within, "A")).toContain("width:1px;background:#2563EB");
    const before = render("2025-12-31");
    const after = render("2026-02-01");
    expect(before).toContain('data-date-range="before">Data date: 12/31/2025 · before timeline');
    expect(after).toContain('data-date-range="after">Data date: 02/01/2026 · after timeline');
    expect(before).not.toContain('data-date-marker="true"');
    expect(after).not.toContain('data-date-marker="true"');
    expect(before).toContain('data-month="2026-01"');
    expect(before).not.toContain('data-month="2025-12"');
    expect(after).not.toContain('data-month="2026-02"');
    expect(render(null)).toContain('data-date-range="missing">Data date: Needed');
    expect(render(null)).not.toContain('data-date-marker="true"');
    expect(render("2026-02-30")).toContain('data-date-range="missing">Data date: Invalid date');
  });
  it("bounds very long axes while retaining real dates and a scrollable script-free table", () => {
    const fixture: JobPayload = {
      page: "schedule",
      report: {
        found: true,
        data: {
          activities: [
            {
              id: "LONG",
              name: "Long",
              start: "2000-01-01",
              finish: "2100-12-31",
              duration: 12,
              total_float: 2,
              critical: false,
              pct_complete: 0,
            },
          ],
        },
      },
    };
    const html = renderReportBody(fixture);
    expect(html).toContain('style="width:18000px"');
    expect(html).toContain('data-bar-start="2000-01-01" data-bar-finish="2100-12-31"');
    expect((html.match(/data-month=/g) ?? []).length).toBeLessThanOrEqual(180);
    expect(html).toContain('aria-label="Schedule table and timeline"');
    expect(html).not.toContain("<script");
  });
  it("keeps the CPM handoff's financial guidance consistent with the released evidence rules", () => {
    const source = readFileSync("src/lib/mcp/tools/living-tools.ts", "utf8");
    expect(source).toContain(
      "Treat schedule allocations as planned, and earned progress, issued billing and payments received as distinct.",
    );
    expect(source).toContain(
      "Never infer billed or paid amounts from earned progress or planned work",
    );
    expect(source).not.toContain("contract − the higher of billed and earned to date");
  });
  it("identifies only an existing activity explicitly named by a saved delay result", () => {
    expect(identifiedDelayActivityId(source.report.data)).toBe("D1");
    expect(identifiedDelayActivityId({ activities: [{ id: "D99", name: "delay" }] })).toBeNull();
    expect(
      identifiedDelayActivityId({ tia: { fragnet: "missing" }, activities: [{ id: "D99" }] }),
    ).toBeNull();
    expect(
      identifiedDelayActivityId({
        delay_analysis: { fragnet: "D99" },
        activities: [{ id: "D99" }],
      }),
    ).toBe("D99");
  });
  it("sends host instructions for percent, explicit delays, WBS fallback and logic visibility", () => {
    const spec = CPM_GANTT_SPEC.join("\n");
    for (const text of [
      "never by the data date",
      "otherwise keep the activities flat",
      "on/off control",
      "explicitly identified",
      "Do not infer hatching",
      "Do not draw full-width gray background tracks",
      "completion takes precedence",
    ])
      expect(spec).toContain(text);
    expect(
      activityLine(
        {
          id: "U",
          name: "Unknown",
          duration: 1,
          start: null,
          finish: null,
          predecessors: [],
          total_float: null,
          critical: null,
          pct_complete: null,
          value: null,
          sov_line: null,
          cost_code: null,
        } as Activity,
        false,
      ),
    ).toContain("Progress Needed");
  });
});
