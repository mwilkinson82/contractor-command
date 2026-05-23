/**
 * Feature flag selecting between the legacy offset-based engine and the
 * new absolute-working-time-instant engine (engine2).
 *
 * Phase 1.0: production defaults to LEGACY. engine2 is opt-in for tests and
 * local development only. Flipping this flag does NOT yet change behavior —
 * the engine2 CPM passes are not implemented until Phase 1.1.
 *
 * Resolution order:
 *   1. `import.meta.env.VITE_SCHEDULER_ENGINE` if set ("legacy" | "engine2").
 *   2. `process.env.SCHEDULER_ENGINE` (server-side / tests).
 *   3. Default: "legacy".
 */

export type SchedulerEngineChoice = "legacy" | "engine2";

const DEFAULT: SchedulerEngineChoice = "legacy";

function readEnv(name: string): string | undefined {
  // Vite client: import.meta.env
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // ignore
  }
  // Node/server: process.env
  try {
    const v = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.[name];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // ignore
  }
  return undefined;
}

function normalize(v: string | undefined): SchedulerEngineChoice {
  return v === "engine2" ? "engine2" : "legacy";
}

export function getSchedulerEngine(): SchedulerEngineChoice {
  const fromVite = readEnv("VITE_SCHEDULER_ENGINE");
  if (fromVite) return normalize(fromVite);
  const fromNode = readEnv("SCHEDULER_ENGINE");
  if (fromNode) return normalize(fromNode);
  return DEFAULT;
}

/** Convenience for tests / dev. Returns the constant identifier, never throws. */
export const SCHEDULER_ENGINE_LEGACY: SchedulerEngineChoice = "legacy";
export const SCHEDULER_ENGINE_ENGINE2: SchedulerEngineChoice = "engine2";

/**
 * Phase 2.4 — internal-only side-by-side comparison flag.
 *
 * When enabled, callers that opt in (e.g. `calculateScheduleWithEngine2Comparison`)
 * will additionally run engine2 against the same inputs and attach a
 * `ComparisonReport`. Legacy output is NEVER overwritten by this flag.
 *
 * Resolution order:
 *   1. `import.meta.env.VITE_SCHEDULER_ENGINE2_COMPARE` truthy.
 *   2. `process.env.SCHEDULER_ENGINE2_COMPARE` truthy.
 *   3. Default: off.
 */
export function isEngine2ComparisonEnabled(): boolean {
  const vals = [
    readEnv("VITE_SCHEDULER_ENGINE2_COMPARE"),
    readEnv("SCHEDULER_ENGINE2_COMPARE"),
  ];
  for (const v of vals) {
    if (v && v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "off") {
      return true;
    }
  }
  return false;
}

/**
 * Phase 2.5 — dev-only opt-in: route the legacy bridge through the
 * exception-aware WorkClock instead of the whole-day fallback.
 *
 * Default: off. This flag exists so the routing path can be exercised
 * before real exception data is bridged from XER or legacy inputs.
 * Resolution order:
 *   1. `import.meta.env.VITE_SCHEDULER_ENGINE2_EXCEPTION_CLOCK` truthy.
 *   2. `process.env.SCHEDULER_ENGINE2_EXCEPTION_CLOCK` truthy.
 *   3. Default: off.
 */
export function isEngine2ExceptionClockEnabled(): boolean {
  const vals = [
    readEnv("VITE_SCHEDULER_ENGINE2_EXCEPTION_CLOCK"),
    readEnv("SCHEDULER_ENGINE2_EXCEPTION_CLOCK"),
  ];
  for (const v of vals) {
    if (v && v !== "0" && v.toLowerCase() !== "false" && v.toLowerCase() !== "off") {
      return true;
    }
  }
  return false;
}

