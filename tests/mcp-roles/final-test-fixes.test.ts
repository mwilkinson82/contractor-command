// Final E2E fixes (Grok run 2026-10-20): lookahead refs, verified clauses kept, evidence prompt, lookahead not found.
// Real /mcp handler + real migrations (PGlite). TEST company and users on .invalid addresses only.
import { describe, test, expect, vi, beforeAll } from "vitest";
vi.mock("../../src/lib/mcp/supabase", async () => ({ supabaseForUser: (await import("./harness")).mockedSupabaseForUser }));
vi.mock("../../src/lib/mcp/allowlist", async () => {
  const h = await import("./harness");
  return { MCP_ALLOWED_EMAILS: new Set(["owner", "pm", "super"].map((r) => h.user(r as never).email)) };
});
vi.mock("../../src/integrations/supabase/client.server", async () => {
  const h = await import("./harness");
  const f = await import("./fake-supabase");
  return { get supabaseAdmin() { const u = h.user("owner"); return f.fakeClient(h.state.db!, { sub: u.id, email: u.email, role: "service_role" }); } };
});
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import mcp from "../../src/lib/mcp/index";
import { setLogLevel } from "@lovable.dev/mcp-js";
setLogLevel("error");
import { bootDb, setupKeysAndFetch, callTool, state } from "./harness";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (name: string, args: Record<string, unknown>) => {
  if (state.db) await state.db.exec(`DELETE FROM public.mcp_call_log`);
  return callTool(handler, await tok("owner"), name, args);
};
const CONTRACT = readFileSync(join(__dirname, "fixtures/sample-subcontract-2603.md"), "utf8");
function clauseFromContract(section: string) {
  const line = CONTRACT.split("\n").find((l) => l.startsWith(`${section} `))!;
  const body = line.slice(section.length + 1);
  const h = body.match(/^\*\*([^*]+?)\.\*\*\s*/);
  return { section, heading: h ? h[1] : undefined, text: h ? body.slice(h[0].length) : body };
}
const q = async <T,>(sql: string, p: unknown[] = []) => (await state.db!.query<T>(sql, p)).rows;
const laRef = (t: string) => t.match(/Lookahead ref: (LA-[0-9A-F]{5})/)?.[1];

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST Final Co", your_name: "Test Owner" })).isError).toBe(false);
  for (const j of ["F-1", "F-2"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
});

describe("lookahead refs (BLOCKER: carry_forward had no usable id)", () => {
  let a = "", b = "";
  test("intake prints a short lookahead ref when one is created", async () => {
    const r1 = await call("intake", { section: "lookahead", lookahead_exists: "yes", job_number: "F-1", start_date: "2026-10-12", end_date: "2026-10-25" });
    const r2 = await call("intake", { section: "lookahead", lookahead_exists: "yes", job_number: "F-1", start_date: "2026-10-19", end_date: "2026-11-01" });
    expect(r1.isError, r1.text).toBe(false);
    a = laRef(r1.text)!; b = laRef(r2.text)!;
    expect(a).toMatch(/^LA-[0-9A-F]{5}$/);
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect((r1.structured as any).lookahead_ref).toBe(a);
    expect(r1.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
  test("list_open_items shows each lookahead's ref", async () => {
    const r = await call("list_open_items", { job_number: "F-1" });
    expect(r.text).toContain(`${a}: 2026-10-12 to 2026-10-25`);
    expect(r.text).toContain(`${b}: 2026-10-19 to 2026-11-01`);
  });
  test("carry_forward accepts the printed refs and moves the open items", async () => {
    const it = await call("intake", { section: "open_item", job_number: "F-1", action: "TEST confirm crane date" });
    expect(it.isError, it.text).toBe(false);
    const [from] = await q<{ id: string }>(`SELECT id FROM public.mcp_lookaheads WHERE start_date = '2026-10-12'`);
    await q(`UPDATE public.mcp_open_items SET lookahead_id = $1 WHERE action LIKE '%TEST confirm crane date%'`, [from.id]);
    const r = await call("carry_forward", { job_number: "F-1", from_lookahead_id: a, to_lookahead_id: `Lookahead ref ${b}` });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain(`1 open item(s) carried forward from ${a} to ${b}`);
    const l = await call("list_open_items", { job_number: "F-1", lookahead_id: b.toLowerCase() });
    expect(l.text).toMatch(/TEST confirm crane date/);
    expect(l.text).toContain(`Lookahead ${b}`);
  });
  test("the same ref twice is refused; a ref from another job is not found", async () => {
    expect((await call("carry_forward", { job_number: "F-1", from_lookahead_id: a, to_lookahead_id: a })).text).toMatch(/must be different/);
    const r = await call("carry_forward", { job_number: "F-2", from_lookahead_id: a, to_lookahead_id: b });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Lookahead not found/);
  });
  test("next_question and report also take the ref", async () => {
    expect((await call("next_question", { job_number: "F-1", lookahead_id: b })).isError).toBe(false);
    const rep = await call("report", { job_number: "F-1", lookahead_id: b });
    expect(rep.isError).toBe(false);
    expect(rep.text).toContain(`Lookahead ref: ${b}`);
  });
});

describe("list_open_items: unknown lookahead says not found", () => {
  test("nonexistent uuid, zero uuid and a bad ref are all 'not found', never 'No open items'", async () => {
    for (const id of ["00000000-0000-0000-0000-000000000000", "11111111-2222-4333-8444-555555555555", "LA-FFFFF", "nonsense"]) {
      const r = await call("list_open_items", { job_number: "F-1", lookahead_id: id });
      expect(r.isError, id).toBe(true);
      expect(r.text, id).toMatch(/Lookahead not found/);
      expect(r.text).not.toMatch(/No open items/);
    }
  });
});

describe("intake clauses: verified text is never overwritten", () => {
  test("a reworded §7.4 keeps the verified contract text and opens a flag item", async () => {
    const exact = clauseFromContract("7.4");
    expect((await call("intake", { section: "clauses", job_number: "F-2", contract_text: CONTRACT, clauses: [exact] })).isError).toBe(false);
    const para = "Claims must be sent in writing within about a week or they are waived.";
    const r = await call("intake", { section: "clauses", job_number: "F-2", clauses: [{ section: "7.4", heading: "Claim Notice", text: para }] });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/Kept the verified contract text for §7\.4/);
    expect(r.text).not.toMatch(/UNVERIFIED/);
    const [row] = await q<{ verbatim_text: string; source: string }>(`SELECT c.verbatim_text, c.source FROM public.mcp_contract_clauses c JOIN public.mcp_jobs j ON j.id = c.job_id WHERE j.job_number = 'F-2' AND c.section = '7.4'`);
    expect(row).toEqual({ verbatim_text: exact.text, source: "document" });
    const items = await q<{ check_key: string; why: string; internal_only: boolean }>(`SELECT i.check_key, i.why, i.internal_only FROM public.mcp_open_items i JOIN public.mcp_jobs j ON j.id = i.job_id WHERE j.job_number = 'F-2' AND i.status = 'open' AND i.check_key LIKE 'clause_%7.4'`);
    expect(items.map((i) => i.check_key)).toEqual(["clause_reworded:7.4"]);
    expect(items[0].why).toContain(para);
    expect(items[0].internal_only).toBe(true);
  });
  test("a clause that was never verified can still be replaced", async () => {
    await call("intake", { section: "clauses", job_number: "F-2", clauses: [{ section: "9.9", heading: "TEST", text: "TEST first wording not in contract." }] });
    await call("intake", { section: "clauses", job_number: "F-2", clauses: [{ section: "9.9", heading: "TEST", text: "TEST second wording not in contract." }] });
    const [row] = await q<{ verbatim_text: string }>(`SELECT c.verbatim_text FROM public.mcp_contract_clauses c JOIN public.mcp_jobs j ON j.id = c.job_id WHERE j.job_number = 'F-2' AND c.section = '9.9'`);
    expect(row.verbatim_text).toBe("TEST second wording not in contract.");
  });
  test("re-sending the exact verified text is a normal save", async () => {
    const r = await call("intake", { section: "clauses", job_number: "F-2", clauses: [clauseFromContract("7.4")] });
    expect(r.text).not.toMatch(/Kept the verified/);
  });
});

describe("resolve_item: evidence prompt matches the rule", () => {
  test("a general 'to confirm' item asks for evidence only, and a member statement is still refused", async () => {
    const it = await call("intake", { section: "open_item", job_number: "F-2", action: "TEST check the deadline cited as §8.3", item_type: "unknown" });
    expect(it.isError, it.text).toBe(false);
    const l = await call("list_open_items", { job_number: "F-2" });
    const line = l.text.split("\n").find((x) => x.includes("[To confirm]") && x.includes("TEST check the deadline cited as §8.3"))!;
    expect(line).toMatch(/Needs evidence \(a document or record\); a member statement won't close it/);
    expect(line).not.toMatch(/dated member statement/);
    const ref = (it.structured as any).items[0].item_ref.slice(1, 6).toUpperCase();
    const r = await call("resolve_item", { job_number: "F-2", item_id: ref, kind: "member_statement", evidence: "PM confirmed by phone that §6.4 governs.", stated_on: "2026-10-20" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/only closes a confirm item/);
  });
  test("a confirm item still offers a dated member statement", async () => {
    const l = await call("list_open_items", { job_number: "F-2" });
    const line = l.text.split("\n").find((x) => x.includes("[To confirm]") && /Confirm the contract's/.test(x))!;
    expect(line).toMatch(/Needs confirming evidence or a dated member statement/);
  });
});

describe("client report: internal follow-up dates stay internal", () => {
  test("Client-Facing Open Items keep contract dates and drop Athena's 'Needed by' dates", async () => {
    await call("intake", { section: "create_job", job_number: "F-3", job_name: "TEST F-3" });
    const d = await call("intake", { section: "deadline", job_number: "F-3", clause_key: "completion", clause_ref: "§5.1", label: "TEST substantial completion", fixed_date: "2026-12-04" });
    expect(d.isError, d.text).toBe(false);
    const o = await call("intake", { section: "open_item", job_number: "F-3", action: "TEST confirm owner walk date", needed_by: "2026-10-22" });
    expect(o.isError, o.text).toBe(false);
    const internal = await call("report", { job_number: "F-3" });
    expect(internal.text).toContain("Needed by: 2026-10-22");
    const cl = await call("report", { job_number: "F-3", audience: "client" });
    expect(cl.isError, cl.text).toBe(false);
    const body = cl.text.slice(cl.text.indexOf("\n\n====\n\n"));
    const walk = body.split("\n").find((l) => l.includes("TEST confirm owner walk date"))!;
    expect(walk).toBeTruthy();
    expect(walk).not.toMatch(/Needed by|2026-10-22/);
    const comp = body.split("\n").find((l) => l.includes("TEST substantial completion") && l.includes("Accountable"))!;
    expect(comp).toMatch(/Contract due date: 2026-12-04/);
    expect(body).not.toMatch(/Needed by/);
  });
});

describe("retest 2: client date sweep and lookahead order", () => {
  test("client date sweep: contract dates only, no Accountable; internal sweep unchanged", async () => {
    await call("intake", { section: "create_job", job_number: "F-4", job_name: "TEST F-4" });
    await call("intake", { section: "job_settings", job_number: "F-4", time_zone: "America/Chicago" });
    const soon = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    expect((await call("intake", { section: "deadline", job_number: "F-4", clause_key: "completion", clause_ref: "§5.2", label: "TEST long-lead submittals", fixed_date: soon(5) })).isError).toBe(false);
    expect((await call("intake", { section: "open_item", job_number: "F-4", action: "TEST follow up on owner walk", needed_by: soon(2) })).isError).toBe(false);
    const internal = await call("report", { job_number: "F-4" });
    const iSweep = internal.text.slice(0, internal.text.indexOf("\n\n====\n\n"));
    expect(iSweep).toMatch(/TEST follow up on owner walk.*\| Accountable:/);
    const cl = await call("report", { job_number: "F-4", audience: "client" });
    const cSweep = cl.text.slice(0, cl.text.indexOf("\n\n====\n\n"));
    expect(cSweep).toMatch(/TEST long-lead submittals \(§5\.2\)/);
    expect(cSweep).not.toMatch(/TEST follow up on owner walk/);
    expect(cSweep).not.toMatch(/Accountable/);
    expect(cSweep).not.toMatch(/Confirm delivery method/);
  });
  test("Lookaheads list sorts by window, newest first; undated last", async () => {
    await call("intake", { section: "create_job", job_number: "F-5", job_name: "TEST F-5" });
    for (const [s, e] of [["2026-10-19", "2026-11-01"], ["2026-10-12", "2026-10-25"], [null, null], ["2026-10-26", "2026-11-08"]] as const)
      expect((await call("intake", { section: "lookahead", lookahead_exists: "yes", job_number: "F-5", ...(s ? { start_date: s, end_date: e } : {}) })).isError).toBe(false);
    const r = await call("list_open_items", { job_number: "F-5" });
    const block = r.text.slice(r.text.indexOf("Lookaheads (newest first):")).split("\n").filter((l) => l.startsWith("- LA-")).map((l) => l.replace(/^- LA-[0-9A-F]{5}: /, ""));
    expect(block.slice(0, 3)).toEqual(["2026-10-26 to 2026-11-08", "2026-10-19 to 2026-11-01", "2026-10-12 to 2026-10-25"]);
    expect(block.slice(3).length).toBeGreaterThan(0);
    expect(block.slice(3).every((l) => l === "dates unknown")).toBe(true);
  });
});
