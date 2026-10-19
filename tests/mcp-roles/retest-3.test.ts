// Retest 3 (after f942a306): applicability honours None / N/A, items follow a non-member PM, drafts carry the literal header.
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
const accountables = async (job: string) =>
  (await state.db!.query<{ accountable: string }>(`SELECT i.accountable FROM public.mcp_open_items i JOIN public.mcp_jobs j ON j.id = i.job_id WHERE j.job_number = $1 AND i.status = 'open'`, [job])).rows.map((r) => r.accountable);

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST Athena Co", your_name: "Test Owner" })).isError).toBe(false);
  for (const j of ["R3-1", "R3-2"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
});

describe("item 2: applicability reads None / N/A as OFF", () => {
  test("typed None / Not applicable with provenance notes turn the flags OFF in the report and contract_terms", async () => {
    expect((await call("intake", { section: "scope", job_number: "R3-1", key_clauses: { retainage: "yes", liquidated_damages: "yes", beneficial_use: "yes" } })).isError).toBe(false);
    expect((await call("intake", { section: "contract", job_number: "R3-1",
      retainage: "10% (user-typed; no contract document provided)",
      liquidated_damages: "None (user-typed; no contract document provided)",
      beneficial_use_clause: "Not applicable (user-typed; no contract document provided)" })).isError).toBe(false);
    const rep = await call("report", { job_number: "R3-1", audience: "internal" });
    expect(rep.text).toMatch(/has lds: OFF/);
    expect(rep.text).toMatch(/beneficial use: OFF/);
    expect(rep.text).toMatch(/has retainage: ON/);
    const ct = await call("contract_terms", { job_number: "R3-1" });
    expect(ct.text).not.toMatch(/has lds: ON/);
  });
});

describe("item 3: items follow a non-member PM", () => {
  test("unassigned items re-point to '<name> (PM)', and a PM typed with notes is cleaned", async () => {
    await call("intake", { section: "open_item", job_number: "R3-2", action: "Confirm submittal recipients", needed_by: "2026-10-21" });
    await call("intake", { section: "open_item", job_number: "R3-2", action: "Map SOV lines", needed_by: "2026-10-26" });
    expect(await accountables("R3-2")).toEqual(expect.arrayContaining(["Unassigned (no PM set)"]));
    const r = await call("intake", { section: "job_settings", job_number: "R3-2", pm: "Sam Ortiz (sam.ortiz@example.invalid) — non-member PM" });
    expect(r.isError).toBe(false);
    const j = (await state.db!.query<{ pm_name: string; pm_email: string }>(`SELECT pm_name, pm_email FROM public.mcp_jobs WHERE job_number = 'R3-2'`)).rows[0];
    expect(j).toEqual({ pm_name: "Sam Ortiz", pm_email: "sam.ortiz@example.invalid" });
    const acc = await accountables("R3-2");
    expect(acc.length).toBeGreaterThan(0);
    expect(acc.every((a) => a === "Sam Ortiz (PM)")).toBe(true);
    await call("intake", { section: "open_item", job_number: "R3-2", action: "Order switchgear", owner: "Sam Ortiz (non-member PM)", needed_by: "2026-10-28" });
    expect((await accountables("R3-2")).every((a) => a === "Sam Ortiz (PM)")).toBe(true);
    const list = await call("list_open_items", { job_number: "R3-2" });
    expect(list.text).not.toContain("non-member PM");
    expect(list.text).not.toContain("Unassigned (no PM set)");
  });

  test("item 4: drafts carry the literal Suggested From / Sign as lines", async () => {
    const r = await call("intake", { section: "delay_event", job_number: "R3-2", delay_description: "Lighting rough-in slipped 3 weeks" });
    // Retest 4: the two lines are data (visible) plus hidden guidance on how to use them; no instruction in the visible text.
    expect(r.text).toContain("- Sign as: Sam Ortiz, Project Manager, TEST Athena Co");
    expect(r.text).toContain("- Suggested From: sam.ortiz@example.invalid");
    expect(r.guidance).toContain("Suggested From: sam.ortiz@example.invalid / Sign as: Sam Ortiz, Project Manager, TEST Athena Co");
    expect(r.structured?.assistant_guidance).toBeTruthy();
  });
});
