import { describe, expect, it, vi } from "vitest";
import { loadMemberSubmittalRecord } from "./submittal-member-record";
import type { SubmittalRecordPayload } from "./submittal-record-page";

const args = { _job: "job", _number: "03 30 00-001" };
const payload = {
  job_id: "job",
  read_only: false,
  current: { id: "submittal" },
} as SubmittalRecordPayload;
describe("member record authorization is independent of the freshness shortcut", () => {
  it.each(["error", "throw"])("reads the authorized record after a stamp %s", async (mode) => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn.endsWith("stamp")) {
        if (mode === "throw") throw new Error("network");
        return { data: null, error: { message: "stamp failed" } };
      }
      return { data: payload, error: null };
    });
    const result = await loadMemberSubmittalRecord(rpc, args, undefined, async (p) => p);
    expect(result.payload.read_only).toBe(false);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "mcp_submittal_record_stamp",
      "mcp_submittal_record_get",
    ]);
  });
  it("does not use a stamp error to retain a stale denied upload state", async () => {
    const previous = { stamp: "old", payload: { ...payload, read_only: true } };
    const rpc = vi.fn(async (fn: string) =>
      fn.endsWith("stamp")
        ? { data: "old", error: { message: "failed" } }
        : { data: payload, error: null },
    );
    expect(
      (await loadMemberSubmittalRecord(rpc, args, previous, async (p) => p)).payload.read_only,
    ).toBe(false);
  });
  it("preserves a real read-only role and never converts a denied or cross-job read into write access", async () => {
    const rpc = vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({
      data: { ...payload, read_only: true },
      error: null,
    }));
    expect(
      (await loadMemberSubmittalRecord(rpc, args, undefined, async (p) => p)).payload.read_only,
    ).toBe(true);
    rpc.mockResolvedValue({ data: null, error: { message: "MCP_NO_JOB" } });
    await expect(loadMemberSubmittalRecord(rpc, args, undefined, async (p) => p)).rejects.toThrow(
      "MCP_NO_JOB",
    );
    rpc.mockResolvedValue({ data: { ...payload, job_id: "another-job" }, error: null });
    await expect(loadMemberSubmittalRecord(rpc, args, undefined, async (p) => p)).rejects.toThrow(
      "does not match",
    );
  });
  it("refreshes upload permission instead of retaining a cached read-only record with an unchanged content stamp", async () => {
    const previous = { stamp: "unchanged", payload: { ...payload, read_only: true } };
    const rpc = vi.fn(async (fn: string) =>
      fn.endsWith("stamp") ? { data: "unchanged", error: null } : { data: payload, error: null },
    );
    expect(
      (await loadMemberSubmittalRecord(rpc, args, previous, async (p) => p, true)).payload
        .read_only,
    ).toBe(false);
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(["mcp_submittal_record_get"]);
  });
});
