import type { ScheduleResult, ScheduledTask } from "@/lib/scheduler/types";

interface Props {
  result: ScheduleResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dayPx?: number;
  collapsedGroups?: Set<string>;
  onToggleGroup?: (key: string) => void;
  baseline?: ScheduleResult | null;
}

const ROW_H = 26;
const GROUP_H = 22;
const LABEL_W = 180;

const UNASSIGNED = "Unassigned";

export function GanttTimeline({
  result,
  selectedId,
  onSelect,
  dayPx = 22,
  collapsedGroups,
  onToggleGroup,
  baseline,
}: Props) {
  const baselineMap = new Map<string, ScheduledTask>();
  if (baseline) for (const b of baseline.tasks) baselineMap.set(b.id, b);
  const duration = Math.max(result.projectDuration, 1);

  // Group tasks by WBS, sorted by earliest ES
  const groupsMap = new Map<string, ScheduledTask[]>();
  for (const t of result.tasks) {
    const key = t.wbs?.trim() || UNASSIGNED;
    const arr = groupsMap.get(key) ?? [];
    arr.push(t);
    groupsMap.set(key, arr);
  }
  const groups = Array.from(groupsMap.entries())
    .map(([key, tasks]) => ({
      key,
      tasks,
      minES: Math.min(...tasks.map((t) => t.earlyStart)),
      maxEF: Math.max(...tasks.map((t) => t.earlyFinish)),
      anyCritical: tasks.some((t) => t.isCritical),
      collapsed: collapsedGroups?.has(key) ?? false,
    }))
    .sort((a, b) => a.minES - b.minES || a.key.localeCompare(b.key));

  // Build flat row list (group headers + visible tasks)
  type Row =
    | { kind: "group"; key: string; minES: number; maxEF: number; anyCritical: boolean; collapsed: boolean }
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
    });
    if (!g.collapsed) {
      for (const t of g.tasks) rows.push({ kind: "task", task: t });
    }
  }

  // Per-row height
  const rowHeights = rows.map((r) => (r.kind === "group" ? GROUP_H : ROW_H));
  const rowYs: number[] = [];
  let acc = 0;
  for (const h of rowHeights) {
    rowYs.push(acc);
    acc += h;
  }
  const totalRowsH = acc;

  const width = LABEL_W + duration * dayPx + 16;
  const height = totalRowsH + 32;

  // Major tick interval based on dayPx (so labels don't overlap)
  const tickEvery = dayPx >= 28 ? 1 : dayPx >= 16 ? 5 : dayPx >= 8 ? 10 : 20;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="block">
        {/* Day grid */}
        {Array.from({ length: duration + 1 }).map((_, i) => {
          const x = LABEL_W + i * dayPx;
          const major = i % tickEvery === 0;
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={height - 16}
                stroke={major ? "#d8cdb8" : "#eee7d8"}
                strokeWidth={1}
              />
              {major ? (
                <text
                  x={x + 2}
                  y={height - 4}
                  fontSize={10}
                  fill="#7a6a4d"
                  fontFamily="ui-sans-serif, system-ui"
                >
                  d{i}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Rows */}
        {rows.map((row, i) => {
          const y = rowYs[i];
          const rowH = rowHeights[i];

          if (row.kind === "group") {
            const x = LABEL_W + row.minES * dayPx;
            const w = Math.max((row.maxEF - row.minES) * dayPx, 2);
            return (
              <g
                key={`g-${row.key}`}
                className="cursor-pointer"
                onClick={() => onToggleGroup?.(row.key)}
              >
                <rect x={0} y={y} width={width} height={rowH} fill="#eee6d7" />
                <text
                  x={8}
                  y={y + rowH / 2 + 4}
                  fontSize={11}
                  fill="#1f241f"
                  fontFamily="ui-sans-serif, system-ui"
                  fontWeight={600}
                >
                  {row.collapsed ? "▸" : "▾"} {truncate(row.key, 22)}
                </text>
                {/* Summary bracket bar */}
                <rect
                  x={x}
                  y={y + rowH / 2 - 3}
                  width={w}
                  height={6}
                  fill={row.anyCritical ? "#b42318" : "#1f241f"}
                  opacity={0.45}
                />
                {/* End caps */}
                <rect x={x} y={y + rowH / 2 - 6} width={2} height={12} fill="#1f241f" opacity={0.6} />
                <rect
                  x={x + w - 2}
                  y={y + rowH / 2 - 6}
                  width={2}
                  height={12}
                  fill="#1f241f"
                  opacity={0.6}
                />
              </g>
            );
          }

          const t = row.task;
          const x = LABEL_W + t.earlyStart * dayPx;
          const w = Math.max(t.duration * dayPx, 2);
          const isSelected = selectedId === t.id;
          const fill = t.isCritical ? "#b42318" : "#1f241f";
          const floatW = t.totalFloat * dayPx;
          const b = baselineMap.get(t.id);
          const slipped = b ? t.earlyFinish - b.earlyFinish : 0;
          return (
            <g key={t.id} className="cursor-pointer" onClick={() => onSelect(t.id)}>
              <rect
                x={0}
                y={y}
                width={width}
                height={rowH}
                fill={isSelected ? "#eee6d7" : "transparent"}
              />
              <text
                x={20}
                y={y + 14}
                fontSize={11}
                fill="#1f241f"
                fontFamily="ui-sans-serif, system-ui"
                fontWeight={t.isCritical ? 600 : 400}
              >
                {t.id} · {truncate(t.name, 18)}
                {b && slipped !== 0 ? (
                  <tspan fill={slipped > 0 ? "#b42318" : "#2f7a3e"} fontSize={10}>
                    {` ${slipped > 0 ? "+" : ""}${slipped}d`}
                  </tspan>
                ) : null}
              </text>
              {b ? (
                <rect
                  x={LABEL_W + b.earlyStart * dayPx}
                  y={y + rowH - 6}
                  width={Math.max(b.duration * dayPx, 2)}
                  height={3}
                  fill="#9c8b6e"
                  opacity={0.9}
                />
              ) : null}
              <rect
                x={x}
                y={y + 4}
                width={w}
                height={rowH - 10}
                rx={3}
                fill={fill}
                opacity={isSelected ? 1 : 0.9}
              />

              {t.percentComplete && t.percentComplete > 0 ? (
                <rect
                  x={x}
                  y={y + rowH / 2 - 1}
                  width={Math.max((w * t.percentComplete) / 100, 1)}
                  height={3}
                  fill="#f7f4ed"
                  opacity={0.85}
                />
              ) : null}
              {floatW > 0 && !t.isCritical ? (
                <rect
                  x={x + w}
                  y={y + rowH / 2 - 1}
                  width={floatW}
                  height={3}
                  fill="#9c8b6e"
                  opacity={0.6}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
