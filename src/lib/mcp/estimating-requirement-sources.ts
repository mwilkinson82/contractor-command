import { ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const clauseSchema = z
  .object({
    id: z.uuid(),
    section: z.string().min(1).max(40),
    source: z.enum(["document", "unverified"]),
    text_sha256: hash,
    current_document_body_sha256: hash.nullable(),
    matches_current_document: z.boolean().nullable(),
  })
  .strict();
const manifestSchema = z
  .object({
    schema: z.literal(1),
    sha256: hash,
    setup_input_sha256: hash,
    clauses: z.array(clauseSchema),
    documents: z.array(
      z
        .object({
          kind: z.enum(["contract", "spec"]),
          id: z.uuid(),
          body_sha256: hash,
          declared_body_sha256: hash,
          declared_file_sha256: hash.nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type RequirementSourceManifest = z.infer<typeof manifestSchema>;
const readableClauseSchema = z
  .object({
    id: z.uuid(),
    section: z.string().min(1).max(40),
    source: z.enum(["document", "unverified"]),
    verbatim_text: z.string().min(1).max(10000),
  })
  .strict();

export function requirementSourceManifest(snapshot: unknown): RequirementSourceManifest {
  const s = snapshot as {
    capabilities?: { requirement_sources?: unknown };
    requirement_sources?: unknown;
  } | null;
  if (s?.capabilities?.requirement_sources !== true)
    throw new ToolError(
      "Version-bound requirement source storage is unavailable. Nothing was saved.",
    );
  const parsed = manifestSchema.safeParse(s.requirement_sources);
  if (!parsed.success)
    throw new ToolError(
      "The saved requirement source fingerprint is invalid. Refresh before scanning.",
    );
  const m = parsed.data;
  if (
    new Set(m.clauses.map((c) => c.id)).size !== m.clauses.length ||
    new Set(m.documents.map((d) => `${d.kind}:${d.id}`)).size !== m.documents.length
  )
    throw new ToolError(
      "Saved requirement source identities conflict. Review the source before scanning.",
    );
  if (m.documents.some((d) => d.body_sha256 !== d.declared_body_sha256))
    throw new ToolError(
      "Saved document text does not match its recorded fingerprint. Re-review the source before scanning.",
    );
  if (m.clauses.some((c) => c.source === "document" && c.matches_current_document !== true))
    throw new ToolError(
      "Previously verified clause text no longer matches the current saved contract. Re-review the clauses before scanning.",
    );
  return m;
}

/** A legacy record remains readable, but is never certified as a final bid.
 * The scan tracks only source inputs, not unrelated pricing/quote revisions. */
export function requirementSourceBlocker(snapshot: unknown): string | null {
  let manifest: RequirementSourceManifest;
  try {
    manifest = requirementSourceManifest(snapshot);
  } catch (error) {
    return error instanceof Error ? error.message : "Requirement source review is unavailable.";
  }
  const scan = (snapshot as { requirement_scan?: { current?: unknown; source_sha256?: unknown } })
    .requirement_scan;
  return scan?.current === true && scan.source_sha256 === manifest.sha256
    ? null
    : "Requirement sources need a current scan and review before a final bid, export or handoff.";
}

/** Existing RLS clause text is consumed only if the exact source set matches
 * the lock-bound manifest. Declared file hashes never attest Storage bytes. */
export async function verifyRequirementClauses(manifest: RequirementSourceManifest, raw: unknown) {
  const parsed = z.array(readableClauseSchema).safeParse(raw);
  if (!parsed.success)
    throw new ToolError(
      "Saved requirement clauses could not be verified. Nothing was scanned or saved.",
    );
  const rows = parsed.data;
  if (
    rows.length !== manifest.clauses.length ||
    new Set(rows.map((c) => c.id)).size !== rows.length
  )
    throw new ToolError("Requirement sources changed during the read. Refresh and scan again.");
  for (const row of rows) {
    const expected = manifest.clauses.find((c) => c.id === row.id);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.verbatim_text)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (
      !expected ||
      expected.section !== row.section ||
      expected.source !== row.source ||
      expected.text_sha256 !== digest
    )
      throw new ToolError("Requirement sources changed during the read. Refresh and scan again.");
  }
  return rows.map(({ section, verbatim_text }) => ({ section, verbatim_text }));
}
