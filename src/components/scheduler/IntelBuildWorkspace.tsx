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
      className="flex h-full min-h-0 flex-1 flex-col bg-[#fdfcf7] text-[12px] text-[#3a3a35]"
      data-testid="intel-build-workspace"
    >
      <header className="shrink-0 border-b border-[#ece8db] bg-white/70 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#675d4b]">
              Build Mode · Flagship workspace
            </div>
            <div className="mt-0.5 text-[12px] font-medium text-[#1f241f]">
              Describe the job. Baseline builds the CPM.
            </div>
          </div>
          {onToggleExpanded ? (
            <button
              type="button"
              onClick={onToggleExpanded}
              className="rounded border border-[#ece8db] bg-white px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#1f241f] hover:border-[#1f241f]"
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
          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-[#ece8db] bg-white/60">
            <ColumnHeader eyebrow="01" title="Source Input" />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
              {sourceColumn}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-[#ece8db] bg-white/60">
            <ColumnHeader eyebrow="02" title="Draft Workspace" />
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
              {draftColumn}
            </div>
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded border border-[#ece8db] bg-white/60">
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
        <footer className="shrink-0 border-t border-[#ece8db] bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
            Guardrails
          </div>
          <ul className="mt-1 space-y-0.5">
            {BUILD_GUARDRAILS.map((g) => (
              <li key={g} className="text-[10.5px] text-[#6b6a63]">
                • {g}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-[#8a8980]">{INTEL_ADVISORY_NOTE}</div>
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
    <div className="shrink-0 border-b border-[#ece8db] bg-white/80 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-[#a89968]">{eyebrow}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1f241f]">
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
      <section className="rounded border border-[#ece8db] bg-white p-3">
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
                    ? "border-[#1f241f] bg-[#1f241f] text-[#f7e9b8]"
                    : "border-[#ece8db] bg-white text-[#4a4944] hover:border-[#1f241f]") +
                  (disabled ? " opacity-40" : "")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-1 flex-col rounded border border-[#ece8db] bg-white p-3">
        <SectionLabel>Input</SectionLabel>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={placeholderFor(source)}
          className="mt-2 min-h-[180px] flex-1 resize-y rounded border border-[#ece8db] bg-[#fdfcf7] p-2 text-[12px] text-[#1f241f] outline-none focus:border-[#1f241f]"
          data-testid="intel-build-textarea"
        />
        {generateError ? (
          <div
            className="mt-2 rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-[10.5px] text-rose-900"
            data-testid="intel-build-error"
            role="alert"
          >
            {generateError} Your input is preserved — adjust and try again.
          </div>
        ) : null}
        <p className="mt-2 text-[10.5px] text-[#8a8980]">
          Nothing here writes to your live schedule.
        </p>
      </section>

      <section className="rounded border border-[#ece8db] bg-white p-3">
        <SectionLabel>Actions</SectionLabel>
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className={
              "rounded border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider " +
              (canGenerate
                ? "border-[#1f241f] bg-[#f7e9b8] text-[#1f241f] hover:bg-[#1f241f] hover:text-[#f7e9b8]"
                : "cursor-not-allowed border-[#ddd6c4] bg-white/60 text-[#a8a89e]")
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
            className="rounded border border-[#1f241f] bg-white px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#1f241f] hover:bg-[#1f241f] hover:text-[#f7e9b8]"
            title="Internal demo only — not AI output"
            data-testid="intel-build-load-demo"
          >
            Load Demo Draft
          </button>
          {onLoadSample ? (
            <button
              type="button"
              onClick={onLoadSample}
              className="rounded border border-dashed border-[#1f241f] bg-white px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#1f241f] hover:bg-[#1f241f] hover:text-[#f7e9b8]"
              title="Dev only — populates the activity-list textarea with a sample input for AI-4 smoke testing"
              data-testid="intel-build-load-sample"
            >
              Use Sample Activity List
            </button>
          ) : null}
        </div>
      </section>

      {showGuardrails ? (
        <section className="rounded border border-[#ece8db] bg-white/80 p-3">
          <SectionLabel>Guardrails</SectionLabel>
          <ul className="mt-1.5 space-y-0.5">
            {BUILD_GUARDRAILS.map((g) => (
              <li key={g} className="text-[10.5px] leading-snug text-[#6b6a63]">
                • {g}
              </li>
            ))}
          </ul>
          <div className="mt-1.5 text-[10px] text-[#8a8980]">
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
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[10.5px] text-amber-900">
            DEMO DRAFT — internal scaffold data, not produced by an AI model.
            Not committed. Assumptions must be reviewed. Changes require
            approval.
          </div>
        ) : (
          <div className="rounded border border-[#d8cdb8] bg-[#fdfcf7] px-3 py-2 text-[10.5px] text-[#4a4944]">
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
              <li key={w.id} className="text-[11px] text-[#3a3a35]">
                <span className="font-mono text-[#675d4b]">
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
                <tr className="text-left text-[10px] uppercase tracking-wider text-[#8a8980]">
                  <th className="py-1 pr-2 font-semibold">Name</th>
                  <th className="py-1 pr-2 font-semibold">WBS</th>
                  <th className="py-1 pr-2 font-semibold">Dur</th>
                  <th className="py-1 pr-2 font-semibold">Type</th>
                  <th className="py-1 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {draft.activities.map((a) => (
                  <tr key={a.id} className="border-t border-[#ece8db]">
                    <td className="py-1 pr-2">{a.name}</td>
                    <td className="py-1 pr-2 font-mono text-[#675d4b]">
                      {a.wbsId ? wbsById.get(a.wbsId)?.code ?? "—" : "—"}
                    </td>
                    <td className="py-1 pr-2">{a.durationDays ?? "—"}d</td>
                    <td className="py-1 pr-2">
                      {a.isMilestone ? "Milestone" : "Task"}
                    </td>
                    <td className="py-1 text-[#8a8980]">
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
              <li key={r.id} className="text-[11px] text-[#3a3a35]">
                <span className="text-[#675d4b]">
                  {actById.get(r.predecessorId)?.name ?? r.predecessorId}
                </span>{" "}
                →{" "}
                <span className="text-[#675d4b]">
                  {actById.get(r.successorId)?.name ?? r.successorId}
                </span>{" "}
                <span className="font-mono text-[10px] text-[#8a8980]">
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
              <li key={m.id} className="text-[11px] text-[#3a3a35]">
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
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-[#ddd6c4] bg-white text-[#8a8980]")
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
            <p className="mt-1.5 text-[10.5px] text-[#8a8980]">
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
              <li key={a.id} className="text-[11px] text-[#3a3a35]">
                • {a.label}
                {a.detail ? (
                  <span className="text-[#8a8980]"> — {a.detail}</span>
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
              <li key={q.id} className="text-[11px] text-[#3a3a35]">
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
            <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-amber-800">
              Review
            </span>
          ) : null
        }
      >
        {draft && draft.warnings.length > 0 ? (
          <ul className="space-y-0.5">
            {draft.warnings.map((w) => (
              <li key={w.id} className="text-[11px] text-[#3a3a35]">
                <span className="font-mono text-[10px] uppercase text-[#8a8980]">
                  [{w.severity}]
                </span>{" "}
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
      </DraftSection>

      <ApprovalChecklist />

      <div className="mt-auto rounded border border-[#ece8db] bg-white/80 p-3">
        <SectionLabel>Commit</SectionLabel>
        <button
          type="button"
          disabled
          className="mt-2 w-full cursor-not-allowed rounded bg-[#1f241f]/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#f7e9b8]"
          title="Approval flow not wired — drafts are advisory only"
          data-testid="intel-build-add-to-schedule"
        >
          Add to Schedule — soon
        </button>
        <p className="mt-1.5 text-[10px] text-[#8a8980]">
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
    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
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
    <section
      className={
        "rounded border p-3 " +
        (hasContent
          ? "border-[#ece8db] bg-white"
          : "border-dashed border-[#ddd6c4] bg-white/60")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <SectionLabel>{title}</SectionLabel>
          <span
            className={
              "rounded border px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums " +
              (hasContent
                ? "border-[#d8cdb8] bg-[#f7e9b8]/40 text-[#1f241f]"
                : "border-[#ddd6c4] bg-white text-[#8a8980]")
            }
          >
            {count}
          </span>
        </div>
        {statusChip}
      </div>
      <div className="mt-2">
        {hasContent ? (
          children
        ) : (
          <div className="text-[11px] leading-relaxed text-[#8a8980]">
            Empty — {emptyHint}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-[#ece8db] bg-[#fdfcf7] px-2 py-1">
      <div className="text-[9.5px] uppercase tracking-wider text-[#8a8980]">
        {label}
      </div>
      <div className="text-[14px] font-semibold tabular-nums text-[#1f241f]">
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
    <div className="rounded border border-[#ece8db] bg-white/80 p-3">
      <SectionLabel>Approval checklist</SectionLabel>
      <ul className="mt-2 space-y-1">
        {items.map((it) => (
          <li
            key={it}
            className="flex items-center gap-2 text-[11px] text-[#6b6a63]"
          >
            <span className="inline-block h-3 w-3 rounded-sm border border-[#ddd6c4] bg-white" />
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
