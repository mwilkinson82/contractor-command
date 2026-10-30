import { describe, expect, it } from "vitest";
import {
  loadBuyoutScheduleLinks,
  reconcileBuyoutSchedules,
  type ScheduleLinkEvidence,
  type ScopedScheduleSnapshot,
} from "./scheduling-buyout";
import type { BuyoutLedger, PackageFacts } from "./buyout";
import type { Activity } from "./living";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const facts = (version = 1, activityId = "DELIVERY"): PackageFacts => ({
  code: `PKG-${version}`,
  title: "Switchgear",
  scope: "Electrical",
  budget_cents: null,
  currency: "USD",
  status: "selected",
  candidates: [
    {
      party_id: id(3),
      party_version: 1,
      quote_cents: null,
      scope: "Gear",
      exclusions: null,
      source: "Synthetic quote",
      quoted_on: null,
      expected_delivery_on: "2026-11-05",
    },
  ],
  selected_party_id: id(3),
  commitment_refs: [],
  expected_award_on: null,
  needed_by: "2026-11-04",
  submittal_ids: [],
  schedule_ref: { report_version: version, activity_id: activityId },
  source: "Synthetic scope",
});
const ledger = (): BuyoutLedger => ({
  company_id: id(1),
  job_id: id(2),
  today: "2026-10-30",
  records: [{ id: id(4), kind: "package", version: 1, facts: facts(), versions: [] }],
  parties: [{ id: id(3), version: 1, name: "Supplier" }],
  orders: [],
  documents: [],
  submittals: [],
  bills: [],
  schedule_activities: [],
  can_manage_directory: true,
  can_record: true,
});
const activity = (extra: Partial<Activity> = {}): Activity => ({
  id: "DELIVERY",
  name: "Delivery",
  duration: 0,
  start: "2026-11-04",
  finish: "2026-11-04",
  predecessors: [],
  total_float: 0,
  critical: true,
  pct_complete: 0,
  value: 0,
  sov_line: null,
  cost_code: null,
  ...extra,
});
const snapshot = (
  version = 1,
  extra: Partial<ScopedScheduleSnapshot> = {},
): ScopedScheduleSnapshot => ({
  company_id: id(1),
  job_id: id(2),
  version,
  data_date: "2026-10-30",
  data: { activities: [activity()] },
  ...extra,
});
const evidence = (reports = [snapshot()]): ScheduleLinkEvidence => ({
  latest_version: 1,
  reports,
  unavailable_versions: [],
  coverage_complete: true,
  read_issue: null,
});

describe("scoped scheduling/buyout read contract", () => {
  it("preserves supplied unknowns and does not mutate inputs or invent delay impact", () => {
    const l = ledger();
    const f = l.records[0].facts as PackageFacts;
    f.candidates[0].expected_delivery_on = null;
    f.needed_by = null;
    const before = structuredClone(l),
      result = reconcileBuyoutSchedules(l, evidence());
    expect(l).toEqual(before);
    expect(result.packages[0]).toMatchObject({
      package_version: 1,
      reference_state: "current",
      calculation_basis: "reported",
      reported_expected_delivery_on: null,
      reported_delivery_vs_needed_by_calendar_days: null,
      reported_delivery_vs_linked_milestone_calendar_days: null,
      quantified_schedule_impact: null,
    });
    expect(result.packages[0].missing).toContain(
      "Selected party's expected delivery date is unknown",
    );
    expect(result.canonical_committed_cents).toBeNull();
  });
  it("marks unmapped and unavailable pins without selecting a similar activity name", () => {
    const l = ledger();
    (l.records[0].facts as PackageFacts).schedule_ref = null;
    expect(reconcileBuyoutSchedules(l, evidence()).packages[0].reference_state).toBe("unmapped");
    (l.records[0].facts as PackageFacts).schedule_ref = { report_version: 1, activity_id: "OTHER" };
    const r = reconcileBuyoutSchedules(l, evidence());
    expect(r.packages[0].reference_state).toBe("activity_unavailable");
    expect(r.packages[0].pinned_activity).toBeNull();
    expect(reconcileBuyoutSchedules(l, evidence([])).packages[0].reference_state).toBe(
      "version_unavailable",
    );
  });
  it("rejects mixed company/job evidence and duplicate report versions", () => {
    for (const extra of [{ company_id: id(9) }, { job_id: id(9) }])
      expect(() => reconcileBuyoutSchedules(ledger(), evidence([snapshot(1, extra)]))).toThrow(
        /another company or job/,
      );
    expect(() => reconcileBuyoutSchedules(ledger(), evidence([snapshot(), snapshot()]))).toThrow(
      /repeats a report version/,
    );
  });
  it("does not choose an ambiguous activity or pretend a future source is current", () => {
    const ambiguous = snapshot();
    ambiguous.data.activities = [activity(), activity({ name: "Duplicate ID" })];
    const r = reconcileBuyoutSchedules(ledger(), evidence([ambiguous]));
    expect(r.packages[0].reference_state).toBe("activity_ambiguous");
    expect(r.packages[0].pinned_activity).toBeNull();
    const l = ledger();
    (l.records[0].facts as PackageFacts).schedule_ref!.report_version = 2;
    expect(
      reconcileBuyoutSchedules(l, evidence([snapshot(1), snapshot(2)])).packages[0].reference_state,
    ).toBe("source_version_conflict");
  });
  it("leaves historic party pins intact when current directory/job-party data changes", () => {
    const l = ledger();
    l.parties[0].version = 2;
    const r = reconcileBuyoutSchedules(l, evidence());
    expect(r.packages[0]).toMatchObject({
      selected_party_id: id(3),
      selected_party_version: 1,
      current_party_version: 2,
      party_reference_state: "historical",
    });
  });
  it("does not equate a work activity start/finish with an encoded delivery gate", () => {
    const s = snapshot();
    s.data.activities = [activity({ duration: 5, start: "2026-11-02", finish: "2026-11-06" })];
    const r = reconcileBuyoutSchedules(ledger(), evidence([s]));
    expect(r.packages[0].reported_delivery_vs_linked_milestone_calendar_days).toBeNull();
    expect(r.packages[0].comparison_basis).toContain("does not encode");
  });
  it("keeps date arithmetic unknown for invalid legacy dates", () => {
    const s = snapshot();
    s.data.activities = [activity({ finish: "2026-02-30" })];
    const r = reconcileBuyoutSchedules(ledger(), evidence([s]));
    expect(r.packages[0].reported_delivery_vs_linked_milestone_calendar_days).toBeNull();
    expect(JSON.stringify(r)).not.toContain("NaN");
  });
  it("uses only exact existing scoped CPM reads and deduplicates repeated version pins", async () => {
    const l = ledger();
    l.records.push({ ...l.records[0], id: id(5), facts: { ...facts(), code: "PKG-OTHER" } });
    const calls: unknown[] = [];
    const r = await loadBuyoutScheduleLinks(
      {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            data: { found: true, version: 1, data_date: "2026-10-30", data: snapshot().data },
            error: null,
          };
        },
      },
      l,
    );
    expect(calls).toEqual([
      { name: "mcp_living_report_get", args: { _job: id(2), _type: "cpm", _version: null } },
    ]);
    expect(r.coverage_complete).toBe(true);
    expect(r.packages).toHaveLength(2);
  });
  it("reports read failures explicitly without asserting no schedule", async () => {
    const r = await loadBuyoutScheduleLinks(
      { rpc: async () => ({ data: null, error: { message: "denied" } }) },
      ledger(),
    );
    expect(r.coverage_complete).toBe(false);
    expect(r.read_issue).toContain("no absence");
    expect(r.packages[0].reference_state).toBe("version_unavailable");
  });
  it("rejects a mismatched version returned by a source reader", async () => {
    const r = await loadBuyoutScheduleLinks(
      {
        rpc: async () => ({
          data: { found: true, version: 2, data: snapshot(2).data },
          error: null,
        }),
      },
      ledger(),
    );
    expect(r.coverage_complete).toBe(false);
    expect(r.read_issue).toContain("version changed unexpectedly");
    expect(r.packages[0].pinned_activity).toBeNull();
  });
  it("discloses bounded history coverage without treating skipped old versions as empty", async () => {
    const l = ledger();
    l.records = Array.from({ length: 52 }, (_, i) => ({
      id: id(100 + i),
      kind: "package",
      version: 1,
      facts: facts(i + 1),
      versions: [],
    }));
    let calls = 0;
    const r = await loadBuyoutScheduleLinks(
      {
        rpc: async (_name, args) => {
          calls++;
          const v = args?._version as number | null;
          return { data: { found: true, version: v ?? 53, data: snapshot().data }, error: null };
        },
      },
      l,
    );
    expect(calls).toBe(51);
    expect(r.coverage_complete).toBe(false);
    expect(r.unavailable_versions).toEqual([2, 1]);
    expect(r.packages).toHaveLength(52);
  });
});
