// Phase 2: pay apps. D2 stored materials, D3 overbill approvers, D4 footer, drafting from the certified record, due dates.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fmt, toCents } from "./accounting/cents";
import { PAYAPP_FOOTER, OVERBILL_APPROVER_ROLES, payAppMath, type PayLine } from "./accounting/payapp-math";
import { PAYAPP_FILE_SPEC, PAYAPP_FORMAT_VIEW, draftNext, fileName, g702Rows, payAppDue, previousCertificates, type SavedPayApp } from "./accounting/payapp";
import type { RetainageRule } from "./accounting/retainage";
import type { PaymentTermRule } from "./accounting/payment-terms";
import { PAYAPP_TOOLS } from "./tools/payapp-tools";
import { ALERT_COLOR } from "./alert-color";

const $ = toCents;
const RULE: RetainageRule = { base_rate_bp: 1000, reduction: "prospective", threshold_bp: 5000, threshold_basis: "contract_sum_to_date", reduced_rate_bp: 500, release_terms: "§4.2", source: "contract", clause_section: "4.1", clause_text: "x", answered_by: null, stored_rate_bp: null };
const SOV = [["26.01", 70000], ["26.02", 20000], ["26.03", 210000], ["26.04", 180000], ["26.05", 185000], ["26.06", 255000], ["26.07", 205000], ["26.08", 70000], ["27.01", 90000], ["28.01", 115000]].map(([id, c]) => ({ id: id as string, c: $(c as number) }));
// App 2 as billed (plan P2): G and I per line, F stored.
const APP2_G: Record<string, [number, number, number]> = { "26.01": [56000, 5600, 0], "26.02": [18000, 1800, 0], "26.03": [140000, 14000, 70000], "26.04": [60000, 6000, 60000], "26.05": [74000, 7400, 37000], "26.06": [0, 0, 0], "26.07": [51250, 5125, 51250], "26.08": [0, 0, 0], "27.01": [45000, 4500, 0], "28.01": [46000, 4600, 23000] };
const app2 = (cut = false): SavedPayApp => ({
  app_no: 2, period_from: "2026-12-01", period_to: "2026-12-31", status: "certified", version: 2, original_contract: $(1400000), net_change_orders: 0, previous_certificates: $(215100),
  lines: SOV.map((s) => ({ id: s.id, c: s.c, d: 0, e: 0, f: $(APP2_G[s.id][2]), prev_g: 0, prev_i: 0 })), g702: {} as SavedPayApp["g702"],
  submitted_on: "2026-12-23", approved_on: "2027-01-05", gc_paid_on: null, received: $(226125),
  certified: { lines: SOV.map((s) => ({ id: s.id, g: $(APP2_G[s.id][0] - (cut && s.id === "26.07" ? 10250 : 0)), i: $(APP2_G[s.id][1] - (cut && s.id === "26.07" ? 1025 : 0)) })), total_due: $(cut ? 216900 : 226125), certified_by: "Tom Kessler", certified_on: "2027-01-05" },
});
const app1: SavedPayApp = { ...app2(), app_no: 1, certified: { ...app2().certified!, total_due: $(215100) } };
const ENTRIES = [["26.01", 7000], ["26.02", 2000], ["26.03", 105000], ["26.04", 120000], ["26.05", 74000], ["26.06", 191000], ["26.07", 102500], ["27.01", 22500], ["28.01", 46000], ["CO-001", 9250]].map(([id, e]) => ({ id: id as string, e: $(e as number), f: 0 }));

describe("drafting app 3 from the certified record", () => {
  it("as certified: D, prev G and prev I come from app 2, line 7 $441,225.00, app 3 due $405,150.00", () => {
    const lines = draftNext([...SOV, { id: "CO-001", c: $(18500), co: true }], app2(), ENTRIES);
    expect(lines.find((l) => l.id === "26.03")).toMatchObject({ d: $(70000), prev_g: $(140000), prev_i: $(14000), prev_f: $(70000) });
    const l7 = previousCertificates([app1, app2()], 3);
    expect(fmt(l7)).toBe("$441,225.00");
    const r = payAppMath(RULE, { original_contract: $(1400000), net_change_orders: $(18500), previous_certificates: l7, lines });
    expect(fmt(r.g702.l8)).toBe("$405,150.00");
    expect(r.ok).toBe(true);
  });
  it("P8: a certified cut on app 2 (26.07 stored $51,250.00 to $41,000.00) becomes the starting point: line 7 $432,000.00", () => {
    const l7 = previousCertificates([app1, app2(true)], 3);
    expect(fmt(l7)).toBe("$432,000.00");
    const lines = draftNext(SOV, app2(true), []);
    expect(lines.find((l) => l.id === "26.07")).toMatchObject({ prev_g: $(41000), prev_i: $(4100) });
  });
  it("app 2 certified with the cut recomputes to $216,900.00 under the rule", () => {
    const lines: PayLine[] = SOV.map((s) => { const [g, , f] = APP2_G[s.id]; const ff = s.id === "26.07" ? 41000 : f; const prevG = { "26.01": 49000, "26.02": 15000, "26.03": 70000, "26.05": 37000, "27.01": 45000, "28.01": 23000 }[s.id] ?? 0; return { id: s.id, c: s.c, d: prevG, e: g - f - prevG, f: $(ff), prev_g: $(prevG), prev_i: $(prevG / 10) }; }).map((l) => ({ ...l, d: $(l.d), e: $(l.e) }));
    const r = payAppMath(RULE, { original_contract: $(1400000), net_change_orders: 0, previous_certificates: $(215100), lines });
    expect(fmt(r.g702.l8)).toBe("$216,900.00");
  });
});

describe("D2: stored materials", () => {
  const app2Lines = (): PayLine[] => SOV.map((s) => { const [g, , f] = APP2_G[s.id]; const prev = { "26.01": 49000, "26.02": 15000, "26.03": 70000, "26.05": 37000, "27.01": 45000, "28.01": 23000 }[s.id] ?? 0; return { id: s.id, c: s.c, d: $(prev), e: $(g - f - prev), f: $(f), prev_g: $(prev), prev_i: $(prev / 10) }; });
  it("default: same rate as completed work (P2: 5b $24,125.00)", () => {
    const r = payAppMath(RULE, { original_contract: $(1400000), net_change_orders: 0, previous_certificates: $(215100), lines: app2Lines() });
    expect([r.g702.l5a, r.g702.l5b, r.g702.l5].map(fmt)).toEqual(["$24,900.00", "$24,125.00", "$49,025.00"]);
  });
  it("a contract stored rate of 5%: 5b $12,062.50, work stays at 10%, totals tie", () => {
    const r = payAppMath({ ...RULE, stored_rate_bp: 500 }, { original_contract: $(1400000), net_change_orders: 0, previous_certificates: $(215100), lines: app2Lines() });
    expect([r.g702.l5a, r.g702.l5b, r.g702.l5].map(fmt)).toEqual(["$24,900.00", "$12,062.50", "$36,962.50"]);
    expect(r.g702.l5a + r.g702.l5b).toBe(r.g702.l5);
    expect(r.ok).toBe(true);
  });
});

describe("D3: only owner and all-access may approve an overbill", () => {
  const over = (role: string) => draftNext(SOV, app2(), [{ id: "26.02", e: $(3500), f: 0, overbill_approved_by: { name: role === "owner" ? "Jordan Blake" : "Priya Nand", role } }]);
  const check = (lines: PayLine[]) => payAppMath(RULE, { original_contract: $(1400000), net_change_orders: 0, previous_certificates: $(441225), lines }).checks.find((c) => c.key === "B3")!;
  it("owner approval passes B3", () => expect(check(over("owner")).ok).toBe(true));
  it("all-access approval passes B3", () => expect(check(over("all_access")).ok).toBe(true));
  it("a PM can't approve: blocked, and says who can", () => {
    expect(check(over("pm")).message).toBe("Line 26.02 is $1,500.00 over its scheduled value. Priya Nand can't approve an overbill; only the owner or an all-access member can.");
    expect([...OVERBILL_APPROVER_ROLES]).toEqual(["owner", "all_access"]);
  });
});

describe("D4 footer, view and file spec; D11 due date on every app", () => {
  it("footer wording is exact and rides in the view and both files", () => {
    expect(PAYAPP_FOOTER).toBe("Prepared in AIA G702/G703 format. Not an AIA document.");
    expect(PAYAPP_FORMAT_VIEW.join("\n")).toContain(PAYAPP_FOOTER);
    expect(PAYAPP_FILE_SPEC("2701", 3, "2027-01-31").join("\n")).toContain("2701-PayApp-03-2027-01-31.pdf");
    expect(fileName("2701", 3, "2027-01-31", "xlsx")).toBe("2701-PayApp-03-2027-01-31.xlsx");
  });
  it("the alert color only on failed checks and unapproved overbills; G702 labels are Athena's own", () => {
    const v = PAYAPP_FORMAT_VIEW.join("\n");
    expect(v.split(ALERT_COLOR).length - 1).toBe(2);
    expect(v).toMatch(/Navy header/);
    expect(g702Rows({ l1: 1, l2: 0, l3: 1, l4: 0, l5a: 0, l5b: 0, l5: 0, l6: 0, l7: 0, l8: 0, l9: 1 })[9][0]).toBe("8 Current payment due");
  });
  it("app 3 due date: Estimated until the GC's paid date is logged, then firm", () => {
    const t: PaymentTermRule = { kind: "pay_when_paid", days: 7, day_type: "calendar", owner_terms_days: 30, owner_terms_from: "approval", source: "contract", clause_section: "3.3", clause_text: "x", answered_by: null };
    expect(payAppDue(t, { submitted_on: "2027-01-25", approved_on: "2027-02-01", gc_paid_on: null })).toMatchObject({ due: "2027-03-10", estimated: true });
    expect(payAppDue(t, { submitted_on: "2027-01-25", approved_on: "2027-02-01", gc_paid_on: "2027-02-25" })).toMatchObject({ due: "2027-03-04", estimated: false });
  });
});

describe("pay app tools: reads are read-only, writes ask first", () => {
  const ann = (t: unknown) => (t as { annotations?: Record<string, unknown> }).annotations ?? (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
  const name = (t: unknown) => (t as { name?: string }).name ?? (t as { config?: { name?: string } }).config?.name;
  it("annotations", () => {
    const m = Object.fromEntries(PAYAPP_TOOLS.map((t) => [name(t), ann(t)]));
    for (const n of ["payapp_draft", "payapp_check", "payapp_get"]) expect(m[n]).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const n of ["payapp_save", "payapp_certify", "payment_record"]) expect(m[n]).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
  it("the migration is additive, not applied, and re-checks the G702 identities", () => {
    const sql = readFileSync("supabase/migrations/20261022010000_athena_accounting_p2_payapps.sql", "utf8");
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    expect(sql).toMatch(/l8'\)::bigint = \(g702->>'l6'\)::bigint - \(g702->>'l7'\)::bigint/);
    expect(sql).toMatch(/bigint/);
  });
});
