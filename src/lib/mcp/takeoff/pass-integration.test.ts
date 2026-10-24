import { describe, it, expect, vi } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import type { Sb } from "../guard";
import { sha256Hex } from "../file-share";
import { renderPlanReference } from "./pdf";
import { inspectSheet, sheetSpace } from "./pdf";
import { proposeTakeoffBatch, saveCountArea } from "./pass";
import type { StoredPage } from "./service";
import type { EngineSnapshot } from "./state";
import type { VisionAnswer, VisionRead } from "./vision";
import { markTargetTile } from "./scope";

async function fixture() {
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([144, 144]);
  pdfPage.drawRectangle({ x: 32, y: 68, width: 8, height: 8, color: rgb(0, 0, 0) });
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
          order: [0],
          cursor: 0,
          next_cursor: 0,
          complete: false,
        },
      },
    ],
  };
  const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
  const sb = { rpc } as unknown as Sb;
  const job = {
    job_id: "qa-job",
    job_number: "QA",
    company_id: "qa-company",
    name: "Fictional QA",
  };
  return { bytes, hash, page, state, rpc, sb, job };
}

describe("actual PDF tile to resumable proposal pipeline", () => {
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
