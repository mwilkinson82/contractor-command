/* eslint-disable @typescript-eslint/no-explicit-any -- Local PostgreSQL RPC JSON has intentionally different result shapes; assertions verify its runtime values. */
import { appendMeasuredSheets } from "./integration";
import { bytesToBase64 } from "../estimating-sheet";
import { reviseGeometry } from "./revision";
import { PDFDocument, rgb } from "pdf-lib";
import { sha256Hex } from "../file-share";
import {
  loadStoredPage,
  saveCalibration,
  saveGeometry,
  decideGeometry,
  requiredSnapshot,
  viewEngine,
} from "./service";
import { downloadMeasuredExport, exportMeasuredSheet } from "./export";
import { measurementStatus, verifiedLines } from "./state";
import type { Sb } from "../guard";
import type { Job } from "../jobs";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../../tests/mcp-roles/db";
import { asUser } from "../../../../tests/mcp-roles/fake-supabase";
const company = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const owner = "00000000-0000-4000-8000-000000000010",
  outsider = "00000000-0000-4000-8000-000000000011",
  estimator = "00000000-0000-4000-8000-000000000012",
  superId = "00000000-0000-4000-8000-000000000013";
let db: PGlite, source: string;
const query = async (sql: string, args: unknown[] = [], who = owner) =>
  asUser(
    db,
    { sub: who, email: `qa-${who.slice(-2)}@example.com`, role: "authenticated" },
    async (tx) => (await tx.query(sql, args)).rows as Record<string, any>[],
  );
const rpc = async (name: string, args: unknown[], who = owner) =>
  (
    await query(
      `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS data`,
      args,
      who,
    )
  )[0].data;
const calibration = (region: string) => ({
  region,
  width: 720,
  height: 360,
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  reference: {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    distance: 100,
    unit: "ft",
  },
  method: "estimator",
  confidence: "high",
  confirmed: true,
});
const runShape = {
  kind: "polyline",
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.6, y: 0.1 },
  ],
};
const save = (record: Record<string, unknown>, op = "save", expected = 0, who = owner, j = job) =>
  rpc(
    "mcp_takeoff_geometry_save",
    [
      j,
      op,
      JSON.stringify({
        line_no: 2,
        takeoff_version: 1,
        source_id: source,
        page: 1,
        width: 720,
        height: 360,
        shape: runShape,
        ...record,
      }),
      expected,
    ],
    who,
  );
beforeAll(async () => {
  db = await makeDb();
  await db.exec(readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"));
  await db.exec(
    `CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/20261027130000_athena_drawing_versions.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/20261024005713_athena_takeoff_engine.sql", "utf8"),
  );
  for (const id of [owner, outsider, estimator, superId]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
      id,
      `qa-${id.slice(-2)}@example.com`,
    ]);
    await db.query("INSERT INTO public.test_active_members VALUES($1)", [id]);
  }
  await db.query(
    "INSERT INTO public.mcp_companies(id,name,created_by) VALUES($1,'Fictional Construction',$2)",
    [company, owner],
  );
  for (const [id, role] of [
    [owner, "owner"],
    [estimator, "estimating"],
    [superId, "super"],
  ])
    await db.query(
      "INSERT INTO public.mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,$3,'QA estimator')",
      [company, id, role],
    );
  for (const j of [job, other])
    await db.query(
      "INSERT INTO public.mcp_jobs(id,user_id,name,job_number,company_id) VALUES($1,$2,'Fictional Job',$3,$4)",
      [j, owner, j === job ? "2701" : "OTHER", company],
    );
  await db.query("INSERT INTO public.mcp_job_access(job_id,user_id,granted_by) VALUES($1,$2,$3)", [
    job,
    superId,
    owner,
  ]);
  source = (
    await rpc("mcp_drawing_source_save", [
      job,
      JSON.stringify({
        path: `${company}/${job}/drawing-fixture/source.pdf`,
        storage_bucket: "athena-drawings",
        filename: "Fictional.pdf",
        source_key: "file:fictional",
        content_hash: "a".repeat(64),
        sheets: ["S-100"],
      }),
    ])
  ).id;
  await rpc("mcp_estimate_takeoff_save", [
    job,
    "QA",
    "[]",
    JSON.stringify([
      {
        line_no: 1,
        item: "Fixtures",
        qty: 999,
        unit: "EA",
        measure_type: "count",
        basis: "measured",
        math: "Legacy supplied count",
        confidence: "low",
        sheet: "S-100",
        inputs: [],
      },
      {
        line_no: 2,
        item: "Conduit",
        qty: 999,
        unit: "LF",
        measure_type: "linear",
        basis: "measured",
        math: "Legacy supplied length",
        confidence: "low",
        sheet: "S-100",
        inputs: [],
      },
      {
        line_no: 3,
        item: "Slab",
        qty: 999,
        unit: "SF",
        measure_type: "area",
        basis: "measured",
        math: "Legacy supplied area",
        confidence: "low",
        sheet: "S-100",
        inputs: [],
      },
    ]),
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("takeoff actual database functions", () => {
  it("keeps legacy lines readable with no invented geometry", async () => {
    const state = await rpc("mcp_takeoff_get", [job]);
    expect(state.available).toBe(true);
    expect(state.lines).toHaveLength(3);
    expect(state.geometry).toEqual([]);
  });
  it("computes calibration and quantities in SQL, ignoring forged measured values", async () => {
    const c = await rpc("mcp_takeoff_calibrate", [
      job,
      source,
      1,
      JSON.stringify({ ...calibration("Plan"), feet_per_point: 12345 }),
      0,
    ]);
    expect(Number(c.feet_per_point)).toBeCloseTo(100 / 720);
    const g = await save({
      calibration_id: c.id,
      measured: 7000000,
      unit: "CY",
      status: "accepted",
      created_by: outsider,
    });
    expect(Number(g.measured)).toBeCloseTo(50);
    expect(g.unit).toBe("LF");
    expect(g.status).toBe("proposed");
    expect(g.created_by).toBe(owner);
    const accepted = await save(
      { geometry_id: g.geometry_id, shape: { kind: "pins", points: [{ x: 0.9, y: 0.9 }] } },
      "accept",
      g.version,
    );
    expect(accepted.shape).toEqual(runShape);
    expect(Number(accepted.measured)).toBeCloseTo(50);
    expect(accepted.status).toBe("accepted");
    await expect(save({ geometry_id: g.geometry_id }, "accept", g.version)).rejects.toThrow(
      /changed/,
    );
    const history = (
      await db.query(
        "SELECT status FROM public.mcp_takeoff_geometry WHERE geometry_id=$1 ORDER BY version",
        [g.geometry_id],
      )
    ).rows;
    expect(history).toEqual([{ status: "proposed" }, { status: "accepted" }]);
  });
  it("permits counts without scale and refuses unlocated pins", async () => {
    const g = await save({
      line_no: 1,
      shape: {
        kind: "pins",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.2 },
        ],
      },
    });
    expect(Number(g.measured)).toBe(2);
    expect(g.unit).toBe("EA");
    await expect(save({ line_no: 1, shape: { kind: "pins", points: [] } })).rejects.toThrow(
      /Invalid/,
    );
    await expect(
      save({ line_no: 1, shape: { kind: "pins", points: [{ x: 2, y: 0.2 }] } }),
    ).rejects.toThrow(/stored page/);
  });
  it("recalibration preserves old history and produces a review proposal", async () => {
    const c = await rpc("mcp_takeoff_calibrate", [
      job,
      source,
      1,
      JSON.stringify(calibration("Detail")),
      0,
    ]);
    const g = await save({
      calibration_id: c.id,
      shape: {
        kind: "polyline",
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.6, y: 0.2 },
        ],
      },
    });
    await save({ geometry_id: g.geometry_id }, "accept", 1);
    const next = {
      ...calibration("Detail"),
      reference: { ...calibration("Detail").reference, distance: 200 },
    };
    await rpc("mcp_takeoff_calibrate", [job, source, 1, JSON.stringify(next), 1]);
    const state = await rpc("mcp_takeoff_get", [job]);
    const changed = state.geometry.find((r: any) => r.geometry_id === g.geometry_id);
    expect(changed.version).toBe(3);
    expect(changed.status).toBe("proposed");
    expect(Number(changed.measured)).toBeCloseTo(100);
    const prior = (
      await db.query(
        "SELECT measured FROM public.mcp_takeoff_geometry WHERE geometry_id=$1 AND version=2",
        [g.geometry_id],
      )
    ).rows[0] as any;
    expect(Number(prior.measured)).toBeCloseTo(50);
  });
  it("keeps geometry outside a changed calibration region unsettled", async () => {
    const c = await rpc("mcp_takeoff_calibrate", [
      job,
      source,
      1,
      JSON.stringify(calibration("Narrowed plan")),
      0,
    ]);
    const g = await save({
      calibration_id: c.id,
      shape: {
        kind: "polyline",
        points: [
          { x: 0.15, y: 0.4 },
          { x: 0.65, y: 0.4 },
        ],
      },
    });
    await save({ geometry_id: g.geometry_id }, "accept", 1);
    await rpc("mcp_takeoff_calibrate", [
      job,
      source,
      1,
      JSON.stringify({
        ...calibration("Narrowed plan"),
        bounds: { x: 0, y: 0, width: 0.3, height: 1 },
        reference: {
          points: [
            { x: 0, y: 0 },
            { x: 0.3, y: 0 },
          ],
          distance: 30,
          unit: "ft",
        },
      }),
      1,
    ]);
    const state = await rpc("mcp_takeoff_get", [job]);
    const current = state.geometry.find((r: any) => r.geometry_id === g.geometry_id);
    expect(current.status).toBe("rejected");
    expect(current.evidence.requires_relocation).toBe(true);
    expect(measurementStatus(state).settled).toBe(false);
    await expect(
      rpc("mcp_takeoff_markup_save", [
        job,
        JSON.stringify({
          source_id: source,
          page: 1,
          kind: "pass",
          geometry_revs: ["00000000-0000-4000-8000-000000000099"],
        }),
      ]),
    ).rejects.toThrow(/does not belong/);
  });
  it("refuses absent scale, foreign sources, wrong line units and stale takeoffs", async () => {
    await expect(save({})).rejects.toThrow(/calibration/);
    await expect(save({ source_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })).rejects.toThrow(
      /source sheet/,
    );
    await expect(save({ takeoff_version: 999 })).rejects.toThrow(/takeoff changed/);
    await expect(
      save({ line_no: 2, shape: { kind: "pins", points: [{ x: 0.2, y: 0.2 }] } }),
    ).rejects.toThrow(/units|measurement type/);
  });
  it("requires a reason for a not-drawable exception", async () => {
    await expect(
      save({ line_no: 1, reason: "", exception_kind: "spec_only" }, "not_drawable"),
    ).rejects.toThrow(/reason/);
    const row = await save(
      {
        line_no: 1,
        reason: "Fixture count from the equipment schedule",
        quantity: 12,
        exception_kind: "schedule_quantity",
      },
      "not_drawable",
    );
    expect(row.status).toBe("not_drawable");
    expect(row.reason).toContain("schedule");
    const reopened = await save(
      {
        line_no: 1,
        geometry_id: row.geometry_id,
        reason: "Estimator reopened this line for drawing measurement",
      },
      "reject",
      row.version,
    );
    expect(reopened.status).toBe("rejected");
    expect(reopened.shape.kind).toBe("not_drawable");
  });
  it("persists a zero-progress confirmed count scope without creating geometry or quantity", async () => {
    const pid = crypto.randomUUID(),
      before = await rpc("mcp_takeoff_get", [job]);
    const summary = {
      pass_id: pid,
      line_no: 1,
      takeoff_version: 1,
      order: [0, 1],
      cursor: 0,
      next_cursor: 0,
      complete: false,
      count_area: {
        name: "Fictional plan",
        bounds: { x: 0, y: 0, width: 0.5, height: 1 },
        confirmed: true,
      },
    };
    await rpc("mcp_takeoff_pass_save", [
      job,
      JSON.stringify({ source_id: source, page: 1, pass_summary: summary, proposals: [] }),
    ]);
    const after = await rpc("mcp_takeoff_get", [job]);
    expect(after.geometry).toEqual(before.geometry);
    expect(after.lines).toEqual(before.lines);
    expect(
      after.passes.find((p: any) => p.pass_summary.pass_id === pid).pass_summary,
    ).toMatchObject(summary);
  });
  it("commits tile geometry with its checkpoint, blocks partial acceptance and makes retries idempotent", async () => {
    const pid = crypto.randomUUID();
    const summary = {
      pass_id: pid,
      line_no: 1,
      takeoff_version: 1,
      order: [0, 1],
      cursor: 0,
      next_cursor: 1,
      complete: false,
    };
    const proposal = {
      line_no: 1,
      takeoff_version: 1,
      source_id: source,
      page: 1,
      width: 720,
      height: 360,
      shape: { kind: "pins", points: [{ x: 0.7, y: 0.3 }] },
      evidence: { pass_id: pid, confidence: 0.95 },
    };
    const record = { source_id: source, page: 1, pass_summary: summary, proposals: [proposal] };
    const checkpoint = await rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record)]);
    const geometry = (await rpc("mcp_takeoff_get", [job])).geometry.find(
      (g: any) => g.evidence.pass_id === pid,
    );
    await expect(
      save({ line_no: 1, geometry_id: geometry.geometry_id }, "accept", 1),
    ).rejects.toThrow(/partial/);
    const retry = await rpc("mcp_takeoff_pass_save", [job, JSON.stringify(record)]);
    expect(retry.id).toBe(checkpoint.id);
    await expect(
      rpc("mcp_takeoff_pass_save", [
        job,
        JSON.stringify({
          ...record,
          pass_summary: { ...summary, cursor: 1, next_cursor: 2, complete: true },
          proposals: [{ ...proposal, line_no: 2 }],
        }),
      ]),
    ).rejects.toThrow(/belong/);
    expect(
      (await rpc("mcp_takeoff_get", [job])).passes.find((p: any) => p.pass_summary.pass_id === pid)
        .pass_summary.complete,
    ).toBe(false);
    await rpc("mcp_takeoff_pass_save", [
      job,
      JSON.stringify({
        ...record,
        pass_summary: { ...summary, cursor: 1, next_cursor: 2, complete: true },
        proposals: [],
      }),
    ]);
    const accepted = await save({ line_no: 1, geometry_id: geometry.geometry_id }, "accept", 1);
    expect(accepted.source).toBe("athena");
    expect(accepted.evidence.pass_id).toBe(pid);
  });
  it("rejects incomplete calibration regions, out-of-region references, crossing areas and missing rejection reasons", async () => {
    await expect(
      rpc("mcp_takeoff_calibrate", [
        job,
        source,
        1,
        JSON.stringify({ ...calibration("Invalid"), bounds: { x: 0 } }),
        0,
      ]),
    ).rejects.toThrow(/region/);
    await expect(
      rpc("mcp_takeoff_calibrate", [
        job,
        source,
        1,
        JSON.stringify({
          ...calibration("Invalid"),
          bounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
        }),
        0,
      ]),
    ).rejects.toThrow(/Reference points/);
    const c = await rpc("mcp_takeoff_calibrate", [
      job,
      source,
      1,
      JSON.stringify(calibration("Topology")),
      0,
    ]);
    await expect(
      save({
        line_no: 3,
        calibration_id: c.id,
        shape: {
          kind: "polygon",
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.9 },
            { x: 0.9, y: 0.1 },
            { x: 0.1, y: 0.9 },
          ],
        },
      }),
    ).rejects.toThrow(/cross/);
    const g = await save({ line_no: 1, shape: { kind: "pins", points: [{ x: 0.71, y: 0.31 }] } });
    await expect(save({ line_no: 1, geometry_id: g.geometry_id }, "reject", 1)).rejects.toThrow(
      /why/,
    );
  });
  it("accepts an exact verified list atomically and rolls the entire list back on one conflict", async () => {
    const evidence = { confidence: 0.95, verification: "raster-ink-and-topology" };
    const a = await save(
      { line_no: 1, shape: { kind: "pins", points: [{ x: 0.2, y: 0.3 }] }, evidence },
      "propose",
    );
    const b = await save(
      { line_no: 1, shape: { kind: "pins", points: [{ x: 0.4, y: 0.3 }] }, evidence },
      "propose",
    );
    const decisions = [
      { geometry_id: a.geometry_id, expected_version: 1 },
      { geometry_id: b.geometry_id, expected_version: 2 },
    ];
    await expect(
      rpc("mcp_takeoff_accept_batch", [job, source, 1, JSON.stringify(decisions)]),
    ).rejects.toThrow(/changed/);
    expect(
      (await rpc("mcp_takeoff_get", [job])).geometry.find(
        (g: any) => g.geometry_id === a.geometry_id,
      ).status,
    ).toBe("proposed");
    decisions[1].expected_version = 1;
    const rows = await rpc("mcp_takeoff_accept_batch", [job, source, 1, JSON.stringify(decisions)]);
    expect(rows).toHaveLength(2);
    expect(rows.every((g: any) => g.status === "accepted")).toBe(true);
  });
  it("makes retries idempotent across reordered pins, reversed runs and rotated polygon boundaries", async () => {
    const pins = {
      kind: "pins",
      points: [
        { x: 0.81, y: 0.81 },
        { x: 0.86, y: 0.86 },
      ],
    };
    const first = await save({ line_no: 1, shape: pins });
    const retry = await save({
      line_no: 1,
      shape: { ...pins, points: [...pins.points].reverse() },
    });
    expect(retry.id).toBe(first.id);
    expect(retry.duplicate).toBe(true);
    await expect(
      save({ line_no: 1, shape: { kind: "pins", points: [pins.points[0], { x: 0.91, y: 0.91 }] } }),
    ).rejects.toThrow(/already located/);
    const cal = (await rpc("mcp_takeoff_get", [job])).calibrations.find(
      (c: any) => c.region === "Plan",
    );
    const run = {
      kind: "polyline",
      points: [
        { x: 0.11, y: 0.71 },
        { x: 0.31, y: 0.71 },
      ],
    };
    const a = await save({ calibration_id: cal.id, shape: run });
    const b = await save({
      calibration_id: cal.id,
      shape: { ...run, points: [...run.points].reverse() },
    });
    expect(a.id).toBe(b.id);
    const area = await save({
      line_no: 3,
      calibration_id: cal.id,
      shape: {
        kind: "rect",
        points: [
          { x: 0.72, y: 0.72 },
          { x: 0.82, y: 0.82 },
        ],
      },
    });
    const same = await save({
      line_no: 3,
      calibration_id: cal.id,
      shape: {
        kind: "polygon",
        points: [
          { x: 0.82, y: 0.82 },
          { x: 0.72, y: 0.82 },
          { x: 0.72, y: 0.72 },
          { x: 0.82, y: 0.72 },
        ],
      },
    });
    expect(same.id).toBe(area.id);
  });
  it("rolls back the entire line version when a located geometry fails and refuses stale saves", async () => {
    const before = await rpc("mcp_takeoff_get", [job]);
    const lines = before.lines.map((l: any) => ({ ...l }));
    await expect(
      rpc("mcp_takeoff_write", [
        job,
        "Atomic rollback",
        "[]",
        JSON.stringify(lines),
        JSON.stringify([
          {
            line_no: 1,
            source_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            page: 1,
            width: 720,
            height: 360,
            shape: { kind: "pins", points: [{ x: 0.9, y: 0.1 }] },
          },
        ]),
        before.takeoff_version,
      ]),
    ).rejects.toThrow(/source sheet/);
    const after = await rpc("mcp_takeoff_get", [job]);
    expect(after.takeoff_version).toBe(before.takeoff_version);
    expect(after.lines.map((l: any) => l.id)).toEqual(before.lines.map((l: any) => l.id));
    await expect(
      rpc("mcp_takeoff_write", [job, "Stale", "[]", JSON.stringify(lines), "[]", 99]),
    ).rejects.toThrow(/changed/);
  });
  it("carries only exact unchanged lines into a new takeoff version", async () => {
    const before = await rpc("mcp_takeoff_get", [job]);
    const lines = before.lines.map((l: any) => {
      const { id, takeoff_id, created_at, ...record } = l;
      return record;
    });
    await rpc("mcp_estimate_takeoff_save", [job, "QA version 2", "[]", JSON.stringify(lines)]);
    const after = await rpc("mcp_takeoff_get", [job]);
    expect(after.takeoff_version).toBe(2);
    expect(after.geometry).toHaveLength(before.geometry.length);
    for (const g of after.geometry) {
      const old = before.geometry.find((r: any) => r.geometry_id === g.geometry_id);
      expect(g.version).toBe(old.version + 1);
      expect(g.line_id).not.toBe(old.line_id);
      expect(g.measured).toBe(old.measured);
      expect(g.status).toBe(old.status);
    }
  });
  it("runs stored PDF -> calibrated geometry -> explicit decisions -> immutable dated export with independent reference quantities", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const p = doc.addPage([720, 360]);
      p.drawLine({
        start: { x: 72, y: 252 },
        end: { x: 576, y: 252 },
        thickness: 1,
        color: rgb(0.3, 0.3, 0.3),
      });
      for (const x of [0.2, 0.4, 0.6])
        p.drawCircle({ x: x * 720, y: 0.8 * 360, size: 4, color: rgb(0.2, 0.2, 0.2) });
      p.drawRectangle({
        x: 72,
        y: 36,
        width: 360,
        height: 180,
        borderWidth: 1,
        borderColor: rgb(0.3, 0.3, 0.3),
      });
      p.drawRectangle({
        x: 144,
        y: 108,
        width: 72,
        height: 72,
        borderWidth: 1,
        borderColor: rgb(0.3, 0.3, 0.3),
      });
    }
    const bytes = await doc.save(),
      before = bytes.slice(),
      path = company + "/" + job + "/drawing-real-fixture/source.pdf",
      objects = new Map<string, Uint8Array>([[path, bytes]]),
      uploads: string[] = [];
    const src = await rpc("mcp_drawing_source_save", [
      job,
      JSON.stringify({
        path,
        filename: "Fictional measured set.pdf",
        source_key: "file:measured",
        storage_bucket: "athena-drawings",
        content_hash: await sha256Hex(bytes),
        sheets: ["E-100", "A-100", "S-100"],
      }),
    ]);
    await rpc("mcp_estimate_takeoff_save", [
      job,
      "Measured fixture",
      "[]",
      JSON.stringify([
        {
          line_no: 1,
          item: "Fictional fixtures",
          unit: "EA",
          qty: 999,
          basis: "measured",
          confidence: "low",
          sheet: "E-100",
          math: "Historical input",
        },
        {
          line_no: 2,
          item: "Fictional run",
          unit: "LF",
          qty: 999,
          basis: "measured",
          confidence: "low",
          sheet: "E-100",
          math: "Historical input",
        },
        {
          line_no: 3,
          item: "Fictional net slab",
          unit: "SF",
          qty: 999,
          basis: "measured",
          confidence: "low",
          sheet: "A-100",
          math: "Historical input",
        },
        {
          line_no: 4,
          item: "Fictional concrete",
          unit: "CY",
          qty: 999,
          basis: "measured",
          confidence: "low",
          sheet: "S-100",
          math: "Historical input",
        },
      ]),
    ]);
    const sb = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        try {
          const entries = Object.entries(args);
          if (!/^[a-z_]+$/.test(name) || entries.some(([k]) => !/^_[a-z_]+$/.test(k)))
            throw Error("Invalid fixture RPC");
          const data = (
            await query(
              "SELECT public." +
                name +
                "(" +
                entries.map(([k], i) => k + "=>$" + (i + 1)).join(",") +
                ") AS data",
              entries.map(([, v]) => (v && typeof v === "object" ? JSON.stringify(v) : v)),
            )
          )[0].data;
          return { data, error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
      storage: {
        from: () => ({
          download: async (p: string) => ({
            data: objects.has(p) ? new Blob([objects.get(p)!.slice()]) : null,
            error: null,
          }),
          upload: async (p: string, b: Uint8Array, options: { upsert: boolean }) => {
            expect(options.upsert).toBe(false);
            expect(objects.has(p)).toBe(false);
            objects.set(p, b.slice());
            uploads.push(p);
            return { error: null };
          },
          createSignedUrl: async (p: string) => ({
            data: { signedUrl: "https://files.example.com/" + p },
            error: null,
          }),
        }),
      },
    } as unknown as Sb;
    const j = {
      job_id: job,
      company_id: company,
      job_number: "2701",
      name: "Fictional reference job",
    } as Job;
    const net = {
      kind: "rect" as const,
      points: [
        { x: 0.1, y: 0.4 },
        { x: 0.6, y: 0.9 },
      ],
      holes: [
        [
          { x: 0.2, y: 0.5 },
          { x: 0.3, y: 0.5 },
          { x: 0.3, y: 0.7 },
          { x: 0.2, y: 0.7 },
        ],
      ],
    };
    const shapes = [
      {
        kind: "pins",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.2 },
          { x: 0.6, y: 0.2 },
        ],
      },
      {
        kind: "polyline",
        points: [
          { x: 0.1, y: 0.3 },
          { x: 0.8, y: 0.3 },
        ],
      },
      net,
      {
        ...net,
        depth: {
          value: 6,
          unit: "in",
          source_id: src.id,
          sheet: "S-100",
          detail: "Fictional section: 6 inch slab",
        },
      },
    ] as import("./geometry").Shape[];
    for (let n = 1; n <= 4; n++) {
      let state = await requiredSnapshot(sb, j);
      const sheet = n < 3 ? "E-100" : n === 3 ? "A-100" : "S-100",
        page = await loadStoredPage(sb, j, sheet, src.id);
      let cal;
      if (n > 1) {
        cal = state.calibrations.find((c) => c.source_id === src.id && c.page === page.page);
        if (!cal)
          cal = await saveCalibration(
            sb,
            j,
            page,
            {
              region: "Plan",
              bounds: { x: 0, y: 0, width: 1, height: 1 },
              reference: {
                points: [
                  { x: 0.1, y: 0.3 },
                  { x: 0.8, y: 0.3 },
                ],
                distance: 70,
                unit: "ft",
              },
              method: "estimator",
              confidence: "high",
              confirmed: true,
            },
            0,
          );
      }
      state = await requiredSnapshot(sb, j);
      const g = await saveGeometry(sb, j, page, state, {
        line_no: n,
        shape: shapes[n - 1],
        calibration_id: cal?.id,
        expected_version: 0,
      });
      expect(g.status).toBe("proposed");
      expect(g.evidence.crop_refs).toHaveLength(n < 3 ? shapes[n - 1].points.length : 6);
      await decideGeometry(
        sb,
        j,
        await requiredSnapshot(sb, j),
        { geometry_id: g.geometry_id, expected_version: g.version },
        "accept",
      );
    }
    const state = await requiredSnapshot(sb, j);
    expect(measurementStatus(state).settled).toBe(true);
    const measured = verifiedLines(state.lines, state);
    expect(measured.map((l) => Number(l.qty))).toEqual([3, 70, 1150, (1150 * 0.5) / 27]);
    const page = await loadStoredPage(sb, j, "A-100", src.id),
      first = await exportMeasuredSheet(sb, j, page, state),
      second = await exportMeasuredSheet(sb, j, page, state);
    expect(first.id).not.toBe(second.id);
    expect(uploads).toHaveLength(4);
    expect(first.png_url).toBeTruthy();
    expect((await PDFDocument.load(objects.get(uploads[0])!)).getPageCount()).toBe(2);
    expect(bytes).toEqual(before);
    expect(objects.get(path)).toEqual(before);
    const base = await PDFDocument.create();
    base.addPage([792, 612]);
    const summary = {
      structured: { pdf_base64: bytesToBase64(await base.save()), draft: false } as Record<
        string,
        unknown
      >,
    };
    await appendMeasuredSheets(sb, j, state, summary);
    const volumes = summary.structured.pdf_volumes as { path: string; url: string }[];
    expect(volumes).toHaveLength(1);
    expect((await PDFDocument.load(objects.get(volumes[0].path)!)).getPageCount()).toBe(7);
    const view = await viewEngine(sb, j, state, page);
    expect(view.content.some((c) => c.type === "image")).toBe(true);
    expect(view.content[0].type === "text" && view.content[0].text).toContain("expected_version");
    await expect(loadStoredPage(sb, j, "MISSING", src.id)).rejects.toThrow(/No older drawing/);
    const revisionDoc = await PDFDocument.load(bytes);
    revisionDoc.setTitle("Fictional revised drawing");
    const revised = await revisionDoc.save(),
      newPath = company + "/" + job + "/drawing-real-revision/source.pdf";
    objects.set(newPath, revised);
    const newer = await rpc("mcp_drawing_source_save", [
      job,
      JSON.stringify({
        path: newPath,
        filename: "Fictional measured set.pdf",
        source_key: "file:measured",
        storage_bucket: "athena-drawings",
        content_hash: await sha256Hex(revised),
        sheets: ["E-100", "A-100", "S-100"],
      }),
    ]);
    const stale = await requiredSnapshot(sb, j);
    expect(measurementStatus(stale).settled).toBe(false);
    const newPage = await loadStoredPage(sb, j, "E-100", newer.id),
      newCal = await saveCalibration(
        sb,
        j,
        newPage,
        {
          region: "Revised plan",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          reference: {
            points: [
              { x: 0.1, y: 0.3 },
              { x: 0.8, y: 0.3 },
            ],
            distance: 73.5,
            unit: "ft",
          },
          method: "estimator",
          confidence: "high",
          confirmed: true,
        },
        0,
      );
    const oldRun = stale.geometry.find(
      (g) => g.line_id === stale.lines.find((l) => l.line_no === 2)!.id,
    )!;
    const comparison = await reviseGeometry(sb, j, newPage, await requiredSnapshot(sb, j), {
      geometry_id: oldRun.geometry_id,
      expected_version: oldRun.version,
      calibration_id: newCal.id,
      confirm: true,
    });
    expect(comparison.over_two_percent).toBe(true);
    expect(comparison.proposed_quantity).toBeCloseTo(73.5);
    expect(comparison.accepted).toBe(false);
    expect(comparison.geometry.evidence.prior_source_id).toBe(src.id);
    expect(objects.get(path)).toEqual(before);
  }, 30000);
  it("denies outsiders, supers, inactive members, direct writes and history edits", async () => {
    await expect(rpc("mcp_takeoff_get", [job], outsider)).rejects.toThrow();
    await expect(rpc("mcp_takeoff_get", [job], superId)).rejects.toThrow();
    expect((await rpc("mcp_takeoff_get", [job], estimator)).available).toBe(true);
    await expect(
      save(
        { line_no: 1, shape: { kind: "pins", points: [{ x: 0.2, y: 0.2 }] } },
        "save",
        0,
        owner,
        other,
      ),
    ).rejects.toThrow();
    await expect(query("SELECT * FROM public.mcp_takeoff_geometry")).rejects.toThrow(/permission/);
    await expect(db.exec("UPDATE public.mcp_takeoff_geometry SET measured=999")).rejects.toThrow(
      /immutable/,
    );
    await expect(db.exec("DELETE FROM public.mcp_takeoff_calibrations")).rejects.toThrow(
      /immutable/,
    );
    await db.query("DELETE FROM public.test_active_members WHERE user_id=$1", [estimator]);
    await db.query("DELETE FROM public.mcp_gate_cache WHERE user_id=$1", [estimator]);
    await expect(rpc("mcp_takeoff_get", [job], estimator)).rejects.toThrow();
  });
});

describe("fresh migration ordering", () => {
  it("installs the additive engine before the later drawing migration", async () => {
    const fresh = await makeDb();
    try {
      await fresh.exec(
        readFileSync("supabase/migrations/20261022200000_athena_estimating.sql", "utf8"),
      );
      await fresh.exec(
        readFileSync("supabase/migrations/20261024005713_athena_takeoff_engine.sql", "utf8"),
      );
      await fresh.exec(
        "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
      );
      await fresh.exec(
        readFileSync("supabase/migrations/20261027130000_athena_drawing_versions.sql", "utf8"),
      );
      expect(
        (await fresh.query("SELECT to_regprocedure('public.mcp_takeoff_get(uuid)') AS installed"))
          .rows[0],
      ).toEqual({ installed: "mcp_takeoff_get(uuid)" });
    } finally {
      await fresh.close();
    }
  });
});
