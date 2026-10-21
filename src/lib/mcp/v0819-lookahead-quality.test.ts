import { describe, expect, it } from "vitest";
import { entryLine, itemFlags, itemLabel, linkedActivity, lookaheadModel, lookaheadView, type LaItem, type SAct } from "./styled-views";
import { lookaheadPdf } from "./lookahead-pdf";
import { renderReportBody } from "../report-pages";

// Shaped like job 2701 LA-31BE8 before the reseed fix (Khan's test, Oct 21 2026 1:05 AM).
export const ACTS: SAct[] = [
  { id: "A1110", name: "Underground conduit rough-in", start: "2026-10-26", finish: "2026-10-30", duration: 5, total_float: 0 },
  { id: "A1120a", name: "FA/LV underground pathways", start: "2026-10-27", finish: "2026-11-02", duration: 5, total_float: 3 },
  { id: "A1130", name: "Underground inspection (hold point)", start: "2026-11-05", finish: "2026-11-05", duration: 1, total_float: 0 },
];
export const ITEMS: LaItem[] = [
  { action: "Confirm start date — Submit delay notice for the storm line conflict (Section 8.3, 7 calendar days).", owner: "Elena Brooks", due: "2026-10-06" },
  { action: "Confirm start date — Submit claim notice for the storm line conflict (Section 8.4).", owner: "Elena Brooks", due: "2026-10-11" },
  { action: "2701 – RFIs: RFI-001: underground conduit routing at grid C/4 conflicts with the storm line. Sent 2026-11-10; answer needed to hold the 2026-11-19 underground inspection.", owner: "Marcus Hale", due: "2026-10-30" },
  { action: "2701 – Inspections: Fire alarm underground pathway inspection on 2026-11-18 is not yet requested with the City of Corpus Christi.", owner: "Priya Nandakumar", due: "2026-11-02" },
];
const OPTS = { today: "2026-10-21", dataDate: "2026-10-19" };
const START = "2026-10-26", END = "2026-11-06";

describe("0.8.19 lookahead data quality (2701 LA-31BE8)", () => {
  const m = lookaheadModel(START, END, ACTS, ITEMS, OPTS);

  it("1. header counts are the lengths of the rendered lists", () => {
    expect(m.counts.risks).toBe(m.risks.length);
    expect(m.counts.overdue).toBe(m.overdue.length);
    expect(m.risks.map((e) => e.item.action)).toEqual(expect.arrayContaining([ITEMS[2].action]));
    const v = lookaheadView({ title: "2701 – Harbor Point", ref: "LA-31BE8", start: START, end: END, dataDate: "2026-10-19", acts: ACTS, items: ITEMS, ...OPTS });
    const cards = (v.split("### Risk cards")[1] ?? "").split("\n").filter((l) => l.startsWith("> 🚩")).length;
    expect(v).toContain(`${m.risks.length} risks`);
    expect(cards).toBe(m.risks.length);
    expect(m.risks.length).toBeGreaterThan(0);
  });

  it("2. a sent date after the data date and today is flagged, not hidden", () => {
    const rfi = m.entries.find((e) => e.item.action.includes("RFI-001"))!;
    expect(rfi.label).toContain("Sent 2026-11-10");
    expect(rfi.flags.some((f) => f.kind === "bad_date" && /Sent Nov 10, 2026 .*date looks wrong, check it/.test(f.text))).toBe(true);
    expect(itemFlags({ action: "Submittal 12 submitted 2026-10-15" }, null, "2026-10-21")).toEqual([]);
    expect(itemFlags({ action: "Closed 2026-12-01" }, null, "2026-10-21")[0].text).toMatch(/date looks wrong/);
  });

  it("3. past-due open items are OVERDUE, sorted first, red, and read naturally", () => {
    expect(m.top.slice(0, 2).every((e) => e.overdue)).toBe(true);
    expect(m.top[0].item.due).toBe("2026-10-06");
    expect(m.top[0].label).toBe("Submit delay notice for the storm line conflict (Section 8.3, 7 calendar days) (delay start date unknown; confirm it)");
    expect(itemLabel("Plain action")).toBe("Plain action");
    const v = lookaheadView({ title: "2701", ref: "LA-31BE8", start: START, end: END, dataDate: "2026-10-19", acts: ACTS, items: ITEMS, ...OPTS });
    expect(v).toMatch(/\| 1 \| 🔴 \*\*OVERDUE\*\* Submit delay notice/);
    expect(v).not.toMatch(/\| 1 \| Confirm start date/);
    // The data date counts when it's later than today.
    expect(lookaheadModel(START, END, ACTS, [{ action: "x", due: "2026-10-25" }], { today: "2026-10-21", dataDate: "2026-10-26" }).overdue.length).toBe(1);
    expect(lookaheadModel(START, END, ACTS, [{ action: "x", due: "2026-10-21" }], OPTS).overdue.length).toBe(0);
  });

  it("4. a linked item whose date differs from its CPM activity shows both dates", () => {
    const fa = m.entries.find((e) => /Fire alarm/.test(e.item.action))!;
    expect(fa.a?.id).toBe("A1130");
    expect(fa.flags.find((f) => f.kind === "date_mismatch")?.text).toBe("Item says Nov 18, 2026; schedule A1130 Underground inspection (hold point) is Nov 5, 2026. Dates don't match, check which is right");
    expect(linkedActivity({ action: "Pour slab A1110 on 2026-10-26" }, ACTS)?.id).toBe("A1110");
    expect(itemFlags({ action: "Underground inspection on 2026-11-05; request by 2026-11-02" }, ACTS[2], "2026-10-21")).toEqual([]);
  });

  it("At-Risk lines, the page and the PDF use the same model", () => {
    expect(m.risks.map(entryLine).join("\n")).toMatch(/date looks wrong/);
    const html = renderReportBody({ page: "lookahead", job_number: "2701", job_name: "Harbor", lookahead: { id: "x", start_date: START, end_date: END }, report: { found: true, version: 3, data_date: "2026-10-19", data: { activities: ACTS } } as never, items: ITEMS, today: "2026-10-21" });
    expect(html).toContain("OVERDUE");
    expect(html).toContain("DATES TO CHECK");
    expect(html).toContain("Dates don&#39;t match".replace("&#39;", html.includes("&#39;") ? "&#39;" : "'"));
    expect(html).not.toMatch(/>Confirm start date/);
    const pdf = new TextDecoder("latin1").decode(lookaheadPdf({ title: "2701", ref: "LA-31BE8", start: START, end: END, dataDate: "2026-10-19", acts: ACTS, items: ITEMS, today: "2026-10-21" }));
    expect(pdf.startsWith("%PDF")).toBe(true);
  });
});
