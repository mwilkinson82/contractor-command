import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ids,
  installEstimatingFixture,
  rpc,
  readAuthorizationFingerprints,
  seedReadyEstimate,
  liveSnapshot,
  type FixtureDb,
} from "../../../tests/native/estimating-fixture";
import { calculateSavedBidSnapshot } from "./tools/estimate-bid-tools";
import { randomUUID } from "node:crypto";
import { prepareHandoffDraft } from "./estimating-handoff-draft";
import { bidComponents } from "./estimating-handoff-preview";
import { mapEstimateDestination } from "./estimating-destination-mapping";
import { destinationSnapshot } from "./estimating-facts-handoff.server";

let db: FixtureDb;
beforeAll(async () => {
  db = await installEstimatingFixture();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("portable estimating native fixture, PGlite smoke only", () => {
  it("keeps exact current authorization bodies and removes base active-member stand-ins", async () => {
    const rows = await readAuthorizationFingerprints(db);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.signature === "public.mcp_gate()")?.body).toContain(
      "circle_sync_user",
    );
    expect(
      (await db.query("SELECT to_regclass('public.test_active_members') AS old")).rows[0].old,
    ).toBeNull();
  });
  it("creates a ready $1,815 frozen source through actual membership and estimating SQL", async () => {
    const source = await seedReadyEstimate(db);
    const calculated = calculateSavedBidSnapshot(source.snapshot);
    expect(calculated.view.ready, JSON.stringify(calculated.state.blockers)).toBe(true);
    expect(calculated.view.total).toBe(1815);
    expect(source.current).toBe(true);
    expect((await liveSnapshot(db)).version).toBe(source.source_version);
  });
  it("keeps contract-only read scope and denies its financial destination, super and foreign access", async () => {
    expect(
      await rpc(db, "mcp_estimate_coverage_snapshot", { _job: ids.job }, ids.contracts),
    ).toHaveProperty("version");
    await expect(
      rpc(db, "mcp_estimate_destination_snapshot", { _job: ids.job }, ids.contracts),
    ).rejects.toThrow();
    await expect(
      rpc(db, "mcp_estimate_coverage_snapshot", { _job: ids.job }, ids.super),
    ).rejects.toThrow();
    await expect(
      rpc(db, "mcp_estimate_destination_snapshot", { _job: ids.job }, ids.other),
    ).rejects.toThrow();
    await expect(
      rpc(db, "mcp_estimate_coverage_snapshot", { _job: ids.job }, ids.owner, "anon"),
    ).rejects.toThrow();
  });
  it("limits export SQL policies to full or contract scope, preserving assigned-super denial", async () => {
    const path = `${ids.company}/${ids.job}/synthetic/Bid.pdf`;
    const asActor = (actor: string, sql: string) =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: actor, role: "authenticated" }),
        ]);
        return tx.query(sql, [path]);
      });
    await asActor(
      ids.contracts,
      "INSERT INTO storage.objects(bucket_id,name) VALUES('athena-estimate-exports',$1)",
    );
    expect(
      (await asActor(ids.contracts, "SELECT name FROM storage.objects WHERE name=$1")).rows,
    ).toHaveLength(1);
    expect(
      (await asActor(ids.super, "SELECT name FROM storage.objects WHERE name=$1")).rows,
    ).toHaveLength(0);
    expect(
      (await asActor(ids.other, "SELECT name FROM storage.objects WHERE name=$1")).rows,
    ).toHaveLength(0);
  });
  it("accepts a trusted budget and populated existing-package mapping through actual authorization", async () => {
    const saved = (
      await db.query<{ id: string }>(
        "SELECT id FROM mcp_private.estimate_source_snapshot WHERE job_id=$1 ORDER BY created_at LIMIT 1",
        [ids.job],
      )
    ).rows[0];
    const frozen = await rpc(db, "mcp_estimate_snapshot_read", {
      _job: ids.job,
      _snapshot: saved.id,
    });
    const source = calculateSavedBidSnapshot(frozen.snapshot);
    expect(source.view.ready).toBe(true);
    const receipt = await prepareHandoffDraft({
      companyId: ids.company,
      jobId: ids.job,
      snapshot: source.snapshot,
      ready: source.view.ready,
      breakdown: source.view.breakdown,
    });
    const current = await rpc(db, "mcp_estimate_destination_snapshot", { _job: ids.job });
    const components = bidComponents(source.view.breakdown!);
    const mapping = mapEstimateDestination({
      breakdown: source.view.breakdown!,
      destination: destinationSnapshot(current),
      plan: {
        kind: "budget",
        lines: [{ cost_code: "NATIVE", description: "Synthetic execution cost" }],
        allocations: components.map((c) => ({
          component_id: c.id,
          splits:
            c.id === "direct:T-1" ? [{ target_key: "NATIVE", amount_cents: c.amountCents }] : [],
          excluded_cents: c.id === "direct:T-1" ? 0 : c.amountCents,
          exclusion_reason: c.id === "direct:T-1" ? null : "Explicit cost-budget exclusion",
        })),
      },
    });
    const request = randomUUID();
    const service = (name: string, step: string, id: string, payload: Record<string, unknown>) =>
      rpc(
        db,
        name,
        { _job: ids.job, _actor: ids.owner, _step: step, _request: id, _p: payload },
        ids.owner,
        "service_role",
      );
    await service("mcp_estimate_facts_handoff", "review", request, {
      kind: "budget",
      snapshot_id: saved.id,
      expected_version: current.version,
      allow_historical: false,
      correction_of: null,
      reason: "Synthetic reviewed cost budget",
      canonical_json: JSON.stringify(receipt.payload),
      canonical_sha256: receipt.sha256,
      mapping_json: JSON.stringify(mapping),
    });
    expect(
      await service("mcp_estimate_facts_handoff", "save", request, {
        kind: "budget",
        confirmed: true,
      }),
    ).toMatchObject({ accepted: true });
    expect((await rpc(db, "mcp_estimate_destination_snapshot", { _job: ids.job })).budget).toEqual({
      NATIVE: { description: "Synthetic execution cost", amount: 1500 },
    });
    const packageId = randomUUID();
    const facts = {
      code: "NATIVE-PAINT",
      title: "Synthetic package",
      scope: "Finishes",
      budget_cents: 100000,
      currency: "USD",
      status: "selected",
      candidates: [
        {
          party_id: ids.party,
          party_version: 1,
          quote_cents: 40000,
          scope: "Existing supplier scope",
          exclusions: null,
          source: "Existing written quote",
          quoted_on: null,
          expected_delivery_on: null,
        },
      ],
      selected_party_id: ids.party,
      commitment_refs: [{ po_id: ids.po, version: 1 }],
      expected_award_on: null,
      needed_by: null,
      submittal_ids: [],
      schedule_ref: null,
      source: "Existing synthetic package",
    };
    const args = {
      _company: ids.company,
      _job: ids.job,
      _id: packageId,
      _kind: "package",
      _expected: 0,
      _facts: facts,
      _reason: "Existing package",
      _request: randomUUID(),
      _review: randomUUID(),
    };
    await rpc(db, "mcp_buyout_review", args);
    await rpc(db, "mcp_buyout_record", { ...args, _confirmed: true });
    const before = (
      await db.query(
        "SELECT to_jsonb(v) AS data FROM mcp_purchase_order_versions v ORDER BY po_id,version",
      )
    ).rows;
    const handoff = randomUUID();
    await service("mcp_estimate_buyout_handoff", "review", handoff, {
      snapshot_id: saved.id,
      package_id: packageId,
      expected_version: 1,
      allow_historical: false,
      correction_of: null,
      reason: "Reviewed existing supplier package cost",
      canonical_json: JSON.stringify(receipt.payload),
      canonical_sha256: receipt.sha256,
      allocations: components.map((c) => ({
        component_id: c.id,
        include: c.id === "direct:T-1",
        exclusion_reason: c.id === "direct:T-1" ? null : "Explicit package exclusion",
      })),
    });
    expect(
      await service("mcp_estimate_buyout_handoff", "save", handoff, { confirmed: true }),
    ).toMatchObject({ accepted: true });
    const ledger = await rpc<{
      records: Array<{ id: string; facts: typeof facts; version: number }>;
    }>(db, "mcp_buyout_get", { _company: ids.company, _job: ids.job });
    const actual = ledger.records.find((r) => r.id === packageId)!;
    expect(actual.version).toBe(2);
    expect(actual.facts).toMatchObject({
      budget_cents: 150000,
      candidates: facts.candidates,
      selected_party_id: facts.selected_party_id,
      commitment_refs: facts.commitment_refs,
    });
    expect(
      (
        await db.query(
          "SELECT to_jsonb(v) AS data FROM mcp_purchase_order_versions v ORDER BY po_id,version",
        )
      ).rows,
    ).toEqual(before);
  });
  it("uses canonical inactive membership after grant revocation and cache invalidation", async () => {
    await db.query(
      "UPDATE public.circle_owner_grants SET revoked_at=now(),revoked_by=$1 WHERE user_id=$1",
      [ids.owner],
    );
    await db.exec("DELETE FROM public.mcp_gate_cache");
    await expect(rpc(db, "mcp_estimate_coverage_snapshot", { _job: ids.job })).rejects.toThrow();
    // This is sequential local evidence. Native lock interleavings remain unrun.
  });
});
