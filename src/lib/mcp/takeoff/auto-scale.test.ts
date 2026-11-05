import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({ inputs: [] as unknown[], fail: false }));
vi.mock("./service", () => ({
  saveCalibration: async (_sb: unknown, _job: unknown, _page: unknown, input: unknown) => {
    if (saved.fail) throw Error("Another open saved it first.");
    saved.inputs.push(input);
    return { id: "cal" };
  },
}));
vi.mock("../jobs", () => ({ audit: async () => undefined }));
import { applyPlainScale } from "./auto-scale";
import type { StoredPage } from "./service";

const page = (width: number, height: number) =>
  ({
    source: { id: "source" },
    page: 1,
    space: { source_id: "source", source_hash: "a".repeat(64), page: 1, width, height },
    inspection: {
      width,
      height,
      text: 'E1 LIGHTING PLAN SCALE: 1/4" = 1\'-0"',
      tiles: [],
      truncated: false,
      objects: [],
    },
  }) as unknown as StoredPage;
const job = { job_id: "job", company_id: "company" } as never;
beforeEach(() => {
  saved.inputs = [];
  saved.fail = false;
});
describe("a sheet opened from chat or the workspace takes its printed scale", () => {
  it("saves the title block's scale on a full-size sheet with no scale yet", async () => {
    expect(await applyPlainScale({} as never, job, { calibrations: [] }, page(2592, 1728))).toBe(
      true,
    );
    expect(saved.inputs).toMatchObject([{ method: "title_block", confirmed: true }]);
  });
  it("leaves a sheet alone when it already has a scale, isn't full size, or none was opened", async () => {
    const scaled = { calibrations: [{ source_id: "source", page: 1 }] };
    expect(await applyPlainScale({} as never, job, scaled, page(2592, 1728))).toBe(false);
    expect(await applyPlainScale({} as never, job, {}, page(1224, 792))).toBe(false);
    expect(await applyPlainScale({} as never, job, {}, undefined)).toBe(false);
    expect(saved.inputs).toEqual([]);
  });
  it("still opens the sheet when the save is refused", async () => {
    saved.fail = true;
    expect(await applyPlainScale({} as never, job, {}, page(2592, 1728))).toBe(false);
  });
});
