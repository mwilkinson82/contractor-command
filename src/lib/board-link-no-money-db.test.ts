// Board links never send job money: 20261107001000_athena_board_link_no_money on a local database, with stand-in
// link openers that return a money-laden feed (the real openers keep their bodies under *_full names). Made-up data.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { redactMoney } from "./board-redact";

const MIGRATION = "supabase/migrations/20261107001000_athena_board_link_no_money.sql";
const ROLLBACK = "supabase/rollbacks/20261107001000_athena_board_link_no_money.rollback.sql";
const JOB = "00000000-0000-4000-8000-0000000000b1";
const FEED = {
  page: "items",
  job_number: "2717",
  contract_total: 3410000,
  total_float: 4,
  scope: "full",
  items: [
    {
      id: "1",
      action: "Review the IOR risk: Cabinets damaged on delivery ($20,000 held)",
      amount: 20000,
      due: "2026-06-28",
    },
    { id: "2", action: "Collect $9,500.25 on job 2717 by 6/28", gross_cents: 950025 },
    { id: "3", action: "Submit RFI 126 response", duration: 5 },
  ],
};
let db: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read field by field
const asAnon = async (sql: string, values: unknown[] = []): Promise<any> => {
  await db.exec("BEGIN; SET LOCAL ROLE anon;");
  try {
    return (await db.query(sql, values)).rows[0];
  } finally {
    await db.exec("ROLLBACK;");
  }
};
const stubs = (feed: object) => `
CREATE OR REPLACE FUNCTION public.mcp_board_link_open(_token_hash text, _job uuid, _page text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT jsonb_build_object('status', 'ok', 'payload', '${JSON.stringify(feed)}'::jsonb || jsonb_build_object('page', _page)) $$;
CREATE OR REPLACE FUNCTION public.mcp_change_log_open(_token_hash text, _job uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT jsonb_build_object('status', 'ok', 'payload', '${JSON.stringify(feed)}'::jsonb) $$;
CREATE OR REPLACE FUNCTION public.mcp_request_log_open(_token_hash text, _job uuid, _kind text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT jsonb_build_object('status', 'ok', 'payload', '${JSON.stringify(feed)}'::jsonb) $$;
CREATE OR REPLACE FUNCTION public.mcp_submittal_record_open(_token_hash text, _job uuid, _number text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT jsonb_build_object('status', 'denied') $$;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text), public.mcp_change_log_open(text, uuid),
  public.mcp_request_log_open(text, uuid, text), public.mcp_submittal_record_open(text, uuid, text) TO anon, authenticated;`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; GRANT USAGE ON SCHEMA public TO anon, authenticated;",
  );
  await db.exec(stubs(FEED));
  await db.exec(readFileSync(MIGRATION, "utf8"));
});
afterAll(async () => db?.close());

describe("board link feeds after the migration", () => {
  it("drops money fields and dollar figures from a page opened through a link", async () => {
    const row = await asAnon("SELECT public.mcp_board_link_open($1, $2, 'items') AS r", [
      "a".repeat(64),
      JOB,
    ]);
    expect(row.r.status).toBe("ok");
    const payload = row.r.payload;
    expect(JSON.stringify(payload)).not.toMatch(/\$|20000|950025|3410000/);
    expect(payload.total_float).toBe(4);
    expect(payload.items.map((i: { action: string }) => i.action)).toEqual([
      "Review the IOR risk: Cabinets damaged on delivery",
      "Collect an amount on job 2717 by 6/28",
      "Submit RFI 126 response",
    ]);
  });

  it("matches the page's own redaction exactly", async () => {
    const row = await asAnon("SELECT public.mcp_board_link_open($1, $2, 'items') AS r", [
      "a".repeat(64),
      JOB,
    ]);
    expect(row.r.payload).toEqual(redactMoney({ ...FEED, page: "items" }));
  });

  it("denies the IOR, billing forecast and change order log through a link", async () => {
    for (const page of ["ior", "payapp"]) {
      const row = await asAnon("SELECT public.mcp_board_link_open($1, $2, $3) AS r", [
        "a".repeat(64),
        JOB,
        page,
      ]);
      expect(row.r).toEqual({ status: "denied" });
    }
    const co = await asAnon("SELECT public.mcp_change_log_open($1, $2) AS r", [
      "a".repeat(64),
      JOB,
    ]);
    expect(co.r.status).toBe("denied");
    expect(co.r.payload).toBeNull();
  });

  it("redacts RFI and RFC logs and passes refusals through untouched", async () => {
    const rfi = await asAnon("SELECT public.mcp_request_log_open($1, $2, 'rfi') AS r", [
      "a".repeat(64),
      JOB,
    ]);
    expect(JSON.stringify(rfi.r.payload)).not.toContain("$");
    const sub = await asAnon("SELECT public.mcp_submittal_record_open($1, $2, '1') AS r", [
      "a".repeat(64),
      JOB,
    ]);
    expect(sub.r).toEqual({ status: "denied" });
  });

  it("keeps the originals out of reach of client roles", async () => {
    for (const fn of [
      "mcp_board_link_open_full($1, $2, 'items')",
      "mcp_change_log_open_full($1, $2)",
      "mcp_request_log_open_full($1, $2, 'rfi')",
      "mcp_submittal_record_open_full($1, $2, '1')",
      "mcp_private.board_redact_money('{}'::jsonb)",
    ])
      await expect(
        asAnon(
          `SELECT ${fn.startsWith("mcp_private") ? fn : `public.${fn}`} AS r`,
          fn.startsWith("mcp_private") ? [] : ["a".repeat(64), JOB],
        ),
      ).rejects.toThrow(/permission denied/);
  });

  it("runs twice safely and rolls back to the originals", async () => {
    await db.exec(readFileSync(MIGRATION, "utf8"));
    await db.exec(readFileSync(ROLLBACK, "utf8"));
    const row = await asAnon("SELECT public.mcp_board_link_open($1, $2, 'ior') AS r", [
      "a".repeat(64),
      JOB,
    ]);
    expect(row.r.status).toBe("ok");
    expect(row.r.payload.contract_total).toBe(3410000);
    await db.exec(readFileSync(MIGRATION, "utf8"));
  });
});
