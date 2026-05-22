import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listSchedules,
  loadSchedule,
  saveSchedule,
  deleteSchedule,
  loadBaseline,
} from "@/lib/scheduler/persistence.functions";
import { calculateSchedule } from "@/lib/scheduler/engine";
import { rescheduleFromDataDate, addWorkingDaysIso } from "@/lib/scheduler/progress";
import type { Annotation, Dependency, DependencyType, Schedule, Task } from "@/lib/scheduler/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { GanttTimeline } from "@/components/scheduler/GanttTimeline";
import { OpenEndsReport } from "@/components/scheduler/OpenEndsReport";
import { Stat } from "@/components/scheduler/Stat";
import { BaselinesPanel } from "@/components/scheduler/BaselinesPanel";
import { CalendarPanel } from "@/components/scheduler/CalendarPanel";
import { ReportsPanel } from "@/components/scheduler/ReportsPanel";
import { ResourcesPanel } from "@/components/scheduler/ResourcesPanel";
import { XerImportButton } from "@/components/scheduler/XerImportButton";
import { FragnetPanel } from "@/components/scheduler/FragnetPanel";
import { AnnotationsPanel } from "@/components/scheduler/AnnotationsPanel";
import { UpdateCyclePanel } from "@/components/scheduler/UpdateCyclePanel";
import { Textarea } from "@/components/ui/textarea";

const UNASSIGNED_WBS = "Unassigned";
const ZOOM_LEVELS: { label: string; dayPx: number }[] = [
  { label: "Month", dayPx: 6 },
  { label: "Week", dayPx: 12 },
  { label: "Day", dayPx: 22 },
  { label: "Wide", dayPx: 36 },
];

export const Route = createFileRoute("/scheduler")({
  head: () => ({ meta: [{ title: "Scheduler - AOS" }] }),
  component: SchedulerPage,
});

const SAMPLE: Omit<Schedule, "id" | "name"> = {
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

type Draft = {
  name: string;
  projectStartDate?: string;
  dataDate?: string;
  workDays: number;
  holidays: string[];
  tasks: Task[];
  dependencies: Dependency[];
  annotations: Annotation[];
};

function nextTaskId(tasks: Task[]): string {
  const nums = tasks
    .map((t) => /^A(\d+)$/.exec(t.id)?.[1])
    .filter(Boolean)
    .map((n) => parseInt(n!, 10));
  const next = nums.length ? Math.max(...nums) + 10 : 100;
  return `A${next}`;
}

function SchedulerPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSchedules);
  const loadFn = useServerFn(loadSchedule);
  const saveFn = useServerFn(saveSchedule);
  const deleteFn = useServerFn(deleteSchedule);
  const loadBaselineFn = useServerFn(loadBaseline);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dayPx, setDayPx] = useState(22);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [comparisonBaselineId, setComparisonBaselineId] = useState<string | null>(null);

  // Reset comparison when changing schedules
  useEffect(() => {
    setComparisonBaselineId(null);
  }, [selectedId]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const listQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () => listFn(),
  });

  const loadQuery = useQuery({
    queryKey: ["schedule", selectedId],
    queryFn: () => loadFn({ data: { id: selectedId! } }),
    enabled: !!selectedId,
  });

  // Hydrate draft when a schedule loads
  useEffect(() => {
    if (loadQuery.data) {
      const s = loadQuery.data.schedule;
      setDraft({
        name: s.name,
        projectStartDate: s.projectStartDate,
        dataDate: s.dataDate,
        workDays: s.calendar?.workDays ?? 31,
        holidays: s.calendar?.holidays ?? [],
        tasks: s.tasks.map((t) => ({ ...t })),
        dependencies: s.dependencies.map((d) => ({ ...d })),
        annotations: (s.annotations ?? []).map((a) => ({ ...a })),
      });
      setDirty(false);
    } else {
      setDraft(null);
    }
  }, [loadQuery.data]);

  const createMut = useMutation({
    mutationFn: (input: {
      name: string;
      projectStartDate?: string;
      sample?: boolean;
      tasks?: Task[];
      dependencies?: Dependency[];
    }) =>
      saveFn({
        data: {
          name: input.name,
          projectStartDate: input.projectStartDate || undefined,
          tasks: input.tasks ?? (input.sample ? SAMPLE.tasks : []),
          dependencies:
            input.dependencies ?? (input.sample ? SAMPLE.dependencies : []),
        },
      }),
    onSuccess: (res) => {
      toast.success("Schedule created");
      setNewName("");
      setNewStart("");
      setSelectedId(res.id);
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: selectedId!,
          name: draft!.name,
          projectStartDate: draft!.projectStartDate || undefined,
          dataDate: draft!.dataDate || undefined,
          workDays: draft!.workDays,
          holidays: draft!.holidays,
          annotations: draft!.annotations,
          tasks: draft!.tasks,
          dependencies: draft!.dependencies,
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["schedule", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const result = useMemo(() => {
    if (!draft) return null;
    try {
      return calculateSchedule({
        id: selectedId ?? undefined,
        name: draft.name,
        projectStartDate: draft.projectStartDate,
        calendar: { workDays: draft.workDays, holidays: draft.holidays },
        tasks: draft.tasks,
        dependencies: draft.dependencies,
      });
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [draft, selectedId]);

  const computed = result && "tasks" in result ? result : null;
  const computeError = result && "error" in result ? result.error : null;

  const baselineQuery = useQuery({
    queryKey: ["baseline", comparisonBaselineId],
    queryFn: () => loadBaselineFn({ data: { id: comparisonBaselineId! } }),
    enabled: !!comparisonBaselineId,
  });

  const baselineResult = useMemo(() => {
    if (!baselineQuery.data) return null;
    try {
      return calculateSchedule(baselineQuery.data.schedule);
    } catch {
      return null;
    }
  }, [baselineQuery.data]);

  const updateTask = (idx: number, patch: Partial<Task>) => {
    setDraft((d) => {
      if (!d) return d;
      const tasks = d.tasks.slice();
      tasks[idx] = { ...tasks[idx], ...patch };
      return { ...d, tasks };
    });
    setDirty(true);
  };

  const rescheduleTask = (
    taskId: string,
    patch: { startShiftDays?: number; duration?: number },
  ) => {
    setDraft((d) => {
      if (!d) return d;
      const idx = d.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return d;
      const t = d.tasks[idx];
      const next: Task = { ...t };
      if (patch.duration !== undefined) {
        next.duration = Math.max(0, Math.floor(patch.duration));
      }
      if (patch.startShiftDays && patch.startShiftDays !== 0) {
        const cal = { workDays: d.workDays, holidays: d.holidays };
        const computedTask = computed?.tasks.find((x) => x.id === taskId);
        // Anchor: existing startNoEarlierThan if set, otherwise current earlyStartDate from CPM.
        const anchorIso =
          t.startNoEarlierThan ??
          computedTask?.earlyStartDate ??
          d.projectStartDate;
        if (anchorIso) {
          const shifted = addWorkingDaysIso(anchorIso, patch.startShiftDays, cal);
          // Clamp to project start (don't allow before)
          if (d.projectStartDate && shifted < d.projectStartDate) {
            next.startNoEarlierThan = d.projectStartDate;
          } else {
            next.startNoEarlierThan = shifted;
          }
        }
      }
      const tasks = d.tasks.slice();
      tasks[idx] = next;
      return { ...d, tasks };
    });
    setDirty(true);
  };

  const renameTaskId = (idx: number, newId: string) => {
    setDraft((d) => {
      if (!d) return d;
      const oldId = d.tasks[idx].id;
      if (!newId || newId === oldId) return d;
      if (d.tasks.some((t, i) => i !== idx && t.id === newId)) {
        toast.error(`ID ${newId} already exists`);
        return d;
      }
      const tasks = d.tasks.slice();
      tasks[idx] = { ...tasks[idx], id: newId };
      const dependencies = d.dependencies.map((dep) => ({
        ...dep,
        from: dep.from === oldId ? newId : dep.from,
        to: dep.to === oldId ? newId : dep.to,
      }));
      return { ...d, tasks, dependencies };
    });
    setDirty(true);
  };

  const addTask = () => {
    setDraft((d) => {
      if (!d) return d;
      const id = nextTaskId(d.tasks);
      return {
        ...d,
        tasks: [...d.tasks, { id, name: "New task", duration: 1 }],
      };
    });
    setDirty(true);
  };

  const removeTask = (idx: number) => {
    setDraft((d) => {
      if (!d) return d;
      const removed = d.tasks[idx].id;
      return {
        ...d,
        tasks: d.tasks.filter((_, i) => i !== idx),
        dependencies: d.dependencies.filter((dep) => dep.from !== removed && dep.to !== removed),
      };
    });
    setDirty(true);
  };

  const updateDep = (idx: number, patch: Partial<Dependency>) => {
    setDraft((d) => {
      if (!d) return d;
      const dependencies = d.dependencies.slice();
      dependencies[idx] = { ...dependencies[idx], ...patch };
      return { ...d, dependencies };
    });
    setDirty(true);
  };

  const addDep = () => {
    setDraft((d) => {
      if (!d || d.tasks.length < 2) {
        toast.error("Need at least 2 tasks");
        return d;
      }
      return {
        ...d,
        dependencies: [
          ...d.dependencies,
          { from: d.tasks[0].id, to: d.tasks[1].id, type: "FS", lag: 0 },
        ],
      };
    });
    setDirty(true);
  };

  const removeDep = (idx: number) => {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, dependencies: d.dependencies.filter((_, i) => i !== idx) };
    });
    setDirty(true);
  };

  return (
    <div className="min-h-screen bg-[#f7f4ed] px-4 py-8 text-[#1f241f] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7a6a4d]">
            CPM Workbench · Primavera-style scheduling, AOS ease
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Schedules</h1>
            <a
              href="/scheduler-field"
              className="rounded border border-[#d8cdb8] bg-white px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[#1f241f] hover:bg-[#eee6d7]"
            >
              Field update (mobile) →
            </a>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-[#5c574e]">
            Activities, WBS, FS/SS/FF/SF logic with lag, forward/backward pass, total float, and a
            critical-path Gantt — built for contractors, not meeting calendars.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left */}
          <aside className="space-y-6">
            <section className="rounded border border-[#d8cdb8] bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                New schedule
              </h2>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Commercial fit-out"
                  />
                </div>
                <div>
                  <Label htmlFor="start">Project start (optional)</Label>
                  <Input
                    id="start"
                    type="date"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() =>
                      createMut.mutate({
                        name: newName || "Untitled schedule",
                        projectStartDate: newStart,
                      })
                    }
                    disabled={createMut.isPending}
                  >
                    Create empty
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      createMut.mutate({
                        name: newName || "Sample commercial fit-out",
                        projectStartDate: newStart || "2026-06-01",
                        sample: true,
                      })
                    }
                    disabled={createMut.isPending}
                  >
                    Create from sample
                  </Button>
                  <XerImportButton
                    disabled={createMut.isPending}
                    onImport={(input) =>
                      createMut.mutate({
                        name: newName || input.name,
                        projectStartDate: newStart || input.projectStartDate,
                        tasks: input.tasks,
                        dependencies: input.dependencies,
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="rounded border border-[#d8cdb8] bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                My schedules
              </h2>
              {listQuery.isLoading ? (
                <p className="text-sm text-[#746b5c]">Loading…</p>
              ) : listQuery.data?.schedules.length === 0 ? (
                <p className="text-sm text-[#746b5c]">No schedules yet.</p>
              ) : (
                <ul className="space-y-1">
                  {listQuery.data?.schedules.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          if (dirty && !confirm("Discard unsaved changes?")) return;
                          setSelectedId(s.id);
                        }}
                        className={`w-full rounded px-2 py-2 text-left text-sm transition ${
                          selectedId === s.id
                            ? "bg-[#1f241f] text-white"
                            : "hover:bg-[#eee6d7]"
                        }`}
                      >
                        <div className="font-medium">{s.name}</div>
                        <div
                          className={`text-xs ${
                            selectedId === s.id ? "text-white/70" : "text-[#776e5e]"
                          }`}
                        >
                          {s.projectStartDate ?? "no start date"} · updated{" "}
                          {new Date(s.updatedAt).toLocaleDateString()}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {selectedId && draft ? (
              <CalendarPanel
                workDays={draft.workDays}
                holidays={draft.holidays}
                onChange={({ workDays, holidays }) => {
                  setDraft({ ...draft, workDays, holidays });
                  setDirty(true);
                }}
              />
            ) : null}

            {selectedId ? (
              <BaselinesPanel
                scheduleId={selectedId}
                comparisonId={comparisonBaselineId}
                onComparisonChange={setComparisonBaselineId}
                dirty={dirty}
              />
            ) : null}

            {computed ? (
              <ReportsPanel
                result={computed}
                ganttContainerSelector="[data-gantt-container]"
              />
            ) : null}

            {selectedId && draft ? (
              <FragnetPanel
                tasks={draft.tasks}
                dependencies={draft.dependencies}
                onInsert={({ tasks, dependencies }) => {
                  setDraft({ ...draft, tasks, dependencies });
                  setDirty(true);
                }}
              />
            ) : null}

            {selectedId && draft ? (
              <AnnotationsPanel
                annotations={draft.annotations}
                tasks={draft.tasks}
                onChange={(annotations) => {
                  setDraft({ ...draft, annotations });
                  setDirty(true);
                }}
              />
            ) : null}

            {selectedId && draft ? (
              <UpdateCyclePanel
                scheduleId={selectedId}
                dirty={dirty}
                dataDate={draft.dataDate}
                computed={computed}
                onCycleClosed={(nextDate) => {
                  setDraft({ ...draft, dataDate: nextDate });
                  setDirty(true);
                  toast.info(`Data date advanced to ${nextDate}`);
                }}
              />
            ) : null}
          </aside>

          {/* Right */}
          <main className="space-y-4">
            {!selectedId ? (
              <div className="rounded border border-dashed border-[#d8cdb8] bg-white/60 p-10 text-center text-sm text-[#746b5c]">
                Select a schedule, or create one to start editing.
              </div>
            ) : loadQuery.isLoading || !draft ? (
              <p className="text-sm text-[#746b5c]">Loading schedule…</p>
            ) : (
              <>
                {/* Header */}
                <div className="flex flex-wrap items-end justify-between gap-3 rounded border border-[#d8cdb8] bg-white p-4">
                  <div className="flex-1 space-y-2">
                    <div>
                      <Label htmlFor="sched-name" className="text-xs">Name</Label>
                      <Input
                        id="sched-name"
                        value={draft.name}
                        onChange={(e) => {
                          setDraft({ ...draft, name: e.target.value });
                          setDirty(true);
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <div>
                        <Label htmlFor="sched-start" className="text-xs">Project start</Label>
                        <Input
                          id="sched-start"
                          type="date"
                          value={draft.projectStartDate ?? ""}
                          onChange={(e) => {
                            setDraft({ ...draft, projectStartDate: e.target.value || undefined });
                            setDirty(true);
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="sched-dd" className="text-xs">
                          Data date (as-of)
                        </Label>
                        <Input
                          id="sched-dd"
                          type="date"
                          value={draft.dataDate ?? ""}
                          onChange={(e) => {
                            setDraft({ ...draft, dataDate: e.target.value || undefined });
                            setDirty(true);
                          }}
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!draft.dataDate}
                          onClick={() => {
                            if (!draft.dataDate) return;
                            if (
                              !confirm(
                                "Reschedule from data date?\n\n• Completed activities → 0d milestones\n• In-progress → remaining duration, %comp reset\n• Project start moves to the data date\n\nCapture a baseline first if you want to compare.",
                              )
                            )
                              return;
                            const r = rescheduleFromDataDate(draft.tasks, draft.dataDate);
                            setDraft({
                              ...draft,
                              tasks: r.tasks,
                              projectStartDate: r.projectStartDate,
                            });
                            setDirty(true);
                            toast.success(
                              `Reset ${r.summary.inProgress} in-progress · ${r.summary.completed} done · ${r.summary.notStarted} not started`,
                            );
                          }}
                        >
                          Reschedule from data date
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {computed ? (
                      <div className="text-right text-sm">
                        <div className="font-medium">Duration</div>
                        <div className="text-2xl font-semibold">{computed.projectDuration}d</div>
                        {computed.projectFinishDate ? (
                          <div className="text-xs text-[#746b5c]">
                            Finish {computed.projectFinishDate}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <Button
                      onClick={() => saveMut.mutate()}
                      disabled={!dirty || saveMut.isPending}
                    >
                      {saveMut.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (confirm("Delete this schedule?")) deleteMut.mutate(selectedId);
                      }}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {computeError ? (
                  <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                    CPM error: {computeError}
                  </div>
                ) : null}

                {/* Tasks */}
                <section className="overflow-hidden rounded border border-[#d8cdb8] bg-white">
                  <div className="flex items-center justify-between border-b border-[#eee7d8] px-3 py-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                      Tasks
                    </h3>
                    <Button size="sm" variant="outline" onClick={addTask}>
                      <Plus className="mr-1 h-4 w-4" /> Add task
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[#eee6d7] text-xs uppercase tracking-wide text-[#675d4b]">
                        <tr>
                          <th className="px-2 py-2 text-left">ID</th>
                          <th className="px-2 py-2 text-left">Name</th>
                          <th className="px-2 py-2 text-left">WBS</th>
                          <th className="px-2 py-2 text-right">Dur</th>
                          <th className="px-2 py-2 text-right">% Comp</th>
                          <th className="px-2 py-2 text-right">ES</th>
                          <th className="px-2 py-2 text-right">EF</th>
                          <th className="px-2 py-2 text-right">TF</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Group draft.tasks by WBS, preserving original indices
                          const groupMap = new Map<string, { idx: number; t: Task }[]>();
                          draft.tasks.forEach((t, idx) => {
                            const key = t.wbs?.trim() || UNASSIGNED_WBS;
                            const arr = groupMap.get(key) ?? [];
                            arr.push({ idx, t });
                            groupMap.set(key, arr);
                          });
                          const groups = Array.from(groupMap.entries()).sort((a, b) =>
                            a[0].localeCompare(b[0]),
                          );
                          const rows: React.ReactNode[] = [];
                          for (const [key, items] of groups) {
                            const collapsed = collapsedGroups.has(key);
                            const groupTaskIds = new Set(items.map((i) => i.t.id));
                            const groupCalcs = computed?.tasks.filter((c) => groupTaskIds.has(c.id)) ?? [];
                            const groupDur = groupCalcs.length
                              ? Math.max(...groupCalcs.map((c) => c.earlyFinish)) -
                                Math.min(...groupCalcs.map((c) => c.earlyStart))
                              : 0;
                            const groupCritical = groupCalcs.some((c) => c.isCritical);
                            rows.push(
                              <tr key={`g-${key}`} className="border-t border-[#d8cdb8] bg-[#eee6d7]">
                                <td colSpan={9} className="px-2 py-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(key)}
                                    className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-[#1f241f]"
                                  >
                                    <span className="w-3">{collapsed ? "▸" : "▾"}</span>
                                    <span>{key}</span>
                                    <span className="text-[10px] font-normal text-[#7a6a4d]">
                                      {items.length} act · span {groupDur}d
                                      {groupCritical ? " · critical" : ""}
                                    </span>
                                  </button>
                                </td>
                              </tr>,
                            );
                            if (collapsed) continue;
                            for (const { idx, t } of items) {
                              const calc = computed?.tasks.find((x) => x.id === t.id);
                              const critical = calc?.isCritical;
                              rows.push(
                                <tr key={idx} className="border-t border-[#eee7d8]">
                                  <td className="px-2 py-1">
                                    <Input
                                      className={`h-8 w-20 ${critical ? "text-[#b42318] font-semibold" : ""}`}
                                      value={t.id}
                                      onChange={(e) => renameTaskId(idx, e.target.value.trim())}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <Input
                                      className="h-8"
                                      value={t.name}
                                      onChange={(e) => updateTask(idx, { name: e.target.value })}
                                    />
                                  </td>
                                  <td className="px-2 py-1">
                                    <Input
                                      className="h-8 w-32"
                                      value={t.wbs ?? ""}
                                      onChange={(e) => updateTask(idx, { wbs: e.target.value })}
                                    />
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <Input
                                      className="h-8 w-16 text-right"
                                      type="number"
                                      min={0}
                                      value={t.duration}
                                      onChange={(e) =>
                                        updateTask(idx, { duration: Number(e.target.value) || 0 })
                                      }
                                    />
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <Input
                                      className="h-8 w-16 text-right"
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={t.percentComplete ?? ""}
                                      onChange={(e) =>
                                        updateTask(idx, {
                                          percentComplete:
                                            e.target.value === "" ? undefined : Number(e.target.value),
                                        })
                                      }
                                    />
                                  </td>
                                  <td className={`px-2 py-1 text-right ${critical ? "text-[#b42318] font-semibold" : ""}`}>
                                    {calc?.earlyStart ?? "—"}
                                  </td>
                                  <td className={`px-2 py-1 text-right ${critical ? "text-[#b42318] font-semibold" : ""}`}>
                                    {calc?.earlyFinish ?? "—"}
                                  </td>
                                  <td className={`px-2 py-1 text-right ${critical ? "text-[#b42318] font-semibold" : ""}`}>
                                    {calc?.totalFloat ?? "—"}
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => removeTask(idx)}
                                      aria-label="Remove task"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                </tr>,
                              );
                            }
                          }
                          if (rows.length === 0) {
                            rows.push(
                              <tr key="empty">
                                <td colSpan={9} className="px-3 py-6 text-center text-[#746b5c]">
                                  No tasks. Click “Add task”.
                                </td>
                              </tr>,
                            );
                          }
                          return rows;
                        })()}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Gantt + Activity detail */}
                {computed ? (
                  <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                    <section className="overflow-hidden rounded border border-[#d8cdb8] bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eee7d8] px-3 py-2">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                          Gantt · Critical path
                        </h3>
                        <div className="flex items-center gap-3 text-xs text-[#776e5e]">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wide">Zoom</span>
                            {ZOOM_LEVELS.map((z) => (
                              <button
                                key={z.label}
                                type="button"
                                onClick={() => setDayPx(z.dayPx)}
                                className={`rounded px-1.5 py-0.5 text-[10px] ${
                                  dayPx === z.dayPx
                                    ? "bg-[#1f241f] text-white"
                                    : "border border-[#d8cdb8] text-[#5c574e] hover:bg-[#eee6d7]"
                                }`}
                              >
                                {z.label}
                              </button>
                            ))}
                          </div>
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2 w-3 rounded-sm bg-[#b42318]" /> Critical
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2 w-3 rounded-sm bg-[#1f241f]" /> Activity
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-[3px] w-4 bg-[#9c8b6e]" /> Float
                          </span>
                        </div>
                      </div>
                      <div className="p-2" data-gantt-container>
                        <GanttTimeline
                          result={computed}
                          selectedId={selectedTaskId}
                          onSelect={setSelectedTaskId}
                          dayPx={dayPx}
                          collapsedGroups={collapsedGroups}
                          onToggleGroup={toggleGroup}
                          baseline={baselineResult}
                          dataDate={draft.dataDate}
                          calendar={{ workDays: draft.workDays, holidays: draft.holidays }}
                          annotations={draft.annotations}
                          onTaskReschedule={rescheduleTask}
                        />
                      </div>
                    </section>

                    <section className="rounded border border-[#d8cdb8] bg-white p-4">
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                        Activity detail
                      </h3>
                      {(() => {
                        const t = selectedTaskId
                          ? computed.tasks.find((x) => x.id === selectedTaskId)
                          : null;
                        if (!t) {
                          return (
                            <p className="text-sm text-[#746b5c]">
                              Click a bar in the Gantt to inspect an activity.
                            </p>
                          );
                        }
                        const idx = draft.tasks.findIndex((x) => x.id === t.id);
                        const preds = computed.dependencies.filter((d) => d.to === t.id);
                        const succs = computed.dependencies.filter((d) => d.from === t.id);
                        return (
                          <div className="space-y-3 text-sm">
                            <div>
                              <div className="text-xs uppercase tracking-wide text-[#7a6a4d]">
                                {t.id} {t.isCritical ? "· CRITICAL" : ""}
                              </div>
                              <div className="font-medium">{t.name}</div>
                              {t.wbs ? (
                                <div className="text-xs text-[#776e5e]">WBS {t.wbs}</div>
                              ) : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <Stat label="Duration" value={`${t.duration}d`} />
                              <Stat label="Total float" value={`${t.totalFloat}d`} />
                              <Stat label="Free float" value={`${t.freeFloat}d`} />
                              <Stat label="Early start" value={`d${t.earlyStart}`} />
                              <Stat label="Early finish" value={`d${t.earlyFinish}`} />
                              <Stat label="Late start" value={`d${t.lateStart}`} />
                              <Stat label="Late finish" value={`d${t.lateFinish}`} />
                            </div>
                            {draft.tasks[idx]?.startNoEarlierThan ? (
                              <div className="flex items-center justify-between rounded border border-[#d8cdb8] bg-[#fbf8f0] px-2 py-1.5 text-xs">
                                <span>
                                  <span className="font-mono uppercase tracking-wide text-[#7a6a4d]">
                                    SNET
                                  </span>{" "}
                                  {draft.tasks[idx].startNoEarlierThan}
                                </span>
                                <button
                                  type="button"
                                  className="text-[#b42318] underline-offset-2 hover:underline"
                                  onClick={() =>
                                    updateTask(idx, { startNoEarlierThan: undefined })
                                  }
                                >
                                  Clear constraint
                                </button>
                              </div>
                            ) : null}
                            <div>
                              <Label className="text-xs">Description</Label>
                              <Textarea
                                className="min-h-[60px] text-sm"
                                value={draft.tasks[idx]?.description ?? ""}
                                onChange={(e) =>
                                  updateTask(idx, { description: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wide text-[#7a6a4d]">
                                Predecessors
                              </div>
                              {preds.length === 0 ? (
                                <div className="text-xs text-[#776e5e]">None</div>
                              ) : (
                                <ul className="text-xs">
                                  {preds.map((d) => (
                                    <li key={`${d.from}-${d.to}-${d.type}`} className="font-mono">
                                      {d.from} → {d.type}
                                      {d.lag ? ` ${d.lag > 0 ? "+" : ""}${d.lag}d` : ""}
                                      {d.isDriving ? " ·★" : ""}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wide text-[#7a6a4d]">
                                Successors
                              </div>
                              {succs.length === 0 ? (
                                <div className="text-xs text-[#776e5e]">None</div>
                              ) : (
                                <ul className="text-xs">
                                  {succs.map((d) => (
                                    <li key={`${d.from}-${d.to}-${d.type}`} className="font-mono">
                                      {d.type}
                                      {d.lag ? ` ${d.lag > 0 ? "+" : ""}${d.lag}d` : ""} → {d.to}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </section>
                  </div>
                ) : null}

                {/* Dependencies */}
                <section className="overflow-hidden rounded border border-[#d8cdb8] bg-white">

                  <div className="flex items-center justify-between border-b border-[#eee7d8] px-3 py-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                      Dependencies
                    </h3>
                    <Button size="sm" variant="outline" onClick={addDep}>
                      <Plus className="mr-1 h-4 w-4" /> Add dependency
                    </Button>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-[#eee6d7] text-xs uppercase tracking-wide text-[#675d4b]">
                      <tr>
                        <th className="px-2 py-2 text-left">From</th>
                        <th className="px-2 py-2 text-left">To</th>
                        <th className="px-2 py-2 text-left">Type</th>
                        <th className="px-2 py-2 text-right">Lag</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.dependencies.map((d, idx) => (
                        <tr key={idx} className="border-t border-[#eee7d8]">
                          <td className="px-2 py-1">
                            <Select
                              value={d.from}
                              onValueChange={(v) => updateDep(idx, { from: v })}
                            >
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {draft.tasks.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={d.to}
                              onValueChange={(v) => updateDep(idx, { to: v })}
                            >
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {draft.tasks.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={d.type ?? "FS"}
                              onValueChange={(v) =>
                                updateDep(idx, { type: v as DependencyType })
                              }
                            >
                              <SelectTrigger className="h-8 w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="FS">FS</SelectItem>
                                <SelectItem value="SS">SS</SelectItem>
                                <SelectItem value="FF">FF</SelectItem>
                                <SelectItem value="SF">SF</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1 text-right">
                            <Input
                              className="h-8 w-16 text-right"
                              type="number"
                              value={d.lag ?? 0}
                              onChange={(e) =>
                                updateDep(idx, { lag: Number(e.target.value) || 0 })
                              }
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeDep(idx)}
                              aria-label="Remove dependency"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {draft.dependencies.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-[#746b5c]">
                            No dependencies yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </section>

                {/* Summary */}
                {computed ? (
                  <section className="rounded border border-[#d8cdb8] bg-white p-4 text-sm">
                    <div className="text-xs uppercase tracking-wide text-[#746b5c]">
                      Critical path
                    </div>
                    <div className="mt-1 font-mono text-xs">
                      {computed.criticalPath.length > 0
                        ? computed.criticalPath.join(" → ")
                        : "—"}
                    </div>
                    {computed.diagnostics.length > 0 ? (
                      <div className="mt-3 text-xs text-[#b42318]">
                        {computed.diagnostics.join("; ")}
                      </div>
                    ) : null}
                    <div className="mt-4 border-t border-[#eee7d8] pt-3">
                      <div className="text-xs uppercase tracking-wide text-[#746b5c]">
                        Open ends
                      </div>
                      <div className="mt-1">
                        <OpenEndsReport result={computed} />
                      </div>
                    </div>
                  </section>
                ) : null}

                {computed ? (
                  <ResourcesPanel
                    result={computed}
                    tasks={draft.tasks}
                    onTaskChange={updateTask}
                  />
                ) : null}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

