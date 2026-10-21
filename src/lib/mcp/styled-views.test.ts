import { describe, it, expect } from "vitest";
import { readDelay, ganttPins, noteDateConflicts, windowFromDataDate, lookaheadView, emptyCard, SHOW_AS_IS, LOOKAHEAD_ARTIFACT_LINE } from "./styled-views";

const acts = [
  { id: "A1020", name: "Submit long-lead gear", start: "2026-10-19", finish: "2026-10-28", duration: 8, total_float: 0 },
  { id: "A1030", name: "Submit all other shop drawings", start: "2026-10-19", finish: "2026-11-20", duration: 25, total_float: 79 },
  { id: "A1130", name: "Underground inspection (hold point)", start: "2026-11-05", finish: "2026-11-05", duration: 1, total_float: 18 },
  { id: "D1060", name: "Engineer redesign — switchgear start delay", start: "2026-11-13", finish: "2026-12-03", duration: 15, total_float: 34 },
  { id: "A1370", name: "Final acceptance", start: "2027-07-13", finish: "2027-07-13", duration: 0, total_float: 0 },
];
const v3 = { activities: acts, delay_analysis: { fragnet: "D1060", delay_workdays: 15, completion_impact_workdays: 0, impacted_completion: "2027-07-13", reference_completion: "2027-07-13" } };

describe("delay result (2701 v3 shape)", () => {
  it("reads delay_analysis: 15 WD fragnet, 21 CD, completion impact 0 WD (float absorbed)", () => {
    const d = readDelay(v3)!;
    expect(d.callout).toBe("Delay: +15 WD (21 CD)");
    expect(d.completion_impact_wd).toBe(0);
    expect(d.line).toMatch(/Delay result \(D1060\): Delay: \+15 WD \(21 CD\), Nov 13, 2026 – Dec 3, 2026\. Completion impact: \+0 WD \(float absorbed it; D1060 still has 34 WD float\)/);
  });
  it("reads the tia shape and a bare D-fragnet activity", () => {
    expect(readDelay({ activities: acts, tia: { fragnet: "D1060", prior_completion: "2027-07-13", updated_completion: "2027-07-13" } })!.callout).toBe("Delay: +15 WD (21 CD)");
    expect(readDelay({ activities: acts })!.fragnet).toBe("D1060");
    expect(readDelay({ activities: acts.filter((a) => a.id !== "D1060") })).toBeNull();
  });
  it("pins the Gantt and the callout as REQUIRED", () => {
    const p = ganttPins(readDelay(v3));
    expect(p[0]).toMatch(/^REQUIRED: .*styled Gantt/);
    expect(p[1]).toContain('"Delay: +15 WD (21 CD)" on D1060');
  });
});

describe("save note vs saved dates (2701 v3 note)", () => {
  it("refuses Sep 30 contract completion and Jul 27 final acceptance", () => {
    const note = "Impacted baseline; final acceptance Jul 27, 2027; delay-only completion impact 0 WD. Retain v2 comparison; contract completion remains Sep 30, 2027.";
    const c = noteDateConflicts(note, "2027-09-16", acts);
    expect(c).toContain("Contract completion: the note says Sep 30, 2027, the saved date is Sep 16, 2027.");
    expect(c).toContain("Final acceptance: the note says Jul 27, 2027, the saved date is Jul 13, 2027.");
  });
  it("passes a note that matches", () => {
    expect(noteDateConflicts("final acceptance 2027-07-13; contract completion remains September 16, 2027", "2027-09-16", acts)).toEqual([]);
  });
});

describe("lookahead view", () => {
  it("fills the window from the CPM data date (Oct 19 → Oct 26–Nov 6)", () => {
    expect(windowFromDataDate("2026-10-19")).toEqual({ start: "2026-10-26", end: "2026-11-06" });
  });
  it("renders a finished view: link, artifact rule, top 3, calendar strip, risk card, legend", () => {
    const v = lookaheadView({ title: "2701 – Harbor Point", ref: "LA-37D09", start: "2026-10-26", end: "2026-11-06", dataDate: "2026-10-19", acts, items: [{ action: "Underground electrical inspection on 2026-11-05 is not yet requested", owner: "Marcus Hale", due: "2026-11-02" }], highlight: "2026-10-26", pageUrl: "https://app.meetathena.io/r/job/x/schedule" });
    expect(v.split("\n")[0]).toBe("Styled lookahead (always current, private to your company): https://app.meetathena.io/r/job/x/schedule");
    expect(v).toContain(LOOKAHEAD_ARTIFACT_LINE);
    expect(v).not.toContain(SHOW_AS_IS);
    expect(v).toContain("### Top 3 priorities");
    expect(v).toMatch(/\| A1020 Submit long-lead gear \| 0 \| 🔵 \| 🔵 \| 🔵 \|/);
    expect(v).toMatch(/A1130 Underground inspection \(hold point\) \| 18 \|(  \|){8} 📋🚩 \|/);
    expect(v).toContain("### Risk cards");
    expect(v).not.toContain("D1060");
    expect(v).toContain("**Legend:**");
  });
  it("empty states are styled cards with a Next move", () => {
    const e = emptyCard("pay_app", "2701 – Harbor Point", "Send the billed-to-date figure.");
    expect(e).toContain(SHOW_AS_IS);
    expect(e).toMatch(/\*\*Next move:\*\* Send/);
  });
});
