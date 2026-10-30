import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), put: vi.fn(), read: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: state.rpc, storage: { from: () => ({ upload: state.put }) } }),
}));
vi.mock("./guard", () => ({
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./billing-original.server", () => ({ readBoundedFinancialStoragePath: state.read }));
import {
  assertApOriginal,
  checkedApOriginalBytes,
  storeApOriginal,
  verifyApOriginalUpload,
  readApOriginal,
  type ApOriginal,
} from "./ap-original.server";
import { sha256Hex } from "./file-share";
import type { Sb } from "./guard";
import type { ToolContext } from "@lovable.dev/mcp-js";
const bytes = new TextEncoder().encode("Invoice 1: USD 100.00");
let original: ApOriginal;
const actor = "00000000-0000-4000-8000-000000000111";
const sb = {
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor } }, error: null })) },
  rpc: vi.fn(),
} as unknown as Sb;
const ctx = { getToken: () => "synthetic-session" } as ToolContext;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-test-only");
  original = {
    id: "upload",
    company_id: "company",
    job_id: "job",
    record_id: "bill",
    version: 1,
    filename: "invoice.txt",
    mime_type: "text/plain",
    storage_path: "company/job/upload/invoice.txt",
    size_bytes: bytes.length,
    sha256: await sha256Hex(bytes),
    verified_at: null,
  };
  state.rpc.mockResolvedValue({ data: original, error: null });
  state.read.mockResolvedValue(bytes);
  state.put.mockResolvedValue({ error: null });
  vi.mocked(sb.rpc).mockResolvedValue({ data: original, error: null } as never);
});
describe("server attests exact supplier original bytes", () => {
  it("rejects wrong bill/version/path before storage reads", async () => {
    expect(() => assertApOriginal(original, "job", "another", 1)).toThrow(/bill version/);
    expect(() => assertApOriginal(original, "job", "bill", 2)).toThrow(/bill version/);
    expect(() =>
      assertApOriginal(
        { ...original, storage_path: "company/job/other/invoice.txt" },
        "job",
        "bill",
        1,
      ),
    ).toThrow(/bill version/);
    expect(state.read).not.toHaveBeenCalled();
  });
  it("uses the dedicated AP claim and never overwrites an immutable object", async () => {
    await storeApOriginal(sb, ctx, original, bytes);
    expect(state.rpc).toHaveBeenCalledWith("mcp_ap_original_upload_claim", {
      _id: "upload",
      _actor: actor,
    });
    expect(state.put).toHaveBeenCalledWith(original.storage_path, bytes, {
      contentType: "text/plain",
      upsert: false,
    });
  });
  it("reconciles a duplicate/uncertain storage response by comparing fingerprints", async () => {
    state.put.mockResolvedValue({ error: { message: "already exists" } });
    await expect(storeApOriginal(sb, ctx, original, bytes)).resolves.toBeUndefined();
    state.read.mockResolvedValue(new TextEncoder().encode("Different bytes"));
    await expect(storeApOriginal(sb, ctx, original, bytes)).rejects.toThrow(/fingerprint/);
    expect(state.put).toHaveBeenCalledTimes(2);
  });
  it("does not write when the claim or the supplied bytes disagree", async () => {
    state.rpc.mockResolvedValue({ data: { ...original, company_id: "another" }, error: null });
    await expect(storeApOriginal(sb, ctx, original, bytes)).rejects.toThrow(/bill version/);
    state.rpc.mockResolvedValue({ data: original, error: null });
    await expect(
      storeApOriginal(sb, ctx, original, new TextEncoder().encode("replacement")),
    ).rejects.toThrow(/does not match/);
    expect(state.put).not.toHaveBeenCalled();
  });
  it("rechecks membership, scoped metadata and actual bytes before server verification", async () => {
    await verifyApOriginalUpload(sb, ctx, "job", "bill", 1, "upload");
    expect(state.rpc).toHaveBeenCalledWith(
      "mcp_ap_original_verify",
      expect.objectContaining({
        _record: "bill",
        _version: 1,
        _size: bytes.length,
        _sha256: original.sha256,
        _actor: actor,
      }),
    );
    state.rpc.mockClear();
    state.read.mockResolvedValue(new TextEncoder().encode("different"));
    await expect(verifyApOriginalUpload(sb, ctx, "job", "bill", 1, "upload")).rejects.toThrow(
      /fingerprint/,
    );
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("revalidates linked originals and fails closed for a missing member token", async () => {
    const read = await readApOriginal(sb, ctx, "job", "bill", "upload");
    expect(read.bytes).toEqual(bytes);
    expect(vi.mocked(sb.rpc)).toHaveBeenCalledWith("mcp_ap_original_get", {
      _job: "job",
      _record: "bill",
      _id: "upload",
    });
    await expect(
      readApOriginal(
        sb,
        { getToken: () => null } as unknown as ToolContext,
        "job",
        "bill",
        "upload",
      ),
    ).rejects.toThrow(/Verified member/);
    state.read.mockResolvedValue(new Uint8Array([0, 1, 2]));
    await expect(checkedApOriginalBytes(original)).rejects.toThrow();
  });
});
