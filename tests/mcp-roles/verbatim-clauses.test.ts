// Verbatim contract clauses (0021): Job 2603 fixture from the sample subcontract.
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

/** "6.4 **Delay Notice.** text" -> { section, heading, text } exactly as printed (markdown kept). */
function clauseFromContract(section: string) {
  const line = CONTRACT.split("\n").find((l) => l.startsWith(`${section} `));
  if (!line) throw new Error(`no §${section}`);
  const body = line.slice(section.length + 1);
  const h = body.match(/^\*\*([^*]+?)\.\*\*\s*/);
  return { section, heading: h ? h[1] : undefined, text: h ? body.slice(h[0].length) : body };
}
const plain = (s: string) => s.replace(/\*\*/g, "");
// The ten notice and time clauses Athena needs from this contract (no §8.3 exists in it).
const SECTIONS = ["3.3", "3.4", "4.2", "5.1", "5.2", "6.3", "6.4", "7.4", "8.1", "11.1"];
const EXPECT: Record<string, { category: string; n_days: number | null; day_type: string | null }> = {
  "3.3": { category: "other", n_days: 7, day_type: null },
  "3.4": { category: "nonpayment_notice", n_days: 10, day_type: null },
  "4.2": { category: "other", n_days: 30, day_type: null },
  "5.1": { category: "other", n_days: 21, day_type: "calendar" },
  "5.2": { category: "other", n_days: 10, day_type: "calendar" },
  "6.3": { category: "schedule_disagreement", n_days: null, day_type: null },
  "6.4": { category: "delay_notice", n_days: 3, day_type: "calendar" },
  "7.4": { category: "claim_notice", n_days: 7, day_type: "calendar" },
  "8.1": { category: "other", n_days: null, day_type: null },
  "11.1": { category: "cure_notice", n_days: 3, day_type: "working" },
};
const rows = async (job: string) =>
  (await state.db!.query<{ section: string; heading: string | null; category: string; verbatim_text: string; n_days: number | null; day_type: string | null; source: string }>(
    `SELECT c.section, c.heading, c.category, c.verbatim_text, c.n_days, c.day_type, c.source FROM public.mcp_contract_clauses c JOIN public.mcp_jobs j ON j.id = c.job_id WHERE j.job_number = $1`, [job])).rows;

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST ALP Construction", your_name: "Test Owner" })).isError).toBe(false);
  for (const j of ["2603", "V-2", "V-3"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
});

describe("Job 2603 fixture: all ten clauses verbatim and correct", () => {
  test("saved word for word, verified against the contract, parsed from their own text", async () => {
    // Half passed with the contract's markdown, half as plain text: both must verify.
    const clauses = SECTIONS.map((s, i) => { const c = clauseFromContract(s); return i % 2 ? { ...c, text: plain(c.text) } : c; });
    const r = await call("intake", { section: "clauses", job_number: "2603", contract_document_name: "RB-2611-16E", contract_text: CONTRACT, clauses });
    expect(r.isError).toBe(false);
    const got = await rows("2603");
    expect(got.map((g) => g.section).sort()).toEqual([...SECTIONS].sort());
    for (const c of clauses) {
      const g = got.find((x) => x.section === c.section)!;
      expect(g.verbatim_text).toBe(c.text);
      expect(g.source).toBe("document");
      expect(plain(CONTRACT)).toContain(plain(g.verbatim_text));
      expect({ category: g.category, n_days: g.n_days, day_type: g.day_type }).toEqual(EXPECT[c.section]);
    }
    expect(got.some((g) => g.section === "8.3")).toBe(false);
    expect(r.text).not.toContain("Missing from the contract clauses");
  });
  test("reports and contract_terms print §X Heading: ‹exact text›; no §8.3 anywhere", async () => {
    const ct = await call("contract_terms", { job_number: "2603" });
    const d64 = clauseFromContract("6.4");
    expect(ct.text).toContain(`§6.4 Delay Notice: ‹${d64.text}› (document)`);
    expect(ct.text).toContain(`§7.4 Claim Notice: ‹${plain(clauseFromContract("7.4").text)}› (document)`);
    const internal = await call("report", { job_number: "2603", audience: "internal" });
    expect(internal.text).toContain(`§6.4 Delay Notice: ‹${d64.text}›`);
    expect(internal.text).toContain("§7.4 Claim Notice:");
    for (const t of [ct.text, internal.text]) expect(t).not.toMatch(/§\s?8\.3/);
  });
  test("client report drops the claim clause whole and keeps the delay notice whole", async () => {
    const client = await call("report", { job_number: "2603", audience: "client" });
    expect(client.text).not.toMatch(/§7\.4|Claim Notice|claim for additional/i);
    expect(client.text).toContain(`§6.4 Delay Notice: ‹${clauseFromContract("6.4").text}›`);
  });
  test("due dates come from each clause's own days", async () => {
    const r = await call("intake", { section: "delay_event", job_number: "2603", delay_description: "TEST DATA lighting rough-in delayed", delay_start_date: "2026-10-19", delay_days: 21 });
    expect(r.text).toContain("Delay notice: due 2026-10-22 (2026-10-19 + 3 calendar days = 2026-10-22, §6.4)");
    expect(r.text).toContain("Claim notice: due 2026-10-26 (2026-10-19 + 7 calendar days = 2026-10-26, §7.4)");
  });
});

describe("unverified and missing clauses are flagged, never filled in", () => {
  test("a paraphrased clause is UNVERIFIED with an open item; missing notices open confirm items", async () => {
    const r = await call("intake", { section: "clauses", job_number: "V-2", contract_text: CONTRACT,
      clauses: [{ section: "6.4", heading: "Delay Notice", text: "written delay notice within 3 calendar days after start of event" }] });
    expect(r.text).toContain("UNVERIFIED");
    const got = await rows("V-2");
    expect(got).toHaveLength(1);
    expect(got[0].source).toBe("unverified");
    const list = await call("list_open_items", { job_number: "V-2" });
    expect(list.text).toContain("Check §6.4 wording against the contract");
    for (const m of ["claim notice", "notice of non-payment", "notice to cure", "notice of schedule disagreement"]) expect(list.text).toContain(`Confirm the contract's ${m}`);
    expect(list.text).not.toContain("Confirm the contract's delay notice");
  });
  test("with no contract text on file every clause is unverified", async () => {
    const r = await call("intake", { section: "clauses", job_number: "V-3", clauses: [clauseFromContract("6.4")] });
    expect(r.text).toContain("No contract text on file");
    expect((await rows("V-3"))[0].source).toBe("unverified");
  });
  test("adding the real text later verifies it and closes its item", async () => {
    await call("intake", { section: "clauses", job_number: "V-2", contract_text: CONTRACT, clauses: [clauseFromContract("6.4")] });
    expect((await rows("V-2"))[0].source).toBe("document");
    const list = await call("list_open_items", { job_number: "V-2" });
    expect(list.text).not.toContain("Check §6.4 wording");
  });
});
