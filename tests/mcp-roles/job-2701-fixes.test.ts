// Demo Job 2701 (Harbor Point MOB) fixes, Athena tester 2026-10-20. Real /mcp handler + real migrations (PGlite).
// TEST company and users on .invalid addresses only; the contract is the TEST demo subcontract (example.com contacts).
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
const q = async <T,>(sql: string, p: unknown[] = []) => (await state.db!.query<T>(sql, p)).rows;
const CONTRACT = readFileSync(join(__dirname, "fixtures/harbor-point-subcontract-2701.md"), "utf8");
function clause(section: string) {
  const line = CONTRACT.split("\n").find((l) => l.startsWith(`${section} `))!;
  const h = line.match(/^\S+\s+\*\*([^*]+?)\.\*\*/);
  return { section, heading: h ? h[1] : undefined, text: line };
}
const DOC = { contract_document_provided: true, contract_document_name: "TEST Harbor Point subcontract" };

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST Harbor Co", your_name: "Test Owner" })).isError).toBe(false);
  for (const j of ["H-1", "H-2", "H-3"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
});

describe("bug 1: notice recipient 'by email to Contractor's Project Manager'", () => {
  test("delay and claim lines name the Project Manager from §6.2 / §7.3", async () => {
    const r = await call("intake", { section: "clauses", job_number: "H-1", clauses: ["3.3", "6.2", "7.3", "10.1"].map(clause), contract_text: CONTRACT, contract_document_name: "TEST Harbor Point subcontract" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("- Delays: notice within 5 calendar days after the start of the event (§6.2); it goes to Contractor's Project Manager (§6.2).");
    expect(r.text).toContain("- Claims: notice within 10 calendar days of the event giving rise to it (§7.3); it goes to Contractor's Project Manager (§7.3).");
    expect(r.text).not.toMatch(/(Delays|Claims):[^\n]*doesn't say who it goes to/);
  });
});

describe("bugs 2, 3, 9: lookahead items, 'none' answers, no phantom lookahead", () => {
  let ref = "";
  test("a lookahead walk files its items on that lookahead, and 'None. …' opens nothing", async () => {
    // A job-setup item first: this is what used to create the hidden setup container that showed as "dates unknown".
    expect((await call("intake", { section: "open_item", job_number: "H-2", action: "TEST setup item" })).isError).toBe(false);
    const la = await call("intake", { section: "lookahead", lookahead_exists: "yes", job_number: "H-2", start_date: "2026-11-09", end_date: "2026-11-20",
      schedule_export: "TEST A1010 mobilize Nov 9-11", crews: "TEST 1 foreman", submittal_log: "TEST S-001 due Nov 19", rfi_log: "TEST RFI-001 open", inspection_list: "TEST underground Nov 19", deliveries: "TEST conduit Nov 11" });
    expect(la.isError, la.text).toBe(false);
    ref = la.text.match(/Lookahead ref: (LA-[0-9A-F]{5})/)![1];
    let listAnswers = 0;
    for (let i = 0; i < 40; i++) {
      const nq = await call("next_question", { job_number: "H-2", lookahead_id: ref });
      if (/All lookahead checks are done/.test(nq.text)) break;
      const key = (nq.structured as { check_key: string }).check_key;
      const [rule] = await q<{ rule_type: string }>(`SELECT rule_type FROM public.mcp_checklist_items WHERE key = $1 ORDER BY version DESC LIMIT 1`, [key]);
      const isList = rule.rule_type !== "confirm";
      const args: Record<string, unknown> = { job_number: "H-2", lookahead_id: ref, check_key: key };
      if (!isList) args.response = "yes";
      else args.detail = listAnswers++ === 0 ? "TEST RFI-001 conduit routing open, answer needed 2026-11-13" : "None. TEST nothing in this window blocks work.";
      const a = await call("answer", args);
      expect(a.isError, a.text).toBe(false);
      if (listAnswers > 1 && isList) expect((a.structured as { item_id: string | null }).item_id).toBeNull();
    }
    expect(listAnswers).toBeGreaterThan(1);
    const rep = await call("report", { job_number: "H-2", lookahead_id: ref });
    expect(rep.text).toMatch(/1\. HIT LIST\n\s+1\. H-2 – [^\n]*TEST RFI-001 conduit routing open/);
    expect(rep.text).not.toMatch(/TEST nothing in this window/);
  });
  test("list_open_items lists only the member's lookahead, never the setup container as 'dates unknown'", async () => {
    const r = await call("list_open_items", { job_number: "H-2" });
    expect(r.text).toContain(`${ref}: 2026-11-09 to 2026-11-20`);
    expect(r.text).not.toMatch(/dates unknown/);
    const setup = await q<{ id: string }>(`SELECT l.id FROM public.mcp_lookaheads l JOIN public.mcp_jobs j ON j.id = l.job_id WHERE j.job_number = 'H-2' AND l.inputs->>'kind' = 'setup'`);
    const pre = `LA-${setup[0].id.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
    expect((await call("report", { job_number: "H-2", lookahead_id: pre })).text).toMatch(/Lookahead not found/);
  });
});

describe("bug 8: scope partial update merges; 'None' beneficial use is OFF", () => {
  test("sending one scope field keeps the others and their flags", async () => {
    expect((await call("intake", { section: "scope", job_number: "H-3", job_type: "TEST Electrical", sector: "private_commercial", pricing_model: "lump_sum", position: "sub",
      key_clauses: { retainage: "yes", beneficial_use: "no", liquidated_damages: "yes", notice: "yes" }, major_equipment: ["TEST switchgear"] })).isError).toBe(false);
    const r = await call("intake", { section: "scope", job_number: "H-3", scope_summary: "TEST complete electrical" });
    expect(r.isError, r.text).toBe(false);
    const facts = await q<{ key: string; status: string }>(`SELECT f.key, f.status FROM public.mcp_job_facts f JOIN public.mcp_jobs j ON j.id = f.job_id WHERE j.job_number = 'H-3' AND f.module = 'scope'`);
    const st = Object.fromEntries(facts.map((f) => [f.key, f.status]));
    for (const k of ["job_type", "sector", "pricing_model", "position", "key_clauses", "major_equipment", "scope_summary"]) expect(st[k], k).toBe("known");
    const flags = Object.fromEntries((await q<{ flag_key: string; value: string }>(`SELECT f.flag_key, f.value FROM public.mcp_job_flags f JOIN public.mcp_jobs j ON j.id = f.job_id WHERE j.job_number = 'H-3'`)).map((f) => [f.flag_key, f.value]));
    expect(flags.pricing_lump_sum).toBe("yes");
    expect(flags.sub_position).toBe("yes");
    expect(flags.has_retainage).toBe("yes");
    expect(flags.major_equipment).toBe("yes");
  });
  test("contract beneficial use 'None in the subcontract.' reads OFF", async () => {
    const r = await call("intake", { section: "contract", job_number: "H-3", ...DOC, beneficial_use_clause: "None in the subcontract." });
    expect(r.isError, r.text).toBe(false);
    const [f] = await q<{ value: string }>(`SELECT f.value FROM public.mcp_job_flags f JOIN public.mcp_jobs j ON j.id = f.job_id WHERE j.job_number = 'H-3' AND f.flag_key = 'beneficial_use'`);
    expect(f.value).toBe("no");
  });
});

describe("bugs 5, 6: client copy and warranty source", () => {
  test("warranty values read from the contract are not tagged manual", async () => {
    const r = await call("intake", { section: "warranty", job_number: "H-3", ...DOC, workmanship_warranty: "yes", workmanship_warranty_months: 12, warranty_start_trigger: "substantial_completion", warranty_start_basis: "§8.1 Workmanship Warranty" });
    expect(r.isError, r.text).toBe(false);
    const reg = r.text.slice(r.text.indexOf("WARRANTY REGISTER"));
    expect(reg).toMatch(/Workmanship warranty: [^\n]*summary, not verified against the contract text/);
    expect(reg).not.toMatch(/Workmanship warranty:[^\n]*\(manual\)/);
    const [row] = await q<{ source: string }>(`SELECT f.source FROM public.mcp_job_facts f JOIN public.mcp_jobs j ON j.id = f.job_id WHERE j.job_number = 'H-3' AND f.module = 'warranty' AND f.key = 'workmanship_warranty'`);
    expect(row.source).toBe("document");
  });
  test("typed warranty answers stay manual", async () => {
    const r = await call("intake", { section: "warranty", job_number: "H-2", workmanship_warranty: "yes", workmanship_warranty_months: 12 });
    expect(r.text).toMatch(/Workmanship warranty: [^\n]*\(manual\)/);
  });
  test("client report: no contact emails or phones (internal keeps them); no summary tag; internal keeps both", async () => {
    expect((await call("intake", { section: "contract", job_number: "H-3", ...DOC, retainage: "§4.1 10% until the Work is 50% complete." })).isError).toBe(false);
    expect((await call("intake", { section: "open_item", job_number: "H-3", action: "TEST confirm gear delivery with supplier contact Dana (dana.test@example.com, 361-555-0142)" })).isError).toBe(false);
    const client = (await call("report", { job_number: "H-3", audience: "client" })).text;
    expect(client).toMatch(/retainage: §4\.1 10% until the Work is 50% complete\./);
    expect(client).not.toMatch(/summary, not verified/);
    expect(client).toMatch(/supplier contact Dana/);
    expect(client).not.toMatch(/@|555-0142/);
    const internal = (await call("report", { job_number: "H-3" })).text;
    expect(internal).toMatch(/retainage: [^\n]*\(summary, not verified against the contract text\)/);
    expect(internal).toContain("dana.test@example.com");
  });
});
