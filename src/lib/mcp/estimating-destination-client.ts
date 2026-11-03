import { ToolError } from "@lovable.dev/mcp-js";
import { dbError, isMissingFunction, type Sb } from "./guard";
import type { Job } from "./jobs";

type Terms = { fee_pct: number | null; basis: string | null };
export type DestinationClientSnapshot = {
  version: number | null;
  budget: Record<string, unknown>;
  sov: Record<string, unknown>;
  sov_draft: Record<string, unknown>;
  terms: Terms;
  draft_terms: Terms;
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const validTerms = (v: unknown) =>
  object(v) &&
  (v.fee_pct === null ||
    (typeof v.fee_pct === "number" &&
      Number.isFinite(v.fee_pct) &&
      v.fee_pct >= 0 &&
      v.fee_pct < 100)) &&
  (v.basis === null || typeof v.basis === "string");
const unavailable = () =>
  new ToolError("Version-checked budget and SOV storage is unavailable. Nothing was changed.");

function checked(value: unknown, job: Job): DestinationClientSnapshot {
  const s = value as Record<string, unknown> | null;
  if (
    !s ||
    !Number.isSafeInteger(s.version) ||
    (s.version as number) < 0 ||
    s.company_id !== job.company_id ||
    s.job_id !== job.job_id ||
    !object(s.capabilities) ||
    s.capabilities.destination_cas !== true ||
    !object(s.budget) ||
    !object(s.sov) ||
    !object(s.sov_draft) ||
    !validTerms(s.terms) ||
    !validTerms(s.draft_terms)
  )
    throw unavailable();
  return s as unknown as DestinationClientSnapshot;
}

export async function readIntakeDestination(sb: Sb, job: Job, writesRequested: boolean) {
  const response = await sb.rpc("mcp_estimate_destination_snapshot", { _job: job.job_id });
  if (response.error && !isMissingFunction(response.error)) {
    if (["40P01", "40001"].includes(response.error.code ?? ""))
      throw new ToolError(
        "A concurrent change interrupted the destination read. Read current records before retrying.",
      );
    dbError(response.error);
  }
  if (!response.error) return checked(response.data, job);
  if (writesRequested) throw unavailable();
  // Read-only compatibility. A missing version RPC never enables legacy writes.
  const facts = await sb
    .from("mcp_job_facts")
    .select("module,key,value")
    .eq("job_id", job.job_id)
    .in("module", ["budget", "sov", "sov_draft"]);
  if (facts.error) dbError(facts.error);
  const terms = await sb
    .from("mcp_jobs")
    .select("sov_fee_pct,sov_basis")
    .eq("id", job.job_id)
    .maybeSingle();
  if (terms.error) dbError(terms.error);
  const values = terms.data as unknown as {
    sov_fee_pct?: number | null;
    sov_basis?: string | null;
  } | null;
  const rows = facts.data ?? [];
  return {
    version: null,
    budget: Object.fromEntries(
      rows.filter((r) => r.module === "budget").map((r) => [r.key, r.value]),
    ),
    sov: Object.fromEntries(rows.filter((r) => r.module === "sov").map((r) => [r.key, r.value])),
    sov_draft: Object.fromEntries(
      rows.filter((r) => r.module === "sov_draft").map((r) => [r.key, r.value]),
    ),
    terms: {
      fee_pct: values?.sov_fee_pct == null ? null : Number(values.sov_fee_pct),
      basis: values?.sov_basis ?? null,
    },
    // The legacy schema has no guarded draft metadata endpoint. Never query new
    // private terms through its publicly readable job row.
    draft_terms: { fee_pct: null, basis: null },
  } satisfies DestinationClientSnapshot;
}

export function effectiveDraftTerms(snapshot: DestinationClientSnapshot): Terms {
  return snapshot.draft_terms.fee_pct != null || snapshot.draft_terms.basis != null
    ? snapshot.draft_terms
    : snapshot.terms;
}

type DestinationPatch = {
  budget?: Record<string, unknown>;
  sov?: Record<string, unknown>;
  draft?: Record<string, unknown>;
  fee?: number;
  basis?: string;
  draftFee?: number | null;
  draftBasis?: string | null;
};
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    object(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

/** A fresh internal read is not the caller's observed version. Compatibility
 * without one permits only creates, no-ops and additions, never replacements. */
function replacesSavedValue(snapshot: DestinationClientSnapshot, patch: DestinationPatch) {
  // A saved legacy draft can already use known official terms. An empty
  // private field is not an unknown effective fee/basis in that existing copy.
  const draftTerms = Object.keys(snapshot.sov_draft).length
    ? effectiveDraftTerms(snapshot)
    : snapshot.draft_terms;
  for (const [before, after] of [
    [snapshot.budget, patch.budget],
    [snapshot.sov, patch.sov],
    [snapshot.sov_draft, patch.draft],
  ] as const)
    if (
      Object.entries(after ?? {}).some(
        ([key, value]) => Object.hasOwn(before, key) && canonical(before[key]) !== canonical(value),
      )
    )
      return true;
  return Boolean(
    (patch.fee != null && snapshot.terms.fee_pct != null && patch.fee !== snapshot.terms.fee_pct) ||
    (patch.basis?.trim() &&
      snapshot.terms.basis != null &&
      patch.basis.trim() !== snapshot.terms.basis) ||
    (patch.draftFee != null &&
      draftTerms.fee_pct != null &&
      patch.draftFee !== draftTerms.fee_pct) ||
    (patch.draftBasis?.trim() &&
      draftTerms.basis != null &&
      patch.draftBasis.trim() !== draftTerms.basis),
  );
}

function changedPatch(snapshot: DestinationClientSnapshot, patch: DestinationPatch) {
  const changed: DestinationPatch = {};
  for (const [key, before, after] of [
    ["budget", snapshot.budget, patch.budget],
    ["sov", snapshot.sov, patch.sov],
    ["draft", snapshot.sov_draft, patch.draft],
  ] as const) {
    const rows = Object.entries(after ?? {}).filter(
      ([ref, value]) => !Object.hasOwn(before, ref) || canonical(before[ref]) !== canonical(value),
    );
    if (rows.length) changed[key] = Object.fromEntries(rows);
  }
  if (patch.fee != null && patch.fee !== snapshot.terms.fee_pct) changed.fee = patch.fee;
  if (patch.basis?.trim() && patch.basis.trim() !== snapshot.terms.basis)
    changed.basis = patch.basis.trim();
  if (patch.draftFee != null && patch.draftFee !== snapshot.draft_terms.fee_pct)
    changed.draftFee = patch.draftFee;
  if (patch.draftBasis?.trim() && patch.draftBasis.trim() !== snapshot.draft_terms.basis)
    changed.draftBasis = patch.draftBasis.trim();
  return changed;
}

export async function saveIntakeDestination(
  sb: Sb,
  job: Job,
  snapshot: DestinationClientSnapshot,
  patch: DestinationPatch,
  callerVersion?: number,
) {
  if (snapshot.version === null) throw unavailable();
  // Snapshot the wire payload before any await; the same exact JSON patch is
  // checked for replacements and sent with the caller's observed revision.
  const boundPatch = changedPatch(snapshot, JSON.parse(JSON.stringify(patch)) as DestinationPatch);
  if (callerVersion !== undefined && callerVersion !== snapshot.version)
    throw new ToolError(
      "The destination changed. Read and review its current version before saving.",
    );
  if (callerVersion === undefined && replacesSavedValue(snapshot, boundPatch))
    throw new ToolError(
      "Read and review the current budget or SOV before replacing saved values. A previous save may already have completed; review its current state before a correction. Nothing was changed.",
    );
  // A genuine no-op is a read, not another fact upsert/revision. The version
  // check above still holds an explicitly stale request even if values match.
  if (!Object.keys(boundPatch).length) return snapshot;
  // Bind the complete, normalized atomic patch to the version supplied by the
  // caller. Only a safe create/no-op/append may use this internal read's version.
  const result = await sb.rpc("mcp_estimate_destination_save", {
    _job: job.job_id,
    _expected_version: callerVersion ?? snapshot.version,
    _budget: boundPatch.budget ?? null,
    _sov: boundPatch.sov ?? null,
    _sov_draft: boundPatch.draft ?? null,
    _fee_pct: boundPatch.fee ?? null,
    _basis: boundPatch.basis ?? null,
    _draft_fee_pct: boundPatch.draftFee ?? null,
    _draft_basis: boundPatch.draftBasis ?? null,
  });
  if (result.error) {
    if (isMissingFunction(result.error)) throw unavailable();
    if (["40P01", "40001"].includes(result.error.code ?? ""))
      throw new ToolError(
        "A concurrent change interrupted this save. Read current destination state before retrying.",
      );
    dbError(result.error);
  }
  try {
    return checked(result.data, job);
  } catch {
    throw new ToolError(
      "The save result could not be verified. Read current destination state before retrying.",
    );
  }
}
