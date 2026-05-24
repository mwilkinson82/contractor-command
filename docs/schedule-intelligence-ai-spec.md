# Schedule Intelligence AI — Product & Technical Specification

Status: **Spec only.** No AI implementation, no engine changes, no UI changes, no persistence changes. Legacy `calculateSchedule` remains the production authority.

This document defines the future Schedule Intelligence assistant inside the Baseline / AOS CPM scheduler.

---

## 1. Product Vision

Baseline is not just a prettier Gantt chart. It should become a **CPM command center** that can:

- Explain a construction schedule in plain English.
- Review logic, float, and critical path quality.
- Identify risks and weak sequencing.
- Recommend concrete schedule improvements.
- Help build a CPM from an activity list, scope narrative, or schedule of values.
- Refine a draft schedule through chat.
- Stage proposed changes for explicit user approval before any mutation.

The assistant is an advisor and drafting partner, not an autonomous scheduler. The human owns the schedule.

---

## 2. Assistant Modes

- **Review Mode** — comments on the current schedule (logic, float distribution, critical path, open ends, constraints, milestone realism).
- **Explain Mode** — answers questions about dates, float, critical path, relationships, and schedule quality.
- **Build Mode** — creates a draft CPM from user guidance (scope narrative, activity list, milestones).
- **SOV Mode** — converts a schedule of values / estimate breakdown into a proposed WBS + activities.
- **Refinement Mode** — helps revise durations, sequencing, milestones, and logic on an existing or draft schedule.
- **Approval Mode** — shows proposed changes as a reviewable change set before commit.

Modes are conceptual; a single chat thread can move between them.

---

## 3. Data the Assistant Can Read

Allowed schedule context:

- Project metadata (name, project start date, data date, default calendar).
- WBS hierarchy.
- Activities (id, name, duration, %complete, costs, resource label, calendar id).
- Computed scheduling fields: ES, EF, LS, LF, total float, free float, critical flag, dates.
- Relationships (from, to, type, lag) and driving-relationship flags.
- Milestones (zero-duration activities and explicit milestone annotations).
- Data date.
- Baseline data when available.
- Deterministic Schedule Intelligence findings already computed in the drawer.
- The currently selected activity, if any.

---

## 4. Data the Assistant Cannot Assume

The assistant must **not invent** the following without labeling them as assumptions and asking the user to confirm:

- Activity durations.
- Contractual or owner-imposed milestones.
- Resource availability or crew sizes.
- Procurement lead times.
- Owner constraints (access, phasing, work restrictions).
- Inspection or AHJ requirements.
- Weather days or calendar exceptions.
- Cost-to-activity or SOV-to-WBS mapping.

When the assistant needs one of these to proceed, it must ask, or mark the value as **Assumption** in the proposed change set.

---

## 5. Guardrails

- AI suggestions are **advisory** until explicitly approved.
- The AI **cannot mutate** the schedule directly. No silent writes.
- Every proposed change must be previewed in a structured change set.
- User approval is required before adding or editing activities, relationships, durations, calendars, milestones, or WBS.
- The AI must **distinguish facts from assumptions** in every output.
- Legacy `calculateSchedule` remains the production authority. AI does not produce computed dates; the engine does, after a change set is committed.
- The AI must not claim certainty about external constraints it cannot read.

---

## 6. Proposed UX

The Schedule Intelligence assistant lives in the existing right-side intelligence drawer.

Drawer states:

- **Collapsed summary** — one-line health + deterministic finding count, matches current Compact mode.
- **Chat / review panel** — conversational surface for Review and Explain modes; deterministic findings remain visible above.
- **Artifact-style draft schedule builder** — when in Build or SOV mode, the drawer hosts a structured artifact (proposed WBS, proposed activities table, proposed logic map). This is a workspace, not a chat reply.
- **Proposed activities table** — id, name, duration, WBS, predecessors, successors, source (user / AI / SOV / assumption).
- **Proposed logic map** — visual or tabular view of proposed relationships.
- **Approval checklist** — itemized review (activities to add, durations to change, relationships to add/remove, milestones to add).
- **Commit-to-schedule button** — disabled until the user walks the checklist. Commit triggers the existing schedule mutation paths and a re-run of legacy `calculateSchedule`.

The chat surface and the artifact surface live in the same drawer but are visually distinct.

---

## 7. Schedule Creation Workflow

Staged, user-gated process. Each step produces an artifact, not a side effect.

1. **Input** — user provides scope narrative, activity list, or SOV.
2. **WBS extraction** — assistant proposes a WBS structure.
3. **Activity proposal** — assistant proposes activities under that WBS.
4. **Duration proposal** — assistant proposes durations, each marked Fact (from input) or Assumption (AI estimate).
5. **Relationship proposal** — assistant proposes predecessor/successor logic with relationship type and lag.
6. **Assumptions & questions** — assistant surfaces a list of open questions and flagged assumptions.
7. **User edit / approval** — user edits the proposed artifact in place and walks the approval checklist.
8. **Commit** — system commits the approved artifact into the schedule. Legacy engine then computes ES/EF/LS/LF, float, and critical path.

The user can stop at any step. Nothing is written until step 8.

---

## 8. Review Workflow

Review on an existing schedule follows a fixed order so the deterministic layer stays primary:

1. **Deterministic findings first** — current Schedule Intelligence findings (open ends, missing logic, constraint use, float distribution, critical path summary).
2. **AI explanation second** — assistant explains what the findings mean in context.
3. **Recommendations third** — assistant proposes specific schedule improvements.
4. **Proposed changes fourth** — recommendations are converted into a structured change set (same shape as Build mode output).
5. **Approval required** — no mutation until the user walks the checklist and commits.

The AI never overrides or contradicts a deterministic finding; it explains and acts on it.

---

## 9. Future Technical Architecture

Likely implementation pieces (none built yet):

- **Schedule context serializer** — turns the in-memory schedule into a token-bounded, AI-readable snapshot (project metadata, WBS, activities, computed fields, relationships, deterministic findings, selected activity).
- **AI prompt / context builder** — assembles system prompt, mode, serialized schedule, deterministic findings, and user message.
- **Draft schedule artifact model** — typed structure for proposed WBS + activities + relationships + assumptions + questions, independent of the live `Schedule` model.
- **Proposed change set model** — typed diff: activities to add/edit/remove, relationships to add/edit/remove, milestones to add, durations to change, WBS edits. Each entry tagged Fact or Assumption with source.
- **Approval / commit layer** — converts an approved change set into existing scheduler mutations and triggers legacy `calculateSchedule`.
- **Audit log** — records every committed change set (who, when, what, source mode) for traceability.
- **Rollback path** — every commit produces a reversible snapshot so a bad AI-driven commit can be undone.
- **Deterministic findings as tool / context** — the existing static Schedule Intelligence becomes structured input to the AI, not a competing surface.
- **Future XER / SOV import pipeline** — feeds Build and SOV modes; out of scope for AI-1 through AI-3.

All AI calls run server-side through TanStack server functions; no API keys in the browser.

---

## 10. Phasing

Recommended phasing. Each phase is independently shippable and reversible.

- **AI-1** — Static drawer + chat shell. No mutations. No real model calls required to ship the shell.
- **AI-2** — Explain current schedule. Read-only Q&A over serialized schedule context. No proposed changes.
- **AI-3** — Schedule review + recommendations. Deterministic findings stay primary; AI adds plain-English review and suggested improvements. Still no mutations.
- **AI-4** — Activity-list to draft CPM. Build mode artifact, with proposed activities and durations. Commit gated.
- **AI-5** — SOV-to-WBS/activity draft. SOV mode artifact. Commit gated.
- **AI-6** — Proposed change sets + approval UX. Formalizes the change-set model and approval checklist across Review, Build, SOV, and Refinement modes.
- **AI-7** — Commit approved changes into the schedule. Wires the approval layer to existing mutation paths; legacy engine recomputes.

Engine, persistence, XER, dry-run, and scheduling behavior are **out of scope** for every AI phase. Engine2 remains unwired.

---

## Verification

- Documentation only.
- No code behavior changes.
- File created: `docs/schedule-intelligence-ai-spec.md`.
