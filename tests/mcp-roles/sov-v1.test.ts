// SOV lean v1: real /mcp handler + real migrations incl. 0021 (PGlite). TEST company and users on .invalid addresses only.
import { describe, test, expect, vi, beforeAll } from "vitest";
vi.mock("../../src/lib/mcp/supabase", async () => ({ supabaseForUser: (await import("./harness")).mockedSupabaseForUser }));
vi.mock("../../src/lib/mcp/allowlist", async () => {
  const h = await import("./harness");
  return { MCP_ALLOWED_EMAILS: new Set(["owner", "pm", "finance", "contracts", "estimating", "super"].map((r) => h.user(r as never).email)) };
});
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import mcp from "../../src/lib/mcp/index";
import { setLogLevel } from "@lovable.dev/mcp-js";
setLogLevel("error");
import { bootDb, setupKeysAndFetch, callTool, user, state, type Role } from "./harness";

const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (r: Role, name: string, args: Record<string, unknown>) => callTool(handler, await tok(r), name, args);
const c = (n: number) => Math.round(n * 100);
const LINES = [
  { line: "01.01", description: "Project management", billable_value: 210000 },
  { line: "01.02", description: "Supervision", billable_value: 180000.55 },
  { line: "03.01", description: "Foundations", billable_value: 412345.67 },
  { line: "06.01", description: "Framing", billable_value: 1010842.38 },
  { line: "09.01", description: "Drywall", billable_value: 600000 },
  { line: "26.01", description: "Electrical", billable_value: 900000 },
];

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  const db = state.db!;
  expect((await call("owner", "onboarding", { action: "save_company", name: "TEST SOV Co", your_name: "Test Owner" })).isError).toBe(false);
  const co = (await db.query<{ id: string }>(`SELECT id FROM public.mcp_companies`)).rows[0].id;
  for (const r of ["pm", "finance", "contracts", "estimating", "super"])
    await db.query(`INSERT INTO public.mcp_company_members (company_id, user_id, role, display_name) VALUES ($1,$2,$3,$4)`, [co, user(r as Role).id, r, `Test ${r}`]);
  for (const j of ["S-1", "S-2"]) expect((await call("owner", "intake", { section: "create_job", job_number: j, job_name: `TEST SOV ${j}` })).isError).toBe(false);
  await db.query(`UPDATE public.mcp_jobs SET pm_user_id = $1 WHERE job_number = 'S-1'`, [user("pm").id]);
  await db.query(`INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) SELECT id, $1, $2 FROM public.mcp_jobs WHERE job_number = 'S-1'`, [user("super").id, user("owner").id]);
  expect((await call("owner", "intake", { section: "contract", job_number: "S-1", contract_document_provided: true, contract_document_name: "TEST Agreement.pdf", retainage: "§4.1 10% through 50% completion" })).isError).toBe(false);
  const b = await call("owner", "intake", { section: "budget", job_number: "S-1", sov_lines: LINES, fee_pct: 15, sov_basis: "Schedule A, Total Investment" });
  expect(b.isError, b.text).toBe(false);
  expect(b.text).toMatch(/Fee: 15\.00% of contract total \| Basis: Schedule A, Total Investment/);
});

describe("company setup: logo and footer", () => {
  test("no logo: the company name prints in bold, and the missing footer details are asked for", async () => {
    const r = await call("owner", "onboarding", { action: "read" });
    expect(r.text).toMatch(/SOV logo: none on file \(TEST SOV Co prints in bold\)/);
    expect(r.text).toMatch(/footer details still missing: license number, contact name, phone, website/);
  });
  test("owner saves the logo link and footer in one step; non-https links are refused", async () => {
    expect((await call("owner", "onboarding", { action: "save_brand", logo_url: "http://example.invalid/logo.png" })).text).toMatch(/must start with https/);
    const r = await call("owner", "onboarding", { action: "save_brand", logo_url: "https://example.invalid/logo.png", license_number: "Certified Building Contractor CBC0000000", contact_name: "Sam Ortiz", contact_phone: "555-0100", website: "example.invalid" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/SOV logo: link on file/);
    expect(r.text).toMatch(/SOV footer: TEST SOV Co · Certified Building Contractor CBC0000000 · Sam Ortiz 555-0100 · example\.invalid/);
    expect(r.text).not.toMatch(/still missing/);
  });
  test("only an Owner can change the logo and footer", async () => {
    const r = await call("pm", "onboarding", { action: "save_brand", website: "evil.invalid" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Only a company Owner/);
  });
});

describe("SOV data ties out", () => {
  test("owner gets the server-built SOV; every total ties to the cent", async () => {
    const r = await call("owner", "report", { job_number: "S-1", deliverable: "sov" });
    expect(r.isError, r.text).toBe(false);
    const sov = r.structured!.sov as any;
    expect(sov.summary.contract_total).toBe(3897868.94);
    expect(sov.summary.fee).toBe(584680.34);
    expect(sov.summary.fee_pct).toBe(15);
    let sum = 0;
    for (const d of sov.divisions) { const s = d.lines.reduce((x: number, l: any) => x + c(l.scheduled_value), 0); expect(s).toBe(c(d.subtotal)); sum += s; }
    expect(sum).toBe(c(sov.end_rows.subtotal.value));
    expect(c(sov.end_rows.subtotal.value) + c(sov.end_rows.fee.value)).toBe(c(sov.end_rows.grand_total.value));
    expect(sov.header.contract_sum).toBe(sov.end_rows.grand_total.value);
    expect(sov.retainage_pct).toBe(10);
    expect(sov.columns.map((x: any) => x.letter ?? "%")).toEqual(["A", "B", "C", "D", "E", "G", "%", "H", "I"]);
    expect(sov.divisions.flatMap((d: any) => d.lines).every((l: any) => l.g === null && l.h === null && l.i === null)).toBe(true);
    expect(sov.layout.logo.url).toBe("https://example.invalid/logo.png");
    expect(sov.footer.fields[0]).toBe("TEST SOV Co");
    expect(r.text).toMatch(/Contract total: \$3,897,868\.94/);
    expect(r.guidance).toMatch(/structuredContent\.sov/);
  });
  test("refuses instead of producing numbers that don't tie: missing fee, bad item numbers, missing values", async () => {
    await call("owner", "intake", { section: "budget", job_number: "S-2", sov_lines: [{ line: "01.01", description: "PM", billable_value: 1000 }] });
    expect((await call("owner", "report", { job_number: "S-2", deliverable: "sov" })).text).toMatch(/can't be built yet[\s\S]*fee percent isn't recorded/);
    await call("owner", "intake", { section: "budget", job_number: "S-2", fee_pct: 10, sov_lines: [{ line: "Div 1 misc", description: "Misc" }] });
    const r = await call("owner", "report", { job_number: "S-2", deliverable: "sov" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/01\.01 style/);
    expect(r.text).toMatch(/no scheduled value/);
  });
  test("a fee of 100% or more is refused at intake", async () => {
    expect((await call("owner", "intake", { section: "budget", job_number: "S-2", fee_pct: 100 })).text).toMatch(/at least 0 and under 100/);
  });
  test("a line edit that changes the contract total is refused and the saved SOV stays", async () => {
    const before = await call("owner", "report", { job_number: "S-1", deliverable: "sov" });
    const edit = await call("owner", "intake", { section: "budget", job_number: "S-1", sov_lines: [{ line: "26.01", description: "Electrical", billable_value: 950000 }] });
    expect(edit.isError).toBe(true);
    expect(edit.text).toContain("Contract value changes only by change order. Nothing was saved.");
    const after = await call("owner", "report", { job_number: "S-1", deliverable: "sov" });
    expect((after.structured!.sov as { summary: { contract_total: number } }).summary.contract_total).toBe((before.structured!.sov as { summary: { contract_total: number } }).summary.contract_total);
  });
});

describe("role guardrails", () => {
  test("Super sees no dollars: the SOV is refused and the limited report shows no figures", async () => {
    const r = await call("super", "report", { job_number: "S-1", deliverable: "sov" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/\$\d/);
    expect(r.structured?.sov).toBeUndefined();
    const lim = await call("super", "report", { job_number: "S-1" });
    expect(lim.text).not.toMatch(/\$\d|3,897,868|584,680|210000|1010842/);
  });
  test("contract-side roles can't pull the SOV", async () => {
    const r = await call("contracts", "report", { job_number: "S-1", deliverable: "sov" });
    expect(r.isError).toBe(true);
    expect(r.structured?.sov).toBeUndefined();
  });
  test("full access may pull the SOV for the owner; the numbers are the same and still tie out", async () => {
    const r = await call("owner", "report", { job_number: "S-1", deliverable: "sov", audience: "client" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/SCHEDULE OF VALUES \(for the owner/);
    const sov = r.structured!.sov as any;
    expect(sov.audience).toBe("client");
    expect(sov.summary.contract_total).toBe(3897868.94);
    expect(c(sov.end_rows.subtotal.value) + c(sov.end_rows.fee.value)).toBe(c(sov.end_rows.grand_total.value));
    const pm = await call("pm", "report", { job_number: "S-1", deliverable: "sov", audience: "client" });
    expect(pm.isError, pm.text).toBe(false);
  });
  test("Super and contract-only roles stay blocked from the client SOV", async () => {
    for (const role of ["super", "contracts"] as const) {
      const r = await call(role, "report", { job_number: "S-1", deliverable: "sov", audience: "client" });
      expect(r.isError, role).toBe(true);
      expect(r.structured?.sov).toBeUndefined();
      expect(r.text).not.toMatch(/\$\d/);
    }
  });
  test("the client setup report (non-SOV) still shows no dollars or fee", async () => {
    const cl = await call("owner", "report", { job_number: "S-1", audience: "client" });
    expect(cl.isError).toBe(false);
    expect(cl.text).not.toMatch(/\$\d|3,897,868|584,680|210000|1010842|Fee: 15/);
    expect(cl.structured?.sov).toBeUndefined();
  });
  test("Super can't change the SOV terms", async () => {
    expect((await call("super", "intake", { section: "budget", job_number: "S-1", fee_pct: 5 })).isError).toBe(true);
    const fee = (await state.db!.query<{ sov_fee_pct: string }>(`SELECT sov_fee_pct FROM public.mcp_jobs WHERE job_number = 'S-1'`)).rows[0].sov_fee_pct;
    expect(Number(fee)).toBe(15);
  });
});

describe("owner SOV text keeps its amounts; other client output stays filtered", () => {
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  beforeAll(async () => {
    const a = await call("owner", "intake", { section: "open_item", job_number: "S-1", kind: "commercial", commercial_type: "claim", action: "Submit claim notice (§7.4) for TEST delay worth $12,345", needed_by: soon });
    expect(a.isError, a.text).toBe(false);
    const b = await call("owner", "intake", { section: "open_item", job_number: "S-1", action: "TEST owner walk, collect $5,000 deposit", needed_by: soon });
    expect(b.isError, b.text).toBe(false);
  });
  const parts = (t: string) => { const i = t.indexOf("\n\n====\n\n"); return { sweep: i < 0 ? "" : t.slice(0, i), body: i < 0 ? t : t.slice(i) }; };

  test("owner SOV (client audience): dollar figures and fee line survive in the visible text", async () => {
    const r = await call("owner", "report", { job_number: "S-1", deliverable: "sov", audience: "client" });
    expect(r.isError, r.text).toBe(false);
    const { body } = parts(r.text);
    expect(body).toMatch(/SCHEDULE OF VALUES \(for the owner/);
    expect(body).toMatch(/Contract total: \$3,897,868\.94/);
    expect(body).toMatch(/Contractor's fee: \$584,680\.34 \(15\.00%\)/);
    expect(body).toMatch(/General Conditions: \$390,000\.55/);
    expect(body).not.toMatch(/amount withheld/);
  });
  test("owner SOV: the date sweep above it is still filtered (no claim, no §7.4, amounts withheld)", async () => {
    const r = await call("owner", "report", { job_number: "S-1", deliverable: "sov", audience: "client" });
    const { sweep } = parts(r.text);
    expect(sweep).not.toMatch(/claim/i);
    expect(sweep).not.toMatch(/§\s?7\.4/);
    expect(sweep).not.toMatch(/\$\d/);
    expect(r.text).not.toMatch(/claim/i);
    expect(r.text).not.toMatch(/§\s?7\.4/);
  });
  test("internal SOV still shows the claim in its sweep (sanity: the item is in range)", async () => {
    const r = await call("owner", "report", { job_number: "S-1", deliverable: "sov" });
    expect(r.text).toMatch(/§7\.4/);
  });
  test("client setup report: no dollars, no fee, no claim text, no §7.4", async () => {
    const r = await call("owner", "report", { job_number: "S-1", audience: "client" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).not.toMatch(/\$\d/);
    expect(r.text).not.toMatch(/claim/i);
    expect(r.text).not.toMatch(/§\s?7\.4/);
    expect(r.text).not.toMatch(/\bfee\b/i);
  });
  test("a limited role asking for the owner SOV gets no amounts", async () => {
    const r = await call("super", "report", { job_number: "S-1", deliverable: "sov", audience: "client" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/\$\d/);
    expect(r.text).not.toMatch(/§\s?7\.4/);
  });
});
