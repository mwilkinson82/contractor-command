import { describe, expect, it, vi } from "vitest";
import {
  DailyCaptureSaveError,
  readDailyIndex,
  reviewDailyCapture,
  saveDailyCapture,
  validateDailyCapture,
} from "./daily-report-workspace";
import type { DailySections } from "./mcp/superintendent";
import type { ProductionClient } from "./production-report";
const draft: DailySections = {
  weather: "Clear",
  manpower: "Crew 2, 8 hours each",
  subs_on_site: "None",
  deliveries: "None",
  issues: "None",
  delays: "None",
  safety: "No incidents",
  work: [
    {
      work: "Conduit",
      sov_item: "26.04",
      activity_id: "E090",
      qty: 20,
      unit: "LF",
      crew: 2,
      hours: 8,
      pct_complete: null,
    },
  ],
};
describe("daily capture workflow", () => {
  it("requires explicit confirmation and complete valid sections before any RPC", async () => {
    const rpc = vi.fn();
    const client = { rpc } as unknown as ProductionClient;
    await expect(saveDailyCapture(client, "job", "2026-10-30", draft, false)).rejects.toThrow(
      "confirm",
    );
    expect(() => validateDailyCapture("2026-02-30", draft)).toThrow("valid report date");
    expect(() => validateDailyCapture("2026-10-30", { ...draft, safety: "" })).toThrow("safety");
    expect(() =>
      validateDailyCapture("2026-10-30", { ...draft, work: [{ ...draft.work[0], crew: 0 }] }),
    ).toThrow("positive");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses only create-only RPC, bound to the complete reviewed draft/date/job", async () => {
    const review = reviewDailyCapture("job", "2026-10-30", draft);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        saved: true,
        id: "daily",
        creation_only: true,
        request_id: review.requestId,
        replayed: false,
      },
      error: null,
    });
    await saveDailyCapture(
      { rpc } as unknown as ProductionClient,
      "job",
      "2026-10-30",
      draft,
      true,
      review,
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "mcp_daily_report_create",
      expect.objectContaining({
        _job: "job",
        _date: "2026-10-30",
        _confirmed: true,
        _request: review.requestId,
        _reviewed_at: review.reviewedAt,
        _lines: draft.work,
      }),
    );
  });
  it.each(["date", "draft", "job"])(
    "refuses stale confirmation after %s changes before any RPC",
    async (changed) => {
      const rpc = vi.fn(),
        review = reviewDailyCapture("job", "2026-10-30", draft);
      await expect(
        saveDailyCapture(
          { rpc } as unknown as ProductionClient,
          changed === "job" ? "other" : "job",
          changed === "date" ? "2026-10-29" : "2026-10-30",
          changed === "draft" ? { ...draft, weather: "Rain" } : draft,
          true,
          review,
        ),
      ).rejects.toThrow(/changed after review/);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("manual retry reuses exactly the same request/key and never invokes upsert", async () => {
    const review = reviewDailyCapture("job", "2026-10-30", draft);
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue({
        data: {
          saved: true,
          id: "daily",
          creation_only: true,
          request_id: review.requestId,
          replayed: true,
        },
        error: null,
      });
    const client = { rpc } as unknown as ProductionClient;
    await expect(
      saveDailyCapture(client, "job", "2026-10-30", draft, true, review),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(await saveDailyCapture(client, "job", "2026-10-30", draft, true, review)).toMatchObject({
      replayed: true,
    });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls.every((c) => c[0] === "mcp_daily_report_create")).toBe(true);
  });
  it.each([
    ["PGRST202", "missing", "unavailable"],
    ["42501", "permission denied", "access"],
    ["P0001", "MCP_DAILY_EXISTS:already saved", "conflict"],
    ["P0001", "MCP_DAILY_STALE:expired", "stale"],
  ])("fails clearly for %s/%s without retries/fallback", async (code, message, kind) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message } });
    const review = reviewDailyCapture("job", "2026-10-30", draft);
    await expect(
      saveDailyCapture(
        { rpc } as unknown as ProductionClient,
        "job",
        "2026-10-30",
        draft,
        true,
        review,
      ),
    ).rejects.toMatchObject({ kind });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("cancelling review invokes no save and prior confirmations cannot be reused after editing", async () => {
    const review = reviewDailyCapture("job", "2026-10-30", draft),
      rpc = vi.fn();
    await expect(
      saveDailyCapture(
        { rpc } as unknown as ProductionClient,
        "job",
        "2026-10-30",
        draft,
        false,
        review,
      ),
    ).rejects.toBeInstanceOf(DailyCaptureSaveError);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not read date index after rejected membership/scope", async () => {
    const from = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(
      readDailyIndex(
        { rpc, from } as unknown as ProductionClient,
        "73000000-0000-4000-8000-000000000011",
      ),
    ).rejects.toThrow("unavailable");
    expect(from).not.toHaveBeenCalled();
  });
});
