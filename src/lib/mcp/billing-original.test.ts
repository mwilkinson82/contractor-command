import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Sb } from "./guard";
import { sha256Hex } from "./file-share";

const mock = vi.hoisted(() => ({ signed: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.create }));
import {
  readUploadedFinancialOriginal,
  readUploadedCostReceipt,
  readVerifiedCostReceipt,
  readVerifiedFinancialOriginal,
} from "./billing-original.server";

const bytes = new TextEncoder().encode("%PDF-1.7 synthetic invoice");
const base = {
  id: "doc",
  job_id: "job",
  company_id: "company",
  filename: "file.pdf",
  mime_type: "application/pdf",
  storage_path: "company/job/doc/file.pdf",
};
const signedUrl =
  "https://example.test/storage/v1/object/sign/athena-financial-documents/company/job/doc/file.pdf?token=private";
let document: typeof base & { size_bytes: number; sha256: string };
let getUser: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
let sb: Sb;
beforeEach(async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic");
  document = { ...base, size_bytes: bytes.length, sha256: await sha256Hex(bytes) };
  getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  rpc = vi.fn(async (name: string) => ({
    data: name === "mcp_billing_upload_get" ? base : { documents: [document] },
    error: null,
  }));
  sb = { auth: { getUser }, rpc } as unknown as Sb;
  mock.create.mockReturnValue({ storage: { from: () => ({ createSignedUrl: mock.signed }) } });
  mock.signed.mockResolvedValue({ data: { signedUrl }, error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes as BodyInit)),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("server-controlled original retrieval", () => {
  it("uses only the exact scoped cost receipt RPC and verifies the returned record and fingerprint", async () => {
    rpc.mockResolvedValueOnce({ data: { ...base, record_id: "record" }, error: null });
    expect(await readUploadedCostReceipt(sb, "member-token", "job", "record", "doc")).toEqual(
      bytes,
    );
    expect(rpc).toHaveBeenCalledWith("mcp_cost_receipt_upload_get", {
      _job: "job",
      _record: "record",
      _id: "doc",
    });
    rpc.mockResolvedValueOnce({ data: { ...document, record_id: "record" }, error: null });
    expect(
      (await readVerifiedCostReceipt(sb, "member-token", "job", "record", "doc")).bytes,
    ).toEqual(bytes);
    expect(rpc).toHaveBeenCalledWith("mcp_cost_receipt_get", {
      _job: "job",
      _record: "record",
      _id: "doc",
    });
    rpc.mockResolvedValueOnce({ data: { ...document, record_id: "someone-else" }, error: null });
    await expect(
      readVerifiedCostReceipt(sb, "member-token", "job", "record", "doc"),
    ).rejects.toThrow(/not available/);
    rpc.mockResolvedValueOnce({
      data: { ...document, record_id: "record", sha256: "0".repeat(64) },
      error: null,
    });
    await expect(
      readVerifiedCostReceipt(sb, "member-token", "job", "record", "doc"),
    ).rejects.toThrow(/fingerprint/);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(
      readVerifiedCostReceipt(sb, "member-token", "job", "record", "doc"),
    ).rejects.toThrow(/not available/);
  });
  it("verifies member, job, path, size, type and hash before returning original bytes", async () => {
    const result = await readVerifiedFinancialOriginal(sb, "member-token", "job", "doc");
    expect(result.bytes).toEqual(bytes);
    expect(getUser).toHaveBeenCalledWith("member-token");
    expect(rpc).toHaveBeenCalledWith("mcp_billing_documents_get", { _job: "job" });
    expect(mock.signed).toHaveBeenCalledWith(base.storage_path, 60);
    expect(await readUploadedFinancialOriginal(sb, "member-token", "job", "doc")).toEqual(bytes);
  });
  it("returns an actual synthetic XLSX only after verifying its stored hash", async () => {
    const workbook = new Uint8Array(readFileSync("tests/fixtures/synthetic-estimate.xlsx"));
    document = {
      ...document,
      filename: "file.xlsx",
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      storage_path: "company/job/doc/file.xlsx",
      size_bytes: workbook.length,
      sha256: await sha256Hex(workbook),
    };
    mock.signed.mockResolvedValue({
      data: { signedUrl: signedUrl.replace("file.pdf", "file.xlsx") },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(workbook as BodyInit)),
    );
    expect((await readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).bytes).toEqual(
      workbook,
    );
    document = { ...document, sha256: "0".repeat(64) };
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /fingerprint/,
    );
  });
  it("fails closed for invalid identity, restricted access, foreign job and changed bytes", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "invalid" } });
    await expect(readVerifiedFinancialOriginal(sb, "bad", "job", "doc")).rejects.toThrow(/member/);
    expect(mock.signed).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /not available/,
    );
    await expect(
      readVerifiedFinancialOriginal(sb, "member-token", "other-job", "doc"),
    ).rejects.toThrow(/not available/);
    document = { ...document, sha256: "0".repeat(64) };
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /fingerprint/,
    );
  });
  it("rejects a foreign or redirected storage URL and a stream over 10 MiB", async () => {
    mock.signed.mockResolvedValueOnce({
      data: { signedUrl: signedUrl.replace("example.test", "other.test") },
      error: null,
    });
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /unavailable/,
    );
    mock.signed.mockResolvedValueOnce({
      data: { signedUrl: signedUrl.replace("file.pdf", "other.pdf") },
      error: null,
    });
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /unavailable/,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 302, headers: { location: "https://other.test/" } }),
      ),
    );
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /unavailable/,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(signedUrl);
      }),
    );
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /^The original is unavailable/,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1))),
    );
    await expect(readVerifiedFinancialOriginal(sb, "member-token", "job", "doc")).rejects.toThrow(
      /over 10 MB/,
    );
  });
});
