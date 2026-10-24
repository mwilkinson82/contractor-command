import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { encode } from "fast-png";
import {
  hostDrawingReader,
  HostDrawingReadRequired,
  hostObservationsSchema,
  readVisionTile,
  splitHostTile,
} from "./vision";
const png = (width = 100, height = 50) =>
  encode({
    width,
    height,
    data: new Uint8Array(width * height * 4).fill(255),
    channels: 4,
    depth: 8,
  });
const request = (measure_type = "count") => ({
  item: "Fictional fixtures",
  measure_type,
  png: png(),
  hints: [],
});
const finding = {
  kind: "pins" as const,
  points: [{ x: 500, y: 250 }],
  confidence: 0.9,
  evidence: "Visible fixture stroke",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("connected-host drawing observations without backend inference", () => {
  it("retains a reported host model without claiming it was detected or calling a provider", async () => {
    const result = await hostDrawingReader({
      findings: [],
      uncertainties: [],
      reported_model: "Member-selected model (self-reported)",
    })(request());
    expect(result.reader_model).toBe("connected-host");
    expect(result.host_reported_model).toBe("Member-selected model (self-reported)");
    const unknown = await hostDrawingReader({ findings: [], uncertainties: [] })(request());
    expect(unknown.host_reported_model).toBeUndefined();
  });
  it("splits only the pending image and maps all four parts back to its unchanged coordinate frame", async () => {
    const original = png(101, 55);
    const before = original.slice();
    const parts = splitHostTile(original);
    expect(parts.map((p) => p.frame)).toEqual([
      { x: 0, y: 0, width: 50, height: 27 },
      { x: 50, y: 0, width: 51, height: 27 },
      { x: 0, y: 27, width: 50, height: 28 },
      { x: 50, y: 27, width: 51, height: 28 },
    ]);
    expect(original).toEqual(before);
    const observations = {
      parts: [0, 1, 2, 3].map((part) => ({
        part,
        findings: part === 3 ? [{ ...finding, points: [{ x: 500, y: 500 }] }] : [],
        uncertainties: [],
      })),
    };
    const result = await hostDrawingReader(observations)({ ...request(), png: original });
    expect(result.findings[0].points[0]).toEqual({ column: 0, row: 0, dx: 75.5, dy: 41 });
    expect(
      hostObservationsSchema.safeParse({ parts: observations.parts.slice(0, 3) }).success,
    ).toBe(false);
    expect(
      hostObservationsSchema.safeParse({
        parts: [
          observations.parts[0],
          observations.parts[0],
          observations.parts[2],
          observations.parts[3],
        ],
      }).success,
    ).toBe(false);
  });
  it("prepares a host read without any network call even when the old gateway key is present", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "fictional-unused-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const image = request();
    const error = await readVisionTile(image).catch((e) => e);
    expect(error).toBeInstanceOf(HostDrawingReadRequired);
    expect(error.request).toBe(image);
    expect(fetch).not.toHaveBeenCalled();
    for (const path of ["vision.ts", "pass.ts"]) {
      const source = readFileSync(`src/lib/mcp/takeoff/${path}`, "utf8");
      expect(source).not.toMatch(
        /generateText|createLovableAiGatewayProvider|LOVABLE_API_KEY|ai\.gateway\.lovable/,
      );
    }
  });
  it("decodes a non-square target's image coordinates without inventing a quantity", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await hostDrawingReader({ findings: [finding], uncertainties: [] })(request());
    expect(result.findings[0].points).toEqual([{ column: 0, row: 0, dx: 50, dy: 12.5 }]);
    expect(result.reader_model).toBe("connected-host");
    expect(result).not.toHaveProperty("quantity");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps opening boundaries in the same target frame", async () => {
    const result = await hostDrawingReader({
      findings: [
        {
          ...finding,
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
          ],
          holes: [
            [
              { x: 100, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 200 },
            ],
          ],
        },
      ],
      uncertainties: [],
    })(request("area"));
    expect(result.findings[0].holes?.[0][0]).toEqual({ column: 0, row: 0, dx: 10, dy: 5 });
  });
  it.each([
    { x: -1, y: 10 },
    { x: 1001, y: 10 },
    { x: "500", y: 10 },
    { x: 500, y: NaN },
    { x: 500, y: 10, column: 5, row: 1, dx: 0, dy: 0 },
  ])("refuses malformed or mixed host coordinates without clamping: %j", async (point) => {
    const observations = { findings: [{ ...finding, points: [point] }], uncertainties: [] };
    expect(hostObservationsSchema.safeParse(observations).success).toBe(false);
  });
  it("refuses a typed count or unknown fields as an observation substitute", () => {
    expect(
      hostObservationsSchema.safeParse({ findings: [], uncertainties: [], quantity: 99 }).success,
    ).toBe(false);
    expect(
      hostObservationsSchema.safeParse({ findings: [{ ...finding, qty: 99 }], uncertainties: [] })
        .success,
    ).toBe(false);
  });
  it("refuses geometry of the wrong measure type", async () => {
    await expect(
      hostDrawingReader({ findings: [{ ...finding, kind: "polyline" }], uncertainties: [] })(
        request(),
      ),
    ).rejects.toThrow(/measurement type/);
  });
  it("records an explicitly inspected empty region without a substitute count", async () => {
    const result = await hostDrawingReader({
      findings: [],
      uncertainties: ["No matching symbol visible in this target"],
    })(request());
    expect(result.findings).toEqual([]);
    expect(result.uncertainties).toEqual(["No matching symbol visible in this target"]);
    expect(result).not.toHaveProperty("quantity");
  });
  it.each([new Uint8Array(), png(1025, 1)])(
    "refuses an invalid or oversized target image",
    async (image) => {
      await expect(
        hostDrawingReader({ findings: [], uncertainties: [] })({ ...request(), png: image }),
      ).rejects.toThrow(/PNG|bounded/);
    },
  );
});
