/**
 * Schedule Intelligence — Build Mode models (scaffold only).
 *
 * Pure TypeScript types + constructors + guardrail helpers backing the
 * Build Mode workspace. This module defines the shape of two artifacts:
 *
 *   1. DraftSchedule — a non-authoritative, user-or-AI-drafted CPM
 *      proposal (WBS, activities, logic, milestones, assumptions,
 *      questions, warnings) that exists ENTIRELY OUTSIDE the production
 *      schedule. Drafts never touch `Schedule` or `calculateSchedule`.
 *
 *   2. ProposedChangeSet — a reviewable list of atomic mutations that
 *      could be applied to a production schedule. Nothing in this module
 *      applies them. The commit/apply layer is a future phase.
 *
 * Guardrails (per docs/schedule-intelligence-ai-spec.md §5, §9):
 *   - No engine calls. No network. No DB writes. No mutation of any
 *     existing Schedule.
 *   - Drafts and change sets are plain JSON. They MUST round-trip via
 *     `JSON.parse(JSON.stringify(x))` so they remain serializable across
 *     server function boundaries when the AI layer lands.
 *   - Every change in a ProposedChangeSet must carry a human-readable
 *     `rationale` so the future approval UI can render it.
 *
 * NOTE: These types intentionally do NOT extend the production `Task` /
 * `Dependency` types. Draft activities use string IDs that are scoped to
 * the draft and have no relationship to live task IDs until a commit
 * mapping is built in a later phase.
 */

import type { DependencyType } from "./types";

// ---------------------------------------------------------------------------
// Draft schedule artifact
// ---------------------------------------------------------------------------

export type DraftSourceType =
  | "manual_prompt"
  | "activity_list"
  | "schedule_of_values"
  | "estimate"
  | "uploaded_document";

export type DraftStatus = "draft" | "reviewed" | "approved" | "rejected";

export type DraftSeverity = "info" | "warn" | "error";

export interface DraftWbsNode {
  id: string;
  /** Dotted WBS code, e.g. "1.2.3". Optional for free-form sections. */
  code?: string;
  name: string;
  parentId?: string;
  notes?: string;
}

export interface DraftActivity {
  id: string;
  name: string;
  /** WBS node id this activity rolls up to. */
  wbsId?: string;
  durationDays?: number;
  isMilestone?: boolean;
  /** Optional crew/resource label for display only. */
  resourceLabel?: string;
  notes?: string;
  /** Free-form flag from the assistant, e.g. "duration assumed". */
  assumed?: boolean;
}

export interface DraftRelationship {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lag?: number;
  rationale?: string;
}

export interface DraftMilestone {
  id: string;
  name: string;
  /** Optional ISO date the user / assistant proposed. */
  targetDate?: string;
  /** Optional activity id this milestone is tied to. */
  activityId?: string;
}

export interface DraftAssumption {
  id: string;
  label: string;
  detail?: string;
}

export interface DraftQuestion {
  id: string;
  question: string;
  context?: string;
}

export interface DraftWarning {
  id: string;
  severity: DraftSeverity;
  message: string;
}

export interface DraftSchedule {
  /** Spec version of the draft shape. Bump when the schema changes. */
  version: 1;
  id: string;
  name: string;
  source: DraftSourceType;
  status: DraftStatus;
  /** Free-form text input that seeded this draft (e.g. pasted SOV). */
  inputText?: string;
  wbs: DraftWbsNode[];
  activities: DraftActivity[];
  relationships: DraftRelationship[];
  milestones: DraftMilestone[];
  assumptions: DraftAssumption[];
  questions: DraftQuestion[];
  warnings: DraftWarning[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmptyDraftInput {
  id: string;
  name: string;
  source: DraftSourceType;
  inputText?: string;
  now?: () => string;
}

export function createEmptyDraft(input: CreateEmptyDraftInput): DraftSchedule {
  const now = (input.now ?? (() => new Date().toISOString()))();
  return {
    version: 1,
    id: input.id,
    name: input.name,
    source: input.source,
    status: "draft",
    inputText: input.inputText,
    wbs: [],
    activities: [],
    relationships: [],
    milestones: [],
    assumptions: [],
    questions: [],
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** True if a draft has nothing the user has drafted yet. UI uses this for empty states. */
export function isEmptyDraft(d: DraftSchedule): boolean {
  return (
    d.wbs.length === 0 &&
    d.activities.length === 0 &&
    d.relationships.length === 0 &&
    d.milestones.length === 0 &&
    d.assumptions.length === 0 &&
    d.questions.length === 0 &&
    d.warnings.length === 0
  );
}

// ---------------------------------------------------------------------------
// Proposed change set
// ---------------------------------------------------------------------------

export type ProposedChangeKind =
  | "add_activity"
  | "update_activity"
  | "delete_activity"
  | "add_relationship"
  | "remove_relationship"
  | "add_milestone"
  | "update_duration"
  | "update_calendar"
  | "update_wbs";

interface ProposedChangeBase<K extends ProposedChangeKind, P> {
  id: string;
  kind: K;
  /** Human-readable explanation rendered in the approval UI. */
  rationale: string;
  /** Optional reference to a draft entity this change came from. */
  draftRefId?: string;
  payload: P;
}

export type ProposedChange =
  | ProposedChangeBase<"add_activity", {
      name: string;
      durationDays: number;
      wbs?: string;
      isMilestone?: boolean;
    }>
  | ProposedChangeBase<"update_activity", {
      taskId: string;
      patch: Partial<{
        name: string;
        wbs: string;
        resourceName: string;
        calendarId: string;
      }>;
    }>
  | ProposedChangeBase<"delete_activity", { taskId: string }>
  | ProposedChangeBase<"add_relationship", {
      from: string;
      to: string;
      type: DependencyType;
      lag?: number;
    }>
  | ProposedChangeBase<"remove_relationship", { dependencyId: string }>
  | ProposedChangeBase<"add_milestone", {
      name: string;
      targetDate?: string;
      activityId?: string;
    }>
  | ProposedChangeBase<"update_duration", {
      taskId: string;
      durationDays: number;
    }>
  | ProposedChangeBase<"update_calendar", {
      taskId?: string;
      calendarId: string;
    }>
  | ProposedChangeBase<"update_wbs", {
      taskId: string;
      wbs: string;
    }>;

export type ProposedChangeSetStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "committed";

export interface ProposedChangeSet {
  version: 1;
  id: string;
  /** Optional link back to the DraftSchedule this change set was derived from. */
  draftId?: string;
  /** Human-friendly title for the approval UI. */
  title: string;
  description?: string;
  status: ProposedChangeSetStatus;
  changes: ProposedChange[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmptyChangeSetInput {
  id: string;
  title: string;
  draftId?: string;
  description?: string;
  now?: () => string;
}

export function createEmptyChangeSet(
  input: CreateEmptyChangeSetInput,
): ProposedChangeSet {
  const now = (input.now ?? (() => new Date().toISOString()))();
  return {
    version: 1,
    id: input.id,
    draftId: input.draftId,
    title: input.title,
    description: input.description,
    status: "draft",
    changes: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Guardrail: a change set is committable only if it has been explicitly
 * approved and contains at least one change. The commit path itself does
 * not exist yet — this is just the gate that the future apply layer must
 * call before touching any production Schedule.
 */
export function isChangeSetCommittable(cs: ProposedChangeSet): boolean {
  return cs.status === "approved" && cs.changes.length > 0;
}

// ---------------------------------------------------------------------------
// Guardrail copy (used in Build Mode UI)
// ---------------------------------------------------------------------------

export const BUILD_GUARDRAILS: readonly string[] = [
  "AI suggestions are advisory.",
  "Assumptions are labeled and must be confirmed.",
  "Schedule changes require explicit approval.",
  "Nothing writes to the live schedule until you approve.",
  "Draft artifacts are kept separate from committed schedule data.",
] as const;
