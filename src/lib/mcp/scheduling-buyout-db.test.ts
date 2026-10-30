import { schedulingBuyoutDb } from "../../../tests/scheduling-buyout-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { makeBuyoutDb, ids } from "../../../tests/buyout/fixture";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import { prepareSchedule, readScheduleControl } from "./schedule-control";
import {
  loadBuyoutScheduleLinks,
  reconcileBuyoutSchedules,
  type ScopedScheduleSnapshot,
} from "./scheduling-buyout";
import { buyoutProjection, type BuyoutLedger, type PackageFacts } from "./buyout";
import type { Activity, LivingData } from "./living";
import type { ScheduleRequest } from "./schedule-schema";

let db: PGlite;
const packageId = randomUUID();
const q = (sql: string, args: unknown[] = [], user = ids.owner) =>
  asUser(db, { sub: user, role: "authenticated", email: "cross-domain@synthetic.invalid" }, (tx) =>
    tx.query(sql, args),
  ) as Promise<{ rows: Record<string, unknown>[] }>;
const sb = (user = ids.owner) =>
  fakeClient(db, { sub: user, role: "authenticated", email: "cross-domain@synthetic.invalid" });
async function get(user = ids.owner, job = ids.job) {
  return (await q("SELECT mcp_buyout_get($1,$2) value", [ids.company, job], user)).rows[0]
    .value as BuyoutLedger;
}
async function cpm(version: number | null = null) {
  return (await q("SELECT mcp_living_report_get($1,'cpm',$2) value", [ids.job, version])).rows[0]
    .value as { version: number; data: LivingData };
}
const facts = (code = "A-OLD"): PackageFacts => ({
  code,
  title: "Electrical buyout",
  scope: "Switchgear and delivery",
  budget_cents: 100000,
  currency: "USD",
  status: "selected",
  candidates: [
    {
      party_id: ids.party,
      party_version: 1,
      quote_cents: 40000,
      scope: "Switchgear",
      exclusions: null,
      source: "Synthetic quote Q1",
      quoted_on: "2026-10-30",
      expected_delivery_on: "2026-11-05",
    },
  ],
  selected_party_id: ids.party,
  commitment_refs: [{ po_id: ids.po, version: 1 }],
  expected_award_on: "2026-10-30",
  needed_by: "2026-11-04",
  submittal_ids: [ids.sub],
  schedule_ref: { report_version: 1, activity_id: "DELIVERY" },
  source: "Synthetic scope and quote",
});
async function record(f: PackageFacts, version = 0, recordId = packageId, actor = ids.owner) {
  const args = [
    ids.company,
    ids.job,
    recordId,
    "package",
    version,
    JSON.stringify(f),
    "Cross-domain synthetic review",
    randomUUID(),
    randomUUID(),
  ];
  await q("SELECT mcp_buyout_review($1,$2,$3,$4,$5,$6,$7,$8,$9)", args, actor);
  return (await q("SELECT mcp_buyout_record($1,$2,$3,$4,$5,$6,$7,$8,$9,true) value", args, actor))
    .rows[0].value;
}
async function saveSchedule(request: ScheduleRequest, base: number) {
  const previous = base ? await cpm() : null;
  const prepared = prepareSchedule(previous?.data ?? null, base, request);
  await q(
    "SELECT mcp_living_report_save($1,'cpm',$2,$3::jsonb,$4,$5,1000,1000,$6,null,'Synthetic owner',null,false)",
    [
      ids.job,
      base,
      JSON.stringify(prepared.data),
      request.data_date,
      prepared.data.activities!.length,
      "Synthetic controlled update",
    ],
  );
}
const a = (id: string, duration: number, pred: string | null, wbs: string): Activity => ({
  id,
  name: id,
  duration,
  start: null,
  finish: null,
  predecessors: pred ? [{ id: pred, type: "FS" }] : [],
  total_float: null,
  critical: null,
  pct_complete: 0,
  value: id === "FAB" ? 1000 : 0,
  sov_line: "26.01",
  cost_code: "26-010",
  wbs_id: wbs,
});
async function addPoVersion(version: number, status: string, cents: number) {
  await db.query(
    "INSERT INTO mcp_purchase_order_versions(po_id,version,status,terms_id,party_snapshot,lines,order_date,needed_by,created_by) VALUES($1,$2,$3,$4,$5,$6,'2026-10-30','2026-11-04',$7)",
    [
      ids.po,
      version,
      status,
      ids.terms,
      { id: ids.party, name: "Synthetic Supplier" },
      JSON.stringify([{ quantity: 1, unit_price_cents: cents }]),
      ids.owner,
    ],
  );
}
beforeAll(async () => {
  db = await makeBuyoutDb(schedulingBuyoutDb);
  // Replace the original buyout suite's column-only CPM stub, in this fresh local
  // fixture only, with the actual immutable report schema/RPC used by scheduling.
  await db.exec("DROP TABLE mcp_living_reports");
  await db.exec(
    readFileSync("supabase/migrations/20261020213000_athena_living_reports.sql", "utf8"),
  );
  await db.exec(readFileSync("drizzle/migrations/0048_schedule_control_privacy.sql", "utf8"));
  // Install the exact current AP-original/payment proposals alongside the new
  // domains. Storage here is metadata-only; actual upload bytes remain a gate.
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text)",
  );
  for (const file of [
    "drizzle/migrations/0037_accounting_ap_references.sql",
    "drizzle/migrations/0038_accounting_receipts.sql",
    "docs/athena/payment-correction-proposal.sql",
    "docs/athena/ap-supplier-originals.proposed.sql",
  ])
    await db.exec(readFileSync(file, "utf8"));
  await saveSchedule(
    {
      operation: "recalculate",
      data_date: "2026-10-30",
      starter_wbs: true,
      settings: {
        project_start: "2026-10-30",
        default_calendar_id: "work",
        calendars: [{ id: "work", name: "Mon–Fri", work_days: 62, hours_per_day: 8, holidays: [] }],
        finish_convention: "inclusive-last-work-day",
        out_of_sequence: "retained-logic",
      },
      initial_activities: [
        a("FAB", 3, null, "procurement"),
        a("DELIVERY", 0, "FAB", "procurement"),
        a("INSTALL", 5, "DELIVERY", "construction"),
      ],
    },
    0,
  );
  await db.query(
    "INSERT INTO mcp_living_reports(job_id,report_type,version,data,data_date,change_what,updated_by) VALUES($1,'cpm',1,$2,'2026-10-30','Other scoped fixture',$3)",
    [
      ids.job2,
      {
        activities: [
          a("ONLY-OTHER", 0, null, "procurement"),
          { ...a("DELIVERY", 0, null, "procurement"), finish: "2040-01-01" },
        ],
      },
      ids.owner,
    ],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("WBS and buyout exact-version integration", () => {
  it("joins the exact package, party, PO and delivery milestone without changing CPM/AP", async () => {
    await record(facts());
    const before = await cpm();
    const result = await loadBuyoutScheduleLinks(sb(), await get());
    expect(result.packages[0]).toMatchObject({
      package_id: packageId,
      package_version: 1,
      reference_state: "current",
      selected_party_id: ids.party,
      selected_party_version: 1,
      reported_delivery_vs_needed_by_calendar_days: 1,
      reported_delivery_vs_linked_milestone_calendar_days: 1,
      quantified_schedule_impact: null,
    });
    expect(result.packages[0].current_activity).toMatchObject({
      activity_id: "DELIVERY",
      milestone: true,
      finish: "2026-11-04",
      wbs_id: "procurement",
    });
    expect(result.canonical_committed_cents).toBe(40000);
    expect(await cpm()).toEqual(before);
    expect(
      (await db.query<{ n: number }>("SELECT count(*)::int n FROM mcp_cost_submissions")).rows[0].n,
    ).toBe(0);
  });
  it("keeps pinned references when WBS changes and uses the same activity ID", async () => {
    const d = await cpm();
    const wbs = readScheduleControl(d.data)!.wbs;
    await saveSchedule(
      {
        operation: "organize",
        data_date: "2026-10-30",
        wbs: [
          ...wbs,
          {
            id: "gear-delivery",
            name: "Electrical / Delivery",
            parent_id: "procurement",
            order: 0,
          },
        ],
        assignments: [{ activity_id: "DELIVERY", wbs_id: "gear-delivery" }],
      },
      1,
    );
    const result = await loadBuyoutScheduleLinks(sb(), await get());
    expect(result.packages[0]).toMatchObject({
      package_version: 1,
      reference_state: "historical",
      schedule_ref: { report_version: 1, activity_id: "DELIVERY" },
      current_report_version: 2,
      pinned_to_current_finish_variance_calendar_days: 0,
    });
    expect(result.packages[0].pinned_activity!.wbs_id).toBe("procurement");
    expect(result.packages[0].current_activity!.wbs_id).toBe("gear-delivery");
    expect((await cpm(1)).data.activities!.find((a) => a.id === "DELIVERY")!.wbs_id).toBe(
      "procurement",
    );
  });
  it("distinguishes forecast milestone movement from a reported supplier delivery", async () => {
    await saveSchedule(
      { operation: "recalculate", data_date: "2026-10-30", updates: [{ id: "FAB", duration: 6 }] },
      2,
    );
    const result = await loadBuyoutScheduleLinks(sb(), await get());
    expect(result.packages[0]).toMatchObject({
      package_version: 1,
      reference_state: "historical",
      reported_expected_delivery_on: "2026-11-05",
      pinned_to_current_finish_variance_calendar_days: 5,
      reported_delivery_vs_linked_milestone_calendar_days: -4,
      quantified_schedule_impact: null,
    });
    expect(result.packages[0].current_activity!.finish).toBe("2026-11-09");
    expect((await cpm(1)).data.activities!.find((a) => a.id === "DELIVERY")!.finish).toBe(
      "2026-11-04",
    );
  });
  it("revises package/quote pins deliberately without rescheduling or approving a pending PO", async () => {
    await addPoVersion(2, "draft", 99000);
    const f = facts();
    f.candidates[0].expected_delivery_on = "2026-11-12";
    f.schedule_ref = { report_version: 3, activity_id: "DELIVERY" };
    const before = await cpm();
    await record(f, 1);
    const result = await loadBuyoutScheduleLinks(sb(), await get());
    expect(result.packages[0]).toMatchObject({
      package_version: 2,
      reference_state: "current",
      reported_expected_delivery_on: "2026-11-12",
      reported_delivery_vs_linked_milestone_calendar_days: 3,
    });
    expect(result.canonical_committed_cents).toBe(40000);
    expect(result.canonical_commitments[0].pending_revision).toBe(true);
    expect(await cpm()).toEqual(before);
  });
  it("keeps stale commitment values unknown while counting the current approved PO once", async () => {
    await addPoVersion(3, "approved", 60000);
    const result = await loadBuyoutScheduleLinks(sb(), await get());
    expect(result.packages[0].commitment_sources[0]).toMatchObject({
      version: 1,
      current: false,
      amount_cents: null,
    });
    expect(result.canonical_committed_cents).toBe(60000);
    expect(result.canonical_commitments).toHaveLength(1);
  });
  it("cancellation retains exact commitment exposure and does not release the PO for another package", async () => {
    const old = facts();
    old.candidates[0].expected_delivery_on = "2026-11-12";
    old.schedule_ref = { report_version: 3, activity_id: "DELIVERY" };
    old.status = "cancelled";
    old.commitment_refs = [{ po_id: ids.po, version: 3 }];
    await record(old, 2);
    const next = facts("Z-NEW");
    next.commitment_refs = [{ po_id: ids.po, version: 3 }];
    next.schedule_ref = { report_version: 3, activity_id: "DELIVERY" };
    const nextId = randomUUID();
    await expect(record(next, 0, nextId)).rejects.toThrow(/already linked to a buyout package/);
    const ledger = await get();
    const result = await loadBuyoutScheduleLinks(sb(), ledger);
    expect(result.canonical_committed_cents).toBe(60000);
    expect(result.canonical_commitments[0]).toMatchObject({
      package_id: packageId,
      package_cancelled: true,
    });
    expect(
      result.packages.find((p) => p.package_id === packageId)!.exclude_from_package_forecast,
    ).toBe(true);
    expect((await cpm()).version).toBe(3);
  });
  it("rejects nonexistent, other-job, stale-party and stale-package source identities", async () => {
    const missing = facts("BAD-MAP");
    missing.commitment_refs = [];
    missing.schedule_ref = { report_version: 1, activity_id: "ONLY-OTHER" };
    await expect(record(missing, 0, randomUUID())).rejects.toThrow(
      /Schedule activity\/version is unavailable/,
    );
    missing.schedule_ref = { report_version: 99, activity_id: "DELIVERY" };
    await expect(record(missing, 0, randomUUID())).rejects.toThrow(
      /Schedule activity\/version is unavailable/,
    );
    const staleParty = facts("STALE-PARTY");
    staleParty.commitment_refs = [];
    staleParty.candidates[0].party_version = 99;
    await expect(record(staleParty, 0, randomUUID())).rejects.toThrow(/Candidate party changed/);
    await expect(record(facts(), 0, packageId)).rejects.toThrow(/changed/);
    const ledger = await get();
    const snapshot: ScopedScheduleSnapshot = {
      company_id: ids.company,
      job_id: ids.job2,
      version: 1,
      data_date: null,
      data: (await cpm(1)).data,
    };
    expect(() =>
      reconcileBuyoutSchedules(ledger, {
        latest_version: 1,
        reports: [snapshot],
        coverage_complete: true,
        unavailable_versions: [],
        read_issue: null,
      }),
    ).toThrow(/another company or job/);
    const linked = await loadBuyoutScheduleLinks(sb(), ledger);
    expect(JSON.stringify(linked)).not.toContain("2040-01-01");
  });
  it("enforces assigned PM/read-only AP and preserves denial for limited/other-company actors", async () => {
    expect(
      (await loadBuyoutScheduleLinks(sb(ids.pm), await get(ids.pm))).latest_schedule_version,
    ).toBe(3);
    expect((await get(ids.ap)).can_record).toBe(false);
    for (const actor of [ids.super, ids.contracts, ids.other])
      await expect(get(actor)).rejects.toThrow();
    // A valid company seat is authorized even without personal Circle access.
    expect((await get(ids.locked)).job_id).toBe(ids.job);
    await db.query("DELETE FROM mcp_company_members WHERE user_id=$1", [ids.locked]);
    await expect(get(ids.locked)).rejects.toThrow();
    const before = await cpm();
    await expect(record(facts("AP-WRITE"), 0, randomUUID(), ids.ap)).rejects.toThrow(
      /Owner or project management/,
    );
    expect(await cpm()).toEqual(before);
    expect(
      (await db.query<{ n: number }>("SELECT count(*)::int n FROM mcp_ap_originals")).rows[0].n,
    ).toBe(0);
  });
});
