import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetch: vi.fn(),
  store: vi.fn(),
  verify: vi.fn(),
  read: vi.fn(),
  checked: vi.fn(),
}));
vi.mock("./guard", () => ({
  run: async (_n: unknown, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) => f({}),
  text: (text: string) => ({ content: [{ text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({ job_id: "job", company_id: "company", scope: "full" }),
}));
vi.mock("./ap-original.server", () => ({
  apOriginalRpc: state.rpc,
  storeApOriginal: state.store,
  verifyApOriginalUpload: state.verify,
  readApOriginal: state.read,
  assertApOriginal: vi.fn(),
  checkedApOriginalBytes: state.checked,
}));
vi.mock("./file-upload", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAllowedFile: state.fetch,
}));
import { jobCostOriginal } from "./tools/job-cost-original-tools";
import { drawingFileMeta } from "./drawing-file-input";
const record = "00000000-0000-4000-8000-000000000001",
  upload = "00000000-0000-4000-8000-000000000002",
  request = "00000000-0000-4000-8000-000000000003",
  review = "00000000-0000-4000-8000-000000000004";
const payload = {
  record_id: record,
  version: 1,
  upload_id: upload,
  request_id: request,
  filename: "invoice.txt",
  sha256: "a".repeat(64),
  size_bytes: 12,
};
const call = (args: Record<string, unknown>) =>
  (
    jobCostOriginal as unknown as {
      handler: (
        a: unknown,
        c: unknown,
      ) => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown> }>;
    }
  ).handler({ job_number: "A1", record_id: record, ...args }, { getToken: () => "synthetic" });
beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockImplementation(async (_sb: unknown, name: string) =>
    name === "mcp_ap_original_review"
      ? {
          payload,
          review_key: review,
          expires_at: "2026-10-30T20:00:00Z",
          bill: { facts: { counterparty_name: "Summit", document_reference: "INV-1" } },
        }
      : name === "mcp_ap_original_link"
        ? { id: upload, already_linked: false }
        : { id: upload },
  );
  state.fetch.mockResolvedValue(new TextEncoder().encode("Invoice USD100"));
  state.verify.mockResolvedValue({ id: upload });
});
describe("supplier original conversation boundaries", () => {
  it("authorizes before fetching, uploads and reviews without linking", async () => {
    const result = await call({
      action: "review",
      expected_version: 1,
      file: {
        file_name: "invoice.txt",
        file_id: "synthetic",
        download_url: "https://synthetic.invalid/file",
      },
    });
    expect(state.rpc.mock.calls[0][1]).toBe("mcp_ap_original_scope");
    expect(state.store).toHaveBeenCalledOnce();
    expect(state.verify).toHaveBeenCalledOnce();
    expect(result.structuredContent.saved).toBe(false);
    expect(result.content[0].text).toContain("not linked yet");
    expect(result.content[0].text).toContain("Is this correct?");
    expect(state.rpc.mock.calls.some((c) => c[1] === "mcp_ap_original_link")).toBe(false);
  });
  it("uses recognized top-level attachment metadata and rejects untyped or missing files", async () => {
    expect(drawingFileMeta("job_cost_original")).toEqual({ "openai/fileParams": ["file"] });
    await expect(call({ action: "review", expected_version: 1 })).rejects.toThrow(
      /Attach the supplier/,
    );
    await expect(
      call({
        action: "review",
        expected_version: 1,
        file: { file_id: "x", download_url: "https://synthetic.invalid/file" },
      }),
    ).rejects.toThrow(/file name/);
    expect(state.store).not.toHaveBeenCalled();
    await expect(
      call({
        action: "review",
        expected_version: 1,
        file: {
          file_name: "invoice.pdf",
          file_id: "x",
          download_url: "https://synthetic.invalid/file",
        },
      }),
    ).rejects.toThrow();
    expect(state.store).not.toHaveBeenCalled();
  });
  it("does not fetch an attachment after an access denial", async () => {
    state.rpc.mockRejectedValue(new Error("Accounting access required"));
    await expect(
      call({
        action: "review",
        expected_version: 1,
        file: { file_name: "invoice.txt", download_url: "https://synthetic.invalid/file" },
      }),
    ).rejects.toThrow(/access/);
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("requires separate confirmation and unchanged identifiers", async () => {
    await expect(
      call({ action: "link", payload, review_key: review, confirmed: false }),
    ).rejects.toThrow(/confirm/);
    expect(state.rpc).not.toHaveBeenCalled();
    await expect(
      call({ action: "link", record_id: upload, payload, review_key: review, confirmed: true }),
    ).rejects.toThrow(/unchanged/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rechecks bytes before linking and reports no financial action", async () => {
    state.checked.mockRejectedValueOnce(new Error("Fingerprint mismatch"));
    await expect(
      call({ action: "link", payload, review_key: review, confirmed: true }),
    ).rejects.toThrow(/Fingerprint/);
    expect(state.rpc.mock.calls.some((c) => c[1] === "mcp_ap_original_link")).toBe(false);
    const result = await call({ action: "link", payload, review_key: review, confirmed: true });
    expect(result.content[0].text).toContain("No accounting approval, posting or payment");
    expect(state.rpc).toHaveBeenLastCalledWith(expect.anything(), "mcp_ap_original_link", {
      _job: "job",
      _p: payload,
      _review: review,
      _confirmed: true,
    });
  });
});
