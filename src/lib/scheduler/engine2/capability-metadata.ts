/**
 * Phase 3.2 — Importer-owned feature detection / eligibility metadata.
 *
 * Translates importer signals (XER diagnostics, counts, raw rows) into a
 * compact, deterministic capability report that can be attached to a
 * `Schedule` and consumed by `evaluateScheduleEligibility`.
 *
 * Replaces the stubbed PASSING checks in §31 (Phase 3.1) for the
 * features that the in-memory `Schedule` shape cannot express directly:
 *
 *   - external-relationships
 *   - interproject-relationships
 *   - unsupported-constraints
 *   - unsupported-percent-type
 *   - unsupported-duration-type
 *   - resource-loaded-imported  (counts come from importer, not Schedule)
 *   - leveling-required
 *   - unknown-xer-semantics    (otherTableNames the engine doesn't model)
 *   - baseline-assumed         (XER never carries a baseline)
 *   - calendar-shifts          (preserved-only, not executed by WorkClock)
 *
 * Policy (Phase 3.2):
 *   - "pass"    → feature absent / handled.
 *   - "block"   → feature present and engine2 cannot safely calculate it.
 *   - "unknown" → importer saw something it could not fully classify;
 *                 selector MUST treat this as a blocker (conservative).
 *
 * This module is pure / side-effect free. It does not import the legacy
 * engine, does not mutate the schedule, and does not read env flags. The
 * selector / eligibility evaluator consumes it.
 *
 * See ARCHITECTURE.md §33.
 */

import type { Schedule } from "../types";
import type { EngineDiagnostic } from "./types";
import type { XerEngine2ImportResult } from "./xer-import";

export const CAPABILITY_METADATA_VERSION = 1;

export type CapabilityVerdict = "pass" | "block" | "unknown";

export type CapabilityFlagId =
  | "external-relationships"
  | "interproject-relationships"
  | "unsupported-constraints"
  | "unsupported-percent-type"
  | "unsupported-duration-type"
  | "resource-loaded-imported"
  | "leveling-required"
  | "unknown-xer-semantics"
  | "baseline-assumed"
  | "calendar-shifts";

export interface CapabilityFlag {
  id: CapabilityFlagId;
  verdict: CapabilityVerdict;
  /** Short human-readable explanation; safe for debug drawer rendering. */
  detail?: string;
  /** How many import-level signals contributed to this verdict. */
  evidenceCount?: number;
}

export type CapabilitySource = "xer" | "manual" | "default";

export interface ScheduleCapabilityMetadata {
  version: typeof CAPABILITY_METADATA_VERSION;
  source: CapabilitySource;
  /** ISO timestamp the metadata was produced (importer clock). */
  derivedAt?: string;
  flags: CapabilityFlag[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * A "default" metadata for schedules that were authored in-app (not
 * imported). Every importer-owned flag is PASS — the in-app authoring
 * surface cannot express any of these features today, so absence is
 * truthful.
 */
export function defaultCapabilityMetadata(): ScheduleCapabilityMetadata {
  return {
    version: CAPABILITY_METADATA_VERSION,
    source: "default",
    flags: [
      flag("external-relationships", "pass"),
      flag("interproject-relationships", "pass"),
      flag("unsupported-constraints", "pass"),
      flag("unsupported-percent-type", "pass"),
      flag("unsupported-duration-type", "pass"),
      flag("resource-loaded-imported", "pass"),
      flag("leveling-required", "pass"),
      flag("unknown-xer-semantics", "pass"),
      flag("baseline-assumed", "pass"),
      flag("calendar-shifts", "pass"),
    ],
  };
}

function flag(
  id: CapabilityFlagId,
  verdict: CapabilityVerdict,
  detail?: string,
  evidenceCount?: number,
): CapabilityFlag {
  const f: CapabilityFlag = { id, verdict };
  if (detail) f.detail = detail;
  if (typeof evidenceCount === "number") f.evidenceCount = evidenceCount;
  return f;
}

// ---------------------------------------------------------------------------
// XER → capability metadata
// ---------------------------------------------------------------------------

/**
 * Diagnostic codes that map to a specific capability flag. UNKNOWN
 * verdicts are reserved for unmapped diagnostic codes the importer
 * emitted at warn/error severity, so we conservatively block.
 */
const DIAGNOSTIC_CODE_TO_FLAG: Record<string, CapabilityFlagId> = {
  unsupported_constraint_type: "unsupported-constraints",
  unsupported_percent_complete_type_behavior: "unsupported-percent-type",
  unsupported_duration_type_behavior: "unsupported-duration-type",
  unsupported_activity_type_behavior: "unknown-xer-semantics",
  unsupported_calendar_shift: "calendar-shifts",
  calendar_shift_preserved_only: "calendar-shifts",
  unsupported_calendar_hours_per_day: "calendar-shifts",
  external_relationship_preserved_raw: "external-relationships",
  external_relationship_preserved: "external-relationships",
  external_relationship_requires_imported_project: "external-relationships",
  external_project_missing: "external-relationships",
  interproject_relationship_unresolved: "external-relationships",
  interproject_relationship_mapped: "interproject-relationships",
  baseline_not_in_xer: "baseline-assumed",
};

/** Diagnostic severities considered evidence of a real problem (not info). */
const ESCALATING_SEVERITIES = new Set<EngineDiagnostic["severity"]>([
  "warn",
  "error",
]);

interface FlagAccumulator {
  verdicts: Set<CapabilityVerdict>;
  details: string[];
  evidence: number;
}

function ensure(map: Map<CapabilityFlagId, FlagAccumulator>, id: CapabilityFlagId) {
  let acc = map.get(id);
  if (!acc) {
    acc = { verdicts: new Set(), details: [], evidence: 0 };
    map.set(id, acc);
  }
  return acc;
}

/** Verdict precedence: block > unknown > pass. */
function mergeVerdict(acc: FlagAccumulator): CapabilityVerdict {
  if (acc.verdicts.has("block")) return "block";
  if (acc.verdicts.has("unknown")) return "unknown";
  return "pass";
}

export interface DeriveCapabilityOptions {
  derivedAt?: string;
}

/**
 * Inspect a `XerEngine2ImportResult` and produce a deterministic
 * capability report. Pure projection — no I/O, no mutation.
 */
export function deriveCapabilityMetadataFromXerImport(
  imported: XerEngine2ImportResult,
  options: DeriveCapabilityOptions = {},
): ScheduleCapabilityMetadata {
  const acc = new Map<CapabilityFlagId, FlagAccumulator>();

  // Seed every flag as pass so the output is shape-stable.
  const ids: CapabilityFlagId[] = [
    "external-relationships",
    "interproject-relationships",
    "unsupported-constraints",
    "unsupported-percent-type",
    "unsupported-duration-type",
    "resource-loaded-imported",
    "leveling-required",
    "unknown-xer-semantics",
    "baseline-assumed",
    "calendar-shifts",
  ];
  for (const id of ids) ensure(acc, id).verdicts.add("pass");

  // ---- Counts-driven verdicts (truth from the result shape) -------------

  const stats = imported.stats;

  if (stats.externalRelationshipsPreservedRaw > 0) {
    const a = ensure(acc, "external-relationships");
    a.verdicts.add("block");
    a.evidence += stats.externalRelationshipsPreservedRaw;
    a.details.push(
      `${stats.externalRelationshipsPreservedRaw} external relationship(s) preserved raw`,
    );
  }
  if (stats.externalProjectsMissingCount > 0) {
    const a = ensure(acc, "external-relationships");
    a.verdicts.add("block");
    a.details.push(
      `${stats.externalProjectsMissingCount} referenced project(s) missing from this XER`,
    );
  }
  if (stats.interprojectRelationshipsCount > 0) {
    const a = ensure(acc, "interproject-relationships");
    a.verdicts.add("block");
    a.evidence += stats.interprojectRelationshipsCount;
    a.details.push(
      `${stats.interprojectRelationshipsCount} interproject relationship(s) mapped`,
    );
  }
  if (stats.constraintsUnsupported > 0) {
    const a = ensure(acc, "unsupported-constraints");
    a.verdicts.add("block");
    a.evidence += stats.constraintsUnsupported;
    a.details.push(`${stats.constraintsUnsupported} unsupported constraint(s)`);
  }
  if (stats.assignmentsParsed > 0 || stats.resourcesParsed > 0) {
    const a = ensure(acc, "resource-loaded-imported");
    // Resource presence alone is a warning-level signal in §31; here in
    // the importer-owned view it's still BLOCK because legacy does not
    // level and engine2's leveling is unvalidated against XER inputs.
    a.verdicts.add("block");
    a.evidence += stats.assignmentsParsed;
    a.details.push(
      `${stats.assignmentsParsed} resource assignment(s) across ${stats.resourcesParsed} resource(s)`,
    );
    // Resource-loaded inputs also imply potential leveling demand.
    const lvl = ensure(acc, "leveling-required");
    lvl.verdicts.add("block");
    lvl.details.push("resource assignments imply potential leveling demand");
  }

  // XER never carries baselines today — record as assumed/missing block so
  // baseline-variance consumers know engine2 will not fabricate one.
  {
    const a = ensure(acc, "baseline-assumed");
    a.verdicts.add("block");
    a.details.push("XER imports never include baseline schedule data");
  }

  // Unknown XER tables we saw but did not interpret → conservative unknown.
  if (imported.raw.otherTableNames.length > 0) {
    const a = ensure(acc, "unknown-xer-semantics");
    a.verdicts.add("unknown");
    a.evidence += imported.raw.otherTableNames.length;
    a.details.push(
      `unmodeled XER table(s): ${imported.raw.otherTableNames.slice(0, 5).join(", ")}${
        imported.raw.otherTableNames.length > 5 ? "…" : ""
      }`,
    );
  }

  // ---- Diagnostic-driven verdicts ---------------------------------------

  for (const d of imported.diagnostics) {
    const mapped = DIAGNOSTIC_CODE_TO_FLAG[d.code];
    if (mapped) {
      const a = ensure(acc, mapped);
      if (ESCALATING_SEVERITIES.has(d.severity)) {
        a.verdicts.add("block");
        a.evidence += 1;
        if (d.message && a.details.length < 5) a.details.push(d.message);
      } else if (a.verdicts.size === 1 && a.verdicts.has("pass")) {
        // Info-only diagnostic that maps to a capability whose stats are
        // clean keeps PASS; do not flip on informational chatter.
      }
      continue;
    }
    // Unmapped warn/error diagnostic → conservative unknown.
    if (ESCALATING_SEVERITIES.has(d.severity)) {
      const a = ensure(acc, "unknown-xer-semantics");
      a.verdicts.add("unknown");
      a.evidence += 1;
      if (d.message && a.details.length < 5) a.details.push(`${d.code}: ${d.message}`);
    }
  }

  const flags: CapabilityFlag[] = ids.map((id) => {
    const a = acc.get(id)!;
    const verdict = mergeVerdict(a);
    return flag(
      id,
      verdict,
      verdict === "pass" || a.details.length === 0 ? undefined : a.details.join("; "),
      verdict === "pass" ? undefined : a.evidence || undefined,
    );
  });

  return {
    version: CAPABILITY_METADATA_VERSION,
    source: "xer",
    derivedAt: options.derivedAt,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Schedule attachment helpers
// ---------------------------------------------------------------------------

/**
 * Persist capability metadata onto a Schedule. The field is optional and
 * additive (declared on `Schedule.engine2Capabilities`); legacy code paths
 * ignore it. Mutates and returns the same schedule reference for
 * pipeline convenience.
 */
export function attachCapabilityMetadata<T extends Schedule>(
  schedule: T,
  meta: ScheduleCapabilityMetadata,
): T {
  schedule.engine2Capabilities = meta;
  return schedule;
}

export function getCapabilityMetadata(
  schedule: Schedule | null | undefined,
): ScheduleCapabilityMetadata | undefined {
  return schedule?.engine2Capabilities as ScheduleCapabilityMetadata | undefined;
}

// ---------------------------------------------------------------------------
// Eligibility projection
// ---------------------------------------------------------------------------

/**
 * Map a capability metadata report into an eligibility decision per flag.
 * Used by `schedule-eligibility.ts` to replace the stubbed PASSING checks
 * with truth from the importer.
 *
 * Conservative policy: UNKNOWN counts as a blocker. The selector must
 * never pick engine2 for input it cannot classify.
 */
export interface CapabilityEligibilityFinding {
  flagId: CapabilityFlagId;
  blocker: boolean;
  verdict: CapabilityVerdict;
  detail?: string;
}

export function projectCapabilityEligibility(
  meta: ScheduleCapabilityMetadata | undefined,
): CapabilityEligibilityFinding[] {
  const m = meta ?? defaultCapabilityMetadata();
  return m.flags.map((f) => ({
    flagId: f.id,
    verdict: f.verdict,
    detail: f.detail,
    blocker: f.verdict !== "pass", // unknown counts as blocker
  }));
}

/** Deterministic text projection for debug drawers and PRs. */
export function formatCapabilityMetadata(
  meta: ScheduleCapabilityMetadata | undefined,
): string {
  const m = meta ?? defaultCapabilityMetadata();
  const lines: string[] = [];
  lines.push(`capability metadata (v${m.version}, source=${m.source})`);
  if (m.derivedAt) lines.push(`derivedAt=${m.derivedAt}`);
  for (const f of m.flags) {
    lines.push(
      `  [${f.verdict.toUpperCase()}] ${f.id}${f.evidenceCount ? ` (n=${f.evidenceCount})` : ""}${
        f.detail ? ` — ${f.detail}` : ""
      }`,
    );
  }
  return lines.join("\n");
}
