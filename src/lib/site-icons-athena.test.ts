import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { siteIconResponse } from "./site-icons";

const bytes = async (host: string, path: string) => {
  const res = siteIconResponse(new Request(`https://${host}${path}`))!;
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
};

function icoEntries(buf: Buffer): { size: number; png: Buffer }[] {
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const size = buf[at] === 0 ? 256 : buf[at];
    const len = buf.readUInt32LE(at + 8);
    const off = buf.readUInt32LE(at + 12);
    const png = buf.subarray(off, off + len);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    out.push({ size, png });
  }
  return out;
}

/** Opaque pixels of a small RGBA PNG, so the test can see the blue mark. */
function opaqueColors(png: Buffer): Map<string, number> {
  let o = 8;
  const parts: Buffer[] = [];
  let w = 0;
  let h = 0;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.subarray(o + 4, o + 8).toString();
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    }
    if (type === "IDAT") parts.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const bpp = 4;
  const stride = w * bpp;
  const px = Buffer.alloc(w * h * bpp);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = y * stride;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const left = x >= bpp ? px[row + x - bpp] : 0;
      const up = y > 0 ? px[row - stride + x] : 0;
      const ul = x >= bpp && y > 0 ? px[row - stride + x - bpp] : 0;
      let r = v;
      if (filter === 1) r = (v + left) & 255;
      else if (filter === 2) r = (v + up) & 255;
      else if (filter === 3) r = (v + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) r = (v + paeth(left, up, ul)) & 255;
      px[row + x] = r;
    }
  }
  const colors = new Map<string, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  return colors;
}

describe("Athena favicon is small and host-specific", () => {
  it("serves a 16 and 32 favicon.ico under 5 KB from the blue mark", async () => {
    const { res, buf } = await bytes("app.meetathena.io", "/favicon.ico");
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(buf.length).toBeLessThan(5 * 1024);
    const entries = icoEntries(buf);
    expect(entries.map((e) => e.size)).toEqual([16, 32]);
    // #2563EB, the mono-blue mark. The 16px image is antialiased, so it stays near that blue.
    const nearMark = (png: Buffer) =>
      [...opaqueColors(png).keys()].some((key) => {
        const [r, g, b] = key.split(",").map(Number);
        return Math.abs(r - 37) + Math.abs(g - 99) + Math.abs(b - 235) <= 12;
      });
    expect(opaqueColors(entries[1].png).get("37,99,235") ?? 0).toBeGreaterThan(0);
    expect(nearMark(entries[0].png)).toBe(true);
    expect(nearMark(entries[1].png)).toBe(true);
  });

  it("keeps the Hub favicon.ico, and the two hosts do not share it", async () => {
    const hub = await bytes("app.alpcontractorcircle.com", "/favicon.ico");
    const athena = await bytes("app.meetathena.io", "/favicon.ico");
    expect(hub.buf.equals(athena.buf)).toBe(false);
    expect(hub.res.headers.get("content-type")).toBe("image/x-icon");
    expect(icoEntries(hub.buf).map((e) => e.size)).toEqual([32]);
  });

  it("still serves the 64px PNG linked from the Athena document", async () => {
    const { res, buf } = await bytes("app.meetathena.io", "/brand/athena/athena-mono-blue-64.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(buf.readUInt32BE(16)).toBe(64);
    expect(buf.length).toBeLessThan(13_000);
  });
});
