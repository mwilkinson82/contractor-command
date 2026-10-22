import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleProblems } from "./visible";
import { bytesToBase64, crc32, takeoffXlsx, type SheetRow } from "./estimating-sheet";
import {
  METROS,
  assembleBid,
  basisCheck,
  compoundOhp,
  describeRateChoice,
  gcLineAmount,
  priceLabor,
  priceMaterial,
  requirementGaps,
  scanProject,
  scanText,
} from "./estimating-bid";
import {
  ESTIMATE_SERVER_RULE,
  REQUIREMENT_OPEN_LIST,
  renderGaps,
  renderTakeoff,
  settle,
  prepareLines,
} from "./estimating";

describe("labor, markup, and the basis", () => {
  it("computes labor dollars from production and an hourly rate", () => {
    const row = priceLabor(100, "SF", {
      ref: "T-1",
      production_per_man_hour: 25,
      hourly_rate: 80,
      confirmed: true,
    });
    expect(row.manHours).toBe(4);
    expect(row.labor).toBe(320);
    expect(row.math).toContain("$320.00");
    expect(row.math).toContain("Confirmed by the contractor");
    expect(row.placeholder).toBe(false);
  });

  it("labels an unconfirmed rate PLACEHOLDER and does not assume a day length", () => {
    const row = priceLabor(8, "EA", { ref: "T-2", man_hours: 8, crew_size: 4, crew_rate: 200 });
    expect(row.labor).toBe(400);
    expect(row.manDays).toBeNull();
    expect(row.math).toContain("PLACEHOLDER");
    expect(row.math).not.toMatch(/8 hours in a day|typical/i);
  });

  it("compounds 10 and 10 into 21 percent", () => {
    const ohp = compoundOhp(1000, 10, 10);
    expect(ohp.overhead).toBe(100);
    expect(ohp.profit).toBe(110);
    expect(ohp.total).toBe(1210);
    expect(ohp.effectivePct).toBe(21);
  });

  it("marks a sub quote high or low against the labor plus material basis", () => {
    expect(basisCheck(1000, 500, 1800).flag).toBe("high");
    expect(basisCheck(1000, 500, 1800).line).toContain("Holds the bid");
    expect(basisCheck(1000, 500, 1200).flag).toBe("low");
    expect(basisCheck(1000, null, 1200).flag).toBe("open");
  });

  it("leaves supervision blank until the schedule duration is known", () => {
    const open = gcLineAmount({ key: "supervision", rate: 1500 });
    expect(open.amount).toBeNull();
    expect(open.missing).toBe("schedule duration");
    const priced = gcLineAmount({ key: "supervision", rate: 1500, duration: 10, confirmed: true });
    expect(priced.amount).toBe(15000);
    expect(priced.math).toContain("$15,000.00");
  });
});

describe("rate references and special requirements", () => {
  it("names the metros and refuses to ship a published factor", () => {
    expect(METROS).toEqual([
      "NYC",
      "Chicago",
      "Miami",
      "Austin",
      "Dallas",
      "LA",
      "SF",
      "Boston",
      "Philly",
      "DC",
    ]);
    const src = readFileSync("src/lib/mcp/estimating-bid.ts", "utf8");
    expect(src).not.toMatch(/NYC[^\\n]{0,40}\d/);
    const line = describeRateChoice({
      source: "rsmeans",
      carry: true,
      metro: "NYC",
      location_factor: 1.1,
      confirmed: false,
    });
    expect(line).toContain("PLACEHOLDER");
    expect(line).toContain("Not a published index");
    expect(priceMaterial(10, 12.5, false).math).toContain("PLACEHOLDER");
  });

  it("cites a sheet, a spec section, or a contract clause and keeps the item out of labor", () => {
    const hits = scanProject({
      setup: {
        role: "gc",
        trades: ["03 Concrete"],
        bid_due: null,
        delivery_method: null,
        documents: [],
        sub_bids: [],
        workbook_note: null,
        in_scope: [],
        out_scope: [],
        assumptions: [],
        doc_review: {
          sheets: [
            {
              sheet: "L-101",
              title: "Landscape",
              notes: ["Protect trees. Arborist report required before demolition."],
            },
          ],
          specs: [
            {
              section: "01 45 33",
              title: "Special inspections",
              part3: "Special inspections are required for structural steel.",
            },
          ],
          pairs: [],
        },
        summary_version: null,
      },
      clauses: [
        {
          section: "6.2",
          verbatim_text: "Contractor shall provide site security for the duration of the work.",
        },
      ],
    });
    expect(hits.map((h) => h.kind).sort()).toEqual(["arborist", "security", "testing"]);
    const arbor = hits.find((h) => h.kind === "arborist")!;
    expect(arbor.sourceType).toBe("sheet");
    expect(arbor.sourceRef).toBe("L-101");
    expect(arbor.citation.toLowerCase()).toContain("arborist");
    const gaps = requirementGaps(hits, "gc");
    expect(gaps.every((g) => g.reasoning.includes("labor and material"))).toBe(true);
    expect(gaps.find((g) => g.title === "Arborist")!.sheet).toBe("L-101");
    expect(gaps.find((g) => g.title === "Security")!.reasoning).toContain("6.2");
    expect(scanText("no requirements here", "spec", "01 00 00")).toEqual([]);
  });

  it("accepts a requirement outside the examples, including other with a description", () => {
    const hits = scanProject({
      setup: null,
      findings: [
        {
          title: "Dewatering",
          kind: "dewatering",
          description: "Continuous dewatering of the excavation",
          source_type: "spec",
          source_ref: "31 23 19",
          citation: "Provide continuous dewatering for the duration of excavation.",
        },
        {
          title: "Street work",
          kind: "other",
          description: "Flagger for the street closure",
          source_type: "contract",
          source_ref: "8.4",
          citation: "Contractor shall furnish flaggers during the street closure.",
        },
      ],
    });
    expect(hits.map((h) => h.kind).sort()).toEqual(["dewatering", "other"]);
    expect(hits.find((h) => h.kind === "other")!.label).toBe("Flagger for the street closure");
    const gaps = requirementGaps(hits, "self_performer");
    expect(gaps.map((g) => g.title).sort()).toEqual([
      "Dewatering",
      "Flagger for the street closure",
    ]);
    expect(gaps.every((g) => g.reasoning.includes("installation labor and material"))).toBe(true);
    expect(gaps.find((g) => g.title === "Dewatering")!.spec_section).toBe("31 23 19");
    expect(() =>
      scanProject({
        setup: null,
        findings: [
          {
            title: "Misc",
            kind: "other",
            source_type: "sheet",
            source_ref: "G-001",
            citation: "See note.",
          },
        ],
      }),
    ).toThrow(/other needs a description/);
  });

  it("puts special requirements on their own line in the bid summary", () => {
    const bid = assembleBid({
      direct: 1000,
      directPlaceholder: false,
      gc: [{ label: "Trailer", amount: 200, placeholder: false, risk: false, note: "" }],
      requirements: [
        {
          ref: "R-1",
          kind: "arborist",
          label: "Arborist",
          sourceType: "sheet",
          sourceRef: "L-101",
          citation: "Arborist report required.",
          description: null,
          placement: "own_line",
          amount: 500,
          confirmed: true,
          excluded: false,
        },
      ],
      overheadPct: 10,
      profitPct: 5,
      settled: true,
    });
    expect(bid.lines.join("\n")).toContain("Direct cost");
    expect(bid.lines.join("\n")).toContain("General conditions");
    expect(bid.lines.join("\n")).toContain("Arborist (R-1)");
    expect(bid.lines.join("\n")).toContain("Sheet L-101");
    // base 1000+200+500 = 1700; oh 170; profit 5% of 1870 = 93.5; total 1963.5
    expect(bid.total).toBe(1963.5);
    expect(bid.ready).toBe(true);
    const open = assembleBid({
      ...{
        direct: 1000,
        directPlaceholder: false,
        gc: [],
        requirements: [
          {
            ref: "R-1",
            kind: "permits",
            label: "Permits",
            description: null,
            sourceType: "spec",
            sourceRef: "01 41 00",
            citation: "Permits by contractor.",
            placement: "own_line",
            amount: null,
            confirmed: false,
            excluded: false,
          },
        ],
        overheadPct: 10,
        profitPct: 10,
        settled: true,
      },
    });
    expect(open.ready).toBe(false);
    expect(open.lines.join("\n")).toContain("Not a bid yet");
    expect(open.lines.join("\n")).toContain("Holds the bid");
  });
});

describe("takeoff card and workbook", () => {
  it("groups the takeoff and writes an xlsx", () => {
    const lines = prepareLines([
      {
        item: "Slab on grade",
        sheet: "A-099",
        unit: "SF",
        basis: "measured",
        value: 100,
        trade: "03 Concrete",
        line_no: 1,
      },
      {
        item: "Footing depth",
        sheet: "S3.1",
        unit: "ft",
        basis: "measured",
        missing_input: "footing depth",
        trade: "03 Concrete",
        line_no: 2,
      },
    ]);
    const state = settle(lines, [], [], { role: "gc", trades: ["03 Concrete"] });
    const view = renderTakeoff(
      "2701 – Crystal",
      lines,
      state,
      "Revision used: not stated. No addendum is on file.",
    );
    expect(view.text).toContain("Takeoff card");
    expect(view.text).toContain("03 Concrete");
    expect(view.text).toContain("MEASURED");
    expect(view.text).toContain("Verify");
    expect(view.text).toContain("group,item,unit,qty,basis,verify");
    expect(visibleProblems(view.text)).toEqual([]);
    const bytes = takeoffXlsx(
      (view.structured.spreadsheet as { grouped_csv: string }).grouped_csv ? sheetRows() : [],
    );
    const raw = Uint8Array.from(
      atob((view.structured.spreadsheet as { xlsx_base64: string }).xlsx_base64),
      (c) => c.charCodeAt(0),
    );
    expect(String.fromCharCode(raw[0], raw[1])).toBe("PK");
    expect(new TextDecoder().decode(raw)).toContain("Footing depth");
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    expect(bytes.byteLength).toBeGreaterThan(10);
  });
});

function sheetRows(): SheetRow[] {
  return [];
}

describe("migration", () => {
  it("only adds bid tables and functions", () => {
    const sql = readFileSync(
      "supabase/migrations/20261022230000_athena_estimating_bid.sql",
      "utf8",
    );
    for (const table of [
      "mcp_estimate_pricing",
      "mcp_estimate_general_conditions",
      "mcp_estimate_requirements",
      "mcp_estimate_bids",
    ])
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    expect(sql).toContain("mcp_job_scope(job_id) IN ('full', 'contract')");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b|\bALTER\s+TABLE\s+public\.mcp_estimate_takeoff/i);
    expect(sql).not.toMatch(/fragment/i);
    expect(sql).not.toMatch(/kind IN \('consultants'/);
    expect(sql).toContain("length(btrim(kind)) BETWEEN 1 AND 80");
    expect(sql).toContain("description text");
    expect(ESTIMATE_SERVER_RULE).toContain(REQUIREMENT_OPEN_LIST);
    expect(REQUIREMENT_OPEN_LIST).toContain("Look beyond the examples");
  });
});
