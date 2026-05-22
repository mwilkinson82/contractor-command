import { useMemo } from "react";
import { calculateSchedule } from "@/lib/scheduler/engine";
import type { Schedule, ScheduledTask } from "@/lib/scheduler/types";

const SAMPLE_SCHEDULE: Schedule = {
  id: "sample-commercial-fitout",
  name: "Sample Commercial Fit-Out",
  projectStartDate: "2026-06-01",
  tasks: [
    { id: "A100", name: "Mobilize and site setup", duration: 2, wbs: "01 General" },
    { id: "A110", name: "Layout and selective demo", duration: 3, wbs: "02 Demo" },
    { id: "A120", name: "Underground rough-in", duration: 4, wbs: "22 Plumbing" },
    { id: "A130", name: "Framing and blocking", duration: 5, wbs: "09 Interiors" },
    { id: "A140", name: "MEP rough-in", duration: 6, wbs: "23 MEP" },
    { id: "A150", name: "Drywall hang and finish", duration: 5, wbs: "09 Interiors" },
    { id: "A160", name: "Paint and wall finishes", duration: 3, wbs: "09 Interiors" },
    { id: "A170", name: "Ceilings, devices, trim", duration: 4, wbs: "09 Interiors" },
    { id: "A180", name: "Final inspections and punch", duration: 2, wbs: "01 General" },
  ],
  dependencies: [
    { from: "A100", to: "A110", type: "FS" },
    { from: "A110", to: "A120", type: "FS" },
    { from: "A110", to: "A130", type: "FS" },
    { from: "A120", to: "A140", type: "SS", lag: 1 },
    { from: "A130", to: "A140", type: "FS" },
    { from: "A140", to: "A150", type: "FS" },
    { from: "A150", to: "A160", type: "FS" },
    { from: "A160", to: "A170", type: "SS", lag: 1 },
    { from: "A170", to: "A180", type: "FS" },
  ],
};

export function SchedulerRoughView() {
  const result = useMemo(() => calculateSchedule(SAMPLE_SCHEDULE), []);
  const timelineDays = Array.from({ length: result.projectDuration + 1 }, (_, day) => day);
  const maxFinish = Math.max(1, result.projectDuration);

  return (
    <div className="min-h-screen bg-[#f7f4ed] px-4 py-8 text-[#1f241f] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7a6a4d]">
              CPM scheduler prototype
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{result.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#5c574e]">
              A plain React preview using the portable TypeScript engine. This is intentionally
              rough: the next pass can replace the visuals without touching the scheduling math.
            </p>
          </div>
          <div className="rounded border border-[#d8cdb8] bg-white/70 px-4 py-3 text-sm">
            <div className="font-medium">Project duration</div>
            <div className="mt-1 text-2xl font-semibold">{result.projectDuration} days</div>
            {result.projectFinishDate ? (
              <div className="text-xs text-[#6f6759]">Finish: {result.projectFinishDate}</div>
            ) : null}
          </div>
        </header>

        <section className="overflow-hidden rounded border border-[#d8cdb8] bg-white">
          <div className="grid grid-cols-[minmax(320px,0.9fr)_minmax(560px,1.6fr)] overflow-x-auto">
            <div className="border-r border-[#e4dbc9]">
              <div className="grid grid-cols-[86px_1fr_72px_72px] border-b border-[#e4dbc9] bg-[#eee6d7] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#675d4b]">
                <span>ID</span>
                <span>Task</span>
                <span>Float</span>
                <span>Dur.</span>
              </div>
              {result.tasks.map((task) => (
                <div
                  key={task.id}
                  className="grid min-h-12 grid-cols-[86px_1fr_72px_72px] items-center border-b border-[#eee7d8] px-3 py-2 text-sm"
                >
                  <span
                    className={task.isCritical ? "font-semibold text-[#b42318]" : "font-medium"}
                  >
                    {task.id}
                  </span>
                  <span>
                    <span className="block font-medium">{task.name}</span>
                    <span className="text-xs text-[#776e5e]">{task.wbs}</span>
                  </span>
                  <span className={task.isCritical ? "font-semibold text-[#b42318]" : ""}>
                    {task.totalFloat}
                  </span>
                  <span>{task.duration}d</span>
                </div>
              ))}
            </div>

            <div className="min-w-[560px]">
              <div
                className="grid border-b border-[#e4dbc9] bg-[#eee6d7] text-center text-[11px] font-semibold text-[#675d4b]"
                style={{ gridTemplateColumns: `repeat(${timelineDays.length}, minmax(24px, 1fr))` }}
              >
                {timelineDays.map((day) => (
                  <span key={day} className="border-r border-[#e0d6c5] py-2">
                    {day}
                  </span>
                ))}
              </div>

              {result.tasks.map((task) => (
                <div
                  key={task.id}
                  className="relative min-h-12 border-b border-[#eee7d8]"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(216,205,184,0.45) 1px, transparent 1px)",
                    backgroundSize: `${100 / timelineDays.length}% 100%`,
                  }}
                >
                  <div
                    className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-between rounded-sm px-2 text-[11px] font-semibold text-white ${
                      task.isCritical ? "bg-[#b42318]" : "bg-[#3f7f59]"
                    }`}
                    style={{
                      left: `${(task.earlyStart / maxFinish) * 100}%`,
                      width: `${Math.max(4, ((task.earlyFinish - task.earlyStart) / maxFinish) * 100)}%`,
                    }}
                    title={`${task.name}: day ${task.earlyStart}-${task.earlyFinish}`}
                  >
                    <span className="truncate">{task.id}</span>
                    <span>{task.totalFloat}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded border border-[#d8cdb8] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Network diagram</h2>
              <p className="text-xs text-[#746b5c]">Red nodes are critical path tasks</p>
            </div>
            <NetworkDiagram tasks={result.tasks} />
          </div>

          <aside className="rounded border border-[#d8cdb8] bg-white p-4">
            <h2 className="text-lg font-semibold">Engine output</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-[#746b5c]">Critical path</dt>
                <dd className="mt-1 font-mono text-xs">{result.criticalPath.join(" -> ")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[#746b5c]">
                  Driving relationships
                </dt>
                <dd className="mt-1 space-y-1">
                  {result.dependencies
                    .filter((dependency) => dependency.isDriving)
                    .map((dependency) => (
                      <div key={dependency.id} className="font-mono text-xs">
                        {dependency.from} {dependency.type}
                        {dependency.lag ? `+${dependency.lag}` : ""} {dependency.to}
                      </div>
                    ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[#746b5c]">Diagnostics</dt>
                <dd className="mt-1 text-xs">
                  {result.diagnostics.length > 0
                    ? result.diagnostics.join("; ")
                    : "No engine warnings."}
                </dd>
              </div>
            </dl>
          </aside>
        </section>
      </div>
    </div>
  );
}

function NetworkDiagram({ tasks }: { tasks: ScheduledTask[] }) {
  const nodes = tasks.map((task, index) => ({
    task,
    x: 72 + (index % 5) * 170,
    y: 56 + Math.floor(index / 5) * 120,
  }));
  const nodeMap = new Map(nodes.map((node) => [node.task.id, node]));
  const dependencies = SAMPLE_SCHEDULE.dependencies
    .map((dependency) => ({
      dependency,
      from: nodeMap.get(dependency.from),
      to: nodeMap.get(dependency.to),
    }))
    .filter((edge) => edge.from && edge.to);

  return (
    <svg viewBox="0 0 880 260" className="h-[260px] w-full rounded bg-[#fbfaf7]">
      <defs>
        <marker id="arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
          <path d="M0,0 L8,4 L0,8 Z" fill="#766d5c" />
        </marker>
      </defs>
      {dependencies.map(({ dependency, from, to }) => (
        <line
          key={`${dependency.from}-${dependency.to}`}
          x1={from!.x + 56}
          y1={from!.y}
          x2={to!.x - 56}
          y2={to!.y}
          stroke="#766d5c"
          strokeWidth="1.5"
          markerEnd="url(#arrow)"
        />
      ))}
      {nodes.map(({ task, x, y }) => (
        <g key={task.id} transform={`translate(${x - 56} ${y - 26})`}>
          <rect
            width="112"
            height="52"
            rx="4"
            fill={task.isCritical ? "#b42318" : "#f4efe5"}
            stroke={task.isCritical ? "#b42318" : "#cfc2aa"}
          />
          <text
            x="56"
            y="20"
            textAnchor="middle"
            fill={task.isCritical ? "#fff" : "#1f241f"}
            fontSize="12"
            fontWeight="700"
          >
            {task.id}
          </text>
          <text
            x="56"
            y="37"
            textAnchor="middle"
            fill={task.isCritical ? "#fff" : "#5e5548"}
            fontSize="10"
          >
            TF {task.totalFloat} / {task.duration}d
          </text>
        </g>
      ))}
    </svg>
  );
}
