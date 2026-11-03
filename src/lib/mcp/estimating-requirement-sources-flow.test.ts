/* Synthetic actual-handler/PGlite source consistency, not native PostgreSQL
 * concurrency certification or verification of physical Storage bytes. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  client: null as unknown,
  readError: false,
  reads: 0,
  writes: 0,
  beforeRead: null as null | (() => Promise<void>),
  afterRead: null as null | (() => Promise<void>),
  beforeSave: null as null | (() => Promise<void>),
  loseSaveResponse: false,
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => {
    const client = state.client as ReturnType<typeof fakeClient>;
    return fn({
      ...client,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "mcp_estimate_requirements_save") {
          state.writes++;
          if (state.beforeSave) {
            const f = state.beforeSave;
            state.beforeSave = null;
            await f();
          }
        }
        const result = await client.rpc(name, args);
        if (name === "mcp_estimate_requirements_save" && state.loseSaveResponse) {
          state.loseSaveResponse = false;
          return { data: null, error: { message: "Interrupted after scan commit" } };
        }
        return result;
      },
      from: (table: string) => {
        if (table !== "mcp_contract_clauses") return client.from(table);
        return {
          select: (columns: string) => {
            if (columns !== "id, section, source, verbatim_text")
              return client.from(table).select(columns);
            return {
              eq: async (column: string, value: unknown) => {
                state.reads++;
                if (state.beforeRead) {
                  const f = state.beforeRead;
                  state.beforeRead = null;
                  await f();
                }
                if (state.readError)
                  return { data: null, error: { message: "Fixture clause read denied" } };
                const result = await client.from(table).select(columns).eq(column, value);
                if (state.afterRead) {
                  const f = state.afterRead;
                  state.afterRead = null;
                  await f();
                }
                return result;
              },
            };
          },
        };
      },
    });
  },
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({
    job_id: job,
    company_id: company,
    job_number: "SOURCE",
    name: "Source review",
  }),
  named: () => "SOURCE",
  audit: async () => {},
}));
import { estimateRequirements, estimateBidSummary } from "./tools/estimate-bid-tools";
import { estimateSourceSnapshot } from "./tools/estimate-coverage-tools";
import { GC_ITEMS } from "./estimating-bid";
import { calculateSavedBidSnapshot } from "./tools/estimate-bid-tools";

const owner = randomUUID(),
  estimator = randomUUID(),
  superId = randomUUID(),
  outsider = randomUUID(),
  inactive = randomUUID();
const company = randomUUID(),
  job = randomUUID(),
  other = randomUUID();
let db: PGlite;
const legacyPendingRequest = randomUUID(),
  legacySavedRequest = randomUUID();
let legacySnapshotId: unknown;
const client = (actor: string = owner) =>
  fakeClient(db, { sub: actor, role: "authenticated", email: "fixture@example.invalid" });
function selectActor(actor: string = owner) {
  state.client = client(actor);
}
const rpc = async (name: string, args: Record<string, unknown>, actor: string = owner) => {
  const r = await client(actor).rpc(name, args);
  if (r.error) throw new Error(r.error.message);
  return r.data as Record<string, unknown>;
};
const snap = () => rpc("mcp_estimate_coverage_snapshot", { _job: job });
type Response = { structuredContent: Record<string, unknown>; content: { text?: string }[] };
const call = async (tool: unknown, args: Record<string, unknown> = {}) => {
  const r = await (tool as { handler: (a: unknown, c: unknown) => Promise<Response> }).handler(
    { job_number: "SOURCE", ...args },
    {},
  );
  return r.structuredContent.bid_summary
    ? { ...r, structuredContent: r.structuredContent.bid_summary as Record<string, unknown> }
    : r;
};
const reqs = (s: Record<string, unknown>) =>
  (
    s.bid as {
      requirements: {
        ref: string;
        kind: string;
        amount: unknown;
        confirmed: boolean;
        excluded: boolean;
        citation: string;
      }[];
    }
  ).requirements;
const permit = "The contractor shall obtain all required building permits.";
const clauses = (text = permit, body = text, target: string = job) =>
  rpc("mcp_clauses_save", {
    _job: target,
    _doc: { name: "Agreement", body },
    _clauses: [{ section: "1.1", text }],
  });
const attrs = () =>
  db.query(
    "SELECT oid,proowner,proacl,prosecdef,provolatile,proconfig FROM pg_proc WHERE oid IN ('public.mcp_estimate_coverage_snapshot(uuid)'::regprocedure,'public.mcp_estimate_requirements_save(uuid,jsonb)'::regprocedure,'public.mcp_estimate_snapshot_review(uuid,uuid,bigint)'::regprocedure,'public.mcp_estimate_snapshot_save(uuid,uuid,boolean)'::regprocedure) ORDER BY oid",
  );
const sourceManifest = (s: Record<string, unknown>) =>
  s.requirement_sources as {
    sha256: string;
    setup_input_sha256: string;
    clauses: Record<string, unknown>[];
    documents: Record<string, unknown>[];
  };
async function scan(prices: Record<string, unknown>[] = []) {
  return call(estimateRequirements, { prices });
}
async function saveSpec(body: string, upload = randomUUID()) {
  const path = `${company}/${job}/${upload}/Spec.txt`;
  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('athena-documents',$1)", [
    path,
  ]);
  return rpc("mcp_contract_document_save", {
    _job: job,
    _p: {
      kind: "spec",
      name: "Spec",
      bucket: "athena-documents",
      path,
      body,
      mime_type: "text/plain",
      size_bytes: 100,
      file_sha256: "a".repeat(64),
      upload_id: upload,
    },
  });
}

beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
  );
  for (const path of [
    "supabase/migrations/20261031120000_athena_file_upload.sql",
    "supabase/migrations/20261022200000_athena_estimating.sql",
    "supabase/migrations/20261022230000_athena_estimating_bid.sql",
    "supabase/migrations/20261023010000_athena_estimating_conventions.sql",
    "supabase/migrations/20261027130000_athena_drawing_versions.sql",
    "supabase/migrations/20261024005713_athena_takeoff_engine.sql",
    "supabase/migrations/20261024160000_athena_takeoff_carry_by_identity.sql",
    "release-proposals/estimating-member-read-transactions.sql",
    "release-proposals/estimating-quote-coverage.sql",
    "release-proposals/estimating-gc-requirements-cas.sql",
    "release-proposals/estimating-frozen-source-snapshot.sql",
  ])
    await db.exec(readFileSync(path, "utf8"));
  for (const actor of [owner, estimator, superId, outsider, inactive]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.invalid')", [
      actor,
    ]);
    if (actor !== inactive) await db.query("INSERT INTO test_active_members VALUES($1)", [actor]);
  }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  for (const [actor, role] of [
    [owner, "owner"],
    [estimator, "estimating"],
    [superId, "super"],
    [inactive, "estimating"],
  ])
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'Fixture')",
      [company, actor, role],
    );
  for (const id of [job, other])
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,user_id,job_number,name) VALUES($1,$2,$3,($1::uuid)::text,'Job')",
      [id, company, owner],
    );
  await db.query("INSERT INTO mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superId,
    owner,
  ]);
  selectActor();
  await rpc("mcp_estimate_setup_save", {
    _job: job,
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint"],
      out_scope: ["Foundation work"],
    },
  });
  await rpc("mcp_estimate_takeoff_save", {
    _job: job,
    _revision: "A",
    _scales: [],
    _lines: [
      {
        line_no: 1,
        item: "Paint",
        qty: 100,
        unit: "SF",
        sheet: "A1",
        basis: "measured",
        math: "100 SF",
      },
    ],
  });
  await rpc("mcp_takeoff_geometry_save", {
    _job: job,
    _operation: "not_drawable",
    _expected: 0,
    _record: {
      line_no: 1,
      takeoff_version: 1,
      exception_kind: "schedule_quantity",
      quantity: 100,
      reason: "Quantity explicitly confirmed",
    },
  });
  await rpc("mcp_estimate_gc_save", {
    _job: job,
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await rpc("mcp_estimate_bid_save", { _job: job, _overhead: 10, _profit: 10 });
  await rpc("mcp_estimate_pricing_save_versioned", {
    _job: job,
    _expected_version: (await snap()).version,
    _labor: [{ ref: "T-1", production_per_man_hour: 10, hourly_rate: 100, confirmed: true }],
    _material: [{ ref: "T-1", unit_price: 5, confirmed: true }],
    _quotes: null,
    _sources: null,
  });
});
afterAll(() => db.close());

describe.sequential("version-bound requirement source scan and final readiness", () => {
  it("keeps legacy records readable but blocks scans, final outputs and new freeze without protocol", async () => {
    const before = await snap(),
      writes = state.writes;
    expect(before.capabilities).toEqual({ gc_requirements_cas: true });
    await expect(scan()).rejects.toThrow(/source storage is unavailable/i);
    const read = await call(estimateBidSummary);
    expect(read.structuredContent).toMatchObject({ ready: false, total: null, bid_csv: null });
    await expect(call(estimateBidSummary, { export_format: "pdf" })).rejects.toThrow(
      /reconciled bid/i,
    );
    await expect(
      call(estimateSourceSnapshot, { step: "review", expected_version: before.version }),
    ).rejects.toThrow(/source storage is unavailable/i);
    expect(state.writes).toBe(writes);
    expect((await snap()).bid).toEqual(before.bid);
    await rpc("mcp_estimate_snapshot_review", {
      _job: job,
      _request: legacyPendingRequest,
      _expected_version: before.version,
    });
    await rpc("mcp_estimate_snapshot_review", {
      _job: job,
      _request: legacySavedRequest,
      _expected_version: before.version,
    });
    const saved = await rpc("mcp_estimate_snapshot_save", {
      _job: job,
      _request: legacySavedRequest,
      _confirmed: true,
    });
    legacySnapshotId = saved.snapshot_id;
  });
  it("installs minimal fingerprints while preserving public OIDs/ACLs and empty-set review", async () => {
    const before = (await attrs()).rows;
    const publicBefore = (
      await db.query(
        "SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'mcp_%' ORDER BY oid",
      )
    ).rows;
    await db.exec(readFileSync("release-proposals/estimating-requirement-sources.sql", "utf8"));
    expect((await attrs()).rows).toEqual(before);
    expect(
      (
        await db.query(
          "SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'mcp_%' ORDER BY oid",
        )
      ).rows,
    ).toEqual(publicBefore);
    const snapshot = await snap();
    expect(snapshot.capabilities).toMatchObject({ requirement_sources: true });
    expect(snapshot.requirement_scan).toMatchObject({ current: false });
    await expect(
      rpc("mcp_estimate_snapshot_save", {
        _job: job,
        _request: legacyPendingRequest,
        _confirmed: true,
      }),
    ).rejects.toThrow(/scan and review current/i);
    const legacy = await call(estimateSourceSnapshot, {
      step: "read",
      snapshot_id: legacySnapshotId,
    });
    expect(legacy.structuredContent.calculated_bid).toMatchObject({ ready: false, total: null });
    expect(legacy.structuredContent.snapshot_id).toBe(legacySnapshotId);
    const result = await scan();
    expect(result.structuredContent.requirements).toEqual([]);
    expect((await snap()).requirement_scan).toMatchObject({
      current: true,
      source_sha256: sourceManifest(snapshot).sha256,
    });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      total: 1815,
    });
    expect(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated','mcp_private.estimate_requirement_sources(uuid)','EXECUTE') AS allowed",
        )
      ).rows[0],
    ).toEqual({ allowed: false });
  });
  it("binds exact clause text without exposing extra raw bodies or paths", async () => {
    await clauses();
    const current = await snap(),
      m = sourceManifest(current);
    expect((current.requirement_scan as { current: boolean }).current).toBe(false);
    expect(m.clauses).toMatchObject([
      { section: "1.1", source: "document", matches_current_document: true },
    ]);
    expect(m.documents).toHaveLength(1);
    const encoded = JSON.stringify(m);
    expect(encoded).not.toContain(permit);
    expect(encoded).not.toContain("verbatim_text");
    expect(encoded).not.toContain("storage_path");
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(false);
    await expect(
      rpc("mcp_estimate_snapshot_review", {
        _job: job,
        _request: randomUUID(),
        _expected_version: current.version,
      }),
    ).rejects.toThrow(/scan and review current/i);
    const result = await scan([
      { kind: "permits", source_ref: "1.1", amount: 100, confirmed: true },
    ]);
    expect(result.structuredContent).toMatchObject({
      requirement_source_sha256: m.sha256,
      requirements: [{ sourceRef: "1.1", amount: 100, confirmed: true, citation: permit }],
    });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      total: 1936,
    });
  });
  it("holds an explicitly cleared price while preserving omitted prices and genuine zero", async () => {
    await scan();
    expect(reqs(await snap())[0]).toMatchObject({ amount: 100, confirmed: true });
    await scan([{ ref: "R-1", amount: null }]);
    expect(reqs(await snap())[0]).toMatchObject({ amount: null, confirmed: false });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      bid_csv: null,
    });
    await expect(call(estimateBidSummary, { export_format: "pdf" })).rejects.toThrow(
      /reconciled bid/i,
    );
    await scan([{ ref: "R-1", amount: 0, confirmed: true }]);
    expect(reqs(await snap())[0]).toMatchObject({ amount: 0, confirmed: true });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      total: 1815,
    });
    await scan([{ ref: "R-1", amount: 100, confirmed: true }]);
  });
  it("holds after-source edits, retains price for review and requires explicit reconfirmation", async () => {
    await clauses("The contractor shall obtain revised building permits.");
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      total: null,
      bid_csv: null,
    });
    await expect(call(estimateBidSummary, { handoff_draft: true })).rejects.toThrow(
      /current, reconciled/i,
    );
    await scan();
    expect(reqs(await snap())[0]).toMatchObject({ amount: 100, confirmed: false, excluded: false });
    expect((await snap()).requirement_scan).toMatchObject({ current: true });
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(false);
    await scan([{ ref: "R-1", confirmed: true }]);
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: true,
      total: 1936,
    });
  });
  it("does not carry a prior exclusion into changed sources without review", async () => {
    await scan([{ ref: "R-1", excluded: true }]);
    expect((await call(estimateBidSummary)).structuredContent.total).toBe(1815);
    await clauses("The contractor shall obtain updated building permits.");
    await scan();
    expect(reqs(await snap())[0]).toMatchObject({ amount: 100, confirmed: false, excluded: false });
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(false);
    await scan([{ ref: "R-1", excluded: true }]);
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(true);
  });
  it("does not certify omitted saved confirmations through a direct empty scan", async () => {
    await clauses("The contractor shall obtain current building permits.");
    const before = await snap();
    await expect(
      rpc("mcp_estimate_requirements_save", {
        _job: job,
        _items: {
          expected_version: before.version,
          source_sha256: sourceManifest(before).sha256,
          reviewed_confirmations: [],
          items: [],
        },
      }),
    ).rejects.toThrow(/include saved requirements/i);
    expect(reqs(await snap())).toEqual(reqs(before));
    expect((await snap()).requirement_scan).toMatchObject({ current: false });
    await scan([{ ref: "R-1", excluded: true }]);
  });
  it("recovers a lost scan response without a second version or duplicated requirement", async () => {
    await clauses("The contractor shall obtain independently reviewed building permits.");
    state.loseSaveResponse = true;
    await expect(scan([{ ref: "R-1", excluded: true }])).rejects.toThrow(/after scan commit/i);
    const committed = await snap();
    expect(committed.requirement_scan).toMatchObject({ current: true });
    await scan([{ ref: "R-1", excluded: true }]);
    expect((await snap()).version).toBe(committed.version);
    expect(reqs(await snap())).toEqual(reqs(committed));
  });
  it("fails a clause read without inferring absence or saving guessed requirements", async () => {
    const before = reqs(await snap()),
      writes = state.writes;
    state.readError = true;
    try {
      await expect(scan()).rejects.toThrow(/could not be read.*no absence/i);
    } finally {
      state.readError = false;
    }
    expect(state.writes).toBe(writes);
    expect(reqs(await snap())).toEqual(before);
  });
  it("rejects a source edit before clause read using the exact fingerprint", async () => {
    const before = reqs(await snap()),
      writes = state.writes;
    state.beforeRead = () =>
      clauses("The contractor shall obtain latest building permits.").then(() => {});
    await expect(scan()).rejects.toThrow(/sources changed during the read/i);
    expect(state.writes).toBe(writes);
    expect(reqs(await snap())).toEqual(before);
    await scan([{ ref: "R-1", confirmed: true }]);
  });
  it("rejects an edit after text read and before save using lock-bound CAS", async () => {
    const before = reqs(await snap());
    state.afterRead = () =>
      clauses("The contractor shall obtain final building permits.").then(() => {});
    await expect(scan()).rejects.toThrow(/current requirement sources|estimate changed/i);
    expect(reqs(await snap())).toEqual(before);
    await scan([{ ref: "R-1", confirmed: true }]);
    const afterReview = reqs(await snap());
    state.beforeSave = () => saveSpec("A newly added saved specification.").then(() => {});
    await expect(scan()).rejects.toThrow(/current requirement sources|estimate changed/i);
    expect(reqs(await snap())).toEqual(afterReview);
    await scan([{ ref: "R-1", confirmed: true }]);
  });
  it("holds stale stored verified flags and body fingerprint conflicts until source review", async () => {
    await rpc("mcp_clauses_save", {
      _job: job,
      _doc: { name: "Replaced", body: "Different contract wording without the old requirement." },
      _clauses: [],
    });
    const reads = state.reads,
      writes = state.writes;
    await expect(scan()).rejects.toThrow(/no longer matches the current saved contract/i);
    expect(state.reads).toBe(reads);
    expect(state.writes).toBe(writes);
    await clauses("The contractor shall obtain final building permits.");
    await db.query(
      "UPDATE mcp_contract_documents SET body='Changed without a matching declared hash' WHERE job_id=$1",
      [job],
    );
    await expect(scan()).rejects.toThrow(/recorded fingerprint/i);
    await clauses("The contractor shall obtain final building permits.");
    await scan([{ ref: "R-1", confirmed: true }]);
  });
  it("hashes all saved scanner setup inputs while price/quote-only edits do not create a rescan cycle", async () => {
    for (const patch of [
      { role: "self_performer" },
      { doc_review: { sheets: [], specs: [], pairs: [] } },
      { documents: [{ name: "Saved scope reference", kind: "drawing" }] },
    ]) {
      const before = sourceManifest(await snap());
      await rpc("mcp_estimate_setup_save", { _job: job, _patch: patch });
      const after = await snap();
      expect(sourceManifest(after).sha256).not.toBe(before.sha256);
      expect(after.requirement_scan).toMatchObject({ current: false });
      expect((await call(estimateBidSummary)).structuredContent.ready).toBe(false);
      await scan([{ ref: "R-1", confirmed: true }]);
    }
    const before = await snap(),
      source = sourceManifest(before).sha256;
    await rpc("mcp_estimate_pricing_save_versioned", {
      _job: job,
      _expected_version: before.version,
      _labor: [{ ref: "T-1", production_per_man_hour: 10, hourly_rate: 110, confirmed: true }],
      _material: null,
      _quotes: null,
      _sources: null,
    });
    const priced = await snap();
    expect(sourceManifest(priced).sha256).toBe(source);
    expect(priced.requirement_scan).toMatchObject({ current: true });
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(true);
    await rpc("mcp_estimate_pricing_save_versioned", {
      _job: job,
      _expected_version: priced.version,
      _labor: null,
      _material: null,
      _quotes: [{ sub: "Comparison", description: "Paint", amount: 2000, ref: "T-1" }],
      _sources: null,
    });
    expect((await snap()).requirement_scan).toMatchObject({ current: true });
  });
  it("keeps a changed requirement source held even after quote coverage is freshly reviewed", async () => {
    const reviewQuotes = async () => {
      const request = randomUUID();
      await rpc("mcp_estimate_coverage_review", {
        _job: job,
        _request: request,
        _expected_version: (await snap()).version,
        _decisions: [
          {
            quote_index: 0,
            decision: "carry",
            ref: "T-1",
            replace_labor_and_material: true,
            exclusive_to_line: true,
            source_note: "Saved quote for this takeoff line",
            scope_note: "Replaces the whole paint line",
            exclusions_note: "No permits, general conditions or other priced scope",
          },
        ],
      });
      await rpc("mcp_estimate_coverage_save", {
        _job: job,
        _request: request,
        _confirmed: true,
      });
      expect((await snap()).selection).toMatchObject({ current: true });
    };
    await reviewQuotes();
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(true);
    await rpc("mcp_estimate_setup_save", { _job: job, _patch: { role: "gc" } });
    await reviewQuotes();
    const changed = await snap();
    expect(changed.requirement_scan).toMatchObject({ current: false });
    expect((await call(estimateBidSummary)).structuredContent).toMatchObject({
      ready: false,
      total: null,
      bid_csv: null,
    });
    expect(calculateSavedBidSnapshot(changed).view.ready).toBe(false);
    for (const format of ["pdf", "xlsx"])
      await expect(call(estimateBidSummary, { export_format: format })).rejects.toThrow(
        /reconciled bid/i,
      );
    await scan([{ ref: "R-1", confirmed: true }]);
    await reviewQuotes();
    expect((await call(estimateBidSummary)).structuredContent.ready).toBe(true);
  });
  it("keeps exact stored source evidence readable while new changes require fresh final review", async () => {
    // A current quote decision cannot certify historical evidence that lacks
    // the requirement-source protocol.
    const raw = await snap();
    const legacy = structuredClone(raw);
    delete legacy.requirement_sources;
    delete legacy.requirement_scan;
    (legacy.capabilities as Record<string, unknown>).requirement_sources = false;
    const calculation = calculateSavedBidSnapshot(legacy);
    expect(calculation.view.ready).toBe(false);
    expect(calculation.view.total).toBeNull();
  });
  it("preserves role boundaries and minimal tenant-scoped source context", async () => {
    await expect(rpc("mcp_estimate_coverage_snapshot", { _job: job }, outsider)).rejects.toThrow();
    await expect(rpc("mcp_estimate_coverage_snapshot", { _job: job }, superId)).rejects.toThrow();
    await expect(rpc("mcp_estimate_coverage_snapshot", { _job: job }, inactive)).rejects.toThrow();
    const contracted = await rpc("mcp_estimate_coverage_snapshot", { _job: job }, estimator);
    expect(contracted.capabilities).toMatchObject({ requirement_sources: true });
    await clauses(
      "Other project security requirement.",
      "Other project security requirement.",
      other,
    );
    const otherSource = sourceManifest(
      await rpc("mcp_estimate_coverage_snapshot", { _job: other }),
    );
    const selected = sourceManifest(await snap());
    expect(selected.clauses.map((c) => c.id)).not.toContain(otherSource.clauses[0].id);
  });
});
