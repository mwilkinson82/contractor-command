import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readRequestLog, type RequestLogRpc } from "./request-log-read";
const job = "00000000-0000-4000-8000-000000000094";
const payload = {
  job_id: job,
  job_number: "2701",
  job_name: "Fictional Job",
  today: "2026-10-25",
  read_only: false,
  records: [],
};
describe("real SDK request log reads", () => {
  it("awaits the installed PromiseLike RPC without calling catch on the builder", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
    );
    const sb = createClient("https://fixture.supabase.co", "fictional-public-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetcher },
    });
    expect(await readRequestLog(sb.rpc.bind(sb) as unknown as RequestLogRpc, job, "rfi")).toEqual(
      payload,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("times out a stalled read and makes a later retry usable", async () => {
    vi.useFakeTimers();
    try {
      const failed = readRequestLog(() => new Promise(() => {}), job, "rfi", 100);
      const check = expect(failed).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await check;
      expect(
        await readRequestLog(() => Promise.resolve({ data: payload, error: null }), job, "rfi"),
      ).toEqual(payload);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects a response from the wrong job and exposes no raw backend error", async () => {
    await expect(
      readRequestLog(
        () => Promise.resolve({ data: { ...payload, job_id: "other" }, error: null }),
        job,
        "rfi",
      ),
    ).rejects.toThrow("could not load");
    await expect(
      readRequestLog(
        () =>
          Promise.resolve({ data: null, error: { message: "private SQL details", code: "42501" } }),
        job,
        "rfi",
      ),
    ).rejects.not.toThrow("private SQL details");
  });
});
