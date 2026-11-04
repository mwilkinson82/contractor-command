import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { installDailyCaptureFixture, dailyFixture as f } from "../../tests/daily-capture-fixture.mjs";
import { asUser } from "../../tests/mcp-roles/fake-supabase";

// Runs release-proposals/daily-without-sov-cpm.sql on a local Postgres with the
// real superintendent schema, then saves dailies and photos as the job's super.
const RELEASE = readFileSync("release-proposals/daily-without-sov-cpm.sql", "utf8");
let db: PGlite;
const exec = (sql: string, args?: unknown[]) =>
  args !== undefined || sql.trim().startsWith("SELECT") ? db.query(sql, args) : db.exec(sql).then(() => ({ rows: [] }));
const as = <T,>(sql: string, args: unknown[], user = f.super) =>
  asUser<{ rows: T[] }>(db, { sub: user, role: "authenticated", email: "fixture@example.invalid" }, (tx) => tx.query(sql, args));
const SAVE = "SELECT public.mcp_daily_report_save($1,$2,true,'Clear','2 electricians','none','none','none','none','none',NULL,$3::jsonb) AS r";
const save = (date: string, lines: unknown[], user = f.super) =>
  as<{ r: { id: string; lines: number; saved: boolean } }>(SAVE, [f.job, date, JSON.stringify(lines)], user).then((q) => q.rows[0].r);
const line = (over: Record<string, unknown> = {}) => ({ work: "Pulled wire", qty: 400, unit: "LF", crew: 2, hours: 8, ...over });

async function photo(date: string) {
  const id = crypto.randomUUID();
  const path = `${f.company}/${f.job}/${id}/progress.jpg`;
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('athena-progress',$1)", [path]);
  const res = await as<{ r: { linked_daily: boolean } }>(
    "SELECT public.mcp_progress_photo_create($1,$2,$3,'Level 2 corridor','Pulled wire',NULL,NULL,false,$4,'image/jpeg',100) AS r",
    [id, f.job, date, path],
  );
  return { id, linked: res.rows[0].r.linked_daily };
}
const dailyOf = async (photoId: string) =>
  (await db.query<{ daily_id: string | null }>("SELECT daily_id FROM mcp_progress_photos WHERE id=$1", [photoId])).rows[0].daily_id;

beforeAll(async () => {
  db = new PGlite();
  await installDailyCaptureFixture(exec);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("daily save before the release SQL", () => {
  it("refuses a work line with no SOV item or CPM activity (the reported bug)", async () => {
    await expect(save("2026-10-01", [line()])).rejects.toThrow(/missing the SOV item, the activity/);
    await expect(save("2026-10-01", [line({ sov_item: "26.04" })])).rejects.toThrow(/missing the SOV item, the activity/);
  });
});

describe("daily save after the release SQL", () => {
  beforeAll(async () => {
    await db.exec(RELEASE);
    await db.exec(RELEASE); // safe to rerun
  });

  it("saves a daily with no SOV item and no CPM activity, with its production rate", async () => {
    const saved = await save("2026-10-02", [line(), line({ work: "Set boxes", qty: 30, unit: "ea", sov_item: "none", activity_id: "N/A" })]);
    expect(saved).toMatchObject({ lines: 2, saved: true });
    const rows = (await db.query("SELECT work, sov_item, activity_id, qty::float AS qty FROM mcp_daily_work_lines WHERE daily_id=$1 ORDER BY line_no", [saved.id])).rows;
    expect(rows).toEqual([
      { work: "Pulled wire", sov_item: null, activity_id: null, qty: 400 },
      { work: "Set boxes", sov_item: null, activity_id: null, qty: 30 },
    ]);
    const rates = (await db.query("SELECT sov_item, activity_id, man_hours::float AS mh, qty_per_man_hour::float AS rate FROM mcp_production_rates WHERE daily_id=$1 AND work='Pulled wire'", [saved.id])).rows;
    expect(rates).toEqual([{ sov_item: null, activity_id: null, mh: 16, rate: 25 }]);
  });

  it("keeps SOV and CPM links, their format check and the schedule feed when the job has them", async () => {
    const saved = await save("2026-10-03", [line({ sov_item: "26.04", activity_id: "E090", pct_complete: 40 }), line({ work: "Trim", sov_item: "26.05", pct_complete: 90 })]);
    const rows = (await db.query("SELECT sov_item, activity_id FROM mcp_daily_work_lines WHERE daily_id=$1 ORDER BY line_no", [saved.id])).rows;
    expect(rows).toEqual([{ sov_item: "26.04", activity_id: "E090" }, { sov_item: "26.05", activity_id: null }]);
    const feed = (await db.query("SELECT activity_id, pct_complete::float AS pct FROM mcp_field_schedule_feed WHERE job_id=$1", [f.job])).rows;
    expect(feed).toEqual([{ activity_id: "E090", pct: 40 }]);
    await expect(save("2026-10-04", [line({ sov_item: "twenty six" })])).rejects.toThrow(/SOV item looks like 26\.04/);
    await expect(save("2026-10-04", [line({ activity_id: "X".repeat(21) })])).rejects.toThrow(/20 characters/);
    await expect(save("2026-10-04", [line({ crew: null })])).rejects.toThrow(/missing the work, the quantity/);
  });

  it("links progress photos to the daily, whether saved before or after it", async () => {
    const early = await photo("2026-10-05");
    expect(early.linked).toBe(false);
    const saved = await save("2026-10-05", [line()]);
    expect(await dailyOf(early.id)).toBe(saved.id);
    const late = await photo("2026-10-05");
    expect(late.linked).toBe(true);
    expect(await dailyOf(late.id)).toBe(saved.id);
    const otherDay = await photo("2026-10-06");
    expect(await dailyOf(otherDay.id)).toBeNull();
  });

  it("still keeps out people without field access to the job", async () => {
    await expect(save("2026-10-07", [line()], f.contracts)).rejects.toThrow();
    await expect(save("2026-10-07", [line()], f.outsider)).rejects.toThrow();
  });
});
