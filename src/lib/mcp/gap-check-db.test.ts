import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1101),
  superId = id(1102),
  outsider = id(1103),
  company = id(1201),
  job = id(1301);
let db: PGlite;

async function call<T = Record<string, unknown>>(user: string, sql: string, args: unknown[] = []) {
  return asUser(db, { sub: user, role: "authenticated" } as never, async (tx) => {
    const r = await tx.query(sql, args);
    return (r.rows[0] as { value: T }).value;
  });
}
const gaps = (items: unknown[]) =>
  call(owner, "SELECT public.mcp_estimate_gaps_save($1,$2::jsonb) AS value", [job, JSON.stringify(items)]);
const answer = (
  user: string,
  gap: string,
  a: string,
  extra: { amount?: number | null; by?: string | null; note?: string | null; qual?: string | null; q?: string | null } = {},
) =>
  call(
    user,
    "SELECT public.mcp_estimate_gap_answer_save($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value",
    [job, gap, a, extra.amount ?? null, extra.by ?? null, extra.note ?? null, extra.qual ?? null, extra.q ?? null, "chat"],
  );
const board = (user = owner) =>
  call<{ gaps: Record<string, unknown>[]; stamp: string; job_number: string; company: string }>(
    user,
    "SELECT public.mcp_estimate_gap_board($1) AS value",
    [job],
  );

const temp = {
  ref: "G-1",
  kind: "verify",
  category: "scope_seam",
  severity: "hard",
  title: "Temporary power and heat",
  reasoning: "Note 14: contractor provides temporary power; may use the owner's panel if capacity allows.",
  sheet: "E-001",
  spec_section: "01 51 00",
  holds_bid: true,
  question: "If the owner says no, are you carrying a generator and fuel?",
  conditional: true,
  condition_text: "May use the owner's panel if capacity allows.",
  exposure_low: 180000,
  exposure_high: 230000,
  schedule_activity: "Whole job duration",
  citations: ["E-001 note 14 · 01 51 00"],
};
const permits = {
  ref: "G-2",
  kind: "verify",
  category: "scope_seam",
  severity: "hard",
  title: "Permits",
  reasoning: "Permits by contractor. Sheet E-001. Spec 01 41 00.",
  sheet: "E-001",
  spec_section: "01 41 00",
  holds_bid: true,
};

beforeAll(async () => {
  db = await makeDb();
  for (const m of ["20261022200000_athena_estimating.sql", "20261106090000_athena_gap_check.sql"])
    await db.exec(readFileSync(`supabase/migrations/${m}`, "utf8"));
  for (const user of [owner, superId, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fictional@example.invalid')", [user]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Builder',$2)", [company, owner]);
  for (const [user, role] of [
    [owner, "owner"],
    [superId, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Fictional member')",
      [company, user, role],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Harbor Point','SYN-GAP',$3)",
    [job, owner, company],
  );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [job, superId, owner]);
});
afterAll(() => db.close());

describe("gap check storage", () => {
  it("saves the question, the condition, the exposure and the citations with the gap", async () => {
    expect(await gaps([temp, permits])).toEqual({ saved: 2 });
    const b = await board();
    expect(b.job_number).toBe("SYN-GAP");
    expect(b.company).toBe("Fictional Builder");
    const g1 = b.gaps.find((g) => g.ref === "G-1")!;
    expect(g1).toMatchObject({
      conditional: true,
      condition_text: temp.condition_text,
      question: temp.question,
      exposure_high: 230000,
      citations: temp.citations,
      answer: null,
      verdict: null,
    });
  });

  it("refuses half answers and the owner's-panel trap on a conditional gap", async () => {
    await expect(answer(owner, "G-1", "carrying")).rejects.toThrow(/in dollars/);
    await expect(answer(owner, "G-1", "covered", { by: "general_conditions" })).rejects.toThrow(/Name the line/);
    await expect(answer(owner, "G-1", "covered", { by: "other", note: "Spare breaker in the owner's panel" })).rejects.toThrow(
      /only lets you use the owner's power if they agree/,
    );
    await expect(answer(owner, "G-1", "rfi")).rejects.toThrow(/RFI question/);
    await expect(answer(owner, "G-1", "understood")).rejects.toThrow(/qualification/);
    await expect(answer(owner, "G-9", "carrying", { amount: 1 })).rejects.toThrow(/not on this estimate/);
  });

  it("saves one answer per gap, replaces it on change, and the board and estimate read it", async () => {
    const before = (await board()).stamp;
    expect(await answer(owner, "G-1", "rfi", { q: "Will the facility confirm load capacity for temp heat?" })).toMatchObject({
      saved: true,
    });
    expect(await answer(owner, "G-1", "carrying", { amount: 228636, note: "Generator, fuel and service" })).toMatchObject({
      answer: "carrying",
    });
    const b = await board();
    expect(b.stamp).not.toBe(before);
    const g1 = b.gaps.find((g) => g.ref === "G-1")!;
    expect(g1.answer).toMatchObject({ answer: "carrying", amount: 228636, question: null, source: "chat" });
    const est = await call<{ gaps: Record<string, unknown>[] }>(owner, "SELECT public.mcp_estimate_get($1) AS value", [job]);
    expect(est.gaps.find((g) => g.ref === "G-1")!.answer).toMatchObject({ answer: "carrying" });
    expect(est.gaps.find((g) => g.ref === "G-2")!.answer).toBeNull();
    const rows = await db.query("SELECT count(*)::int AS n FROM mcp_estimate_gap_answers WHERE job_id=$1", [job]);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it("owner-in-writing is the one covered answer a conditional gap takes", async () => {
    expect(
      await answer(owner, "G-1", "covered", { by: "owner_in_writing", note: "Facility letter of Nov 2 confirms 200A for temp" }),
    ).toMatchObject({ answer: "covered" });
  });

  it("keeps an answered gap on the estimate when a later gap list leaves it out", async () => {
    await gaps([permits]);
    const refs = (await board()).gaps.map((g) => g.ref).sort();
    expect(refs).toEqual(["G-1", "G-2"]);
  });

  it("clears an answer back to To answer", async () => {
    expect(
      await call(owner, "SELECT public.mcp_estimate_gap_answer_clear($1,$2) AS value", [job, "G-1"]),
    ).toEqual({ cleared: true, ref: "G-1" });
    expect((await board()).gaps.find((g) => g.ref === "G-1")!.answer).toBeNull();
  });

  it("shows the latest estimator mark beside the gap", async () => {
    await call(owner, "SELECT public.mcp_estimate_verdict_save($1,'gap',NULL,'G-2','Permits','relevant',NULL,NULL,'GC carries permits') AS value", [job]);
    expect((await board()).gaps.find((g) => g.ref === "G-2")!.verdict).toMatchObject({ mark: "relevant", owner: "GC carries permits" });
  });

  it("keeps supers, outsiders and anon off the gap check", async () => {
    await expect(board(superId)).rejects.toThrow(/access to the estimate/);
    await expect(answer(superId, "G-2", "carrying", { amount: 5 })).rejects.toThrow(/access to the estimate/);
    await expect(board(outsider)).rejects.toThrow();
    const anon = await db.query(
      "SELECT has_function_privilege('anon','public.mcp_estimate_gap_answer_save(uuid,text,text,numeric,text,text,text,text,text)','EXECUTE') AS a, has_function_privilege('anon','public.mcp_estimate_gap_board(uuid)','EXECUTE') AS b, has_table_privilege('authenticated','public.mcp_estimate_gap_answers','INSERT') AS c",
    );
    expect(anon.rows[0]).toEqual({ a: false, b: false, c: false });
  });

  it("keeps the read RPCs volatile so the member gate can lock", async () => {
    const r = await db.query(
      "SELECT proname, provolatile FROM pg_proc WHERE proname IN ('mcp_estimate_get','mcp_estimate_gap_board') ORDER BY proname",
    );
    expect(r.rows).toEqual([
      { proname: "mcp_estimate_gap_board", provolatile: "v" },
      { proname: "mcp_estimate_get", provolatile: "v" },
    ]);
  });
});
