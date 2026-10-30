import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { makeBuyoutDb, ids } from "../../../tests/buyout/fixture";
import {
  buyoutProjection,
  readinessChecks,
  type BuyoutLedger,
  type PackageFacts,
  type ReadinessFacts,
} from "./buyout";

let db: PGlite;
async function q(user: string, sql: string, params: unknown[] = []) {
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
async function get(user = ids.owner, job: string | null = ids.job, company = ids.company) {
  return (await q(user, "SELECT mcp_buyout_get($1,$2) AS x", [company, job]))[0].x as BuyoutLedger;
}
function pkg(code: string = randomUUID()): PackageFacts {
  return {
    code,
    title: "Electrical scope",
    scope: "Division 26 equipment",
    budget_cents: 100000,
    currency: "USD",
    status: "draft",
    candidates: [
      {
        party_id: ids.party,
        party_version: 1,
        quote_cents: 0,
        scope: "Distribution",
        exclusions: null,
        source: "Quote Q1",
        quoted_on: "2026-10-30",
        expected_delivery_on: "2026-12-01",
      },
    ],
    selected_party_id: ids.party,
    commitment_refs: [],
    expected_award_on: null,
    needed_by: null,
    submittal_ids: [],
    schedule_ref: null,
    source: "Approved scope register",
  };
}
function readiness(): ReadinessFacts {
  return {
    party_id: ids.party,
    party_version: 1,
    source: "Supplied agreement Section 9",
    requirements: [
      {
        key: "insurance",
        label: "Insurance evidence",
        kind: "insurance",
        applicability: "required",
        source: "Supplied requirement §9",
        jurisdiction: null,
        due_on: null,
        document_id: ids.doc,
        document_sha256: "a".repeat(64),
        effective_on: "2026-01-01",
        expires_on: "2027-01-01",
        review: "pending",
        review_note: null,
        exception_expires_on: null,
        bill_id: null,
        bill_version: null,
      },
    ],
  };
}
type Pending = {
  company: string;
  job: string | null;
  id: string;
  kind: string;
  expected: number;
  facts: unknown;
  reason: string;
  request: string;
  review: string;
};
async function review(
  kind: string,
  facts: unknown,
  {
    user = ids.owner,
    job = ids.job as string | null,
    id = randomUUID() as string,
    expected = 0,
    company = ids.company,
  }: Partial<{
    user: string;
    job: string | null;
    id: string;
    expected: number;
    company: string;
  }> = {},
) {
  const p: Pending = {
    company,
    job,
    id,
    kind,
    expected,
    facts,
    reason: "Synthetic local review",
    request: randomUUID(),
    review: randomUUID(),
  };
  await q(user, "SELECT mcp_buyout_review($1,$2,$3,$4,$5,$6,$7,$8,$9)", Object.values(p));
  return p;
}
async function save(p: Pending, user: string = ids.owner, confirmed = true) {
  return (
    await q(user, "SELECT mcp_buyout_record($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS x", [
      ...Object.values(p),
      confirmed,
    ])
  )[0].x as { saved: boolean; version: number; already_applied?: boolean };
}
async function record(kind: string, facts: unknown, opts: Parameters<typeof review>[2] = {}) {
  const p = await review(kind, facts, opts);
  await save(p, opts.user ?? ids.owner);
  return p;
}
beforeAll(async () => {
  db = await makeBuyoutDb();
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("buyout guarded persistence and reconciliation", () => {
  it("records exact reviewed version, idempotently retries and appends history without posting costs", async () => {
    const p = await review("package", pkg());
    await expect(save(p, ids.owner, false)).rejects.toThrow("Review and confirm");
    expect((await save(p)).version).toBe(1);
    expect((await save(p)).already_applied).toBe(true);
    const f = { ...(p.facts as PackageFacts), title: "Revised scope" };
    await record("package", f, { id: p.id, expected: 1 });
    expect(
      (await get()).records.find((r) => r.id === p.id)?.versions.map((v) => v.version),
    ).toEqual([2, 1]);
    expect((await db.query("SELECT count(*)::int n FROM mcp_cost_submissions")).rows).toEqual([
      { n: 0 },
    ]);
  });
  it("rejects duplicate scope identity including case/space variants", async () => {
    await record("package", pkg("ELEC-DUP"));
    await expect(review("package", pkg(" elec-dup "))).rejects.toThrow("already exists");
  });
  it("binds facts, actor and request ID; stale record versions cannot overwrite", async () => {
    const p = await review("package", pkg());
    await expect(save({ ...p, reason: "changed" })).rejects.toThrow("Review unavailable");
    await expect(save(p, ids.pm)).rejects.toThrow("Review unavailable");
    await save(p);
    await expect(
      save({ ...p, facts: { ...(p.facts as PackageFacts), title: "tampered" } }),
    ).rejects.toThrow("different facts");
    await expect(review("package", p.facts, { id: p.id, expected: 0 })).rejects.toThrow("changed");
  });
  it("cancels reviews and rejects expired reviews", async () => {
    const p = await review("package", pkg());
    await q(ids.owner, "SELECT mcp_buyout_review_cancel($1,$2,$3)", [
      ids.company,
      ids.job,
      p.review,
    ]);
    await expect(save(p)).rejects.toThrow("cancelled or expired");
    const p2 = await review("package", pkg());
    await db.query(
      "UPDATE mcp_buyout_reviews SET expires_at=now()-interval '1 second' WHERE id=$1",
      [p2.review],
    );
    await expect(save(p2)).rejects.toThrow("cancelled or expired");
  });
  it("invalidates a pending review when another buyout source is saved", async () => {
    const p = await review("package", pkg());
    await record("package", pkg());
    await expect(save(p)).rejects.toThrow("Source records changed");
  });
  it("rejects unsupported fields, invalid calendar dates, fractional cents and missing versus zero", async () => {
    await expect(review("package", { ...pkg(), extra: true })).rejects.toThrow("unexpected");
    await expect(review("package", { ...pkg(), budget_cents: 0.5 })).rejects.toThrow("integer");
    await expect(review("package", { ...pkg(), needed_by: "2026-02-31" })).rejects.toThrow();
    const p = await record("package", { ...pkg(), budget_cents: 0 });
    expect(
      ((await get()).records.find((r) => r.id === p.id)?.facts as PackageFacts).budget_cents,
    ).toBe(0);
  });
  it("denies foreign company, unassigned job, super, contracts, inactive user and direct-table access", async () => {
    for (const u of [ids.other, ids.super, ids.contracts]) await expect(get(u)).rejects.toThrow();
    await db.query("DELETE FROM mcp_company_members WHERE user_id=$1", [ids.locked]);
    await expect(get(ids.locked)).rejects.toThrow();
    await expect(get(ids.pm, ids.job2)).rejects.toThrow("Full access");
    await expect(get(ids.owner, ids.job3)).rejects.toThrow("Full access");
    await expect(q(ids.owner, "SELECT * FROM mcp_buyout_versions")).rejects.toThrow(
      "permission denied",
    );
    await expect(q(ids.owner, "SELECT mcp_private.buyout_shape('{}','{}')")).rejects.toThrow(
      "permission denied",
    );
  });
  it("allows AP read but forbids AP buyout writes or directory read", async () => {
    expect((await get(ids.ap)).job_id).toBe(ids.job);
    await expect(review("package", pkg(), { user: ids.ap })).rejects.toThrow("management review");
    await expect(get(ids.ap, null)).rejects.toThrow("company owner");
  });
  it("reuses exact approved POs, computes partial exposure and rejects duplicate counting", async () => {
    const f = {
      ...pkg(),
      status: "selected" as const,
      commitment_refs: [{ po_id: ids.po, version: 1 }],
      submittal_ids: [ids.sub],
      schedule_ref: { report_version: 1, activity_id: "PROC-1" },
    };
    const p = await record("package", f);
    const projected = buyoutProjection(await get()).packages.find((x) => x.id === p.id)!;
    expect(projected.committed_cents).toBe(40000);
    expect(projected.uncommitted_exposure_cents).toBe(60000);
    await expect(review("package", { ...f, code: randomUUID() })).rejects.toThrow("counted twice");
    await expect(
      review("package", {
        ...pkg(),
        candidates: [{ ...pkg().candidates[0], party_id: ids.party2 }],
      }),
    ).rejects.toThrow("unavailable on this job");
  });
  it("rejects alternate UUID spellings before duplicate identities or commitments can be created", async () => {
    const f = pkg();
    f.candidates[0].party_id = `{${ids.party}}`;
    await expect(review("package", f)).rejects.toThrow("canonical UUID");
    const refs = { ...pkg(), commitment_refs: [{ po_id: `{${ids.po}}`, version: 1 }] };
    await expect(review("package", refs)).rejects.toThrow("canonical UUID");
  });
  it("validates exact submittal and CPM activity/version references", async () => {
    await expect(review("package", { ...pkg(), submittal_ids: [randomUUID()] })).rejects.toThrow(
      "Submittal",
    );
    await expect(
      review("package", { ...pkg(), schedule_ref: { report_version: 2, activity_id: "PROC-1" } }),
    ).rejects.toThrow("Schedule activity");
  });
  it("tracks originals and expiry, resets document replacement review, preserves prior originals", async () => {
    const p = await record("readiness", readiness());
    const f = readiness();
    f.requirements[0].review = "evidence_checked";
    f.requirements[0].review_note =
      "Compared supplied requirement and certificate; no adequacy conclusion";
    await record("readiness", f, { id: p.id, expected: 1 });
    expect(readinessChecks(f, "2027-01-02")[0].state).toBe("blocked");
    const missing = {
      ...f,
      requirements: [{ ...f.requirements[0], document_id: null, document_sha256: null }],
    };
    await expect(review("readiness", missing, { id: p.id, expected: 2 })).rejects.toThrow();
    const replacement = structuredClone(f);
    replacement.requirements[0].document_id = ids.doc2;
    replacement.requirements[0].review = "pending";
    await expect(review("readiness", replacement, { id: p.id, expected: 2 })).rejects.toThrow(
      "unavailable on this job",
    );
    expect((await get()).records.find((r) => r.id === p.id)?.versions).toHaveLength(2);
  });
  it("requires pending review for a replacement and retains both original hashes", async () => {
    const r = (await get()).records.find((r) => r.kind === "readiness")!;
    const f = structuredClone(r.facts) as ReadinessFacts;
    f.requirements[0].document_id = ids.doc3;
    f.requirements[0].document_sha256 = "b".repeat(64);
    f.requirements[0].review = "evidence_checked";
    f.requirements[0].review_note = "Replacement checked";
    await expect(review("readiness", f, { id: r.id, expected: r.version })).rejects.toThrow(
      "pending review",
    );
    f.requirements[0].review = "pending";
    await record("readiness", f, { id: r.id, expected: r.version });
    f.requirements[0].review = "evidence_checked";
    await record("readiness", f, { id: r.id, expected: r.version + 1 });
    const history = (await get()).records.find((x) => x.id === r.id)!.versions;
    expect((history[0].facts as ReadinessFacts).requirements[0].document_sha256).toBe(
      "b".repeat(64),
    );
    expect(
      history.some(
        (v) => (v.facts as ReadinessFacts).requirements[0].document_sha256 === "a".repeat(64),
      ),
    ).toBe(true);
  });
  it("reports a completed save accurately when cancellation follows an uncertain outcome", async () => {
    const p = await record("package", pkg());
    const result = (
      await q(ids.owner, "SELECT mcp_buyout_review_cancel($1,$2,$3) AS x", [
        ids.company,
        ids.job,
        p.review,
      ])
    )[0].x as { saved: boolean; cancelled: boolean };
    expect(result).toMatchObject({ saved: true, cancelled: false });
    expect((await save(p)).already_applied).toBe(true);
  });
  it("does not let a PM remove requirements, relabel insurance or silently waive applicability", async () => {
    const r = (await get()).records.find((r) => r.kind === "readiness")!;
    const f = structuredClone(r.facts) as ReadinessFacts;
    await expect(
      review(
        "readiness",
        { ...f, requirements: [] },
        { id: r.id, expected: r.version, user: ids.pm },
      ),
    ).rejects.toThrow("Retain requirement history");
    f.requirements[0].kind = "other";
    await expect(
      review("readiness", f, { id: r.id, expected: r.version, user: ids.pm }),
    ).rejects.toThrow("Retain the requirement kind");
    f.requirements[0].kind = "insurance";
    f.requirements[0].applicability = "not_applicable";
    f.requirements[0].review = "pending";
    await expect(
      review("readiness", f, { id: r.id, expected: r.version, user: ids.pm }),
    ).rejects.toThrow("Only an owner");
  });
  it("owner exceptions stay outstanding, are source/date bound and cannot be made by PM", async () => {
    const r = (await get()).records.find((r) => r.kind === "readiness")!;
    const f = structuredClone(r.facts) as ReadinessFacts;
    f.requirements[0].review = "exception";
    f.requirements[0].review_note = "Owner-directed temporary exception, not compliance";
    f.requirements[0].exception_expires_on = "2026-11-01";
    await expect(
      review("readiness", f, { id: r.id, expected: r.version, user: ids.pm }),
    ).rejects.toThrow("Only an owner");
    await record("readiness", f, { id: r.id, expected: r.version });
    expect(readinessChecks(f, "2026-10-30")[0].state).toBe("exception");
    expect(readinessChecks(f, "2026-11-02")[0].state).toBe("blocked");
  });
  it("owner directory identities are unique, job links preserve existing party identity", async () => {
    const f = {
      name: "Synthetic Company Identity",
      kind: "both",
      trade: "Electrical",
      contacts: [
        {
          name: "A Contact",
          email: "a@example.invalid",
          phone: null,
          role: "Vendor PM",
          authority: null,
          source: "Verified kickoff record",
          verified_on: "2026-10-30",
        },
      ],
      source: "Owner verified",
      verified_on: "2026-10-30",
      status: "active",
    };
    const d = await record("directory", f, { job: null });
    await expect(
      review("directory", { ...f, name: " synthetic company identity " }, { job: null }),
    ).rejects.toThrow("already exists");
    expect((await get(ids.pm)).records.some((r) => r.id === d.id)).toBe(false);
    const p = await record("party_link", {
      directory_id: d.id,
      directory_version: 1,
      party_id: ids.party,
      party_version: 1,
      source: "Same legal company verified",
    });
    expect((await get(ids.pm)).records.some((r) => r.id === d.id)).toBe(true);
    await expect(
      review(
        "party_link",
        {
          directory_id: d.id,
          directory_version: 1,
          party_id: ids.party2,
          party_version: 1,
          source: "Bad reassign",
        },
        { id: p.id, expected: 1 },
      ),
    ).rejects.toThrow("cannot be reassigned");
  });
  it("preserves cancelled package history and prohibits reopening", async () => {
    const p = await record("package", { ...pkg(), status: "cancelled" });
    await expect(
      review(
        "package",
        { ...(p.facts as PackageFacts), status: "draft" },
        { id: p.id, expected: 1 },
      ),
    ).rejects.toThrow("Cancelled");
    expect(buyoutProjection(await get()).packages.find((r) => r.id === p.id)?.cancelled).toBe(true);
  });
});
