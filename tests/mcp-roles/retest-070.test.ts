// Retest 0.7.0 (Claude): closing fills the field, no claim items client-side, warranty start conflict, notices on their own line, PM note, closeout source, no-job listing.
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
const refOf = (text: string, needle: string) => {
  const line = text.split("\n").find((l) => l.includes(needle) && /Ref [A-Z0-9]+\s*$/.test(l));
  return line?.match(/Ref ([A-Z0-9]+)\s*$/)?.[1];
};

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST Athena Co", your_name: "Test Owner" })).isError).toBe(false);
  for (const j of ["W-1", "W-2", "C-1", "N-1"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
});

describe("1. closing a warranty confirm item fills the field", () => {
  test("manufacturer warranties leaves UNKNOWNS once its item is closed", async () => {
    await call("intake", { section: "warranty", job_number: "W-1", workmanship_warranty: "yes", workmanship_warranty_months: 12, warranty_start_trigger: "substantial_completion" });
    let rep = await call("report", { job_number: "W-1", audience: "internal" });
    expect(rep.text).toContain("Manufacturer warranties to collect: unknown");
    const list = await call("list_open_items", { job_number: "W-1" });
    const ref = refOf(list.text, "Confirm manufacturer warranties to collect");
    expect(ref).toBeTruthy();
    const r = await call("resolve_item", { job_number: "W-1", item_id: ref, kind: "member_statement", evidence: "TEST DATA: RTU and VRF manufacturer warranties, per Casey Lin on 2026-10-19", stated_on: "2026-10-19" });
    expect(r.text).toContain("Item closed");
    rep = await call("report", { job_number: "W-1", audience: "internal" });
    expect(rep.text).toContain("Manufacturer warranties to collect: TEST DATA: RTU and VRF manufacturer warranties");
    expect(rep.text).not.toMatch(/warranty: manufacturer warranties/);
  });
});

describe("3. warranty start conflict is flagged, not picked", () => {
  test("trigger, basis and contract clause disagree: register line + open item", async () => {
    await call("intake", { section: "contract", job_number: "W-2", warranty_clauses: "§8.1: one year from Owner acceptance of the Work" });
    const r = await call("intake", { section: "warranty", job_number: "W-2", workmanship_warranty: "yes", workmanship_warranty_months: 12,
      warranty_start_trigger: "final_acceptance", warranty_start_basis: "Certificate of substantial completion" });
    expect(r.text).toContain("Warranty start conflict");
    expect(r.text).toContain("warranty start date basis answer: substantial completion");
    expect(r.text).toContain("Starts at: final acceptance");
    const list = await call("list_open_items", { job_number: "W-2" });
    expect(list.text).toContain("Resolve the warranty start conflict");
  });
});

describe("6/7/8. notices, PM note, closeout source", () => {
  test("each open-item notice is on its own line; with no PM the note says so", async () => {
    const r = await call("intake", { section: "warranty", job_number: "C-1", workmanship_warranty: "yes" });
    const last = r.text.split("\n").find((l) => l.includes("Other closeout expectations"))!;
    expect(last).not.toContain("Open item created");
    expect(r.text).toMatch(/\n- Open item created/);
    expect(r.text).toContain("no PM is set on this job, so it stays unassigned");
  });
  test("with a PM set the note says it defaulted to the PM, not 'no PM'", async () => {
    await call("intake", { section: "job_settings", job_number: "N-1", pm: "Sam Ortiz", pm_email: "sam.ortiz@example.invalid" });
    const r = await call("intake", { section: "open_item", job_number: "N-1", action: "Confirm submittal recipients" });
    expect(r.text).toContain("defaulted to the job's PM");
    expect(r.text).not.toContain("no PM");
  });
  test("closeout documents copied from the contract carry the contract's source everywhere", async () => {
    await call("intake", { section: "contract", job_number: "N-1", closeout: "O&M manuals, as-builts, attic stock" });
    const w = await call("intake", { section: "warranty", job_number: "N-1", workmanship_warranty: "no" });
    const rep = await call("report", { job_number: "N-1", audience: "internal" });
    const tag = (t: string) => t.split("\n").find((l) => l.includes("Required closeout documents"))?.match(/\(([^)]+)\)\s*$/)?.[1];
    expect(tag(w.text)).toBeTruthy();
    expect(tag(w.text)).toBe(tag(rep.text));
  });
});

describe("2. client output leaves out claim items", () => {
  test("claim notice shows internally, not in the client report", async () => {
    await call("intake", { section: "contract", job_number: "C-1", notice_timing: "§6.4: written notice within three (3) calendar days", claim_process: "§7.4: claim notice within 7 calendar days" });
    await call("intake", { section: "delay_event", job_number: "C-1", delay_description: "TEST DATA lighting rough-in slipped", delay_start_date: new Date().toISOString().slice(0, 10), delay_days: 5 });
    const internal = await call("report", { job_number: "C-1", audience: "internal" });
    expect(internal.text).toMatch(/Submit claim notice \(§7\.4\)/);
    const client = await call("report", { job_number: "C-1", audience: "client" });
    expect(client.text).not.toMatch(/claim notice/i);
    expect(client.text).toMatch(/Send written delay notice/);
  });
});

describe("9. no job named: Athena lists companies and jobs", () => {
  test("list_open_items without job_number", async () => {
    const r = await call("list_open_items", {});
    expect(r.isError).toBe(false);
    expect(r.text).toContain("TEST Athena Co: C-1");
    expect(r.text).toContain("W-2");
  });
});
