// Legacy contract terms with no clause rows: tagged as summary, and Missing lines say items open later.
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


const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (name: string, args: Record<string, unknown>) => {
  if (state.db) await state.db.exec(`DELETE FROM public.mcp_call_log`);
  return callTool(handler, await tok("owner"), name, args);
};
beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST ALP Construction", your_name: "Test Owner" })).isError).toBe(false);
  expect((await call("intake", { section: "create_job", job_number: "L-1", job_name: "TEST L-1" })).isError).toBe(false);
  const r = await call("intake", { section: "contract", job_number: "L-1", contract_document_provided: true, contract_document_name: "TEST sub.pdf",
    notice_timing: "§6.4 written delay notice within 3 calendar days; §7.4 claim notice within 7 calendar days", retainage: "§4.1 10% to 50%, then 5%" });
  expect(r.isError).toBe(false);
});
const TAG = "(summary, not verified against the contract text)";

describe("legacy contract terms before any clause rows", () => {
  test("contract_terms tags them as summary, never (document), and Missing lines don't claim items exist", async () => {
    const r = await call("contract_terms", { job_number: "L-1" });
    expect(r.text).toContain(`- retainage: §4.1 10% to 50%, then 5% ${TAG}`);
    expect(r.text).toContain(`notice timing: §6.4 written delay notice within 3 calendar days; §7.4 claim notice within 7 calendar days ${TAG}`);
    expect(r.text).not.toMatch(/^- (retainage|notice timing):.*\(document\)$/m);
    expect(r.text).toContain("- Missing: delay notice (a confirm item opens once the contract clauses are recorded)");
    expect(r.text).not.toContain("open item asks to confirm it");
    const items = await call("list_open_items", { job_number: "L-1" });
    expect(items.text).not.toMatch(/Confirm the contract'?s? (delay|claim)/i);
  });
  test("internal report tags them as summary; client report is unchanged and has no §7.4", async () => {
    const i = await call("report", { job_number: "L-1", audience: "internal" });
    expect(i.text).toContain(`   - retainage: §4.1 10% to 50%, then 5% ${TAG}`);
    expect(i.text).toContain(`notice timing: §6.4`);
    expect(i.text).not.toMatch(/^\s+- (retainage|notice timing):.*\(document\)$/m);
    const c = await call("report", { job_number: "L-1", audience: "client" });
    expect(c.text).not.toContain("§7.4");
    expect(c.text).toContain("   - retainage: §4.1 10% to 50%, then 5% (document)");
  });
  test("once a clause row exists, Missing lines point at real open items", async () => {
    const s = await call("intake", { section: "clauses", job_number: "L-1", clauses: [{ section: "6.4", heading: "Delay Notice", text: "Subcontractor shall give written notice of any delay within three (3) calendar days after the start of the event." }] });
    expect(s.isError).toBe(false);
    const r = await call("contract_terms", { job_number: "L-1" });
    expect(r.text).toContain("- Missing: claim notice (open item asks to confirm it)");
    expect(r.text).not.toContain("a confirm item opens once");
    expect(r.text).not.toContain(TAG);
  });
});
