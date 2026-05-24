/**
 * Schedule Intelligence — AI-1 (UI/context only).
 *
 * Pure, deterministic helpers backing the Schedule Intelligence drawer's
 * Chat shell. This module:
 *
 *   - Defines the drawer's mode union and a reducer for mode switching.
 *   - Owns the starter prompt catalog used by the Chat shell.
 *   - Serializes the live schedule into an AI-ready context snapshot.
 *
 * Guardrails (per docs/schedule-intelligence-ai-spec.md §5, §9, §10):
 *
 *   - This module NEVER mutates the schedule. Every function takes its
 *     inputs by reference and returns plain JSON-shaped data.
 *   - It performs NO AI calls and NO network I/O.
 *   - It does NOT run the scheduler engine. Legacy `calculateSchedule`
 *     remains the production authority — this file only reads results.
 *   - The serializer is the future bridge to an AI service; AI-1 stops at
 *     "prepared context", per the spec.
 */

import type {
  Schedule,
  ScheduleResult,
  ScheduledTask,
} from "./types";

// ---------------------------------------------------------------------------
// Drawer modes
// ---------------------------------------------------------------------------

export type IntelDrawerMode = "review" | "chat" | "build";

export const INTEL_DRAWER_MODES: readonly IntelDrawerMode[] = [
  "review",
  "chat",
  "build",
] as const;

export function isIntelDrawerMode(v: unknown): v is IntelDrawerMode {
  return (
    typeof v === "string" &&
    (INTEL_DRAWER_MODES as readonly string[]).includes(v)
  );
}

/**
 * Pure mode reducer. Returns the next mode when valid; otherwise returns
 * the current mode unchanged. No side effects.
 */
export function nextIntelDrawerMode(
  current: IntelDrawerMode,
  requested: unknown,
): IntelDrawerMode {
  return isIntelDrawerMode(requested) ? requested : current;
}

// ---------------------------------------------------------------------------
// Starter prompts (Chat shell)
// ---------------------------------------------------------------------------

export const INTEL_STARTER_PROMPTS: readonly string[] = [
  "Explain the critical path.",
  "What should I review first?",
  "Why is this activity near-critical?",
  "What looks risky in this schedule?",
  "What would you fix before issuing this schedule?",
] as const;

export const INTEL_ADVISORY_NOTE =
  "Assistant suggestions are advisory. Schedule changes require approval.";

// ---------------------------------------------------------------------------
// Schedule context serializer
// ---------------------------------------------------------------------------

export interface IntelActivitySummary {
  id: string;
  name: string;
  totalFloat: number;
  isCritical: boolean;
  earlyStartDate?: string;
  earlyFinishDate?: string;
  percentComplete?: number;
}

export interface IntelFinding {
  id: string;
  label: string;
  detail: string;
  severity: "high" | "med" | "low";
  count: number;
}

export interface IntelScheduleContext {
  /** Spec version of the serializer output. Bump when shape changes. */
  version: 1;
  projectName: string | null;
  dataDate: string | null;
  projectFinishDate: string | null;
  projectStartDate: string | null;
  counts: {
    activities: number;
    critical: number;
    nearCritical: number;
    completed: number;
    inProgress: number;
  };
  nearCriticalFloorDays: number;
  nearCriticalActivities: IntelActivitySummary[];
  selectedActivity: IntelActivitySummary | null;
  findings: IntelFinding[];
  generatedAt: string;
}

function summarize(t: ScheduledTask): IntelActivitySummary {
  return {
    id: t.id,
    name: t.name,
    totalFloat: t.totalFloat,
    isCritical: t.isCritical,
    earlyStartDate: t.earlyStartDate,
    earlyFinishDate: t.earlyFinishDate,
    percentComplete: t.percentComplete,
  };
}

export interface BuildIntelScheduleContextInput {
  draft: Schedule | null;
  computed: ScheduleResult | null;
  selectedTask?: ScheduledTask | null;
  nearCriticalFloor?: number;
  findings?: IntelFinding[];
  /** Override for deterministic testing; defaults to `new Date().toISOString()`. */
  now?: () => string;
  /** Max near-critical activities to include in the snapshot. */
  nearCriticalLimit?: number;
}

/**
 * Build a deterministic, AI-ready snapshot of the current schedule.
 *
 * Read-only. Performs no engine computation, no network, no mutation.
 * Safe to call on every render — but callers should memoize.
 */
export function buildIntelScheduleContext(
  input: BuildIntelScheduleContextInput,
): IntelScheduleContext {
  const {
    draft,
    computed,
    selectedTask = null,
    nearCriticalFloor = 5,
    findings = [],
    now = () => new Date().toISOString(),
    nearCriticalLimit = 20,
  } = input;

  if (!draft || !computed) {
    return {
      version: 1,
      projectName: draft?.name ?? null,
      dataDate: draft?.dataDate ?? null,
      projectFinishDate: null,
      projectStartDate: draft?.projectStartDate ?? null,
      counts: {
        activities: 0,
        critical: 0,
        nearCritical: 0,
        completed: 0,
        inProgress: 0,
      },
      nearCriticalFloorDays: nearCriticalFloor,
      nearCriticalActivities: [],
      selectedActivity: selectedTask ? summarize(selectedTask) : null,
      findings: [...findings],
      generatedAt: now(),
    };
  }

  const tasks = computed.tasks;
  const critical = tasks.filter((t) => t.isCritical);
  const nearCritical = tasks.filter(
    (t) => !t.isCritical && t.totalFloat > 0 && t.totalFloat <= nearCriticalFloor,
  );
  const completed = tasks.filter((t) => (t.percentComplete ?? 0) >= 100);
  const inProgress = tasks.filter((t) => {
    const p = t.percentComplete ?? 0;
    return p > 0 && p < 100;
  });

  // Sort near-critical by ascending float, then id, for deterministic output.
  const nearCriticalSorted = [...nearCritical]
    .sort((a, b) => a.totalFloat - b.totalFloat || a.id.localeCompare(b.id))
    .slice(0, nearCriticalLimit)
    .map(summarize);

  return {
    version: 1,
    projectName: draft.name ?? null,
    dataDate: draft.dataDate ?? null,
    projectFinishDate: computed.projectFinishDate ?? null,
    projectStartDate: draft.projectStartDate ?? null,
    counts: {
      activities: tasks.length,
      critical: critical.length,
      nearCritical: nearCritical.length,
      completed: completed.length,
      inProgress: inProgress.length,
    },
    nearCriticalFloorDays: nearCriticalFloor,
    nearCriticalActivities: nearCriticalSorted,
    selectedActivity: selectedTask ? summarize(selectedTask) : null,
    findings: findings.map((f) => ({ ...f })),
    generatedAt: now(),
  };
}
