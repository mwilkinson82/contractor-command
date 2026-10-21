import { describe, expect, it, vi } from "vitest";
import { openShare } from "./file-share-route.server";
import { newToken, tokenHash } from "./mcp/file-share";

const row = { filename: "2701 Schedule.pdf", mime_type: "application/pdf", size_bytes: 9, signed_url: "https://store.example/obj?token=s" };
const okFetch = (async () => new Response("%PDF-1.7", { status: 200 })) as unknown as typeof fetch;

describe("0.8.11 public /f/<token> route", () => {
  it("bad-shaped token: 404 page, no lookup", async () => {
    const resolve = vi.fn();
    const r = await openShare("../../etc", "GET", resolve, okFetch);
    expect(r.status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
    expect(await r.text()).toMatch(/expired or was turned off/);
  });
  it("expired, revoked or unknown: 410 page", async () => {
    const r = await openShare(newToken(), "GET", async () => null, okFetch);
    expect(r.status).toBe(410);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
  });
  it("live link: looks up by hash only, streams the file as a download, counts GET not HEAD", async () => {
    const t = newToken();
    const seen: [string, boolean][] = [];
    const resolve = async (h: string, c: boolean) => { seen.push([h, c]); return row; };
    const fetchSpy = vi.fn(okFetch);
    const r = await openShare(t, "GET", resolve, fetchSpy as unknown as typeof fetch);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("%PDF-1.7");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="2701 Schedule.pdf"/);
    expect(seen[0]).toEqual([await tokenHash(t), true]);
    expect(fetchSpy).toHaveBeenCalledWith(row.signed_url, { redirect: "error" });
    const h = await openShare(t, "HEAD", resolve, fetchSpy as unknown as typeof fetch);
    expect(h.status).toBe(200);
    expect(seen[1][1]).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("never exposes the storage url", async () => {
    const r = await openShare(newToken(), "GET", async () => row, okFetch);
    expect(JSON.stringify([...r.headers])).not.toContain("store.example");
  });
  it("lookup failure: 503, no file", async () => {
    const r = await openShare(newToken(), "GET", async () => { throw new Error("x"); }, okFetch);
    expect(r.status).toBe(503);
  });
});
