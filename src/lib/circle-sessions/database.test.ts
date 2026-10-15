import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create table public.member_announcements(id uuid);`,
  );
  await db.exec(readFileSync("supabase/migrations/20261014172528_circle_sessions.sql", "utf8"));
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("reset role; truncate circle_sessions");
});
const publish = (
  url = "https://meet.google.com/abc-defg-hij",
  status = "success",
  event = "event1",
  updated = "2026-10-14T00:00:00Z",
  cadence = "2099-10-25",
) =>
  db.query(
    `select publish_circle_calendar_session('owner',$1,'Circle','2099-10-25T21:00:00Z','America/New_York',90,$2,$3,$4,$5,'Work',true) id`,
    [event, url, updated, cadence, status],
  );
it("is service-only under direct table and function access", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(db.query("select * from circle_sessions")).rejects.toThrow(/permission denied/);
    await expect(publish()).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await expect(publish()).resolves.toBeDefined();
});
it("publishes atomically, deduplicates retries, guards cadence and unique conference", async () => {
  await publish();
  await publish();
  expect((await db.query("select version from circle_sessions")).rows).toEqual([{ version: 1 }]);
  await expect(
    publish("https://meet.google.com/klm-nopq-rst", "pending", "event2"),
  ).rejects.toThrow(/successful/);
  await expect(
    publish("https://meet.google.com/klm-nopq-rst", "success", "event2"),
  ).rejects.toThrow(/unique/);
  await expect(publish(undefined, "success", "event3", undefined, "2099-11-08")).rejects.toThrow(
    /unique/,
  );
  expect((await db.query("select count(*)::integer n from circle_sessions")).rows).toEqual([
    { n: 1 },
  ]);
});
it("increments versions on edits, rejects invalid zones, and never resurrects canceled events", async () => {
  await publish();
  await expect(db.exec("update circle_sessions set time_zone='Bogus/Zone'")).rejects.toThrow(
    /time zone/,
  );
  await db.exec("update circle_sessions set title='Changed'");
  expect((await db.query("select version from circle_sessions")).rows).toEqual([{ version: 2 }]);
  await db.exec("update circle_sessions set status='canceled'");
  await expect(publish()).rejects.toThrow(/Canceled/);
});
