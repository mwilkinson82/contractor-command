import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
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
import { CpmGrid } from "@/components/scheduler/CpmGrid";
import { OpenEndsReport } from "@/components/scheduler/OpenEndsReport";
import { Stat } from "@/components/scheduler/Stat";
import { BaselinesPanel } from "@/components/scheduler/BaselinesPanel";
import { CalendarPanel } from "@/components/scheduler/CalendarPanel";
import { CalendarsPanel } from "@/components/scheduler/CalendarsPanel";
import { ReportsPanel } from "@/components/scheduler/ReportsPanel";
import { ResourcesPanel } from "@/components/scheduler/ResourcesPanel";
import { ScheduleKpiBar } from "@/components/scheduler/ScheduleKpiBar";
import { DashboardsPanel } from "@/components/scheduler/DashboardsPanel";
import { DcmaPanel } from "@/components/scheduler/DcmaPanel";
import { StructurePanel } from "@/components/scheduler/StructurePanel";
import { WbsSelect } from "@/components/scheduler/WbsSelect";
import { ActivityCodeChips } from "@/components/scheduler/ActivityCodeChips";
import { listCalendars } from "@/lib/scheduler/calendars.functions";

import { FragnetPanel } from "@/components/scheduler/FragnetPanel";
import { AnnotationsPanel } from "@/components/scheduler/AnnotationsPanel";
import { UpdateCyclePanel } from "@/components/scheduler/UpdateCyclePanel";
import { InlineText, InlineNumber } from "@/components/scheduler/InlineEdit";
import { Textarea } from "@/components/ui/textarea";

const UNASSIGNED_WBS = "Unassigned";
const ZOOM_LEVELS: { label: string; dayPx: number }[] = [
  { label: "Month", dayPx: 6 },
  { label: "Week", dayPx: 12 },
  { label: "Day", dayPx: 22 },
  { label: "Wide", dayPx: 36 },
];

export const Route = createFileRoute("/scheduler/$projectId")({
  head: () => ({ meta: [{ title: "Scheduler - AOS" }] }),
  component: SchedulerPage,
});

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
  const navigate = useNavigate();
  const { projectId } = Route.useParams();
  const loadFn = useServerFn(loadSchedule);
  const saveFn = useServerFn(saveSchedule);
  const deleteFn = useServerFn(deleteSchedule);
  const loadBaselineFn = useServerFn(loadBaseline);

  const selectedId = projectId;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dayPx, setDayPx] = useState(22);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<"wbs" | "critical" | "none">("wbs");
  const [calendarFilter, setCalendarFilter] = useState<string>("");


  const [comparisonBaselineId, setComparisonBaselineId] = useState<string | null>(null);

  // Reset comparison when changing schedules
  useEffect(() => {
    setComparisonBaselineId(null);
    setDraft(null);
    setDirty(false);
  }, [selectedId]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadQuery = useQuery({
    queryKey: ["schedule", selectedId],
    queryFn: () => loadFn({ data: { id: selectedId } }),
    enabled: !!selectedId,
  });

  const listCalendarsFn = useServerFn(listCalendars);
  const calendarsQuery = useQuery({
    queryKey: ["calendars", selectedId],
    queryFn: () => listCalendarsFn({ data: { scheduleId: selectedId } }),
    enabled: !!selectedId,
  });
  const calendars = calendarsQuery.data?.calendars ?? [];

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

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: selectedId,
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
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["schedule", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      navigate({ to: "/scheduler" });
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
        calendars: calendars.map((c) => ({
          id: c.id,
          name: c.name,
          isDefault: c.isDefault,
          workDays: c.workDays,
          holidays: c.holidays,
        })),
        tasks: draft.tasks,
        dependencies: draft.dependencies,
      });
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [draft, selectedId, calendars]);

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
          t.startNoEarlierThan ?? computedTask?.earlyStartDate ?? d.projectStartDate;
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

  // ---------- top-level UI state ----------
  const [activeTab, setActiveTab] = useState<
    "schedule" | "activities" | "wbs" | "resources" | "reports" | "dashboards"
  >("schedule");
  const [inspectorTab, setInspectorTab] = useState<
    "details" | "relationships" | "resources" | "codes" | "notebook" | "calendar"
  >("details");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);

  // Derived stats for status bar
  const totalActivities = draft?.tasks.length ?? 0;
  const criticalCount = computed?.tasks.filter((t) => t.isCritical).length ?? 0;
  const completedCount =
    draft?.tasks.filter((t) => (t.percentComplete ?? 0) >= 100).length ?? 0;
  const inProgressCount =
    draft?.tasks.filter((t) => {
      const p = t.percentComplete ?? 0;
      return p > 0 && p < 100;
    }).length ?? 0;
  const dataQuality =
    !draft
      ? "—"
      : computeError
        ? "Errors"
        : computed && computed.diagnostics.length > 0
          ? "Warnings"
          : "Good";

  // Filter tasks by search
  const matchesSearch = (t: Task) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.id.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      (t.wbs ?? "").toLowerCase().includes(q)
    );
  };

  const selectedTaskCalc =
    selectedTaskId && computed
      ? computed.tasks.find((x) => x.id === selectedTaskId) ?? null
      : null;
  const selectedTaskIdx =
    selectedTaskId && draft
      ? draft.tasks.findIndex((x) => x.id === selectedTaskId)
      : -1;

  // ---------- render ----------
  return (
    <div className="flex h-screen flex-col bg-[#faf8f3] text-[#1f241f]">
      {/* ============ TOP HEADER ============ */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#e6dfd0] bg-white/80 px-4 backdrop-blur">
        <Link
          to="/scheduler"
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#5c574e] hover:text-[#1f241f]"
        >
          <span className="grid h-7 w-7 place-items-center rounded bg-[#1f241f] text-[10px] font-bold text-[#f7e9b8]">
            AOS
          </span>
          <span className="hidden sm:inline">CPM Schedule</span>
        </Link>

        <div className="h-6 w-px bg-[#e6dfd0]" />

        <div className="flex flex-1 items-center gap-2 min-w-0">
          {draft ? (
            <input
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setDirty(true);
              }}
              className="min-w-0 flex-1 truncate bg-transparent text-base font-semibold tracking-tight outline-none placeholder:text-[#a39884] focus:bg-[#f7f4ed] focus:rounded focus:px-2"
              placeholder="Untitled schedule"
            />
          ) : (
            <span className="text-base font-semibold text-[#a39884]">Loading…</span>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities…"
              className="h-8 w-64 rounded-md border border-[#e6dfd0] bg-[#faf8f3] pl-8 pr-3 text-xs outline-none focus:border-[#9c8b6e] focus:bg-white"
            />
            <svg
              className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9c8b6e]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {comparisonBaselineId ? (
            <span className="hidden lg:inline-flex items-center gap-1 rounded-md bg-[#eee6d7] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5c574e]">
              Baseline on
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md border border-[#e6dfd0] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3d3527] hover:bg-[#faf8f3]"
            title="Calendars, baselines, codes, reports, fragnet, update cycle, annotations"
          >
            ⚙ Configure
          </button>
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={!dirty || saveMut.isPending}
            className="bg-[#1f241f] text-white hover:bg-[#3d3527] disabled:opacity-50"
          >
            {saveMut.isPending ? "Saving…" : dirty ? "Update Schedule" : "Saved"}
          </Button>
        </div>
      </header>

      {/* ============ TAB BAR ============ */}
      <nav className="flex h-10 shrink-0 items-end gap-0 border-b border-[#e6dfd0] bg-white/60 px-4">
        {(
          [
            ["schedule", "Schedule"],
            ["activities", "Activities"],
            ["wbs", "WBS"],
            ["resources", "Resources"],
            ["reports", "Reports"],
            ["dashboards", "Dashboards"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`relative px-4 py-2 text-sm font-medium transition ${
              activeTab === key
                ? "text-[#1f241f]"
                : "text-[#7a6a4d] hover:text-[#3d3527]"
            }`}
          >
            {label}
            {activeTab === key ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[#1f241f]" />
            ) : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pb-2">
          <Link
            to="/scheduler-portfolio"
            className="text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d] hover:text-[#1f241f]"
          >
            Portfolio →
          </Link>
          <Link
            to="/scheduler-field"
            className="text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d] hover:text-[#1f241f]"
          >
            Field →
          </Link>
        </div>
      </nav>

      {/* ============ NOT-LOADED STATES ============ */}
      {!selectedId ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-md border border-dashed border-[#d8cdb8] bg-white/60 p-10 text-center text-sm text-[#746b5c]">
            Select a schedule, or create one to start editing.
          </div>
        </div>
      ) : loadQuery.isLoading || !draft ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#746b5c]">
          Loading schedule…
        </div>
      ) : (
        <>
          {/* ============ TOOLBAR ============ */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e6dfd0] bg-white px-4 py-2">
            {/* View modes (only Gantt is wired) */}
            <div className="flex items-center rounded-md border border-[#e6dfd0] bg-[#faf8f3] p-0.5">
              <button className="rounded bg-white px-3 py-1 text-xs font-medium shadow-sm">
                Gantt
              </button>
              <button className="px-3 py-1 text-xs text-[#7a6a4d] hover:text-[#3d3527]">
                Board
              </button>
              <button className="px-3 py-1 text-xs text-[#7a6a4d] hover:text-[#3d3527]">
                List
              </button>
            </div>

            <div className="mx-1 h-5 w-px bg-[#e6dfd0]" />

            {calendars.length > 0 ? (
              <select
                value={calendarFilter}
                onChange={(e) => setCalendarFilter(e.target.value)}
                className="h-7 rounded-md border border-[#e6dfd0] bg-white px-2 text-xs text-[#3d3527] hover:bg-[#faf8f3]"
                title="Filter by activity calendar"
              >
                <option value="">⛬ Calendar (All)</option>
                <option value="__default">Project default only</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="flex items-center rounded-md border border-[#e6dfd0] bg-white">
              {(["wbs", "critical", "none"] as const).map((g, i) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={`px-2.5 py-1 text-xs ${
                    i > 0 ? "border-l border-[#e6dfd0]" : ""
                  } ${
                    groupBy === g
                      ? "bg-[#1f241f] text-white"
                      : "text-[#5c574e] hover:bg-[#faf8f3]"
                  }`}
                >
                  {g === "wbs" ? "Group: WBS" : g === "critical" ? "Critical" : "Flat"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className={`rounded-md border border-[#e6dfd0] px-2.5 py-1 text-xs ${
                showCompleted ? "bg-white text-[#5c574e]" : "bg-[#1f241f] text-white"
              } hover:bg-[#faf8f3]`}
              title="Hide 100% complete activities"
            >
              {showCompleted ? "All activities" : "Remaining only"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!computed || computed.tasks.length === 0) return;
                const finish = computed.tasks.reduce((a, b) =>
                  b.earlyFinish > a.earlyFinish ? b : a,
                );
                setSelectedTaskId(finish.id);
              }}
              className="rounded-md border border-[#b89dd9] bg-[#f6f0ff] px-2.5 py-1 text-xs font-medium text-[#5c3d8a] hover:bg-[#ede0ff]"
              title="Highlight the longest driving chain into project finish"
            >
              ★ Driving path
            </button>

            <div className="ml-auto flex items-center gap-2">
              {/* Baseline picker */}
              <BaselinesPanel
                scheduleId={selectedId}
                comparisonId={comparisonBaselineId}
                onComparisonChange={setComparisonBaselineId}
                dirty={dirty}
                
              />

              <div className="mx-1 h-5 w-px bg-[#e6dfd0]" />

              {/* Zoom */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">
                  Zoom
                </span>
                {ZOOM_LEVELS.map((z) => (
                  <button
                    key={z.label}
                    type="button"
                    onClick={() => setDayPx(z.dayPx)}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      dayPx === z.dayPx
                        ? "bg-[#1f241f] text-white"
                        : "border border-[#e6dfd0] text-[#5c574e] hover:bg-[#faf8f3]"
                    }`}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ============ MAIN CONTENT ============ */}
          <div className="flex flex-1 min-h-0 flex-col">
            {/* Schedule tab: split table + Gantt */}
            {activeTab === "schedule" ? (
              <>
                {computeError ? (
                  <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    CPM error: {computeError}
                  </div>
                ) : null}

                {/* Project meta strip */}
                <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-[#eee7d8] bg-white/60 px-4 py-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    <span className="uppercase tracking-wide text-[#7a6a4d]">Start</span>
                    <input
                      type="date"
                      className="h-7 rounded border border-[#e6dfd0] bg-white px-1.5 text-xs"
                      value={draft.projectStartDate ?? ""}
                      onChange={(e) => {
                        setDraft({ ...draft, projectStartDate: e.target.value || undefined });
                        setDirty(true);
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="uppercase tracking-wide text-[#7a6a4d]">Data date</span>
                    <input
                      type="date"
                      className="h-7 rounded border border-[#e6dfd0] bg-white px-1.5 text-xs"
                      value={draft.dataDate ?? ""}
                      onChange={(e) => {
                        setDraft({ ...draft, dataDate: e.target.value || undefined });
                        setDirty(true);
                      }}
                    />
                  </label>
                  {computed?.projectFinishDate ? (
                    <span className="text-[#5c574e]">
                      <span className="uppercase tracking-wide text-[#7a6a4d]">Finish</span>{" "}
                      <span className="font-medium">{computed.projectFinishDate}</span>
                    </span>
                  ) : null}
                  {computed ? (
                    <span className="text-[#5c574e]">
                      <span className="uppercase tracking-wide text-[#7a6a4d]">Duration</span>{" "}
                      <span className="font-medium">{computed.projectDuration}d</span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={!draft.dataDate}
                    onClick={() => {
                      if (!draft.dataDate) return;
                      if (
                        !confirm(
                          "Reschedule from data date?\n\n• Completed → 0d milestones\n• In-progress → remaining duration\n• Project start moves to data date\n\nCapture a baseline first if you want to compare.",
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
                    className="ml-auto rounded-md border border-[#e6dfd0] bg-white px-2 py-1 text-[11px] text-[#3d3527] hover:bg-[#faf8f3] disabled:opacity-40"
                  >
                    Reschedule from data date
                  </button>
                </div>

                {/* KPI strip */}
                {computed ? (
                  <ScheduleKpiBar
                    result={computed}
                    tasks={draft.tasks}
                    dataDate={draft.dataDate}
                  />
                ) : null}

                {/* Split: activity table + Gantt */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  {/* LEFT: activity table */}
                  <div className="flex w-[520px] shrink-0 flex-col overflow-hidden border-r border-[#e6dfd0] bg-white">
                    <div className="flex shrink-0 items-center justify-between border-b border-[#eee7d8] bg-[#faf8f3] px-3 py-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d]">
                        Activities · {totalActivities}
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={addTask}>
                        <Plus className="mr-1 h-3 w-3" /> Add
                      </Button>
                    </div>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-[#faf8f3] text-[10px] uppercase tracking-wide text-[#7a6a4d] shadow-sm">
                          <tr>
                            <th className="px-2 py-2 text-left font-semibold">Activity ID</th>
                            <th className="px-2 py-2 text-left font-semibold">Activity Name</th>
                            <th className="px-2 py-2 text-right font-semibold">Dur</th>
                            <th className="px-2 py-2 text-right font-semibold">Start</th>
                            <th className="px-2 py-2 text-right font-semibold">Finish</th>
                            <th className="px-2 py-2 text-right font-semibold">%</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const groupMap = new Map<string, { idx: number; t: Task }[]>();
                            const matchesCal = (t: Task) => {
                              if (!calendarFilter) return true;
                              if (calendarFilter === "__default") return !t.calendarId;
                              return t.calendarId === calendarFilter;
                            };
                            const visible = (t: Task) => {
                              if (!matchesSearch(t) || !matchesCal(t)) return false;
                              if (!showCompleted && (t.percentComplete ?? 0) >= 100) return false;
                              return true;
                            };
                            draft.tasks.forEach((t, idx) => {
                              if (!visible(t)) return;
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
                              const groupCalcs =
                                computed?.tasks.filter((c) => groupTaskIds.has(c.id)) ?? [];
                              const groupStart = groupCalcs.length
                                ? groupCalcs
                                    .map((c) => c.earlyStartDate)
                                    .filter(Boolean)
                                    .sort()[0]
                                : undefined;
                              const groupFinish = groupCalcs.length
                                ? groupCalcs
                                    .map((c) => c.earlyFinishDate)
                                    .filter(Boolean)
                                    .sort()
                                    .slice(-1)[0]
                                : undefined;
                              const groupCritical = groupCalcs.some((c) => c.isCritical);
                              const groupPct =
                                items.length === 0
                                  ? 0
                                  : Math.round(
                                      items.reduce(
                                        (s, i) => s + (i.t.percentComplete ?? 0),
                                        0,
                                      ) / items.length,
                                    );
                              rows.push(
                                <tr
                                  key={`g-${key}`}
                                  className="border-t border-[#eee7d8] bg-[#faf8f3]"
                                >
                                  <td colSpan={7} className="px-2 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() => toggleGroup(key)}
                                      className="flex w-full items-center gap-2 text-left"
                                    >
                                      <span className="w-3 text-[10px] text-[#7a6a4d]">
                                        {collapsed ? "▸" : "▾"}
                                      </span>
                                      <span
                                        className={`inline-block h-2.5 w-2.5 rounded-sm ${
                                          groupCritical ? "bg-[#b42318]" : "bg-[#5b8bd6]"
                                        }`}
                                      />
                                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#1f241f]">
                                        {key}
                                      </span>
                                      <span className="text-[10px] text-[#7a6a4d]">
                                        {items.length} act
                                      </span>
                                      <span className="ml-auto flex items-center gap-3 text-[10px] text-[#5c574e]">
                                        {groupStart ? <span>{formatShort(groupStart)}</span> : null}
                                        {groupFinish ? <span>→ {formatShort(groupFinish)}</span> : null}
                                        <span className="font-semibold">{groupPct}%</span>
                                      </span>
                                    </button>
                                  </td>
                                </tr>,
                              );
                              if (collapsed) continue;
                              for (const { idx, t } of items) {
                                const calc = computed?.tasks.find((x) => x.id === t.id);
                                const critical = calc?.isCritical;
                                const pct = t.percentComplete ?? 0;
                                const statusColor =
                                  pct >= 100
                                    ? "bg-[#3d8a5c]"
                                    : critical
                                      ? "bg-[#b42318]"
                                      : pct > 0
                                        ? "bg-[#5b8bd6]"
                                        : "bg-[#c7b89d]";
                                const isSel = selectedTaskId === t.id;
                                return rows.push(
                                  <tr
                                    key={idx}
                                    onClick={() => setSelectedTaskId(t.id)}
                                    className={`cursor-pointer border-t border-[#f3eede] transition ${
                                      isSel
                                        ? "bg-[#fef6e0]"
                                        : "hover:bg-[#faf8f3]"
                                    }`}
                                  >
                                    <td className="px-2 py-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className={`inline-block h-2 w-2 rounded-sm ${statusColor}`} />
                                        <span
                                          className={`font-mono text-[11px] ${critical ? "font-semibold text-[#b42318]" : "text-[#5c574e]"}`}
                                        >
                                          {t.id}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <InlineText
                                        value={t.name}
                                        onCommit={(next) =>
                                          updateTask(idx, { name: next })
                                        }
                                        className="text-[12px] text-[#1f241f]"
                                        placeholder="Untitled activity"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-[11px] text-[#3d3527]">
                                      <InlineNumber
                                        value={t.duration}
                                        min={0}
                                        step={1}
                                        suffix="d"
                                        onCommit={(next) =>
                                          updateTask(idx, { duration: next })
                                        }
                                      />
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-[11px] text-[#5c574e]">
                                      {formatShort(calc?.earlyStartDate)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-[11px] text-[#5c574e]">
                                      {formatShort(calc?.earlyFinishDate)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-[11px] font-medium text-[#3d3527]">
                                      <InlineNumber
                                        value={pct}
                                        min={0}
                                        max={100}
                                        suffix="%"
                                        onCommit={(next) =>
                                          updateTask(idx, { percentComplete: next })
                                        }
                                      />
                                    </td>
                                    <td className="px-1 py-1.5 text-right">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeTask(idx);
                                        }}
                                        className="opacity-0 transition hover:text-[#b42318] group-hover:opacity-100"
                                        aria-label="Remove"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </td>
                                  </tr>,
                                );
                              }
                            }
                            if (rows.length === 0) {
                              rows.push(
                                <tr key="empty">
                                  <td colSpan={6} className="px-3 py-10 text-center text-[#9c8b6e]">
                                    No activities match. Click "Add" to create one.
                                  </td>
                                </tr>,
                              );
                            }
                            return rows;
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* RIGHT: Gantt */}
                  <div className="flex flex-1 min-w-0 flex-col bg-white">
                    <div className="flex-1 overflow-auto" data-gantt-container>
                      {computed ? (
                        <CpmGrid
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
                          groupBy={groupBy}
                          onTaskReschedule={rescheduleTask}
                        />
                      ) : null}
                    </div>
                    {/* Legend */}
                    <div className="flex shrink-0 items-center justify-center gap-5 border-t border-[#eee7d8] bg-[#faf8f3] px-4 py-1.5 text-[10px] text-[#5c574e]">
                      <LegendDot color="#3d8a5c" label="Completed" />
                      <LegendDot color="#5b8bd6" label="In Progress" />
                      <LegendDot color="#9b87d3" label="Planned" />
                      <LegendDot color="#cfd9e8" label="Lookahead" />
                      <LegendDot color="#b42318" label="Critical" />
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rotate-45 bg-[#1f241f]" /> Milestone
                      </span>
                    </div>
                  </div>
                </div>

                {/* ============ ACTIVITY INSPECTOR ============ */}
                <div className="shrink-0 border-t border-[#e6dfd0] bg-white">
                  <div className="flex items-end gap-0 border-b border-[#eee7d8] px-4">
                    {(
                      [
                        ["details", "Activity Details"],
                        ["relationships", "Relationships"],
                        ["resources", "Resources"],
                        ["codes", "Codes"],
                        ["calendar", "Calendar"],
                        ["notebook", "Notebook"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setInspectorTab(key)}
                        className={`relative px-3 py-2 text-xs font-medium ${
                          inspectorTab === key
                            ? "text-[#1f241f]"
                            : "text-[#7a6a4d] hover:text-[#3d3527]"
                        }`}
                      >
                        {label}
                        {inspectorTab === key ? (
                          <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[#b42318]" />
                        ) : null}
                      </button>
                    ))}
                    {selectedTaskCalc ? (
                      <span className="ml-auto pb-2 text-[10px] uppercase tracking-wide text-[#7a6a4d]">
                        {selectedTaskCalc.id} ·{" "}
                        {selectedTaskCalc.isCritical ? (
                          <span className="font-semibold text-[#b42318]">CRITICAL</span>
                        ) : (
                          "Normal"
                        )}
                      </span>
                    ) : null}
                  </div>

                  <div className="max-h-[280px] overflow-auto px-4 py-3 text-sm">
                    {!selectedTaskCalc || selectedTaskIdx < 0 ? (
                      <div className="py-6 text-center text-xs text-[#9c8b6e]">
                        Select an activity to inspect details, relationships, resources, codes,
                        calendar, or notes.
                      </div>
                    ) : inspectorTab === "details" ? (
                      <InspectorDetails
                        t={selectedTaskCalc}
                        draftTask={draft.tasks[selectedTaskIdx]}
                        onChange={(patch) => updateTask(selectedTaskIdx, patch)}
                      />
                    ) : inspectorTab === "relationships" ? (
                      <InspectorRelationships
                        taskId={selectedTaskCalc.id}
                        draft={draft}
                        computed={computed}
                        updateDep={updateDep}
                        removeDep={removeDep}
                        setDraft={setDraft}
                        setDirty={setDirty}
                      />
                    ) : inspectorTab === "resources" ? (
                      <div className="text-xs text-[#5c574e]">
                        <ResourcesPanel
                          result={computed!}
                          tasks={draft.tasks}
                          onTaskChange={updateTask}
                          
                        />
                      </div>
                    ) : inspectorTab === "codes" ? (
                      <ActivityCodeChips scheduleId={selectedId} taskId={selectedTaskCalc.id} />
                    ) : inspectorTab === "calendar" ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Activity calendar</Label>
                        <Select
                          value={draft.tasks[selectedTaskIdx]?.calendarId ?? "__default"}
                          onValueChange={(v) =>
                            updateTask(selectedTaskIdx, {
                              calendarId: v === "__default" ? undefined : v,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-72 text-xs">
                            <SelectValue placeholder="Project default" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default">
                              Project default
                              {calendars.find((c) => c.isDefault)
                                ? ` (${calendars.find((c) => c.isDefault)!.name})`
                                : ""}
                            </SelectItem>
                            {calendars
                              .filter((c) => !c.isDefault)
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-[#776e5e]">
                          Duration walks in this calendar. Lag stays in project-default days.
                        </p>
                      </div>
                    ) : inspectorTab === "notebook" ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Description</Label>
                        <Textarea
                          className="min-h-[80px] text-sm"
                          value={draft.tasks[selectedTaskIdx]?.description ?? ""}
                          onChange={(e) =>
                            updateTask(selectedTaskIdx, { description: e.target.value })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : activeTab === "wbs" ? (
              <div className="flex-1 overflow-auto p-4">
                <StructurePanel scheduleId={selectedId} />
              </div>
            ) : activeTab === "resources" ? (
              <div className="flex-1 overflow-auto p-4">
                {computed ? (
                  <ResourcesPanel
                    result={computed}
                    tasks={draft.tasks}
                    onTaskChange={updateTask}
                  />
                ) : null}
              </div>
            ) : activeTab === "reports" ? (
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {computed ? <DcmaPanel result={computed} /> : null}
                {computed ? (
                  <ReportsPanel
                    result={computed}
                    ganttContainerSelector="[data-gantt-container]"
                  />
                ) : null}
                {computed ? <OpenEndsReport result={computed} /> : null}
              </div>
            ) : activeTab === "activities" ? (
              <div className="flex-1 overflow-auto p-4">
                <DependenciesEditor
                  draft={draft}
                  updateDep={updateDep}
                  removeDep={removeDep}
                  addDep={addDep}
                />
              </div>
            ) : activeTab === "dashboards" ? (
              <div className="flex-1 overflow-auto">
                {computed ? (
                  <DashboardsPanel
                    result={computed}
                    tasks={draft.tasks}
                    onTaskChange={updateTask}
                    dataDate={draft.dataDate}
                  />
                ) : null}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-[#9c8b6e]" />
            )}
          </div>

          {/* ============ STATUS BAR ============ */}
          <footer className="flex h-8 shrink-0 items-center gap-6 border-t border-[#e6dfd0] bg-[#faf8f3] px-4 text-[11px] text-[#5c574e]">
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  dataQuality === "Good"
                    ? "bg-[#3d8a5c]"
                    : dataQuality === "Warnings"
                      ? "bg-[#d4842a]"
                      : dataQuality === "Errors"
                        ? "bg-[#b42318]"
                        : "bg-[#c7b89d]"
                }`}
              />
              <span className="uppercase tracking-wide text-[#7a6a4d]">Data Date</span>{" "}
              <span className="font-medium text-[#1f241f]">{draft.dataDate ?? "—"}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[#7a6a4d]">Baseline</span>{" "}
              <span className="font-medium text-[#1f241f]">
                {comparisonBaselineId ? "Comparing" : "—"}
              </span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[#7a6a4d]">Activities</span>{" "}
              <span className="font-medium text-[#1f241f]">{totalActivities}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[#7a6a4d]">Critical</span>{" "}
              <span className="font-medium text-[#b42318]">{criticalCount}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[#7a6a4d]">In Progress</span>{" "}
              <span className="font-medium text-[#1f241f]">{inProgressCount}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[#7a6a4d]">Completed</span>{" "}
              <span className="font-medium text-[#3d8a5c]">{completedCount}</span>
            </span>
            <span className="ml-auto">
              <span className="uppercase tracking-wide text-[#7a6a4d]">Quality</span>{" "}
              <span
                className={`font-medium ${
                  dataQuality === "Good"
                    ? "text-[#3d8a5c]"
                    : dataQuality === "Errors"
                      ? "text-[#b42318]"
                      : "text-[#d4842a]"
                }`}
              >
                {dataQuality}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete this schedule?")) deleteMut.mutate(selectedId);
              }}
              disabled={deleteMut.isPending}
              className="text-[#b42318] hover:underline"
            >
              Delete
            </button>
          </footer>
        </>
      )}

      {/* ============ CONFIGURE DRAWER ============ */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex"
          onClick={() => setDrawerOpen(false)}
        >
          <div className="flex-1 bg-black/30 backdrop-blur-sm" />
          <aside
            className="relative flex h-full w-[420px] flex-col overflow-hidden border-l border-[#e6dfd0] bg-[#faf8f3] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#e6dfd0] bg-white px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1f241f]">
                Configure schedule
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-[#7a6a4d] hover:text-[#1f241f]"
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-auto p-4">
              {draft ? (
                <CalendarPanel
                  workDays={draft.workDays}
                  holidays={draft.holidays}
                  onChange={({ workDays, holidays }) => {
                    setDraft({ ...draft, workDays, holidays });
                    setDirty(true);
                  }}
                />
              ) : null}
              <CalendarsPanel
                scheduleId={selectedId!}
                onDefaultChanged={() =>
                  qc.invalidateQueries({ queryKey: ["schedule", selectedId] })
                }
              />
              {draft ? (
                <FragnetPanel
                  tasks={draft.tasks}
                  dependencies={draft.dependencies}
                  onInsert={({ tasks, dependencies }) => {
                    setDraft({ ...draft, tasks, dependencies });
                    setDirty(true);
                  }}
                />
              ) : null}
              {draft ? (
                <AnnotationsPanel
                  annotations={draft.annotations}
                  tasks={draft.tasks}
                  onChange={(annotations) => {
                    setDraft({ ...draft, annotations });
                    setDirty(true);
                  }}
                />
              ) : null}
              {draft ? (
                <UpdateCyclePanel
                  scheduleId={selectedId!}
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
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

// =====================================================================
// Helpers / sub-components
// =====================================================================

function formatShort(iso?: string) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00.000Z`);
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${m}-${String(d.getUTCFullYear()).slice(2)}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function InspectorDetails({
  t,
  draftTask,
  onChange,
}: {
  t: import("@/lib/scheduler/types").ScheduledTask;
  draftTask: Task;
  onChange: (patch: Partial<Task>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">
            Activity name
          </Label>
          <Input
            className="h-8 text-sm"
            value={draftTask.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">Duration</Label>
            <Input
              type="number"
              min={0}
              className="h-8 text-sm"
              value={draftTask.duration}
              onChange={(e) => onChange({ duration: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">% Complete</Label>
            <Input
              type="number"
              min={0}
              max={100}
              className="h-8 text-sm"
              value={draftTask.percentComplete ?? ""}
              onChange={(e) =>
                onChange({
                  percentComplete: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">Start NET</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={draftTask.startNoEarlierThan ?? ""}
              onChange={(e) => onChange({ startNoEarlierThan: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">WBS</Label>
            <Input
              className="h-8 text-sm"
              value={draftTask.wbs ?? ""}
              onChange={(e) => onChange({ wbs: e.target.value })}
            />
          </div>
        </div>
      </div>
      <div className="rounded-md border border-[#e6dfd0] bg-[#faf8f3] p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d]">
          CPM stats
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#3d3527]">
          <dt className="text-[#7a6a4d]">Early start</dt>
          <dd className="text-right font-medium">d{t.earlyStart}</dd>
          <dt className="text-[#7a6a4d]">Early finish</dt>
          <dd className="text-right font-medium">d{t.earlyFinish}</dd>
          <dt className="text-[#7a6a4d]">Late start</dt>
          <dd className="text-right font-medium">d{t.lateStart}</dd>
          <dt className="text-[#7a6a4d]">Late finish</dt>
          <dd className="text-right font-medium">d{t.lateFinish}</dd>
          <dt className="text-[#7a6a4d]">Total float</dt>
          <dd
            className={`text-right font-semibold ${t.totalFloat <= 0 ? "text-[#b42318]" : "text-[#3d8a5c]"}`}
          >
            {t.totalFloat}d
          </dd>
          <dt className="text-[#7a6a4d]">Free float</dt>
          <dd className="text-right font-medium">{t.freeFloat}d</dd>
        </dl>
      </div>
    </div>
  );
}

function InspectorRelationships({
  taskId,
  draft,
  computed,
  updateDep,
  removeDep,
  setDraft,
  setDirty,
}: {
  taskId: string;
  draft: Draft;
  computed: ReturnType<typeof calculateSchedule> | null;
  updateDep: (idx: number, patch: Partial<Dependency>) => void;
  removeDep: (idx: number) => void;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  setDirty: (b: boolean) => void;
}) {
  const predRows = draft.dependencies
    .map((d, di) => ({ d, di }))
    .filter(({ d }) => d.to === taskId);
  const succRows = draft.dependencies
    .map((d, di) => ({ d, di }))
    .filter(({ d }) => d.from === taskId);
  const otherTasks = draft.tasks.filter((x) => x.id !== taskId);
  const drivingSet = new Set(
    (computed && "dependencies" in computed ? computed.dependencies : [])
      .filter((x) => x.isDriving)
      .map((x) => `${x.from}|${x.to}|${x.type}`),
  );

  const addLink = (side: "pred" | "succ") => {
    if (otherTasks.length === 0) {
      toast.error("Need another activity to link to");
      return;
    }
    const other = otherTasks[0].id;
    setDraft((dd) => {
      if (!dd) return dd;
      return {
        ...dd,
        dependencies: [
          ...dd.dependencies,
          side === "pred"
            ? { from: other, to: taskId, type: "FS", lag: 0 }
            : { from: taskId, to: other, type: "FS", lag: 0 },
        ],
      };
    });
    setDirty(true);
  };

  const renderRow = (
    { d, di }: { d: Dependency; di: number },
    side: "pred" | "succ",
  ) => {
    const otherId = side === "pred" ? d.from : d.to;
    const driving = drivingSet.has(`${d.from}|${d.to}|${d.type ?? "FS"}`);
    return (
      <div key={di} className="flex items-center gap-1.5 py-0.5 text-xs">
        <Select
          value={otherId}
          onValueChange={(v) => updateDep(di, side === "pred" ? { from: v } : { to: v })}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {otherTasks.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.id} · {x.name.slice(0, 24)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={d.type ?? "FS"}
          onValueChange={(v) => updateDep(di, { type: v as DependencyType })}
        >
          <SelectTrigger className="h-7 w-16 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FS">FS</SelectItem>
            <SelectItem value="SS">SS</SelectItem>
            <SelectItem value="FF">FF</SelectItem>
            <SelectItem value="SF">SF</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          className="h-7 w-14 text-right text-xs"
          value={d.lag ?? 0}
          onChange={(e) => updateDep(di, { lag: Number(e.target.value) || 0 })}
        />
        {driving ? (
          <span className="text-[10px] font-semibold text-[#7a5cc4]" title="Driving">
            ★
          </span>
        ) : null}
        <button
          type="button"
          className="text-[#b42318]"
          onClick={() => removeDep(di)}
          aria-label="Remove link"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d]">
          <span>Predecessors</span>
          <button
            type="button"
            onClick={() => addLink("pred")}
            className="text-[#1f241f] hover:underline"
          >
            + add
          </button>
        </div>
        {predRows.length === 0 ? (
          <div className="text-xs text-[#9c8b6e]">No predecessors</div>
        ) : (
          predRows.map((r) => renderRow(r, "pred"))
        )}
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d]">
          <span>Successors</span>
          <button
            type="button"
            onClick={() => addLink("succ")}
            className="text-[#1f241f] hover:underline"
          >
            + add
          </button>
        </div>
        {succRows.length === 0 ? (
          <div className="text-xs text-[#9c8b6e]">No successors</div>
        ) : (
          succRows.map((r) => renderRow(r, "succ"))
        )}
      </div>
    </div>
  );
}

function DependenciesEditor({
  draft,
  updateDep,
  removeDep,
  addDep,
}: {
  draft: Draft;
  updateDep: (idx: number, patch: Partial<Dependency>) => void;
  removeDep: (idx: number) => void;
  addDep: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-[#e6dfd0] bg-white">
      <div className="flex items-center justify-between border-b border-[#eee7d8] px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#7a6a4d]">
          All dependencies · {draft.dependencies.length}
        </h3>
        <Button size="sm" variant="outline" onClick={addDep}>
          <Plus className="mr-1 h-3 w-3" /> Add dependency
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-[#faf8f3] text-[10px] uppercase tracking-wide text-[#7a6a4d]">
          <tr>
            <th className="px-2 py-2 text-left">From</th>
            <th className="px-2 py-2 text-left">To</th>
            <th className="px-2 py-2 text-left">Type</th>
            <th className="px-2 py-2 text-right">Lag</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {draft.dependencies.map((d, idx) => (
            <tr key={idx} className="border-t border-[#f3eede]">
              <td className="px-2 py-1">
                <Select value={d.from} onValueChange={(v) => updateDep(idx, { from: v })}>
                  <SelectTrigger className="h-8 w-32 text-xs">
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
                <Select value={d.to} onValueChange={(v) => updateDep(idx, { to: v })}>
                  <SelectTrigger className="h-8 w-32 text-xs">
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
                  onValueChange={(v) => updateDep(idx, { type: v as DependencyType })}
                >
                  <SelectTrigger className="h-8 w-20 text-xs">
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
                  onChange={(e) => updateDep(idx, { lag: Number(e.target.value) || 0 })}
                />
              </td>
              <td className="px-2 py-1 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeDep(idx)}
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
          {draft.dependencies.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-[#9c8b6e]">
                No dependencies yet. Click "Add dependency".
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
