import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  calls: [] as string[],
  deny: false,
  viewOptions: [] as unknown[],
  page: null as Record<string, unknown> | null,
  saved: [] as unknown[],
}));
vi.mock("./guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard")>()),
  run: async (
    _tool: string,
    _ctx: unknown,
    _scope: unknown,
    fn: (sb: unknown) => Promise<unknown>,
  ) => {
    fixture.calls.push("gate");
    if (fixture.deny) throw Error("denied");
    return fn({});
  },
}));
vi.mock("./jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jobs")>()),
  resolveJob: async (_sb: unknown, _job: string, _company: string, scope: string) => {
    fixture.calls.push(`scope:${scope}`);
    return { job_id: "job", company_id: "company" };
  },
}));
vi.mock("./takeoff/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./takeoff/service")>()),
  requiredSnapshot: async () => {
    fixture.calls.push("snapshot");
    return { calibrations: fixture.saved.length ? [{ source_id: "source", page: 1 }] : [] };
  },
  saveCalibration: async (_sb: unknown, _job: unknown, _page: unknown, input: unknown) => {
    fixture.calls.push("save-calibration");
    fixture.saved.push(input);
    return { id: "cal" };
  },
  loadStoredPage: async (_sb: unknown, _job: unknown, sheet: string, source: string) => {
    fixture.calls.push(`source:${source}:${sheet}`);
    return { source: { id: source, content_hash: "hash" }, sheet, ...fixture.page };
  },
  readTile: async (_sb: unknown, _job: unknown, _page: unknown, index: number) => {
    fixture.calls.push(`tile:${index}`);
    return {
      tile: { index },
      png: "data:image/png;base64,AA==",
      content: { type: "image", data: "AA==" },
    };
  },
  viewEngine: async (...args: unknown[]) => {
    fixture.viewOptions.push(args[5]);
    fixture.calls.push("full-view");
    return { content: [] };
  },
}));
import { takeoffGeometry } from "./tools/takeoff-tools";
const call = (args: Record<string, unknown>) =>
  (
    takeoffGeometry as unknown as {
      handler: (
        args: unknown,
        ctx: unknown,
      ) => Promise<{ structuredContent: { tiles: { index: number }[] } }>;
    }
  ).handler(
    {
      job_number: "QA",
      company_id: "company",
      sheet: "E1",
      source_id: "source",
      operation: "tile",
      ...args,
    },
    {},
  );
beforeEach(() => {
  fixture.calls = [];
  fixture.deny = false;
  fixture.viewOptions = [];
  fixture.page = null;
  fixture.saved = [];
});
describe("lightweight viewer tiles", () => {
  it("checks the gate, job scope and source, skips the takeoff snapshot, and avoids a full-page view", async () => {
    const result = await call({ viewer_tile_only: true, tile_indices: [2, 3, 2] });
    expect(result.structuredContent).toMatchObject({
      source_id: "source",
      source_hash: "hash",
      sheet: "E1",
      tiles: [{ index: 2 }, { index: 3 }],
    });
    expect(fixture.calls).toEqual(["gate", "scope:write", "source:source:E1", "tile:2", "tile:3"]);
  });
  it("does not read a source when the gate rejects the caller", async () => {
    fixture.deny = true;
    await expect(call({ viewer_tile_only: true, tile_indices: [0] })).rejects.toThrow("denied");
    expect(fixture.calls).toEqual(["gate"]);
  });
  it("opens a sheet for the viewer from the snapshot already read, without the model-only image", async () => {
    await call({ operation: "list", viewer_only: true });
    expect(fixture.calls).toEqual([
      "gate",
      "scope:write",
      "snapshot",
      "source:source:E1",
      "full-view",
    ]);
    expect(fixture.viewOptions).toEqual([{ modelImage: false }]);
  });
  it("keeps the annotated image when the model opens a sheet", async () => {
    await call({ operation: "list" });
    expect(fixture.viewOptions).toEqual([{ modelImage: true }]);
  });
  it("applies the printed scale when a full-size sheet opens with no scale saved", async () => {
    fixture.page = {
      page: 1,
      space: {
        source_id: "source",
        source_hash: "a".repeat(64),
        page: 1,
        width: 2592,
        height: 1728,
      },
      inspection: {
        width: 2592,
        height: 1728,
        text: 'LIGHTING PLAN SCALE: 1/4" = 1\'-0"',
        tiles: [],
        truncated: false,
        objects: [],
      },
    };
    await call({ operation: "list", viewer_only: true });
    expect(fixture.saved).toMatchObject([{ method: "title_block", confirmed: true }]);
    // It re-reads the takeoff so the viewer opens with the scale in place.
    expect(fixture.calls.filter((c) => c === "snapshot")).toHaveLength(2);
  });
  it("leaves a half-size print alone", async () => {
    fixture.page = {
      page: 1,
      space: {
        source_id: "source",
        source_hash: "a".repeat(64),
        page: 1,
        width: 1224,
        height: 792,
      },
      inspection: {
        width: 1224,
        height: 792,
        text: 'SCALE: 1/4" = 1\'-0"',
        tiles: [],
        truncated: false,
        objects: [],
      },
    };
    await call({ operation: "list", viewer_only: true });
    expect(fixture.saved).toEqual([]);
  });
});
