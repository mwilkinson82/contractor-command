/* eslint-disable @typescript-eslint/no-explicit-any -- SQL RPC responses have different JSON shapes, asserted below. */
/* Local PGlite integration tests: synthetic users and data only. */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const owner = "00000000-0000-4000-8000-000000000901";
const outsider = "00000000-0000-4000-8000-000000000904";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const req = (n: number) => `00000000-0000-4000-8001-${String(n).padStart(12, "0")}`;
let db: PGlite;
const rpc = async (name: string, args: unknown[], user = owner) =>
  asUser(
    db,
    { sub: user, email: "fixture@example.com", role: "authenticated" },
    async (tx) =>
      (
        await tx.query(
          `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
          args,
        )
      ).rows[0].data as any,
  );
const snapshot = () => rpc("mcp_estimate_coverage_snapshot", [job]);
const decisions: Record<string, unknown>[] = [
  {
    quote_index: 0,
    decision: "carry",
    ref: "T-1",
    replace_labor_and_material: true,
    exclusive_to_line: true,
    source_note: "Written quotation",
    scope_note: "Complete line",
    exclusions_note: "None stated",
  },
  { quote_index: 1, decision: "compare", ref: "T-1" },
];
const review = (id: number, version: number, rows = decisions) =>
  rpc("mcp_estimate_coverage_review", [job, req(id), version, JSON.stringify(rows)]);
const save = (id: number, confirmed = true) =>
  rpc("mcp_estimate_coverage_save", [job, req(id), confirmed]);
const pricing = (version: number, quotes: unknown[] | null) =>
  rpc("mcp_estimate_pricing_save_versioned", [
    job,
    version,
    null,
    null,
    quotes === null ? null : JSON.stringify(quotes),
    null,
  ]);
const quotes = [
  { sub: "A", description: "Whole scope", amount: 1200, ref: "T-1" },
  { sub: "B", description: "Comparison", amount: 1300, ref: "T-1" },
];

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/20261022230000_athena_estimating_bid.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261023010000_athena_estimating_conventions.sql", "utf8"),
  );
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const migration of [
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
  for (const id of [owner, outsider]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','COVERAGE',$3)",
    [job, owner, company],
  );
  await rpc("mcp_estimate_setup_save", [job, JSON.stringify({ role: "gc", trades: ["Finishes"] })]);
  await rpc("mcp_estimate_takeoff_save", [
    job,
    "A",
    "[]",
    JSON.stringify([
      {
        line_no: 1,
        item: "Paint",
        qty: 100,
        unit: "SF",
        sheet: "A1",
        basis: "measured",
        math: "100 SF",
      },
    ]),
  ]);
});
afterAll(async () => db.close());

describe.sequential("atomic quote coverage proposal", () => {
  it("takes coherent raw state and guards access", async () => {
    const s = await snapshot();
    expect(s).toMatchObject({
      selection: null,
      estimate: { setup: { role: "gc" }, takeoff: { version: 1 } },
      takeoff: { takeoff_version: 1 },
      bid: { pricing: null },
    });
    await expect(rpc("mcp_estimate_coverage_snapshot", [job], outsider)).rejects.toThrow();
    const privileges = await db.query<{ allowed: boolean }>(
      `SELECT has_function_privilege('anon',p.oid,'execute') AS allowed FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace AND p.proname IN
       ('mcp_estimate_coverage_snapshot','mcp_estimate_coverage_review','mcp_estimate_coverage_save',
        'mcp_estimate_pricing_save_versioned','mcp_estimate_bid_save_versioned')`,
    );
    expect(privileges.rows).toHaveLength(5);
    expect(privileges.rows.every((row) => !row.allowed)).toBe(true);
  });
  it("rejects stale pricing saves and preserves quotes on omitted arrays", async () => {
    const a = await snapshot();
    await pricing(a.version, quotes);
    await expect(pricing(a.version, [])).rejects.toThrow(/changed/i);
    const b = await snapshot();
    expect(b.bid.pricing.quotes).toEqual(quotes);
    await pricing(b.version, null);
    expect((await snapshot()).bid.pricing.quotes).toEqual(quotes);
  });
  it("requires complete, unique whole-line coverage and returns exact quote evidence", async () => {
    const s = await snapshot();
    await expect(review(1, s.version, [decisions[0]])).rejects.toThrow(/every current quote/i);
    await expect(review(2, s.version, [decisions[0], decisions[0]])).rejects.toThrow(/indices/i);
    await expect(
      review(3, s.version, [{ ...decisions[0], exclusions_note: "" }, decisions[1]]),
    ).rejects.toThrow(/exclusions/i);
    await expect(
      review(30, s.version, [{ ...decisions[0], exclusive_to_line: false }, decisions[1]]),
    ).rejects.toThrow(
      /no other priced scope or cost, including direct lines, gaps, general conditions or requirements/i,
    );
    await expect(
      review(31, s.version, [decisions[0], { ...decisions[0], quote_index: 1 }]),
    ).rejects.toThrow(/whole line/i);
    const result = await review(4, s.version);
    expect(result).toMatchObject({
      current: true,
      status: "review",
      decisions: [{ quote: quotes[0], line: { line_no: 1, item: "Paint" } }, { quote: quotes[1] }],
    });
    await expect(save(4, false)).rejects.toThrow(/confirm/i);
    expect((await snapshot()).selection).toBeNull();
    expect(await review(4, s.version)).toEqual(result);
    await expect(
      review(4, s.version, [{ ...decisions[0], scope_note: "Different" }, decisions[1]]),
    ).rejects.toThrow(/different review/i);
  });
  it("saves once, advances version without invalidating itself, and retries safely", async () => {
    const before = await snapshot();
    const saved = await save(4);
    expect(saved).toMatchObject({ status: "saved", current: true, version: before.version + 1 });
    expect(await save(4)).toEqual(saved);
    const after = await snapshot();
    expect(after.selection).toMatchObject({
      current: true,
      version: saved.version,
      decisions: saved.decisions,
    });
    expect(after.bid.pricing.quotes).toEqual(quotes);
  });
  it("invalidates saved selections on a source write and rejects stale reviews", async () => {
    const a = await snapshot();
    await review(5, a.version);
    await rpc("mcp_estimate_setup_save", [job, JSON.stringify({ in_scope: ["Paint"] })]);
    expect((await snapshot()).selection.current).toBe(false);
    await expect(save(5)).rejects.toThrow(/changed/i);
    expect((await save(4)).current).toBe(false);
  });
  it("allows only one of two reviews of the same version to save", async () => {
    const a = await snapshot();
    await review(6, a.version);
    await review(7, a.version);
    await save(6);
    await expect(save(7)).rejects.toThrow(/changed/i);
    expect((await snapshot()).selection.current).toBe(true);
  });
  it("rolls back a saved review and version when a later statement fails", async () => {
    const before = await snapshot();
    await review(8, before.version);
    await expect(
      asUser(
        db,
        { sub: owner, email: "fixture@example.com", role: "authenticated" },
        async (tx) => {
          await tx.query("SELECT public.mcp_estimate_coverage_save($1,$2,true)", [job, req(8)]);
          await tx.query("SELECT 1/0");
        },
      ),
    ).rejects.toThrow();
    const rolledBack = await snapshot();
    expect(rolledBack.version).toBe(before.version);
    expect(rolledBack.selection).toEqual(before.selection);
    expect((await save(8)).version).toBe(before.version + 1);
  });
  it("rejects stale markup writes and invalidates the selection after a successful one", async () => {
    const before = await snapshot();
    const saved = await rpc("mcp_estimate_bid_save_versioned", [job, before.version, 10, 15]);
    expect(saved).toMatchObject({ saved: true, version: before.version + 1 });
    await expect(
      rpc("mcp_estimate_bid_save_versioned", [job, before.version, 20, 15]),
    ).rejects.toThrow(/changed/i);
    const after = await snapshot();
    expect(after.selection.current).toBe(false);
    expect(Number(after.bid.bid.overhead_pct)).toBe(10);
  });
  it("invalidates a reviewed choice after drawing, calibration, and geometry writes", async () => {
    const arm = async (id: number) => {
      const state = await snapshot();
      await review(id, state.version);
      await save(id);
      expect((await snapshot()).selection.current).toBe(true);
    };
    await arm(40);
    const source = await rpc("mcp_drawing_source_save", [
      job,
      JSON.stringify({
        path: `${company}/${job}/drawing-fixture/source.pdf`,
        storage_bucket: "athena-drawings",
        filename: "drawing.pdf",
        source_key: "fixture",
        content_hash: "a".repeat(64),
        sheets: ["A1"],
      }),
    ]);
    expect((await snapshot()).selection.current).toBe(false);
    await arm(41);
    const calibration = await rpc("mcp_takeoff_calibrate", [
      job,
      source.id,
      1,
      JSON.stringify({
        region: "full",
        width: 720,
        height: 360,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        reference: {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          distance: 100,
          unit: "ft",
        },
        method: "estimator",
        confidence: "high",
        confirmed: true,
      }),
      0,
    ]);
    expect((await snapshot()).selection.current).toBe(false);
    await arm(42);
    await rpc("mcp_takeoff_geometry_save", [
      job,
      "save",
      JSON.stringify({
        line_no: 1,
        takeoff_version: 1,
        source_id: source.id,
        page: 1,
        calibration_id: calibration.id,
        shape: {
          kind: "polygon",
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.3, y: 0.1 },
            { x: 0.3, y: 0.3 },
            { x: 0.1, y: 0.3 },
          ],
        },
      }),
      0,
    ]);
    expect((await snapshot()).selection.current).toBe(false);
  });
  it("keeps a selection for an identical legacy no-op, but invalidates it on an actual append", async () => {
    const before = await snapshot();
    await review(43, before.version);
    await save(43);
    const saved = await snapshot();
    await rpc("mcp_estimate_pricing_save", [job, null, null, JSON.stringify(quotes), null]);
    const noOp = await snapshot();
    expect(noOp.version).toBe(saved.version);
    expect(noOp.selection.current).toBe(true);
    await rpc("mcp_estimate_pricing_save", [
      job,
      JSON.stringify([{ ref: "T-1", hourly_rate: 100 }]),
      null,
      null,
      null,
    ]);
    const after = await snapshot();
    expect(after.selection.current).toBe(false);
    expect(after.bid.pricing.quotes).toEqual(quotes);
  });
  it("rejects stale legacy replacement and preserves duplicate quote multiplicity", async () => {
    const stale = await snapshot();
    const appended = [...quotes, quotes[0]];
    await pricing(stale.version, appended);
    const afterAppend = await snapshot();
    await expect(
      rpc("mcp_estimate_pricing_save", [job, null, null, JSON.stringify(quotes), null]),
    ).rejects.toThrow(/cannot be removed or changed/i);
    await expect(
      rpc("mcp_estimate_pricing_save", [
        job,
        null,
        null,
        JSON.stringify([{ ...quotes[0], amount: 1250 }, quotes[1], quotes[0]]),
        null,
      ]),
    ).rejects.toThrow(/cannot be removed or changed/i);
    const afterFailures = await snapshot();
    expect(afterFailures.bid.pricing.quotes).toEqual(appended);
    expect(afterFailures.version).toBe(afterAppend.version);
    const next = await snapshot();
    const revised = [...appended, { ...quotes[0], amount: 1250 }];
    await pricing(next.version, revised);
    expect((await snapshot()).bid.pricing.quotes).toEqual(revised);
  });
  it("installs version triggers on every snapshot source table", async () => {
    const rows = (
      await db.query<{ relname: string }>(
        "SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='estimate_coverage_changed' ORDER BY c.relname",
      )
    ).rows.map((r) => r.relname);
    expect(rows).toEqual([
      "mcp_drawing_versions",
      "mcp_estimate_bids",
      "mcp_estimate_gap_items",
      "mcp_estimate_general_conditions",
      "mcp_estimate_pricing",
      "mcp_estimate_requirements",
      "mcp_estimate_setup",
      "mcp_estimate_takeoff_lines",
      "mcp_estimate_takeoffs",
      "mcp_estimate_verdicts",
      "mcp_takeoff_calibrations",
      "mcp_takeoff_geometry",
      "mcp_takeoff_markups",
    ]);
  });
  it("does not prevent an isolated job and its estimate from being deleted", async () => {
    const otherJob = "00000000-0000-4000-8000-000000000921";
    await db.query(
      "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Other','OTHER',$3)",
      [otherJob, owner, company],
    );
    await rpc("mcp_estimate_setup_save", [otherJob, JSON.stringify({ role: "gc" })]);
    await db.query("DELETE FROM public.mcp_jobs WHERE id=$1", [otherJob]);
    expect((await db.query("SELECT id FROM public.mcp_jobs WHERE id=$1", [otherJob])).rows).toEqual(
      [],
    );
  });
});
