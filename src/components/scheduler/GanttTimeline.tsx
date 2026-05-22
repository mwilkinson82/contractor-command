import type { ScheduleResult, ScheduledTask } from "@/lib/scheduler/types";

interface Props {
  result: ScheduleResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const ROW_H = 28;
const LABEL_W = 140;
const MIN_DAY_PX = 18;
const MAX_DAY_PX = 48;

export function GanttTimeline({ result, selectedId, onSelect }: Props) {
  const duration = Math.max(result.projectDuration, 1);
  // Fit-ish: target ~720px usable width
  const dayPx = Math.min(MAX_DAY_PX, Math.max(MIN_DAY_PX, Math.floor(720 / duration)));
  const width = LABEL_W + duration * dayPx + 16;
  const height = result.tasks.length * ROW_H + 32;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="block">
        {/* Day grid */}
        {Array.from({ length: duration + 1 }).map((_, i) => {
          const x = LABEL_W + i * dayPx;
          const major = i % 5 === 0;
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

        {/* Bars */}
        {result.tasks.map((t: ScheduledTask, i: number) => {
          const y = i * ROW_H + 4;
          const x = LABEL_W + t.earlyStart * dayPx;
          const w = Math.max(t.duration * dayPx, 2);
          const isSelected = selectedId === t.id;
          const fill = t.isCritical ? "#b42318" : "#1f241f";
          const floatW = t.totalFloat * dayPx;
          return (
            <g
              key={t.id}
              className="cursor-pointer"
              onClick={() => onSelect(t.id)}
            >
              {/* Row hover background */}
              <rect
                x={0}
                y={i * ROW_H}
                width={width}
                height={ROW_H}
                fill={isSelected ? "#eee6d7" : "transparent"}
              />
              {/* Label */}
              <text
                x={8}
                y={y + 14}
                fontSize={11}
                fill="#1f241f"
                fontFamily="ui-sans-serif, system-ui"
                fontWeight={t.isCritical ? 600 : 400}
              >
                {t.id} · {truncate(t.name, 14)}
              </text>
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={w}
                height={ROW_H - 8}
                rx={3}
                fill={fill}
                opacity={isSelected ? 1 : 0.9}
              />
              {/* % complete overlay */}
              {t.percentComplete && t.percentComplete > 0 ? (
                <rect
                  x={x}
                  y={y + (ROW_H - 8) / 2 - 1}
                  width={Math.max((w * t.percentComplete) / 100, 1)}
                  height={3}
                  fill="#f7f4ed"
                  opacity={0.85}
                />
              ) : null}
              {/* Float tail */}
              {floatW > 0 && !t.isCritical ? (
                <rect
                  x={x + w}
                  y={y + (ROW_H - 8) / 2 - 1}
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
