// Athena fixes through the real /mcp handler and real migrations (PGlite). TEST company and users only.
// Covers: warranty in JOB SETUP, manual contract terms, look-ahead "no" pushback, production look-ahead questions, branding.
import { describe, test, expect, vi, beforeAll } from "vitest";
vi.mock("../../src/lib/mcp/supabase", async () => ({ supabaseForUser: (await import("./harness")).mockedSupabaseForUser }));
vi.mock("../../src/lib/mcp/allowlist", async () => {
  const h = await import("./harness");
  return { MCP_ALLOWED_EMAILS: new Set(["owner", "pm", "super"].map((r) => h.user(r as never).email)) };
});
// loadChecks reads the checklist with the service client; in TEST that is PGlite as service_role.
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
import { LOOKAHEAD_PUSHBACK, LOOKAHEAD_BUILD_QUESTIONS } from "../../src/lib/mcp/lookahead-help";

const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
let capTest = false; // only the rate-limit test keeps the call log; elsewhere the 60/hour cap would trip on long walks
const call = async (name: string, args: Record<string, unknown>, who: "owner" | "super" = "owner") => {
  if (!capTest && state.db) await state.db.exec(`DELETE FROM public.mcp_call_log`);
  return callTool(handler, await tok(who), name, args);
};
const items = async (job: string, like: string) =>
  (await state.db!.query<{ check_key: string; item_type: string; status: string; recommendation: string | null; help_offer: string | null }>(
    `SELECT i.check_key, i.item_type, i.status, i.recommendation, i.help_offer FROM public.mcp_open_items i JOIN public.mcp_jobs j ON j.id = i.job_id WHERE j.job_number = $1 AND i.check_key LIKE $2 ORDER BY 1`, [job, like])).rows;

const WARRANTY_ANSWERS: Record<string, Record<string, string>> = {
  "warranty:workmanship_warranty": { response: "yes" },
  "warranty:workmanship_warranty_months": { detail: "1 year" },
  "warranty:warranty_start_trigger": { detail: "Substantial completion" },
  "warranty:warranty_start_basis": { detail: "§12.2 certificate of substantial completion" },
  "warranty:closeout_documents": { detail: "O&M manuals, as-builts" },
  "warranty:punch_final_acceptance": { detail: "Punch closed in 30 days; architect sign-off" },
  "warranty:manufacturer_warranties": { detail: "Roofing 20-yr NDL" },
};

/** Answer earlier setup questions "yes" until `key` is the current one. */
async function toCheck(job: string, key: string) {
  for (let i = 0; i < 40; i++) {
    const q = await call("next_question", { job_number: job });
    const k = q.text.match(/check_key: (\S+)/)?.[1];
    if (!k) throw new Error(q.text);
    if (k === key) return;
    await call("answer", { job_number: job, check_key: k, ...(WARRANTY_ANSWERS[k] ?? { response: "yes" }) });
  }
  throw new Error(`never reached ${key}`);
}

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  expect((await call("onboarding", { action: "save_company", name: "TEST Athena Co", your_name: "Test Owner" })).isError).toBe(false);
  await state.db!.exec(`UPDATE public.mcp_companies SET is_test = true`);
  const co = (await state.db!.query<{ id: string }>(`SELECT id FROM public.mcp_companies`)).rows[0].id;
  await state.db!.query(`INSERT INTO public.mcp_company_members (company_id, user_id, role, display_name) VALUES ($1,$2,'super','Test super')`, [co, user("super").id]);
  for (const j of ["J-1", "J-2", "J-3"]) expect((await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` })).isError).toBe(false);
  await state.db!.query(`INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) SELECT id, $1, $2 FROM public.mcp_jobs WHERE job_number = 'J-1'`, [user("super").id, user("owner").id]);
});

describe("branding", () => {
  test("tool replies end with the full footer and the company defaults to Athena PM", async () => {
    const r = await call("onboarding", { action: "read" });
    expect(r.text).toContain("Athena powered by ALP, construction agents");
    const a = (await state.db!.query<{ agent_name: string }>(`SELECT agent_name FROM public.mcp_companies`)).rows[0];
    expect(a.agent_name).toBe("Athena PM");
  });
});

describe("warranty in JOB SETUP", () => {
  test("register shows real status; end date pending until the trigger date is known", async () => {
    const r = await call("intake", { section: "warranty", job_number: "J-1", workmanship_warranty: "yes", workmanship_warranty_months: 12, warranty_start_trigger: "substantial_completion",
      warranty_start_basis: "§12.2: date of substantial completion certificate", closeout_documents: "O&M manuals, as-builts, attic stock", punch_final_acceptance: "Punch closed within 30 days; architect sign-off", manufacturer_warranties: "Roofing 20-yr NDL, RTUs 5-yr compressor" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Status: Pending substantial completion date");
    expect(r.text).toContain("End date: pending trigger date");
    expect(r.text).not.toContain("Not started");
    expect(await items("J-1", "warranty:%")).toEqual([]);
    const r2 = await call("intake", { section: "warranty", job_number: "J-1", warranty_trigger_date: "2026-03-31" });
    expect(r2.text).toContain("Start date: 2026-03-31");
    expect(r2.text).toContain("End date: 2027-03-31");
    expect(r2.text).toContain("Duration: 12 months"); // earlier answers kept
    const rep = await call("report", { job_number: "J-1", audience: "internal" });
    expect(rep.text).toMatch(/WARRANTY REGISTER\n\s+- Workmanship warranty: yes \(manual\)\n\s+Status: In warranty/);
  });
  test("no / unknown answers become open items, deduped", async () => {
    await call("intake", { section: "warranty", job_number: "J-2", workmanship_warranty: "unknown", closeout_documents: "unknown", punch_final_acceptance: "no" });
    await call("intake", { section: "warranty", job_number: "J-2", workmanship_warranty: "unknown" });
    const its = await items("J-2", "warranty:%");
    expect(its.map((i) => `${i.check_key}=${i.item_type}`)).toEqual([
      "warranty:closeout_documents=unknown", "warranty:manufacturer_warranties=unknown", "warranty:punch_final_acceptance=no",
      "warranty:warranty_start_basis=unknown", "warranty:workmanship_warranty=unknown",
    ]);
  });
  test("next_question lists warranty as a setup section not started", async () => {
    const r = await call("report", { job_number: "J-3", audience: "internal" });
    expect(r.text).toMatch(/WARRANTY REGISTER\n\s+Not set up yet\. Athena asks the workmanship warranty and closeout questions in job setup/);
  });
});

describe("contract terms entered by hand", () => {
  test("kept and marked manual; later partial saves never null them; document values marked document", async () => {
    const r = await call("intake", { section: "contract", job_number: "J-1", retainage: "10% to 50%, then 5%", pay_terms: "Net 30" });
    expect(r.text).toContain("as manual entries (source: manual)");
    expect(r.text).toContain("retainage (manual)");
    await call("intake", { section: "contract", job_number: "J-1", contract_document_provided: true, liquidated_damages: "$1,500/day, §9.4" });
    const rep = await call("report", { job_number: "J-1", audience: "internal" });
    expect(rep.text).toContain("- retainage: 10% to 50%, then 5% (manual)");
    expect(rep.text).toContain("- pay terms: Net 30 (manual)");
    expect(rep.text).toContain("- liquidated damages: $1,500/day, §9.4 (document)");
    expect(rep.text).toMatch(/- notice timing: unknown/);
  });
});

describe("look-ahead: a no is not accepted", () => {
  test("first no gets the pushback and records nothing", async () => {
    const r = await call("answer", { job_number: "J-2", check_key: "bss_lookahead", response: "no" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(LOOKAHEAD_PUSHBACK);
    expect(r.structured?.recorded).toBeNull();
    expect(await items("J-2", "setup:bss_lookahead")).toEqual([]);
  });
  test("accept returns the schedule questions and how to build it with intake lookahead", async () => {
    const r = await call("answer", { job_number: "J-2", check_key: "bss_lookahead", response: "no", lookahead_help: "accept" });
    for (const q of LOOKAHEAD_BUILD_QUESTIONS) expect(r.text).toContain(q);
    expect(r.text).toContain('intake with section "lookahead"');
    expect(await items("J-2", "setup:bss_lookahead")).toEqual([]);
  });
  test("decline logs a no open item with the recommendation and Athena help text", async () => {
    await toCheck("J-3", "bss_lookahead");
    const r = await call("answer", { job_number: "J-3", check_key: "bss_lookahead", response: "no", lookahead_help: "decline" });
    expect(r.isError).toBe(false);
    const [it] = await items("J-3", "setup:bss_lookahead");
    expect(it.item_type).toBe("no");
    expect(it.recommendation).toContain("Build a two-week look-ahead from the schedule");
    expect(it.help_offer).toContain("Athena can help");
  });
  test("yes is recorded normally", async () => {
    await toCheck("J-1", "bss_lookahead");
    const r = await call("answer", { job_number: "J-1", check_key: "bss_lookahead", response: "yes" });
    expect(r.text).toContain("Recorded yes");
  });
});

describe("look-ahead walk", () => {
  test("asks only the six production questions, no placeholders, no setup checks", async () => {
    const la = await call("intake", { section: "lookahead", job_number: "J-1", start_date: "2026-10-19", end_date: "2026-11-01", schedule_export: "A100 Framing L2 60%; A110 Drywall L2 starts 10/26", crews: "Framing sub 6; own forces 2", submittal_log: "S-12 drywall: approved", rfi_log: "none open", inspection_list: "L2 framing 10/23", deliveries: "Drywall 10/24" });
    const id = la.structured?.lookahead_id as string;
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const q = await call("next_question", { job_number: "J-1", lookahead_id: id });
      if (/All lookahead checks are done/.test(q.text)) break;
      expect(q.text).not.toContain("PLACEHOLDER");
      const key = (q.structured?.check_key as string) ?? q.text.match(/check_key: (\S+)/)?.[1]; expect(key, q.text).toBeTruthy();
      seen.push(key);
      const list = /or say none/.test(q.text);
      const a = await call("answer", { job_number: "J-1", lookahead_id: id, check_key: key, ...(list ? { detail: "none" } : { response: "yes" }) });
      expect(a.isError, a.text).toBe(false);
    }
    expect(seen).toEqual(["la_resources", "la_submittals", "la_rfis", "la_inspections", "la_deliveries", "la_sequence"]);
  });
  test("super stays read-only on the new sections", async () => {
    const r = await call("intake", { section: "warranty", job_number: "J-1", workmanship_warranty: "no" }, "super");
    expect(r.text).toMatch(/limited, read-only view/);
  });
});

describe("live ChatGPT test bugs (job setup flow)", () => {
  beforeAll(async () => {
    const db = state.db!;
    const co = (await db.query<{ id: string }>(`SELECT id FROM public.mcp_companies`)).rows[0].id;
    await db.query(`INSERT INTO public.mcp_company_members (company_id, user_id, role, display_name) VALUES ($1,$2,'pm','Test PM')`, [co, user("pm").id]);
    // TEST copies of two live setup checks (the live checklist rows aren't in the migrations).
    await db.exec(`INSERT INTO public.mcp_checklist_items (key, version, category, trade, prompt, rule_type, required_inputs, severity, position, is_placeholder, module, section, applies_when, sets_flag, display_label, no_recommendation) VALUES
      ('gate_cost_loaded', 1, 'Gate', 'general', 'Will this job have a cost-loaded schedule?', 'confirm', '{}', 'high', 4, false, 'job_setup', 'gate', '{}', 'cost_loaded', NULL, NULL),
      ('job_number_assigned', 1, 'Job number', 'general', 'A job number is assigned. It is the key for everything else on this job.', 'confirm', '{}', 'high', 20, false, 'job_setup', 'job_number', '{}', NULL, 'B5', 'Assign the job number now.')`);
    expect((await call("intake", { section: "create_job", job_number: "J-4", job_name: "TEST J-4" })).text).toContain("PM: not set yet");
    expect((await call("intake", { section: "job_settings", job_number: "J-4", pm: "Test PM" })).isError).toBe(false);
  });
  test("#9 scoping doesn't open confirm items for flags asked later, and answered flags close their confirm items", async () => {
    await call("intake", { section: "scope", job_number: "J-4", job_type: "Tenant improvement" });
    const keys = (await items("J-4", "flag:%")).filter((i) => i.status === "open").map((i) => i.check_key);
    for (const k of ["self_perform", "has_retainage", "beneficial_use", "has_lds", "notice_requirements"]) expect(keys).not.toContain(`flag:${k}`);
    expect(keys).toContain("flag:has_subcontracts");
    await call("intake", { section: "scope", job_number: "J-4", work_packages: [{ name: "Drywall", mode: "subcontract" }] });
    const sub = (await items("J-4", "flag:has_subcontracts"))[0];
    expect(sub.status).not.toBe("open");
  });
  test("#6 job number check is answered visibly; numbering shows what's left", async () => {
    const q1 = await call("next_question", { job_number: "J-4" });
    expect(q1.text).toMatch(/Setup question 1 — \d+ more after this/);
    expect(q1.text).toContain("check_key: gate_cost_loaded");
    await call("answer", { job_number: "J-4", check_key: "gate_cost_loaded", response: "no" });
    const q2 = await call("next_question", { job_number: "J-4" });
    expect(q2.text).toContain('Answered for you: B5 "A job number is assigned.');
    expect(q2.text).toContain("yes (job number J-4 is on record)");
    // Warranty and closeout questions come up front, right after the gate.
    expect(q2.text).toContain("check_key: warranty:workmanship_warranty");
    await toCheck("J-4", "bss_billing_forecast");
  });
  test("#1 #7 #8 a setup no: recommend + why + help, no cost-loaded advice after a no, item goes to the job's PM", async () => {
    const r = await call("answer", { job_number: "J-4", check_key: "bss_billing_forecast", response: "no" });
    expect(r.text).toMatch(/Recommendation: .+\nWhy it matters: .+\nHow I can help: .+/);
    expect(r.text).not.toMatch(/cost-loaded/i);
    expect(r.text).toContain("accountable: Test PM (PM)");
  });
  test("#7 with no PM set, an item defaults to the caller with their role", async () => {
    const r = await call("intake", { section: "open_item", job_number: "J-3", action: "TEST item" });
    expect(r.text).toContain("accountable: Test Owner (Owner)");
  });
});

describe("resolve_item needs real evidence; warranty register in both reports", () => {
  test("a bare 'we're good' keeps the item open and asks for evidence", async () => {
    const [it] = (await state.db!.query<{ id: string }>(`SELECT i.id FROM public.mcp_open_items i JOIN public.mcp_jobs j ON j.id = i.job_id WHERE j.job_number = 'J-2' AND i.check_key = 'warranty:closeout_documents'`)).rows;
    const r = await call("resolve_item", { job_number: "J-2", item_id: it.id, kind: "member_statement", evidence: "we're good", stated_by: "Marshall", stated_on: "2026-10-19" });
    expect(r.text).toContain("Still open. To close it I need real evidence");
    expect(r.structured?.closed).toBe(false);
    const st = (await state.db!.query<{ status: string }>(`SELECT status FROM public.mcp_open_items WHERE id = $1`, [it.id])).rows[0];
    expect(st.status).toBe("open");
  });
  test("a dated statement closes it and is attributed to the calling user", async () => {
    const [it] = (await state.db!.query<{ id: string }>(`SELECT i.id FROM public.mcp_open_items i JOIN public.mcp_jobs j ON j.id = i.job_id WHERE j.job_number = 'J-2' AND i.check_key = 'warranty:warranty_start_basis'`)).rows;
    const r = await call("resolve_item", { job_number: "J-2", item_id: it.id, kind: "member_statement", evidence: "Spec 01 77 00 says warranty starts at substantial completion", stated_on: "2026-10-19" });
    expect(r.structured?.closed, r.text).toBe(true);
    const ev = (await state.db!.query<{ evidence: string }>(`SELECT evidence FROM public.mcp_item_evidence WHERE item_id = $1`, [it.id])).rows.map((x) => x.evidence).join(" ");
    expect(ev).toContain("recorded by Test Owner (Owner)");
    expect(ev).toContain("stated by Test Owner (Owner)");
  });
  test("client-facing and internal reports both carry the warranty register from setup answers", async () => {
    for (const audience of ["client", "internal"]) {
      const rep = await call("report", { job_number: "J-1", audience });
      expect(rep.text).toMatch(/WARRANTY REGISTER\n\s+- Workmanship warranty: yes/);
      expect(rep.text).toContain("End date: 2027-03-31");
      expect(rep.text).toContain("Required closeout documents: O&M manuals, as-builts, attic stock");
    }
  });
});

describe("rate limit", () => {
  test("hourly cap gives a readable message with the reset time, distinct from a DB failure; nothing runs", async () => {
    const db = state.db!;
    const uid = user("owner").id;
    capTest = true;
    await db.query(`DELETE FROM public.mcp_call_log WHERE user_id = $1`, [uid]);
    await db.query(`INSERT INTO public.mcp_call_log (user_id, called_at) SELECT $1, now() - interval '30 minutes' FROM generate_series(1, 60)`, [uid]);
    const r = await call("onboarding", { action: "read" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/You've hit Athena's hourly limit\. It resets at \d{2}:\d{2} E[DS]T \(in about (29|30|31) min\)\./);
    await db.query(`DELETE FROM public.mcp_call_log WHERE user_id = $1`, [uid]);
    expect((await call("onboarding", { action: "read" })).isError).toBe(false);
    capTest = false;
  });
});

// Retest on the LIVE build 4904699, 2026-10-19 11:31–11:40 AM Manaus (ChatGPT, Job 1001). TEST data only.
describe("live retest 2026-10-19", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  beforeAll(async () => {
    for (const j of ["R-1", "R-2"]) await call("intake", { section: "create_job", job_number: j, job_name: `TEST ${j}` });
    await call("intake", { section: "job_settings", job_number: "R-1", pm: "Test PM" });
  });

  test("#1 typed contract terms (no document) read back as typed; LD and beneficial use read OFF", async () => {
    const r = await call("intake", { section: "contract", job_number: "R-1",
      pay_terms: "Net 30 after approved pay app", notice_timing: "7 days written notice", tia_timing: "14 days", change_process: "Written CO before work",
      claim_process: "21 days from the event", retainage: "10%", retainage_reduction: "5% at 50% complete", beneficial_use_clause: "None",
      liquidated_damages: "No LDs", savings_split: "50/50", closeout: "O&Ms and as-builts before final", warranty_clauses: "1 year from substantial completion" });
    expect(r.isError).toBe(false);
    const rep = await call("report", { job_number: "R-1", audience: "internal" });
    expect(rep.text).toContain("- retainage: 10% (manual)");
    expect(rep.text).toContain("- notice timing: 7 days written notice (manual)");
    expect(rep.text).toMatch(/has lds: OFF \(manual\)/);
    expect(rep.text).toMatch(/beneficial use: OFF \(manual\)/);
    expect(rep.text).toMatch(/has retainage: ON \(manual\)/);
    expect(rep.text).toMatch(/notice requirements: ON \(manual\)/);
    const unknown = (await state.db!.query<{ key: string }>(`SELECT f.key FROM public.mcp_job_facts f JOIN public.mcp_jobs j ON j.id = f.job_id WHERE j.job_number = 'R-1' AND f.module = 'contract' AND f.status <> 'known'`)).rows;
    expect(unknown).toEqual([]);
  });

  test("#2 #7 job setup asks warranty and closeout up front; the register fills from the answers", async () => {
    const g = await call("next_question", { job_number: "R-2" });
    expect(g.text).toContain("check_key: gate_cost_loaded"); // gate questions stay first
    await call("answer", { job_number: "R-2", check_key: "gate_cost_loaded", response: "yes" });
    const q = await call("next_question", { job_number: "R-2" });
    expect(q.text).toContain("check_key: warranty:workmanship_warranty");
    expect(q.text).toContain("Is there a workmanship warranty on this job (yes / no)?");
    for (const [k, a] of Object.entries(WARRANTY_ANSWERS)) {
      const n = await call("next_question", { job_number: "R-2" });
      expect(n.text).toContain(`check_key: ${k}`);
      expect((await call("answer", { job_number: "R-2", check_key: k, ...a })).isError).toBe(false);
    }
    const after = await call("next_question", { job_number: "R-2" });
    expect(after.text).not.toContain("check_key: warranty:");
    const rep = await call("report", { job_number: "R-2", audience: "client" });
    expect(rep.text).toMatch(/WARRANTY REGISTER\n\s+- Workmanship warranty: yes \(manual\)\n\s+Status: Pending substantial completion date\n\s+Duration: 12 months/);
    expect(rep.text).toContain("- Required closeout documents: O&M manuals, as-builts (manual)");
  });

  test("#2 a no warranty skips duration/trigger; unknowns become open items", async () => {
    await call("intake", { section: "create_job", job_number: "R-3", job_name: "TEST R-3" });
    await call("answer", { job_number: "R-3", check_key: "gate_cost_loaded", response: "yes" });
    await call("answer", { job_number: "R-3", check_key: "warranty:workmanship_warranty", response: "no" });
    const n = await call("next_question", { job_number: "R-3" });
    expect(n.text).toContain("check_key: warranty:warranty_start_basis");
    await call("answer", { job_number: "R-3", check_key: "warranty:warranty_start_basis", response: "unknown" });
    expect((await items("R-3", "warranty:%")).map((i) => `${i.check_key}=${i.item_type}`)).toEqual(["warranty:warranty_start_basis=unknown", "warranty:workmanship_warranty=no"]);
  });

  test("#4 the date sweep on a report shows only that job's dates", async () => {
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    await call("intake", { section: "open_item", job_number: "R-1", action: "TEST R-1 submit insurance cert", needed_by: soon });
    await call("intake", { section: "open_item", job_number: "R-2", action: "TEST R-2 owner walk", needed_by: soon });
    for (const audience of ["client", "internal"]) {
      const rep = await call("report", { job_number: "R-2", audience });
      const sweep = rep.text.split("====")[0];
      expect(sweep).toContain("TEST R-2 owner walk");
      expect(sweep).not.toContain("TEST R-1");
      expect(sweep).not.toMatch(/\bJ-\d|R-1 –/);
      expect(((rep.structured?.sweep ?? []) as { job_number: string }[]).every((s) => s.job_number === "R-2")).toBe(true);
    }
    const lo = await call("list_open_items", { job_number: "R-2" });
    expect(lo.text.split("====")[0]).not.toContain("TEST R-1");
  });

  test("#5 #6 #8 client report: no item ids, Accountable is Name (Role), no coaching copy, Athena footer and Prepared by", async () => {
    await call("intake", { section: "open_item", job_number: "R-1", action: "TEST no-owner item" });
    await call("intake", { section: "open_item", job_number: "R-1", action: "TEST gap", item_type: "no", owner: "Test Owner",
      recommendation: "Do it now — the super runs the money in the field.", why: "best practice" });
    await state.db!.exec(`UPDATE public.mcp_open_items SET accountable = 'Test Owner' WHERE action = 'TEST no-owner item'`); // live rows say just the name
    const rep = await call("report", { job_number: "R-1", audience: "client" });
    expect(rep.text).not.toMatch(UUID);
    expect(rep.text).not.toContain("[item ");
    expect(rep.text).toContain("Accountable: Test Owner (Owner)");
    expect(rep.text).not.toMatch(/Accountable: Test Owner \|/);
    expect(rep.text).not.toMatch(/can help you close this gap|PM agent|the super runs the money|savings split|Recommendation:/i);
    expect(rep.text).toContain("Prepared by: Athena PM");
    expect(rep.text).toContain("Athena powered by ALP, construction agents");
    expect(rep.text).not.toMatch(/private prototype|ALP Contractor Circle/);
    expect(JSON.stringify(rep.structured ?? {})).not.toMatch(UUID);
    const internal = await call("report", { job_number: "R-1", audience: "internal" });
    expect(internal.text).toMatch(UUID); // internal keeps ids for resolve_item
    expect(internal.text).toContain("savings split");
  });

  test("#8 a company still labeled 'PM agent' reads 'Prepared by: Athena PM'", async () => {
    await state.db!.exec(`UPDATE public.mcp_companies SET agent_name = 'PM agent'`);
    const rep = await call("report", { job_number: "R-1", audience: "client" });
    expect(rep.text).toContain("Prepared by: Athena PM");
    await state.db!.exec(`UPDATE public.mcp_companies SET agent_name = 'Athena PM'`);
  });
});
