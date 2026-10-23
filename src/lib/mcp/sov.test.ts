import { describe, it, expect } from "vitest";
import { buildSov, lineBilling, retainagePct, sovLayout, sovLineRows, sovSummaryText, G703_COLUMNS, SovMismatch } from "./sov";

const c = (n: number) => Math.round(n * 100);
// Fictional lines that sum to the reference cost of work + GC ($3,313,188.60 at a 15% fee).
const REF = [
  { item_no: "01.01", description: "Project management", scheduled_value: 210000.0 },
  { item_no: "01.02", description: "Supervision", scheduled_value: 180000.55 },
  { item_no: "03.01", description: "Foundations", scheduled_value: 412345.67 },
  { item_no: "06.01", description: "Framing", scheduled_value: 1010842.38 },
  { item_no: "09.01", description: "Drywall", scheduled_value: 600000.0 },
  { item_no: "26.01", description: "Electrical", scheduled_value: 900000.0 },
];

describe("SOV tie-out", () => {
  const sov = buildSov(REF, 15, 10);
  it("matches the reference callouts to the cent (fee = 15% of contract total)", () => {
    expect(sov.summary.cost_of_work_gc).toBe(3313188.6);
    expect(sov.summary.contract_total).toBe(3897868.94);
    expect(sov.summary.fee).toBe(584680.34);
    expect(sov.summary.fee_pct).toBe(15);
    expect(sov.summary.cost_of_work_gc_pct).toBe(85);
  });
  it("lines -> division subtotals -> subtotal -> fee -> grand total all add up in cents", () => {
    let sum = 0;
    for (const d of sov.divisions) {
      const s = d.lines.reduce((x, l) => x + c(l.scheduled_value), 0);
      expect(s).toBe(c(d.subtotal));
      sum += s;
    }
    expect(sum).toBe(c(sov.end_rows.subtotal.value));
    expect(c(sov.end_rows.subtotal.value) + c(sov.end_rows.fee.value)).toBe(c(sov.end_rows.grand_total.value));
    expect(sov.end_rows.grand_total.pct).toBe(100);
    expect(sov.divisions.map((d) => d.division)).toEqual(["01", "03", "06", "09", "26"]);
    expect(sov.divisions[0].header).toBe("01 Division 01 — General Conditions");
    expect(sov.summary.divisions.reduce((x, d) => x + c(d.scheduled_value), 0)).toBe(c(sov.summary.cost_of_work_gc));
    expect(sov.tie_out.ok).toBe(true);
  });
  it("percents round to 0.01% and share bars equal % of contract", () => {
    for (const d of sov.summary.divisions) {
      expect(Math.round(d.pct_of_contract * 100)).toBe(d.pct_of_contract * 100);
      expect(d.share_bar_pct).toBe(d.pct_of_contract);
    }
  });
  it("billing columns are blank (null, not zero) with no pay app", () => {
    for (const l of sov.divisions.flatMap((d) => d.lines)) expect([l.d, l.e, l.g, l.pct_complete, l.h, l.i]).toEqual([null, null, null, null, null, null]);
    expect(sov.pay_app).toEqual({ application_no: null, application_date: null, period_to: null });
  });
  it("0% fee: contract total = subtotal", () => {
    const s = buildSov(REF.slice(0, 2), 0, null);
    expect(s.summary.fee).toBe(0);
    expect(s.summary.contract_total).toBe(390000.55);
  });
});

describe("column math (G = D + E, % = G ÷ C, H = C − G, I = G × retainage)", () => {
  it("computes a line", () => {
    expect(lineBilling(100000, 25000, 15000.5, 10)).toEqual({ d: 25000, e: 15000.5, f: 0, g: 40000.5, pct_complete: 40, h: 59999.5, i: 4000.05 });
  });
  it("retainage rounds to the cent; no retainage % leaves I blank", () => {
    expect(lineBilling(1000, 333.33, 0, 5).i).toBe(16.67);
    expect(lineBilling(1000, 100, 0, null).i).toBeNull();
  });
  it("buildSov carries the math and ties out every billed line", () => {
    const s = buildSov(REF, 15, 10, { "01.01": { d: 50000, e: 10000 } });
    const l = s.divisions[0].lines[0];
    expect([l.g, l.h, l.i, l.pct_complete]).toEqual([60000, 150000, 6000, 28.57]);
    expect(s.tie_out.checks.some((x) => x.includes("Line 01.01"))).toBe(true);
  });
  it("reads the retainage % from the contract term", () => {
    expect(retainagePct("§4.1 10% through 50% completion; 5% thereafter")).toBe(10);
    expect(retainagePct("unknown")).toBeNull();
  });
});

describe("refusals", () => {
  it.each([
    [[], 15, /No SOV lines/],
    [REF, null, /fee percent isn't recorded/],
    [[{ item_no: "1", description: "x", scheduled_value: 5 }], 15, /01\.01 style/],
    [[{ item_no: "01.01", description: "x", scheduled_value: null }], 15, /no scheduled value/],
    [[{ item_no: "01.01", description: "x", scheduled_value: 1.005 }], 15, /two decimals/],
  ])("refuses bad input %#", (lines, fee, re) => {
    expect(() => buildSov(lines as never, fee as never, null)).toThrow(SovMismatch);
    expect(() => buildSov(lines as never, fee as never, null)).toThrow(re);
  });
});

describe("fixed layout", () => {
  it("uses the fixed GC columns A B C D E G %Complete H I", () => {
    expect(G703_COLUMNS.map((x) => x.letter ?? x.label)).toEqual(["A", "B", "C", "D", "E", "G", "% Complete (G÷C)", "H", "I"]);
  });
  it("white/gray/blue colors, no orange, logo or bold fallback, footer fields", () => {
    const withLogo = sovLayout({ company_name: "TEST Co", logo_url: "https://example.com/l.png", license_number: "CBC000", contact_name: "Sam", contact_phone: "555-0100", website: "example.com" });
    expect(Object.values(withLogo.colors)).toEqual(["#FFFFFF", "#111827", "#374151", "#6B7280", "#F3F4F6", "#2563EB"]);
    expect(withLogo.no_orange).toBe(true);
    expect(withLogo.default_view).toBe("lines");
    expect(JSON.stringify({ ...withLogo, no_orange: undefined, color_rule: undefined })).not.toMatch(/orange|cream|#C8581E/i);
    expect(withLogo.logo?.url).toBe("https://example.com/l.png");
    expect(withLogo.fallback_wordmark).toBeNull();
    expect(withLogo.footer.fields).toEqual(["TEST Co", "CBC000", "Sam 555-0100", "example.com"]);
    expect(withLogo.footer.right).toMatch(/Page X of Y/);
    const noLogo = sovLayout({ company_name: "TEST Co", logo_url: null, license_number: null, contact_name: null, contact_phone: null, website: null });
    expect(noLogo.logo).toBeNull();
    expect(noLogo.fallback_wordmark).toMatchObject({ text: "TEST Co", style: "bold" });
    expect(withLogo.pages.map((p) => p.title)).toEqual(["SCHEDULE OF VALUES · CONTRACT SUMMARY", "SCHEDULE OF VALUES · CONTINUATION SHEET (G703 FORMAT)"]);
  });
});

// Job 2701 (Harbor Point Electrical): Exhibit B lump sum, fee 0, ten lines that tie to $1,400,000.00.
const J2701 = [
  ["26.01", "Mobilization, bonds and general conditions", 70000], ["26.02", "Submittals and engineering", 20000],
  ["26.03", "Service entrance and switchgear", 210000], ["26.04", "Emergency generator and transfer switches", 180000],
  ["26.05", "Panelboards, transformers and feeders", 185000], ["26.06", "Branch circuit rough-in and devices", 255000],
  ["26.07", "Lighting fixtures and controls", 205000], ["26.08", "Site lighting, testing and closeout", 70000],
  ["27.01", "Low-voltage pathways", 90000], ["28.01", "Fire alarm system", 115000],
].map(([item_no, description, scheduled_value]) => ({ item_no: item_no as string, description: description as string, scheduled_value: scheduled_value as number }));
const BRAND = { company_name: "ALP Construction", logo_url: null, license_number: null, contact_name: null, contact_phone: null, website: null };

describe("SOV line-item view (0.8.0)", () => {
  const sov = buildSov(J2701, 0, null);
  it("lists every line by default and ties out to the contract sum", () => {
    const rows = sovLineRows(sov);
    expect(rows.map((r) => r.item_no)).toEqual(J2701.map((l) => l.item_no));
    expect(rows.reduce((s, r) => s + c(r.scheduled_value), 0)).toBe(c(1400000));
    expect(sov.summary.contract_total).toBe(1400000);
    expect(rows.find((r) => r.item_no === "26.06")!.pct_of_total).toBe(18.21);
    const txt = sovSummaryText("", sov, BRAND, "Exhibit B", [], "internal");
    for (const l of J2701) expect(txt).toContain(`${l.item_no} | `);
    expect(txt).toContain("Total | | | Contract sum | $1,400,000.00 | 100.00%");
    expect(txt).not.toContain("Scheduled value by division:");
    expect(txt).not.toContain("Contractor's fee");
  });
  it("division roll-up only when asked", () => {
    const txt = sovSummaryText("", sov, BRAND, "Exhibit B", [], "internal", "divisions");
    expect(txt).toContain("- 26 Electrical: $1,195,000.00 (85.36%)");
    expect(txt).not.toContain("26.06 | ");
  });
});
