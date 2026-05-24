import { useMemo, useRef, useState } from "react";
import type {
  Annotation,
  ProjectCalendar,
  ScheduleResult,
  ScheduledTask,
} from "@/lib/scheduler/types";

export type GroupByMode = "wbs" | "critical" | "none";

interface Props {
  result: ScheduleResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dayPx?: number;
  collapsedGroups?: Set<string>;
  onToggleGroup?: (key: string) => void;
  baseline?: ScheduleResult | null;
  dataDate?: string;
  calendar?: ProjectCalendar;
  annotations?: Annotation[];
  groupBy?: GroupByMode;
  /** Tasks with totalFloat in (0, nearCriticalFloat] render in amber. 0 disables. */
  nearCriticalFloat?: number;
  onTaskReschedule?: (
    taskId: string,
    patch: { startShiftDays?: number; duration?: number },
  ) => void;
  /** Activity-name column width (px). Defaults to 240. */
  nameColWidth?: number;
}


const ROW_H = 19;
const GROUP_H = 17;
const HEADER_H = 30; // year band + month band
const UNASSIGNED = "Unassigned";
/** Fixed sticky-table widths (sum of <colgroup> col widths other than the name column). */
const STICKY_FIXED_WIDTH = 72 + 36 + 36 + 36 + 44 + 80 + 80 + 44;
const DEFAULT_NAME_COL_WIDTH = 240;
/** Convenience constant — default sticky table width when nameColWidth is unset. */
export const CPM_STICKY_TABLE_WIDTH = STICKY_FIXED_WIDTH + DEFAULT_NAME_COL_WIDTH;
/** Compute total sticky-table width for a given activity-name column width. */
export function getCpmStickyTableWidth(nameColWidth = DEFAULT_NAME_COL_WIDTH): number {
  return STICKY_FIXED_WIDTH + nameColWidth;
}



// ---- calendar helpers --------------------------------------------------

function isWorking(d: Date, cal: ProjectCalendar): boolean {
  const dow = d.getUTCDay();
  const bit = (dow + 6) % 7;
  if (!(cal.workDays & (1 << bit))) return false;
  return !cal.holidays.includes(d.toISOString().slice(0, 10));
}

/** Map every working-day index 0..duration to its calendar date. */
function buildWorkingDateArray(
  startIso: string | undefined,
  duration: number,
  cal: ProjectCalendar,
): Date[] {
  if (!startIso) return [];
  const out: Date[] = [];
  const cur = new Date(`${startIso}T00:00:00.000Z`);
  // Advance to first working day at or after start
  while (!isWorking(cur, cal)) cur.setUTCDate(cur.getUTCDate() + 1);
  out.push(new Date(cur));
  while (out.length <= duration) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (isWorking(cur, cal)) out.push(new Date(cur));
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00.000Z`);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${String(
    d.getUTCFullYear(),
  ).slice(2)}`;
}

// ---- component ---------------------------------------------------------

export function CpmGrid({
  result,
  selectedId,
  onSelect,
  dayPx = 8,
  collapsedGroups,
  onToggleGroup,
  baseline,
  dataDate,
  calendar,
  annotations,
  groupBy = "wbs",
  nearCriticalFloat = 0,
  onTaskReschedule,
  nameColWidth = DEFAULT_NAME_COL_WIDTH,
}: Props) {




  const cal = useMemo(() => calendar ?? { workDays: 31, holidays: [] }, [calendar]);
  const duration = Math.max(result.projectDuration, 1);
  const [drag, setDrag] = useState<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    deltaDays: number;
  } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Group tasks by WBS, ordered by ES
  const { rows, baselineMap } = useMemo(() => {
    const map = new Map<string, ScheduledTask[]>();
    const keyFor = (t: ScheduledTask): string => {
      if (groupBy === "none") return "All activities";
      if (groupBy === "critical") return t.isCritical ? "Critical path" : "Non-critical";
      return t.wbs?.trim() || UNASSIGNED;
    };
    for (const t of result.tasks) {
      const key = keyFor(t);
      const arr = map.get(key) ?? [];
      arr.push(t);

      map.set(key, arr);
    }
    const groups = Array.from(map.entries())
      .map(([key, tasks]) => ({
        key,
        tasks: tasks.slice().sort((a, b) => a.earlyStart - b.earlyStart),
        minES: Math.min(...tasks.map((t) => t.earlyStart)),
        maxEF: Math.max(...tasks.map((t) => t.earlyFinish)),
        anyCritical: tasks.some((t) => t.isCritical),
        collapsed: collapsedGroups?.has(key) ?? false,
      }))
      .sort((a, b) => a.minES - b.minES || a.key.localeCompare(b.key));

    type Row =
      | {
          kind: "group";
          key: string;
          minES: number;
          maxEF: number;
          anyCritical: boolean;
          collapsed: boolean;
          taskCount: number;
        }
      | { kind: "task"; task: ScheduledTask };
    const rows: Row[] = [];
    for (const g of groups) {
      rows.push({
        kind: "group",
        key: g.key,
        minES: g.minES,
        maxEF: g.maxEF,
        anyCritical: g.anyCritical,
        collapsed: g.collapsed,
        taskCount: g.tasks.length,
      });
      if (!g.collapsed) for (const t of g.tasks) rows.push({ kind: "task", task: t });
    }

    const baselineMap = new Map<string, ScheduledTask>();
    if (baseline) for (const b of baseline.tasks) baselineMap.set(b.id, b);

    return { rows, baselineMap };
  }, [result.tasks, collapsedGroups, baseline, groupBy]);

  // Build header bands from working-day → calendar mapping
  const workingDates = useMemo(
    () => buildWorkingDateArray(result.projectStartDate, duration, cal),
    [result.projectStartDate, duration, cal],
  );

  const timelineWidth = duration * dayPx + 1;

  const monthBands = useMemo(() => {
    if (workingDates.length === 0)
      return [] as Array<{ x: number; w: number; label: string; year: number }>;
    const bands: Array<{ x: number; w: number; label: string; year: number }> = [];
    let startIdx = 0;
    let curKey = `${workingDates[0].getUTCFullYear()}-${workingDates[0].getUTCMonth()}`;
    for (let i = 1; i < workingDates.length; i++) {
      const k = `${workingDates[i].getUTCFullYear()}-${workingDates[i].getUTCMonth()}`;
      if (k !== curKey) {
        const d = workingDates[startIdx];
        bands.push({
          x: startIdx * dayPx,
          w: (i - startIdx) * dayPx,
          label: MONTHS[d.getUTCMonth()],
          year: d.getUTCFullYear(),
        });
        startIdx = i;
        curKey = k;
      }
    }
    const d = workingDates[startIdx];
    bands.push({
      x: startIdx * dayPx,
      w: (workingDates.length - startIdx) * dayPx,
      label: MONTHS[d.getUTCMonth()],
      year: d.getUTCFullYear(),
    });
    return bands;
  }, [workingDates, dayPx]);

  const yearBands = useMemo(() => {
    const out: Array<{ x: number; w: number; year: number }> = [];
    for (const m of monthBands) {
      const last = out[out.length - 1];
      if (last && last.year === m.year) {
        last.w += m.w;
      } else {
        out.push({ x: m.x, w: m.w, year: m.year });
      }
    }
    return out;
  }, [monthBands]);

  // Data-date offset (in working days)
  const dataDateOffset = useMemo(() => {
    if (!dataDate || !result.projectStartDate || workingDates.length === 0) return null;
    // first index whose date >= dataDate
    const dd = new Date(`${dataDate}T00:00:00.000Z`).getTime();
    for (let i = 0; i < workingDates.length; i++) {
      if (workingDates[i].getTime() >= dd) return i;
    }
    return workingDates.length;
  }, [dataDate, result.projectStartDate, workingDates]);

  // ---- drag handlers (bar move / right-edge resize) --------------------
  function beginDrag(e: React.PointerEvent<SVGElement>, id: string, mode: "move" | "resize") {
    if (!onTaskReschedule) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, deltaDays: 0 });
  }
  function moveDrag(e: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) / dayPx);
    if (delta !== drag.deltaDays) setDrag({ ...drag, deltaDays: delta });
  }
  function endDrag(e: React.PointerEvent) {
    if (!drag) return;
    if (drag.deltaDays !== 0 && onTaskReschedule) {
      if (drag.mode === "move") {
        onTaskReschedule(drag.id, { startShiftDays: drag.deltaDays });
      } else {
        const t = result.tasks.find((x) => x.id === drag.id);
        if (t) onTaskReschedule(drag.id, { duration: Math.max(0, t.duration + drag.deltaDays) });
      }
    }
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDrag(null);
  }

  // total table height (excluding header)
  const totalH = rows.reduce((acc, r) => acc + (r.kind === "group" ? GROUP_H : ROW_H), 0);

  // Pre-compute row Ys
  const rowYs: number[] = [];
  let yAcc = 0;
  for (const r of rows) {
    rowYs.push(yAcc);
    yAcc += r.kind === "group" ? GROUP_H : ROW_H;
  }

  return (
    <div
      ref={scrollRef}
      className="h-full w-full overflow-auto border-t border-[#e3e0d8] bg-white"
    >
      <div className="flex min-w-max">
        {/* ============ LEFT: activity table ============ */}
        <div className="sticky left-0 z-20 shrink-0 border-r border-[#e3e0d8] bg-white shadow-[1px_0_0_rgba(31,36,31,0.04)]">
          {/* Column header — cool slate-ivory, technical */}
          <div
            className="sticky top-0 z-30 border-b border-[#e3e0d8] bg-[#f3f2ed] text-[10px] font-semibold uppercase tracking-wider text-[#3d3d38]"
            style={{ height: HEADER_H }}
          >
            <table className="w-full border-collapse">
              <colgroup>
                <col style={{ width: 72 }} />
                <col style={{ width: nameColWidth }} />

                <col style={{ width: 36 }} />
                <col style={{ width: 36 }} />
                <col style={{ width: 36 }} />
                <col style={{ width: 44 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr style={{ height: HEADER_H }}>
                  <th className="px-2 text-left">Act ID</th>
                  <th className="px-2 text-left">Activity Name</th>
                  <th className="px-1 text-right">OD</th>
                  <th className="px-1 text-right">AD</th>
                  <th className="px-1 text-right">RD</th>
                  <th className="px-1 text-right">%</th>
                  <th className="px-2 text-left">Start</th>
                  <th className="px-2 text-left">Finish</th>
                  <th className="px-1 text-right">TF</th>
                </tr>
              </thead>
            </table>
          </div>


          {/* Rows */}
          <table
            className="w-full border-collapse text-[11px] text-[#1f241f]"
            style={{ fontFamily: "ui-sans-serif, system-ui" }}
          >
            <colgroup>
              <col style={{ width: 72 }} />
              <col style={{ width: nameColWidth }} />
              <col style={{ width: 36 }} />
              <col style={{ width: 36 }} />
              <col style={{ width: 36 }} />
              <col style={{ width: 44 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <tbody>
              {rows.map((row, i) => {
                if (row.kind === "group") {
                  return (
                    <tr
                      key={`g-${row.key}`}
                      className="cursor-pointer bg-[#eeede7] font-medium text-[#2d2d28] hover:bg-[#e6e5dd]"
                      style={{ height: GROUP_H }}
                      onClick={() => onToggleGroup?.(row.key)}
                    >
                      <td colSpan={9} className="border-b border-[#dad7cd] px-2">
                        <span className="mr-1.5 inline-block w-3 text-center text-[10px] text-[#7a7972]">
                          {row.collapsed ? "▸" : "▾"}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.1em] text-[#4a4944]">{row.key}</span>
                        <span className="ml-2 text-[10px] font-normal text-[#8a8980]">
                          · {row.taskCount}
                        </span>
                      </td>
                    </tr>
                  );
                }
                const t = row.task;
                const isSelected = selectedId === t.id;
                const isMilestone = t.duration === 0;
                const pct = Math.max(0, Math.min(100, t.percentComplete ?? 0));
                const remaining = Math.max(0, Math.ceil(t.duration * (1 - pct / 100)));
                const actual = Math.max(0, t.duration - remaining);
                return (
                  <tr
                    key={t.id}
                    onClick={() => onSelect(t.id)}
                    className={`cursor-pointer border-b border-[#ecebe5] ${
                      isSelected ? "bg-[#eef3f8]" : i % 2 ? "bg-[#fafaf7]" : "bg-white"
                    } hover:bg-[#f5f7fa]`}
                    style={{ height: ROW_H }}
                  >
                    <td className="border-r border-[#ecebe5] px-2 font-mono text-[10px] text-[#6b6a63]">
                      {t.id}
                    </td>
                    <td
                      className={`truncate border-r border-[#ecebe5] px-2 pl-3 text-[#1f241f] ${
                        t.isCritical ? "font-semibold" : ""
                      }`}
                      style={{ maxWidth: 240 }}
                      title={t.name}
                    >
                      {isMilestone ? <span className="mr-1 text-[#7a5cc4]">◆</span> : null}
                      {t.name}
                    </td>
                    <td className="border-r border-[#ecebe5] px-1 text-right tabular-nums text-[#1f241f]">
                      {t.duration}
                    </td>
                    <td className="border-r border-[#ecebe5] px-1 text-right tabular-nums text-[#8a8980]">
                      {actual || ""}
                    </td>
                    <td className="border-r border-[#ecebe5] px-1 text-right tabular-nums text-[#1f241f]">
                      {remaining}
                    </td>
                    <td className="border-r border-[#ecebe5] px-1 text-right tabular-nums text-[#4a4944]">
                      {pct > 0 ? `${pct}%` : ""}
                    </td>
                    <td className="border-r border-[#ecebe5] px-2 text-[10px] tabular-nums text-[#4a4944]">
                      {formatDate(t.earlyStartDate)}
                    </td>
                    <td className="border-r border-[#ecebe5] px-2 text-[10px] tabular-nums text-[#4a4944]">
                      {formatDate(t.earlyFinishDate)}
                    </td>
                    <td
                      className={`px-1 text-right tabular-nums ${
                        t.isCritical
                          ? "font-semibold text-[#b42318]"
                          : nearCriticalFloat > 0 && t.totalFloat > 0 && t.totalFloat <= nearCriticalFloat
                            ? "font-medium text-[#c2750a]"
                            : "text-[#6b6a63]"
                      }`}
                    >
                      {t.totalFloat}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>


        {/* ============ RIGHT: calendar gantt ============ */}
        <div className="relative" style={{ width: timelineWidth }}>
          {/* Header bands */}
          <div
            className="sticky top-0 z-10 border-b border-[#e3e0d8] bg-[#f3f2ed]"
            style={{ height: HEADER_H }}
          >
            <svg width={timelineWidth} height={HEADER_H} className="block">
              {/* year band */}
              {yearBands.map((y, i) => (
                <g key={`y-${i}`}>
                  <rect
                    x={y.x}
                    y={0}
                    width={y.w}
                    height={HEADER_H / 2}
                    fill={i % 2 ? "#e9e7df" : "#eeede7"}
                  />
                  <line x1={y.x} x2={y.x} y1={0} y2={HEADER_H} stroke="#d6d3c9" strokeWidth={1} />
                  {y.w > 24 ? (
                    <text
                      x={y.x + y.w / 2}
                      y={HEADER_H / 2 - 4}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill="#2d2d28"
                      fontFamily="ui-sans-serif, system-ui"
                    >
                      {y.year}
                    </text>
                  ) : null}
                </g>
              ))}
              {/* month band */}
              {monthBands.map((m, i) => (
                <g key={`m-${i}`}>
                  <rect
                    x={m.x}
                    y={HEADER_H / 2}
                    width={m.w}
                    height={HEADER_H / 2}
                    fill={i % 2 ? "#f7f6f1" : "#f3f2ed"}
                  />
                  <line
                    x1={m.x}
                    x2={m.x}
                    y1={HEADER_H / 2}
                    y2={HEADER_H}
                    stroke="#d6d3c9"
                    strokeWidth={1}
                  />
                  {m.w > 16 ? (
                    <text
                      x={m.x + m.w / 2}
                      y={HEADER_H - 5}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#4a4944"
                      fontFamily="ui-sans-serif, system-ui"
                    >
                      {m.w > 28 ? m.label : m.label.slice(0, 1)}
                    </text>
                  ) : null}
                </g>
              ))}
            </svg>
          </div>


          {/* Body */}
          <svg
            width={timelineWidth}
            height={totalH}
            className="block select-none"
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
          >
            {/* Month grid lines */}
            {monthBands.map((m, i) => (
              <line
                key={`gl-${i}`}
                x1={m.x}
                x2={m.x}
                y1={0}
                y2={totalH}
                stroke="#eeede7"
                strokeWidth={1}
              />
            ))}


            {/* Rows */}
            {rows.map((row, i) => {
              const y = rowYs[i];
              const rowH = row.kind === "group" ? GROUP_H : ROW_H;

              if (row.kind === "group") {
                const x = row.minES * dayPx;
                const w = Math.max((row.maxEF - row.minES) * dayPx, 2);
                return (
                  <g key={`g-${row.key}`}>
                    <rect x={0} y={y} width={timelineWidth} height={rowH} fill="#eeede7" />
                    <line x1={0} x2={timelineWidth} y1={y + rowH} y2={y + rowH} stroke="#dad7cd" strokeWidth={1} />
                    {/* slim summary span — quiet, no heavy brackets */}
                    <rect
                      x={x}
                      y={y + rowH / 2 - 1}
                      width={w}
                      height={2}
                      fill={row.anyCritical ? "#9c2418" : "#4a4944"}
                      opacity={0.6}
                    />
                  </g>
                );
              }


              const t = row.task;
              const isSelected = selectedId === t.id;
              const isMilestone = t.duration === 0;
              const x = t.earlyStart * dayPx;
              const w = Math.max(t.duration * dayPx, 2);
              const isNearCritical =
                !t.isCritical && nearCriticalFloat > 0 && t.totalFloat > 0 && t.totalFloat <= nearCriticalFloat;
              const fill = t.isCritical ? "#b42318" : isNearCritical ? "#c2750a" : "#2a3e5f";
              const baselineT = baselineMap.get(t.id);
              const slipped = baselineT ? t.earlyFinish - baselineT.earlyFinish : 0;

              return (
                <g
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  onMouseEnter={(e) => {
                    const c = scrollRef.current?.getBoundingClientRect();
                    if (!c) return;
                    setHover({
                      id: t.id,
                      x: e.clientX - c.left + (scrollRef.current?.scrollLeft ?? 0),
                      y: e.clientY - c.top + (scrollRef.current?.scrollTop ?? 0),
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!hover || hover.id !== t.id) return;
                    const c = scrollRef.current?.getBoundingClientRect();
                    if (!c) return;
                    setHover({
                      id: t.id,
                      x: e.clientX - c.left + (scrollRef.current?.scrollLeft ?? 0),
                      y: e.clientY - c.top + (scrollRef.current?.scrollTop ?? 0),
                    });
                  }}
                  onMouseLeave={() => setHover((h) => (h?.id === t.id ? null : h))}
                  className="cursor-pointer"
                >
                  {/* row background */}
                  <rect
                    x={0}
                    y={y}
                    width={timelineWidth}
                    height={rowH}
                    fill={isSelected ? "#eef3f8" : i % 2 ? "#fafaf7" : "white"}
                  />
                  <line x1={0} x2={timelineWidth} y1={y + rowH} y2={y + rowH} stroke="#ecebe5" />


                  {/* baseline ghost */}
                  {baselineT ? (
                    <rect
                      x={baselineT.earlyStart * dayPx}
                      y={y + rowH - 4}
                      width={Math.max(baselineT.duration * dayPx, 2)}
                      height={2}
                      fill="#a8a59b"
                      opacity={0.9}
                    />
                  ) : null}

                  {isMilestone ? (
                    <>
                      <polygon
                        points={`${x},${y + rowH / 2 - 5} ${x + 5},${y + rowH / 2} ${x},${
                          y + rowH / 2 + 5
                        } ${x - 5},${y + rowH / 2}`}
                        fill={fill}
                        style={{ cursor: onTaskReschedule ? "grab" : "pointer" }}
                        onPointerDown={(e) => beginDrag(e, t.id, "move")}
                      />
                      <text
                        x={x + 9}
                        y={y + rowH / 2 + 3}
                        fontSize={9}
                        fill={fill}
                        fontFamily="ui-sans-serif, system-ui"
                        fontWeight={600}
                        stroke="#faf8f3"
                        strokeWidth={3}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                      >
                        {t.name.length > 30 ? t.name.slice(0, 29) + "…" : t.name}
                      </text>
                    </>
                  ) : (
                    <>
                      <rect
                        x={x}
                        y={y + 3}
                        width={w}
                        height={rowH - 7}
                        rx={0}
                        fill={fill}
                        stroke={isSelected ? "#1f241f" : t.isCritical ? "#8a1d12" : "rgba(0,0,0,0.18)"}
                        strokeWidth={isSelected ? 1.5 : 0.5}
                        style={{ cursor: onTaskReschedule ? "grab" : "pointer" }}
                        onPointerDown={(e) => beginDrag(e, t.id, "move")}
                      />
                      {/* progress overlay (darker fill from left) */}
                      {t.percentComplete && t.percentComplete > 0 ? (
                        <rect
                          x={x}
                          y={y + 3}
                          width={Math.max((w * (t.percentComplete ?? 0)) / 100, 1)}
                          height={rowH - 7}
                          rx={0}
                          fill="#1f241f"
                          opacity={0.55}
                          pointerEvents="none"
                        />
                      ) : null}
                      {/* resize handle */}
                      {onTaskReschedule ? (
                        <rect
                          x={x + w - 4}
                          y={y + 3}
                          width={6}
                          height={rowH - 7}
                          fill="transparent"
                          style={{ cursor: "ew-resize" }}
                          onPointerDown={(e) => beginDrag(e, t.id, "resize")}
                        />
                      ) : null}
                      {/* float bar */}
                      {!t.isCritical && t.totalFloat > 0 ? (
                        <rect
                          x={x + w}
                          y={y + rowH / 2 - 1}
                          width={t.totalFloat * dayPx}
                          height={2}
                          fill="#a8a59b"
                          opacity={0.6}
                          pointerEvents="none"
                        />
                      ) : null}
                      {/* label to the right of the bar */}
                      {dayPx >= 6 ? (
                        <text
                          x={x + w + (t.totalFloat * dayPx || 0) + 4}
                          y={y + rowH / 2 + 3}
                          fontSize={9}
                          fill="#4a4944"
                          fontFamily="ui-sans-serif, system-ui"
                          stroke="#faf8f3"
                          strokeWidth={3}
                          paintOrder="stroke"
                          strokeLinejoin="round"
                        >
                          {t.id}
                          {baselineT && slipped !== 0 ? (
                            <tspan fill={slipped > 0 ? "#b42318" : "#2f7a3e"}>
                              {` ${slipped > 0 ? "+" : ""}${slipped}d`}
                            </tspan>
                          ) : null}
                        </text>
                      ) : null}
                    </>
                  )}


                  {/* drag ghost */}
                  {drag && drag.id === t.id && drag.deltaDays !== 0 ? (
                    <rect
                      x={drag.mode === "move" ? x + drag.deltaDays * dayPx : x}
                      y={y + 4}
                      width={
                        drag.mode === "move"
                          ? Math.max(w, 4)
                          : Math.max((t.duration + drag.deltaDays) * dayPx, 2)
                      }
                      height={rowH - 9}
                      fill={fill}
                      opacity={0.35}
                      stroke="#1f241f"
                      strokeDasharray="3 2"
                      pointerEvents="none"
                    />
                  ) : null}
                </g>
              );
            })}

            {/* ============ Relationship lines (FS/SS/FF/SF) ============ */}
            {(() => {
              const taskRowIdx = new Map<string, number>();
              rows.forEach((r, i) => {
                if (r.kind === "task") taskRowIdx.set(r.task.id, i);
              });
              const taskById = new Map(result.tasks.map((t) => [t.id, t] as const));

              // Build driving-chain back from selected activity
              const drivingChain = new Set<string>();
              if (selectedId) {
                const incoming = new Map<string, typeof result.dependencies>();
                for (const d of result.dependencies) {
                  if (!d.isDriving) continue;
                  const arr = incoming.get(d.to) ?? [];
                  arr.push(d);
                  incoming.set(d.to, arr);
                }
                const stack = [selectedId];
                const visited = new Set<string>();
                while (stack.length) {
                  const cur = stack.pop()!;
                  if (visited.has(cur)) continue;
                  visited.add(cur);
                  for (const d of incoming.get(cur) ?? []) {
                    drivingChain.add(`${d.from}->${d.to}`);
                    stack.push(d.from);
                  }
                }
              }

              return (
                <g>
                  <defs>
                    <marker
                      id="cpm-arrow-crit"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#b42318" />

                    </marker>
                    <marker
                      id="cpm-arrow-drv"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#2a3e5f" />
                    </marker>
                    <marker
                      id="cpm-arrow-soft"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#a8a59b" />
                    </marker>
                    <marker
                      id="cpm-arrow-chain"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#7a5cc4" />
                    </marker>
                  </defs>
                  {result.dependencies.map((d, di) => {
                    const si = taskRowIdx.get(d.from);
                    const ti = taskRowIdx.get(d.to);
                    if (si == null || ti == null) return null;
                    const src = taskById.get(d.from);
                    const tgt = taskById.get(d.to);
                    if (!src || !tgt) return null;
                    const sy = rowYs[si] + ROW_H / 2;
                    const ty = rowYs[ti] + ROW_H / 2;
                    const startX =
                      d.type === "SS" || d.type === "SF"
                        ? src.earlyStart * dayPx
                        : src.earlyFinish * dayPx;
                    const endX =
                      d.type === "FF" || d.type === "SF"
                        ? tgt.earlyFinish * dayPx
                        : tgt.earlyStart * dayPx;
                    const stub = 6;
                    const sOut = d.type === "SS" || d.type === "SF" ? startX - stub : startX + stub;
                    const tIn = d.type === "FF" || d.type === "SF" ? endX + stub : endX - stub;
                    const midX = (d.type === "SS" || d.type === "SF")
                      ? Math.min(sOut, tIn)
                      : Math.max(sOut, tIn);
                    const path = `M ${startX} ${sy} L ${sOut} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tIn} ${ty} L ${endX} ${ty}`;
                    const chainKey = `${d.from}->${d.to}`;
                    const onChain = drivingChain.has(chainKey);
                    const bothCrit = src.isCritical && tgt.isCritical;
                    const stroke = onChain
                      ? "#7a5cc4"
                      : d.isDriving
                      ? bothCrit
                        ? "#b42318"
                        : "#2a3e5f"
                      : "#a8a59b";
                    const marker = onChain
                      ? "url(#cpm-arrow-chain)"
                      : d.isDriving
                      ? bothCrit
                        ? "url(#cpm-arrow-crit)"
                        : "url(#cpm-arrow-drv)"
                      : "url(#cpm-arrow-soft)";
                    const opacity = onChain ? 1 : d.isDriving ? (bothCrit ? 0.55 : 0.4) : 0.14;
                    const sw = onChain ? 1.4 : d.isDriving ? (bothCrit ? 0.9 : 0.75) : 0.55;
                    return (
                      <path
                        key={`dep-${d.id ?? di}`}
                        d={path}
                        stroke={stroke}
                        strokeWidth={sw}
                        opacity={opacity}
                        fill="none"
                        markerEnd={marker}
                        pointerEvents="none"
                      />
                    );
                  })}
                </g>
              );
            })()}



            {/* Data date line */}
            {dataDateOffset !== null && dataDateOffset >= 0 && dataDateOffset <= duration ? (
              <g>
                <line
                  x1={dataDateOffset * dayPx}
                  x2={dataDateOffset * dayPx}
                  y1={0}
                  y2={totalH}
                  stroke="#2f7a3e"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              </g>
            ) : null}

            {/* Annotations */}
            {annotations && workingDates.length > 0
              ? annotations.map((a, i) => {
                  const target = new Date(`${a.date}T00:00:00.000Z`).getTime();
                  let off = -1;
                  for (let k = 0; k < workingDates.length; k++) {
                    if (workingDates[k].getTime() >= target) {
                      off = k;
                      break;
                    }
                  }
                  if (off < 0) return null;
                  const x = off * dayPx;
                  const color = a.kind === "milestone" ? "#7a5cc4" : "#c47a1f";
                  const ly = 10 + (i % 3) * 10;
                  return (
                    <g key={`an-${a.id}`}>
                      <line
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={totalH}
                        stroke={color}
                        strokeWidth={1}
                        strokeDasharray="2 3"
                        opacity={0.5}
                      />
                      <polygon
                        points={`${x},${ly - 4} ${x + 4},${ly} ${x},${ly + 4} ${x - 4},${ly}`}
                        fill={color}
                      />
                      <text
                        x={x + 7}
                        y={ly + 3}
                        fontSize={9}
                        fill={color}
                        fontWeight={600}
                        fontFamily="ui-sans-serif, system-ui"
                        stroke="#faf8f3"
                        strokeWidth={3}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                      >
                        {a.label.length > 24 ? a.label.slice(0, 23) + "…" : a.label}
                      </text>
                    </g>
                  );
                })
              : null}
          </svg>

          {/* Data-date banner pinned at top */}
          {dataDateOffset !== null && dataDateOffset >= 0 && dataDateOffset <= duration ? (
            <div
              className="pointer-events-none absolute z-20 rounded-sm bg-[#2f7a3e] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white"
              style={{ left: dataDateOffset * dayPx - 28, top: HEADER_H - 2 }}
            >
              DATA DATE
            </div>
          ) : null}
        </div>
      </div>

      {/* ============ Activity hover card ============ */}
      {hover ? (() => {
        const t = result.tasks.find((x) => x.id === hover.id);
        if (!t) return null;
        const baselineT = baselineMap.get(t.id);
        const slip = baselineT ? t.earlyFinish - baselineT.earlyFinish : 0;
        const pct = Math.max(0, Math.min(100, t.percentComplete ?? 0));
        const remaining = Math.max(0, Math.ceil(t.duration * (1 - pct / 100)));
        const isMs = t.duration === 0;
        const flipLeft = scrollRef.current
          ? hover.x - (scrollRef.current.scrollLeft ?? 0) >
            (scrollRef.current.clientWidth ?? 9999) * 0.6
          : false;
        return (
          <div
            className="pointer-events-none absolute z-40 w-64 rounded-md border border-[#1f241f]/15 bg-white p-3 text-[11px] shadow-[0_8px_24px_rgba(31,36,31,0.12)]"
            style={{
              left: flipLeft ? hover.x - 268 : hover.x + 12,
              top: hover.y + 12,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  pct >= 100
                    ? "bg-[#2f7a3e]"
                    : t.isCritical
                      ? "bg-[#b42318]"
                      : pct > 0
                        ? "bg-[#5b8bd6]"
                        : "bg-[#c7b89d]"
                }`}
              />
              <span className="font-mono text-[10px] text-[#5c574e]">{t.id}</span>
              {isMs ? (
                <span className="rounded bg-[#eee6d7] px-1 text-[9px] font-semibold uppercase tracking-wide text-[#5c574e]">
                  Milestone
                </span>
              ) : null}
              {t.isCritical ? (
                <span className="rounded bg-[#fbe9e6] px-1 text-[9px] font-semibold uppercase tracking-wide text-[#b42318]">
                  Critical
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[13px] font-semibold text-[#1f241f]">
              {t.name}
            </div>
            {t.wbs ? (
              <div className="text-[10px] text-[#a8a59b]">{t.wbs}</div>
            ) : null}

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              <HC label="Start" value={formatDate(t.earlyStartDate)} />
              <HC label="Finish" value={formatDate(t.earlyFinishDate)} />
              <HC label="Duration" value={`${t.duration}d`} />
              <HC label="Remaining" value={pct >= 100 ? "—" : `${remaining}d`} />
              <HC
                label="Total float"
                value={`${t.totalFloat}d`}
                tone={t.totalFloat < 0 ? "bad" : t.totalFloat === 0 ? "warn" : undefined}
              />
              <HC
                label="% Complete"
                value={`${pct}%`}
                tone={pct >= 100 ? "good" : undefined}
              />
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-[#f3eede]">
              <div
                className={`h-full ${
                  pct >= 100
                    ? "bg-[#2f7a3e]"
                    : t.isCritical
                      ? "bg-[#b42318]"
                      : "bg-[#5b8bd6]"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {t.resourceName ? (
              <div className="mt-2 flex items-center justify-between text-[10px] text-[#5c574e]">
                <span>
                  <span className="text-[#a8a59b]">Resource</span>{" "}
                  <span className="font-medium text-[#1f241f]">{t.resourceName}</span>
                </span>
                {t.resourceUnitsPerDay ? (
                  <span className="font-mono">{t.resourceUnitsPerDay}/d</span>
                ) : null}
              </div>
            ) : null}

            {baselineT && slip !== 0 ? (
              <div
                className={`mt-2 rounded px-1.5 py-1 text-[10px] font-medium ${
                  slip > 0 ? "bg-[#fbe9e6] text-[#b42318]" : "bg-[#e9f3ec] text-[#2f7a3e]"
                }`}
              >
                {slip > 0 ? "Slipping " : "Ahead "}
                {Math.abs(slip)}d vs baseline
              </div>
            ) : null}
          </div>
        );
      })() : null}
    </div>
  );
}

function HC({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-[#2f7a3e]"
      : tone === "bad"
        ? "text-[#b42318]"
        : tone === "warn"
          ? "text-[#a35d10]"
          : "text-[#1f241f]";
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[#a8a59b]">
        {label}
      </div>
      <div className={`text-[12px] font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
