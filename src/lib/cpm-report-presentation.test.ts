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
