import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleProblems } from "./visible";
import {
  BAR_LB_PER_LF,
  ESTIMATE_LOGO_URL,
  ESTIMATE_SERVER_RULE,
  ESTIMATE_VIEW_SPEC,
  EstimateError,
  accountTakeoffLines,
  assignGapRefs,
  alignGapsToTakeoff,
  autoGaps,
  foundationGapPrompts,
  preserveGapList,
  basisLabel,
  buildSummary,
  checkBids,
  coverageLine,
  intakeQuestions,
  mergeTakeoffLines,
  prepareGap,
  rejectPlaceholderLines,
  reuseWarning,
  FOUNDATION_CHECKLIST,
  NOT_RELEVANT_ASK,
  conventionFor,
  normalizeInputName,
  normalizeScale,
  normalizeSchedules,
  prepareLine,
  prepareLines,
  renderBidCheck,
  renderExport,
  renderIntake,
  renderSummary,
  renderTakeoff,
  settle,
  toBasis,
  type StoredLine,
  type StoredVerdict,
} from "./estimating";

const sheet = "S3.1";
const base = {
  item: "F9.0 contact area",
  sheet,
  detail: "S2.0",
  unit: "SF",
  basis: "derived" as const,
};

function line(over: Parameters<typeof prepareLine>[0]): StoredLine {
  const [row] = prepareLines([{ line_no: 1, ...over }]);
  return row;
}
const problems = (text: string) => visibleProblems(text);

describe("quantity labels and math", () => {
  it("maps READ to MEASURED and DERIVED to DEDUCED", () => {
    expect(toBasis("READ")).toBe("measured");
    expect(toBasis("derived")).toBe("deduced");
    expect(basisLabel("measured")).toBe("MEASURED");
    expect(basisLabel("deduced")).toBe("DEDUCED");
  });

  it("computes a contact area and shows the math and the sheet", () => {
    const row = line({
      ...base,
      op: "product",
      inputs: [
        { name: "length", value: 9, unit: "ft" },
        { name: "height", value: 1.5, unit: "ft" },
        { name: "sides", value: 4, unit: "EA" },
      ],
    });
    expect(row.basis).toBe("deduced");
    expect(row.qty).toBe(54);
    expect(row.math).toContain("9 × 1.5 × 4 = 54");
    expect(row.math).toContain("S3.1");
    expect(row.math).toContain("DEDUCED");
  });

  it("computes slab concrete the way the Tamiami line does", () => {
    const row = line({
      item: "Slab on grade concrete neat",
      sheet: "A-099",
      detail: "S3.1",
      unit: "CY",
      basis: "DERIVED",
      op: "cy_from_area",
      inputs: [
        { name: "area", value: 13596.78, unit: "SF" },
        { name: "thickness", value: 4, unit: "in" },
      ],
    });
    expect(row.qty).toBe(167.86);
    expect(row.math).toContain("13596.78 SF × 4 in / 12 / 27 = 167.86 CY");
  });

  it("reads a fill depth in feet as feet, not inches", () => {
    const row = line({
      item: "Structural fill",
      sheet: "C-101",
      unit: "CY",
      basis: "deduced",
      op: "cy_from_area",
      inputs: [
        { name: "area", value: 2338.2, unit: "SF" },
        { name: "fill depth", value: 1, unit: "ft" },
      ],
    });
    expect(row.qty).toBe(86.6);
    expect(row.math).toContain("2338.2 SF × 1 ft / 27 = 86.6 CY");
    expect(row.math).not.toContain("/ 12 / 27");
    const named = line({
      item: "Structural fill",
      sheet: "C-101",
      unit: "CY",
      basis: "deduced",
      op: "cy_from_area",
      inputs: [
        { name: "area", value: 2338.2, unit: "SF" },
        { name: "fill depth ft", value: 1 },
      ],
    });
    expect(named.qty).toBe(86.6);
  });

  it("uses the published bar weight", () => {
    expect(BAR_LB_PER_LF["6"]).toBe(1.502);
    const row = line({
      item: "#6 bar",
      sheet: "S2.0",
      unit: "LB",
      basis: "deduced",
      op: "rebar_lb",
      bar_size: "6",
      inputs: [{ name: "bar length", value: 100, unit: "LF" }],
    });
    expect(row.qty).toBe(150.2);
    expect(row.math).toContain("published bar weight");
  });

  it("leaves a blank only when one named input is missing", () => {
    const row = line({
      ...base,
      op: "product",
      inputs: [
        { name: "length", value: 9 },
        { name: "height", value: null },
        { name: "sides", value: 4 },
      ],
    });
    expect(row.qty).toBeNull();
    expect(row.missing_input).toBe("height");
    expect(row.math).toContain("The one missing input is height");
    expect(() =>
      prepareLine({
        ...base,
        op: "product",
        inputs: [
          { name: "length", value: null },
          { name: "height", value: null },
        ],
      }),
    ).toThrow(/only one/);
  });

  it("rejects a vendor note as the reason for a blank", () => {
    expect(() =>
      prepareLine({ ...base, basis: "measured", missing_input: "confirm with vendor" }),
    ).toThrow(EstimateError);
    expect(() =>
      prepareLine({ ...base, basis: "measured", missing_input: "shop drawing" }),
    ).toThrow(/shop-drawing/);
  });

  it("keeps a measured value and forces a scaled length to low confidence", () => {
    const read = line({
      item: "Elevated slab",
      sheet: "A-020",
      unit: "SF",
      basis: "read",
      value: 19220,
    });
    expect(read.basis).toBe("measured");
    expect(read.qty).toBe(19220);
    expect(read.math).toContain("MEASURED");
    const scaled = line({
      item: "Footing centerline",
      sheet: "S3.1",
      unit: "LF",
      basis: "deduced",
      op: "scale",
      value: 120,
      scale: "1/8 inch = 1 foot",
      method: "scaled along the footing line",
      range: "±5%",
      confidence: "high",
    });
    expect(scaled.confidence).toBe("low");
    expect(scaled.qty).toBe(120);
    expect(scaled.math).toContain("1/8 inch = 1 foot");
  });

  it("nets a slab and does not trust a sent figure that disagrees", () => {
    const row = line({
      item: "Net slab",
      sheet: "A-099",
      unit: "SF",
      basis: "deduced",
      op: "net",
      value: 1,
      inputs: [
        { name: "gross", value: 1000 },
        { name: "trench", value: 40 },
        { name: "pit", value: 12 },
      ],
    });
    expect(row.qty).toBe(948);
    expect(row.math).toContain("does not match the math");
    expect(row.note).toBeNull();
  });
});

describe("coverage, gaps, bids, summary", () => {
  const lines = prepareLines([
    {
      ...base,
      line_no: 1,
      op: "product",
      inputs: [
        { name: "length", value: 9 },
        { name: "height", value: 1.5 },
        { name: "sides", value: 4 },
      ],
    },
    {
      item: "Footing depth",
      sheet: "S3.1",
      unit: "ft",
      basis: "measured",
      missing_input: "footing depth",
      line_no: 2,
    },
  ]);

  it("puts the coverage line in the takeoff text", () => {
    expect(coverageLine(lines)).toBe(
      "Quantified 1 of 2 lines (0 MEASURED, 1 DEDUCED, of which 0 low-confidence); 1 blank, each naming its missing input (Footing depth: footing depth).",
    );
    const state = settle(lines, [], [], { role: "self_performer", trades: ["03 Concrete"] });
    const view = renderTakeoff(
      "2701 – Crystal",
      lines,
      state,
      "Revision used: not stated. No addendum is on file.",
    );
    expect(view.text).toContain("MEASURED");
    expect(view.text).toContain("DEDUCED");
    expect(view.text).toContain("landscape");
    expect(view.text).toContain(ESTIMATE_LOGO_URL);
    expect(view.text).toContain("top right");
    expect(view.structured.layout).toMatchObject({ orientation: "landscape", page: "17x11" });
    expect(problems(view.text)).toEqual([]);
    expect(state.settled).toBe(false);
  });

  it("cites the sheet and the spec, and flags what the estimator must verify", () => {
    const gap = prepareGap(
      {
        kind: "verify",
        category: "missing_on_drawings",
        title: "Exam room insulation",
        reasoning:
          "Spec 09 21 16 calls for an STC 50 assembly at the exam rooms; A-501 wall type W3 doesn't show the insulation. Verify.",
        sheet: "A-501",
        detail: "W3",
        spec_section: "09 21 16",
      },
      "G-1",
    );
    expect(gap.holds_bid).toBe(true);
    expect(gap.reasoning).toContain("A-501");
    expect(gap.reasoning).toContain("09 21 16");
    const cited = autoGaps(lines, [
      {
        spec_section: "03 30 00",
        requirement: "vapor barrier",
        sheet: "S3.1",
        drawing_shows: null,
      },
    ]);
    expect(cited.some((g) => g.reasoning.includes("footing depth") && g.sheet === "S3.1")).toBe(
      true,
    );
    expect(cited.some((g) => g.spec_section === "03 30 00" && g.reasoning.includes("Verify"))).toBe(
      true,
    );
  });

  it("keeps a stable gap number", () => {
    const [again] = assignGapRefs(
      [{ ref: "G-4", title: "Exam room insulation", sheet: "A-501", spec_section: "09 21 16" }],
      [
        {
          kind: "verify",
          category: "conflict",
          title: "Exam room insulation",
          reasoning: "Still open.",
          sheet: "A-501",
          spec_section: "09 21 16",
        },
      ],
    );
    expect(again.ref).toBe("G-4");
  });

  it("checks a sub bid and does not send the questions", () => {
    const takeoff = prepareLines([
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
        item: "Isolated footings",
        sheet: "S3.1",
        unit: "EA",
        basis: "measured",
        value: 8,
        trade: "03 Concrete",
        line_no: 2,
      },
    ]);
    const result = checkBids(
      [
        {
          sub: "Acme Concrete",
          trade: "03 Concrete",
          total: 1000,
          lines: [
            {
              description: "Slab on grade",
              qty: 100,
              unit: "SF",
              amount: 800,
              exclusion: "excludes vapor barrier",
            },
            { description: "Roofing", qty: 1, unit: "LS", amount: 50, exclusion: null },
          ],
        },
      ],
      takeoff,
    );
    expect(result.rows.map((r) => r.status).sort()).toEqual(["covered", "extra", "missing"]);
    expect(result.totals[0].line).toContain("Doesn't tie: off by");
    expect(result.questions.length).toBeGreaterThan(0);
    const view = renderBidCheck("2701 – Crystal", "gc", result, null);
    expect(view.text).toContain("Not sent.");
    expect(view.text).not.toMatch(/\b(e-?mail|draft)\b/i);
    expect(problems(view.text)).toEqual([]);
  });

  it("prices only settled quantities and only with a rate the contractor sent", () => {
    const takeoff = prepareLines([
      {
        item: "Slab on grade",
        sheet: "A-099",
        unit: "SF",
        basis: "measured",
        value: 10,
        checklist_key: "sg",
        line_no: 1,
      },
    ]);
    const open = settle(takeoff, [], [], { role: "self_performer", trades: ["03 Concrete"] });
    expect(open.settled).toBe(false);
    const draft = renderSummary(
      "2701 – Crystal",
      open,
      [{ line_no: 1, rate: 12.5, cost_type: "material", bought: false }],
      "Revision used: not stated.",
    );
    expect(draft.text).toMatch(/draft/i);
    expect(draft.text).toContain("Open gaps");
    expect(draft.text).toContain("Under-slab insulation");
    expect(draft.structured.draft).toBe(true);
    const verdicts: StoredVerdict[] = [];
    const closedLines = prepareLines([
      ...CONCRETE.map((key, i) => ({
        item: key,
        sheet: "S3.1",
        unit: "EA",
        basis: "measured" as const,
        value: 1,
        checklist_key: key,
        line_no: i + 1,
      })),
      ...FOUNDATION_CHECKLIST.map((row, i) => ({
        item: row.label,
        sheet: "S3.1",
        unit: row.unit,
        basis: "measured" as const,
        exclusion: "N/A for this check.",
        checklist_key: row.key,
        line_no: 100 + i,
      })),
    ]);
    const closed = settle(closedLines, [], verdicts, {
      role: "self_performer",
      trades: ["03 Concrete"],
    });
    expect(closed.settled).toBe(true);
    const summary = renderSummary(
      "2701 – Crystal",
      closed,
      [{ line_no: 1, rate: 12.5, cost_type: "material", bought: false, trade: "03 Concrete" }],
      "Revision used: Addendum 1.",
    );
    expect(summary.text).toContain("Estimate Summary");
    expect(summary.text).toContain("$12.50");
    expect(summary.text).toContain("Rate needed");
    expect(summary.text).not.toMatch(/typical/i);
    expect(summary.text).toContain("General conditions");
    expect(summary.structured.layout).toMatchObject({
      logo: { position: "top-right", url: ESTIMATE_LOGO_URL },
    });
    const pdf = Buffer.from(String(summary.structured.pdf_base64), "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 1224");
    const slab = prepareLines([{ ...base, item: "Slab on grade", basis: "measured", value: 100, unit: "SF" }])[0];
    expect(slab.math).toContain("Slab area: net");
    expect(problems(summary.text)).toEqual([]);
    const built = buildSummary(closed.items, []);
    expect(built.rows.every((r) => r.rate === "Rate needed" && r.extension == null)).toBe(true);
  });

  it("drops a not-relevant line only as an accepted exclusion and follows up while a call is open", () => {
    const takeoff = prepareLines([
      {
        item: "Bollards",
        sheet: "A-341",
        unit: "EA",
        basis: "measured",
        missing_input: "bollard count",
        line_no: 4,
      },
    ]);
    const open = settle(
      takeoff,
      [],
      [
        {
          item_kind: "line",
          line_no: 4,
          gap_ref: null,
          item_text: "Bollards",
          mark: "relevant",
          note: null,
          corrected_qty: null,
          owner: null,
          created_at: "2026-10-21T00:00:00Z",
        },
      ],
      { role: "gc", trades: [] },
    );
    expect(open.items[0].status).toBe("open");
    expect(open.items[0].followUp).toContain("quantity or an owner");
    const dropped = settle(
      takeoff,
      [],
      [
        {
          item_kind: "line",
          line_no: 4,
          gap_ref: null,
          item_text: "Bollards",
          mark: "not_relevant",
          note: "Outside the building, per the intake.",
          corrected_qty: null,
          owner: null,
          created_at: "2026-10-21T00:00:00Z",
        },
      ],
      { role: "gc", trades: [] },
    );
    expect(dropped.items[0].status).toBe("dropped");
    expect(dropped.counts).toMatchObject({ dropped: 1, open: 0 });
  });

  it("exports blanks as empty cells", () => {
    const view = renderExport("2701 – Crystal", lines, "csv");
    expect(view.text).toContain("item,unit,qty");
    expect(view.structured.csv).toContain("Footing depth,ft,");
    expect(String(view.structured.csv)).not.toContain("Footing depth,ft,0");
    expect(
      String(view.structured.csv)
        .split("\n")
        .every((l) => l.trim().length > 0),
    ).toBe(true);
  });

  it("lists self-performer coordination as questions, not quantities", () => {
    const view = renderIntake("2701 – Crystal", {
      role: "self_performer",
      trades: ["03 Concrete"],
      bid_due: "2026-11-01",
      delivery_method: "hard bid",
      documents: [{ name: "Addendum 1", kind: "addendum", date: "2026-10-02" }],
      sub_bids: [],
      workbook_note: null,
      in_scope: ["Foundations through slab on grade"],
      out_scope: ["Vertical work"],
      assumptions: [],
      doc_review: null,
      summary_version: null,
    });
    expect(view.text).toContain("Addenda override the base documents");
    expect(view.text).toContain("Not a quantity.");
    expect(view.text).toContain("Sleeves, blockouts and embeds");
    expect(problems(view.text)).toEqual([]);
  });
});

const CONCRETE = ["cf", "if", "fs", "fr", "fd", "tp", "cp", "ts", "td", "sg", "us", "ew"] as const;

describe("engine conventions", () => {
  it("normalizes schedules, scales and input names, and rejects a blank", () => {
    expect(normalizeSchedules(["Door schedule", { name: "Footings", items: ["F-1"] }])).toEqual([
      "Door schedule",
      "Footings: F-1",
    ]);
    expect(normalizeScale({ value: "1/8 inch = 1 foot" })).toBe("1/8 inch = 1 foot");
    expect(normalizeInputName(4)).toBe("4");
    expect(() => normalizeSchedules([{ items: ["only"] }])).toThrow(/needs a name/);
    expect(() => normalizeScale("")).toThrow(/title block/);
    expect(() => normalizeInputName("")).toThrow(/needs a name/);
  });

  it("states one form face by default and keeps rebar in LF and LB", () => {
    const forms = prepareLines(
      [
        {
          item: "Trench forms",
          sheet: "S-103",
          unit: "SFCA",
          basis: "derived",
          op: "product",
          inputs: [
            { name: "length", value: 111.5 },
            { name: "height", value: 3.167 },
          ],
          line_no: 1,
        },
      ],
      conventionFor("as_drawn"),
    )[0];
    expect(forms.math).toContain("Forms faces: 1");
    expect(forms.math).toContain("earth side is not formed");
    const both = prepareLines([
      {
        item: "Trench forms",
        sheet: "S-103",
        unit: "SFCA",
        basis: "derived",
        op: "product",
        forms_faces: 2,
        inputs: [
          { name: "length", value: 10 },
          { name: "height", value: 2 },
        ],
        line_no: 1,
      },
    ])[0];
    expect(both.math).toContain("Forms faces: 2");
    expect(both.qty).toBe(40);
    const fromProfile = prepareLines(
      [
        {
          item: "Footing forms",
          sheet: "S-101",
          unit: "SF",
          basis: "measured",
          value: 446,
          line_no: 1,
        },
      ],
      conventionFor("estimator", 2),
    )[0];
    expect(fromProfile.qty).toBe(892);
    expect(fromProfile.math).toContain("both faces");
    expect(fromProfile.math).toContain("446");
    const already = prepareLines(
      [
        {
          item: "Wall forms",
          sheet: "S-103",
          unit: "SFCA",
          basis: "derived",
          op: "product",
          forms_faces: 2,
          note: "both faces",
          inputs: [
            { name: "length", value: 100 },
            { name: "height", value: 4 },
            { name: "faces", value: 2 },
          ],
          line_no: 1,
        },
      ],
      conventionFor("estimator", 2),
    )[0];
    expect(already.qty).toBe(800);
    expect(already.math).toContain("already in this quantity");
    expect(already.math).not.toContain("One face was");
  });

  it("uses gross termite area, follows the estimator profile, and rejects LF sent as CF", () => {
    const termite = prepareLines(
      [
        {
          item: "Termite treatment",
          sheet: "S-100",
          unit: "SF",
          basis: "measured",
          value: 4668,
          line_no: 1,
        },
      ],
      conventionFor("estimator"),
    )[0];
    expect(termite.math).toContain("gross area");
    expect(termite.math).toContain("perimeter in LF");
    expect(() =>
      prepareLines([
        {
          item: "Termite treatment",
          sheet: "S-100",
          unit: "SF",
          basis: "measured",
          value: 100,
          area_basis: "net",
          line_no: 1,
        },
      ]),
    ).toThrow(/gross/);
    expect(() =>
      prepareLines([
        {
          item: "Keyway",
          sheet: "S-103",
          unit: "LF",
          basis: "measured",
          value: 18,
          measure_type: "volume",
          line_no: 1,
        },
      ]),
    ).toThrow(/LF can't be given as CF/);
    expect(() =>
      prepareLines([
        {
          item: "Footing rebar",
          sheet: "S-100",
          unit: "LB",
          basis: "measured",
          value: 100,
          line_no: 1,
        },
      ]),
    ).toThrow(/LF alongside/);
  });

  it("asks for the not-relevant reason in the same turn", () => {
    expect(NOT_RELEVANT_ASK).toContain("this same turn");
    expect(NOT_RELEVANT_ASK).toContain("Why is this not relevant");
  });
});

const blankSetup = {
  role: null,
  trades: [] as string[],
  bid_due: null,
  delivery_method: null,
  documents: [],
  sub_bids: [],
  workbook_note: null,
  in_scope: [] as string[],
  out_scope: [] as string[],
  assumptions: [] as string[],
  doc_review: null,
  summary_version: null,
};

describe("intake reuse and takeoff save mode", () => {
  it("warns when a takeoff already exists and stays quiet when it does not", () => {
    const hit = reuseWarning({
      jobNumber: "2701",
      jobName: "Crystal",
      lines: 4,
      version: 2,
      sameName: [{ jobNumber: "2700", jobName: "Crystal" }],
    });
    expect(hit).toContain("already has a takeoff");
    expect(hit).toContain("Reuse that takeoff, or start fresh?");
    expect(hit).toContain("Nothing was saved.");
    expect(hit).toContain("2700");
    expect(
      reuseWarning({
        jobNumber: "2701",
        jobName: "Crystal",
        lines: 0,
        version: null,
        sameName: [],
      }),
    ).toBeNull();
  });

  it("asks scope, role and profile, and does not assume self-performer", () => {
    expect(intakeQuestions({ role: null, trades: [], in_scope: [], profile: null })).toHaveLength(
      4,
    );
    expect(
      intakeQuestions({
        role: "gc",
        trades: ["03 Concrete"],
        in_scope: [],
        profile: "as_drawn",
        forms_faces: 1,
      }),
    ).toEqual([]);
    expect(intakeQuestions({ role: "gc", trades: ["03"], in_scope: [], profile: "as_drawn" }).join(" ")).toContain(
      "one face or both faces",
    );
    const view = renderIntake("2701 – Crystal", blankSetup, null);
    expect(view.text).toContain("Intake is not complete.");
    expect(view.text).toContain("general contractor or a self-performer");
    expect(view.text).toContain("What is in your scope");
    expect(view.text).toContain("as drawn, or the estimator key");
    expect(view.text).toContain("Role: Not answered");
    expect(view.text).not.toContain("Self-performer");
    expect(view.structured.complete).toBe(false);
    expect(problems(view.text)).toEqual([]);
    const done = renderIntake(
      "2701 – Crystal",
      { ...blankSetup, role: "gc", trades: ["03 Concrete"] },
      "estimator",
      1,
    );
    expect(done.text).toContain("Intake is complete.");
    expect(done.structured.complete).toBe(true);
  });

  it("rejects placeholder lines and merges an upsert by item", () => {
    for (const item of ["TEMP footing", "A placeholder", "test line", "Do not use"])
      expect(() => rejectPlaceholderLines([{ item }])).toThrow(/Nothing was saved/);
    expect(() => rejectPlaceholderLines([{ item: "Footing concrete" }])).not.toThrow();
    const prior = prepareLines([
      { ...base, line_no: 1, item: "Slab", basis: "measured", value: 10, unit: "SF" },
      { ...base, line_no: 2, item: "Wall", basis: "measured", value: 20, unit: "SF" },
    ]);
    const incoming = prepareLines([
      { ...base, line_no: 1, item: "Slab", basis: "measured", value: 12, unit: "SF" },
    ]);
    const merged = mergeTakeoffLines(prior, incoming, [false]);
    expect(merged).toHaveLength(2);
    expect(merged.find((l) => l.item === "Slab")?.qty).toBe(12);
    expect(merged.find((l) => l.item === "Wall")?.qty).toBe(20);
  });

  it("prints basis, sheet and math on each takeoff line", () => {
    const lines = prepareLines([
      {
        ...base,
        line_no: 1,
        op: "product",
        inputs: [
          { name: "length", value: 10 },
          { name: "width", value: 4 },
        ],
      },
    ]);
    const state = settle(lines, [], [], { role: "gc", trades: [] });
    const view = renderTakeoff(
      "2701 – Crystal",
      lines,
      state,
      "Revision used: not stated.",
      "upsert",
    );
    expect(view.text).toContain("This save added or updated lines.");
    expect(view.text).toContain("DEDUCED");
    expect(view.text).toContain("Sheet S3.1");
    expect(view.text).toContain("Math:");
    expect(view.text).toMatch(/Each line[\s\S]*DEDUCED[\s\S]*Sheet S3\.1[\s\S]*Math:/);
    const replaced = renderTakeoff(
      "2701 – Crystal",
      lines,
      state,
      "Revision used: not stated.",
      "replace",
    );
    expect(replaced.text).toContain("This save replaced the takeoff.");
    expect(problems(view.text)).toEqual([]);
  });

  it("gives every submitted line its own status and keeps the saved badge", () => {
    const account = accountTakeoffLines([
      { ...base, line_no: 1, item: "Continuous footing", basis: "measured", value: 12, unit: "LF" },
      { ...base, line_no: 2, item: "Slab", basis: "measured", value: -2, unit: "SF" },
    ]);
    expect(account.saved).toBe(1);
    expect(account.rejected).toHaveLength(1);
    expect(account.statuses[0].status).toMatch(/^Saved\./);
    expect(account.statuses[0].status).toMatch(/MEASURED/);
    expect(account.statuses[1].status).toMatch(/^Rejected\./);
    expect(account.statuses[1].status).toMatch(/zero or more/);
    const view = renderTakeoff("CCW-005 – Shop", account.lines, settle(account.lines, [], [], { role: "gc", trades: [] }), "Revision used: not stated.", "upsert", account);
    expect(view.text).toContain("1 of 2 saved");
    expect(view.text).toContain("Line 1 (Continuous footing): Saved.");
    expect(view.text).toContain("Line 2 (Slab): Rejected.");
    expect(view.structured.line_statuses).toEqual([
      expect.objectContaining({ item: "Continuous footing", outcome: "Saved" }),
      expect.objectContaining({ item: "Slab", outcome: "Rejected" }),
    ]);
    expect(problems(view.text)).toEqual([]);
  });

  it("accounts for every line in a 92-line save, including null quantities and repeated names", () => {
    const rows = Array.from({ length: 92 }, (_, i) => {
      const hold = i < 13;
      return {
        ...base,
        item: hold ? `Hold ${i % 4}` : i % 2 === 0 ? "Footing" : "Slab",
        sheet: `S-${i + 1}`,
        basis: "measured" as const,
        value: hold ? null : i + 1,
        unit: "SF",
        method: hold ? "HOLD" : undefined,
      };
    });
    const account = accountTakeoffLines(rows);
    expect(account.sent).toBe(92);
    expect(account.saved + account.rejected.length).toBe(92);
    expect(account.saved).toBe(92);
    expect(account.rejected).toEqual([]);
    expect(account.lines).toHaveLength(92);
    const holds = account.lines.filter((l) => l.qty == null);
    expect(holds).toHaveLength(13);
    expect(holds.every((l) => l.missing_input === "quantity pending" && l.math.includes("HOLD"))).toBe(true);
    const view = renderTakeoff("2701 – Crystal", account.lines, settle(account.lines, [], [], { role: "gc", trades: [] }), "Revision used: not stated.", "replace", account);
    expect(view.text).toContain("Sent 92. Saved 92. Rejected 0.");
    const bad = accountTakeoffLines([
      ...rows.slice(0, 91),
      { ...base, item: "Bad wall", sheet: "S-9", basis: "measured", value: -3, unit: "SF", line_no: 92 },
    ]);
    expect(bad.sent).toBe(92);
    expect(bad.saved + bad.rejected.length).toBe(92);
    expect(bad.rejected).toEqual([expect.objectContaining({ line_no: 92, item: "Bad wall" })]);
    expect(bad.rejected[0].reason).toMatch(/zero or more/);
  });

  it("keeps gap numbers when a mark is saved again", () => {
    const prior = [
      { ref: "G-4", kind: "verify" as const, category: "scope_seam" as const, severity: "hard" as const, title: "Keyway", reasoning: "Missing.", sheet: "S-1", detail: null, spec_section: "foundation", holds_bid: true, qty: null, unit: null, element: null, line_no: null },
    ];
    const again = preserveGapList(prior, [
      { kind: "verify", category: "scope_seam", title: "Keyway", reasoning: "Still missing.", sheet: "S-1", spec_section: "foundation" },
    ]);
    expect(again.map((g) => g.ref)).toEqual(["G-4"]);
    expect(again).toHaveLength(1);
  });

  it("flags the foundation scope when it is not taken off", () => {
    const prompts = foundationGapPrompts([]);
    for (const name of ["Slab edge forms", "Keyway", "Dowels", "Under-slab insulation", "Termite treatment", "Fine grade", "Trench base"])
      expect(prompts.map((g) => g.title)).toContain(name);
    const closed = foundationGapPrompts(
      FOUNDATION_CHECKLIST.map((row, i) => ({
        line_no: i + 1,
        item: row.label,
        material: null,
        qty: 1,
        unit: row.unit,
        range_text: null,
        measure_type: null,
        sheet: "S-1",
        detail: null,
        spec_section: null,
        basis: "measured" as const,
        math: "MEASURED",
        confidence: "high" as const,
        markup_ref: null,
        location_text: null,
        missing_input: null,
        exclusion: null,
        checklist_key: row.key,
        element: null,
        trade: null,
        note: null,
        inputs: [],
      })),
    );
    expect(closed).toEqual([]);
  });

  it("does not flag a line already on the takeoff, and cites that line's sheet", () => {
    const row = (
      item: string,
      sheet: string,
      qty: number | null,
    ): StoredLine => ({
      line_no: 1,
      item,
      material: null,
      qty,
      unit: "SF",
      range_text: null,
      measure_type: null,
      sheet,
      detail: null,
      spec_section: null,
      basis: "measured",
      math: qty == null ? "HOLD" : "MEASURED",
      confidence: "high",
      markup_ref: null,
      location_text: null,
      missing_input: qty == null ? "length" : null,
      exclusion: null,
      checklist_key: null,
      element: null,
      trade: null,
      note: null,
      inputs: [],
    });
    const lines = [
      row("Slab on grade", "S-100", 10),
      row("Fine grade", "C-200", 5000),
      row("Keyway", "S-9", null),
    ];
    const prompts = foundationGapPrompts(lines);
    expect(prompts.map((g) => g.title)).not.toContain("Fine grade");
    expect(prompts.find((g) => g.title === "Keyway")?.sheet).toBe("S-9");
    const gaps = alignGapsToTakeoff(
      [
        {
          title: "Fine grade",
          reasoning: "Called missing on S-100.",
          sheet: "S-100",
        },
        {
          title: "Keyway",
          reasoning: "Cited on S-100.",
          sheet: "S-100",
        },
      ],
      lines,
    );
    expect(gaps.map((g) => g.title)).toEqual(["Keyway"]);
    expect(gaps[0].sheet).toBe("S-9");
    expect(gaps[0].reasoning).toContain("S-9");
    expect(gaps[0].reasoning).not.toContain("S-100");
  });
});

describe("wiring", () => {
  it("puts the quantity rule in the server instructions and the tool result", () => {
    expect(ESTIMATE_SERVER_RULE).toContain("MEASURED");
    expect(ESTIMATE_SERVER_RULE).toContain("DEDUCED");
    expect(ESTIMATE_SERVER_RULE).toContain("one named input");
    expect(ESTIMATE_SERVER_RULE).toContain("Estimate Summary");
    expect(ESTIMATE_SERVER_RULE).toContain("top right");
    expect(ESTIMATE_SERVER_RULE).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(ESTIMATE_SERVER_RULE).not.toMatch(/never red|fragment/i);
    const idx = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(idx).toContain("ESTIMATE_SERVER_RULE");
    expect(idx.indexOf("REFUSAL_RULE")).toBeLessThan(idx.indexOf("ESTIMATE_SERVER_RULE"));
    expect(ESTIMATE_VIEW_SPEC.join("\n")).toContain("top right");
    expect(ESTIMATE_VIEW_SPEC.join("\n")).toContain("#1E5FED");
    expect(ESTIMATE_VIEW_SPEC.join("\n")).not.toMatch(/fragment|orange #/i);
  });

  it("migration adds the estimating tables with contract-or-full RLS and no direct writes", () => {
    const sql = readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8");
    for (const table of [
      "mcp_estimate_takeoffs",
      "mcp_estimate_takeoff_lines",
      "mcp_estimate_gap_items",
      "mcp_estimate_verdicts",
    ])
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("mcp_job_scope(job_id) IN ('full', 'contract')");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("mcp_assert_active()");
    expect(sql).toContain("basis IN ('measured', 'deduced')");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b|\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/fragment/i);
  });
});
