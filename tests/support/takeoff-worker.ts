import { inspectSheet, renderTile, renderPlanReference } from "../../src/lib/mcp/takeoff/pdf";
import { measure, calibrate } from "../../src/lib/mcp/takeoff/geometry";
import { bytesToBase64 } from "../../src/lib/mcp/estimating-sheet";
import {
  HostDrawingReadRequired,
  hostDrawingReader,
  readVisionTile,
  splitHostTile,
} from "../../src/lib/mcp/takeoff/vision";
export default {
  async fetch(request: Request) {
    try {
      const bytes = new Uint8Array(await request.arrayBuffer()),
        page = Number(new URL(request.url).searchParams.get("page") ?? 0),
        start = Date.now(),
        inspection = await inspectSheet(bytes, page),
        tile = await renderTile(bytes, page, inspection.tiles[0]),
        plan = await renderPlanReference(bytes, page, { x: 0.2, y: 0.2, width: 0.4, height: 0.4 });
      const header = new DataView(plan.png.buffer, plan.png.byteOffset, plan.png.byteLength);
      const space = {
        source_id: "fixture",
        source_hash: "a".repeat(64),
        page: page + 1,
        width: inspection.width,
        height: inspection.height,
      };
      const calibration = calibrate(space, {
        region: "Fictional reference only",
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
      const read = {
        item: "Private runtime check only",
        measure_type: "count",
        png: tile.png,
        hints: [],
      };
      const handoff = await readVisionTile(read).catch((error) => error);
      if (!(handoff instanceof HostDrawingReadRequired))
        throw new Error("Expected a member-model handoff");
      const observations = await hostDrawingReader({
        findings: [],
        uncertainties: ["Runtime check; no takeoff reading attempted"],
      })(read);
      return Response.json({
        hostHandoff: true,
        backendInference: false,
        hostFindings: observations.findings.length,
        splitParts: splitHostTile(tile.png).length,
        width: inspection.width,
        height: inspection.height,
        tiles: inspection.tiles.length,
        textLength: inspection.text.length,
        objects: inspection.objects.length,
        truncated: inspection.truncated,
        tile: { width: tile.tile.width, height: tile.tile.height, rawBytes: tile.rgba.length },
        planReference: {
          width: header.getUint32(16),
          height: header.getUint32(20),
          bounds: plan.bounds,
        },
        referenceLength: measure(
          space,
          {
            kind: "polyline",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
          calibration,
        ).value,
        png: bytesToBase64(tile.png),
        elapsedMs: Date.now() - start,
      });
    } catch (e) {
      return new Response((e as Error).message, { status: 500 });
    }
  },
};
