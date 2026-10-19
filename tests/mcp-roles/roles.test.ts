// Role-by-tool matrix (6 roles x 8 tools) through the real /mcp handler with requireOAuthClientClaim ON.
// TEST company and TEST users only (reserved .invalid domain); nothing here talks to the live backend.
import { describe, test, expect, vi, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
vi.mock("../../src/lib/mcp/supabase", async () => ({ supabaseForUser: (await import("./harness")).mockedSupabaseForUser }));
// The production allowlist module is replaced in this test process only, so TEST users can reach the tools.
vi.mock("../../src/lib/mcp/allowlist", async () => {
  const h = await import("./harness");
  return { MCP_ALLOWED_EMAILS: new Set(["owner", "pm", "finance", "contracts", "estimating", "super", "pm2"].map((r) => h.user(r as never).email)) };
});
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import mcp from "../../src/lib/mcp/index";
import { setLogLevel } from "@lovable.dev/mcp-js";
setLogLevel("error");
import { bootDb, setupKeysAndFetch, callTool, user, state, ROLES, TOOLS, type Role } from "./harness";
import { asUser } from "./fake-supabase";

const handler = createTanStackMcpHandler(mcp, { resourcePath: "/mcp", metadataPath: "/.well-known/oauth-protected-resource" });
let tok: Awaited<ReturnType<typeof setupKeysAndFetch>>;
const call = async (r: Role | "pm2" | "outsider", name: string, args: Record<string, unknown>) => callTool(handler, await tok(r), name, args);
const idOf = (t: string) => t.match(/item ([0-9a-f-]{36})/)?.[1] ?? t.match(/Open item ([0-9a-f-]{36})/)?.[1];
const laOf = (t: string) => t.match(/lookahead_id[:\s]+([0-9a-f-]{36})/i)?.[1] ?? t.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
const NO_ACCESS = /role doesn't have access/;
const NOT_VISIBLE = /No job J-\d+ in this company|Job not found/;

const matrix: Record<string, Record<string, string>> = {};
const mark = (role: string, tool: string, ok: boolean, note: string, why = "") => {
  if (why) note += ` (${why.split("\n")[0].slice(0, 70)})`; (matrix[role] ??= {})[tool] = `${ok ? "PASS" : "FAIL"} ${note}`; };

beforeAll(async () => {
  tok = await setupKeysAndFetch();
  await bootDb();
  const db = state.db!;
  expect((await call("owner", "onboarding", { action: "save_company", name: "TEST Roles Co", your_name: "Test Owner" })).isError).toBe(false);
  await db.exec(`UPDATE public.mcp_companies SET is_test = true`);
  const co = (await db.query<{ id: string }>(`SELECT id FROM public.mcp_companies`)).rows[0].id;
  for (const r of ["pm", "finance", "contracts", "estimating", "super", "pm2"])
    await db.query(`INSERT INTO public.mcp_company_members (company_id, user_id, role, display_name) VALUES ($1,$2,$3,$4)`, [co, user(r as Role).id, r === "pm2" ? "pm" : r, `Test ${r}`]);
  for (const j of ["J-100", "J-200", "J-300"]) {
    expect((await call("owner", "intake", { section: "create_job", job_number: j, job_name: `TEST job ${j}` })).isError).toBe(false);
    await call("owner", "intake", { section: "budget", job_number: j, budget_lines: [{ cost_code: "01-100", description: "General conditions", amount: 50000 }] });
  }
  await db.query(`UPDATE public.mcp_jobs SET pm_user_id = $1 WHERE job_number = 'J-100'`, [user("pm").id]);
  await db.query(`UPDATE public.mcp_jobs SET pm_user_id = $1 WHERE job_number = 'J-200'`, [user("pm2").id]);
  await db.exec(`UPDATE public.mcp_jobs SET restricted = true WHERE job_number = 'J-300'`);
  // Super is assigned to J-100 only (limited, read-only view).
  await db.query(`INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) SELECT id, $1, $2 FROM public.mcp_jobs WHERE job_number = 'J-100'`, [user("super").id, user("owner").id]);
});

afterAll(() => {
  const lines = ["role | " + TOOLS.join(" | "), ...ROLES.map((r) => `${r} | ${TOOLS.map((t) => matrix[r]?.[t] ?? "n/a").join(" | ")}`)];
  writeFileSync(process.env.ROLE_MATRIX_OUT ?? "/tmp/role-matrix.txt", lines.join("\n") + "\n");
});

// Expected access to J-100 (the PM's own job): full | contract | none
const ACCESS: Record<Role, "full" | "contract" | "super"> = { owner: "full", pm: "full", finance: "full", contracts: "contract", estimating: "contract", super: "super" };

describe.each(ROLES)("role %s", (role) => {
  const a = ACCESS[role];
  const READ_ONLY = /limited, read-only view/;
  const denied = (o: { isError: boolean; text: string }) => o.isError && (role === "super" ? READ_ONLY.test(o.text) : true);

  test("onboarding", async () => {
    const o = await call(role, "onboarding", { action: "read" });
    const ok = !o.isError && /TEST Roles Co/.test(o.text);
    mark(role, "onboarding", ok, "read company", o.isError ? o.text : "");
    expect(ok).toBe(true);
  });

  test("intake", async () => {
    const o = await call(role, "intake", { section: "open_item", job_number: "J-100", action: `TEST ${role} item`, owner: "Test Owner", item_type: "unknown" });
    const ok = a === "full" ? !o.isError && /Open item/.test(o.text) : denied(o);
    mark(role, "intake", ok, a === "full" ? "wrote item" : "write denied", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });

  test("next_question", async () => {
    const o = await call(role, "next_question", { job_number: "J-100" });
    const ok = a === "super" ? denied(o) : !o.isError && (a === "full" ? /Setup question/.test(o.text) : !/budget|handoff/i.test(o.text.split("Intake sections not started")[0]));
    mark(role, "next_question", ok, a === "super" ? "read-only: denied" : a === "full" ? "setup questions" : "contract-time questions only", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });

  test("answer", async () => {
    const nq = await call("owner", "next_question", { job_number: "J-100" });
    const key = nq.text.match(/check_key: (\S+)/)?.[1];
    expect(key, nq.text).toBeTruthy();
    const o = await call(role, "answer", { job_number: "J-100", check_key: key, response: "unknown", owner: "Test Owner" });
    // Contract roles only ever get contract-time questions; the owner's current check is a full-scope one, so it is refused.
    const ok = a === "full" ? !o.isError : denied(o);
    mark(role, "answer", ok, a === "full" ? "answered" : a === "super" ? "read-only: denied" : "full-scope check refused", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });

  test("report", async () => {
    const o = await call(role, "report", { job_number: "J-100" });
    let ok: boolean;
    if (a === "super") ok = !o.isError && /LIMITED VIEW — NO FINANCIALS/.test(o.text) && !/01-100|50000|50,000|Budget|cost:|cash:|SCHEDULE OF VALUES/i.test(o.text.split("====").pop()!);
    else if (a === "contract") ok = !o.isError && /CONTRACT SIDE ONLY/.test(o.text) && !/01-100|50000|50,000|Budget/i.test(o.text.split("====").pop()!);
    else ok = !o.isError && /DATE SWEEP/.test(o.text) && /JOB SETUP REPORT \(INTERNAL\)/.test(o.text);
    mark(role, "report", ok, a === "super" ? "limited view, no financials" : a === "contract" ? "contract side only, no budget" : "full internal + sweep", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });

  test("carry_forward", async () => {
    const l1 = await call("owner", "intake", { section: "lookahead", lookahead_exists: "yes", job_number: "J-100", start_date: "2026-10-19", end_date: "2026-11-01" });
    const l2 = await call("owner", "intake", { section: "lookahead", lookahead_exists: "yes", job_number: "J-100", start_date: "2026-11-02", end_date: "2026-11-15" });
    const from = (l1.structured?.lookahead_id as string) ?? laOf(l1.text), to = (l2.structured?.lookahead_id as string) ?? laOf(l2.text);
    expect(from && to, l1.text + l2.text).toBeTruthy();
    const o = await call(role, "carry_forward", { job_number: "J-100", from_lookahead_id: from, to_lookahead_id: to });
    const ok = a === "full" ? !o.isError && /carried forward/.test(o.text) : a === "super" ? denied(o) : o.isError && /needs full access/.test(o.text);
    mark(role, "carry_forward", ok, a === "full" ? "carried" : "denied", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });

  test("list_open_items", async () => {
    const o = await call(role, "list_open_items", { job_number: "J-100" });
    let ok: boolean;
    if (a === "super") ok = !o.isError && /TEST/.test(o.text) && !/cost:|cash:|01-100|50000/i.test(o.text.split("====").pop()!);
    else ok = !o.isError && /DATE SWEEP/.test(o.text) && (a === "contract" || /\[(unknown|no|na_disposition|pending_document|deadline)\]/.test(o.text));
    mark(role, "list_open_items", ok, a === "super" ? "listed, no cost/cash" : "listed + sweep", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });

  test("resolve_item", async () => {
    const mk = await call("owner", "intake", { section: "open_item", job_number: "J-100", action: `TEST resolve by ${role}`, owner: "Test Owner", item_type: "unknown" });
    const id = (mk.structured?.items as { item_ref: string }[] | undefined)?.[0]?.item_ref ?? idOf(mk.text); // resolve by short ref
    expect(id, mk.text).toBeTruthy();
    const o = await call(role, "resolve_item", { job_number: "J-100", item_id: id, kind: "verified", evidence: "TEST evidence: approved submittal 001" });
    const ok = a === "full" ? !o.isError : denied(o);
    mark(role, "resolve_item", ok, a === "full" ? "resolved" : "denied", o.isError ? o.text : "");
    expect(ok, o.text).toBe(true);
  });
});

describe("job scope across jobs", () => {
  const see = async (r: Role | "pm2", j: string) => !(await call(r, "report", { job_number: j })).isError;
  test("PM sees own job only", async () => {
    expect(await see("pm", "J-100")).toBe(true);
    expect(await see("pm", "J-200")).toBe(false);
    expect(await see("pm", "J-300")).toBe(false);
    expect(await see("pm2", "J-200")).toBe(true);
    expect(await see("pm2", "J-100")).toBe(false);
  });
  test("owner and finance see all jobs including restricted", async () => {
    for (const r of ["owner", "finance"] as const) for (const j of ["J-100", "J-200", "J-300"]) expect(await see(r, j), `${r} ${j}`).toBe(true);
  });
  test("contracts and estimating: contract scope on open jobs, nothing on restricted", async () => {
    for (const r of ["contracts", "estimating"] as const) {
      expect(await see(r, "J-200")).toBe(true);
      expect(await see(r, "J-300")).toBe(false);
    }
  });
  test("super sees only assigned jobs; restricted stays hidden unless assigned", async () => {
    expect(await see("super", "J-100")).toBe(true);
    expect(await see("super", "J-200")).toBe(false);
    expect(await see("super", "J-300")).toBe(false);
    const db = state.db!;
    await db.query(`INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) SELECT id, $1, $2 FROM public.mcp_jobs WHERE job_number = 'J-300'`, [user("super").id, user("owner").id]);
    expect(await see("super", "J-300")).toBe(true);
    await db.query(`DELETE FROM public.mcp_job_access WHERE user_id = $1 AND job_id = (SELECT id FROM public.mcp_jobs WHERE job_number = 'J-300')`, [user("super").id]);
    expect(await see("super", "J-300")).toBe(false);
  });
  test("super with no assignment gets the no-access message", async () => {
    const db = state.db!;
    await db.query(`DELETE FROM public.mcp_job_access WHERE user_id = $1`, [user("super").id]);
    const o = await call("super", "report", { job_number: "J-100" });
    expect(o.isError && NO_ACCESS.test(o.text), o.text).toBe(true);
    await db.query(`INSERT INTO public.mcp_job_access (job_id, user_id, granted_by) SELECT id, $1, $2 FROM public.mcp_jobs WHERE job_number = 'J-100'`, [user("super").id, user("owner").id]);
  });
  test("super never sees budget items, facts or internal items", async () => {
    const db = state.db!;
    const rows = await asUser(db, { sub: user("super").id, email: user("super").email, role: "authenticated" }, async (tx: any) => ({
      facts: (await tx.query(`SELECT count(*)::int n FROM public.mcp_job_facts`)).rows[0].n,
      flags: (await tx.query(`SELECT count(*)::int n FROM public.mcp_job_flags`)).rows[0].n,
      budgetItems: (await tx.query(`SELECT count(*)::int n FROM public.mcp_open_items WHERE section IN ('budget','sov') OR internal_only`)).rows[0].n,
      items: (await tx.query(`SELECT count(*)::int n FROM public.mcp_open_items`)).rows[0].n,
    }));
    expect(rows.facts).toBe(0);
    expect(rows.flags).toBe(0);
    expect(rows.budgetItems).toBe(0);
    expect(rows.items).toBeGreaterThan(0);
  });
  test("PM sweep never mentions jobs the PM can't see", async () => {
    const o = await call("pm", "list_open_items", { job_number: "J-100" });
    expect(o.text).not.toMatch(/J-200|J-300/);
  });
});

describe("role changes take effect on the very next call (finding 3)", () => {
  test("no cached role: a member switched to contracts is refused on the next write", async () => {
    const db = state.db!;
    const setRole = (r: string) => db.query(`UPDATE public.mcp_company_members SET role = $1 WHERE user_id = $2`, [r, user("pm2").id]);
    await setRole("finance");
    const a = await call("pm2", "intake", { section: "open_item", job_number: "J-200", action: "TEST pm2 as finance", owner: "Test Owner", item_type: "unknown" });
    expect(a.isError, a.text).toBe(false);
    const lookahead = await call("pm2", "intake", { section: "lookahead", lookahead_exists: "yes", job_number: "J-200", start_date: "2026-10-19", end_date: "2026-11-01" });
    const la = (lookahead.structured?.lookahead_id as string) ?? laOf(lookahead.text);
    await setRole("contracts");
    const b = await call("pm2", "intake", { section: "open_item", job_number: "J-200", action: "TEST pm2 as contracts", owner: "Test Owner", item_type: "unknown" });
    expect(b.isError && /Job not found|needs full access/.test(b.text), b.text).toBe(true);
    // Demoted creator: their own earlier rows don't stay readable through "own rows".
    const l = await call("pm2", "list_open_items", { job_number: "J-200" });
    expect(l.text).not.toMatch(/TEST pm2 as finance/);
    const rows = await asUser(db, { sub: user("pm2").id, email: user("pm2").email, role: "authenticated" }, async (tx: any) =>
      (await tx.query(`SELECT count(*)::int n FROM public.mcp_lookaheads WHERE id = $1`, [la])).rows[0].n);
    expect(rows).toBe(0);
    await setRole("pm");
  });
});

describe("open item types", () => {
  test("all five types are returned by the tools", async () => {
    const add = (extra: Record<string, unknown>) => call("owner", "intake", { section: "open_item", job_number: "J-200", owner: "Test Owner", ...extra });
    expect((await add({ action: "TEST unknown", item_type: "unknown" })).isError).toBe(false);
    expect((await add({ action: "TEST no", item_type: "no", recommendation: "Get it in writing", why: "Protects schedule" })).isError).toBe(false);
    expect((await add({ action: "TEST pending", item_type: "pending_document", waiting_on_document: "Insurance certificate", waiting_on_who: "Test Sub", waiting_since: "2026-10-01" })).isError).toBe(false);
    expect((await add({ action: "TEST deadline", item_type: "deadline", needed_by: "2026-10-20", clause_source: "§8.3", delivery_method: "certified mail", recipient: "Owner rep" })).isError).toBe(false);
    const na = await call("owner", "answer", { job_number: "J-200", action: "mark_na", scope: "section", section: "budget", detail: "TEST N/A" });
    const o = await call("owner", "list_open_items", { job_number: "J-200" });
    const types = new Set(((o.structured?.items ?? []) as { item_type: string }[]).map((i) => i.item_type));
    for (const m of o.text.matchAll(/\[(unknown|no|na_disposition|pending_document|deadline)\]/g)) types.add(m[1]);
    expect([...types].sort(), o.text + "\n" + na.text).toEqual(["deadline", "na_disposition", "no", "pending_document", "unknown"]);
  });
});

describe("date sweep", () => {
  test("runs first at session start and labels precautionary dates", async () => {
    const o = await call("owner", "report", { job_number: "J-100" });
    expect(o.text.indexOf("DATE SWEEP")).toBe(0);
    expect(o.text).toMatch(/Precaution — assumed date, not a contract fact/);
  });
  test("deadline from a contract clause is computed and the ambiguity is labeled", async () => {
    await call("owner", "intake", { section: "job_settings", job_number: "J-100", time_zone: "America/Chicago" });
    const d = await call("owner", "intake", { section: "deadline", job_number: "J-100", clause_key: "notice", clause_ref: "§8.3", trigger_date: "2026-10-13", trigger_alternatives: ["2026-10-15"], n_days: 7, label: "TEST notice of delay" });
    expect(d.isError, d.text).toBe(false);
    const o = await call("owner", "list_open_items", { job_number: "J-100" });
    expect(o.text, o.text).toMatch(/TEST notice of delay|§8\.3/);
    expect(o.text).toMatch(/Precaution/);
  });
});

describe("gates", () => {
  test("approval check ON: a token without an OAuth client claim is rejected", async () => {
    const o = await callTool(handler, await tok("owner", { clientId: null }), "onboarding", { action: "read" });
    expect(o.status).toBe(401);
    expect(o.wwwAuth).toMatch(/OAuth client claim is required/);
  });
  test("no token: 401 with WWW-Authenticate", async () => {
    const o = await callTool(handler, null, "onboarding", { action: "read" });
    expect(o.status).toBe(401);
    expect(o.wwwAuth).toMatch(/resource_metadata/);
  });
  test("an account not on the allowlist is refused even if it is a TEST-company member", async () => {
    const db = state.db!;
    const co = (await db.query<{ id: string }>(`SELECT id FROM public.mcp_companies`)).rows[0].id;
    await db.query(`INSERT INTO public.mcp_company_members (company_id, user_id, role, display_name) VALUES ($1,$2,'owner','Test outsider') ON CONFLICT DO NOTHING`, [co, user("outsider").id]);
    const o = await call("outsider", "onboarding", { action: "read" });
    expect(o.isError && /Forbidden \(403\)/.test(o.text), o.text).toBe(true);
  });
  test("inactive membership is paused (no TEST bypass in mcp_gate)", async () => {
    const db = state.db!;
    await db.query(`DELETE FROM public.test_active_members WHERE user_id = $1`, [user("pm2").id]);
    await db.exec(`DELETE FROM public.mcp_gate_cache`);
    const o = await call("pm2", "report", { job_number: "J-200" });
    expect(o.isError && /membership isn't active/.test(o.text), o.text).toBe(true);
    const fn = await db.query<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'mcp_gate'`);
    expect(fn.rows[0].src).not.toMatch(/test_caller/);
  });
});
