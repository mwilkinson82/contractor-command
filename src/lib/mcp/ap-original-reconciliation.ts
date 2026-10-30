import { z } from "zod";
import type { Coverage, Finding, Scope } from "./reconciliation";

const uuid = z.string().uuid(),
  version = z.number().int().positive();
const schema = z.object({
  snapshot_version: z.literal(1),
  complete: z.literal(true),
  company_id: uuid,
  job_id: uuid,
  records: z.array(z.object({ record_id: uuid, version })).max(200),
  documents: z
    .array(
      z.object({
        id: uuid,
        record_id: uuid,
        version,
        filename: z.string().min(1).max(120),
        size_bytes: z.number().int().min(1).max(10485760),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        linked_at: z.string().min(1),
      }),
    )
    .max(200),
});
export function reconcileApOriginals(
  raw: unknown,
  scope: Scope,
): { coverage: Coverage; findings: Finding[] } {
  const unavailable = {
    coverage: {
      state: "unavailable",
      reason:
        "Supplier-original associations are unavailable, incomplete or outside the supported scope. No missing-file finding is inferred.",
    } as Coverage,
    findings: [],
  };
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 1048576) return unavailable;
  const parsed = schema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.company_id !== scope.company_id ||
    parsed.data.job_id !== scope.job_id
  )
    return unavailable;
  const { records, documents } = parsed.data;
  if (
    new Set(records.map((r) => r.record_id)).size !== records.length ||
    new Set(documents.map((d) => d.id)).size !== documents.length ||
    documents.some(
      (d) => !records.some((r) => r.record_id === d.record_id && d.version <= r.version),
    )
  )
    return unavailable;
  return {
    coverage: {
      state: "checked",
      reason:
        "Stored supplier-original associations are compared with each current bill version in one bounded statement. Older originals remain historical and do not cover a corrected version. Read an individual original to verify its bytes; authenticity, field receipts and external AP coverage are not established.",
    },
    findings: records
      .filter((r) => !documents.some((d) => d.record_id === r.record_id && d.version === r.version))
      .map((r) => ({
        code: "ap_supplier_original_gap",
        severity: "attention",
        record_ids: [r.record_id],
        message: `Supplier bill version ${r.version} has no linked original. Attach the original to this exact version after review.`,
      })),
  };
}
