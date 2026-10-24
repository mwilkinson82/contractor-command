import { describe, it, expect, vi } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import type { Sb } from "../guard";
import { sha256Hex } from "../file-share";
import { renderPdfiumPage } from "../pdf-renderer";
import { inspectSheet, sheetSpace } from "./pdf";
import { proposeTakeoffBatch } from "./pass";
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
    passes: [],
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
  it("sends same-sheet context and saves only source-verified geometry, not a typed quantity", async () => {
    const f = await fixture(),
      overview = await renderPdfiumPage(f.bytes, 0);
    const read: VisionRead = async (request) => {
      expect(request.frame).toEqual({
        sheet: "E-100",
        tile_bounds: { x: 0, y: 0, width: 1, height: 1 },
      });
      expect(request.overview).toEqual(
        markTargetTile(overview!, f.page.inspection.tiles[0].bounds),
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
      kind: "stored-sheet-overview",
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
