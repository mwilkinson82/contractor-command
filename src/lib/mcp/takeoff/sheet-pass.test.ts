// A sheet read: one tile for every open line, one observation set back, each line checkpointed on its own pass.
import { describe, it, expect, vi } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import type { Sb } from "../guard";
import { sha256Hex } from "../file-share";
import { inspectSheet, sheetSpace } from "./pdf";
import type { StoredPage } from "./service";
import { measurementLines, type EngineSnapshot, type EngineLine } from "./state";
import { calibrate } from "./geometry";
import {
  HostSheetReadRequired,
  measureKind,
  proposeSheetStep,
  sheetLines,
  sheetOrder,
} from "./sheet-pass";

const COUNT_PASS = "11111111-1111-4111-8111-111111111111";

function line(
  over: Partial<EngineLine> & Pick<EngineLine, "id" | "line_no" | "item" | "unit">,
): EngineLine {
  return {
    takeoff_id: "takeoff-1",
    sheet: "E-100",
    qty: null,
    measure_type: "count",
    basis: "measured",
    math: "",
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
    ...over,
  } as EngineLine;
}

async function fixture(width = 144, countOrder?: number[]) {
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([width, 144]);
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
  const space = sheetSpace(source, 1, inspection);
  const page: StoredPage = { bytes, source, sheet: "E-100", page: 1, inspection, space };
  const cal = calibrate(space, {
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
  const state: EngineSnapshot = {
    available: true,
    takeoff_version: 1,
    lines: [
      line({ id: "line-1", line_no: 1, item: "Fictional square fixtures", unit: "EA" }),
      line({
        id: "line-2",
        line_no: 2,
        item: "Fictional conduit run",
        unit: "LF",
        measure_type: "linear",
      }),
      line({
        id: "line-3",
        line_no: 3,
        item: "Fictional mobilization",
        unit: "LS",
        measure_type: "count",
      }),
      line({
        id: "line-4",
        line_no: 4,
        item: "Fictional pit concrete",
        unit: "CY",
        measure_type: "volume",
      }),
      line({ id: "line-5", line_no: 5, item: "Fictional bollards", unit: "EA" }),
      line({
        id: "line-6",
        line_no: 6,
        item: "Fictional footing on S-100",
        unit: "LF",
        sheet: "S-100",
        measure_type: "linear",
      }),
      line({
        id: "line-7",
        line_no: 7,
        item: "Fictional unassigned run",
        unit: "LF",
        sheet: undefined,
        measure_type: "linear",
      }),
    ],
    geometry: [],
    calibrations: [
      {
        ...cal,
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        source_id: source.id,
        page: 1,
        width: space.width,
        height: space.height,
        created_at: "2026-10-24T00:00:00Z",
        created_by: "estimator",
      },
    ],
    passes: [
      {
        id: "scope-checkpoint",
        source_id: source.id,
        page: 1,
        created_at: "2026-10-24T00:00:00Z",
        geometry_revs: [],
        pass_summary: {
          pass_id: COUNT_PASS,
          line_no: 1,
          takeoff_version: 1,
          source_hash: hash,
          calibration_id: null,
          count_area: {
            name: "Fictional plan",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            confirmed: true,
          },
          order: countOrder ?? inspection.tiles.map((t) => t.index),
          cursor: 0,
          next_cursor: 0,
          complete: false,
        },
      },
    ],
  };
  const rpc = vi.fn(
    async (
      _name: string,
      _args: {
        _job: string;
        _record: { pass_summary: Record<string, unknown>; proposals: unknown[] };
      },
    ) => ({ data: { ok: true }, error: null }),
  );
  const sb = { rpc } as unknown as Sb;
  const job = {
    job_id: "qa-job",
    job_number: "QA",
    company_id: "qa-company",
    name: "Fictional QA",
  };
  return { page, state, rpc, sb, job, calibration_id: state.calibrations[0].id };
}

describe("sheet read", () => {
  it("Codex original regression: does not select a dimensional line assigned to another sheet", async () => {
    const f = await fixture();
    f.state.lines[1].sheet = "S-200";
    const picked = sheetLines(f.page, f.state, { calibration_id: f.calibration_id });
    expect(picked.lines.map((l) => l.line_no)).not.toContain(2);
  });

  it("Codex original regression: new checkpoint uses the exact shared order returned to the host", async () => {
    const f = await fixture(1008);
    expect(f.page.inspection.tiles.length).toBeGreaterThan(1);
    f.state.passes[0].pass_summary.order = f.page.inspection.tiles.map((t) => t.index).reverse();
    const pending = await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e);
    expect(pending).toBeInstanceOf(HostSheetReadRequired);
    const read = (pending as HostSheetReadRequired).read;
    const created = f.rpc.mock.calls[0][1]._record.pass_summary;
    expect(created.order).toEqual(read.order);
  });

  it("Codex review: a narrow existing count read cannot truncate a new full-sheet dimensional read", async () => {
    const f = await fixture(1500, [0]);
    f.state.passes[0].pass_summary.count_area = {
      name: "Fictional first room only",
      bounds: { x: 0, y: 0, width: 0.1, height: 1 },
      confirmed: true,
    };
    const pending = await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e);
    // Safely refusing incompatible coverage is acceptable; silently declaring a wider line
    // complete after only the first room is not.
    if (!(pending instanceof HostSheetReadRequired)) {
      expect(String(pending)).toMatch(/scope|region|coverage|tile order/i);
      return;
    }
    expect(pending.read.lines.map((l) => l.line_no)).toContain(2);
    const result = await proposeSheetStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      { calibration_id: f.calibration_id },
      {
        cursor: pending.read.cursor,
        lines: pending.read.lines.map((l) => ({
          line_no: l.line_no,
          pass_id: l.pass_id!,
          findings: [],
          uncertainties: [],
        })),
      },
    );
    expect(result.lines.find((l) => l.line_no === 2)?.complete).toBe(false);
    expect(pending.read.order).toEqual(
      expect.arrayContaining(f.page.inspection.tiles.map((t) => t.index)),
    );
  });

  it("Codex review: an explicitly excluded line is not enrolled by the whole-sheet action", async () => {
    const f = await fixture();
    f.state.verdicts = [
      {
        item_kind: "line",
        line_no: 2,
        item_text: f.state.lines[1].item,
        mark: "not_relevant",
        note: "By others; excluded from our scope",
        created_at: "2026-10-24T01:00:00Z",
      },
    ] as NonNullable<EngineSnapshot["verdicts"]>;
    expect(measurementLines(f.state).find((l) => l.line_no === 2)?.status).toBe("not_drawable");
    const picked = sheetLines(f.page, f.state, { calibration_id: f.calibration_id });
    expect(picked.lines.map((l) => l.line_no)).not.toContain(2);
  });

  it("continues a wider line through every tile separately without changing the narrower checkpoint", async () => {
    const f = await fixture(1500, [0]);
    f.state.passes[0].pass_summary.count_area = {
      name: "Fictional first room only",
      bounds: { x: 0, y: 0, width: 0.1, height: 1 },
      confirmed: true,
    };
    const original = JSON.stringify(f.state.passes[0]);
    await expect(
      proposeSheetStep(f.sb, f.job, f.page, f.state, {
        calibration_id: f.calibration_id,
      }),
    ).rejects.toThrow(/line_nos: \[2\]/);
    expect(f.rpc).not.toHaveBeenCalled();
    const visited: number[] = [];
    for (let cursor = 0; cursor < f.page.inspection.tiles.length; cursor++) {
      const prepared = await proposeSheetStep(f.sb, f.job, f.page, f.state, {
        line_nos: [2],
        calibration_id: f.calibration_id,
      }).catch((e) => e);
      expect(prepared).toBeInstanceOf(HostSheetReadRequired);
      const read = (prepared as HostSheetReadRequired).read;
      visited.push(read.tile.index);
      expect(read.cursor).toBe(cursor);
      const saved = await proposeSheetStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        {
          line_nos: [2],
          calibration_id: f.calibration_id,
        },
        {
          cursor,
          lines: read.lines.map((line) => ({
            line_no: line.line_no,
            pass_id: line.pass_id!,
            findings: [],
            uncertainties: [],
          })),
        },
      );
      expect(saved.complete).toBe(cursor === f.page.inspection.tiles.length - 1);
      // Replay the actual persisted checkpoint into the next request's snapshot.
      f.state.passes.find((p) => p.pass_summary.line_no === 2)!.pass_summary =
        f.rpc.mock.calls.at(-1)![1]._record.pass_summary;
    }
    expect(new Set(visited).size).toBe(f.page.inspection.tiles.length);
    expect(JSON.stringify(f.state.passes.find((p) => p.pass_summary.line_no === 1))).toBe(original);
  });

  it("keeps a recorded non-drawable exception out of whole-sheet reads", async () => {
    const f = await fixture();
    f.state.geometry = [
      {
        id: "exception",
        geometry_id: "exception",
        version: 1,
        line_id: "line-2",
        source_id: null,
        page: null,
        calibration_id: null,
        shape: { kind: "not_drawable", exception_kind: "by_others" },
        measured: null,
        unit: "LF",
        status: "not_drawable",
        source: "estimator",
        reason: "Included by another trade",
        created_by: "estimator",
        created_at: "2026-10-24T01:00:00Z",
        evidence: {},
      },
    ];
    const picked = sheetLines(f.page, f.state, { calibration_id: f.calibration_id });
    expect(picked.lines.map((l) => l.line_no)).not.toContain(2);
    expect(picked.skipped.find((l) => l.line_no === 2)?.reason).toContain(
      "Included by another trade",
    );
  });

  it("names the lines a sheet read can carry and why the others wait", async () => {
    const f = await fixture();
    const picked = sheetLines(f.page, f.state, { calibration_id: f.calibration_id });
    expect(picked.lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(picked.lines[0]).toMatchObject({
      measure_type: "count",
      pass_id: COUNT_PASS,
      scope: { kind: "count-area" },
    });
    expect(picked.lines[1]).toMatchObject({
      measure_type: "linear",
      pass_id: null,
      scope: { kind: "calibrated-region" },
    });
    expect(picked.skipped.map((s) => [s.line_no, s.reason])).toEqual([
      [3, expect.stringMatching(/non-drawable/)],
      [4, expect.stringMatching(/cited depth/)],
      [5, expect.stringMatching(/count line's plan or room area/)],
      [6, expect.stringMatching(/assigned to sheet S-100, not E-100/)],
      [7, expect.stringMatching(/names no sheet; include it with line_nos/)],
    ]);
    // Another sheet's line never joins, even when named; an unassigned line joins only when named.
    const named = sheetLines(f.page, f.state, {
      line_nos: [6, 7],
      calibration_id: f.calibration_id,
    });
    expect(named.lines.map((l) => l.line_no)).toEqual([7]);
    expect(named.skipped.map((s) => s.line_no)).toEqual([6]);
    expect(sheetLines(f.page, f.state, {}).lines.map((l) => l.line_no)).toEqual([1]);
    expect(sheetLines(f.page, f.state, {}).skipped.find((s) => s.line_no === 2)?.reason).toMatch(
      /calibration/,
    );
    expect(measureKind("LF")).toBe("linear");
    expect(measureKind("LS")).toBeNull();
    expect(sheetOrder(f.page, picked.lines)).toEqual(f.page.inspection.tiles.map((t) => t.index));
  });

  it("prepares one tile for every open line, creating a pass only for the line that had none", async () => {
    const f = await fixture();
    const pending = await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e);
    expect(pending).toBeInstanceOf(HostSheetReadRequired);
    const read = (pending as HostSheetReadRequired).read;
    expect(read.cursor).toBe(0);
    expect(read.lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(read.lines.every((l) => typeof l.pass_id === "string")).toBe(true);
    expect(read.lines[0].pass_id).toBe(COUNT_PASS);
    expect(read.png[0]).toBe(137);
    expect(read.waiting).toEqual([]);
    // One checkpoint write: the conduit line's new pass. The count line already had one.
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc.mock.calls[0][1]._record.pass_summary.line_no).toBe(2);
    expect(f.rpc.mock.calls[0][1]._record.proposals).toEqual([]);
    // A second prepare writes nothing: both passes exist.
    f.rpc.mockClear();
    const again = await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e);
    expect(again).toBeInstanceOf(HostSheetReadRequired);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("verifies one observation set for every line and advances each pass by one tile", async () => {
    const f = await fixture();
    const read = (
      (await proposeSheetStep(f.sb, f.job, f.page, f.state, {
        calibration_id: f.calibration_id,
      }).catch((e) => e)) as HostSheetReadRequired
    ).read;
    f.rpc.mockClear();
    const result = await proposeSheetStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      { calibration_id: f.calibration_id },
      {
        cursor: 0,
        reported_model: "fixture-model",
        lines: [
          {
            line_no: 1,
            pass_id: read.lines[0].pass_id!,
            findings: [
              {
                kind: "pins",
                points: [{ x: 250, y: 500 }],
                confidence: 0.6,
                evidence: "Visible square",
              },
            ],
            uncertainties: ["Confirm this symbol's identity"],
          },
          {
            line_no: 2,
            pass_id: read.lines[1].pass_id!,
            findings: [],
            uncertainties: ["No conduit drawn on this tile"],
          },
        ],
      },
    );
    expect(result.cursor).toBe(0);
    expect(result.next_cursor).toBe(1);
    expect(result.complete).toBe(result.tiles_total === 1);
    expect(result.lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(result.lines.every((l) => l.next_cursor === 1)).toBe(true);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    const [first, second] = f.rpc.mock.calls.map((c) => c[1]._record);
    expect(first.pass_summary.line_no).toBe(1);
    expect(first.proposals).toHaveLength(1);
    expect(
      (first.proposals[0] as { evidence: { confidence: number; model_reported_by_host: string } })
        .evidence,
    ).toMatchObject({ confidence: 0.6, model_reported_by_host: "fixture-model" });
    expect(second.pass_summary.line_no).toBe(2);
    expect(second.proposals).toEqual([]);
    expect(f.rpc.mock.calls.every(([name]) => name === "mcp_takeoff_pass_save")).toBe(true);
  });

  it("refuses an observation set that skips a line, names an unknown line, or sits on the wrong cursor", async () => {
    const f = await fixture();
    const read = (
      (await proposeSheetStep(f.sb, f.job, f.page, f.state, {
        calibration_id: f.calibration_id,
      }).catch((e) => e)) as HostSheetReadRequired
    ).read;
    f.rpc.mockClear();
    const one = { line_no: 1, pass_id: read.lines[0].pass_id!, findings: [], uncertainties: [] };
    const two = { line_no: 2, pass_id: read.lines[1].pass_id!, findings: [], uncertainties: [] };
    await expect(
      proposeSheetStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        { calibration_id: f.calibration_id },
        { cursor: 0, lines: [one] },
      ),
    ).rejects.toThrow(/Missing: L2/);
    await expect(
      proposeSheetStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        { calibration_id: f.calibration_id },
        { cursor: 0, lines: [one, two, { ...one, line_no: 5 }] },
      ),
    ).rejects.toThrow(/L5 .*not part of this tile/);
    await expect(
      proposeSheetStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        { calibration_id: f.calibration_id },
        { cursor: 3, lines: [one, two] },
      ),
    ).rejects.toThrow(/checkpoint moved/);
    await expect(
      proposeSheetStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        { calibration_id: f.calibration_id },
        { cursor: 0, lines: [one, { ...two, pass_id: COUNT_PASS }] },
      ),
    ).rejects.toThrow(/different pass/);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("keeps lines in lockstep: a line that is ahead waits until the others reach its tile", async () => {
    const f = await fixture();
    f.state.passes[0].pass_summary.next_cursor = 1;
    f.state.passes[0].pass_summary.cursor = 0;
    f.state.passes[0].pass_summary.tiles_read = 1;
    const pending = (await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e)) as HostSheetReadRequired;
    expect(pending.read.cursor).toBe(0);
    expect(pending.read.lines.map((l) => l.line_no)).toEqual([2]);
    expect(pending.read.waiting).toEqual([expect.objectContaining({ line_no: 1, next_cursor: 1 })]);
  });

  it("gives a new line the shared tile order, so the tile the host saw is the tile its pass records", async () => {
    // Five tiles; the count line's existing pass reads them back to front. A new line's own
    // candidate order would start at tile 0 and disagree with the shared image.
    const f = await fixture(1500, [4, 3, 2, 1, 0]);
    expect(f.page.inspection.tiles.length).toBe(5);
    const pending = (await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e)) as HostSheetReadRequired;
    expect(pending).toBeInstanceOf(HostSheetReadRequired);
    expect(pending.read.order).toEqual([4, 3, 2, 1, 0]);
    expect(pending.read.tile.index).toBe(4);
    const created = f.rpc.mock.calls[0][1]._record.pass_summary;
    expect(created.line_no).toBe(2);
    expect(created.order).toEqual([4, 3, 2, 1, 0]);
    f.rpc.mockClear();
    const result = await proposeSheetStep(
      f.sb,
      f.job,
      f.page,
      f.state,
      { calibration_id: f.calibration_id },
      {
        cursor: 0,
        lines: pending.read.lines.map((l) => ({
          line_no: l.line_no,
          pass_id: l.pass_id!,
          findings: [],
          uncertainties: [],
        })),
      },
    );
    expect(result.next_cursor).toBe(1);
    expect(result.tiles_total).toBe(5);
    expect(f.rpc.mock.calls.map((c) => c[1]._record.pass_summary.order)).toEqual([
      [4, 3, 2, 1, 0],
      [4, 3, 2, 1, 0],
    ]);
    expect(
      f.rpc.mock.calls.every(
        (c) => (c[1]._record.pass_summary as { tiles_read: number }).tiles_read === 1,
      ),
    ).toBe(true);
  });

  it("refuses to run a line's pass against a tile that is not the one its order names", async () => {
    const f = await fixture(1500, [4, 3, 2, 1, 0]);
    const pending = (await proposeSheetStep(f.sb, f.job, f.page, f.state, {
      calibration_id: f.calibration_id,
    }).catch((e) => e)) as HostSheetReadRequired;
    // Corrupt the new line's stored order as an older build would have saved it.
    const stray = f.state.passes.find((p) => p.pass_summary.line_no === 2)!;
    stray.pass_summary.order = [0, 1, 2, 3, 4];
    await expect(
      proposeSheetStep(
        f.sb,
        f.job,
        f.page,
        f.state,
        { calibration_id: f.calibration_id },
        {
          cursor: 0,
          lines: pending.read.lines.map((l) => ({
            line_no: l.line_no,
            pass_id: l.pass_id!,
            findings: [],
            uncertainties: [],
          })),
        },
      ),
    ).rejects.toThrow(/different tile orders|different tile order|disagree/);
  });

  it("refuses a sheet read with nothing ready and says why", async () => {
    const f = await fixture();
    await expect(
      proposeSheetStep(f.sb, f.job, f.page, f.state, { line_nos: [3, 4] }),
    ).rejects.toThrow(/No line on E-100 is ready.*L3.*L4/);
  });
});
