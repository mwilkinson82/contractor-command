import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit test of the tool handlers with guard/jobs/visible stubbed; the role harness covers the real guard.
const state = vi.hoisted(() => ({
  scope: "full" as "full" | "super" | "contract",
  uploads: [] as string[],
  removed: [] as string[],
  rpcs: [] as [string, Record<string, unknown>][],
  rpcResult: null as unknown,
}));
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job. Your role can't do it.",
  READ_ONLY_MESSAGE:
    "Your role has a limited, read-only view of this job (no financials). Ask your owner or PM to make changes.",
  audit: async () => {},
  prefix: () => "Job 2701 · ",
  resolveJob: async () => ({
    job_id: "j1",
    job_number: "2701",
    name: "Harbor",
    company_id: "c1",
    scope: state.scope,
  }),
}));
vi.mock("./visible", () => ({ guide: (r: unknown) => r }));

function fakeSb() {
  return {
    storage: {
      from: () => ({
        upload: async (p: string) => {
          state.uploads.push(p);
          return { error: null };
        },
        createSignedUrl: async (p: string) => ({
          data: { signedUrl: `https://store/${p}?sig` },
          error: null,
        }),
        remove: async (ps: string[]) => {
          state.removed.push(...ps);
          return { error: null };
        },
      }),
    },
    rpc: async (f: string, a: Record<string, unknown>) => {
      state.rpcs.push([f, a]);
      return { data: f === "mcp_file_share_revoke" ? state.rpcResult : { id: a._id }, error: null };
    },
  };
}

import { fileShare, fileShareRevoke } from "./tools/file-tools";
type H = (
  a: Record<string, unknown>,
  c: unknown,
) => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown> }>;
const share = (a: Record<string, unknown>) =>
  (fileShare as unknown as { handler: H }).handler(a, {});
const revoke = (a: Record<string, unknown>) =>
  (fileShareRevoke as unknown as { handler: H }).handler(a, {});
const PDF64 = btoa("%PDF-1.7\nx");

beforeEach(() => {
  state.scope = "full";
  state.uploads = [];
  state.removed = [];
  state.rpcs = [];
  state.rpcResult = null;
});

describe("0.8.11 file_share tool", () => {
  it("stores under company/job, logs hash not token, returns a meetathena link and says link not attached", async () => {
    const r = await share({
      job_number: "2701",
      kind: "sov",
      filename: "2701 SOV.pdf",
      content_base64: PDF64,
    });
    const link = r.structuredContent.link as string;
    expect(link).toMatch(/^https:\/\/app\.meetathena\.io\/f\/[A-Za-z0-9_-]{43}$/);
    expect(state.uploads[0]).toMatch(/^c1\/j1\/[0-9a-f-]{36}\/2701 SOV\.pdf$/);
    const [fn, a] = state.rpcs[0];
    expect(fn).toBe("mcp_file_share_create");
    expect(a._token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).not.toContain(link.split("/f/")[1]);
    expect(r.structuredContent.attached).toBe(false);
    expect(r.content[0].text.split("\n")[0]).toMatch(/^Put this link in the email body/);
    expect(r.content[0].text).toContain(`Link: ${link}`);
    expect(r.content[0].text).not.toMatch(/supabase|lovable|store\//i);
  });
  it("super may share a schedule but not an SOV; contract scope nothing", async () => {
    state.scope = "super";
    await expect(
      share({ job_number: "2701", kind: "schedule", filename: "cpm.pdf", content_base64: PDF64 }),
    ).resolves.toBeTruthy();
    await expect(
      share({ job_number: "2701", kind: "sov", filename: "sov.pdf", content_base64: PDF64 }),
    ).rejects.toThrow(/read-only/);
    state.scope = "contract";
    await expect(
      share({ job_number: "2701", kind: "schedule", filename: "cpm.pdf", content_base64: PDF64 }),
    ).rejects.toThrow(/full access/);
  });
  it("refuses a fake pdf and non-OpenAI file urls without storing anything", async () => {
    await expect(
      share({ job_number: "2701", kind: "sov", filename: "x.pdf", content_base64: btoa("<html>") }),
    ).rejects.toThrow(/isn't a real .pdf/);
    await expect(
      share({
        job_number: "2701",
        kind: "sov",
        filename: "x.pdf",
        file: { download_url: "https://evil.com/x", file_id: "f" },
      }),
    ).rejects.toThrow(/can't read that file link/);
    await expect(share({ job_number: "2701", kind: "sov", filename: "x.pdf" })).rejects.toThrow(
      /content_base64/,
    );
    expect(state.uploads).toEqual([]);
  });
  it("revoke hashes the token, deletes the object, and refuses unknown links", async () => {
    state.rpcResult = { id: "s1", path: "c1/j1/s1/a.pdf", filename: "a.pdf" };
    const t = "A".repeat(43);
    const r = await revoke({ job_number: "2701", link: `https://app.meetathena.io/f/${t}` });
    expect(state.rpcs[0][1]._token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.removed).toEqual(["c1/j1/s1/a.pdf"]);
    expect(r.content[0].text).toMatch(/Link turned off: a\.pdf/);
    state.rpcResult = null;
    await expect(
      revoke({ job_number: "2701", link: `https://app.meetathena.io/f/${t}` }),
    ).rejects.toThrow(/No file link/);
    await expect(revoke({ job_number: "2701", link: "https://example.com" })).rejects.toThrow(
      /isn't an Athena file link/,
    );
  });
});
