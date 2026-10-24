import { inspectSheet, renderTile } from "../../src/lib/mcp/takeoff/pdf";
import { measure, calibrate } from "../../src/lib/mcp/takeoff/geometry";
import { bytesToBase64 } from "../../src/lib/mcp/estimating-sheet";
export default {
  async fetch(request: Request) {
    try {
      const bytes = new Uint8Array(await request.arrayBuffer()),
        page = Number(new URL(request.url).searchParams.get("page") ?? 0),
        start = Date.now(),
        inspection = await inspectSheet(bytes, page),
        tile = await renderTile(bytes, page, inspection.tiles[0]);
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
      return Response.json({
        width: inspection.width,
        height: inspection.height,
        tiles: inspection.tiles.length,
        textLength: inspection.text.length,
        objects: inspection.objects.length,
        truncated: inspection.truncated,
        tile: { width: tile.tile.width, height: tile.tile.height, rawBytes: tile.rgba.length },
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
