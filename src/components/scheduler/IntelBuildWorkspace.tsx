/**
 * Schedule Intelligence — Build Mode workspace.
 *
 * Non-mutating CPM draft surface. No engine writes, no schedule mutation,
 * no Add-to-Schedule path. The UI exists so Build Mode reads as a first-class
 * workspace pillar instead of a drawer afterthought.
 *
 * UI-2.1b: when `expanded` (full-screen) we render a 3-column flagship
 * layout (Source Input | Draft Workspace | Review & Approve). When not
 * expanded (drawer host) we render the same sections stacked in a single
 * column. Business/draft state lives at the top so there is only one
 * source of truth across modes.
 *
 * See:
 *   - docs/schedule-intelligence-ai-spec.md §6 (Proposed UX)
 *   - docs/scheduler UI 2.0 architecture plan.md (UI-2.1b)
 *   - src/lib/scheduler/intel-build.ts (data shapes the eventual AI fills)
 */

import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BUILD_GUARDRAILS,
  isChangeSetCommittable,
  type DraftSchedule,
  type ProposedChangeSet,
} from "@/lib/scheduler/intel-build";
import {
  buildDemoDraftSchedule,
  buildPreviewChangeSet,
  countChangeSet,
} from "@/lib/scheduler/intel-build-demo";
import { generateDraftFromActivityList } from "@/lib/scheduler/intel-build-draft.functions";
import { INTEL_ADVISORY_NOTE } from "@/lib/scheduler/intel-context";

export interface IntelBuildWorkspaceProps {
  /**
   * When true, the workspace renders in flagship 3-column presentation
   * (full-screen Intel mode). When false, the same sections stack into a
   * single column for the drawer host.
   */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

type SourceKind =
  | "manual_prompt"
  | "activity_list"
  | "schedule_of_values"
  | "estimate"
  | "uploaded_document";

const SOURCE_OPTIONS: ReadonlyArray<{ id: SourceKind; label: string }> = [
  { id: "manual_prompt", label: "Describe the job" },
  { id: "activity_list", label: "Paste activity list" },
  { id: "schedule_of_values", label: "Paste SOV (soon)" },
  { id: "estimate", label: "Paste estimate (soon)" },
  { id: "uploaded_document", label: "Upload (soon)" },
];

/**
 * Dev-only smoke sample for AI-4. Used by the "Use sample activity list"
 * helper so live testing doesn't depend on browser automation injecting
 * text into a React-controlled textarea. Never rendered in production.
 */
const SAMPLE_ACTIVITY_LIST = [
  "Mobilize",
  "Clearing and grading",
  "Set trailer",
  "Temporary power",
  "Site utilities",
  "Foundations",
  "Framing",
  "Rough MEP",
  "Inspections",
  "Drywall",
  "Finishes",
  "Punchlist",
  "Closeout",
].join("\n");

const IS_DEV = import.meta.env.DEV;

const SOURCE_LABEL: Record<DraftSchedule["source"], string> = {
  manual_prompt: "Manual prompt",
  activity_list: "Activity list (AI-generated)",
  schedule_of_values: "Schedule of values",
  estimate: "Estimate",
  uploaded_document: "Uploaded document",
};

export function IntelBuildWorkspace({
  expanded,
  onToggleExpanded,
}: IntelBuildWorkspaceProps) {
  const [source, setSource] = useState<SourceKind>("activity_list");
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<DraftSchedule | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generateFn = useServerFn(generateDraftFromActivityList);

  const previewChangeSet = useMemo<ProposedChangeSet | null>(
    () => (draft ? buildPreviewChangeSet(draft) : null),
    [draft],
  );
  const changeCounts = useMemo(
    () => (previewChangeSet ? countChangeSet(previewChangeSet) : null),
    [previewChangeSet],
  );

  const canGenerateFromActivityList =
    source === "activity_list" && input.trim().length >= 3 && !generating;

  async function handleGenerate() {
    setGenerateError(null);
    setGenerating(true);
    try {
      const result = await generateFn({ data: { inputText: input } });
      if (result.ok) {
        setDraft(result.draft);
      } else {
        setGenerateError(result.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate draft.";
      setGenerateError(msg);
    } finally {
      setGenerating(false);
    }
  }

  function loadDemo() {
    setDraft(buildDemoDraftSchedule());
    setGenerateError(null);
  }

  function loadSample() {
    setSource("activity_list");
    setInput(SAMPLE_ACTIVITY_LIST);
    setGenerateError(null);
  }

  const sourceColumn = (
    <SourceColumn
      source={source}
      onSourceChange={setSource}
      input={input}
      onInputChange={setInput}
      generating={generating}
      generateError={generateError}
      canGenerate={canGenerateFromActivityList}
      onGenerate={handleGenerate}
      onLoadDemo={loadDemo}
      onLoadSample={IS_DEV ? loadSample : undefined}
      showGuardrails={expanded === true}
    />
  );

  const draftColumn = (
    <DraftColumn
      draft={draft}
      changeSet={previewChangeSet}
      counts={changeCounts}
    />
  );

  const reviewColumn = <ReviewColumn draft={draft} />;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-[var(--sched-ivory)] text-[12px] text-[var(--sched-graphite-strong)]"
      data-testid="intel-build-workspace"
    >
      <header
        className={
          "shrink-0 border-b border-[var(--sched-surface-rule-soft)] bg-gradient-to-r from-white via-white to-[var(--sched-brass-soft)]/30 " +
          (expanded ? "px-6 py-4" : "px-4 py-2.5")
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="mt-1 h-8 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-[var(--sched-brass)] to-[var(--sched-brass-deep)]"
            />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--sched-brass-deep)]">
                Build Mode · Flagship workspace
              </div>
              <div
                className={
                  "mt-0.5 font-semibold text-[var(--sched-graphite-strong)] " +
                  (expanded ? "text-[20px] leading-tight" : "text-[13px]")
                }
              >
                Describe the job. Baseline drafts the CPM.
              </div>
              {expanded ? (
                <div className="mt-1 max-w-[68ch] text-[12px] leading-relaxed text-[var(--sched-graphite)]">
                  Create a draft WBS, activities, durations, and logic before
                  anything is added to the live schedule. Nothing here writes
                  to the schedule until you review and approve.
                </div>
              ) : null}
            </div>
          </div>
          {onToggleExpanded ? (
            <button
              type="button"
              onClick={onToggleExpanded}
              className="shrink-0 rounded border border-[var(--sched-surface-rule-soft)] bg-white px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite-strong)] hover:border-[var(--sched-graphite-strong)]"
              data-testid="intel-build-expand-toggle"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>
      </header>

      {expanded ? (
        <div
          className="grid min-h-0 flex-1 gap-3 overflow-hidden p-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1.5fr)_minmax(300px,380px)]"
          data-testid="intel-build-3col"
        >
          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-[var(--sched-surface-rule-soft)] bg-white/60">
            <ColumnHeader eyebrow="01" title="Source Input" />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
              {sourceColumn}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-[var(--sched-surface-rule-soft)] bg-white/60">
            <ColumnHeader eyebrow="02" title="Draft Workspace" />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
              {draftColumn}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-[var(--sched-surface-rule-soft)] bg-white/60">
            <ColumnHeader eyebrow="03" title="Review & Approve" />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
              {reviewColumn}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          {sourceColumn}
          {draftColumn}
          {reviewColumn}
        </div>
      )}

      {!expanded ? (
        <footer className="shrink-0 border-t border-[var(--sched-surface-rule-soft)] bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sched-graphite)]">
            Guardrails
          </div>
          <ul className="mt-1 space-y-0.5">
            {BUILD_GUARDRAILS.map((g) => (
              <li key={g} className="text-[10.5px] text-[var(--sched-graphite)]">
                • {g}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-[var(--sched-graphite-soft)]">{INTEL_ADVISORY_NOTE}</div>
        </footer>
      ) : null}

      {draft ? (
        <div className="sr-only" data-testid="intel-build-draft-source">
          {SOURCE_LABEL[draft.source]}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Column header ───────────────────────────── */

function ColumnHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="shrink-0 border-b border-[var(--sched-surface-rule-soft)] bg-white/80 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-[var(--sched-brass-deep)]">{eyebrow}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite-strong)]">
          {title}
        </span>
      </div>
    </div>
  );
}

/* ────────────────────────────── Source column ───────────────────────────── */

function SourceColumn({
  source,
  onSourceChange,
  input,
  onInputChange,
  generating,
  generateError,
  canGenerate,
  onGenerate,
  onLoadDemo,
  onLoadSample,
  showGuardrails,
}: {
  source: SourceKind;
  onSourceChange: (s: SourceKind) => void;
  input: string;
  onInputChange: (v: string) => void;
  generating: boolean;
  generateError: string | null;
  canGenerate: boolean;
  onGenerate: () => void;
  onLoadDemo: () => void;
  onLoadSample?: () => void;
  showGuardrails: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-3" data-testid="intel-build-input">
      <section className="rounded border border-[var(--sched-surface-rule-soft)] bg-white p-3">
        <SectionLabel>Source</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-1">
          {SOURCE_OPTIONS.map((opt) => {
            const active = opt.id === source;
            const disabled =
              opt.id === "uploaded_document" ||
              opt.id === "schedule_of_values" ||
              opt.id === "estimate";
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => onSourceChange(opt.id)}
                className={
                  "rounded border px-2 py-0.5 text-[10.5px] tracking-wide " +
                  (active
                    ? "border-[var(--sched-graphite-strong)] bg-[var(--sched-graphite-strong)] text-[var(--sched-brass-soft)]"
                    : "border-[var(--sched-surface-rule-soft)] bg-white text-[var(--sched-graphite)] hover:border-[var(--sched-graphite-strong)]") +
                  (disabled ? " opacity-40" : "")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-1 flex-col rounded border border-[var(--sched-surface-rule-soft)] bg-white p-3">
        <SectionLabel>Input</SectionLabel>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={placeholderFor(source)}
          className="mt-2 min-h-[180px] flex-1 resize-y rounded border border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] p-2 text-[12px] text-[var(--sched-graphite-strong)] outline-none focus:border-[var(--sched-graphite-strong)]"
          data-testid="intel-build-textarea"
        />
        {generateError ? (
          <div
            className="mt-2 rounded border border-[var(--sched-critical)]/40 bg-[var(--sched-critical-soft)] px-2 py-1.5 text-[10.5px] text-[var(--sched-critical)]"
            data-testid="intel-build-error"
            role="alert"
          >
            {generateError} Your input is preserved — adjust and try again.
          </div>
        ) : null}
        <p className="mt-2 text-[10.5px] text-[var(--sched-graphite-soft)]">
          Nothing here writes to your live schedule.
        </p>
      </section>

      <section className="rounded border border-[var(--sched-surface-rule-soft)] bg-white p-3">
        <SectionLabel>Actions</SectionLabel>
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className={
              "rounded border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider " +
              (canGenerate
                ? "border-[var(--sched-graphite-strong)] bg-[var(--sched-brass-soft)] text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-graphite-strong)] hover:text-[var(--sched-brass-soft)]"
                : "cursor-not-allowed border-[var(--sched-surface-rule)] bg-white/60 text-[var(--sched-graphite-soft)]")
            }
            title={
              source === "activity_list"
                ? "Send the pasted activity list to the AI for a draft CPM"
                : "Activity-list draft is available when 'Paste activity list' is selected"
            }
            data-testid="intel-build-generate"
          >
            {generating
              ? "Generating…"
              : source === "activity_list"
                ? "Generate Draft"
                : "Generate Draft — soon"}
          </button>
          <button
            type="button"
            onClick={onLoadDemo}
            className="rounded border border-[var(--sched-graphite-strong)] bg-white px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-graphite-strong)] hover:text-[var(--sched-brass-soft)]"
            title="Internal demo only — not AI output"
            data-testid="intel-build-load-demo"
          >
            Load Demo Draft
          </button>
          {onLoadSample ? (
            <button
              type="button"
              onClick={onLoadSample}
              className="rounded border border-dashed border-[var(--sched-graphite-strong)] bg-white px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-graphite-strong)] hover:text-[var(--sched-brass-soft)]"
              title="Dev only — populates the activity-list textarea with a sample input for AI-4 smoke testing"
              data-testid="intel-build-load-sample"
            >
              Use Sample Activity List
            </button>
          ) : null}
        </div>
      </section>

      {showGuardrails ? (
        <section className="rounded border border-[var(--sched-surface-rule-soft)] bg-white/80 p-3">
          <SectionLabel>Guardrails</SectionLabel>
          <ul className="mt-1.5 space-y-0.5">
            {BUILD_GUARDRAILS.map((g) => (
              <li key={g} className="text-[10.5px] leading-snug text-[var(--sched-graphite)]">
                • {g}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 text-[10px] text-[var(--sched-graphite-soft)]">
            {INTEL_ADVISORY_NOTE}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── Draft column ────────────────────────────── */

function DraftColumn({
  draft,
  changeSet,
  counts,
}: {
  draft: DraftSchedule | null;
  changeSet: ProposedChangeSet | null;
  counts: { addActivity: number; addRelationship: number; addMilestone: number; total: number } | null;
}) {
  const isDemo = !!draft && draft.id.startsWith("demo-");
  const wbsById = useMemo(
    () => new Map((draft?.wbs ?? []).map((w) => [w.id, w])),
    [draft],
  );
  const actById = useMemo(
    () => new Map((draft?.activities ?? []).map((a) => [a.id, a])),
    [draft],
  );
  const committable = changeSet ? isChangeSetCommittable(changeSet) : false;

  return (
    <div className="flex flex-col gap-3" data-testid="intel-build-preview">
      {draft ? (
        isDemo ? (
          <div className="rounded border border-[var(--sched-near-critical)]/40 bg-[var(--sched-near-critical-soft)] px-3 py-2 text-[10.5px] text-[var(--sched-near-critical)]">
            DEMO DRAFT — internal scaffold data, not produced by an AI model.
            Not committed. Assumptions must be reviewed. Changes require
            approval.
          </div>
        ) : (
          <div className="rounded border border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] px-3 py-2 text-[10.5px] text-[var(--sched-graphite)]">
            AI DRAFT · source: {SOURCE_LABEL[draft.source]} · status:{" "}
            {draft.status}. Advisory only — review every assumption and
            approve the change set before any schedule write.
          </div>
        )
      ) : null}

      <DraftSection
        title="Draft WBS"
        count={draft?.wbs.length ?? 0}
        emptyHint="Sections roll-up will appear here."
      >
        {draft && draft.wbs.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.wbs.map((w) => (
              <li key={w.id} className="text-[11px] text-[var(--sched-graphite-strong)]">
                <span className="font-mono text-[var(--sched-graphite)]">
                  {w.code ?? "—"}
                </span>{" "}
                {w.name}
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <DraftSection
        title="Draft Activities"
        count={draft?.activities.length ?? 0}
        emptyHint="Activities with durations and crew/resource hints will appear here."
      >
        {draft && draft.activities.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--sched-graphite-soft)]">
                  <th className="py-1 pr-2 font-semibold">Name</th>
                  <th className="py-1 pr-2 font-semibold">WBS</th>
                  <th className="py-1 pr-2 font-semibold">Dur</th>
                  <th className="py-1 pr-2 font-semibold">Type</th>
                  <th className="py-1 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {draft.activities.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--sched-surface-rule-soft)]">
                    <td className="py-1 pr-2">{a.name}</td>
                    <td className="py-1 pr-2 font-mono text-[var(--sched-graphite)]">
                      {a.wbsId ? wbsById.get(a.wbsId)?.code ?? "—" : "—"}
                    </td>
                    <td className="py-1 pr-2">{a.durationDays ?? "—"}d</td>
                    <td className="py-1 pr-2">
                      {a.isMilestone ? "Milestone" : "Task"}
                    </td>
                    <td className="py-1 text-[var(--sched-graphite-soft)]">
                      {a.assumed ? "assumed" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </DraftSection>

      <DraftSection
        title="Draft Logic"
        count={draft?.relationships.length ?? 0}
        emptyHint="Predecessor → successor relationships and lags will appear here."
      >
        {draft && draft.relationships.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.relationships.map((r) => (
              <li key={r.id} className="text-[11px] text-[var(--sched-graphite-strong)]">
                <span className="text-[var(--sched-graphite)]">
                  {actById.get(r.predecessorId)?.name ?? r.predecessorId}
                </span>{" "}
                →{" "}
                <span className="text-[var(--sched-graphite)]">
                  {actById.get(r.successorId)?.name ?? r.successorId}
                </span>{" "}
                <span className="font-mono text-[10px] text-[var(--sched-graphite-soft)]">
                  {r.type}
                  {typeof r.lag === "number" ? ` +${r.lag}d` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <DraftSection
        title="Milestones"
        count={draft?.milestones.length ?? 0}
        emptyHint="Milestones extracted from scope will appear here."
      >
        {draft && draft.milestones.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.milestones.map((m) => (
              <li key={m.id} className="text-[11px] text-[var(--sched-graphite-strong)]">
                ◆ {m.name}
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <DraftSection
        title="Proposed Change Set"
        count={counts?.total ?? 0}
        emptyHint="A summary of additions will appear here once a draft is generated."
        statusChip={
          counts && counts.total > 0 ? (
            <span
              className={
                "rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider " +
                (committable
                  ? "border-[var(--sched-validated)] bg-[var(--sched-validated-soft)] text-[var(--sched-validated)]"
                  : "border-[var(--sched-surface-rule)] bg-white text-[var(--sched-graphite-soft)]")
              }
              data-testid="intel-build-committable"
            >
              Committable: {committable ? "yes" : "no"}
            </span>
          ) : null
        }
      >
        {counts ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Add activity" value={counts.addActivity} />
              <Stat label="Add relationship" value={counts.addRelationship} />
              <Stat label="Add milestone" value={counts.addMilestone} />
              <Stat label="Total changes" value={counts.total} />
            </div>
            <p className="mt-1.5 text-[10.5px] text-[var(--sched-graphite-soft)]">
              Commit is not implemented. This preview is advisory only.
            </p>
          </>
        ) : null}
      </DraftSection>
    </div>
  );
}

/* ────────────────────────────── Review column ───────────────────────────── */

function ReviewColumn({ draft }: { draft: DraftSchedule | null }) {
  return (
    <div className="flex h-full flex-col gap-3" data-testid="intel-build-review">
      <DraftSection
        title="Assumptions"
        count={draft?.assumptions.length ?? 0}
        emptyHint="The assistant will list every assumption it made."
      >
        {draft && draft.assumptions.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.assumptions.map((a) => (
              <li key={a.id} className="text-[11px] text-[var(--sched-graphite-strong)]">
                • {a.label}
                {a.detail ? (
                  <span className="text-[var(--sched-graphite-soft)]"> — {a.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <DraftSection
        title="Open Questions"
        count={draft?.questions.length ?? 0}
        emptyHint="Questions the assistant needs you to answer will appear here."
      >
        {draft && draft.questions.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.questions.map((q) => (
              <li key={q.id} className="text-[11px] text-[var(--sched-graphite-strong)]">
                ? {q.question}
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <DraftSection
        title="Warnings"
        count={draft?.warnings.length ?? 0}
        emptyHint="Validation warnings on the draft will appear here."
        statusChip={
          draft && draft.warnings.length > 0 ? (
            <span className="rounded border border-[var(--sched-near-critical)] bg-[var(--sched-near-critical-soft)] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-near-critical)]">
              Review
            </span>
          ) : null
        }
      >
        {draft && draft.warnings.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.warnings.map((w) => (
              <li key={w.id} className="text-[11px] text-[var(--sched-graphite-strong)]">
                <span className="font-mono text-[10px] uppercase text-[var(--sched-graphite-soft)]">
                  [{w.severity}]
                </span>{" "}
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <ApprovalChecklist />

      <div className="mt-auto rounded border border-[var(--sched-surface-rule-soft)] bg-white/80 p-3">
        <SectionLabel>Commit</SectionLabel>
        <button
          type="button"
          disabled
          className="mt-2 w-full cursor-not-allowed rounded bg-[var(--sched-graphite-strong)]/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--sched-brass-soft)]"
          title="Approval flow not wired — drafts are advisory only"
          data-testid="intel-build-add-to-schedule"
        >
          Add to Schedule — soon
        </button>
        <p className="mt-1.5 text-[10px] text-[var(--sched-graphite-soft)]">
          Unlocks once a draft exists, every checklist item is reviewed, and
          the change set is approved. Not wired yet.
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────── Shared primitives ─────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sched-graphite)]">
      {children}
    </div>
  );
}

function DraftSection({
  title,
  count,
  emptyHint,
  statusChip,
  children,
}: {
  title: string;
  count: number;
  emptyHint: string;
  statusChip?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const hasContent = count > 0;
  return (
    <section className="rounded border border-[var(--sched-surface-rule-soft)] bg-white p-3 shadow-[0_1px_0_rgba(31,36,31,0.02)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>{title}</SectionLabel>
          <span
            className={
              "rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums " +
              (hasContent
                ? "border-[var(--sched-surface-rule)] bg-[var(--sched-brass-soft)]/50 text-[var(--sched-graphite-strong)]"
                : "border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] text-[var(--sched-graphite-soft)]")
            }
          >
            {count}
          </span>
        </div>
        {statusChip ??
          (hasContent ? null : (
            <span className="rounded-full border border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite-soft)]">
              Awaiting draft
            </span>
          ))}
      </div>
      <div className="mt-2">
        {hasContent ? (
          children
        ) : (
          <div className="flex items-start gap-2 rounded border border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-2.5 py-2">
            <span
              aria-hidden
              className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sched-graphite-soft)]"
            />
            <p className="text-[11px] leading-relaxed text-[var(--sched-graphite-soft)]">
              {emptyHint}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-2 py-1">
      <div className="text-[9.5px] uppercase tracking-wider text-[var(--sched-graphite-soft)]">
        {label}
      </div>
      <div className="text-[14px] font-semibold tabular-nums text-[var(--sched-graphite-strong)]">
        {value}
      </div>
    </div>
  );
}

function ApprovalChecklist() {
  const items = [
    "Review proposed WBS",
    "Review proposed activities and durations",
    "Review proposed logic",
    "Resolve every assumption and question",
    "Approve the change set",
  ];
  return (
    <div className="rounded border border-[var(--sched-surface-rule-soft)] bg-white/80 p-3">
      <SectionLabel>Approval checklist</SectionLabel>
      <ul className="mt-2 space-y-1">
        {items.map((it) => (
          <li
            key={it}
            className="flex items-center gap-2 text-[11px] text-[var(--sched-graphite)]"
          >
            <span className="inline-block h-3 w-3 rounded-sm border border-[var(--sched-surface-rule)] bg-white" />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function placeholderFor(source: SourceKind): string {
  switch (source) {
    case "manual_prompt":
      return "Describe the job. E.g. ‘8,400 sf tenant fit-out, two floors, fire-sprinkler retrofit, MEP rough-in before drywall, owner-furnished casework arrives week 6…’";
    case "activity_list":
      return "Paste one activity per line. Optional: name, duration in days, predecessor names.";
    case "schedule_of_values":
      return "Paste the SOV (line items, values). The assistant will propose a WBS and activities from it.";
    case "estimate":
      return "Paste the estimate (CSI divisions, quantities, crews). The assistant will use it to propose durations.";
    case "uploaded_document":
      return "Document upload is coming soon.";
  }
}
