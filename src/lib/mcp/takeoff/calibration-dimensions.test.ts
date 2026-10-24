import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { sha256Hex } from "../file-share";
import { checkCalibrationDimensions, statedScaleCalibration } from "./calibration";
import { inspectSheet, sheetSpace } from "./pdf";
import { saveCalibration, type StoredPage } from "./service";
import type { Sb } from "../guard";
import type { Job } from "../jobs";

async function fixture() {
  const doc = await PDFDocument.create(),
    p = doc.addPage([720, 360]);
  p.drawLine({ start: { x: 72, y: 288 }, end: { x: 216, y: 288 }, thickness: 2 });
  p.drawLine({ start: { x: 72, y: 180 }, end: { x: 288, y: 180 }, thickness: 2 });
  const bytes = await doc.save(),
    hash = await sha256Hex(bytes);
  const source = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    content_hash: hash,
  } as StoredPage["source"];
  const inspection = await inspectSheet(bytes, 0),
    space = sheetSpace(source, 1, inspection);
  const page: StoredPage = { source, bytes, inspection, space, sheet: "S-100", page: 1 };
  const scale = statedScaleCalibration(
    space,
    '1/4" = 1\'-0"',
    "Plan",
    { x: 0, y: 0, width: 1, height: 1 },
    true,
  );
  const checks = [
    {
      label: "8'-0\"",
      distance: 8,
      unit: "ft" as const,
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.2 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
    },
    {
      label: "12'-0\"",
      distance: 12,
      unit: "ft" as const,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.4, y: 0.5 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
    },
  ];
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({
    data: { id: "saved" },
    error: null,
  }));
  return {
    page,
    scale,
    checks,
    hash,
    rpc,
    sb: { rpc } as unknown as Sb,
    job: { job_id: "job" } as Job,
  };
}
describe("dimension evidence uses the stored raster before saving", () => {
  it("preserves two checked dimension references in the actual calibration RPC and leaves source bytes unchanged", async () => {
    const f = await fixture();
    const checked = checkCalibrationDimensions(f.page.space, f.scale, f.checks);
    await saveCalibration(f.sb, f.job, f.page, checked, 0);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.rpc.mock.calls[0]).toMatchObject([
      "mcp_takeoff_calibrate",
      {
        _source: f.page.source.id,
        _page: 1,
        _record: { reference: { dimension_checks: f.checks, dimension_checks_verified: true } },
      },
    ]);
    expect(await sha256Hex(f.page.bytes)).toBe(f.hash);
  });
  it("rejects arithmetically matching dimension endpoints in blank paper before any save", async () => {
    const f = await fixture();
    f.checks[0].points = [
      { x: 0.1, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ];
    const checked = checkCalibrationDimensions(f.page.space, f.scale, f.checks);
    await expect(saveCalibration(f.sb, f.job, f.page, checked, 0)).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
