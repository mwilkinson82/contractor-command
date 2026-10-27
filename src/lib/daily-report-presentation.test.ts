import { describe, expect, it } from "vitest";
import { renderReportBody, type DailyPagePayload } from "./report-pages";

const CEDAR_JOB = "289ca2cd-b585-419a-8c09-3501d1be48c3";

function savedDaily(day = "2026-10-27"): DailyPagePayload {
  const first = day === "2026-10-26";
  return {
    page: "daily", found: true, job_number: "2708",
    job_name: "Cedar Grove Medical Office Building", report_date: day,
    weather: "FICTIONAL DEMO: Clear, 62–70°F.",
    manpower: `FICTIONAL DEMO: ${first ? 4 : 3} electrical workers; 8 hours each; ${first ? 32 : 24} person-hours.`,
    subs_on_site: "FICTIONAL DEMO: No subcontractors on site.",
    deliveries: "FICTIONAL DEMO: No deliveries assumed.",
    issues: "FICTIONAL DEMO: None assumed.",
    delays: "FICTIONAL DEMO: No delays assumed.",
    safety: "FICTIONAL DEMO: No incidents assumed.",
    lines: [{ work: "FICTIONAL DEMO: Installed EMT conduit. Training scenario only; not actual progress.",
      qty: first ? 120 : 96, unit: "LF", crew: first ? 4 : 3, hours: 8,
      sov_item: "26.04", activity_id: "E090" }],
  };
}

describe("saved daily presentation", () => {
  it.each([
    ["2026-10-26", "October 26, 2026", "120 LF · crew 4 · 8 hours"],
    ["2026-10-27", "October 27, 2026", "96 LF · crew 3 · 8 hours"],
  ])("cleans the approved Cedar Grove display for %s without changing source data", (day, date, facts) => {
    const source = savedDaily(day);
    const before = structuredClone(source);
    source.lines?.forEach(Object.freeze);
    Object.freeze(source.lines);
    Object.freeze(source);
    const html = renderReportBody(source, { jobId: CEDAR_JOB });
    expect(html).toContain("2708 Cedar Grove Medical Office Building</h1>");
    expect(html).toMatch(new RegExp(`<h2[^>]*font-weight:700[^>]*>Daily Report for ${date}</h2>`));
    expect(html).not.toContain("FICTIONAL DEMO:");
    expect(html).toContain("Training scenario only; not actual progress.");
    expect(html).toContain(facts);
    expect(html).toContain("E090");
    expect(html).not.toContain("#DC2626");
    expect(source).toEqual(before);
  });

  it("retains provenance on other jobs, other dates and calls without verified route context", () => {
    const source = savedDaily();
    expect(renderReportBody(source, { jobId: "11111111-1111-4111-8111-111111111111" })).toContain("FICTIONAL DEMO:");
    expect(renderReportBody(savedDaily("2026-10-28"), { jobId: CEDAR_JOB })).toContain("FICTIONAL DEMO:");
    expect(renderReportBody(source)).toContain("FICTIONAL DEMO:");
    const spoofed = { ...source, job_id: CEDAR_JOB };
    expect(renderReportBody(spoofed)).toContain("FICTIONAL DEMO:");
  });

  it("removes only the leading label and continues to escape report content", () => {
    const source = savedDaily();
    source.issues = 'FICTIONAL DEMO: <img src=x onerror="alert(1)"> mentions FICTIONAL DEMO: in a quote.';
    const html = renderReportBody(source, { jobId: CEDAR_JOB });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("mentions FICTIONAL DEMO: in a quote.");
    expect(source.issues).toMatch(/^FICTIONAL DEMO:/);
  });

  it("uses a full-date report heading for ordinary dailies without hiding their text", () => {
    const html = renderReportBody(savedDaily(), { jobId: "other-job" });
    expect(html).toContain("Daily Report for October 27, 2026</h2>");
    expect(html).toContain("FICTIONAL DEMO:");
    expect(renderReportBody(savedDaily("2026-02-31"))).toContain(">Daily Report</h2>");
    expect(renderReportBody({ ...savedDaily(), found: false })).toContain("No daily is saved for this job yet.");
  });
});
