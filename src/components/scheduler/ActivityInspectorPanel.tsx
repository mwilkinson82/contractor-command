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
  topOffset = 76,
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
      className="fixed right-0 z-30 flex flex-col border-l border-[#e3e0d8] bg-white shadow-[-1px_0_0_rgba(0,0,0,0.02)] print:hidden"
      style={{
        top: topOffset,
        bottom: bottomOffset,
        width: expanded ? FULL_WIDTH : RAIL_WIDTH,
        transition: "width 120ms ease",
      }}
    >
      {/* HEADER — stronger selected-activity identity */}
      {expanded ? (
        <header
          className={
            "shrink-0 border-b px-3 py-2 " +
            (selectedTask
              ? "border-[#1f241f] bg-[#1f241f] text-[#f5f0e0]"
              : "border-[#ecebe5] bg-[#faf8f3] text-[#1f241f]")
          }
        >
          <div className="flex items-center justify-between gap-2">
            <div
              className={
                "text-[9.5px] font-semibold uppercase tracking-[0.2em] " +
                (selectedTask ? "text-[#c9a84c]" : "text-[#675d4b]")
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
                  ? "text-[#c9a84c] hover:bg-[#2a2f2a]"
                  : "text-[#6b6a63] hover:bg-white")
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
                <span className="font-mono text-[12px] tabular-nums text-[#c9a84c]">
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
              <div className="mt-1 text-[10px] text-[#9b9075]">
                {draftTask.wbs ? `WBS ${draftTask.wbs} · ` : ""}
                {selectedTask.duration}d · {fmtShort(selectedTask.earlyStartDate)} →{" "}
                {fmtShort(selectedTask.earlyFinishDate)}
              </div>
            </>
          ) : null}
        </header>
      ) : (
        <header className="flex shrink-0 items-center justify-center border-b border-[#ecebe5] bg-[#faf8f3] py-1.5">
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="grid h-7 w-7 place-items-center rounded bg-[#1f241f] text-[10px] font-bold tracking-wide text-[#f7e9b8] hover:bg-[#2a2f2a]"
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
      return "bg-[#b42318] text-white";
    case "warn":
      return "bg-[#d4842a] text-[#241a05]";
    case "ok":
      return "bg-[#3d8a5c] text-white";
    case "info":
      return "bg-[#3b5f8a] text-white";
    default:
      return "bg-[#3a3f3a] text-[#d8d3c2]";
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
      <div className="flex items-center justify-between border-b border-[#ecebe5] bg-[#faf8f3] px-3 py-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
          {fmtPct(draftTask.percentComplete)} complete · TF {selectedTask.totalFloat}d · FF{" "}
          {selectedTask.freeFloat}d
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] uppercase tracking-wider text-[#675d4b] hover:text-[#1f241f]"
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
          title="What blocks this"
          deps={predDeps}
          otherKey="from"
          draft={draft}
          onSelect={onSelect}
          emptyLabel="No predecessors — open start"
        />
        <RelTable
          title="What this blocks"
          deps={succDeps}
          otherKey="to"
          draft={draft}
          onSelect={onSelect}
          emptyLabel="No successors — open end"
        />
      </Section>

      <Section title="Date Intelligence" defaultOpen testId="inspector-section-dates">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 px-3 py-1.5 font-mono text-[11px] tabular-nums text-[#1f241f]">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
            &nbsp;
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
            Early
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
            Late
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
            Start
          </span>
          <span>{fmtShort(selectedTask.earlyStartDate)}</span>
          <span>{fmtShort(selectedTask.lateStartDate)}</span>
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
            Finish
          </span>
          <span>{fmtShort(selectedTask.earlyFinishDate)}</span>
          <span>{fmtShort(selectedTask.lateFinishDate)}</span>
        </div>
        <Row label="Data date" value={fmtShort(draft.dataDate)} mono />
        <p className="px-3 pb-2 text-[10px] leading-snug text-[#8a8980]">
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
      <div className="border-t border-[#ecebe5] px-3 py-2">
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
      className={"border-b border-[#ecebe5] " + (emphasis ? "bg-[#fbf5e3]/40" : "")}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[#faf8f3]"
        aria-expanded={open}
      >
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-[0.18em] " +
            (emphasis ? "text-[#7a5512]" : "text-[#675d4b]")
          }
        >
          {title}
        </span>
        <span className="text-[10px] text-[#8a8980]">{open ? "▾" : "▸"}</span>
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
      <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
        {label}
      </span>
      <span
        className={
          "min-w-0 truncate text-[11.5px] text-[#1f241f] " +
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
      ? "text-[#b42318]"
      : tone === "warn"
        ? "text-[#a36514]"
        : tone === "ok"
          ? "text-[#2f5e3a]"
          : "text-[#1f241f]";
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[#f4f2ec] px-3 py-1.5 last:border-b-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#675d4b]">
        {label}
        {sub ? <span className="ml-1.5 text-[9px] normal-case text-[#8a8980]">{sub}</span> : null}
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
  return <div className="h-px bg-[#ecebe5]" />;
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
    <div className="rounded border border-[#e3e0d8] bg-white px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[#8a8980]">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-[16px] font-semibold tabular-nums leading-none text-[#1f241f]">
          {count}
        </span>
        <span className="text-[10px] text-[#c2750a]" title="Driving relationships">
          ★ {driving}
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
  return (
    <div className="px-3 pb-2 pt-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[#675d4b]">
          {title}
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-[#8a8980]">
          {deps.length}
        </span>
      </div>
      {deps.length === 0 ? (
        <p className="text-[10.5px] italic text-[#8a8980]">{emptyLabel}</p>
      ) : (
        <div className="overflow-hidden rounded border border-[#e3e0d8] bg-white">
          {/* Column headers */}
          <div className="grid grid-cols-[44px_1fr_28px_36px_18px] items-center gap-1 border-b border-[#ecebe5] bg-[#faf8f3] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-[#8a8980]">
            <span>ID</span>
            <span>Name</span>
            <span>Type</span>
            <span className="text-right">Lag</span>
            <span title="Driving">★</span>
          </div>
          <ul className="max-h-44 overflow-auto">
            {deps.slice(0, 25).map((d, i) => {
              const otherId = d[otherKey];
              const other = draft.tasks.find((t) => t.id === otherId);
              return (
                <li
                  key={`${otherId}-${i}`}
                  className="border-b border-[#f4f2ec] last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(otherId)}
                    className="grid w-full grid-cols-[44px_1fr_28px_36px_18px] items-center gap-1 px-1.5 py-1 text-left text-[10.5px] hover:bg-[#faf8f3]"
                    title={`Jump to ${otherId}${other ? " · " + other.name : ""}`}
                  >
                    <span className="truncate font-mono tabular-nums text-[#1f241f]">
                      {otherId}
                    </span>
                    <span className="truncate text-[#3a3f3a]">
                      {other?.name ?? "—"}
                    </span>
                    <span className="font-mono text-[9.5px] tabular-nums text-[#675d4b]">
                      {d.type}
                    </span>
                    <span className="text-right font-mono text-[9.5px] tabular-nums text-[#675d4b]">
                      {d.lag ? (d.lag > 0 ? `+${d.lag}` : `${d.lag}`) : "—"}
                    </span>
                    <span className="text-[10px] text-[#c2750a]">
                      {d.isDriving ? "★" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
            {deps.length > 25 ? (
              <li className="px-1.5 py-0.5 text-[9.5px] text-[#8a8980]">
                …+{deps.length - 25} more
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
    <p className="px-3 py-1.5 text-[10.5px] leading-snug text-[#8a8980]">{children}</p>
  );
}

function DisabledChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-disabled
      className="cursor-not-allowed rounded border border-dashed border-[#dad7cd] bg-[#faf8f3] px-1.5 py-0.5 text-[10px] font-medium text-[#8a8980]"
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
