import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
import { changeTermsBoardSql, choiceStageSql, gbbSql } from "../../../tests/selections/sql";
import { willowCreekTypeE } from "./__fixtures__/willow-creek-type-e";
import { customerProposal } from "./proposal";

const owner = "00000000-0000-4000-8000-000000000901";
const outsider = "00000000-0000-4000-8000-000000000902";
const estimator = "00000000-0000-4000-8000-000000000903";
const fieldSuper = "00000000-0000-4000-8000-000000000904";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
let db: PGlite;

const rpc = (name: string, args: unknown[], user: string | null = owner) =>
  user === null
    ? db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        return (
          await tx.query<{ data: unknown }>(
            `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
            args,
          )
        ).rows[0].data;
      })
    : asUser(
        db,
        { sub: user, email: "fixture@example.com", role: "authenticated" },
        async (tx) =>
          (
            (await tx.query(
              `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
              args,
            )) as { rows: { data: unknown }[] }
          ).rows[0].data,
      );
const body = (b = willowCreekTypeE()) => JSON.stringify(b);
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
type Saved = { version: number; board: ReturnType<typeof willowCreekTypeE> };

beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec("ALTER FUNCTION public.mcp_estimate_guard(uuid) VOLATILE");
  // Live in supabase/migrations/20261021120000_athena_report_pages.sql; the test base stops earlier.
  await db.exec(`CREATE OR REPLACE FUNCTION public.mcp_is_company_leader(_company uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role = 'owner') $$`);
  for (const sql of gbbSql()) await db.exec(sql);
  for (const sql of gbbSql()) await db.exec(sql); // every part is safe to rerun
  await db.exec(choiceStageSql());
  await db.exec(changeTermsBoardSql());
  for (const id of [owner, outsider, estimator, fieldSuper]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [id]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [id]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'ALP Test',$2)", [
    company,
    owner,
  ]);
  for (const [user, role] of [
    [owner, "owner"],
    [estimator, "estimating"],
    [fieldSuper, "super"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Member')",
      [company, user, role],
    );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Willow Creek Community Center','2810',$3)",
    [job, owner, company],
  );
  await db
    .query("INSERT INTO mcp_job_access(job_id,user_id) VALUES($1,$2)", [job, fieldSuper])
    .catch(() => undefined);
});
afterAll(async () => db?.close());

describe.sequential("Good, Better, Best storage and sharing", () => {
  it("starts empty, saves exact data with a version check, and keeps history", async () => {
    expect(await rpc("mcp_residential_selections_get", [job])).toMatchObject({
      version: 0,
      board: { currency: null, selections: [], accepted: null, proposal: { base_tier: "good" } },
    });
    expect(await rpc("mcp_residential_selections_save", [job, 0, body()])).toMatchObject({
      version: 1,
      board: willowCreekTypeE(),
    });
    await expect(rpc("mcp_residential_selections_save", [job, 0, body()])).rejects.toThrow(
      /changed/i,
    );
    const history = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mcp_private.residential_selection_board_history WHERE job_id = $1",
      [job],
    );
    expect(history.rows[0].n).toBe(1);
  });

  it("lets the estimator build the board but not share it or record a choice", async () => {
    const saved = (await rpc(
      "mcp_residential_selections_save",
      [job, 1, body()],
      estimator,
    )) as Saved;
    expect(saved.version).toBe(2);
    await expect(
      rpc("mcp_selection_proposal_share_create", [job, 2, hashA, inDays(7)], estimator),
    ).rejects.toThrow(/full job access/i);
    await expect(
      rpc(
        "mcp_residential_selections_record_choice",
        [job, 2, "better", today(), "Email"],
        estimator,
      ),
    ).rejects.toThrow(/full job access/i);
  });

  it("refuses another company, field roles and direct table access", async () => {
    await expect(rpc("mcp_residential_selections_get", [job], outsider)).rejects.toThrow();
    await expect(
      rpc("mcp_residential_selections_save", [job, 2, body()], outsider),
    ).rejects.toThrow();
    await expect(rpc("mcp_residential_selections_get", [job], fieldSuper)).rejects.toThrow();
    for (const table of [
      "residential_selection_boards",
      "residential_selection_board_history",
      "selection_proposal_shares",
    ]) {
      const r = await db.query<{ a: boolean; b: boolean }>(
        `SELECT has_table_privilege('authenticated','mcp_private.${table}','SELECT') AS a, has_table_privilege('anon','mcp_private.${table}','SELECT') AS b`,
      );
      expect(r.rows[0]).toEqual({ a: false, b: false });
    }
    await expect(rpc("mcp_residential_selections_get", [job], null)).rejects.toThrow();
  });

  it("validates direct RPC input and leaves the board unchanged on failure", async () => {
    const bad: ((b: ReturnType<typeof willowCreekTypeE>) => void)[] = [
      (b) => (b.selections[0].allowance_cents = -1),
      (b) => (b.selections[0].decision_due = "2026-02-30"),
      (b) => (b.selections[0].options.good.photo_url = "http://insecure.example/x.jpg"),
      (b) => (b.selections[0].quantity = 1.2345),
      (b) => ((b.selections[0].options.good as unknown as Record<string, unknown>).margin = 5),
      (b) => (b.selections[0].options.best.price_cents = null),
      (b) => (b.selections[0].options.good.included = [""]),
    ];
    for (const mutate of bad) {
      const b = willowCreekTypeE();
      mutate(b);
      await expect(rpc("mcp_residential_selections_save", [job, 2, body(b)])).rejects.toThrow(
        /MCP_BAD/,
      );
    }
    expect(((await rpc("mcp_residential_selections_get", [job])) as Saved).version).toBe(2);
  });

  it("won't let a save set or clear the recorded customer choice", async () => {
    const b = willowCreekTypeE();
    b.accepted = {
      tier: "best",
      board_version: 3,
      total_cents: 1,
      recorded_on: today(),
      recorded_by: owner,
      evidence: "forged",
    };
    await expect(rpc("mcp_residential_selections_save", [job, 2, body(b)])).rejects.toThrow(
      /recorded customer choice/,
    );
  });

  it("refuses to share or record a choice on an unreviewed board", async () => {
    await rpc("mcp_residential_selections_save", [job, 2, body(willowCreekTypeE(false))]);
    await expect(
      rpc("mcp_selection_proposal_share_create", [job, 3, hashA, inDays(7)]),
    ).rejects.toThrow(/not ready/i);
    await expect(
      rpc("mcp_residential_selections_record_choice", [job, 3, "better", today(), "Email"]),
    ).rejects.toThrow(/not ready/i);
    await rpc("mcp_residential_selections_save", [job, 3, body()]);
  });

  it("freezes the same customer view the app builds, with nothing private in it", async () => {
    await expect(
      rpc("mcp_selection_proposal_share_create", [job, 3, hashA, inDays(7)]),
    ).rejects.toThrow(/changed/);
    await expect(
      rpc("mcp_selection_proposal_share_create", [job, 4, hashA, inDays(91)]),
    ).rejects.toThrow(/1 to 90/);
    const created = (await rpc("mcp_selection_proposal_share_create", [
      job,
      4,
      hashA,
      inDays(7),
    ])) as {
      board_version: number;
      proposal: unknown;
    };
    expect(created.board_version).toBe(4);
    expect(created.proposal).toEqual(customerProposal(willowCreekTypeE(), 4));
    const opened = (await rpc("mcp_selection_proposal_share_open", [hashA], null)) as Record<
      string,
      unknown
    >;
    expect(opened).toMatchObject({
      company: "ALP Test",
      job_name: "Willow Creek Community Center",
      board_version: 4,
      proposal: customerProposal(willowCreekTypeE(), 4),
    });
    const json = JSON.stringify(opened);
    for (const secret of [
      "cost_cents",
      "6997",
      "assumptions",
      "Confirm count",
      "base_basis",
      "found_at",
    ])
      expect(json).not.toContain(secret);
    expect(await rpc("mcp_selection_proposal_share_open", ["c".repeat(64)], null)).toBeNull();
    expect(await rpc("mcp_selection_proposal_share_open", ["not-a-hash"], null)).toBeNull();
  });

  it("keeps a shared link frozen when the board changes later", async () => {
    const b = willowCreekTypeE();
    b.selections[0].options.better.price_cents = 99999;
    await rpc("mcp_residential_selections_save", [job, 4, body(b)]);
    const opened = (await rpc("mcp_selection_proposal_share_open", [hashA], null)) as {
      proposal: { packages: { total_cents: number }[] };
    };
    expect(opened.proposal.packages[1].total_cents).toBe(4_883_600);
    await rpc("mcp_residential_selections_save", [job, 5, body()]);
  });

  it("records the customer's choice once, on the version they saw, and never touches other records", async () => {
    await expect(
      rpc("mcp_residential_selections_record_choice", [job, 6, "better", "2020-01-01", "Email"]),
    ).rejects.toThrow(/today/);
    await expect(
      rpc("mcp_residential_selections_record_choice", [job, 6, "better", today(), " "]),
    ).rejects.toThrow(/how the customer/);
    const recorded = (await rpc("mcp_residential_selections_record_choice", [
      job,
      6,
      "better",
      today(),
      "Customer email, Nov 4",
    ])) as Saved;
    expect(recorded.version).toBe(7);
    expect(recorded.board.accepted).toEqual({
      tier: "better",
      board_version: 7,
      total_cents: 4_883_600,
      recorded_on: today(),
      recorded_by: owner,
      evidence: "Customer email, Nov 4",
    });
    expect(recorded.board.selections.every((s) => s.selected === "better")).toBe(true);
    await expect(
      rpc("mcp_residential_selections_record_choice", [job, 6, "best", today(), "Email"]),
    ).rejects.toThrow(/changed/);
    const history = await db.query<{ action: string }>(
      "SELECT action FROM mcp_private.residential_selection_board_history WHERE job_id = $1 ORDER BY version DESC LIMIT 1",
      [job],
    );
    expect(history.rows[0].action).toBe("record_choice");
    // A later save must carry the recorded choice unchanged.
    const keep = structuredClone(recorded.board);
    keep.proposal.terms = "Updated terms";
    expect(
      ((await rpc("mcp_residential_selections_save", [job, 7, JSON.stringify(keep)])) as Saved)
        .version,
    ).toBe(8);
    const shareB = (await rpc("mcp_selection_proposal_share_create", [
      job,
      8,
      hashB,
      inDays(7),
    ])) as {
      proposal: { accepted: unknown };
    };
    expect(shareB.proposal.accepted).toBeNull(); // the board changed after the choice
  });

  it("turns a link off for its maker or an owner, and expired or revoked links show nothing", async () => {
    expect(await rpc("mcp_selection_proposal_share_revoke", [hashA], estimator)).toBeNull();
    expect(await rpc("mcp_selection_proposal_share_revoke", [hashA])).toMatchObject({
      board_version: 4,
    });
    expect(await rpc("mcp_selection_proposal_share_open", [hashA], null)).toBeNull();
    await db.query(
      "UPDATE mcp_private.selection_proposal_shares SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
      [hashB],
    );
    expect(await rpc("mcp_selection_proposal_share_open", [hashB], null)).toBeNull();
  });
});
