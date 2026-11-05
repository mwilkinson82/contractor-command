import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import {
  answerProblem,
  collapseRepeats,
  columnOf,
  conditionalSentence,
  flagConditional,
  gapKey,
  nextGap,
  parseBoard,
  progress,
  stillHolds,
  walkOrder,
  type GapCheckItem,
} from "./gap-check";
import { preserveGapList, prepareGaps, settle, parseState, type GapIn } from "./estimating";
import { requirementGaps, scanText } from "./estimating-bid";
import { gapCheckSheets, gapCheckXlsx } from "../gap-check-xlsx";
import { crc32 } from "../xlsx-writer";
import { isSafeFinancialXlsx } from "./financial-xlsx";

const item = (over: Partial<GapCheckItem>): GapCheckItem => ({
  ref: "G-1",
  title: "Gap",
  reasoning: "Why",
  sheet: "E-001",
  detail: null,
  spec_section: "26 05 00",
  severity: "hard",
  category: "scope_seam",
  holds_bid: true,
  question: null,
  conditional: false,
  condition_text: null,
  exposure_low: null,
  exposure_high: null,
  schedule_activity: null,
  citations: [],
  answer: null,
  verdict: null,
  ...over,
});
const ans = (answer: "carrying" | "covered" | "understood" | "rfi", extra: Record<string, unknown> = {}) => ({
  answer,
  amount: null,
  covered_by: null,
  note: null,
  qualification: null,
  question: null,
  source: "chat" as const,
  updated_at: null,
  ...extra,
});

const NOTE_14 =
  "Contractor shall provide temporary power for temporary heat, boilers and chillers. Contractor may use the owner's existing panel where spare capacity allows, subject to the owner's approval.";

describe("repeats fold into one gap", () => {
  it("keys a gap by its words, not its code or the sheet it cites", () => {
    expect(gapKey("G01 Exercise identity exception")).toBe(gapKey("Exercise identity exception"));
    expect(gapKey("G-12 Data category & additional TVs")).toBe(gapKey("Data category and additional TVs"));
    expect(gapKey("Temporary power and lighting")).toBe(gapKey("Temporary power and heat"));
    expect(gapKey("Permits")).not.toBe(gapKey("Electrical permits, plan examination and inspections"));
  });

  it("collapses 2810's reworded copies and the three Permits into the lowest number, keeping marked copies", () => {
    const g = (ref: string, title: string, sheet: string, spec: string) => ({ ref, title, sheet, spec_section: spec });
    const out = collapseRepeats(
      [
        g("G-1", "G01 Exercise identity exception", "E1", "Title block"),
        g("G-38", "Permits", "BB-Permit", "not in a spec section"),
        g("G-52", "G01 Exercise identity exception", "E1", "G01"),
        g("G-54", "G03 Track colour, output and control discrepancies", "E1", "G03"),
        g("G-3", "G03 Track colour, output and control discrepancies", "E1", "E1 schedule"),
        g("G-70", "Permits", "Clause Electrical", "Electrical"),
        g("G-71", "Permits", "Clause G16", "G16"),
      ],
      new Set(["G-54"]),
    );
    expect(out.map((x) => x.ref)).toEqual(["G-1", "G-38", "G-54", "G-3"]);
    expect(out.find((x) => x.ref === "G-38")!.citations).toEqual([
      "BB-Permit · not in a spec section",
      "Clause Electrical · Electrical",
      "Clause G16 · G16",
    ]);
  });

  it("preserveGapList matches a reworded repeat to the existing number instead of minting G-52", () => {
    const prior = prepareGaps([
      { ref: "G-1", kind: "verify", category: "conflict", title: "G02 Type E quantity mismatch", reasoning: "Plan shows 14, schedule 12.", sheet: "E1", spec_section: "E1 schedule" },
    ]);
    const kept = preserveGapList(prior, [
      { kind: "verify", category: "conflict", title: "Type E quantity mismatch", reasoning: "Plan 14 vs schedule 12.", sheet: "E1", spec_section: "G02" },
    ]);
    expect(kept.map((k) => k.ref)).toEqual(["G-1"]);
    expect(kept[0].citations).toEqual(["E1 · E1 schedule", "E1 · G02"]);
  });
});

describe("temporary power on the owner's panel", () => {
  it("finds the condition and makes temp power a gap that holds the bid", () => {
    expect(conditionalSentence(NOTE_14)).toMatch(/owner's existing panel where spare capacity allows/);
    const hits = scanText(NOTE_14, "sheet", "E-001");
    const temp = hits.find((h) => h.kind === "temporary_utilities")!;
    expect(temp.condition).toMatch(/spare capacity/);
    const [gap] = requirementGaps([temp], "self_performer");
    expect(gap).toMatchObject({
      title: "Temporary power and heat",
      severity: "hard",
      holds_bid: true,
      conditional: true,
    });
    expect(gap.question).toMatch(/If the owner says no/);
    expect(gap.reasoning).toMatch(/spare breaker on the panel isn't a yes/);
  });

  it("does not flag an ordinary substitution approval", () => {
    expect(conditionalSentence("Substitutions are subject to the Architect's approval.")).toBeNull();
    expect(flagConditional({ title: "Lighting fixtures", reasoning: "Or equal, subject to Architect review." })).toEqual({
      title: "Lighting fixtures",
      reasoning: "Or equal, subject to Architect review.",
    });
  });

  it("flags a host-sent gap that quotes the owner's-panel note", () => {
    expect(
      flagConditional({ title: "Temporary power", reasoning: NOTE_14, severity: "soft" as const, holds_bid: false }),
    ).toMatchObject({ conditional: true, holds_bid: true, severity: "hard" });
  });

  it("refuses 'covered by the owner's panel' on a conditional gap, and takes it in writing", () => {
    const g = item({ conditional: true, title: "Temporary power and heat" });
    expect(answerProblem(g, { answer: "covered", covered_by: "other", note: "Owner's panel, note 14" })).toMatch(/trap/);
    expect(answerProblem(g, { answer: "covered", covered_by: "general_conditions", note: "spare breaker in their panel" })).toMatch(/trap/);
    expect(answerProblem(g, { answer: "covered", covered_by: "owner_in_writing", note: "Facility letter Nov 2" })).toBeNull();
    expect(answerProblem(g, { answer: "carrying", amount: 228636 })).toBeNull();
    expect(answerProblem(g, { answer: "carrying" })).toMatch(/dollars/);
    expect(answerProblem(g, { answer: "rfi" })).toMatch(/RFI question/);
  });
});

describe("board columns and the gap check verdict", () => {
  const items = [
    item({ ref: "G-1", exposure_high: 230000, conditional: true }),
    item({ ref: "G-2", exposure_high: 52000 }),
    item({ ref: "G-3", holds_bid: false, exposure_high: 90000 }),
    item({ ref: "G-4", answer: ans("rfi", { question: "Confirm F7 count?" }) }),
    item({ ref: "G-5", holds_bid: false, verdict: { mark: "not_relevant", note: "n/a", corrected_qty: null, owner: null } }),
    item({ ref: "G-6", answer: ans("carrying", { amount: 6800 }) }),
  ];

  it("puts each card in its column and counts what still holds the bid", () => {
    expect(items.map(columnOf)).toEqual(["to_answer", "to_answer", "to_answer", "rfi", "dropped", "carrying"]);
    expect(items.filter(stillHolds).map((i) => i.ref)).toEqual(["G-1", "G-2", "G-4"]);
    expect(progress(items)).toMatchObject({ total: 5, answered: 2, open: 3, holding: 3, rfi: 1, carrying: 6800, exposureHigh: 372000, met: false });
  });

  it("asks what holds the bid first, then the biggest money", () => {
    expect(walkOrder(items).map((i) => i.ref)).toEqual(["G-1", "G-2", "G-3", "G-4", "G-6"]);
    expect(nextGap(items)?.ref).toBe("G-1");
  });

  it("is met only when every gap is answered and no RFI is still out", () => {
    const done = items.map((i) => (i.answer || columnOf(i) === "dropped" ? i : { ...i, answer: ans("understood", { qualification: "Excluded" }) }));
    expect(progress(done).met).toBe(false);
    const met = done.map((i) => (i.answer?.answer === "rfi" ? { ...i, answer: ans("carrying", { amount: 1 }) } : i));
    expect(progress(met).met).toBe(true);
    expect(nextGap(met)).toBeNull();
  });

  it("settle lets a gap check answer settle the gap or keep it holding", () => {
    const raw = {
      gaps: [
        { ref: "G-1", kind: "verify", category: "scope_seam", severity: "hard", title: "Temp", reasoning: "r", sheet: "E1", spec_section: "01", holds_bid: true, answer: ans("carrying", { amount: 5 }) },
        { ref: "G-2", kind: "verify", category: "scope_seam", severity: "hard", title: "F7", reasoning: "r", sheet: "E1", spec_section: "01", holds_bid: true, answer: ans("rfi", { question: "q" }) },
      ],
      verdicts: [],
    };
    const st = parseState(raw);
    const s = settle(st.lines, st.gaps, st.verdicts, st.setup);
    expect(s.items.map((i) => [i.ref, i.status, i.holdsBid])).toEqual([
      ["G-1", "settled", false],
      ["G-2", "open", true],
    ]);
  });

  it("reads the board payload", () => {
    const b = parseBoard({ job_number: "2701", job_name: "Harbor Point", gaps: [{ ref: "G-10", title: "x" }, { ref: "G-2", title: "y", answer: { answer: "rfi", question: "q" } }], stamp: "s" });
    expect(b.items.map((i) => i.ref)).toEqual(["G-2", "G-10"]);
    expect(b.items[0].answer?.answer).toBe("rfi");
  });
});

describe("Excel download", () => {
  const items = [
    item({ ref: "G-1", title: "Temporary power and heat", exposure_low: 180000, exposure_high: 230000, answer: ans("carrying", { amount: 228636 }) }),
    item({ ref: "G-2", title: "Fire pump feeder", exposure_low: 38000, exposure_high: 52000 }),
    item({ ref: "G-3", title: "Arc flash study", holds_bid: false, answer: ans("understood", { qualification: "Arc flash study by owner." }) }),
    item({ ref: "G-4", title: "=HYPERLINK(\"x\")", holds_bid: false }),
  ];

  it("writes a valid workbook with an answer dropdown, formulas and the qualifications sheet", () => {
    const bytes = gapCheckXlsx({ jobNumber: "2701", jobName: "Harbor Point", items });
    expect(isSafeFinancialXlsx(bytes)).toBe(true);
    const sheets = gapCheckSheets({ jobNumber: "2701", jobName: "Harbor Point", items });
    expect(sheets.map((s) => s.name)).toEqual(["Gap check", "Proposal qualifications", "Lists"]);
    expect(sheets[0].lists).toEqual([{ range: "F2:F5", source: "Lists!$A$1:$A$4" }]);
    expect(sheets[1].rows[1]).toEqual(["G-3", { v: "Arc flash study by owner.", s: "wrap" }]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<sheet name="Lists" sheetId="3" state="hidden"');
    // A title that looks like a formula stays text.
    expect(text).toContain("<t xml:space=\"preserve\">=HYPERLINK(&quot;x&quot;)</t>");
    if (process.env.GAP_XLSX_OUT) writeFileSync(process.env.GAP_XLSX_OUT, bytes);
  });

  it("stores what each formula works out to, so previews that don't recalculate read right", () => {
    const [sheet] = gapCheckSheets({ jobNumber: "2701", jobName: "Harbor Point", items });
    const still = sheet.rows.slice(1, 5).map((r) => (r[10] as { v?: unknown }).v);
    expect(still).toEqual(["No", "Yes", "No", "No"]);
    const totals = sheet.rows[6].map((c) => (c && typeof c === "object" ? c.v : c));
    expect(totals.slice(2, 7)).toEqual([2, 38000, 52000, "2 of 4 answered", 228636]);
    expect(totals[10]).toBe(1);
    expect((sheet.rows[7][1] as { v?: unknown }).v).toBe("Not met");
    const text = new TextDecoder().decode(gapCheckXlsx({ jobNumber: "2701", jobName: "Harbor Point", items }));
    expect(text).toContain('t="str"><f>IF(AND(C3=&quot;Yes&quot;');
    expect(text).toMatch(/<f>SUM\(G2:G5\)<\/f><v>228636<\/v>/);
  });

  it("uses the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(inflateRawSync).toBeTypeOf("function");
  });
});

describe("gap list round trip keeps the new fields", () => {
  it("prepareGap carries the question, condition and exposure", () => {
    const [g] = prepareGaps([
      {
        kind: "verify",
        category: "scope_seam",
        title: "Temporary power and heat",
        reasoning: NOTE_14,
        sheet: "E-001",
        spec_section: "01 51 00",
        conditional: true,
        condition_text: "if capacity allows",
        exposure_low: 180000,
        exposure_high: -5,
        question: "Carrying a generator?",
      } as GapIn,
    ]);
    expect(g).toMatchObject({ conditional: true, condition_text: "if capacity allows", exposure_low: 180000, exposure_high: null, question: "Carrying a generator?", citations: ["E-001 · 01 51 00"] });
  });
});
