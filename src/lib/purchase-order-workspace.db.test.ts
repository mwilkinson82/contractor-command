import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { makePurchaseOrderDb, poIds } from "../../tests/purchase-orders/fixture";
import {
  prepareRevision,
  revisionFields,
  reviewPoRevision,
  savePoRevision,
  orderVersions,
  type PurchaseOrderLedger,
  type PoRpc,
} from "./purchase-order-workspace";
let db: PGlite;
async function query(user: string, sql: string, params: unknown[] = []) {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, role: "authenticated", email: "synthetic@example.invalid" }),
    ]);
    await db.exec("SET LOCAL ROLE authenticated");
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
const rpc =
  (user: string): PoRpc =>
  async (name, args) => {
    const keys =
      name === "mcp_project_purchase_orders_review"
        ? ["_job", "_action", "_p", "_review"]
        : ["_job", "_action", "_p", "_review", "_confirmed"];
    try {
      const r = await query(
        user,
        `SELECT ${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) AS x`,
        keys.map((k) => args[k]),
      );
      return { data: r[0].x, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  };
async function read(user = poIds.owner, job = poIds.job) {
  return (await query(user, "SELECT mcp_project_purchase_orders_get($1) AS x", [job]))[0]
    .x as PurchaseOrderLedger;
}
beforeAll(async () => {
  db = await makePurchaseOrderDb();
}, 30000);
afterAll(async () => await db?.close());
describe("PO workspace uses unchanged guarded backend", () => {
  it("keeps owner/assigned PM/AP access while denying super/contracts/other company/inactive and unassigned PM job", async () => {
    for (const user of [poIds.owner, poIds.pm, poIds.ap])
      expect((await read(user)).orders).toHaveLength(2);
    for (const user of [poIds.super, poIds.contracts, poIds.outsider, poIds.inactive])
      await expect(read(user)).rejects.toThrow();
    await expect(read(poIds.pm, poIds.job2)).rejects.toThrow();
  });
  it("review creates no revision; exact confirmed saves append once and preserve all earlier versions", async () => {
    const l = await read(poIds.pm),
      o = l.orders.find((o) => o.id === poIds.po)!,
      party = l.parties.find((p) => p.id === o.party_id)!,
      terms = l.terms.find((t) => t.id === orderVersions(o)[0].terms_id)!;
    const f = revisionFields(orderVersions(o)[0]);
    f.reason = "Synthetic browser revision test";
    f.neededBy = "2026-11-05";
    const p = prepareRevision(o, party, terms, f, randomUUID()),
      review = randomUUID();
    await reviewPoRevision(rpc(poIds.pm), poIds.job, p, review);
    expect((await read()).orders.find((o) => o.id === poIds.po)!.versions).toHaveLength(2);
    const saved = await savePoRevision(rpc(poIds.pm), poIds.job, p, review);
    expect(saved.version).toBe(3);
    expect((await savePoRevision(rpc(poIds.pm), poIds.job, p, review)).already_applied).toBe(true);
    const versions = (await read()).orders.find((o) => o.id === poIds.po)!.versions;
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].status).toBe("draft");
    expect(versions[2].status).toBe("approved");
  });
  it("rejects altered facts, different actor, expired review and stale source versions", async () => {
    const l = await read(),
      o = l.orders.find((o) => o.id === poIds.po)!,
      f = revisionFields(orderVersions(o)[0]);
    f.reason = "Synthetic stale review";
    const p = prepareRevision(
        o,
        l.parties.find((p) => p.id === o.party_id)!,
        l.terms.find((t) => t.id === o.versions[0].terms_id)!,
        f,
        randomUUID(),
      ),
      review = randomUUID();
    await reviewPoRevision(rpc(poIds.owner), poIds.job, p, review);
    await expect(
      savePoRevision(rpc(poIds.owner), poIds.job, { ...p, reason: "Changed facts" }, review),
    ).rejects.toThrow("Review");
    await expect(savePoRevision(rpc(poIds.pm), poIds.job, p, review)).rejects.toThrow("Review");
    await db.query("UPDATE mcp_po_reviews SET expires_at=now()-interval '1 second' WHERE id=$1", [
      review,
    ]);
    await expect(savePoRevision(rpc(poIds.owner), poIds.job, p, review)).rejects.toThrow("Review");
    const stale = { ...p, request_id: randomUUID(), expected_version: 2 },
      r2 = randomUUID();
    await reviewPoRevision(rpc(poIds.owner), poIds.job, stale, r2);
    await expect(savePoRevision(rpc(poIds.owner), poIds.job, stale, r2)).rejects.toThrow(
      "version changed",
    );
  });
  it("cannot turn a PM draft operation into approval or cross-job access", async () => {
    const l = await read(poIds.pm),
      o = l.orders.find((o) => o.id === poIds.po)!,
      f = revisionFields(orderVersions(o)[0]);
    f.reason = "Synthetic boundaries";
    const p = prepareRevision(
        o,
        l.parties.find((p) => p.id === o.party_id)!,
        l.terms.find((t) => t.id === o.versions[0].terms_id)!,
        f,
        randomUUID(),
      ),
      review = randomUUID();
    const altered = { ...p, status: "approved" };
    await rpc(poIds.pm)("mcp_project_purchase_orders_review", {
      _job: poIds.job,
      _action: "order",
      _p: altered,
      _review: review,
    });
    const r = await rpc(poIds.pm)("mcp_project_purchase_orders_record", {
      _job: poIds.job,
      _action: "order",
      _p: altered,
      _review: review,
      _confirmed: true,
    });
    expect(r.error?.message).toContain("Only the owner");
    await expect(reviewPoRevision(rpc(poIds.pm), poIds.job2, p, randomUUID())).rejects.toThrow();
  });
});
