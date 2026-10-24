import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
const fixture = vi.hoisted(() => ({
  calibrations: [] as (Record<string, unknown> & {
    source_id: string;
    page: number;
    region: string;
    version: number;
  })[],
  save: vi.fn(async (..._args: unknown[]) => ({ id: "saved", version: 1 })),
}));
vi.mock("../guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guard")>()),
  run: async (_tool: string, _ctx: unknown, _options: unknown, handler: (sb: object) => unknown) =>
    handler({}),
}));
vi.mock("../jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../jobs")>()),
  resolveJob: async () => ({ job_id: "job", job_number: "QA", company_id: "company" }),
  audit: vi.fn(),
}));
vi.mock("./service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./service")>()),
  requiredSnapshot: async () => ({ calibrations: fixture.calibrations }),
  loadStoredPage: async () => ({
    source: { id: "source" },
    page: 1,
    space: { source_id: "source", source_hash: "a".repeat(64), page: 1, width: 720, height: 360 },
    inspection: { text: "", objects: [], truncated: false },
  }),
  saveCalibration: (...args: unknown[]) => fixture.save(...args),
  viewEngine: async (
    _sb: unknown,
    _job: unknown,
    _state: unknown,
    _page: unknown,
    extra: unknown,
  ) => ({ structuredContent: extra, content: [] }),
}));
import { statedScaleCalibration } from "./calibration";
import { sheetCalibrate } from "../tools/takeoff-tools";
type CalibrationArgs = Parameters<typeof sheetCalibrate.handler>[0];
const call = (args: Partial<CalibrationArgs>) =>
  sheetCalibrate.handler(args as CalibrationArgs, {} as ToolContext);
beforeEach(() => {
  fixture.calibrations = [];
  fixture.save.mockClear();
});
describe("confirmed scale first call through the actual handler", () => {
  it("stores a confirmed true-size scale without a redundant confirmation flag or version lookup", async () => {
    await call({
      job_number: "QA",
      operation: "save",
      sheet: "S-100",
      region: "Foundation Plan",
      stated_scale: '3/16" = 1\'-0"',
      confirm_true_size: true,
    });
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(fixture.save.mock.calls[0][3]).toMatchObject({ method: "title_block", confirmed: true });
    expect(fixture.save.mock.calls[0][4]).toBe(0);
  });
  it("does not replace an existing region without its exact version", async () => {
    fixture.calibrations = [
      { source_id: "source", page: 1, region: "Foundation Plan", version: 2 },
    ];
    const result = await call({
      job_number: "QA",
      operation: "save",
      sheet: "S-100",
      region: "Foundation Plan",
      stated_scale: '3/16" = 1\'-0"',
      confirm_true_size: true,
    });
    expect(fixture.save).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain("current version");
  });
  it("checks an already confirmed scale without asking for that confirmation again", async () => {
    const cal = statedScaleCalibration(
      { source_id: "source", source_hash: "a".repeat(64), page: 1, width: 720, height: 360 },
      '1/4" = 1\'-0"',
      "Foundation Plan",
      { x: 0, y: 0, width: 1, height: 1 },
      true,
    );
    fixture.calibrations = [{ ...cal, source_id: "source", page: 1 }];
    await call({
      job_number: "QA",
      operation: "save",
      sheet: "S-100",
      region: "Foundation Plan",
      expected_version: 1,
      dimension_checks: [
        {
          label: "8'-0\"",
          distance: 8,
          unit: "ft",
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.3, y: 0.2 },
          ],
        },
        {
          label: "12'-0\"",
          distance: 12,
          unit: "ft",
          points: [
            { x: 0.1, y: 0.5 },
            { x: 0.4, y: 0.5 },
          ],
        },
      ],
    });
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(fixture.save.mock.calls[0][3]).toMatchObject({
      reference: { dimension_checks_verified: true },
      feet_per_point: cal.feet_per_point,
    });
    expect(fixture.save.mock.calls[0][4]).toBe(1);
  });
  it("requires actual confirmation before storing an ambiguous or unconfirmed scale", async () => {
    await call({
      job_number: "QA",
      operation: "save",
      sheet: "S-100",
      region: "Foundation Plan",
      stated_scale: "As Noted",
    });
    expect(fixture.save).not.toHaveBeenCalled();
    await call({
      job_number: "QA",
      operation: "save",
      sheet: "S-100",
      region: "Foundation Plan",
      stated_scale: '3/16" = 1\'-0"',
      confirm_true_size: true,
      confirm_reference: false,
    });
    expect(fixture.save).not.toHaveBeenCalled();
  });
});
