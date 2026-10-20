import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as tools from "./tools/workflow-tools";
import { renderWarrantyRegister } from "./warranty";
import { dateIn, DEFAULT_TZ } from "./deadlines";
import { itemLine, jobTimeZone, resolveCompany } from "./jobs";

const shape = (t: unknown) => ((t as { inputSchema?: unknown }).inputSchema ?? (t as { config?: { inputSchema?: unknown } }).config?.inputSchema) as Record<string, z.ZodTypeAny>;
const all = Object.entries(tools).filter(([, t]) => t && typeof t === "object" && shape(t)?.company_id);

describe("company_id accepts a company name", () => {
  it("covers every tool that takes company_id", () => expect(all.length).toBeGreaterThanOrEqual(9));
  it.each(all)("%s: name validates, schema has no uuid format, description says name", (_n, t) => {
    const s = shape(t).company_id;
    expect(s.safeParse("ALP Construction").success).toBe(true);
    expect(s.safeParse("TEST – Ridgeline Mechanical (acceptance test)").success).toBe(true);
    expect(s.safeParse("5300fd46-5185-45d9-a43d-f0964d34be08").success).toBe(true);
    const js = JSON.stringify(z.toJSONSchema(s));
    expect(js).not.toMatch(/uuid/i);
    expect(s.description).toMatch(/company name/);
  });
  it("resolves a name case-insensitively", async () => {
    const sb = { from: () => ({ select: async () => ({ data: [{ id: "c1", name: "ALP Construction" }, { id: "c2", name: "TEST – Ridgeline" }], error: null }) }) } as never;
    await expect(resolveCompany(sb, "alp construction")).resolves.toBe("c1");
    await expect(resolveCompany(sb, "c2")).resolves.toBe("c2");
  });
});

describe("warranty register keeps answer detail out of template text", () => {
  const facts = [
    { key: "workmanship_warranty", value: "yes", status: "known", source: "member_answer" },
    { key: "workmanship_warranty_months", value: 12, status: "known", source: "member_answer" },
    { key: "warranty_start_trigger", value: "final_acceptance", status: "known", source: "member_answer" },
    { key: "warranty_start_trigger_other", value: "TEST DATA: final acceptance by the owner.", status: "known", source: "member_answer" },
  ];
  const out = renderWarrantyRegister(facts, "2026-10-19").join("\n");
  it("fills fields cleanly", () => {
    expect(out).toContain("Status: Pending final acceptance date");
    expect(out).toContain("Start date: pending final acceptance date");
    expect(out).toContain("Starts at: final acceptance\n");
    expect(out).toContain("Trigger note: TEST DATA: final acceptance by the owner.");
    expect(out).not.toMatch(/\(TEST DATA[^\n]*\) date/);
  });
  it("other trigger keeps its description on Starts at only", () => {
    const o = renderWarrantyRegister([facts[0], { ...facts[2], value: "other" }, { ...facts[3], value: "owner move-in" }], "2026-10-19").join("\n");
    expect(o).toContain("Starts at: other: owner move-in");
    expect(o).toContain("Status: Pending start trigger date");
    expect(o).not.toContain("Trigger note");
  });
});

describe("dates use the job time zone", () => {
  const lateUtc = "2026-10-20T02:30:00Z"; // 9:30 PM Oct 19 in Chicago
  it("converts timestamps", () => {
    expect(dateIn(lateUtc, "America/Chicago")).toBe("2026-10-19");
    expect(dateIn(lateUtc, "UTC")).toBe("2026-10-20");
    expect(dateIn("2026-10-20", "America/Chicago")).toBe("2026-10-20");
    expect(dateIn(lateUtc, "Not/AZone")).toBe(dateIn(lateUtc, DEFAULT_TZ));
  });
  it("default is America/New_York", () => expect(DEFAULT_TZ).toBe("America/New_York"));
  it("jobTimeZone falls back to the default", async () => {
    const mk = (tz: string | null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { time_zone: tz } }) }) }) }) }) as never;
    await expect(jobTimeZone(mk("America/Chicago"), "j")).resolves.toBe("America/Chicago");
    await expect(jobTimeZone(mk(null), "j")).resolves.toBe("America/New_York");
    await expect(jobTimeZone(mk("bogus"), "j")).resolves.toBe("America/New_York");
  });
  it("item lines show the local date", () => {
    const it0 = { id: "36c31f00-0000-4000-8000-000000000001", action: "X", item_type: "unknown", reported_by: "Sam", reported_at: lateUtc, verify_state: "reported" } as never;
    expect(itemLine(it0, [], false, { tz: "America/Chicago" })).toContain("last reported by Sam 2026-10-19");
  });
});

describe("Claude retest units", async () => {
  const { warrantyStartConflict, alignCloseoutSource, CONTRACT_WARRANTY_KEY } = await import("./warranty");
  const { claimItemIds, withoutClaims, isClaimDeadline } = await import("./internal-claims");
  const k = (key: string, value: unknown, source = "member_answer") => ({ key, value, status: "known", source });
  it("conflict needs two sources naming different triggers", () => {
    expect(warrantyStartConflict([k("warranty_start_trigger", "final_acceptance"), k("warranty_start_basis", "Contract §8.1, final acceptance")])).toBeNull();
    const c = warrantyStartConflict([k("warranty_start_trigger", "final_acceptance"), k("warranty_start_basis", "substantial completion certificate"), k(CONTRACT_WARRANTY_KEY, "§8.1 one year from Owner acceptance", "document")]);
    expect(c?.sources.map((s) => s.says)).toEqual(["final_acceptance", "substantial_completion", "final_acceptance"]);
  });
  it("closeout docs matching the contract take the contract source", () => {
    const out = alignCloseoutSource([k("closeout_documents", "O&M manuals")], k("closeout", "O&M manuals", "document"));
    expect(out[0].source).toBe("document");
    expect(alignCloseoutSource([k("closeout_documents", "other")], k("closeout", "O&M manuals", "document"))[0].source).toBe("member_answer");
  });
  it("claim items and their delivery children are dropped", () => {
    const items = [
      { id: "a", check_key: "delay_notice:1", action: "Send written delay notice" },
      { id: "b", check_key: "delay_claim:1", action: "Submit claim notice (§7.4) for: x", commercial_type: "claim" },
      { id: "c", check_key: "delivery:b", action: "Confirm delivery method and recipient for: Submit claim notice" },
    ];
    expect([...claimItemIds(items)].sort()).toEqual(["b", "c"]);
    expect(withoutClaims(items).map((i) => i.id)).toEqual(["a"]);
    expect(isClaimDeadline({ label: "Claim notice" })).toBe(true);
    expect(isClaimDeadline({ label: "Delay notice" })).toBe(false);
  });
  it("PM-default note is conditional", () => {
    expect(tools.ownerDefaultNote("Unassigned (no PM set)")).toContain("no PM is set");
    expect(tools.ownerDefaultNote("Sam Ortiz (PM)")).toBe(" — defaulted to the job's PM");
  });
  it("notices go on their own lines", () => {
    expect(tools.itemNotes([{ item_id: "x", existing: true }])).toBe("\n- Already open.");
  });
  it("descriptions tell the host to list companies when none is named", () => {
    expect(tools.listOpenItems.description ?? (tools.listOpenItems as never as { config: { description: string } }).config.description).toContain("no job_number");
    expect(shape(tools.listOpenItems).job_number.safeParse(undefined).success).toBe(true);
    expect(shape(tools.report).company_id.description).toContain("list_open_items with no job_number");
  });
  it("closing only fills warranty setup answers", () => {
    expect(tools.closedWarrantyKey("warranty:manufacturer_warranties", true, "member_statement")).toBe("manufacturer_warranties");
    expect(tools.closedWarrantyKey("warranty:manufacturer_warranties", false, "member_statement")).toBeNull();
    expect(tools.closedWarrantyKey("warranty:workmanship_warranty", true, "verified")).toBeNull();
    expect(tools.closedWarrantyKey("delay_claim:1", true, "verified")).toBeNull();
  });
});

