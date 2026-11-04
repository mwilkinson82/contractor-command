import { beforeEach, describe, it, expect, vi } from "vitest";
import { cachedSource, clearSourceCache, pageCache } from "./cache";
beforeEach(clearSourceCache);
describe("authorized immutable-byte cache bounds", () => {
  it("shares one download across concurrent reads of the exact same authorized source", async () => {
    const load = vi.fn(async () => new Uint8Array([1, 2]));
    const [a, b] = await Promise.all([
      cachedSource("company:job:source:hash", load, 100),
      cachedSource("company:job:source:hash", load, 101),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
  it("does not reuse another company, job, source revision or fingerprint", async () => {
    const load = vi.fn(async () => new Uint8Array([1]));
    for (const key of ["c:j:s:h", "other:j:s:h", "c:other:s:h", "c:j:other:h", "c:j:s:other"])
      await cachedSource(key, load, 100);
    expect(load).toHaveBeenCalledTimes(5);
  });
  it("expires, retries failed loads and never retains a source above 24 MB", async () => {
    const load = vi.fn(async () => new Uint8Array([1]));
    await cachedSource("key", load, 0);
    await cachedSource("key", load, 60001);
    expect(load).toHaveBeenCalledTimes(2);
    await expect(
      cachedSource(
        "bad",
        async () => {
          throw Error("missing");
        },
        60002,
      ),
    ).rejects.toThrow();
    await cachedSource("bad", load, 60003);
    const large = vi.fn(async () => new Uint8Array(24 * 1024 * 1024 + 1));
    await cachedSource("large", large, 70000);
    await cachedSource("large", large, 70001);
    expect(large).toHaveBeenCalledTimes(2);
  });
});

describe("authorized immutable page derivative cache", () => {
  it("shares exact page work and separates job, source hash and page", async () => {
    const cached = pageCache<Uint8Array>(32, (v) => v.length);
    const load = vi.fn(async () => new Uint8Array([1]));
    await Promise.all([cached("c:j:s:hash:0", load, 1), cached("c:j:s:hash:0", load, 2)]);
    expect(load).toHaveBeenCalledTimes(1);
    for (const key of ["other:j:s:hash:0", "c:j:s:other:0", "c:j:s:hash:1"])
      await cached(key, load, 3);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("expires, discards oversized values and retries failures", async () => {
    const cached = pageCache<Uint8Array>(1, (v) => v.length);
    const load = vi.fn(async () => new Uint8Array([1]));
    await cached("k", load, 0);
    await cached("k", load, 60001);
    expect(load).toHaveBeenCalledTimes(2);
    const large = vi.fn(async () => new Uint8Array(2));
    await cached("large", large, 1);
    await cached("large", large, 2);
    expect(large).toHaveBeenCalledTimes(2);
    await expect(
      cached(
        "bad",
        async () => {
          throw Error("bad");
        },
        1,
      ),
    ).rejects.toThrow("bad");
    await cached("bad", load, 2);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
