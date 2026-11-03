/* End-to-end local fixture: actual handlers and guarded SQL RPCs on PGlite.
 * No network, live records, browser host, or real drawing accuracy is involved. */
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { takeoffCardHtml } from "./cards/takeoff-card";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { fakeClient } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  client: null as null | { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> },
  loseSaveResponse: false,
  failBeforeSave: false,
  injectQuotesBeforeSave: null as null | unknown[],
  uploaded: [] as string[],
  artifacts: new Map<string, Uint8Array>(),
  changeDuringUpload: false,
}));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, bytes: Uint8Array) => {
            if (
              bucket !== "athena-estimate-exports" ||
              !path.startsWith(
                "00000000-0000-4000-8000-000000000910/00000000-0000-4000-8000-000000000920/export-",
              )
            )
              return { error: { message: "tenant denied" } };
            state.uploaded.push(path);
            state.artifacts.set(path, new Uint8Array(bytes));
            if (state.changeDuringUpload) {
              state.changeDuringUpload = false;
              await state.client!.rpc("mcp_estimate_setup_save", {
                _job: "00000000-0000-4000-8000-000000000920",
                _patch: { in_scope: ["Changed during upload"] },
              });
            }
            return { error: null };
          },
          createSignedUrl: async (path: string, seconds: number) => ({
            data: {
              signedUrl: `https://fixture.supabase.co/storage/v1/object/sign/athena-estimate-exports/${path}?ttl=${seconds}`,
            },
            error: null,
          }),
        }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (!state.client) throw new Error("Local database unavailable");
        if (name === "mcp_estimate_coverage_save" && state.failBeforeSave) {
          state.failBeforeSave = false;
          return { data: null, error: { message: "Interrupted before save" } };
        }
        if (name === "mcp_estimate_pricing_save_versioned" && state.injectQuotesBeforeSave) {
          const quotes = state.injectQuotesBeforeSave;
          state.injectQuotesBeforeSave = null;
          const concurrent = (await state.client.rpc("mcp_estimate_pricing_save", {
            _job: args._job,
            _labor: null,
            _material: null,
            _quotes: quotes,
            _sources: null,
          })) as { error: { message: string } | null };
          if (concurrent.error) throw new Error(concurrent.error.message);
        }
        const result = await state.client.rpc(name, args);
        if (name === "mcp_estimate_coverage_save" && state.loseSaveResponse) {
          state.loseSaveResponse = false;
          return { data: null, error: { message: "Response interrupted after commit" } };
        }
        return result;
      },
    }),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new Error(error.message);
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", async () => ({
  resolveJob: async () => ({
    job_id: "00000000-0000-4000-8000-000000000920",
    job_number: "900071",
    name: "Synthetic Example",
    company_id: "00000000-0000-4000-8000-000000000910",
  }),
  named: (await import("./job-label")).jobHeading,
  audit: async () => {},
}));

import {
  estimatePricing,
  estimateBidSummary,
  estimateRateSources,
} from "./tools/estimate-bid-tools";
import { estimateQuoteCoverage, estimateSourceSnapshot } from "./tools/estimate-coverage-tools";
import { GC_ITEMS } from "./estimating-bid";
import { parseState, settle } from "./estimating";
import { verifiedLines, type EngineSnapshot } from "./takeoff/state";

const owner = "00000000-0000-4000-8000-000000000901";
const company = "00000000-0000-4000-8000-000000000910";
const job = "00000000-0000-4000-8000-000000000920";
const request = "00000000-0000-4000-8001-000000000001";
const request2 = "00000000-0000-4000-8001-000000000002";
const request3 = "00000000-0000-4000-8001-000000000003";
let db: PGlite;
type Result = { structuredContent: Record<string, unknown>; content: { text: string }[] };
const call = async (tool: unknown, args: Record<string, unknown>) => {
  const response = await (
    tool as { handler: (args: unknown, ctx: unknown) => Promise<Result> }
  ).handler({ job_number: "E2E", ...args }, {});
  const raw = response.structuredContent;
  if (raw.bid_summary)
    return {
      ...response,
      structuredContent: {
        ...(raw.bid_summary as object),
        downloads: raw.downloads ?? [],
        rendered: raw,
      },
    };
  return response;
};
const dbRpc = async (name: string, args: Record<string, unknown>) => {
  if (!state.client) throw new Error("Local database unavailable");
  const result = (await state.client.rpc(name, args)) as {
    data: unknown;
    error: { message: string } | null;
  };
  if (result.error) throw new Error(result.error.message);
  return result.data as Record<string, unknown>;
};
const decisions = [
  {
    quote_index: 0,
    decision: "carry",
    ref: "T-1",
    replace_labor_and_material: true,
    exclusive_to_line: true,
    source_note: "Written quotation",
    scope_note: "Paint labor and material for this line",
    exclusions_note: "No other line included",
  },
  { quote_index: 1, decision: "compare", ref: "T-1" },
];

beforeAll(async () => {
  db = await makeDb();
  for (const migration of [
    "20261022200000_athena_estimating.sql",
    "20261022230000_athena_estimating_bid.sql",
    "20261023010000_athena_estimating_conventions.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  for (const migration of [
    "20261031120000_athena_file_upload.sql",
    "20261027130000_athena_drawing_versions.sql",
    "20261024005713_athena_takeoff_engine.sql",
    "20261024160000_athena_takeoff_carry_by_identity.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-member-read-transactions.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-quote-coverage.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-gc-requirements-cas.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-frozen-source-snapshot.sql", "utf8"));
  await db.exec(readFileSync("release-proposals/estimating-requirement-sources.sql", "utf8"));
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.invalid')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Builder',$2)", [
    company,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Member')",
    [company, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Job','E2E',$3)",
    [job, owner, company],
  );
  state.client = fakeClient(db, {
    sub: owner,
    email: "fixture@example.invalid",
    role: "authenticated",
  });
  await dbRpc("mcp_estimate_setup_save", {
    _job: job,
    _patch: {
      role: "gc",
      trades: ["Finishes"],
      in_scope: ["Paint and flooring"],
      out_scope: ["Foundation work"],
    },
  });
  await dbRpc("mcp_estimate_takeoff_save", {
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
      {
        line_no: 2,
        item: "Floor",
        qty: 100,
        unit: "SF",
        sheet: "A2",
        basis: "measured",
        math: "100 SF",
      },
    ],
  });
  for (const line_no of [1, 2])
    await dbRpc("mcp_takeoff_geometry_save", {
      _job: job,
      _operation: "not_drawable",
      _expected: 0,
      _record: {
        line_no,
        takeoff_version: 1,
        exception_kind: "schedule_quantity",
        quantity: 100,
        reason: "Schedule quantity confirmed",
      },
    });
  await dbRpc("mcp_estimate_gc_save", {
    _job: job,
    _start: null,
    _finish: null,
    _days: 1,
    _lines: GC_ITEMS.map(({ key }) => ({ key, amount: 0, qty: 1, rate: 0, confirmed: true })),
  });
  await dbRpc("mcp_estimate_bid_save", { _job: job, _overhead: 10, _profit: 10 });
  const unscanned = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
  await dbRpc("mcp_estimate_requirements_save", {
    _job: job,
    _items: {
      expected_version: unscanned.version,
      source_sha256: (unscanned.requirement_sources as { sha256: string }).sha256,
      reviewed_confirmations: [],
      items: [],
    },
  });
});
afterAll(async () => db.close());

describe.sequential("quote selection through actual handlers and guarded SQL", () => {
  it("saves rates and comparison quotes, and holds the unreviewed bid", async () => {
    await call(estimatePricing, {
      labor: [
        { ref: "T-1", production_per_man_hour: 10, hourly_rate: 100, confirmed: true },
        { ref: "T-2", man_hours: 0, hourly_rate: 100, confirmed: true },
      ],
      material: [
        { ref: "T-1", unit_price: 5, confirmed: true },
        { ref: "T-2", unit_price: 5, confirmed: true },
      ],
      quotes: [
        { sub: "A", description: "Paint", amount: 1400, ref: "T-1" },
        { sub: "B", description: "Paint", amount: 1600, ref: "T-1" },
      ],
    });
    const result = await call(estimateBidSummary, {});
    expect(result.structuredContent).toMatchObject({ ready: false, total: null, bid_csv: null });
  });
  it("reviews exact saved facts, survives an interrupted save, and returns matching bid CSV", async () => {
    const read = await call(estimateQuoteCoverage, { step: "read" });
    const version = read.structuredContent.version;
    const review = await call(estimateQuoteCoverage, {
      step: "review",
      expected_version: version,
      request_id: request,
      decisions,
    });
    expect(review.structuredContent).toMatchObject({ status: "review", current: true });
    expect(review.content[0].text).toContain("1400");
    expect(review.content[0].text).toContain("Current reviewed quantity: 100 SF");
    expect(review.content[0].text).toContain("drawing reference A1");
    state.failBeforeSave = true;
    await expect(
      call(estimateQuoteCoverage, { step: "save", request_id: request, confirmed: true }),
    ).rejects.toThrow(/before save/i);
    state.loseSaveResponse = true;
    await expect(
      call(estimateQuoteCoverage, { step: "save", request_id: request, confirmed: true }),
    ).rejects.toThrow(/after commit/i);
    const saved = await call(estimateQuoteCoverage, {
      step: "save",
      request_id: request,
      confirmed: true,
    });
    const repeated = await call(estimateQuoteCoverage, {
      step: "save",
      request_id: request,
      confirmed: true,
    });
    expect(repeated.structuredContent).toEqual(saved.structuredContent);
    const bid = await call(estimateBidSummary, {});
    const raw = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
    const loaded = parseState(raw.estimate);
    const settled = settle(
      verifiedLines(loaded.lines, raw.takeoff as EngineSnapshot),
      loaded.gaps,
      loaded.verdicts,
      loaded.setup,
    );
    expect(settled.settled, JSON.stringify(settled.blockers)).toBe(true);
    expect(bid.structuredContent, JSON.stringify(bid.structuredContent)).toMatchObject({
      ready: true,
      direct: 1900,
      total: 2299,
      snapshot_version: saved.structuredContent.version,
    });
    const walkthrough = await call(estimatePricing, {});
    expect(walkthrough.structuredContent).toMatchObject({
      direct: 1900,
      snapshot_version: saved.structuredContent.version,
      blockers: [],
    });
    const csv = String(bid.structuredContent.bid_csv);
    expect(csv).toContain('"scope","T-1","","quote","0",1400.00');
    expect(csv).toContain('"scope","T-2","","direct","",500.00');
    expect(csv).toContain('"total","","Bid total","","",2299.00');
    expect(csv).not.toContain("1600.00");
    const draft = await call(estimateBidSummary, { handoff_draft: true });
    const handoff = draft.structuredContent.handoff_draft as {
      status: string;
      sha256: string;
      payload: { snapshot: { version: number }; breakdown: { totalCents: number } };
    };
    expect(handoff).toMatchObject({
      status: "draft",
      payload: {
        snapshot: { version: saved.structuredContent.version },
        breakdown: { totalCents: 229900 },
      },
    });
    expect(handoff.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const format of ["pdf", "xlsx"]) {
      const exported = await call(estimateBidSummary, { export_format: format });
      const file = exported.structuredContent.bid_export as {
        filename: string;
        snapshot_version: number;
        mime_type: string;
        url: string;
        expires_in: number;
        source_sha256: string;
      };
      expect(file).toMatchObject({
        snapshot_version: saved.structuredContent.version,
        expires_in: 900,
        url: expect.stringMatching(/^https:\/\/fixture\.supabase\.co\//),
        filename: expect.stringMatching(new RegExp(`\\.${format}$`)),
      });
      expect(file.mime_type).toBe(
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(exported.structuredContent.downloads).toEqual([file]);
      expect(exported.content.map((part) => part.text).join("\n")).toContain(file.url);
      expect(file).not.toHaveProperty("content_base64");
      expect(exported.structuredContent.total).toBe(2299);
      const rendered = exported.structuredContent.rendered as {
        card: { sections: { heading: string; rows: { href?: string }[] }[] };
        context: { company_id: string; job_id: string };
      };
      const row = rendered.card.sections.find(
        (section) => section.heading === "Private downloads (15 minutes)",
      )!.rows[0];
      expect(row.href).toBe(file.url);
      const script = takeoffCardHtml().match(/<script>([\s\S]*?)<\/script>/)![1];
      const start = script.indexOf("function openPrivateFile(href)");
      const fn = script.slice(start, script.indexOf("\n    if (!sc.source)", start)).trim();
      const sent: unknown[] = [];
      const open = new Script(`(${fn})`).runInNewContext({
        URL,
        sc: rendered,
        seq: 0,
        send: (message: unknown) => sent.push(message),
        notice: (message: string) => {
          throw new Error(message);
        },
      });
      open(row.href);
      expect(sent).toEqual([
        expect.objectContaining({ method: "ui/open-link", params: { url: file.url } }),
      ]);
      const path = decodeURIComponent(
        new URL(file.url).pathname.split("/athena-estimate-exports/")[1],
      );
      const bytes = state.artifacts.get(path)!;
      expect(bytes).toBeDefined();
      const serialized = new TextDecoder().decode(bytes);
      expect(serialized).toContain(company);
      expect(serialized).toContain(job);
      expect(serialized).toContain(file.source_sha256);
      if (format === "pdf")
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      else expect(serialized).toContain("900071 – Synthetic Example");
    }
  });
  it("withholds a stale upload link and retries at a newly reviewed version without overwrite", async () => {
    const previousCount = state.uploaded.length;
    state.changeDuringUpload = true;
    await expect(call(estimateBidSummary, { export_format: "pdf" })).rejects.toThrow(
      /changed or access/i,
    );
    expect(state.uploaded).toHaveLength(previousCount + 1);
    const read = await call(estimateQuoteCoverage, { step: "read" });
    await call(estimateQuoteCoverage, {
      step: "review",
      expected_version: read.structuredContent.version,
      request_id: request3,
      decisions,
    });
    await call(estimateQuoteCoverage, { step: "save", request_id: request3, confirmed: true });
    const retried = await call(estimateBidSummary, { export_format: "pdf" });
    const file = retried.structuredContent.bid_export as { url: string; snapshot_version: number };
    expect(file.url).toContain("ttl=900");
    expect(state.uploaded).toHaveLength(previousCount + 2);
    expect(state.uploaded[previousCount]).not.toBe(state.uploaded[previousCount + 1]);
  });
  it("holds output after a concurrent source change and rejects stale review saves", async () => {
    const prior = await call(estimateQuoteCoverage, { step: "read" });
    await call(estimateQuoteCoverage, {
      step: "review",
      expected_version: prior.structuredContent.version,
      request_id: request2,
      decisions,
    });
    await dbRpc("mcp_estimate_setup_save", { _job: job, _patch: { in_scope: ["Scope changed"] } });
    await expect(
      call(estimateQuoteCoverage, { step: "save", request_id: request2, confirmed: true }),
    ).rejects.toThrow(/changed/i);
    const bid = await call(estimateBidSummary, {});
    expect(bid.structuredContent).toMatchObject({ ready: false, total: null, bid_csv: null });
    const beforeUpload = state.uploaded.length;
    await expect(call(estimateBidSummary, { export_format: "pdf" })).rejects.toThrow(
      /reconciled bid/i,
    );
    expect(state.uploaded).toHaveLength(beforeUpload);
    await expect(call(estimateBidSummary, { handoff_draft: true })).rejects.toThrow(
      /current, reconciled bid/i,
    );
    const retry = await call(estimateQuoteCoverage, {
      step: "save",
      request_id: request,
      confirmed: true,
    });
    expect(retry.structuredContent.current).toBe(false);
  });
  it("rejects a stale handler pricing save without erasing a concurrently added quote", async () => {
    const before = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
    const oldPricing = (before.bid as { pricing: { quotes: unknown[]; material: unknown[] } })
      .pricing;
    const newQuotes = [
      ...oldPricing.quotes,
      { sub: "C", description: "Another comparison", amount: 1700, ref: "T-1" },
    ];
    state.injectQuotesBeforeSave = newQuotes;
    await expect(
      call(estimatePricing, { material: [{ ref: "T-2", unit_price: 6, confirmed: true }] }),
    ).rejects.toThrow(/changed/i);
    const after = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
    const pricing = (after.bid as { pricing: { quotes: unknown[]; material: unknown[] } }).pricing;
    expect(pricing.quotes).toEqual(newQuotes);
    expect(pricing.material).toEqual(oldPricing.material);
  });
  it("rejects duplicate factor-source identities and accepts an explicit versioned correction", async () => {
    const factor = { source: "rsmeans", carry: true, location_factor: 1.1, confirmed: true };
    await call(estimateRateSources, { sources: [factor] });
    const before = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
    await expect(
      call(estimateRateSources, { sources: [factor, { ...factor, carry: false }] }),
    ).rejects.toThrow(/duplicate|unique/i);
    const unchanged = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
    expect(unchanged.version).toEqual(before.version);
    expect(unchanged.bid).toEqual(before.bid);
    const corrected = { ...factor, location_factor: 1.25, carry: false };
    await call(estimateRateSources, { sources: [corrected] });
    const after = await dbRpc("mcp_estimate_coverage_snapshot", { _job: job });
    const pricing = (after.bid as { pricing: { rate_sources: unknown[]; quotes: unknown[] } })
      .pricing;
    expect(pricing.rate_sources).toEqual([corrected]);
    expect(pricing.quotes).toEqual(
      (before.bid as { pricing: { quotes: unknown[] } }).pricing.quotes,
    );
  });
  it("replays a confirmed immutable source through the canonical calculator after current edits", async () => {
    const factsSql = "SELECT to_jsonb(f) AS row FROM mcp_job_facts f WHERE job_id=$1 ORDER BY id";
    const factsBefore = (await db.query(factsSql, [job])).rows;
    const current = await call(estimateQuoteCoverage, { step: "read" });
    const quoteRequest = "00000000-0000-4000-8001-000000000081";
    const sourceRequest = "00000000-0000-4000-8001-000000000082";
    await call(estimateQuoteCoverage, {
      step: "review",
      expected_version: current.structuredContent.version,
      request_id: quoteRequest,
      decisions: [...decisions, { quote_index: 2, decision: "compare", ref: "T-1" }],
    });
    const covered = await call(estimateQuoteCoverage, {
      step: "save",
      request_id: quoteRequest,
      confirmed: true,
    });
    const live = await call(estimateBidSummary, { handoff_draft: true });
    const review = await call(estimateSourceSnapshot, {
      step: "review",
      request_id: sourceRequest,
      expected_version: covered.structuredContent.version,
    });
    const calculated = review.structuredContent.calculated_bid;
    expect(calculated).toMatchObject({
      ready: true,
      total: 2299,
      posting_permitted: false,
      canonical_sha256: (live.structuredContent.handoff_draft as { sha256: string }).sha256,
    });
    await expect(
      call(estimateSourceSnapshot, { step: "save", request_id: sourceRequest }),
    ).rejects.toThrow(/confirm/i);
    const saved = await call(estimateSourceSnapshot, {
      step: "save",
      request_id: sourceRequest,
      confirmed: true,
    });
    const id = saved.structuredContent.snapshot_id;
    expect(saved.structuredContent.calculated_bid).toMatchObject({
      ...(calculated as object),
      source_snapshot_id: id,
    });
    await dbRpc("mcp_estimate_bid_save_versioned", {
      _job: job,
      _expected_version: covered.structuredContent.version,
      _overhead: 20,
      _profit: 10,
    });
    const frozen = await call(estimateSourceSnapshot, { step: "read", snapshot_id: id });
    expect(frozen.structuredContent.current).toBe(false);
    expect(frozen.structuredContent.calculated_bid).toEqual(saved.structuredContent.calculated_bid);
    expect((await call(estimateBidSummary, {})).structuredContent.ready).toBe(false);
    expect((await db.query(factsSql, [job])).rows).toEqual(factsBefore);
  });
});
