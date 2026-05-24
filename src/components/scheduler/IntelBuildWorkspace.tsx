/**
 * Schedule Intelligence — Build Mode workspace shell.
 *
 * Non-mutating scaffold for the future AI-assisted CPM builder. No
 * generation, no engine calls, no schedule writes. The UI exists so that
 * Build Mode reads as a first-class workspace pillar instead of a drawer
 * afterthought.
 *
 * See:
 *   - docs/schedule-intelligence-ai-spec.md §6 (Proposed UX)
 *   - src/lib/scheduler/intel-build.ts (data shapes the eventual AI fills)
 */

import { useState } from "react";
import { BUILD_GUARDRAILS } from "@/lib/scheduler/intel-build";
import { INTEL_ADVISORY_NOTE } from "@/lib/scheduler/intel-context";

export interface IntelBuildWorkspaceProps {
  /**
   * When true, the workspace renders in "expanded" presentation — denser
   * header, two-column layout. The drawer host passes this when the user
   * toggles the expand button.
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
  { id: "schedule_of_values", label: "Paste SOV" },
  { id: "estimate", label: "Paste estimate" },
  { id: "uploaded_document", label: "Upload (coming soon)" },
];

export function IntelBuildWorkspace({
  expanded,
  onToggleExpanded,
}: IntelBuildWorkspaceProps) {
  const [source, setSource] = useState<SourceKind>("manual_prompt");
  const [input, setInput] = useState("");

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-[#fdfcf7] text-[12px] text-[#3a3a35]"
      data-testid="intel-build-workspace"
    >
      <header className="shrink-0 border-b border-[#ece8db] bg-white/70 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
              Build Mode
            </div>
            <div className="mt-0.5 text-[11.5px] text-[#4a4944]">
              Draft a CPM schedule from scope, an activity list, or an SOV.
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

      <div
        className={
          expanded
            ? "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
            : "flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3"
        }
      >
        {/* ----- Input panel ----- */}
        <section
          className="rounded border border-[#ece8db] bg-white/80 p-3"
          data-testid="intel-build-input"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
            Input
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {SOURCE_OPTIONS.map((opt) => {
              const active = opt.id === source;
              const disabled = opt.id === "uploaded_document";
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSource(opt.id)}
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
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholderFor(source)}
            className="mt-2 min-h-[140px] w-full resize-y rounded border border-[#ece8db] bg-[#fdfcf7] p-2 text-[12px] text-[#1f241f] outline-none focus:border-[#1f241f]"
            data-testid="intel-build-textarea"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10.5px] text-[#8a8980]">
              Nothing here writes to your live schedule.
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded border border-[#ece8db] bg-white px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#8a8980]"
                title="Coming soon"
              >
                Create Draft — soon
              </button>
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded bg-[#1f241f]/40 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#f7e9b8]"
                title="Coming soon"
              >
                Add to Schedule — soon
              </button>
            </div>
          </div>
        </section>

        {/* ----- Draft preview ----- */}
        <section
          className="flex min-h-0 flex-col gap-3"
          data-testid="intel-build-preview"
        >
          <DraftSlot title="Proposed WBS" hint="Sections roll-up will appear here." />
          <DraftSlot
            title="Proposed Activities"
            hint="Activities with durations and crew/resource hints will appear here."
          />
          <DraftSlot
            title="Proposed Logic"
            hint="Predecessor → successor relationships and lags will appear here."
          />
          <DraftSlot
            title="Assumptions & Open Questions"
            hint="The assistant will list every assumption it made and every question it needs you to answer."
          />
          <ApprovalChecklist />
        </section>
      </div>

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
    </div>
  );
}

function DraftSlot({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded border border-dashed border-[#ddd6c4] bg-white/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
        {title}
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-[#8a8980]">
        Empty — {hint}
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
        Approval checklist
      </div>
      <ul className="mt-2 space-y-1">
        {items.map((it) => (
          <li key={it} className="flex items-center gap-2 text-[11px] text-[#6b6a63]">
            <span className="inline-block h-3 w-3 rounded-sm border border-[#ddd6c4] bg-white" />
            {it}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10.5px] text-[#8a8980]">
        “Add to Schedule” will unlock when a draft exists, every item is
        checked, and the change set is approved. Not wired yet.
      </p>
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
