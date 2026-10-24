import { describe, it, expect, vi } from "vitest";
import {
  uploadSubmittalPiece,
  type PieceUploadClient,
  type PieceUploadInput,
} from "./submittal-piece-upload";

const input: PieceUploadInput = {
  jobId: "job",
  number: "05 12 00-001",
  file: new File(["fictional"], "source.pdf"),
  newPiece: { kind: "other", source_party: "Example Steel", required: true },
};
const record = {
  job_id: "job",
  company_id: "company",
  read_only: false,
  current: { id: "submittal", package_items: [] },
};
function client(data: unknown = record) {
  const upload = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data,
    error: null,
  }));
  return { rpc, storage: { from: () => ({ upload }) }, upload };
}
describe("member piece upload failure boundaries", () => {
  it("does not upload through a read-only board view or a different job", async () => {
    for (const data of [
      { ...record, read_only: true },
      { ...record, job_id: "other" },
    ]) {
      const sb = client(data);
      await expect(uploadSubmittalPiece(sb, input)).rejects.toThrow("Full job access");
      expect(sb.upload).not.toHaveBeenCalled();
      expect(sb.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses an unknown piece before writing storage", async () => {
    const sb = client();
    await expect(
      uploadSubmittalPiece(sb, { ...input, newPiece: undefined, pieceId: "not-listed" }),
    ).rejects.toThrow("no longer in this revision");
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("rejects empty, oversized, unsafe and unsupported files before any request", async () => {
    for (const file of [
      new File([], "empty.pdf"),
      new File(["x"], "../outside.pdf"),
      new File(["x"], "script.exe"),
      { name: "big.pdf", size: 50 * 1024 * 1024 + 1 } as File,
    ]) {
      const sb = client();
      await expect(uploadSubmittalPiece(sb, { ...input, file })).rejects.toThrow(
        "between 1 byte and 50 MB",
      );
      expect(sb.rpc).not.toHaveBeenCalled();
    }
  });
  it("never reports success from an uncommitted writer reply", async () => {
    const sb = client();
    await expect(uploadSubmittalPiece(sb as PieceUploadClient, input)).rejects.toThrow(
      "could not be verified",
    );
    expect(sb.upload).toHaveBeenCalledOnce();
    expect(sb.rpc.mock.calls.map(([name]) => name)).toEqual([
      "mcp_submittal_record_get",
      "mcp_submittal_package_write",
      "mcp_submittal_record_get",
    ]);
  });
});
