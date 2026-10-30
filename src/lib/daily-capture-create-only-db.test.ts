import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  installDailyCaptureFixture,
  dailyFixture as f,
  captureSql,
  captureArgs,
  legacySql,
  dailyLines,
} from "../../tests/daily-capture-fixture.mjs";
import { asUser } from "../../tests/mcp-roles/fake-supabase";
let db: PGlite;
const query = (sql: string, args: unknown[] = [], user = f.owner) =>
  asUser<{ rows: Record<string, unknown>[] }>(
    db,
    { sub: user, role: "authenticated", email: "fixture@example.invalid" },
    (tx) => tx.query(sql, args),
  );
const create = async (args: unknown[], user = f.owner) =>
  (await query(captureSql, args, user)).rows[0] as {
    result: { saved: boolean; creation_only: boolean; replayed: boolean; id: string };
  };
beforeAll(async () => {
  db = new PGlite();
  await installDailyCaptureFixture((sql, args) =>
    args !== undefined || sql.trim().startsWith("SELECT")
      ? db.query(sql, args)
      : db.exec(sql).then(() => ({ rows: [] })),
  );
});
afterAll(async () => {
  await db?.close();
});
describe("create-only daily SQL proposal", () => {
  it("creates a daily once and replays the exact receipt without new work/rate rows", async () => {
    const args = captureArgs(crypto.randomUUID(), "2026-10-01");
    const first = await create(args);
    const replay = await create(args);
    expect(first.result).toMatchObject({ saved: true, creation_only: true, replayed: false });
    expect(replay.result).toMatchObject({ id: first.result.id, replayed: true });
    expect(
      (
        await db.query("SELECT count(*)::int n FROM mcp_daily_work_lines WHERE daily_id=$1", [
          first.result.id,
        ])
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await db.query("SELECT count(*)::int n FROM mcp_production_rates WHERE daily_id=$1", [
          first.result.id,
        ])
      ).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("rejects known-existing/stale absence and preserves canonical transcript and line identity", async () => {
    await query(legacySql, [
      f.job,
      "2026-10-02",
      "Keep this transcript",
      JSON.stringify(dailyLines("Existing work")),
    ]);
    const before = await db.query(
      "SELECT to_jsonb(r) report FROM mcp_daily_reports r WHERE report_date='2026-10-02'",
    );
    const lines = await db.query(
      "SELECT to_jsonb(l) line FROM mcp_daily_work_lines l JOIN mcp_daily_reports r ON r.id=l.daily_id WHERE r.report_date='2026-10-02'",
    );
    await expect(
      create(captureArgs(crypto.randomUUID(), "2026-10-02", "Must not replace")),
    ).rejects.toThrow("MCP_DAILY_EXISTS");
    expect(
      await db.query(
        "SELECT to_jsonb(r) report FROM mcp_daily_reports r WHERE report_date='2026-10-02'",
      ),
    ).toEqual(before);
    expect(
      await db.query(
        "SELECT to_jsonb(l) line FROM mcp_daily_work_lines l JOIN mcp_daily_reports r ON r.id=l.daily_id WHERE r.report_date='2026-10-02'",
      ),
    ).toEqual(lines);
  });
  it("rejects reuse of a request ID for a changed reviewed draft", async () => {
    const args = captureArgs(crypto.randomUUID(), "2026-10-03");
    await create(args);
    args[12] = JSON.stringify(dailyLines("Changed"));
    await expect(create(args)).rejects.toThrow("MCP_DAILY_KEY");
  });
  it("rejects expired/unconfirmed reviews without persisting a report or request", async () => {
    const id = crypto.randomUUID();
    await expect(
      create(
        captureArgs(id, "2026-10-04", "Expired", new Date(Date.now() - 16 * 60_000).toISOString()),
      ),
    ).rejects.toThrow("MCP_DAILY_STALE");
    await expect(
      create(captureArgs(id, "2026-10-04", undefined, undefined, undefined, false)),
    ).rejects.toThrow("MCP_DAILY_CONFIRM");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM mcp_daily_capture_requests WHERE request_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM mcp_daily_reports WHERE report_date='2026-10-04'",
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
  });
  it("rechecks access before replay and retains role/job boundaries", async () => {
    const args = captureArgs(crypto.randomUUID(), "2026-10-05");
    await create(args, f.super);
    await db.query("DELETE FROM mcp_job_access WHERE job_id=$1 AND user_id=$2", [f.job, f.super]);
    await expect(create(args, f.super)).rejects.toThrow("MCP_NO_JOB");
    for (const user of [f.contracts, f.outsider])
      await expect(create(captureArgs(crypto.randomUUID(), "2026-10-06"), user)).rejects.toThrow(
        /MCP_NO_JOB|role/,
      );
    await expect(
      create(
        captureArgs(crypto.randomUUID(), "2026-10-06", undefined, undefined, f.otherJob),
        f.pm,
      ),
    ).rejects.toThrow("MCP_NO_JOB");
    await expect(query("SELECT * FROM mcp_daily_capture_requests")).rejects.toThrow(
      "permission denied",
    );
  });
  it("rolls back a partially validated create including its receipt, work, rates and feed", async () => {
    const args = captureArgs(crypto.randomUUID(), "2026-10-07");
    args[12] = JSON.stringify([dailyLines("First valid")[0], { ...dailyLines()[0], crew: 0 }]);
    const feed = await db.query(
      "SELECT * FROM mcp_field_schedule_feed ORDER BY job_id,activity_id",
    );
    await expect(create(args)).rejects.toThrow(/missing|crew|hours/);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM mcp_daily_reports WHERE report_date='2026-10-07'",
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM mcp_daily_capture_requests WHERE request_id=$1",
          [args[3]],
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      await db.query("SELECT * FROM mcp_field_schedule_feed ORDER BY job_id,activity_id"),
    ).toEqual(feed);
  });
  it("does not revert a later correction when an old creation request is retried", async () => {
    const args = captureArgs(crypto.randomUUID(), "2026-10-08");
    await create(args);
    await query(legacySql, [
      f.job,
      "2026-10-08",
      "Later correction",
      JSON.stringify(dailyLines("Corrected work")),
    ]);
    const before = await db.query("SELECT * FROM mcp_daily_reports WHERE report_date='2026-10-08'");
    expect((await create(args)).result.replayed).toBe(true);
    expect(
      await db.query("SELECT * FROM mcp_daily_reports WHERE report_date='2026-10-08'"),
    ).toEqual(before);
  });
});
