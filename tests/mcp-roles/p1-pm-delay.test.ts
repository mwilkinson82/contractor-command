// P1 (persistence plan): non-member PM contact, delay events -> notice + claim items, PM-signed drafts,
// plus the guardrails (Super never reads financials at the DB level; client reports carry no money/margin/forecast).
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
import { bootDb, setupKeysAndFetch, callTool, state, user } from "./harness";
import { asUser } from "./fake-supabase";
import { hasClientLeak } from "../../src/lib/mcp/client-safe";

const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (name: string, args: Record<string, unknown>, who: "owner" | "super" = "owner") => {
  if (state.db) await state.db.exec(`DELETE FROM public.mcp_call_log`);
  return callTool(handler, await tok(who), name, args);
};
let today = "";
const SAM = "sam.ortiz@example.invalid";

type Row = { check_key: string; item_type: string; needed_by: string; action: string; accountable: string; commercial_type: string | null; detail: string | null };
const delayItems = async (job: string) =>
  (await state.db!.query<Row>(
    `SELECT i.check_key, i.item_type, i.needed_by::text, i.action, i.accountable, i.commercial_type, i.detail FROM public.mcp_open_items i JOIN public.mcp_jobs j ON j.id = i.job_id
     WHERE j.job_number = $1 AND (i.check_key LIKE 'delay_notice:%' OR i.check_key LIKE 'delay_claim:%') ORDER BY i.check_key DESC, i.created_at`, [job])).rows;

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  today = (await state.db!.query<{ d: string }>(`SELECT current_date::text AS d`)).rows[0].d;
  expect((await call("onboarding", { action: "save_company", name: "TEST Athena Co", your_name: "Test Owner" })).isError).toBe(false);
  await state.db!.exec(`UPDATE public.mcp_companies SET is_test = true`);
  const co = (await state.db!.query<{ id: string }>(`SELECT id FROM public.mcp_companies`)).rows[0].id;
  await state.db!.query(`INSERT INTO public.mcp_company_members (company_id, user_id, role, display_name) VALUES ($1,$2,'super','Test super')`, [co, user("super").id]);
  for (const j of ["2601", "D-2", "D-3", "D-4"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
  await state.db!.query(`INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) SELECT id, $1, $2 FROM public.mcp_jobs WHERE job_number = '2601'`, [user("super").id, user("owner").id]);
});

describe("1. PM who isn't an Athena member (Sam Ortiz, Job 2601)", () => {
  test("saved as name + email only, with no Athena access", async () => {
    const before = (await state.db!.query<{ n: number }>(`SELECT (SELECT count(*) FROM public.mcp_company_members) + (SELECT count(*) FROM public.mcp_job_access) + (SELECT count(*) FROM auth.users) AS n`)).rows[0].n;
    const r = await call("intake", { section: "job_settings", job_number: "2601", pm: "Sam Ortiz", pm_email: SAM });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("PM: Sam Ortiz (not an Athena user; saved as a contact with no Athena access) <sam.ortiz@example.invalid>");
    expect(r.structured).toMatchObject({ pm: "Sam Ortiz", pm_email: SAM, pm_is_member: false });
    const j = (await state.db!.query<{ pm_user_id: string | null; pm_name: string; pm_email: string; pm_title: string }>(`SELECT pm_user_id, pm_name, pm_email, pm_title FROM public.mcp_jobs WHERE job_number = '2601'`)).rows[0];
    expect(j).toEqual({ pm_user_id: null, pm_name: "Sam Ortiz", pm_email: SAM, pm_title: "Project Manager" });
    const after = (await state.db!.query<{ n: number }>(`SELECT (SELECT count(*) FROM public.mcp_company_members) + (SELECT count(*) FROM public.mcp_job_access) + (SELECT count(*) FROM auth.users) AS n`)).rows[0].n;
    expect(after).toBe(before); // no member row, no job access, no account
  });

  test("open items with no owner default to the contact PM", async () => {
    const r = await call("intake", { section: "open_item", job_number: "2601", action: "Confirm submittal recipients", needed_by: "2026-10-21" });
    expect(r.isError).toBe(false);
    const a = (await state.db!.query<{ accountable: string }>(`SELECT accountable FROM public.mcp_open_items WHERE action LIKE '%Confirm submittal recipients'`)).rows[0];
    expect(a.accountable).toBe("Sam Ortiz (PM)");
    const rep = await call("report", { job_number: "2601" });
    expect(rep.text).toContain("Accountable: Sam Ortiz (PM)");
  });

  test("a bad email is refused; a member name still links the member", async () => {
    const bad = await call("intake", { section: "job_settings", job_number: "D-4", pm: "Sam Ortiz", pm_email: "not-an-email" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("PM email doesn't look valid");
    const m = await call("intake", { section: "job_settings", job_number: "D-4", pm: "Test Owner" });
    expect(m.isError).toBe(false);
    expect(m.structured).toMatchObject({ pm: "Test Owner", pm_is_member: true, pm_email: user("owner").email });
  });

  test("a Super can't set the PM", async () => {
    const r = await call("intake", { section: "job_settings", job_number: "2601", pm: "Someone Else" }, "super");
    expect(r.isError).toBe(true);
  });
});

describe("3. Drafts are signed as the job PM", () => {
  test("job settings and the internal report give the PM signature and suggested From, and say the host picks the sender", async () => {
    const r = await call("intake", { section: "job_settings", job_number: "2601", pm_title: "Senior Project Manager" });
    expect(r.text).toContain("Sign as: Sam Ortiz, Senior Project Manager, TEST Athena Co");
    expect(r.text).toContain(`Suggested From: ${SAM}`);
    expect(r.text).toContain("The host's email card picks the account that actually sends");
    const rep = await call("report", { job_number: "2601", audience: "internal" });
    expect(rep.text).toContain("Sign as: Sam Ortiz, Senior Project Manager, TEST Athena Co");
    const cl = await call("report", { job_number: "2601", audience: "client" });
    expect(cl.text).not.toContain("Suggested From");
  });

  test("no PM yet: Athena says to ask rather than signing as the caller", async () => {
    const r = await call("intake", { section: "delay_event", job_number: "D-3", delay_description: "Roofing slipped 1 week" });
    expect(r.text).toContain("Sign as: no PM set");
    expect(r.text).not.toContain("Sign as: Test Owner");
  });
});

describe("2. Delay mention auto-creates the delay-notice and claim items", () => {
  test("due dates come from the contract terms and the delay start date; items link to the delay", async () => {
    expect((await call("intake", { section: "contract", job_number: "2601",
      notice_timing: "§6.4: written notice within three (3) calendar days after the delay begins",
      claim_process: "§7.4: claim notice within 7 calendar days" })).isError).toBe(false);
    const r = await call("intake", { section: "delay_event", job_number: "2601", delay_description: "Lighting rough-in slipped 3 weeks", delay_start_date: "2026-10-12", delay_days: 21 });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Delay notice: due 2026-10-15");
    expect(r.text).toContain("Claim notice: due 2026-10-19");
    expect(r.text).toContain("Sign as: Sam Ortiz");
    const its = await delayItems("2601");
    expect(its.map((i) => [i.item_type, i.needed_by])).toEqual([["deadline", "2026-10-15"], ["deadline", "2026-10-19"]]);
    expect(its[0].action).toContain("Send written delay notice (§6.4) for: Lighting rough-in slipped 3 weeks");
    expect(its[1].commercial_type).toBe("claim");
    expect(its.every((i) => i.accountable === "Sam Ortiz (PM)")).toBe(true);
    const ev = (await state.db!.query<{ notice: string; claim: string; start_known: boolean }>(
      `SELECT e.start_known, n.check_key AS notice, c.check_key AS claim FROM public.mcp_delay_events e
       JOIN public.mcp_open_items n ON n.id = e.notice_item_id JOIN public.mcp_open_items c ON c.id = e.claim_item_id
       JOIN public.mcp_jobs j ON j.id = e.job_id WHERE j.job_number = '2601'`)).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].start_known).toBe(true);
    expect(ev[0].notice).toMatch(/^delay_notice:/);
    expect(ev[0].claim).toMatch(/^delay_claim:/);
  });

  test("unknown start date: both flagged due today with 'confirm start date'", async () => {
    await call("intake", { section: "contract", job_number: "D-2", notice_timing: "Article 6.4 — 3 calendar days", claim_process: "Article 7.4 — 7 calendar days" });
    const r = await call("intake", { section: "delay_event", job_number: "D-2", delay_description: "Lighting rough-in slipped 3 weeks" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("start date unknown, so flagged due today — confirm start date");
    const its = await delayItems("D-2");
    expect(its).toHaveLength(2);
    for (const i of its) {
      expect(i.needed_by).toBe(today);
      expect(i.action).toContain("Confirm start date — ");
      expect(i.detail).toContain("confirm the start date");
    }
  });

  test("no contract terms recorded: both items still open, asking to confirm the clause, due today", async () => {
    const its = await delayItems("D-3");
    expect(its.map((i) => i.item_type)).toEqual(["unknown", "unknown"]);
    expect(its.every((i) => i.needed_by === today)).toBe(true);
    expect(its[0].action).toContain("Delay notice requirement not recorded");
    expect(its[1].action).toContain("Claim notice requirement not recorded");
  });

  test("a Super can't record a delay but can see it on an assigned job", async () => {
    const r = await call("intake", { section: "delay_event", job_number: "2601", delay_description: "x" }, "super");
    expect(r.isError).toBe(true);
    const seen = await asUser(state.db!, { sub: user("super").id, email: user("super").email, role: "authenticated" },
      async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM public.mcp_delay_events`)).rows[0].n);
    expect(seen).toBe(1); // 2601 only (assigned); D-2 and D-3 hidden
  });
});

describe("guardrails", () => {
  test("Supers are blocked from financials at the database level", async () => {
    await call("intake", { section: "budget", job_number: "2601",
      budget_lines: [{ cost_code: "26-100", description: "Lighting", amount: 150000 }],
      sov_lines: [{ line: "6", description: "Lighting fixtures and controls", billable_value: 200000 }] });
    const owner = await asUser(state.db!, { sub: user("owner").id, email: user("owner").email, role: "authenticated" },
      async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM public.mcp_job_facts f JOIN public.mcp_jobs j ON j.id = f.job_id WHERE j.job_number = '2601' AND f.module IN ('budget','sov')`)).rows[0].n);
    expect(owner).toBeGreaterThan(0);
    const sup = await asUser(state.db!, { sub: user("super").id, email: user("super").email, role: "authenticated" }, async (tx) => ({
      facts: (await tx.query(`SELECT count(*)::int AS n FROM public.mcp_job_facts`)).rows[0].n,
      flags: (await tx.query(`SELECT count(*)::int AS n FROM public.mcp_job_flags`)).rows[0].n,
      budgetItems: (await tx.query(`SELECT count(*)::int AS n FROM public.mcp_open_items WHERE section IN ('budget','sov') OR internal_only`)).rows[0].n,
    }));
    expect(sup).toEqual({ facts: 0, flags: 0, budgetItems: 0 });
    const rep = await call("report", { job_number: "2601" }, "super");
    expect(rep.text).toContain("LIMITED VIEW — NO FINANCIALS");
    expect(rep.text).not.toMatch(/150,?000|200,?000/);
  });

  test("client reports never show dollars, margin or forecasts", async () => {
    await call("intake", { section: "open_item", job_number: "2601", action: "Recover $42,000 from the lighting slip", needed_by: "2026-10-30" });
    await call("intake", { section: "open_item", job_number: "2601", action: "Update billing forecast for CO #1", needed_by: "2026-10-30" });
    await call("intake", { section: "contract", job_number: "2601", pay_terms: "Net 30; contract sum $1,125,000; 16.89% margin" });
    const cl = await call("report", { job_number: "2601", audience: "client" });
    expect(cl.isError).toBe(false);
    expect(cl.text).toContain("CLIENT-FACING");
    expect(cl.text).toContain("6: Lighting fixtures and controls");
    expect(cl.text).not.toMatch(/\$|200000|150000|42,000|1,125,000|margin|forecast/i);
    expect(hasClientLeak(cl.text)).toBe(false);
    const internal = await call("report", { job_number: "2601", audience: "internal" });
    expect(internal.text).toContain("$42,000"); // internal keeps it
  });
});
