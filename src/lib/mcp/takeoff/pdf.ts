import { encode } from "fast-png";

import type { Bounds, Point, SheetSpace } from "./geometry";

export const TAKEOFF_DPI = 200;
export const TILE_EDGE = 1024;
export const TILE_OVERLAP = 128;
export type Tile = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  bounds: Bounds;
};
export type VectorObject = {
  kind: "text" | "path";
  bounds: Bounds;
  text?: string;
  points?: Point[];
  signature?: string;
};
export type SheetInspection = {
  width: number;
  height: number;
  text: string;
  objects: VectorObject[];
  tiles: Tile[];
  truncated: boolean;
};
// The native methods are exported by the pinned @hyzyla/pdfium 3.0.0 WASM.
// Low-level clipping avoids allocating a 7,200×4,800 bitmap in a Worker.
type Native = {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
  [name: `_${string}`]: (...args: number[]) => number;
};
type NativePage = { module: Native; pageIdx: number };
export function tileGrid(widthPoints: number, heightPoints: number, dpi = TAKEOFF_DPI): Tile[] {
  if (
    ![widthPoints, heightPoints, dpi].every((n) => Number.isFinite(n) && n > 0) ||
    dpi > TAKEOFF_DPI
  )
    throw new Error("Invalid takeoff render dimensions.");
  const w = Math.ceil((widthPoints * dpi) / 72),
    h = Math.ceil((heightPoints * dpi) / 72);
  if (w > 40000 || h > 40000)
    throw new Error(
      "This page needs a smaller render region; its physical size exceeds the tile limit.",
    );
  const offsets = (length: number) => {
    const out = [0];
    while (out[out.length - 1] + TILE_EDGE < length)
      out.push(Math.min(out[out.length - 1] + TILE_EDGE - TILE_OVERLAP, length - TILE_EDGE));
    return out;
  };
  const out: Tile[] = [];
  for (const y of offsets(h))
    for (const x of offsets(w)) {
      const width = Math.min(TILE_EDGE, w - x),
        height = Math.min(TILE_EDGE, h - y);
      out.push({
        index: out.length,
        x,
        y,
        width,
        height,
        pageWidth: w,
        pageHeight: h,
        bounds: { x: x / w, y: y / h, width: width / w, height: height / h },
      });
    }
  return out;
}

export async function inspectSheet(bytes: Uint8Array, pageIndex: number): Promise<SheetInspection> {
  const { withPdfiumPage } = await import("../pdf-renderer");
  return withPdfiumPage(bytes, pageIndex, (page) => {
    const { originalWidth: width, originalHeight: height } = page.getOriginalSize();
    const native = page as unknown as NativePage,
      m = native.module,
      objects: VectorObject[] = [];
    const scratch = m.wasmExports.malloc(32);
    let truncated = false,
      visited = 0;
    try {
      const f32 = (offset: number) =>
        new DataView(m.HEAPU8.buffer).getFloat32(scratch + offset, true);
      const device = (x: number, y: number): Point => {
        if (
          !m._FPDF_PageToDevice(
            native.pageIdx,
            0,
            0,
            Math.round(width * 1000),
            Math.round(height * 1000),
            0,
            x,
            y,
            scratch + 24,
            scratch + 28,
          )
        )
          throw new Error("PDF coordinates could not be converted.");
        const view = new DataView(m.HEAPU8.buffer);
        return {
          x: view.getInt32(scratch + 24, true) / Math.round(width * 1000),
          y: view.getInt32(scratch + 28, true) / Math.round(height * 1000),
        };
      };
      const textPage = m._FPDFText_LoadPage(native.pageIdx);
      try {
        const identity = [1, 0, 0, 1, 0, 0];
        const transform = (p: Point, m: number[]): Point => ({
          x: m[0] * p.x + m[2] * p.y + m[4],
          y: m[1] * p.x + m[3] * p.y + m[5],
        });
        const compose = (a: number[], b: number[]) => [
          a[0] * b[0] + a[2] * b[1],
          a[1] * b[0] + a[3] * b[1],
          a[0] * b[2] + a[2] * b[3],
          a[1] * b[2] + a[3] * b[3],
          a[0] * b[4] + a[2] * b[5] + a[4],
          a[1] * b[4] + a[3] * b[5] + a[5],
        ];
        const walk = (obj: number, level: number, parent = identity) => {
          if (++visited > 25000 || level > 12) {
            truncated = true;
            return;
          }
          const kind = m._FPDFPageObj_GetType(obj);
          if (kind === 5) {
            if (!m._FPDFPageObj_GetMatrix(obj, scratch)) {
              truncated = true;
              return;
            }
            const matrix = Array.from({ length: 6 }, (_, i) => f32(i * 4)),
              combined = compose(parent, matrix);
            const count = m._FPDFFormObj_CountObjects(obj);
            for (let i = 0; i < count && visited < 25000; i++)
              walk(m._FPDFFormObj_GetObject(obj, i), level + 1, combined);
            return;
          }
          if (
            (kind !== 1 && kind !== 2) ||
            !m._FPDFPageObj_GetBounds(obj, scratch, scratch + 4, scratch + 8, scratch + 12)
          )
            return;
          const l = f32(0),
            bottom = f32(4),
            r = f32(8),
            top = f32(12);
          const corners = [
            { x: l, y: bottom },
            { x: l, y: top },
            { x: r, y: bottom },
            { x: r, y: top },
          ]
            .map((p) => transform(p, parent))
            .map((p) => device(p.x, p.y));
          const minX = Math.min(...corners.map((p) => p.x)),
            maxX = Math.max(...corners.map((p) => p.x)),
            minY = Math.min(...corners.map((p) => p.y)),
            maxY = Math.max(...corners.map((p) => p.y));
          const box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          if (kind === 1) {
            const length = m._FPDFTextObj_GetText(obj, textPage, 0, 0);
            if (length > 0 && length < 65536) {
              const buf = m.wasmExports.malloc(length);
              try {
                m._FPDFTextObj_GetText(obj, textPage, buf, length);
                const text = new TextDecoder("utf-16le")
                  .decode(m.HEAPU8.slice(buf, buf + length))
                  .replace(/\0/g, "");
                objects.push({ kind: "text", bounds: box, text });
              } finally {
                m.wasmExports.free(buf);
              }
            }
          } else {
            const count = m._FPDFPath_CountSegments(obj),
              points: Point[] = [];
            if (count < 2 || count > 1000 || !m._FPDFPageObj_GetMatrix(obj, scratch)) return;
            const matrix = Array.from({ length: 6 }, (_, i) => f32(i * 4));
            for (let i = 0; i < count; i++) {
              const segment = m._FPDFPath_GetPathSegment(obj, i);
              if (!m._FPDFPathSegment_GetPoint(segment, scratch, scratch + 4)) continue;
              const x = f32(0),
                y = f32(4);
              const p = transform(transform({ x, y }, matrix), parent);
              points.push(device(p.x, p.y));
            }
            // Shape-normalized paths locate repeated symbols; this is a candidate
            // signature, never automatic semantic proof or an accepted quantity.
            const signature = points
              .map(
                (p) =>
                  `${Math.round(((p.x - box.x) / (box.width || 1)) * 100)}:${Math.round(((p.y - box.y) / (box.height || 1)) * 100)}`,
              )
              .join(";");
            objects.push({ kind: "path", bounds: box, points, signature });
          }
        };
        for (let i = 0; i < page.getObjectCount() && visited < 25000; i++)
          walk(m._FPDFPage_GetObject(native.pageIdx, i), 0);
      } finally {
        m._FPDFText_ClosePage(textPage);
      }
      if (visited >= 25000) truncated = true;
      const text = page.getText();
      if (text.length > 250000) truncated = true;
      return {
        width,
        height,
        text: text.slice(0, 250000),
        objects,
        tiles: tileGrid(width, height),
        truncated,
      };
    } finally {
      m.wasmExports.free(scratch);
    }
  });
}

export async function renderTile(
  bytes: Uint8Array,
  pageIndex: number,
  tile: Tile,
): Promise<{ png: Uint8Array; rgba: Uint8Array; tile: Tile }> {
  const { withPdfiumPage } = await import("../pdf-renderer");
  return withPdfiumPage(bytes, pageIndex, (page) => {
    const { originalWidth, originalHeight } = page.getOriginalSize();
    const expected = tileGrid(originalWidth, originalHeight)[tile.index];
    if (!expected || JSON.stringify(expected) !== JSON.stringify(tile))
      throw new Error("The requested tile does not belong to this stored page.");
    const { module: m, pageIdx } = page as unknown as NativePage;
    const bitmap = m._FPDFBitmap_CreateEx(tile.width, tile.height, 4, 0, 0);
    if (!bitmap) throw new Error("The drawing tile could not be allocated.");
    try {
      m._FPDFBitmap_FillRect(bitmap, 0, 0, tile.width, tile.height, 0xffffffff);
      m._FPDF_RenderPageBitmap(
        bitmap,
        pageIdx,
        -tile.x,
        -tile.y,
        tile.pageWidth,
        tile.pageHeight,
        0,
        1,
      );
      const ptr = m._FPDFBitmap_GetBuffer(bitmap),
        stride = m._FPDFBitmap_GetStride(bitmap);
      const rgba = new Uint8Array(tile.width * tile.height * 4);
      for (let y = 0; y < tile.height; y++)
        for (let x = 0; x < tile.width; x++) {
          const src = ptr + y * stride + x * 4,
            dst = (y * tile.width + x) * 4;
          rgba[dst] = m.HEAPU8[src + 2];
          rgba[dst + 1] = m.HEAPU8[src + 1];
          rgba[dst + 2] = m.HEAPU8[src];
          rgba[dst + 3] = 255;
        }
      return {
        tile,
        rgba,
        png: encode({ width: tile.width, height: tile.height, data: rgba, channels: 4, depth: 8 }),
      };
    } finally {
      m._FPDFBitmap_Destroy(bitmap);
    }
  });
}

export const tilePoint = (tile: Tile, local: Point): Point => ({
  x: (tile.x + local.x * tile.width) / tile.pageWidth,
  y: (tile.y + local.y * tile.height) / tile.pageHeight,
});
export function hasInk(rgba: Uint8Array, tile: Tile, p: Point, radius = 6): boolean {
  const x = Math.round(p.x * tile.pageWidth - tile.x),
    y = Math.round(p.y * tile.pageHeight - tile.y);
  if (x < 0 || y < 0 || x >= tile.width || y >= tile.height) return false;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx,
        yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= tile.width || yy >= tile.height) continue;
      const i = (yy * tile.width + xx) * 4;
      if (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2] < 230) return true;
    }
  return false;
}

/** Title-block scale is a proposal. Mixed scales, NTS or lack of an independent
 * dimension check never grant a confirmed measurement calibration. */
export function scaleProposals(
  text: string,
): { label: string; feet_per_point: number; confirmed: false }[] {
  if (/not\s+to\s+scale|\bN\.?T\.?S\.?\b/i.test(text)) return [];
  const out: { label: string; feet_per_point: number; confirmed: false }[] = [];
  const re =
    /(?:(\d+)\s+)?(?:(\d+)\s*\/\s*(\d+)|(\d*\.?\d+))\s*["″]\s*=\s*(\d+(?:\.\d+)?)\s*['′](?:\s*-\s*0\s*["″])?/g;
  for (const match of text.matchAll(re)) {
    const inches =
      Number(match[1] || 0) + (match[2] ? Number(match[2]) / Number(match[3]) : Number(match[4]));
    if (inches > 0 && Number(match[5]) > 0 && !out.some((s) => s.label === match[0]))
      out.push({
        label: match[0],
        feet_per_point: Number(match[5]) / (inches * 72),
        confirmed: false,
      });
  }
  return out;
}

export const sheetSpace = (
  source: { id: string; content_hash: string },
  page: number,
  inspection: Pick<SheetInspection, "width" | "height">,
): SheetSpace => ({
  source_id: source.id,
  source_hash: source.content_hash,
  page,
  width: inspection.width,
  height: inspection.height,
});
