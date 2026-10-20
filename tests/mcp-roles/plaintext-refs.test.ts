// Live test 10/19 PM from a plain-text host (no structuredContent): refs on every line, readable question refs,
// version line, real sources on the client report, and company choice by name. TEST data on .invalid addresses only.
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

const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (name: string, args: Record<string, unknown>) => {
  if (state.db) await state.db.exec(`DELETE FROM public.mcp_call_log`);
  return callTool(handler, await tok("owner"), name, args);
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST Athena Co", your_name: "Test Owner" })).isError).toBe(false);
  for (const j of ["PT-1", "PT-2", "PT-3"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
});

describe("fix 1: plain-text refs", () => {
  test("each open-item line carries a short ref, and resolve_item takes it as shown", async () => {
    await call("intake", { section: "open_item", job_number: "PT-1", action: "Confirm fixture submittal", needed_by: "2026-10-28" });
    const list = await call("list_open_items", { job_number: "PT-1" });
    expect(list.text).not.toMatch(UUID);
    expect(list.text).not.toMatch(/\[ref #|type (?:deadline|unknown)/);
    const line = list.text.split("\n").find((l) => l.startsWith("- [") && l.includes("Confirm fixture submittal"))!;
    const ref = line.match(/\| (Ref [A-Z0-9]+)$/)?.[1];
    expect(ref, line).toBeTruthy();
    const r = await call("resolve_item", { job_number: "PT-1", item_id: ref, kind: "verified", evidence: "Approved submittal transmittal ST-014 dated 2026-10-19" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/Item closed/);
    // bare code without "Ref" works too, lowercase included
    await call("intake", { section: "open_item", job_number: "PT-1", action: "Confirm panel schedule", needed_by: "2026-10-29" });
    const l2 = (await call("list_open_items", { job_number: "PT-1" })).text.split("\n").find((l) => l.startsWith("- [") && l.includes("Confirm panel schedule"))!;
    const code = l2.match(/Ref ([A-Z0-9]+)$/)![1].toLowerCase();
    const u = await call("resolve_item", { job_number: "PT-1", item_id: code, kind: "update", evidence: "Still waiting on the engineer", stated_on: "2026-10-19" });
    expect(u.isError, u.text).toBe(false);
  });

  test("setup questions show a readable question ref that answer accepts", async () => {
    const q = await call("next_question", { job_number: "PT-2" });
    const shown = q.text.match(/^Question ref: ([a-z0-9-]+)$/m)?.[1];
    expect(shown, q.text).toBeTruthy();
    expect(q.text).not.toMatch(/check_key|[a-z]+_[a-z]+/);
    const a = await call("answer", { job_number: "PT-2", check_key: `Ref ${shown}`, response: "yes" });
    expect(a.isError, a.text).toBe(false);
    const q2 = await call("next_question", { job_number: "PT-2" });
    expect(q2.text).not.toContain(`Question ref: ${shown}\n`);
  });
});

describe("fix 2: version", () => {
  test("onboarding shows Athena v0.7.1", async () => {
    expect((await call("onboarding", { action: "read" })).text).toMatch(/^Athena v0\.7\.1$/m);
  });
});

describe("fix 3: client report sources", () => {
  test("contract terms show their real source; unknowns carry no source tag", async () => {
    expect((await call("intake", { section: "contract", job_number: "PT-3", contract_document_provided: true, contract_document_name: "TEST Subcontract PT-3.pdf",
      retainage: "§4.1 10% through 50% completion", closeout: "§9.1 O&M manuals, as-builts, warranties" })).isError).toBe(false);
    const rep = await call("report", { job_number: "PT-3", audience: "client" });
    expect(rep.text).toMatch(/closeout: §9\.1 O&M manuals, as-builts, warranties$/m);
    expect(rep.text).not.toMatch(/summary, not verified/); // client copy drops the internal tag (Marshall 2026-10-20)
    expect(rep.text).not.toMatch(/: unknown \(manual\)/);
    expect(rep.text).not.toMatch(/Required closeout documents: .*\(manual\)/);
    // Copied from the contract closeout summary: summary tag internally, never (document); the client copy shows no tag.
    expect(rep.text).toMatch(/Required closeout documents: §9\.1 O&M manuals, as-builts, warranties$/m);
    const internal = await call("report", { job_number: "PT-3", audience: "internal" });
    expect(internal.text).toMatch(/Required closeout documents: §9\.1 O&M manuals, as-builts, warranties \(summary, not verified against the contract text\)/);
    for (const t of [rep.text, internal.text]) expect(t).not.toMatch(/^\s+- (?!has |bonded|is |self perform|notice requirements|§)[^\n]*\(document\)$/m);
    expect(rep.text).toMatch(/pay terms: unknown$/m);
  });
});

describe("fix 4: more than one company", () => {
  test("the error names the companies and nothing defaults; the name works as company_id", async () => {
    expect((await call("onboarding", { action: "save_company", name: "TEST Second Co", your_name: "Test Owner" })).isError).toBe(false);
    const e = await call("list_open_items", { job_number: "PT-1" });
    expect(e.isError).toBe(true);
    expect(e.text).toMatch(/TEST Athena Co/);
    expect(e.text).toMatch(/TEST Second Co/);
    expect(e.text).not.toMatch(UUID);
    const ok = await call("list_open_items", { job_number: "PT-1", company_id: "test athena co" });
    expect(ok.isError, ok.text).toBe(false);
  });
});
