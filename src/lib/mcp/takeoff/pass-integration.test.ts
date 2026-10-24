import { describe, it, expect, vi } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import type { Sb } from "../guard";
import { sha256Hex } from "../file-share";
import { renderPlanReference, renderTile } from "./pdf";
import { inspectSheet, sheetSpace } from "./pdf";
import {
  proposeTakeoffBatch,
  proposeTakeoffStep,
  saveCountArea,
  saveCountAreas,
  partitionShape,
} from "./pass";
import type { StoredPage } from "./service";
import type { EngineSnapshot } from "./state";
import type { VisionAnswer, VisionRead } from "./vision";
import { HostDrawingReadRequired, hostDrawingReader } from "./vision";
import { markTargetTile } from "./scope";
import { verifyVisionAnswer } from "./vision";
import { calibrate, measure } from "./geometry";

async function fixture(size = 144, inkX = 32) {
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([size, size]);
  pdfPage.drawRectangle({ x: inkX, y: 68, width: 8, height: 8, color: rgb(0, 0, 0) });
  const bytes = await doc.save(),
    hash = await sha256Hex(bytes);
  const source = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    filename: "qa.pdf",
    path: "private/qa.pdf",
    source_key: "fixture",
    source_url: null,
    sheets: ["E-100"],
    version: 1,
    created_at: "2026-10-24T00:00:00Z",
    content_hash: hash,
  };
  const inspection = await inspectSheet(bytes, 0);
  const page: StoredPage = {
    bytes,
    source,
    sheet: "E-100",
    page: 1,
    inspection,
    space: sheetSpace(source, 1, inspection),
  };
  const state: EngineSnapshot = {
    available: true,
    takeoff_version: 1,
    lines: [
      {
        id: "line-1",
        takeoff_id: "takeoff-1",
        line_no: 1,
        item: "Fictional square fixtures",
        sheet: "E-100",
        qty: 999,
        unit: "EA",
        measure_type: "count",
        basis: "measured",
        math: "Historical typed quantity",
        confidence: "low",
        inputs: [],
        material: null,
        range_text: null,
        detail: null,
        spec_section: null,
        markup_ref: null,
        location_text: null,
        missing_input: null,
        exclusion: null,
        checklist_key: null,
        element: null,
        trade: null,
        note: null,
      },
    ],
    geometry: [],
    calibrations: [],
    passes: [
      {
        id: "scope-checkpoint",
        source_id: source.id,
        page: 1,
        created_at: "2026-10-24T00:00:00Z",
        geometry_revs: [],
        pass_summary: {
          pass_id: "11111111-1111-4111-8111-111111111111",
          line_no: 1,
          takeoff_version: 1,
          source_hash: hash,
          calibration_id: null,
          count_area: {
            name: "Fictional plan",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            confirmed: true,
          },
          order: inspection.tiles.map((t) => t.index),
          cursor: 0,
          next_cursor: 0,
          complete: false,
        },
      },
    ],
  };
  const rpc = vi.fn(
    async (_name: string, _args: { _job: string; _record: { proposals: unknown[] } }) => ({
      data: { ok: true },
      error: null,
    }),
  );
  const sb = { rpc } as unknown as Sb;
  const job = {
    job_id: "qa-job",
    job_number: "QA",
    company_id: "qa-company",
    name: "Fictional QA",
  };
  return { bytes, hash, page, state, rpc, sb, job };
}

describe("single-line sheet binding", () => {
  it("refuses a line assigned to another sheet before rendering, reading or checkpointing", async () => {
    const f = await fixture();
    f.state.lines[0].sheet = "S-102";
    const read = vi.fn();
    await expect(
      proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1 }, read),
    ).rejects.toThrow("assigned to S-102");
    expect(f.rpc).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("actual PDF tile to resumable proposal pipeline", () => {
  it("counts an identical split-boundary pin only once without merging nearby distinct locations", async () => {
    const f = await fixture(144, 68);
    const read = (otherX: number) =>
      hostDrawingReader({
        parts: [
          {
            part: 0,
            findings: [
              {
                kind: "pins",
                points: [{ x: 1000, y: 975 }],
                confidence: 0.6,
                evidence: "Pin at shared part edge",
              },
            ],
            uncertainties: [],
          },
          {
            part: 1,
            findings: [
              {
                kind: "pins",
                points: [{ x: otherX, y: 975 }],
                confidence: 0.6,
                evidence: "Pin from adjacent part",
              },
            ],
            uncertainties: [],
          },
          { part: 2, findings: [], uncertainties: [] },
          { part: 3, findings: [], uncertainties: [] },
        ],
      });
    await proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1 }, read(0));
    expect(f.rpc.mock.calls.at(-1)![1]._record.proposals).toHaveLength(1);
    await proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1 }, read(25));
    expect(f.rpc.mock.calls.at(-1)![1]._record.proposals).toHaveLength(2);
  });
  it("stores an ink-backed 0.6-confidence finding as a proposal with its original confidence and computed quantity", async () => {
    const f = await fixture();
    const pending = await proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1 }).catch(
      (e) => e,
    );
    f.state.passes.unshift({
      id: "prepared",
      source_id: f.page.source.id,
      page: 1,
      created_at: "2026-10-24",
      geometry_revs: [],
      pass_summary: pending.checkpoint,
    });
    const result = await proposeTakeoffStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      { line_no: 1, pass_id: pending.checkpoint.pass_id, cursor: 0 },
      hostDrawingReader({
        findings: [
          {
            kind: "pins",
            points: [{ x: 250, y: 500 }],
            confidence: 0.6,
            evidence: "Visible square; interpretation needs estimator review",
          },
        ],
        uncertainties: ["Confirm this symbol's identity"],
      }),
    );
    expect(result.verification_rejections).toBe(0);
    const record = f.rpc.mock.calls.at(-1)![1]._record.proposals[0] as {
      evidence: { confidence: number; measurement: { value: number }; verification: string };
    };
    expect(record.evidence.confidence).toBe(0.6);
    expect(record.evidence.measurement.value).toBe(1);
    expect(record.evidence.verification).toBe("raster-ink-and-topology");
    expect(record).not.toHaveProperty("status", "accepted");
    expect(f.rpc.mock.calls.every(([name]) => name === "mcp_takeoff_pass_save")).toBe(true);
  });
  it("prepares the target without advancing, then verifies host observations and advances exactly once", async () => {
    const f = await fixture();
    const pending = await proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1 }).catch(
      (e) => e,
    );
    expect(pending).toBeInstanceOf(HostDrawingReadRequired);
    expect(pending.checkpoint.next_cursor).toBe(0);
    expect(pending.checkpoint.complete).toBe(false);
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc.mock.calls[0][1]._record.proposals).toEqual([]);
    f.state.passes.unshift({
      id: "prepared",
      source_id: f.page.source.id,
      page: 1,
      created_at: "2026-10-24",
      geometry_revs: [],
      pass_summary: pending.checkpoint,
    });
    const result = await proposeTakeoffStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      { line_no: 1, pass_id: pending.checkpoint.pass_id, cursor: 0 },
      hostDrawingReader({ findings: [], uncertainties: ["Target inspected; no matching fixture"] }),
    );
    expect(result.next_cursor).toBe(1);
    expect(result.complete).toBe(true);
    expect(f.rpc.mock.calls.at(-1)![1]._record.proposals).toEqual([]);
  });

  it("measures a real PDF run across exact tile edges once without shifting the supplied endpoints", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([720, 144]).drawLine({
      start: { x: 72, y: 72 },
      end: { x: 684, y: 72 },
      thickness: 2,
      color: rgb(0, 0, 0),
    });
    const bytes = await doc.save();
    const hash = await sha256Hex(bytes),
      inspection = await inspectSheet(bytes, 0);
    const f = await fixture();
    const source = { ...f.page.source, content_hash: hash };
    const space = sheetSpace(source, 1, inspection);
    const calibration = calibrate(space, {
      region: "Fictional full plan",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      version: 1,
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
    let total = 0,
      edgeEndpoints = 0;
    for (const tile of inspection.tiles) {
      const raster = await renderTile(bytes, 0, tile);
      const left = Math.max(0.1 * tile.pageWidth, tile.x) - tile.x;
      const right = Math.min(0.95 * tile.pageWidth, tile.x + tile.width) - tile.x;
      const y = 0.5 * tile.pageHeight - tile.y;
      if (left >= right || y < 0 || y >= tile.height) continue;
      const point = (x: number) => ({
        column: Math.floor(x / 100),
        row: Math.floor(y / 100),
        dx: x % 100,
        dy: y % 100,
      });
      if (right === tile.width) edgeEndpoints++;
      const checked = verifyVisionAnswer({
        answer: {
          findings: [
            {
              kind: "polyline",
              points: [point(left), point(right)],
              confidence: 0.95,
              evidence: "Visible source-backed fictional wall",
            },
          ],
          uncertainties: [],
        },
        rgba: raster.rgba,
        tile,
        space,
        calibration,
        measure_type: "linear",
      });
      expect(checked.rejected).toEqual([]);
      expect(checked.accepted[0].shape.points[1].x).toBe((tile.x + right) / tile.pageWidth);
      for (const candidate of checked.accepted)
        for (const shape of partitionShape(candidate.shape, tile, inspection.tiles))
          total += measure(space, shape, calibration).value;
    }
    expect(edgeEndpoints).toBeGreaterThan(0);
    expect(total).toBeCloseTo(85, 10);
    expect(await sha256Hex(bytes)).toBe(hash);
  });
  it("reuses a completed equivalent read when an old card requests an unfinished pass", async () => {
    const f = await fixture();
    const old = f.state.passes[0];
    const completed = {
      ...old,
      id: "completed-checkpoint",
      pass_summary: {
        ...old.pass_summary,
        pass_id: "completed-pass",
        complete: true,
        next_cursor: 1,
      },
    };
    f.state.passes.unshift(completed);
    f.state.geometry.push({
      id: "revision",
      geometry_id: "geometry",
      version: 1,
      line_id: "line-1",
      source_id: f.page.source.id,
      page: 1,
      calibration_id: null,
      shape: { kind: "pins", points: [{ x: 0.25, y: 0.5 }] },
      measured: 1,
      unit: "EA",
      status: "accepted",
      source: "athena",
      reason: null,
      created_by: "qa",
      created_at: "2026-10-24T00:00:00Z",
      evidence: { pass_id: "completed-pass" },
    });
    const read = vi.fn();
    const result = await proposeTakeoffStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      {
        line_no: 1,
        pass_id: String(old.pass_summary.pass_id),
        cursor: 0,
      },
      read,
    );
    expect(result).toMatchObject({
      pass_id: "completed-pass",
      complete: true,
      reused_complete_read: true,
    });
    expect(read).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.state.geometry).toHaveLength(1);

    // A new plan boundary must never silently inherit the old read or add to it.
    old.pass_summary.count_area = {
      name: "Other plan",
      bounds: { x: 0, y: 0, width: 0.5, height: 1 },
      confirmed: true,
    };
    await expect(
      proposeTakeoffStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        {
          line_no: 1,
          pass_id: String(old.pass_summary.pass_id),
          cursor: 0,
        },
        read,
      ),
    ).rejects.toThrow(/already has geometry/);
    expect(read).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("blocks foreign geometry on an explicit checkpoint but preserves its own partial read", async () => {
    const f = await fixture(720);
    f.state.geometry.push({
      id: "revision",
      geometry_id: "geometry",
      version: 1,
      line_id: "line-1",
      source_id: f.page.source.id,
      page: 1,
      calibration_id: null,
      shape: { kind: "pins", points: [{ x: 0.25, y: 0.5 }] },
      measured: 1,
      unit: "EA",
      status: "proposed",
      source: "athena",
      reason: null,
      created_by: "qa",
      created_at: "2026-10-24T00:00:00Z",
      evidence: { pass_id: "another-pass" },
    });
    const read = vi.fn(async () => ({ findings: [], uncertainties: [] }));
    const pass_id = String(f.state.passes[0].pass_summary.pass_id);
    await expect(
      proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1, pass_id }, read),
    ).rejects.toThrow(/already has geometry/);
    expect(read).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    f.state.geometry[0].evidence.pass_id = pass_id;
    const result = await proposeTakeoffStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      { line_no: 1, pass_id },
      read,
    );
    expect(result).toMatchObject({ complete: false, next_cursor: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("saves exactly one checkpoint per request and leaves the rest for resumable card calls", async () => {
    const f = await fixture(720),
      read = vi.fn(async () => ({ findings: [], uncertainties: [] }));
    const result = await proposeTakeoffStep(f.sb, f.job, f.page, f.state, { line_no: 1 }, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ next_cursor: 1, tiles_read: 1, complete: false });
    expect(result.tiles_total).toBeGreaterThan(1);
    expect(f.rpc.mock.calls[0]).toMatchObject([
      "mcp_takeoff_pass_save",
      { _record: { proposals: [] } },
    ]);
  });
  it("requires a confirmed count area before any provider call and saves scope without quantity", async () => {
    const f = await fixture();
    f.state.passes = [];
    const read = vi.fn();
    await expect(
      proposeTakeoffBatch(f.sb, f.job, f.page, f.state, { line_no: 1 }, read),
    ).rejects.toThrow(/count area/);
    expect(read).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    const area = { name: "Fictional plan", bounds: { x: 0, y: 0, width: 0.5, height: 1 } };
    await expect(saveCountArea(f.sb, f.job, f.page, f.state, 1, area, false)).rejects.toThrow(
      /confirm/,
    );
    const summary = await saveCountArea(f.sb, f.job, f.page, f.state, 1, area, true);
    expect(summary).toMatchObject({
      cursor: 0,
      next_cursor: 0,
      complete: false,
      count_area: { ...area, confirmed: true },
    });
    expect(f.rpc.mock.calls[0]).toMatchObject([
      "mcp_takeoff_pass_save",
      { _record: { proposals: [] } },
    ]);
    expect(f.state.lines[0].qty).toBe(999);
  });
  it("confirms several displayed count lines in one call and validates the entire list before writing", async () => {
    const f = await fixture();
    f.state.passes = [];
    f.state.lines.push({ ...f.state.lines[0], id: "line-2", line_no: 2, item: "Fictional F-2" });
    const area = { name: "Confirmed foundation plan", bounds: { x: 0, y: 0, width: 1, height: 1 } };
    await expect(
      saveCountAreas(f.sb, f.job, f.page, f.state, [1, 999], area, true),
    ).rejects.toThrow("count line");
    expect(f.rpc).not.toHaveBeenCalled();
    await expect(saveCountAreas(f.sb, f.job, f.page, f.state, [1, 2], area, false)).rejects.toThrow(
      "confirm",
    );
    expect(f.rpc).not.toHaveBeenCalled();
    const passes = await saveCountAreas(f.sb, f.job, f.page, f.state, [1, 2], area, true);
    expect(passes.map((p) => p.line_no)).toEqual([1, 2]);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    for (const call of f.rpc.mock.calls) expect(call[1]._record.proposals).toEqual([]);
    f.rpc.mockClear();
    f.state.lines[1].sheet = "OTHER";
    await expect(saveCountAreas(f.sb, f.job, f.page, f.state, [1, 2], area, true)).rejects.toThrow(
      "different sheet",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("sends same-sheet context and saves only source-verified geometry, not a typed quantity", async () => {
    const f = await fixture(),
      overview = await renderPlanReference(f.bytes, 0, { x: 0, y: 0, width: 1, height: 1 });
    const read: VisionRead = async (request) => {
      expect(request.frame).toEqual({
        sheet: "E-100",
        tile_bounds: { x: 0, y: 0, width: 1, height: 1 },
        reference_bounds: { x: 0, y: 0, width: 1, height: 1 },
        region: { name: "Fictional plan", bounds: { x: 0, y: 0, width: 1, height: 1 } },
      });
      expect(request.overview).toEqual(
        markTargetTile(overview.png, f.page.inspection.tiles[0].bounds),
      );
      expect(request.png).not.toEqual(request.overview);
      return {
        findings: [
          {
            kind: "pins",
            points: [{ column: 1, row: 2, dx: 0, dy: 0 }],
            confidence: 0.95,
            evidence: "Fictional square stroke",
          },
        ],
        uncertainties: [],
      };
    };
    const pass = await proposeTakeoffBatch(f.sb, f.job, f.page, f.state, { line_no: 1 }, read);
    expect(pass.complete).toBe(true);
    expect(pass.pass_id).toBe(f.state.passes[0].pass_summary.pass_id);
    const [name, args] = f.rpc.mock.calls[0] as unknown as [
      string,
      {
        _record: {
          proposals: {
            shape: unknown;
            evidence: { measurement: { value: number }; scope_reference: unknown };
          }[];
        };
      },
    ];
    expect(name).toBe("mcp_takeoff_pass_save");
    expect(args._record.proposals).toHaveLength(1);
    expect(args._record.proposals[0].shape).toEqual({
      kind: "pins",
      points: [{ x: 0.25, y: 0.5 }],
    });
    expect(args._record.proposals[0].evidence.measurement).toMatchObject({ value: 1 });
    expect(args._record.proposals[0].evidence.scope_reference).toMatchObject({
      kind: "confirmed-plan-overview",
      sheet: "E-100",
      page: 1,
    });
    expect(await sha256Hex(f.bytes)).toBe(f.hash);
  });
  it("checkpoints a rejected blank-paper finding without saving its geometry", async () => {
    const f = await fixture();
    const answer: VisionAnswer = {
      findings: [
        {
          kind: "pins",
          points: [{ column: 3, row: 3, dx: 50, dy: 50 }],
          confidence: 0.99,
          evidence: "Fictional false finding",
        },
      ],
      uncertainties: [],
    };
    const pass = await proposeTakeoffBatch(
      f.sb,
      f.job,
      f.page,
      f.state,
      { line_no: 1 },
      async () => answer,
    );
    expect(pass.verification_rejections).toBe(1);
    expect(f.rpc.mock.calls[0]).toMatchObject([
      "mcp_takeoff_pass_save",
      { _record: { proposals: [] } },
    ]);
  });
  it("keeps the prior checkpoint untouched when the reader fails", async () => {
    const f = await fixture();
    await expect(
      proposeTakeoffBatch(f.sb, f.job, f.page, f.state, { line_no: 1 }, async () => {
        throw new Error("Fictional reader failure");
      }),
    ).rejects.toThrow("Fictional reader failure");
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
