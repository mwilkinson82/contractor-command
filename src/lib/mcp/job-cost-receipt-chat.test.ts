import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";
const state = vi.hoisted(() => ({
  scope: "super",
  rpc: vi.fn(),
  readUpload: vi.fn(),
  readReceipt: vi.fn(),
  register: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock("./guard", () => ({
  run: async (_n: unknown, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) =>
    f({ rpc: state.rpc }),
  text: (s: string) => ({ content: [{ text: s }] }),
  dbError: (e: { message: string }) => {
    throw new ToolError(e.message);
  },
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({ job_id: "job", company_id: "company", scope: state.scope }),
}));
vi.mock("./billing-original.server", () => ({
  readUploadedCostReceipt: state.readUpload,
  readVerifiedCostReceipt: state.readReceipt,
}));
vi.mock("./billing-document-attestation.server", () => ({
  registerVerifiedCostReceipt: state.register,
  reserveBillingMemberUpload: state.reserve,
}));
import { jobCostReceipt } from "./tools/job-cost-receipt-tools";
const call = (args: Record<string, unknown>) =>
  (
    jobCostReceipt as unknown as {
      handler: (
        a: unknown,
        c: unknown,
      ) => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown> }>;
    }
  ).handler(args, { getToken: () => "token" });
const upload = {
  id: "00000000-0000-4000-8000-000000000001",
  job_id: "job",
  company_id: "company",
  record_id: "00000000-0000-4000-8000-000000000002",
  filename: "receipt.pdf",
  mime_type: "application/pdf",
  storage_path: "company/job/00000000-0000-4000-8000-000000000001/receipt.pdf",
  expires_at: "2026-10-29T00:00:00Z",
  status: "open",
};
afterEach(() => {
  vi.clearAllMocks();
  state.scope = "super";
});
describe("field receipt conversation", () => {
  it("opens an own-record upload and finishes only after server verification", async () => {
    state.rpc.mockImplementation(async (name: string) => ({
      data: name === "mcp_cost_receipt_upload_begin" ? upload : upload,
      error: null,
    }));
    const opened = await call({
      job_number: "SYN-A",
      record_id: upload.record_id,
      action: "begin",
      filename: "receipt.pdf",
    });
    expect(opened.structuredContent.upload_id).toBe(upload.id);
    expect(opened.content[0].text).toContain("not posted or paid");
    expect(state.rpc).toHaveBeenCalledWith(
      "mcp_cost_receipt_upload_begin",
      expect.objectContaining({ _job: "job", _record: upload.record_id }),
    );
    state.readUpload.mockResolvedValue(new TextEncoder().encode("%PDF-1.7 synthetic"));
    state.register.mockResolvedValue({ id: upload.id, already_stored: false });
    const finished = await call({
      job_number: "SYN-A",
      record_id: upload.record_id,
      action: "finish",
      upload_id: upload.id,
    });
    expect(finished.structuredContent.receipt_id).toBe(upload.id);
    expect(finished.content[0].text).toContain("not posted or paid");
    expect(state.register).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "job",
      upload.record_id,
      upload.id,
      expect.any(Number),
      expect.any(String),
    );
  });
  it("fails closed for a mismatched receipt session and never reads bytes", async () => {
    state.rpc.mockResolvedValue({ data: { ...upload, record_id: "another" }, error: null });
    await expect(
      call({
        job_number: "SYN-A",
        record_id: upload.record_id,
        action: "finish",
        upload_id: upload.id,
      }),
    ).rejects.toThrow(/unavailable/);
    expect(state.readUpload).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });
  it("does not let a full-access user use the superintendent upload path", async () => {
    state.scope = "full";
    await expect(
      call({
        job_number: "SYN-A",
        record_id: upload.record_id,
        action: "begin",
        filename: "receipt.pdf",
      }),
    ).rejects.toThrow(/assigned superintendent/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
