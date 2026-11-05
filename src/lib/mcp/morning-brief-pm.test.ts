import { describe, expect, it } from "vitest";
import { alertMarkupViolations, emptyCssValues, paletteViolations } from "./cards/palette";
import { renderBriefHtml } from "./cards/brief-html";
import { renderMarkdown } from "./cards/markdown";
import { INBOX_SECTION, type BriefJob } from "./morning-brief";
import { buildPmBrief, workDaysBetween } from "./morning-brief-pm";
import { focusCpm, type FocusAct, type FocusData } from "./morning-brief-focus";
import { cardWidgetHtml } from "./cards/widget";
import { nativeCardHtml } from "./cards/native";

// Fictional ALP test job shaped like 2717 Harbor Residence: a schedule last updated Jun 25.
const NOW = new Date("2026-11-05T15:00:00Z");
const act = (over: Partial<FocusAct> & { id: string; name: string }): FocusAct => ({
  start: null,
  finish: null,
  duration: 10,
  pct: 0,
  critical: false,
  total_float: 5,
  party: "sub",
  subco: null,
  remaining: null,
  actual_start: null,
  actual_finish: null,
  sov_line: null,
  milestone: false,
  ...over,
});

const JOB: BriefJob = {
  job_id: "job-2717",
  job_number: "2717",
  name: "Harbor Residence",
  company_id: "alp",
  company_name: "ALP Construction",
  time_zone: "America/New_York",
  scope: "full",
  seat: "pm",
  items: [{ id: "rfi1", action: "RFI-007 pool deck drain detail", item_type: "rfi", owner: "Architect", due_date: "2026-06-24" }],
  activities: [{ id: "A1", name: "Drywall", description: null, start: "2026-06-22", finish: "2026-07-03", duration: 10, total_float: 0, critical: true }],
  lookahead: null,
  pay: [],
  links: {},
  daily_today: false,
} as unknown as BriefJob;

const OTHER: BriefJob = { ...JOB, job_id: "job-2810", job_number: "2810", name: "Bayview Remodel", activities: [], items: [{ id: "x", action: "Submit permit", due_date: "2026-11-01" }] } as unknown as BriefJob;

const FOCUS: FocusData = {
  cpm: {
    version: 8,
    data_date: "2026-06-25",
    contract_completion: "2026-08-21",
    forecast_finish: "2026-08-26",
    work_days_mask: 126,
    acts: [
      act({ id: "A1", name: "Drywall hang and finish", start: "2026-06-22", finish: "2026-07-03", pct: 40, critical: true, total_float: 0, subco: "Bayline Drywall", remaining: 7 }),
      act({ id: "A2", name: "Window fabrication and delivery", start: "2026-05-20", finish: "2026-07-10", duration: 40, pct: 60, total_float: 6, subco: "Breakwater Window Systems" }),
      act({ id: "A3", name: "Tile at baths", start: "2026-07-02", finish: "2026-07-14", pct: 0, subco: "Harbor Tile Co." }),
      act({ id: "A4", name: "Rough plumbing inspection", start: "2026-06-26", finish: "2026-06-26", duration: 1, party: "self", subco: null }),
      act({ id: "MS", name: "Substantial completion", start: "2026-08-26", finish: "2026-08-26", duration: 0, milestone: true }),
    ],
  },
  ior: {
    pct: 60,
    cost_to_date: 1625000,
    original_contract: 3200000,
    original_budget: 2720000,
    cost_growth: 180000,
    risks: [
      { title: "Electrician crew shortage", owner: "PM", status: "escalated", response: "mitigate", category: "labor", dollar: 45000, probability: 0.5, next_review: null, next_move: null },
      { title: "Pool deck change", owner: null, status: "active", response: null, category: "field_change", dollar: 30000, probability: 0.6, next_review: null, next_move: "Build the CO package" },
    ],
    pending_cos: [{ number: "CO-003", title: "Pool equipment relocation", amount: 85000, status: "Pending" }],
  },
  cos: [],
  buyout: { parties: ["Bayline Drywall"], ordered: ["Bayline Drywall"], packages: 1 },
  pay: { count: 0, latest: null, issue: null },
  contract_total: 3410000,
  dailies: [],
};

const build = (seat: "pm" | "super" = "pm") => {
  const job = seat === "super" ? ({ ...JOB, seat: "super", scope: "super" } as BriefJob) : JOB;
  const focus: FocusData = seat === "super" ? { ...FOCUS, ior: FOCUS.ior, cos: null, buyout: null, pay: null, contract_total: null } : FOCUS;
  return buildPmBrief({ jobs: [job, OTHER], focus: new Map([[job.job_id, focus]]), now: NOW, firstName: "Marshall" });
};

describe("PM morning brief", () => {
  it("follows Marshall's order and reads an old schedule from its data date", () => {
    const { doc } = build();
    expect(doc.greeting).toBe("Good morning, Marshall.");
    expect(doc.sections.filter((s) => s.step).map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
    expect(doc.sections[0].heading).toBe("Yesterday, Thursday, Jun 25");
    const today = doc.sections[1];
    const text = JSON.stringify(today);
    expect(text).toContain("The schedule is out of date");
    expect(text).toContain("Bayline Drywall: Drywall hang and finish");
    expect(text).toContain('"type":"gantt"');
    expect(text).toContain("Starts within 2 weeks, not bought out");
    expect(text).toContain("Tile at baths (Harbor Tile Co.)");
    expect(text).toContain("Long lead");
    expect(doc.finish).toMatchObject({ contract: "Aug 21", forecast: "Aug 26", late: true, variance: "4 work days late" });
    const titles = doc.sections.map((s) => s.heading);
    expect(titles).toContain("What don't I know yet?");
    expect(titles).toContain("Your other jobs");
  });

  it("asks about today's risk, lists change orders and keeps the inbox heading", () => {
    const { doc, card } = build();
    const risks = JSON.stringify(doc.sections[2]);
    expect(risks).toContain("Electrician crew shortage");
    expect(risks).toContain("Escalated");
    expect(risks).toContain("Do you see a new risk today");
    const cos = JSON.stringify(doc.sections[3]);
    expect(cos).toContain("CO-003 Pool equipment relocation");
    expect(cos).toContain("Draft the CO package");
    expect(cos).toContain(INBOX_SECTION);
    expect(renderMarkdown(card)).toContain(INBOX_SECTION);
    const money = JSON.stringify(doc.sections[4]);
    expect(money).toContain("$3,410,000");
    expect(money).toContain("Match needed");
    expect(money).toContain("Add it to the PM meeting");
  });

  it("keeps money off a superintendent's brief", () => {
    const { doc } = build("super");
    const text = JSON.stringify(doc);
    expect(text).not.toContain("$");
    expect(doc.sections.some((s) => s.heading.startsWith("Money"))).toBe(false);
  });

  it("renders palette-only HTML with no inline styles, remote CSS or blue", () => {
    const html = renderBriefHtml(build().doc);
    expect(paletteViolations(html, true)).toEqual([]);
    expect(alertMarkupViolations(html)).toEqual([]);
    expect(emptyCssValues(html.match(/<style>([\s\S]*)<\/style>/)![1])).toEqual([]);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/url\s*\(|@import/i);
    expect(html).not.toMatch(/#2465CB|#2563EB|#1E5FED/i);
    expect(html).not.toMatch(/<script|<footer/i);
    expect(html).toContain('data-prompt="Lock the two-week lookahead on 2717 Harbor Residence."');
    expect(html).toContain('data-set="weeks=3"');
    expect(html).toContain("End of lookahead period");
    expect(html).toContain("@media (max-width:480px)");
  });

  it("hides chat buttons on the page view", () => {
    expect(renderBriefHtml(build().doc, "page")).toContain('data-mode="page"');
  });

  it("counts late days on the schedule's own work week", () => {
    expect(workDaysBetween("2026-08-21", "2026-08-26", 126)).toBe(4);
    expect(workDaysBetween("2026-08-21", "2026-08-26", 62)).toBe(3);
  });

  it("reads the subcontractor from the schedule's activity codes", () => {
    const parsed = focusCpm({
      version: 8,
      data: {
        data_date: "2026-06-25",
        contract_completion: "2026-08-21",
        settings: { calendars: [{ work_days: 126 }] },
        activity_codes: [{ id: "subco", values: [{ id: "bay", name: "Bayline Drywall" }] }],
        schedule_control: { code_values: { A1: { party: "sub", subco: "bay" } } },
        activities: [{ id: "A1", name: "Drywall", start: "2026-06-22", finish: "2026-07-03", duration: 10, pct_complete: 40, total_float: 0, critical: true }],
      },
    });
    expect(parsed?.acts[0]).toMatchObject({ party: "sub", subco: "Bayline Drywall", pct: 40 });
    expect(parsed?.work_days_mask).toBe(126);
  });

  it("ships card scripts that parse, with buttons allowed through the sanitizer", () => {
    for (const html of [cardWidgetHtml(), nativeCardHtml()]) {
      const js = html.match(/<script>([\s\S]*)<\/script>/)![1];
      expect(() => new Function(js)).not.toThrow();
      expect(js).toContain('"BUTTON"');
      expect(js).toContain("data-prompt");
    }
  });
});
