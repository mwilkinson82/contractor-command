import { beforeEach, describe, it, expect, vi } from "vitest";
import { cachedSource, clearSourceCache, pageCache, pageLru } from "./cache";
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

describe("authorized zoom-tile cache", () => {
  it("keeps recent tiles, evicts the oldest by count and bytes, and keys by job", async () => {
    const cached = pageLru<Uint8Array>(2, 10, (v) => v.length);
    const load = vi.fn(async () => new Uint8Array(3));
    await cached("c:j:s:h:0:1", load, 1);
    await cached("c:j:s:h:0:2", load, 2);
    await cached("c:j:s:h:0:1", load, 3);
    expect(load).toHaveBeenCalledTimes(2);
    await cached("c:j:s:h:0:3", load, 4); // evicts tile 2, the least recent
    await cached("c:j:s:h:0:1", load, 5);
    expect(load).toHaveBeenCalledTimes(3);
    await cached("c:j:s:h:0:2", load, 6);
    expect(load).toHaveBeenCalledTimes(4);
    await cached("c:other:s:h:0:1", load, 7);
    expect(load).toHaveBeenCalledTimes(5);
    const big = vi.fn(async () => new Uint8Array(11));
    await cached("big", big, 8);
    await cached("big", big, 9);
    expect(big).toHaveBeenCalledTimes(2);
    await cached("c:other:s:h:0:1", load, 60_000 + 7 + 1);
    expect(load).toHaveBeenCalledTimes(6);
  });
});

describe("zoom-tile cache under concurrent requests", () => {
  it("drops a failed load even when a second request joined it mid-flight", async () => {
    const cached = pageLru<Uint8Array>(4, 100, (v) => v.length);
    let fail!: (e: Error) => void;
    const first = cached("t", () => new Promise<Uint8Array>((_, reject) => (fail = reject)), 1);
    const joined = cached("t", async () => new Uint8Array(1), 2);
    await Promise.resolve();
    fail(Error("oom"));
    await expect(first).rejects.toThrow("oom");
    await expect(joined).rejects.toThrow("oom");
    const retry = vi.fn(async () => new Uint8Array(1));
    await cached("t", retry, 3);
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("counts the bytes of a tile that a joined request kept warm", async () => {
    const cached = pageLru<Uint8Array>(10, 5, (v) => v.length);
    let done!: (v: Uint8Array) => void;
    const first = cached("a", () => new Promise<Uint8Array>((resolve) => (done = resolve)), 1);
    void cached("a", async () => new Uint8Array(0), 2);
    await Promise.resolve();
    done(new Uint8Array(4));
    await first;
    const other = vi.fn(async () => new Uint8Array(4));
    await cached("b", other, 3); // 4 + 4 > 5 bytes: "a" is evicted
    const again = vi.fn(async () => new Uint8Array(4));
    await cached("a", again, 4);
    expect(again).toHaveBeenCalledTimes(1);
  });
});
