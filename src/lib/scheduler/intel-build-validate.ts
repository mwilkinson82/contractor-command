/**
 * Schedule Intelligence — Build Mode validator (AI-4).
 *
 * Pure, client-safe Zod validation for the DraftSchedule artifact and
 * for the forgiving intermediate shape we ask the AI to return. This
 * module performs NO network calls, NO engine calls, NO mutations. It
 * is safe to import from both the server function and the UI.
 *
 * Guardrails (per docs/schedule-intelligence-ai-spec.md §5, §9):
 *   - Validation never reaches into the live `Schedule` model.
 *   - `parseAiDraftPayload` enforces source = "activity_list" and
 *     status = "draft" on the way out so an AI cannot smuggle in a
 *     pre-approved / pre-committed artifact.
 *   - Relationship integrity is checked: every predecessor/successor
 *     must resolve to a real draft activity, otherwise the payload is
 *     rejected. The Build workspace never renders an invalid draft.
 */

import { z } from "zod";

import {
  type DependencyType,
  type Schedule,
} from "./types";
import type {
  DraftActivity,
  DraftAssumption,
  DraftMilestone,
  DraftQuestion,
  DraftRelationship,
  DraftSchedule,
  DraftSeverity,
  DraftWarning,
  DraftWbsNode,
} from "./intel-build";

// ---------------------------------------------------------------------------
// Strict schema for a fully-formed DraftSchedule (used in tests + as a final
// gate after sanitization). Intentionally close to the TypeScript types in
// intel-build.ts so the shapes cannot drift apart silently.
// ---------------------------------------------------------------------------

const DependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
const SeveritySchema = z.enum(["info", "warn", "error"]);

const WbsNodeSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(160),
  parentId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});

const ActivitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  wbsId: z.string().min(1).optional(),
  durationDays: z.number().int().min(0).max(365).optional(),
  isMilestone: z.boolean().optional(),
  resourceLabel: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  assumed: z.boolean().optional(),
});

const RelationshipSchema = z.object({
  id: z.string().min(1),
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: DependencyTypeSchema,
  lag: z.number().int().min(-90).max(180).optional(),
  rationale: z.string().max(400).optional(),
});

const MilestoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  targetDate: z.string().max(40).optional(),
  activityId: z.string().min(1).optional(),
});

const AssumptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(240),
  detail: z.string().max(800).optional(),
});

const QuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(400),
  context: z.string().max(800).optional(),
});

const WarningSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  message: z.string().min(1).max(400),
});

export const DraftScheduleSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  source: z.enum([
    "manual_prompt",
    "activity_list",
    "schedule_of_values",
    "estimate",
    "uploaded_document",
  ]),
  status: z.enum(["draft", "reviewed", "approved", "rejected"]),
  inputText: z.string().max(20000).optional(),
  wbs: z.array(WbsNodeSchema).max(200),
  activities: z.array(ActivitySchema).min(1).max(300),
  relationships: z.array(RelationshipSchema).max(600),
  milestones: z.array(MilestoneSchema).max(60),
  assumptions: z.array(AssumptionSchema).max(60),
  questions: z.array(QuestionSchema).max(60),
  warnings: z.array(WarningSchema).max(60),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/**
 * Validates an already-built DraftSchedule and additionally enforces
 * cross-field integrity (relationships + milestones reference real
 * activities; wbs ids resolve when used).
 */
export function validateDraftSchedule(input: unknown): DraftSchedule {
  const draft = DraftScheduleSchema.parse(input);

  const actIds = new Set(draft.activities.map((a) => a.id));
  const wbsIds = new Set(draft.wbs.map((w) => w.id));

  for (const a of draft.activities) {
    if (a.wbsId && !wbsIds.has(a.wbsId)) {
      throw new Error(`Activity "${a.name}" references missing WBS id ${a.wbsId}.`);
    }
  }
  for (const r of draft.relationships) {
    if (!actIds.has(r.predecessorId)) {
      throw new Error(`Relationship ${r.id} references missing predecessor ${r.predecessorId}.`);
    }
    if (!actIds.has(r.successorId)) {
      throw new Error(`Relationship ${r.id} references missing successor ${r.successorId}.`);
    }
    if (r.predecessorId === r.successorId) {
      throw new Error(`Relationship ${r.id} is a self-loop.`);
    }
  }
  for (const m of draft.milestones) {
    if (m.activityId && !actIds.has(m.activityId)) {
      throw new Error(`Milestone "${m.name}" references missing activity ${m.activityId}.`);
    }
  }

  return draft as DraftSchedule;
}

// ---------------------------------------------------------------------------
// Forgiving intermediate shape: this is what we ask the AI to return when
// turning an activity-list paste into a draft. Activities and dependencies
// reference each other by NAME (not id) because language models are
// extremely bad at inventing and re-using stable opaque ids. We mint the
// real ids in `assembleDraftFromActivityList`.
// ---------------------------------------------------------------------------

const AiWbsSectionSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(160),
});

const AiActivityInputSchema = z.object({
  name: z.string().min(1).max(200),
  durationDays: z.number().min(0).max(365).optional(),
  wbsName: z.string().min(1).max(160).optional(),
  isMilestone: z.boolean().optional(),
  assumed: z.boolean().optional(),
  notes: z.string().max(400).optional(),
  /** Names of predecessor activities. Strings, not ids. */
  dependsOn: z.array(z.string().min(1).max(200)).max(10).optional(),
});

const AiMilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  /** Optional activity name this milestone caps. */
  activityName: z.string().min(1).max(200).optional(),
});

export const AiDraftPayloadSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  wbsSections: z.array(AiWbsSectionSchema).max(40).optional(),
  activities: z.array(AiActivityInputSchema).min(1).max(120),
  milestones: z.array(AiMilestoneSchema).max(30).optional(),
  assumptions: z.array(z.string().min(1).max(240)).max(30).optional(),
  questions: z.array(z.string().min(1).max(400)).max(30).optional(),
  warnings: z.array(z.string().min(1).max(400)).max(20).optional(),
});

export type AiDraftPayload = z.infer<typeof AiDraftPayloadSchema>;

// ---------------------------------------------------------------------------
// Assembly: AI payload → strict DraftSchedule (with deterministic IDs).
// ---------------------------------------------------------------------------

function slug(s: string, fallback: string): string {
  const base = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return base || fallback;
}

export interface AssembleInput {
  payload: AiDraftPayload;
  inputText: string;
  now?: () => string;
  /** Override the generated draft id; mostly for tests. */
  draftId?: string;
}

/**
 * Convert a forgiving AI payload into a strict, validated DraftSchedule.
 * Hard-pins source = "activity_list" and status = "draft".
 *
 * Throws if the payload cannot be assembled into a valid draft (e.g.
 * fewer than one activity, malformed relationships).
 */
export function assembleDraftFromActivityList(input: AssembleInput): DraftSchedule {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const draftId = input.draftId ?? `draft-al-${Date.now().toString(36)}`;

  // 1. WBS sections, deduped by name.
  const seenWbs = new Map<string, DraftWbsNode>();
  const wbs: DraftWbsNode[] = [];
  for (const s of input.payload.wbsSections ?? []) {
    const key = s.name.toLowerCase();
    if (seenWbs.has(key)) continue;
    const node: DraftWbsNode = {
      id: `w-${slug(s.name, `s${wbs.length + 1}`)}`,
      code: s.code,
      name: s.name,
    };
    seenWbs.set(key, node);
    wbs.push(node);
  }

  // 2. Activities, deduped by name.
  const actByName = new Map<string, DraftActivity>();
  const activities: DraftActivity[] = [];
  for (const a of input.payload.activities) {
    const key = a.name.toLowerCase().trim();
    if (actByName.has(key)) continue;

    const wbsMatch = a.wbsName
      ? seenWbs.get(a.wbsName.toLowerCase())
      : undefined;

    const act: DraftActivity = {
      id: `a-${slug(a.name, `act${activities.length + 1}`)}-${activities.length + 1}`,
      name: a.name.trim(),
      wbsId: wbsMatch?.id,
      durationDays:
        typeof a.durationDays === "number" && a.durationDays >= 0
          ? Math.round(a.durationDays)
          : a.isMilestone
            ? 0
            : 1,
      isMilestone: a.isMilestone === true,
      assumed: a.assumed !== false, // default true: AI-derived durations are assumptions
      notes: a.notes?.trim() || undefined,
    };
    actByName.set(key, act);
    activities.push(act);
  }
  if (activities.length === 0) {
    throw new Error("Draft payload produced no activities.");
  }

  // 3. Relationships from dependsOn (names). Anything that doesn't resolve
  //    is silently dropped — we surface a warning instead of failing the
  //    whole draft. If no explicit dependsOn exists, fall back to a linear
  //    FS chain so the artifact is still meaningful for review.
  const relationships: DraftRelationship[] = [];
  const droppedDeps: string[] = [];
  let anyExplicit = false;

  for (let i = 0; i < input.payload.activities.length; i++) {
    const raw = input.payload.activities[i];
    const successor = actByName.get(raw.name.toLowerCase().trim());
    if (!successor) continue;
    if (!raw.dependsOn || raw.dependsOn.length === 0) continue;
    anyExplicit = true;

    for (const depName of raw.dependsOn) {
      const predecessor = actByName.get(depName.toLowerCase().trim());
      if (!predecessor || predecessor.id === successor.id) {
        droppedDeps.push(`${depName} → ${raw.name}`);
        continue;
      }
      const id = `r-${relationships.length + 1}`;
      relationships.push({
        id,
        predecessorId: predecessor.id,
        successorId: successor.id,
        type: "FS" as DependencyType,
      });
    }
  }

  if (!anyExplicit) {
    // Linear FS chain in given order.
    for (let i = 1; i < activities.length; i++) {
      relationships.push({
        id: `r-${i}`,
        predecessorId: activities[i - 1].id,
        successorId: activities[i].id,
        type: "FS" as DependencyType,
      });
    }
  }

  // 4. Milestones (explicit). Activities flagged isMilestone are NOT
  //    duplicated here — they already render as milestones in the
  //    activity panel and contribute to the change set.
  const milestones: DraftMilestone[] = (input.payload.milestones ?? []).map((m, idx) => {
    const tied = m.activityName
      ? actByName.get(m.activityName.toLowerCase().trim())
      : undefined;
    return {
      id: `m-${idx + 1}`,
      name: m.name,
      activityId: tied?.id,
    } satisfies DraftMilestone;
  });

  // 5. Assumptions, questions, warnings.
  const baseAssumptions: DraftAssumption[] = (input.payload.assumptions ?? []).map((label, i) => ({
    id: `as-${i + 1}`,
    label,
  }));
  // Always pin the “durations are planning assumptions” fact so the UI is
  // honest even if the model forgot it.
  const assumptions: DraftAssumption[] = [
    {
      id: "as-core-1",
      label: "Durations are planning assumptions, not committed dates.",
      detail: "Confirm each duration with the responsible sub or PM before approval.",
    },
    ...baseAssumptions,
  ];

  const questions: DraftQuestion[] = (input.payload.questions ?? []).map((q, i) => ({
    id: `q-${i + 1}`,
    question: q,
  }));

  const warnings: DraftWarning[] = (input.payload.warnings ?? []).map((message, i) => ({
    id: `wn-${i + 1}`,
    severity: "warn" as DraftSeverity,
    message,
  }));
  // System-generated, honest warning every activity-list draft gets.
  warnings.unshift({
    id: "wn-core-1",
    severity: "warn",
    message:
      "AI-generated logic must be reviewed by a scheduler or contractor before approval.",
  });
  if (droppedDeps.length > 0) {
    warnings.push({
      id: "wn-deps",
      severity: "info",
      message: `Dropped ${droppedDeps.length} relationship(s) that didn't match an activity.`,
    });
  }
  if (!anyExplicit) {
    warnings.push({
      id: "wn-linear",
      severity: "info",
      message:
        "No explicit predecessors provided — relationships are a linear Finish-to-Start chain in the order pasted. Review and add parallelism where appropriate.",
    });
  }

  // 6. Final assembly. Pin source + status.
  const draft: DraftSchedule = {
    version: 1,
    id: draftId,
    name: input.payload.name?.trim() || "Draft from activity list",
    source: "activity_list",
    status: "draft",
    inputText: input.inputText,
    wbs,
    activities,
    relationships,
    milestones,
    assumptions,
    questions,
    warnings,
    createdAt: now,
    updatedAt: now,
  };

  return validateDraftSchedule(draft);
}

// ---------------------------------------------------------------------------
// Guardrail: a DraftSchedule must NEVER be confused with a live Schedule.
// This helper is used by tests to prove the types are kept distinct.
// ---------------------------------------------------------------------------

export function draftIsNotLiveSchedule(draft: DraftSchedule, live: Schedule | null): boolean {
  // Different IDs. Different shapes. We never accept a draft that claims
  // to be the live schedule.
  if (!live) return true;
  return draft.id !== live.id;
}
