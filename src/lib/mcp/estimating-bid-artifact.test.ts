import { describe, expect, it, vi } from "vitest";
import type { Sb } from "./guard";
import type { Job } from "./jobs";
import { saveBidArtifact } from "./estimating-bid-artifact";

const job: Job = {
  company_id: "company-a",
  job_id: "job-a",
  job_number: "1",
  name: "Job",
  scope: "contract",
};
function fixture(versions: Array<number | null>, allowed = true, companies = [job.company_id]) {
  let index = 0;
  const rpc = vi.fn(async () => {
    const call = index++;
    const version = versions[Math.min(call, versions.length - 1)];
    return version === null
      ? { data: null, error: { message: "denied" } }
      : {
          data: { version, bid: { company_id: companies[Math.min(call, companies.length - 1)] } },
          error: null,
        };
  });
  const upload = vi.fn(async (path: string) => ({
    error: allowed && path.startsWith("company-a/job-a/export-") ? null : { message: "denied" },
  }));
  const sign = vi.fn(async (path: string) => ({
    data: {
      signedUrl: `https://fixture.supabase.co/storage/v1/object/sign/athena-estimate-exports/${path}?token=local`,
    },
    error: null,
  }));
  const from = vi.fn(() => ({ upload, createSignedUrl: sign }));
  return { sb: { rpc, storage: { from } } as unknown as Sb, rpc, upload, sign, from };
}

describe("versioned bid artifact delivery", () => {
  it.each(["pdf", "xlsx"] as const)(
    "uses the existing tenant/job scoped 15-minute private path for %s",
    async (format) => {
      const f = fixture([7, 7]);
      const bytes = new TextEncoder().encode(format === "pdf" ? "%PDF-1.7" : "PK\u0003\u0004test");
      const result = await saveBidArtifact(f.sb, job, 7, format, bytes, "a".repeat(64));
      expect(f.from).toHaveBeenCalledWith("athena-estimate-exports");
      expect(f.rpc).toHaveBeenCalledTimes(2);
      expect(f.sign).toHaveBeenCalledWith(expect.stringMatching(/^company-a\/job-a\/export-/), 900);
      expect(result).toMatchObject({
        filename: `Bid-summary-v7.${format}`,
        snapshot_version: 7,
        expires_in: 900,
        url: expect.stringContaining("token=local"),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(result).not.toHaveProperty("path");
    },
  );
  it("does not upload when the version is stale or authority is unavailable", async () => {
    for (const version of [8, null]) {
      const f = fixture([version]);
      await expect(
        saveBidArtifact(f.sb, job, 7, "pdf", new Uint8Array([1]), "a".repeat(64)),
      ).rejects.toThrow(/changed or access/i);
      expect(f.upload).not.toHaveBeenCalled();
    }
  });
  it("withholds a signed link if the version changes during storage", async () => {
    const f = fixture([7, 8]);
    await expect(
      saveBidArtifact(f.sb, job, 7, "pdf", new Uint8Array([1]), "a".repeat(64)),
    ).rejects.toThrow(/changed or access/i);
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.sign).toHaveBeenCalledTimes(1);
  });
  it("withholds a link if the job moves company even without a version change", async () => {
    const f = fixture([7, 7], true, [job.company_id, "company-b"]);
    await expect(
      saveBidArtifact(f.sb, job, 7, "pdf", new Uint8Array([1]), "a".repeat(64)),
    ).rejects.toThrow(/changed or access/i);
    expect(f.sign).toHaveBeenCalledTimes(1);
  });
  it("does not return a link when storage rejects the tenant or role", async () => {
    const f = fixture([7], false);
    await expect(
      saveBidArtifact(f.sb, job, 7, "xlsx", new Uint8Array([1]), "a".repeat(64)),
    ).rejects.toThrow(/could not be stored/i);
    expect(f.sign).not.toHaveBeenCalled();
  });
  it("creates a fresh private object on retry after an uncertain final recheck", async () => {
    const f = fixture([7, null, 7, 7]);
    await expect(
      saveBidArtifact(f.sb, job, 7, "pdf", new Uint8Array([1]), "a".repeat(64)),
    ).rejects.toThrow(/changed or access/i);
    const retried = await saveBidArtifact(f.sb, job, 7, "pdf", new Uint8Array([1]), "a".repeat(64));
    expect(retried.snapshot_version).toBe(7);
    expect(f.upload.mock.calls[0][0]).not.toBe(f.upload.mock.calls[1][0]);
  });
});
