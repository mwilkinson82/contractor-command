/**
 * ActivityInspectorPanel — PA-2b Inspector Command Center (refined)
 *
 * Right-side persistent inspector for Schedule mode. This is the PRIMARY
 * activity command center; the legacy bottom inspector is demoted to a
 * compact strip / editing surface (its full detail tabs auto-collapse when
 * this panel is open and an activity is selected).
 *
 * No engine, persistence, XER, dry-run, or AI mutation behavior is touched.
 *
 * PA-2b refinements:
 *   - Section order: Identity → Logic & Impact → Date Intelligence →
 *     Resources & Codes → Annotations → Impact Preview.
 *   - Logic & Impact is now the heart of CPM: dense counts, compact
 *     relationship table (ID · Name · Type · Lag · Driving · Jump).
 *   - Tighter rows, fewer nested boxes, tabular numerics, stronger header.
 *   - No-selection state is a compact dashboard, not a stack of cards.
 *   - WBS deep-dive intentionally deferred to PA-5.
 */

import * as React from "react";
import { useSchedulerLayout } from "@/components/scheduler/shell";
import type {
  NamedCalendar,
  Schedule,
  ScheduleResult,
  ScheduledTask,
  Task,
} from "@/lib/scheduler/types";

const RAIL_WIDTH = 56;
const FULL_WIDTH = 340;

export const ACTIVITY_INSPECTOR_RAIL_WIDTH = RAIL_WIDTH;
export const ACTIVITY_INSPECTOR_FULL_WIDTH = FULL_WIDTH;

export interface ActivityInspectorPanelProps {
  draft: Schedule | null;
  computed: ScheduleResult | null;
  calendars: NamedCalendar[];
  selectedTaskId: string | null;
  onSelect: (id: string | null) => void;
  nearCriticalFloat: number;
  topOffset?: number;
  bottomOffset?: number;
}

export function ActivityInspectorPanel({
  draft,
  computed,
  calendars,
  selectedTaskId,
  onSelect,
  nearCriticalFloat,
  topOffset = 40,
  bottomOffset = 44,
}: ActivityInspectorPanelProps) {
  const { inspectorOpen, setInspectorOpen } = useSchedulerLayout();
  const expanded = inspectorOpen;

  const selectedTask: ScheduledTask | null = React.useMemo(() => {
    if (!selectedTaskId || !computed) return null;
    return computed.tasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [computed, selectedTaskId]);

  const draftTask: Task | null = React.useMemo(() => {
    if (!selectedTaskId || !draft) return null;
    return draft.tasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [draft, selectedTaskId]);

  const status =
    selectedTask && draftTask
      ? deriveStatus(selectedTask, draftTask, draft?.dataDate, nearCriticalFloat)
      : null;

  return (
    <aside
      data-testid="activity-inspector-panel"
      aria-label="Activity inspector"
      className="fixed right-0 z-30 flex flex-col border-l border-[var(--sched-surface-rule)] bg-[var(--sched-surface)] print:hidden"
      style={{
        top: topOffset,
        bottom: bottomOffset,
        width: expanded ? FULL_WIDTH : RAIL_WIDTH,
        transition: "width 120ms ease",
      }}
    >
      {/* Edge handle — 16px hover target on the left rule for collapse/expand. */}
      <button
        type="button"
        onClick={() => setInspectorOpen(!expanded)}
        aria-label={expanded ? "Collapse inspector" : "Expand inspector"}
        title={expanded ? "Collapse to rail" : "Expand inspector"}
        data-testid="activity-inspector-edge-handle"
        className="group absolute -left-2 top-0 bottom-0 z-10 flex w-4 cursor-col-resize items-center justify-center"
      >
        <span
          aria-hidden
          className="h-12 w-[3px] rounded-full bg-[var(--sched-surface-rule)] transition group-hover:bg-[var(--sched-graphite-strong)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 grid h-5 w-5 place-items-center rounded-full border border-[var(--sched-surface-rule)] bg-[var(--sched-surface)] text-[10px] font-bold text-[var(--sched-graphite)] opacity-0 transition group-hover:opacity-100"
        >
          {expanded ? "›" : "‹"}
        </span>
      </button>
      {/* HEADER — stronger selected-activity identity */}
      {expanded ? (
        <header
          className={
            "shrink-0 border-b px-3 py-2 " +
            (selectedTask
              ? "border-[var(--sched-graphite-strong)] bg-[var(--sched-graphite-strong)] text-[var(--sched-brass-soft)]"
              : "border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] text-[var(--sched-graphite-strong)]")
          }
        >
          <div className="flex items-center justify-between gap-2">
            <div
              className={
                "text-[9.5px] font-semibold uppercase tracking-[0.2em] " +
                (selectedTask ? "text-[var(--sched-brass)]" : "text-[var(--sched-graphite)]")
              }
            >
              {selectedTask ? "Activity" : "Schedule"} Inspector
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              className={
                "shrink-0 rounded p-0.5 " +
                (selectedTask
                  ? "text-[var(--sched-brass)] hover:bg-[var(--sched-graphite-strong)]/85"
                  : "text-[var(--sched-graphite)] hover:bg-white")
              }
              aria-label="Collapse inspector"
              data-testid="activity-inspector-toggle"
              title="Collapse to rail"
            >
              ›
            </button>
          </div>
          {selectedTask && draftTask ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-[12px] tabular-nums text-[var(--sched-brass)]">
                  {selectedTask.id}
                </span>
                {status ? (
                  <span
                    className={
                      "rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider " +
                      headerChipClass(status.tone)
                    }
                  >
                    {status.label}
                  </span>
                ) : null}
              </div>
              <div
                className="mt-1 text-[13px] font-semibold leading-tight tracking-tight text-white"
                title={draftTask.name}
              >
                {draftTask.name}
              </div>
              <div className="mt-1 text-[10px] text-[var(--sched-graphite-soft)]">
                {draftTask.wbs ? `WBS ${draftTask.wbs} · ` : ""}
                {selectedTask.duration}d · {fmtShort(selectedTask.earlyStartDate)} →{" "}
                {fmtShort(selectedTask.earlyFinishDate)}
              </div>
            </>
          ) : null}
        </header>
      ) : (
        <header className="flex shrink-0 items-center justify-center border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] py-1.5">
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="grid h-7 w-7 place-items-center rounded bg-[var(--sched-graphite-strong)] text-[10px] font-bold tracking-wide text-[var(--sched-brass-soft)] hover:bg-[var(--sched-graphite-strong)]/85"
            data-testid="activity-inspector-toggle"
            aria-label="Expand inspector"
            title={selectedTask ? `${selectedTask.id}` : "Expand inspector"}
          >
            {selectedTask ? truncId(selectedTask.id) : "‹"}
          </button>
        </header>
      )}

      {expanded ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {selectedTask && draftTask ? (
            <SelectedActivityCommandCenter
              draft={draft!}
              computed={computed!}
              calendars={calendars}
              selectedTask={selectedTask}
              draftTask={draftTask}
              nearCriticalFloat={nearCriticalFloat}
              onSelect={onSelect}
              onClear={() => onSelect(null)}
            />
          ) : (
            <NoSelectionSummary
              draft={draft}
              computed={computed}
              nearCriticalFloat={nearCriticalFloat}
            />
          )}
        </div>
      ) : null}
    </aside>
  );
}

function truncId(id: string): string {
  if (id.length <= 4) return id;
  return id.slice(0, 4);
}

function headerChipClass(tone: StatusTone): string {
  switch (tone) {
    case "critical":
      return "bg-[var(--sched-critical)] text-white";
    case "warn":
      return "bg-[var(--sched-near-critical)] text-[var(--sched-graphite-strong)]";
    case "ok":
      return "bg-[var(--sched-validated)] text-white";
    case "info":
      return "bg-[var(--sched-graphite-strong)] text-white";
    default:
      return "bg-[var(--sched-graphite-strong)] text-[var(--sched-graphite-soft)]";
  }
}

// =====================================================================
// Selected activity — sectioned command center
// =====================================================================

interface CommandCenterProps {
  draft: Schedule;
  computed: ScheduleResult;
  calendars: NamedCalendar[];
  selectedTask: ScheduledTask;
  draftTask: Task;
  nearCriticalFloat: number;
  onSelect: (id: string | null) => void;
  onClear: () => void;
}

function SelectedActivityCommandCenter({
  draft,
  computed,
  calendars,
  selectedTask,
  draftTask,
  nearCriticalFloat,
  onSelect,
  onClear,
}: CommandCenterProps) {
  const calendar = calendars.find((c) =>
    draftTask.calendarId ? c.id === draftTask.calendarId : c.isDefault,
  );

  const predDeps = computed.dependencies.filter((d) => d.to === selectedTask.id);
  const succDeps = computed.dependencies.filter((d) => d.from === selectedTask.id);
  const drivingPred = predDeps.filter((d) => d.isDriving).length;
  const drivingSucc = succDeps.filter((d) => d.isDriving).length;

  return (
    <div className="flex flex-col">
      {/* Quick action strip */}
      <div className="flex items-center justify-between border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-3 py-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
          {fmtPct(draftTask.percentComplete)} complete · TF {selectedTask.totalFloat}d · FF{" "}
          {selectedTask.freeFloat}d
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] uppercase tracking-wider text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
          title="Clear selection"
        >
          Clear
        </button>
      </div>

      {/* Section order: Identity → Logic → Dates → Resources → Annotations → Impact */}
      <Section title="Identity & Status" defaultOpen testId="inspector-section-identity">
        <Row label="ID" value={selectedTask.id} mono />
        <Row label="WBS" value={draftTask.wbs || "—"} mono />
        <Row label="Calendar" value={calendar?.name ?? "Project default"} />
        <Row label="Duration" value={`${selectedTask.duration}d`} mono />
        {draftTask.startNoEarlierThan ? (
          <Row label="SNET" value={fmtShort(draftTask.startNoEarlierThan)} mono />
        ) : null}
      </Section>

      {/* LOGIC & IMPACT — the heart of CPM */}
      <Section title="Logic & Impact" defaultOpen testId="inspector-section-logic" emphasis>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 pt-2 text-[11px]">
          <CountStat
            label="Predecessors"
            count={predDeps.length}
            driving={drivingPred}
          />
          <CountStat
            label="Successors"
            count={succDeps.length}
            driving={drivingSucc}
          />
        </div>

        <RelTable
          title="Predecessors"
          deps={predDeps}
          otherKey="from"
          draft={draft}
          onSelect={onSelect}
          emptyLabel="No predecessors — open start"
        />
        <RelTable
          title="Successors"
          deps={succDeps}
          otherKey="to"
          draft={draft}
          onSelect={onSelect}
          emptyLabel="No successors — open end"
        />
      </Section>

      <Section title="Date Intelligence" defaultOpen testId="inspector-section-dates">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 px-3 py-1.5 font-mono text-[11px] tabular-nums text-[var(--sched-graphite-strong)]">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            &nbsp;
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            Early
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            Late
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            Start
          </span>
          <span>{fmtShort(selectedTask.earlyStartDate)}</span>
          <span>{fmtShort(selectedTask.lateStartDate)}</span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            Finish
          </span>
          <span>{fmtShort(selectedTask.earlyFinishDate)}</span>
          <span>{fmtShort(selectedTask.lateFinishDate)}</span>
        </div>
        <Row label="Data date" value={fmtShort(draft.dataDate)} mono />
        <p className="px-3 pb-2 text-[10px] leading-snug text-[var(--sched-graphite)]">
          Baseline delta appears here once a baseline is selected for comparison.
        </p>
      </Section>

      <Section title="Resources & Codes" testId="inspector-section-resources">
        {draftTask.resourceName ||
        draftTask.budgetCost ||
        draftTask.actualCost ||
        draftTask.resourceUnitsPerDay ? (
          <>
            <Row label="Resource" value={draftTask.resourceName || "—"} />
            <Row label="Units/day" value={draftTask.resourceUnitsPerDay?.toString() ?? "—"} mono />
            <Row label="Budget" value={fmtMoney(draftTask.budgetCost)} mono />
            <Row label="Actual" value={fmtMoney(draftTask.actualCost)} mono />
          </>
        ) : (
          <Hint>
            No resource assigned. Activity codes attach via the legacy panel — wiring lands in a
            later phase.
          </Hint>
        )}
      </Section>

      <Section title="Annotations & Flags" testId="inspector-section-flags">
        <Hint>
          Notes, delay flags, and change-order flags get their own data layer in a later phase.
        </Hint>
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          <DisabledChip>+ Note</DisabledChip>
          <DisabledChip>⚑ Flag delay</DisabledChip>
          <DisabledChip>$ Change order</DisabledChip>
        </div>
      </Section>

      <Section title="Impact Preview" testId="inspector-section-impact">
        <Hint>Mini-Gantt of this activity ±2 hops of driving logic arrives with PA-3.</Hint>
      </Section>
    </div>
  );
}

// =====================================================================
// No-selection compact dashboard
// =====================================================================

function NoSelectionSummary({
  draft,
  computed,
  nearCriticalFloat,
}: {
  draft: Schedule | null;
  computed: ScheduleResult | null;
  nearCriticalFloat: number;
}) {
  if (!draft || !computed) {
    return (
      <div className="p-3">
        <Hint>Load a schedule to see project KPIs and pick an activity to inspect.</Hint>
      </div>
    );
  }

  const total = computed.tasks.length;
  const critical = computed.tasks.filter((t) => t.isCritical).length;
  const nearCritical = computed.tasks.filter(
    (t) => !t.isCritical && t.totalFloat <= nearCriticalFloat,
  ).length;
  const diagnostics = computed.diagnostics?.length ?? 0;
  const openEnds = computeOpenEnds(draft, computed);
  const quality =
    diagnostics === 0 && openEnds === 0
      ? "Good"
      : diagnostics > 0
        ? "Errors"
        : "Warnings";

  return (
    <div>
      <DashRow label="Finish" value={fmtShort(computed.projectFinishDate)} mono />
      <DashRow label="Data date" value={fmtShort(draft.dataDate)} mono />
      <Divider />
      <DashRow label="Activities" value={String(total)} mono />
      <DashRow label="Critical" value={String(critical)} mono tone="critical" />
      <DashRow
        label="Near-critical"
        value={String(nearCritical)}
        sub={nearCriticalFloat > 0 ? `≤${nearCriticalFloat}d float` : undefined}
        mono
        tone={nearCritical > 0 ? "warn" : undefined}
      />
      <Divider />
      <DashRow label="Open ends" value={String(openEnds)} mono tone={openEnds > 0 ? "warn" : undefined} />
      <DashRow label="Diagnostics" value={String(diagnostics)} mono tone={diagnostics > 0 ? "warn" : undefined} />
      <DashRow label="Quality" value={quality} tone={quality === "Good" ? "ok" : "warn"} />
      <div className="border-t border-[var(--sched-surface-rule-soft)] px-3 py-2">
        <Hint>Select an activity in the table or Gantt to open its command center.</Hint>
      </div>
    </div>
  );
}

function computeOpenEnds(draft: Schedule, computed: ScheduleResult): number {
  let count = 0;
  const hasPred = new Set<string>();
  const hasSucc = new Set<string>();
  for (const d of draft.dependencies) {
    hasSucc.add(d.from);
    hasPred.add(d.to);
  }
  for (const t of computed.tasks) {
    if (!hasPred.has(t.id) || !hasSucc.has(t.id)) count++;
  }
  return count;
}

// =====================================================================
// Section / atoms
// =====================================================================

function Section({
  title,
  children,
  defaultOpen = false,
  testId,
  emphasis = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  emphasis?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section
      className={"border-b border-[var(--sched-surface-rule-soft)] " + (emphasis ? "bg-[var(--sched-brass-soft)]/40" : "")}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[var(--sched-ivory)]"
        aria-expanded={open}
      >
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-[0.18em] " +
            (emphasis ? "text-[var(--sched-near-critical)]" : "text-[var(--sched-graphite)]")
          }
        >
          {title}
        </span>
        <span className="text-[10px] text-[var(--sched-graphite)]">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="pb-1">{children}</div> : null}
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-0.5">
      <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
        {label}
      </span>
      <span
        className={
          "min-w-0 truncate text-[11.5px] text-[var(--sched-graphite-strong)] " +
          (mono ? "font-mono tabular-nums" : "")
        }
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function DashRow({
  label,
  value,
  sub,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "critical" | "warn" | "ok";
}) {
  const valueColor =
    tone === "critical"
      ? "text-[var(--sched-critical)]"
      : tone === "warn"
        ? "text-[var(--sched-near-critical)]"
        : tone === "ok"
          ? "text-[var(--sched-validated)]"
          : "text-[var(--sched-graphite-strong)]";
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--sched-surface-rule-soft)] px-3 py-1.5 last:border-b-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
        {label}
        {sub ? <span className="ml-1.5 text-[9px] normal-case text-[var(--sched-graphite)]">{sub}</span> : null}
      </div>
      <div
        className={`text-[13px] font-semibold tracking-tight ${valueColor} ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-[var(--sched-surface-rule-soft)]" />;
}

function CountStat({
  label,
  count,
  driving,
}: {
  label: string;
  count: number;
  driving: number;
}) {
  return (
    <div className="rounded border border-[var(--sched-surface-rule)] bg-white px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-[16px] font-semibold tabular-nums leading-none text-[var(--sched-graphite-strong)]">
          {count}
        </span>
        <span className="text-[10px] font-semibold text-[var(--sched-near-critical)]" title="Driving relationships (control activity's float)">
          {driving} driving
        </span>
      </div>
    </div>
  );
}

function RelTable({
  title,
  deps,
  otherKey,
  draft,
  onSelect,
  emptyLabel,
}: {
  title: string;
  deps: Array<{ from: string; to: string; type: string; lag: number; isDriving: boolean }>;
  otherKey: "from" | "to";
  draft: Schedule;
  onSelect: (id: string | null) => void;
  emptyLabel: string;
}) {
  // CPM convention: driving relationships first, non-driving second.
  const driving = deps.filter((d) => d.isDriving);
  const nonDriving = deps.filter((d) => !d.isDriving);
  const ordered = [...driving, ...nonDriving];

  return (
    <div className="px-3 pb-2 pt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
          {title}
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-[var(--sched-graphite)]">
          {driving.length > 0
            ? `${driving.length} driving · ${nonDriving.length} non-driving`
            : `${deps.length}`}
        </span>
      </div>
      {deps.length === 0 ? (
        <p className="text-[10.5px] italic text-[var(--sched-graphite)]">{emptyLabel}</p>
      ) : (
        <div className="overflow-hidden rounded border border-[var(--sched-surface-rule)] bg-white">
          {/* Column headers — explicit CPM terms */}
          <div className="grid grid-cols-[44px_1fr_28px_36px_18px] items-center gap-1 border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            <span title="Activity ID">ID</span>
            <span title="Activity Name">Name</span>
            <span title="Relationship Type (FS/SS/FF/SF)">Rel</span>
            <span className="text-right" title="Lag in working days">Lag</span>
            <span title="Driving relationship">Drv</span>
          </div>
          <ul className="max-h-44 overflow-auto">
            {ordered.slice(0, 25).map((d, i) => {
              const otherId = d[otherKey];
              const other = draft.tasks.find((t) => t.id === otherId);
              const isFirstNonDriving =
                driving.length > 0 && i === driving.length;
              return (
                <li
                  key={`${otherId}-${i}`}
                  className={
                    "border-b border-[var(--sched-surface-rule-soft)] last:border-b-0 " +
                    (isFirstNonDriving ? "border-t border-t-[var(--sched-surface-rule)]" : "")
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSelect(otherId)}
                    className="grid w-full grid-cols-[44px_1fr_28px_36px_18px] items-center gap-1 px-1.5 py-1 text-left text-[10.5px] hover:bg-[var(--sched-ivory)]"
                    title={`Jump to activity ${otherId}${
                      other ? " · " + other.name : ""
                    } — ${d.type}${d.lag ? ` ${d.lag > 0 ? "+" : ""}${d.lag}d` : ""} · ${
                      d.isDriving ? "Driving" : "Non-driving"
                    }`}
                  >
                    <span className="truncate font-mono tabular-nums text-[var(--sched-graphite-strong)]">
                      {otherId}
                    </span>
                    <span className="truncate text-[var(--sched-graphite-strong)]">
                      {other?.name ?? "—"}
                    </span>
                    <span className="font-mono text-[9.5px] font-semibold tabular-nums text-[var(--sched-graphite)]">
                      {d.type}
                    </span>
                    <span className="text-right font-mono text-[9.5px] tabular-nums text-[var(--sched-graphite)]">
                      {d.lag ? (d.lag > 0 ? `+${d.lag}` : `${d.lag}`) : "—"}
                    </span>
                    <span
                      className={
                        "text-[10px] " +
                        (d.isDriving ? "font-bold text-[var(--sched-near-critical)]" : "text-[var(--sched-graphite-soft)]")
                      }
                      aria-label={d.isDriving ? "Driving" : "Non-driving"}
                    >
                      {d.isDriving ? "●" : "○"}
                    </span>
                  </button>
                </li>
              );
            })}
            {deps.length > 25 ? (
              <li className="px-1.5 py-0.5 text-[9.5px] text-[var(--sched-graphite)]">
                …+{deps.length - 25} more (jump from the activity table)
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-1.5 text-[10.5px] leading-snug text-[var(--sched-graphite)]">{children}</p>
  );
}

function DisabledChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-disabled
      className="cursor-not-allowed rounded border border-dashed border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--sched-graphite)]"
      title="Reserved — arrives with the annotations data layer."
    >
      {children}
    </span>
  );
}

// =====================================================================
// Helpers
// =====================================================================

type StatusTone = "critical" | "warn" | "ok" | "info" | "neutral";

function deriveStatus(
  task: ScheduledTask,
  draftTask: Task,
  dataDate: string | undefined,
  nearCriticalFloat: number,
): { label: string; tone: StatusTone } {
  const pct = draftTask.percentComplete ?? 0;
  if (pct >= 100) return { label: "Complete", tone: "ok" };
  if (
    dataDate &&
    pct < 100 &&
    task.earlyFinishDate &&
    task.earlyFinishDate < dataDate
  ) {
    return { label: "Behind data date", tone: "warn" };
  }
  if (task.isCritical) return { label: "Critical path", tone: "critical" };
  if (nearCriticalFloat > 0 && task.totalFloat <= nearCriticalFloat) {
    return { label: "Near-critical", tone: "warn" };
  }
  if (pct > 0) return { label: "In progress", tone: "info" };
  return { label: "Planned", tone: "neutral" };
}

function fmtShort(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getUTCMonth()
  ];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${m}-${String(d.getUTCFullYear()).slice(2)}`;
}

function fmtPct(p?: number): string {
  if (p == null) return "0%";
  return `${Math.round(p)}%`;
}

function fmtMoney(n?: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
