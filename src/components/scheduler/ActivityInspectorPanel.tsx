/**
 * ActivityInspectorPanel — PA-2 Inspector Command Center
 *
 * Persistent right-column inspector for Schedule mode. Renders as a
 * fixed-position aside docked to the right of the work surface, between
 * the page chrome top (header + tab nav ≈ 76px) and the IntelDock strip
 * (44px). The host route applies a matching right-pad to its main content
 * via the `--scheduler-right-pad` CSS variable so this overlay never
 * covers schedule rows.
 *
 * Width:
 *   - expanded: 320px (default)
 *   - rail (collapsed): 56px
 *
 * Pin / collapse state lives in SchedulerLayoutContext (`inspectorOpen`)
 * and is persisted with the rest of the scheduler layout state.
 *
 * No engine, persistence, XER, dry-run, or AI mutation behavior is touched.
 */

import * as React from "react";
import { useSchedulerLayout } from "@/components/scheduler/shell";
import type { NamedCalendar, Schedule, ScheduleResult, ScheduledTask, Task } from "@/lib/scheduler/types";

const RAIL_WIDTH = 56;
const FULL_WIDTH = 320;

export const ACTIVITY_INSPECTOR_RAIL_WIDTH = RAIL_WIDTH;
export const ACTIVITY_INSPECTOR_FULL_WIDTH = FULL_WIDTH;

export interface ActivityInspectorPanelProps {
  draft: Schedule | null;
  computed: ScheduleResult | null;
  calendars: NamedCalendar[];
  selectedTaskId: string | null;
  onSelect: (id: string | null) => void;
  nearCriticalFloat: number;
  /** Vertical offset from the top of the viewport in px (header + nav). */
  topOffset?: number;
  /** Bottom offset to clear the IntelDock strip. */
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
      <header className="flex shrink-0 items-center justify-between gap-1 border-b border-[#ecebe5] bg-[#faf8f3] px-2 py-1.5">
        {expanded ? (
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[#675d4b]">
              {selectedTask ? "Activity" : "Schedule"} Inspector
            </div>
            {selectedTask ? (
              <div
                className="mt-0.5 truncate text-[11.5px] font-semibold tracking-tight text-[#1f241f]"
                title={draftTask?.name ?? ""}
              >
                {selectedTask.id} · {draftTask?.name ?? ""}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className="grid h-7 w-7 place-items-center rounded bg-[#1f241f] text-[9.5px] font-bold tracking-wide text-[#f7e9b8]"
            title={selectedTask ? `${selectedTask.id}` : "Inspector"}
          >
            {selectedTask ? truncId(selectedTask.id) : "i"}
          </div>
        )}
        <button
          type="button"
          onClick={() => setInspectorOpen(!expanded)}
          className="shrink-0 rounded p-1 text-[#6b6a63] hover:bg-white hover:text-[#1f241f]"
          aria-label={expanded ? "Collapse inspector" : "Expand inspector"}
          data-testid="activity-inspector-toggle"
          title={expanded ? "Collapse to rail" : "Expand inspector"}
        >
          {expanded ? "›" : "‹"}
        </button>
      </header>

      {expanded ? (
        <div className="min-h-0 flex-1 overflow-auto p-2.5">
          {selectedTask && draftTask ? (
            <SelectedActivityCommandCenter
              draft={draft!}
              computed={computed!}
              calendars={calendars}
              selectedTask={selectedTask}
              draftTask={draftTask}
              nearCriticalFloat={nearCriticalFloat}
              onSelect={onSelect}
            />
          ) : (
            <NoSelectionSummary
              draft={draft}
              computed={computed}
              nearCriticalFloat={nearCriticalFloat}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-hidden p-1.5">
          {selectedTask ? (
            <div className="text-center text-[9px] font-semibold uppercase tracking-wider text-[#675d4b]">
              Activity
            </div>
          ) : (
            <div className="text-center text-[9px] font-semibold uppercase tracking-wider text-[#675d4b]">
              Idle
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function truncId(id: string): string {
  if (id.length <= 4) return id;
  return id.slice(0, 4);
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
}

function SelectedActivityCommandCenter({
  draft,
  computed,
  calendars,
  selectedTask,
  draftTask,
  nearCriticalFloat,
  onSelect,
}: CommandCenterProps) {
  const status = deriveStatus(selectedTask, draftTask, draft.dataDate, nearCriticalFloat);
  const calendar = calendars.find((c) =>
    draftTask.calendarId ? c.id === draftTask.calendarId : c.isDefault,
  );

  const predDeps = computed.dependencies.filter((d) => d.to === selectedTask.id);
  const succDeps = computed.dependencies.filter((d) => d.from === selectedTask.id);
  const drivingPred = predDeps.filter((d) => d.isDriving).length;
  const drivingSucc = succDeps.filter((d) => d.isDriving).length;

  return (
    <div className="flex flex-col gap-2">
      <Section title="Identity & Status" testId="inspector-section-identity" defaultOpen>
        <KV label="Activity ID" value={selectedTask.id} mono />
        <KV label="Name" value={draftTask.name} title={draftTask.name} />
        <KV label="WBS" value={draftTask.wbs || "—"} mono />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <StatusChip tone={status.tone}>{status.label}</StatusChip>
          {selectedTask.isCritical ? <StatusChip tone="critical">Critical</StatusChip> : null}
          {!selectedTask.isCritical &&
          selectedTask.totalFloat <= nearCriticalFloat &&
          nearCriticalFloat > 0 ? (
            <StatusChip tone="warn">Near-critical</StatusChip>
          ) : null}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Mini label="Duration" value={`${selectedTask.duration}d`} />
          <Mini label="% Comp" value={fmtPct(draftTask.percentComplete)} />
          <Mini label="Total float" value={`${selectedTask.totalFloat}d`} />
          <Mini label="Free float" value={`${selectedTask.freeFloat}d`} />
        </div>
        <KV label="Calendar" value={calendar?.name ?? "Project default"} />
      </Section>

      <Section title="Date Intelligence" testId="inspector-section-dates" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <Mini label="Start" value={fmtShort(selectedTask.earlyStartDate)} />
          <Mini label="Finish" value={fmtShort(selectedTask.earlyFinishDate)} />
          <Mini label="ES" value={fmtShort(selectedTask.earlyStartDate)} />
          <Mini label="EF" value={fmtShort(selectedTask.earlyFinishDate)} />
          <Mini label="LS" value={fmtShort(selectedTask.lateStartDate)} />
          <Mini label="LF" value={fmtShort(selectedTask.lateFinishDate)} />
        </div>
        <KV label="Data date" value={fmtShort(draft.dataDate)} />
        {draftTask.startNoEarlierThan ? (
          <KV
            label="SNET constraint"
            value={fmtShort(draftTask.startNoEarlierThan)}
            mono
          />
        ) : null}
        <p className="mt-1 text-[10px] leading-snug text-[#8a8980]">
          Baseline delta will appear here once a baseline is selected for
          comparison.
        </p>
      </Section>

      <Section title="Logic & Impact" testId="inspector-section-logic" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <Mini label="Predecessors" value={String(predDeps.length)} sub={`${drivingPred} driving`} />
          <Mini label="Successors" value={String(succDeps.length)} sub={`${drivingSucc} driving`} />
        </div>

        <RelationshipList
          title="What blocks this"
          deps={predDeps}
          counterpartKey="from"
          draft={draft}
          onSelect={onSelect}
          emptyLabel="No predecessors — open start."
        />
        <RelationshipList
          title="What this blocks"
          deps={succDeps}
          counterpartKey="to"
          draft={draft}
          onSelect={onSelect}
          emptyLabel="No successors — open end."
        />
      </Section>

      <Section title="Resources & Codes" testId="inspector-section-resources">
        {draftTask.resourceName ||
        draftTask.budgetCost ||
        draftTask.actualCost ||
        draftTask.resourceUnitsPerDay ? (
          <>
            <KV label="Resource" value={draftTask.resourceName || "—"} />
            <KV label="Units/day" value={draftTask.resourceUnitsPerDay?.toString() ?? "—"} mono />
            <KV label="Budget" value={fmtMoney(draftTask.budgetCost)} mono />
            <KV label="Actual" value={fmtMoney(draftTask.actualCost)} mono />
          </>
        ) : (
          <EmptyHint>
            No resource assigned. Activity codes attach via the legacy panel —
            wiring lands in a later phase.
          </EmptyHint>
        )}
      </Section>

      <Section title="Annotations & Flags" testId="inspector-section-flags">
        <EmptyHint>
          Notes, delay flags, and change-order flags get their own data layer
          in a later phase. Reserved here so the surface is ready.
        </EmptyHint>
        <div className="mt-2 flex flex-wrap gap-1">
          <DisabledChip>+ Note</DisabledChip>
          <DisabledChip>⚑ Flag delay</DisabledChip>
          <DisabledChip>$ Change order</DisabledChip>
        </div>
      </Section>

      <Section title="Impact Preview" testId="inspector-section-impact">
        <EmptyHint>
          Mini-Gantt of this activity plus ±2 hops of driving logic arrives
          with the relationships UX upgrade.
        </EmptyHint>
      </Section>
    </div>
  );
}

// =====================================================================
// No-selection schedule summary
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
      <EmptyHint>
        Load a schedule to see project KPIs and pick an activity to inspect.
      </EmptyHint>
    );
  }

  const total = computed.tasks.length;
  const critical = computed.tasks.filter((t) => t.isCritical).length;
  const nearCritical = computed.tasks.filter(
    (t) => !t.isCritical && t.totalFloat <= nearCriticalFloat,
  ).length;
  const diagnostics = computed.diagnostics?.length ?? 0;
  const openEnds = computeOpenEnds(draft, computed);
  const behindDataDate = draft.dataDate
    ? computed.tasks.filter(
        (t) =>
          (t.percentComplete ?? 0) < 100 &&
          t.earlyFinishDate &&
          t.earlyFinishDate < draft.dataDate!,
      ).length
    : 0;

  return (
    <div className="flex flex-col gap-2">
      <Section title="Schedule" testId="inspector-section-schedule" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <Mini label="Finish" value={fmtShort(computed.projectFinishDate)} />
          <Mini label="Data date" value={fmtShort(draft.dataDate)} />
          <Mini label="Activities" value={String(total)} />
          <Mini label="Behind DD" value={String(behindDataDate)} />
        </div>
      </Section>

      <Section title="Critical exposure" testId="inspector-section-critical" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <Mini label="Critical" value={String(critical)} />
          <Mini
            label="Near-critical"
            value={String(nearCritical)}
            sub={nearCriticalFloat > 0 ? `≤${nearCriticalFloat}d float` : "—"}
          />
        </div>
      </Section>

      <Section title="Schedule quality" testId="inspector-section-quality" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <Mini label="Diagnostics" value={String(diagnostics)} />
          <Mini label="Open ends" value={String(openEnds)} />
        </div>
      </Section>

      <EmptyHint>
        Select an activity in the table or Gantt to open its command center.
      </EmptyHint>
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
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section
      className="rounded border border-[#ecebe5] bg-[#faf8f3]"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-t px-2.5 py-1.5 text-left hover:bg-white"
        aria-expanded={open}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
          {title}
        </span>
        <span className="text-[10px] text-[#8a8980]">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="border-t border-[#ecebe5] bg-white p-2.5 text-[11.5px] text-[#1f241f]">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function KV({
  label,
  value,
  mono = false,
  title,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#8a8980]">
        {label}
      </span>
      <span
        className={
          "min-w-0 truncate text-[11.5px] text-[#1f241f] " +
          (mono ? "font-mono tabular-nums" : "")
        }
        title={title ?? (typeof value === "string" ? value : undefined)}
      >
        {value}
      </span>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[#ecebe5] bg-[#faf8f3] px-2 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[#8a8980]">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-[12px] tabular-nums text-[#1f241f]">
        {value}
      </div>
      {sub ? <div className="text-[9.5px] text-[#8a8980]">{sub}</div> : null}
    </div>
  );
}

function StatusChip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "critical" | "warn" | "ok" | "neutral" | "info";
}) {
  const cls =
    tone === "critical"
      ? "bg-[#fbe5e1] text-[#7a1d12]"
      : tone === "warn"
        ? "bg-[#fbeed0] text-[#7a5512]"
        : tone === "ok"
          ? "bg-[#dcecdf] text-[#2f5e3a]"
          : tone === "info"
            ? "bg-[#dee5ef] text-[#2a3e5f]"
            : "bg-[#ecebe5] text-[#4a4944]";
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider " + cls
      }
    >
      {children}
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] leading-snug text-[#8a8980]">{children}</p>
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

function RelationshipList({
  title,
  deps,
  counterpartKey,
  draft,
  onSelect,
  emptyLabel,
}: {
  title: string;
  deps: Array<{ from: string; to: string; type: string; lag: number; isDriving: boolean }>;
  counterpartKey: "from" | "to";
  draft: Schedule;
  onSelect: (id: string | null) => void;
  emptyLabel: string;
}) {
  return (
    <div className="mt-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-[#675d4b]">
        {title}
      </div>
      {deps.length === 0 ? (
        <p className="mt-1 text-[10.5px] text-[#8a8980]">{emptyLabel}</p>
      ) : (
        <ul className="mt-1 max-h-40 overflow-auto rounded border border-[#ecebe5] bg-[#faf8f3]">
          {deps.slice(0, 12).map((d, i) => {
            const otherId = d[counterpartKey];
            const other = draft.tasks.find((t) => t.id === otherId);
            return (
              <li key={`${otherId}-${i}`} className="border-b border-[#ecebe5] last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(otherId)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-white"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    <span className="font-mono tabular-nums text-[#1f241f]">{otherId}</span>
                    {other ? (
                      <span className="ml-1.5 text-[#6b6a63]">· {other.name}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-[#675d4b]">
                    {d.type}
                    {d.lag ? (d.lag > 0 ? ` +${d.lag}d` : ` ${d.lag}d`) : ""}
                  </span>
                  {d.isDriving ? (
                    <span
                      className="shrink-0 text-[10px] text-[#c2750a]"
                      title="Driving relationship"
                    >
                      ★
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {deps.length > 12 ? (
            <li className="px-2 py-1 text-[10px] text-[#8a8980]">
              …+{deps.length - 12} more
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================

function deriveStatus(
  task: ScheduledTask,
  draftTask: Task,
  dataDate: string | undefined,
  nearCriticalFloat: number,
): { label: string; tone: "critical" | "warn" | "ok" | "info" | "neutral" } {
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
  if (task.isCritical) return { label: "On critical path", tone: "critical" };
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
  if (p == null) return "—";
  return `${Math.round(p)}%`;
}

function fmtMoney(n?: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
