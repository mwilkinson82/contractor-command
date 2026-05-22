import { useMemo, useRef, useState } from "react";
import type {
  Annotation,
  ProjectCalendar,
  ScheduleResult,
  ScheduledTask,
} from "@/lib/scheduler/types";

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
  onTaskReschedule?: (
    taskId: string,
    patch: { startShiftDays?: number; duration?: number },
  ) => void;
}

const ROW_H = 24;
const GROUP_H = 22;
const HEADER_H = 44; // year band + month band
const UNASSIGNED = "Unassigned";

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
  onTaskReschedule,
}: Props) {
  const cal = useMemo(() => calendar ?? { workDays: 31, holidays: [] }, [calendar]);
  const duration = Math.max(result.projectDuration, 1);
  const [drag, setDrag] = useState<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    deltaDays: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Group tasks by WBS, ordered by ES
  const { rows, baselineMap } = useMemo(() => {
    const map = new Map<string, ScheduledTask[]>();
    for (const t of result.tasks) {
      const key = t.wbs?.trim() || UNASSIGNED;
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
  }, [result.tasks, collapsedGroups, baseline]);

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
      className="overflow-auto border-t border-[#d8cdb8] bg-white"
      style={{ maxHeight: "70vh" }}
    >
      <div className="flex min-w-max">
        {/* ============ LEFT: activity table ============ */}
        <div className="sticky left-0 z-20 shrink-0 border-r border-[#d8cdb8] bg-white shadow-[2px_0_0_rgba(0,0,0,0.03)]">
          {/* Column header */}
          <div
            className="sticky top-0 z-30 border-b border-[#d8cdb8] bg-[#1f241f] text-[10px] font-semibold uppercase tracking-wider text-[#e8e0cd]"
            style={{ height: HEADER_H }}
          >
            <table className="w-full border-collapse">
              <colgroup>
                <col style={{ width: 72 }} />
                <col style={{ width: 240 }} />
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
              <col style={{ width: 240 }} />
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
                      className="cursor-pointer bg-[#dde6c8] font-semibold text-[#23341a] hover:bg-[#d4dfb9]"
                      style={{ height: GROUP_H }}
                      onClick={() => onToggleGroup?.(row.key)}
                    >
                      <td colSpan={9} className="border-b border-[#c5cfaf] px-2">
                        <span className="mr-1 inline-block w-3 text-center">
                          {row.collapsed ? "▸" : "▾"}
                        </span>
                        {row.key}
                        <span className="ml-2 text-[10px] font-normal text-[#5a6a44]">
                          {row.taskCount} {row.taskCount === 1 ? "activity" : "activities"}
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
                    className={`cursor-pointer border-b border-[#eee6d7] ${
                      isSelected ? "bg-[#fff7e0]" : i % 2 ? "bg-[#faf7ee]" : "bg-white"
                    } hover:bg-[#fff3d0]`}
                    style={{ height: ROW_H }}
                  >
                    <td className="border-r border-[#eee6d7] px-2 font-mono text-[10px] text-[#5c574e]">
                      {t.id}
                    </td>
                    <td
                      className={`truncate border-r border-[#eee6d7] px-2 ${
                        t.isCritical ? "font-semibold text-[#1f241f]" : ""
                      }`}
                      style={{ maxWidth: 240 }}
                      title={t.name}
                    >
                      {isMilestone ? "◆ " : ""}
                      {t.name}
                    </td>
                    <td className="border-r border-[#eee6d7] px-1 text-right tabular-nums">
                      {t.duration}
                    </td>
                    <td className="border-r border-[#eee6d7] px-1 text-right tabular-nums text-[#776e5e]">
                      {actual || ""}
                    </td>
                    <td className="border-r border-[#eee6d7] px-1 text-right tabular-nums">
                      {remaining}
                    </td>
                    <td className="border-r border-[#eee6d7] px-1 text-right tabular-nums">
                      {pct > 0 ? `${pct}%` : ""}
                    </td>
                    <td className="border-r border-[#eee6d7] px-2 text-[10px] tabular-nums text-[#5c574e]">
                      {formatDate(t.earlyStartDate)}
                    </td>
                    <td className="border-r border-[#eee6d7] px-2 text-[10px] tabular-nums text-[#5c574e]">
                      {formatDate(t.earlyFinishDate)}
                    </td>
                    <td
                      className={`px-1 text-right tabular-nums ${
                        t.isCritical
                          ? "font-semibold text-[#b42318]"
                          : t.totalFloat <= 5
                            ? "text-[#9b7400]"
                            : "text-[#5c574e]"
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
            className="sticky top-0 z-10 border-b border-[#d8cdb8] bg-[#f3ecdb]"
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
                    fill={i % 2 ? "#e8dfca" : "#ede5d2"}
                  />
                  <line x1={y.x} x2={y.x} y1={0} y2={HEADER_H} stroke="#c8bd9f" strokeWidth={1} />
                  {y.w > 24 ? (
                    <text
                      x={y.x + y.w / 2}
                      y={HEADER_H / 2 - 5}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill="#3a3424"
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
                    fill={i % 2 ? "#f7f1e1" : "#f3ecdb"}
                  />
                  <line
                    x1={m.x}
                    x2={m.x}
                    y1={HEADER_H / 2}
                    y2={HEADER_H}
                    stroke="#c8bd9f"
                    strokeWidth={1}
                  />
                  {m.w > 16 ? (
                    <text
                      x={m.x + m.w / 2}
                      y={HEADER_H - 6}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#5c574e"
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
                stroke="#eee6d7"
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
                    <rect x={0} y={y} width={timelineWidth} height={rowH} fill="#dde6c8" />
                    {/* summary bracket */}
                    <path
                      d={`M ${x} ${y + rowH / 2 + 6} L ${x} ${y + rowH / 2 - 4} L ${x + w} ${
                        y + rowH / 2 - 4
                      } L ${x + w} ${y + rowH / 2 + 6} M ${x} ${y + rowH / 2 - 4} L ${x + w} ${
                        y + rowH / 2 - 4
                      }`}
                      stroke={row.anyCritical ? "#b42318" : "#23341a"}
                      strokeWidth={3}
                      fill="none"
                    />
                  </g>
                );
              }

              const t = row.task;
              const isSelected = selectedId === t.id;
              const isMilestone = t.duration === 0;
              const x = t.earlyStart * dayPx;
              const w = Math.max(t.duration * dayPx, 2);
              const fill = t.isCritical ? "#b42318" : "#3554a5";
              const baselineT = baselineMap.get(t.id);
              const slipped = baselineT ? t.earlyFinish - baselineT.earlyFinish : 0;

              return (
                <g key={t.id} onClick={() => onSelect(t.id)} className="cursor-pointer">
                  {/* row background */}
                  <rect
                    x={0}
                    y={y}
                    width={timelineWidth}
                    height={rowH}
                    fill={isSelected ? "#fff7e0" : i % 2 ? "#faf7ee" : "white"}
                  />
                  <line x1={0} x2={timelineWidth} y1={y + rowH} y2={y + rowH} stroke="#eee6d7" />

                  {/* baseline ghost */}
                  {baselineT ? (
                    <rect
                      x={baselineT.earlyStart * dayPx}
                      y={y + rowH - 5}
                      width={Math.max(baselineT.duration * dayPx, 2)}
                      height={3}
                      fill="#9c8b6e"
                      opacity={0.9}
                    />
                  ) : null}

                  {isMilestone ? (
                    <>
                      <polygon
                        points={`${x},${y + rowH / 2 - 6} ${x + 6},${y + rowH / 2} ${x},${
                          y + rowH / 2 + 6
                        } ${x - 6},${y + rowH / 2}`}
                        fill={fill}
                        style={{ cursor: onTaskReschedule ? "grab" : "pointer" }}
                        onPointerDown={(e) => beginDrag(e, t.id, "move")}
                      />
                      <text
                        x={x + 10}
                        y={y + rowH / 2 + 3}
                        fontSize={9}
                        fill={fill}
                        fontFamily="ui-sans-serif, system-ui"
                        fontWeight={600}
                      >
                        {t.name.length > 30 ? t.name.slice(0, 29) + "…" : t.name}
                      </text>
                    </>
                  ) : (
                    <>
                      <rect
                        x={x}
                        y={y + 4}
                        width={w}
                        height={rowH - 9}
                        rx={1}
                        fill={fill}
                        stroke={isSelected ? "#1f241f" : "transparent"}
                        strokeWidth={1.5}
                        style={{ cursor: onTaskReschedule ? "grab" : "pointer" }}
                        onPointerDown={(e) => beginDrag(e, t.id, "move")}
                      />
                      {/* progress overlay (darker fill from left) */}
                      {t.percentComplete && t.percentComplete > 0 ? (
                        <rect
                          x={x}
                          y={y + 4}
                          width={Math.max((w * (t.percentComplete ?? 0)) / 100, 1)}
                          height={rowH - 9}
                          rx={1}
                          fill="#1f241f"
                          opacity={0.6}
                          pointerEvents="none"
                        />
                      ) : null}
                      {/* resize handle */}
                      {onTaskReschedule ? (
                        <rect
                          x={x + w - 4}
                          y={y + 4}
                          width={6}
                          height={rowH - 9}
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
                          fill="#9c8b6e"
                          opacity={0.65}
                          pointerEvents="none"
                        />
                      ) : null}
                      {/* label to the right of the bar */}
                      {dayPx >= 6 ? (
                        <text
                          x={x + w + (t.totalFloat * dayPx || 0) + 4}
                          y={y + rowH / 2 + 3}
                          fontSize={9}
                          fill="#5c574e"
                          fontFamily="ui-sans-serif, system-ui"
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
                      <path d="M0,0 L10,5 L0,10 z" fill="#3554a5" />
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
                      <path d="M0,0 L10,5 L0,10 z" fill="#9c8b6e" />
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
                        : "#3554a5"
                      : "#9c8b6e";
                    const marker = onChain
                      ? "url(#cpm-arrow-chain)"
                      : d.isDriving
                      ? bothCrit
                        ? "url(#cpm-arrow-crit)"
                        : "url(#cpm-arrow-drv)"
                      : "url(#cpm-arrow-soft)";
                    const opacity = onChain ? 1 : d.isDriving ? 0.85 : 0.4;
                    const sw = onChain ? 1.6 : d.isDriving ? 1.1 : 0.8;
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
    </div>
  );
}
