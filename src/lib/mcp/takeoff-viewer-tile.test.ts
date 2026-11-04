import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  calls: [] as string[],
  deny: false,
  viewOptions: [] as unknown[],
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
    return {};
  },
  loadStoredPage: async (_sb: unknown, _job: unknown, sheet: string, source: string) => {
    fixture.calls.push(`source:${source}:${sheet}`);
    return { source: { id: source, content_hash: "hash" }, sheet };
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
});
