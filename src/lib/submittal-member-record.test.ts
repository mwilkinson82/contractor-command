import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadMemberSubmittalRecord, MemberRecordLookupError } from "./submittal-member-record";
import type { SubmittalRecordPayload } from "./submittal-record-page";

const args = { _job: "job", _number: "03 30 00-001" };
const payload = {
  job_id: "job",
  read_only: false,
  current: { id: "submittal" },
} as SubmittalRecordPayload;
describe("member record authorization is independent of the freshness shortcut", () => {
  it("reads an owner's upload access through the real Supabase PromiseLike RPC builder", async () => {
    const fetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(String(input).includes("_stamp") ? "current" : payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createClient("https://fictional.supabase.co", "public-fixture-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    });
    const rpc = (name: string, params: Record<string, unknown>) => client.rpc(name, params);
    const result = await loadMemberSubmittalRecord(rpc, args, undefined, async (p) => p);
    expect(result.payload.read_only).toBe(false);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/rest/v1/rpc/mcp_submittal_record_stamp",
      "/rest/v1/rpc/mcp_submittal_record_get",
    ]);
  });
  it("preserves a real HTTP/RPC error while removing URLs, tokens and email from support details", async () => {
    const client = createClient("https://fictional.supabase.co", "public-fixture-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async () =>
          new Response(
            JSON.stringify({
              code: "42501",
              message:
                "permission denied for pm@example.com https://fictional.test/?token=private-token",
            }),
            { status: 403 },
          ),
      },
    });
    const failure = await loadMemberSubmittalRecord(
      (name, params) => client.rpc(name, params),
      args,
      undefined,
      async (p) => p,
      true,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MemberRecordLookupError);
    expect((failure as MemberRecordLookupError).diagnostic).toEqual({
      rpc: "mcp_submittal_record_get",
      code: "42501",
      status: 403,
      message: "permission denied for [email removed] [URL removed]",
    });
    expect(JSON.stringify((failure as MemberRecordLookupError).diagnostic)).not.toContain(
      "private-token",
    );
  });
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
