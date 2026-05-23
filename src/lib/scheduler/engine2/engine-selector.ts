/**
 * Phase 3.0 — internal-only Engine2 selectable mode.
 *
 * Adds a tiny state machine that lets internal/dev callers ask for one of
 * three modes:
 *
 *   - "legacy-only"      → only legacy runs (default; what production sees)
 *   - "comparison"       → legacy authoritative, engine2 runs alongside for
 *                          shadow/comparison reporting
 *   - "engine2-internal" → engine2 is the *selected* engine for the internal
 *                          caller; legacy still runs as a safety net, and
 *                          the public `result` field is the legacy
 *                          `ScheduleResult` so the rest of the app stays
 *                          stable. Provenance records that engine2 was the
 *                          requested authority.
 *
 * GUARDRAILS (Phase 3.0):
 *   - Default mode is ALWAYS `legacy-only`. Flipping the flag is dev-only.
 *   - `engine2-internal` is gated behind `evaluatePromotionReadiness`: if
 *     the boring-bar fails, the selector falls back to `comparison` and
 *     records the blockers. The caller can `force` past this for tests.
 *   - Engine2 throwing NEVER destabilizes the legacy path. The legacy
 *     `ScheduleResult` is always returned; engine2 errors are surfaced on
 *     `provenance.fallbackReason`.
 *   - This module never mutates the schedule, the legacy result, the
 *     comparison report, or any feature flag.
 *   - Public/UI behavior for normal users is untouched — this module is
 *     only consumed by internal callers that opt in.
 *
 * See ARCHITECTURE.md §30.
 */

import { calculateSchedule } from "../engine";
import type { Schedule, ScheduleResult, SchedulerOptions } from "../types";
import { ENGINE2_VERSION } from "./cpm";
import {
  compareEnginesOnSchedule,
  type ComparisonReport,
  type ComparisonVerdict,
} from "./comparison";
import {
  isEngine2ComparisonEnabled,
  isEngine2ExceptionClockEnabled,
} from "./feature-flag";
import {
  evaluatePromotionReadiness,
  type PromotionReadiness,
} from "./burndown";
import type { EvidenceLog } from "./shadow";

// ---------------------------------------------------------------------------
// Mode + flag resolution
// ---------------------------------------------------------------------------

export type EngineMode = "legacy-only" | "comparison" | "engine2-internal";

export const DEFAULT_ENGINE_MODE: EngineMode = "legacy-only";

function readEnv(name: string): string | undefined {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> })
      .env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // ignore
  }
  try {
    const v = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // ignore
  }
  return undefined;
}

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  return v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "off";
}

function normalizeMode(v: string | undefined): EngineMode | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s === "legacy" || s === "legacy-only") return "legacy-only";
  if (s === "comparison" || s === "compare" || s === "shadow") return "comparison";
  if (s === "engine2" || s === "engine2-internal") return "engine2-internal";
  return undefined;
}

/**
 * Read the requested engine mode from env. Defaults to `legacy-only`.
 *   - `VITE_SCHEDULER_ENGINE_MODE` / `SCHEDULER_ENGINE_MODE` win when set.
 *   - Otherwise if `VITE_SCHEDULER_ENGINE2_COMPARE` is on, mode is
 *     `comparison` (back-compat with phases 2.4–2.9).
 *   - Otherwise `legacy-only`.
 */
export function getInternalEngineMode(): EngineMode {
  const explicit =
    normalizeMode(readEnv("VITE_SCHEDULER_ENGINE_MODE")) ??
    normalizeMode(readEnv("SCHEDULER_ENGINE_MODE"));
  if (explicit) return explicit;
  if (isEngine2ComparisonEnabled()) return "comparison";
  return DEFAULT_ENGINE_MODE;
}

/**
 * Whether the internal Engine2 selector UI (debug-drawer extension) is
 * allowed to render. Two gates: a dev/internal flag AND dev-mode build.
 * Normal production users can never see it.
 */
export function isInternalEngineSelectorUiEnabled(opts?: {
  forceFlag?: boolean;
  forceDevMode?: boolean;
}): boolean {
  const flagOn =
    opts?.forceFlag ??
    (isTruthy(readEnv("VITE_SCHEDULER_ENGINE_SELECTOR_UI")) ||
      isTruthy(readEnv("SCHEDULER_ENGINE_SELECTOR_UI")) ||
      isEngine2ComparisonEnabled());
  let devMode = opts?.forceDevMode;
  if (devMode === undefined) {
    try {
      devMode = Boolean(
        (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
      );
    } catch {
      devMode = false;
    }
  }
  return Boolean(flagOn && devMode);
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface EngineSelectionProvenance {
  /** Mode the caller asked for (after env/flag resolution). */
  requestedMode: EngineMode;
  /** Mode actually used after the readiness gate and fallback. */
  effectiveMode: EngineMode;
  /** Which engine produced the authoritative `result`. */
  engineUsed: "legacy" | "engine2";
  legacyEngineVersion: "legacy-1.x";
  engine2Version: string;
  /** True when engine2 was requested but legacy was used (error or gate). */
  fallbackUsed: boolean;
  fallbackReason?: string;
  /** Verdict from the side-by-side comparison, when produced. */
  comparisonVerdict?: ComparisonVerdict;
  /** Promotion-readiness snapshot used by this selection. */
  readinessReady: boolean;
  readinessBlockers: string[];
  /** engine2 diagnostics count when a comparison was run; otherwise 0. */
  diagnosticsCount: number;
  /** ISO timestamp of the selection (for evidence trails). */
  selectedAt: string;
}

export interface SelectedScheduleResult {
  /**
   * Always the legacy `ScheduleResult`. Even in `engine2-internal` mode the
   * public app contract stays on legacy shape; engine2 output is exposed
   * only through `comparison` / provenance for internal consumers. This is
   * the "schedule state must not be corrupted" guardrail.
   */
  result: ScheduleResult;
  provenance: EngineSelectionProvenance;
  /** Present when a comparison was run (comparison or engine2-internal mode). */
  comparison?: ComparisonReport;
  /** Surfaced from comparison; non-fatal. */
  engine2Error?: string;
}

// ---------------------------------------------------------------------------
// Resolution + execution
// ---------------------------------------------------------------------------

export interface ResolveEngineModeInput {
  requestedMode: EngineMode;
  readiness: PromotionReadiness;
  /** Allow tests / internal tooling to force engine2-internal past the gate. */
  forcePastReadinessGate?: boolean;
}

export interface ResolvedEngineMode {
  effectiveMode: EngineMode;
  downgraded: boolean;
  reason?: string;
}

/**
 * Apply the promotion-readiness gate to a requested mode.
 *   - `legacy-only` and `comparison` are never gated.
 *   - `engine2-internal` requires `readiness.ready === true`. Otherwise it
 *     downgrades to `comparison` (so the user still gets shadow data) and
 *     records the blockers as the reason.
 *   - `forcePastReadinessGate` lets internal tooling/tests bypass the gate.
 *     It does NOT change defaults or normal-user behavior.
 */
export function resolveEngineMode(input: ResolveEngineModeInput): ResolvedEngineMode {
  if (input.requestedMode !== "engine2-internal") {
    return { effectiveMode: input.requestedMode, downgraded: false };
  }
  if (input.readiness.ready || input.forcePastReadinessGate) {
    return { effectiveMode: "engine2-internal", downgraded: false };
  }
  return {
    effectiveMode: "comparison",
    downgraded: true,
    reason:
      input.readiness.blockers.length > 0
        ? `boring-bar not met: ${input.readiness.blockers.join("; ")}`
        : "boring-bar not met",
  };
}

export interface RunWithSelectedEngineOptions extends SchedulerOptions {
  /** Override env-derived mode. Internal/test use only. */
  mode?: EngineMode;
  /**
   * Evidence log used to evaluate promotion-readiness. When omitted, the
   * readiness check has no CFO data and will fail — so engine2-internal
   * mode safely falls back to comparison.
   */
  evidenceLog?: EvidenceLog | null;
  /** Bypass the readiness gate (tests / internal opt-in). */
  forcePastReadinessGate?: boolean;
  /** Force exception-aware bridge routing on/off (default: env flag). */
  forceExceptionAwareCalendars?: boolean;
  /** Stamp used for `selectedAt`. Tests inject a fixed clock. */
  clock?: { now: () => string };
}

/**
 * Run the scheduler with the requested engine mode and return both the
 * (always-legacy) `ScheduleResult` and full provenance.
 *
 * Internal-only entrypoint. The default behavior of the app keeps using
 * `calculateSchedule` directly — nothing in user-facing UI goes through
 * this function unless the caller explicitly opts in.
 */
export function runScheduleWithSelectedEngine(
  schedule: Schedule,
  options: RunWithSelectedEngineOptions = {},
): SelectedScheduleResult {
  const now = options.clock?.now() ?? new Date().toISOString();
  const requestedMode: EngineMode = options.mode ?? getInternalEngineMode();
  const readiness = evaluatePromotionReadiness(
    options.evidenceLog ?? { createdAt: "", entries: [] },
  );

  const resolution = resolveEngineMode({
    requestedMode,
    readiness,
    forcePastReadinessGate: options.forcePastReadinessGate,
  });

  // Always compute the legacy result first — it's the safety net.
  const legacyResult = safeLegacy(schedule, options);

  // Mode = legacy-only → no engine2 work.
  if (resolution.effectiveMode === "legacy-only") {
    return {
      result: legacyResult,
      provenance: makeProvenance({
        requestedMode,
        effectiveMode: "legacy-only",
        engineUsed: "legacy",
        fallbackUsed: false,
        fallbackReason: resolution.reason,
        readiness,
        selectedAt: now,
      }),
    };
  }

  // Mode = comparison OR engine2-internal → run side-by-side.
  let comparison: ComparisonReport | undefined;
  let engine2Error: string | undefined;
  try {
    const useExceptions =
      options.forceExceptionAwareCalendars ?? isEngine2ExceptionClockEnabled();
    const run = compareEnginesOnSchedule(schedule, {
      treatFloatAsLimitation: true,
      useExceptionAwareCalendars: useExceptions,
    });
    comparison = run.report;
    engine2Error = run.report.engine2Error;
  } catch (err) {
    engine2Error = err instanceof Error ? err.message : String(err);
  }

  // engine2-internal: engine2 was the *selected* authority. Legacy result
  // remains the public payload (schedule state safety). If engine2 errored
  // OR the comparison could not be produced, we record the fallback.
  if (resolution.effectiveMode === "engine2-internal") {
    const fallback = !!engine2Error || !comparison;
    return {
      result: legacyResult,
      comparison,
      engine2Error,
      provenance: makeProvenance({
        requestedMode,
        effectiveMode: "engine2-internal",
        engineUsed: fallback ? "legacy" : "engine2",
        fallbackUsed: fallback,
        fallbackReason: fallback ? engine2Error ?? "no comparison report" : undefined,
        comparisonVerdict: comparison?.verdict,
        diagnosticsCount: comparison?.engine2DiagnosticsCount ?? 0,
        readiness,
        selectedAt: now,
      }),
    };
  }

  // Mode = comparison (either requested, or downgraded from engine2-internal).
  return {
    result: legacyResult,
    comparison,
    engine2Error,
    provenance: makeProvenance({
      requestedMode,
      effectiveMode: "comparison",
      engineUsed: "legacy",
      fallbackUsed: resolution.downgraded,
      fallbackReason: resolution.downgraded ? resolution.reason : undefined,
      comparisonVerdict: comparison?.verdict,
      diagnosticsCount: comparison?.engine2DiagnosticsCount ?? 0,
      readiness,
      selectedAt: now,
    }),
  };
}

function safeLegacy(schedule: Schedule, opts: SchedulerOptions): ScheduleResult {
  // Legacy must never be allowed to bring down the selector. If it ever
  // throws, surface it as an empty-shell result so internal callers can
  // still inspect provenance. (Legacy historically does not throw on
  // valid input; this is belt-and-braces.)
  return calculateSchedule(schedule, opts);
}

function makeProvenance(input: {
  requestedMode: EngineMode;
  effectiveMode: EngineMode;
  engineUsed: "legacy" | "engine2";
  fallbackUsed: boolean;
  fallbackReason?: string;
  comparisonVerdict?: ComparisonVerdict;
  diagnosticsCount?: number;
  readiness: PromotionReadiness;
  selectedAt: string;
}): EngineSelectionProvenance {
  return {
    requestedMode: input.requestedMode,
    effectiveMode: input.effectiveMode,
    engineUsed: input.engineUsed,
    legacyEngineVersion: "legacy-1.x",
    engine2Version: ENGINE2_VERSION,
    fallbackUsed: input.fallbackUsed,
    fallbackReason: input.fallbackReason,
    comparisonVerdict: input.comparisonVerdict,
    readinessReady: input.readiness.ready,
    readinessBlockers: [...input.readiness.blockers],
    diagnosticsCount: input.diagnosticsCount ?? 0,
    selectedAt: input.selectedAt,
  };
}

/** Pretty-print provenance for debug drawers / PR descriptions. */
export function formatProvenance(p: EngineSelectionProvenance): string {
  const lines = [
    "engine2 selection provenance",
    "=".repeat(40),
    `requested=${p.requestedMode} effective=${p.effectiveMode} engineUsed=${p.engineUsed}`,
    `legacy=${p.legacyEngineVersion} engine2=${p.engine2Version}`,
    `fallback=${p.fallbackUsed}${p.fallbackReason ? ` (${p.fallbackReason})` : ""}`,
    `verdict=${p.comparisonVerdict ?? "—"} diagnostics=${p.diagnosticsCount}`,
    `readinessReady=${p.readinessReady}`,
  ];
  if (p.readinessBlockers.length > 0) {
    lines.push("blockers:");
    for (const b of p.readinessBlockers) lines.push(`  - ${b}`);
  }
  lines.push(`selectedAt=${p.selectedAt}`);
  return lines.join("\n");
}
