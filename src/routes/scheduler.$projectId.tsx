import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  loadSchedule,
  saveSchedule,
  deleteSchedule,
  loadBaseline,
  captureBaseline,
} from "@/lib/scheduler/persistence.functions";

import { calculateSchedule } from "@/lib/scheduler/engine";
import { rescheduleFromDataDate, addWorkingDaysIso } from "@/lib/scheduler/progress";
import type { Annotation, Dependency, DependencyType, Schedule, Task } from "@/lib/scheduler/types";
import { buildIntelScheduleContext } from "@/lib/scheduler/intel-context";
import { IntelChatPanel } from "@/components/scheduler/IntelChatPanel";
import { IntelBuildWorkspace } from "@/components/scheduler/IntelBuildWorkspace";
import {
  SchedulerShell,
  IntelDock,
  IntelTrigger,
  useSchedulerLayout,
  useSchedulerLayoutSafe,
} from "@/components/scheduler/shell";


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
import { CpmGrid, getCpmStickyTableWidth } from "@/components/scheduler/CpmGrid";
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
import { loadStructure } from "@/lib/scheduler/structure.functions";
import { listCalendars } from "@/lib/scheduler/calendars.functions";

import { FragnetPanel } from "@/components/scheduler/FragnetPanel";
import { AnnotationsPanel } from "@/components/scheduler/AnnotationsPanel";
import { UpdateCyclePanel } from "@/components/scheduler/UpdateCyclePanel";
import { InlineText, InlineNumber } from "@/components/scheduler/InlineEdit";
import { EmptyScheduleState } from "@/components/scheduler/EmptyScheduleState";
import { ActivityInspectorPanel } from "@/components/scheduler/ActivityInspectorPanel";
import {
  computeFitDayPx,
  computeInspectorWidth,
} from "@/lib/scheduler/geometry";
import type { SamplePayload } from "@/lib/scheduler/sample";
import { exportScheduleCsv } from "@/lib/scheduler/csv-export";
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
  beforeLoad: async ({ location }) => {
    // Scheduler server fns require an authenticated Supabase session. Gate
    // here so unauthenticated visitors are redirected to /login instead of
    // hitting "Unauthorized: No authorization header provided".
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
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
  const captureBaselineFn = useServerFn(captureBaseline);


  const selectedId = projectId;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Single scroll container — CpmGrid renders the table + Gantt as one
  // unified surface, so vertical sync is intrinsic. This ref is used for
  // the auto-fit zoom calculation (chart width = container - sticky table).
  const rightScrollRef = useRef<HTMLDivElement | null>(null);

  const [dayPx, setDayPx] = useState(22);
  const [zoomUserSet, setZoomUserSet] = useState(false);
  const setDayPxUser = (n: number) => { setZoomUserSet(true); setDayPx(n); };
  const [nearCriticalFloat, setNearCriticalFloat] = useState(5);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<"wbs" | "critical" | "none">("wbs");
  const [calendarFilter, setCalendarFilter] = useState<string>("");
  const [resourceFilter, setResourceFilter] = useState<string>("");
  const [codeFilter, setCodeFilter] = useState<string>(""); // "typeId:valueId"

  // ---------- adjustable workbench layout ----------
  // Persisted per-project so user's preferred panel sizes survive reload.
  const layoutStorageKey = `aos:scheduler:workbench:${selectedId}`;
  const [nameColWidth, setNameColWidth] = useState<number>(240);
  const [inspectorHeight, setInspectorHeight] = useState<number>(260);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  // UI-2.0 moved Schedule Intelligence into a bottom-anchored dock owned by
  // SchedulerLayoutContext. The old right-side drawer state is gone.
  // Focus mode hides the portal top-strip + sidebar so the grid is the hero.
  const [focusMode, setFocusMode] = useState(false);


  // Hydrate from localStorage on mount / project change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(layoutStorageKey);
      if (!raw) return;
      const v = JSON.parse(raw) as Partial<{
        nameColWidth: number;
        inspectorHeight: number;
        inspectorCollapsed: boolean;
        inspectorExpanded: boolean;
        focusMode: boolean;
      }>;
      if (typeof v.nameColWidth === "number") setNameColWidth(v.nameColWidth);
      if (typeof v.inspectorHeight === "number") setInspectorHeight(v.inspectorHeight);
      if (typeof v.inspectorCollapsed === "boolean") setInspectorCollapsed(v.inspectorCollapsed);
      if (typeof v.inspectorExpanded === "boolean") setInspectorExpanded(v.inspectorExpanded);
      if (typeof v.focusMode === "boolean") setFocusMode(v.focusMode);
    } catch {
      /* ignore corrupted layout */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Persist layout changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        layoutStorageKey,
        JSON.stringify({
          nameColWidth,
          inspectorHeight,
          inspectorCollapsed,
          inspectorExpanded,
          focusMode,
        }),
      );
    } catch {
      /* ignore quota errors */
    }
  }, [
    layoutStorageKey,
    nameColWidth,
    inspectorHeight,
    inspectorCollapsed,
    inspectorExpanded,
    focusMode,
  ]);


  // Apply focus mode by toggling a body class so global CSS hides the
  // portal-level top-strip + sidebar. Always clean up on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("scheduler-focus-mode", focusMode);
    return () => {
      document.body.classList.remove("scheduler-focus-mode");
    };
  }, [focusMode]);

  // In focus mode, default the inspector to collapsed when nothing is
  // selected and to standard (non-collapsed) when an activity is selected.
  // Users can still manually resize / collapse / expand after that.
  const hasSelection = !!selectedTaskId;
  useEffect(() => {
    if (!focusMode) return;
    setInspectorCollapsed(!hasSelection);
    if (hasSelection) setInspectorExpanded(false);
  }, [focusMode, hasSelection]);

  // PA-2b: when the right-side ActivityInspectorPanel is open AND an
  // activity is selected, demote the legacy bottom inspector to its compact
  // strip so the right panel is the primary command center (no duplicate
  // full detail in two places). User can still click the strip to re-expand
  // for editing surfaces (Relationships, Resources, Codes, Notebook).
  const _rightInspectorOpen = useSchedulerLayoutSafe()?.inspectorOpen ?? false;
  useEffect(() => {
    if (_rightInspectorOpen && hasSelection) {
      setInspectorCollapsed(true);
      setInspectorExpanded(false);
    }
  }, [_rightInspectorOpen, hasSelection, selectedTaskId]);



  // Resizer drag helpers — global pointer listeners avoid losing the drag
  // when the cursor leaves the handle.
  const startColResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = nameColWidth;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(140, Math.min(560, startW + (ev.clientX - startX)));
      setNameColWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startInspectorResize = (e: React.PointerEvent) => {
    if (inspectorCollapsed || inspectorExpanded) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = inspectorHeight;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(120, Math.min(560, startH - (ev.clientY - startY)));
      setInspectorHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };




  const loadStructureFn = useServerFn(loadStructure);
  const { data: structure } = useQuery({
    queryKey: ["structure", selectedId],
    queryFn: () => loadStructureFn({ data: { scheduleId: selectedId } }),
    enabled: !!selectedId,
  });

  const codesByTask = useMemo(() => {
    const m = new Map<
      string,
      { typeName: string; typeId: string; valueId: string; code: string; color: string | null }[]
    >();
    if (!structure) return m;
    const valueIndex = new Map<
      string,
      { code: string; color: string | null; typeName: string; typeId: string }
    >();
    for (const t of structure.codeTypes) {
      for (const v of t.values) {
        valueIndex.set(v.id, { code: v.code, color: v.color, typeName: t.name, typeId: t.id });
      }
    }
    for (const a of structure.assignments) {
      const v = valueIndex.get(a.valueId);
      if (!v) continue;
      const arr = m.get(a.taskId) ?? [];
      arr.push({
        typeName: v.typeName,
        typeId: v.typeId,
        valueId: a.valueId,
        code: v.code,
        color: v.color,
      });
      m.set(a.taskId, arr);
    }
    return m;
  }, [structure]);


  const [comparisonBaselineId, setComparisonBaselineId] = useState<string | null>(null);

  // Reset comparison when changing schedules
  useEffect(() => {
    setComparisonBaselineId(null);
    setDraft(null);
    setDirty(false);
    setZoomUserSet(false);
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

  // Hydrate draft when a schedule loads. If the loaded schedule has no
  // activities, seed the workbench with the Commercial Fit-Out sample so the
  // first screen is alive and demonstrable (unsaved until user clicks Save).
  useEffect(() => {
    if (loadQuery.data) {
      const s = loadQuery.data.schedule;
      if (s.tasks.length === 0) {
        import("@/lib/scheduler/sample").then(({ commercialFitOutSample }) => {
          const p = commercialFitOutSample();
          setDraft({
            name: s.name && s.name !== "Untitled" ? s.name : p.name,
            projectStartDate: p.projectStartDate,
            dataDate: p.dataDate,
            workDays: p.workDays,
            holidays: p.holidays,
            tasks: p.tasks.map((t) => ({ ...t })),
            dependencies: p.dependencies.map((d) => ({ ...d })),
            annotations: p.annotations.map((a) => ({ ...a })),
          });
          setDirty(true);
        });
        return;
      }
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

  // Auto-fit zoom: pick a dayPx that fits the project horizontally on first
  // load for this schedule. User changes (setDayPxUser) opt out. Re-runs on
  // container resize so the schedule stays readable when the window changes.
  const fitToContainer = React.useCallback(() => {
    if (!computed || computed.projectDuration < 1) return;
    const container = rightScrollRef.current;
    if (!container) return;
    // The container already sits inside the inspector-aware right pad and
    // (in focus mode) the zeroed sidebar var, so its clientWidth IS the
    // current work surface. Geometry helper applies the sticky-table
    // deduction, padding, and clamp for us — single source of truth.
    const dayPx = computeFitDayPx({
      workSurface: container.clientWidth,
      nameColWidth,
      projectDuration: computed.projectDuration,
    });
    if (dayPx <= 0) return;
    setDayPx(dayPx);
    container.scrollLeft = 0;
  }, [computed, nameColWidth]);
  useEffect(() => {
    if (zoomUserSet) return;
    fitToContainer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed?.projectDuration, zoomUserSet]);
  useEffect(() => {
    if (zoomUserSet) return;
    const container = rightScrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitToContainer());
    ro.observe(container);
    return () => ro.disconnect();
  }, [zoomUserSet, fitToContainer]);


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

  const applySample = (payload: SamplePayload) => {
    setDraft({
      name: payload.name,
      projectStartDate: payload.projectStartDate,
      dataDate: payload.dataDate,
      workDays: payload.workDays,
      holidays: payload.holidays,
      tasks: payload.tasks.map((t) => ({ ...t })),
      dependencies: payload.dependencies.map((d) => ({ ...d })),
      annotations: payload.annotations.map((a) => ({ ...a })),
    });
    setDirty(true);
    toast.success(`Loaded ${payload.tasks.length} sample activities — review and Save.`);
  };

  const applyPasted = ({ tasks, dependencies }: { tasks: Task[]; dependencies: Dependency[] }) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        tasks: [...d.tasks, ...tasks],
        dependencies: [...d.dependencies, ...dependencies],
      };
    });
    setDirty(true);
    toast.success(`Added ${tasks.length} activities from paste.`);
  };

  const applyXerImport = ({
    name,
    projectStartDate,
    tasks,
    dependencies,
  }: {
    name: string;
    projectStartDate?: string;
    tasks: Task[];
    dependencies: Dependency[];
  }) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        name: d.tasks.length === 0 ? name : d.name,
        projectStartDate: d.projectStartDate ?? projectStartDate,
        tasks: [...d.tasks, ...tasks],
        dependencies: [...d.dependencies, ...dependencies],
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
    <SchedulerShell projectId={selectedId}>
    <div
      className="scheduler-print-root flex h-screen flex-col bg-[var(--sched-ivory)] text-[var(--sched-graphite-strong)]"
      style={{ paddingRight: "var(--scheduler-right-pad, 0px)" }}
    >
      {/* ============ TOP HEADER ============ */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--sched-surface-rule)] bg-white/90 px-4 backdrop-blur">
        <Link
          to="/scheduler"
          className="group flex items-center gap-2 text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
          title="All projects"
        >
          <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-[var(--sched-graphite-strong)] text-[9px] font-bold tracking-wider text-[var(--sched-brass-soft)]">
            AOS
          </span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--sched-graphite)] group-hover:text-[var(--sched-graphite)] sm:inline">
            Projects ·
          </span>
        </Link>

        <ProductModeSwitcher />

        <div className="h-5 w-px bg-[var(--sched-surface-rule)]" />

        <div className="flex flex-1 items-center gap-2 min-w-0">
          {draft ? (
            <input
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setDirty(true);
              }}
              className="min-w-0 flex-1 truncate bg-transparent text-[14px] font-semibold tracking-tight text-[var(--sched-graphite-strong)] outline-none placeholder:text-[var(--sched-graphite-soft)] focus:rounded focus:bg-[var(--sched-surface-rule-soft)] focus:px-2"
              placeholder="Untitled schedule"
            />
          ) : (
            <span className="text-[14px] font-semibold text-[var(--sched-graphite-soft)]">Loading…</span>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities…"
              className="h-7 w-56 rounded-md border border-transparent bg-[var(--sched-surface-rule-soft)] pl-8 pr-3 text-xs outline-none transition focus:border-[var(--sched-graphite-soft)] focus:bg-white"
            />
            <svg
              className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--sched-graphite)]"
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

        <div className="flex items-center gap-1">
          {comparisonBaselineId ? (
            <span className="hidden lg:inline-flex items-center gap-1.5 rounded-md bg-[var(--sched-surface-rule-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sched-brass-deep)]" />
              Baseline
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => exportScheduleCsv(draft, computed)}
            disabled={!draft || !computed}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--sched-graphite)] hover:bg-[var(--sched-surface-rule-soft)] hover:text-[var(--sched-graphite-strong)] disabled:opacity-40"
            title="Export activities as CSV"
          >
            Export
          </button>
          <PublishShortcut disabled={!draft || !computed} />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--sched-graphite)] hover:bg-[var(--sched-surface-rule-soft)] hover:text-[var(--sched-graphite-strong)]"
            title="Calendars, baselines, codes, reports, fragnet, update cycle, annotations"
          >
            Configure
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              focusMode
                ? "bg-[var(--sched-graphite-strong)] text-white hover:bg-[var(--sched-graphite-strong)]"
                : "text-[var(--sched-graphite)] hover:bg-[var(--sched-surface-rule-soft)] hover:text-[var(--sched-graphite-strong)]"
            }`}
            title={focusMode ? "Exit focus mode" : "Focus mode (hide portal chrome)"}
            aria-pressed={focusMode}
          >
            {focusMode ? "Exit Focus" : "Focus"}
          </button>
          <div className="mx-1 h-5 w-px bg-[var(--sched-surface-rule)]" />
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={!dirty || saveMut.isPending}
            className="bg-[var(--sched-graphite-strong)] text-white shadow-sm hover:bg-[var(--sched-graphite-strong)] disabled:opacity-40"
          >
            {saveMut.isPending ? "Saving…" : dirty ? "Update Schedule" : "Saved"}
          </Button>
        </div>
      </header>

      {/* ============ TAB BAR ============ */}
      <nav className="flex h-7 shrink-0 items-end gap-0 border-b border-[var(--sched-surface-rule)] bg-white/60 px-4">
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
            className={`relative px-3 py-1 text-[11.5px] font-medium transition ${
              activeTab === key
                ? "text-[var(--sched-graphite-strong)]"
                : "text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
            }`}
          >
            {label}
            {activeTab === key ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--sched-graphite-strong)]" />
            ) : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pb-1">
          <Link
            to="/scheduler-portfolio"
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
          >
            Portfolio →
          </Link>
          <Link
            to="/scheduler-field"
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
          >
            Field →
          </Link>
        </div>
      </nav>

      {/* ============ NOT-LOADED STATES ============ */}
      {!selectedId ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-md border border-dashed border-[var(--sched-surface-rule)] bg-white/60 p-10 text-center text-sm text-[var(--sched-graphite)]">
            Select a schedule, or create one to start editing.
          </div>
        </div>
      ) : loadQuery.isLoading || !draft ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--sched-graphite)]">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sched-validated)]" />
            Loading schedule
          </div>
          <div className="h-1 w-48 overflow-hidden rounded-full bg-[var(--sched-surface-rule-soft)]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--sched-graphite-strong)]" />
          </div>
        </div>

      ) : (
        <>
          {/* ============ TOOLBAR ============ */}
          <div
            data-scheduler-toolbar
            className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--sched-surface-rule)] bg-white px-5 py-1.5"
          >
            {/* ——— VIEW ——— */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">View</span>
              <div
                data-scheduler-viewmode
                className="flex items-center rounded-md border border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] p-0.5"
              >
                <button className="rounded bg-white px-2.5 py-0.5 text-[11px] font-medium text-[var(--sched-graphite-strong)] shadow-sm">
                  Gantt
                </button>
                <button
                  disabled
                  title="Board view — coming soon"
                  className="px-2.5 py-0.5 text-[11px] text-[var(--sched-graphite-soft)] cursor-not-allowed"
                >
                  Board
                </button>
                <button
                  disabled
                  title="List view — coming soon"
                  className="px-2.5 py-0.5 text-[11px] text-[var(--sched-graphite-soft)] cursor-not-allowed"
                >
                  List
                </button>
              </div>
            </div>

            <div className="h-5 w-px bg-[var(--sched-surface-rule-soft)]" />

            {/* ——— FILTER ——— */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">Filter</span>

              {calendars.length > 0 ? (
                <select
                  value={calendarFilter}
                  onChange={(e) => setCalendarFilter(e.target.value)}
                  className="h-7 rounded-md border border-[var(--sched-surface-rule)] bg-white px-2 text-[11px] text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-ivory)]"
                  title="Filter by activity calendar"
                >
                  <option value="">Calendar · All</option>
                  <option value="__default">Project default only</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {(() => {
                const resources = Array.from(
                  new Set(
                    (draft?.tasks ?? [])
                      .map((t) => t.resourceName?.trim())
                      .filter((r): r is string => !!r),
                  ),
                ).sort();
                if (resources.length === 0) return null;
                return (
                  <select
                    value={resourceFilter}
                    onChange={(e) => setResourceFilter(e.target.value)}
                    className="h-7 rounded-md border border-[var(--sched-surface-rule)] bg-white px-2 text-[11px] text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-ivory)]"
                    title="Filter by resource"
                  >
                    <option value="">Resource · All</option>
                    <option value="__none">Unassigned</option>
                    {resources.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                );
              })()}

              {structure && structure.codeTypes.length > 0 ? (
                <select
                  value={codeFilter}
                  onChange={(e) => setCodeFilter(e.target.value)}
                  className="h-7 rounded-md border border-[var(--sched-surface-rule)] bg-white px-2 text-[11px] text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-ivory)]"
                  title="Filter by activity code"
                >
                  <option value="">Code · All</option>
                  {structure.codeTypes.map((t) => (
                    <optgroup key={t.id} label={t.name}>
                      {t.values.map((v) => (
                        <option key={v.id} value={`${t.id}:${v.id}`}>
                          {t.name}: {v.code}
                          {v.description ? ` · ${v.description}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : null}

              <div className="flex items-center overflow-hidden rounded-md border border-[var(--sched-surface-rule)] bg-white">
                {(["wbs", "critical", "none"] as const).map((g, i) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroupBy(g)}
                    className={`px-2.5 py-1 text-[11px] ${
                      i > 0 ? "border-l border-[var(--sched-surface-rule)]" : ""
                    } ${
                      groupBy === g
                        ? "bg-[var(--sched-graphite-strong)] text-white"
                        : "text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)]"
                    }`}
                  >
                    {g === "wbs" ? "WBS" : g === "critical" ? "Critical" : "Flat"}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                className={`rounded-md border border-[var(--sched-surface-rule)] px-2.5 py-1 text-[11px] ${
                  showCompleted ? "bg-white text-[var(--sched-graphite)]" : "bg-[var(--sched-graphite-strong)] text-white"
                } hover:bg-[var(--sched-ivory)]`}
                title="Hide 100% complete activities"
              >
                {showCompleted ? "All" : "Remaining"}
              </button>

              <label
                className="flex items-center gap-1.5 rounded-md border border-[var(--sched-surface-rule)] bg-white px-2 py-0.5 text-[11px] text-[var(--sched-graphite)]"
                title="Activities with total float at or below this many working days are highlighted as near-critical."
              >
                <span className="inline-block h-2 w-2 rounded-sm bg-[var(--sched-near-critical,var(--sched-near-critical))]" />
                <span className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">Near-crit ≤</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={nearCriticalFloat}
                  onChange={(e) =>
                    setNearCriticalFloat(Math.max(0, Math.min(99, Number(e.target.value) || 0)))
                  }
                  className="h-5 w-10 rounded border border-[var(--sched-surface-rule)] bg-white px-1 text-right text-[11px] tabular-nums"
                />
                <span className="text-[10px] text-[var(--sched-graphite)]">d</span>
              </label>
            </div>

            <div className="h-5 w-px bg-[var(--sched-surface-rule-soft)]" />

            {/* ——— ANALYZE ——— */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">Analyze</span>
              <button
                type="button"
                onClick={() => {
                  if (!computed || computed.tasks.length === 0) return;
                  const finish = computed.tasks.reduce((a, b) =>
                    b.earlyFinish > a.earlyFinish ? b : a,
                  );
                  setSelectedTaskId(finish.id);
                }}
                className="rounded-md border border-[var(--sched-brass-soft)] bg-[var(--sched-brass-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--sched-brass-deep)] hover:bg-[var(--sched-brass-soft)]"
                title="Highlight the longest driving chain into project finish"
              >
                Driving path
              </button>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {/* ——— COMPARE ——— */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">Compare</span>
                <BaselinesPanel
                  scheduleId={selectedId}
                  comparisonId={comparisonBaselineId}
                  onComparisonChange={setComparisonBaselineId}
                  dirty={dirty}
                />
              </div>

              <div className="h-5 w-px bg-[var(--sched-surface-rule-soft)]" />

              {/* ——— ZOOM ——— */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">Zoom</span>
                <button
                  type="button"
                  onClick={() => { setZoomUserSet(false); fitToContainer(); }}
                  className="rounded border border-[var(--sched-surface-rule)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)]"
                  title="Fit project to viewport"
                >
                  Fit
                </button>
                <div className="flex items-center overflow-hidden rounded-md border border-[var(--sched-surface-rule)] bg-white">
                  {ZOOM_LEVELS.map((z, i) => (
                    <button
                      key={z.label}
                      type="button"
                      onClick={() => setDayPxUser(z.dayPx)}
                      className={`px-2 py-0.5 text-[10px] ${
                        i > 0 ? "border-l border-[var(--sched-surface-rule)]" : ""
                      } ${
                        dayPx === z.dayPx && zoomUserSet
                          ? "bg-[var(--sched-graphite-strong)] text-white"
                          : "text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)]"
                      }`}
                    >
                      {z.label}
                    </button>
                  ))}
                </div>
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

                {/* Project meta strip — compact single-line pill row */}
                <div data-scheduler-project-meta className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--sched-surface-rule-soft)] bg-white px-4 py-0.5 text-[11px] text-[var(--sched-graphite)]">
                  <label className="inline-flex items-center gap-1.5">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">Start</span>
                    <input
                      type="date"
                      className="h-6 rounded border border-[var(--sched-surface-rule)] bg-white px-1.5 text-[11px] tabular-nums"
                      value={draft.projectStartDate ?? ""}
                      onChange={(e) => {
                        setDraft({ ...draft, projectStartDate: e.target.value || undefined });
                        setDirty(true);
                      }}
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">Data date</span>
                    <input
                      type="date"
                      className="h-6 rounded border border-[var(--sched-surface-rule)] bg-white px-1.5 text-[11px] tabular-nums"
                      value={draft.dataDate ?? ""}
                      onChange={(e) => {
                        setDraft({ ...draft, dataDate: e.target.value || undefined });
                        setDirty(true);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!draft.dataDate}
                    onClick={async () => {
                      if (!draft.dataDate) return;
                      if (dirty) {
                        toast.error("Save your edits before rescheduling — the rollback baseline snapshots the saved schedule.");
                        return;
                      }
                      if (
                        !confirm(
                          "Reschedule from data date?\n\n• A rollback baseline will be captured first\n• Completed → 0d milestones\n• In-progress → remaining duration\n• Project start moves to data date",
                        )
                      )
                        return;
                      try {
                        await captureBaselineFn({
                          data: {
                            scheduleId: selectedId,
                            name: `Pre-reschedule ${draft.dataDate}`,
                            notes: JSON.stringify({ kind: "auto_pre_reschedule", dataDate: draft.dataDate }),
                          },
                        });
                        qc.invalidateQueries({ queryKey: ["baselines", selectedId] });
                      } catch (e) {
                        toast.error(`Rollback baseline failed: ${(e as Error).message}`);
                        return;
                      }
                      const r = rescheduleFromDataDate(draft.tasks, draft.dataDate);
                      setDraft({
                        ...draft,
                        tasks: r.tasks,
                        projectStartDate: r.projectStartDate,
                      });
                      setDirty(true);
                      toast.success(
                        `Reset ${r.summary.inProgress} in-progress · ${r.summary.completed} done · ${r.summary.notStarted} not started (rollback baseline saved)`,
                      );
                    }}
                    className="ml-auto rounded border border-[var(--sched-surface-rule)] bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-ivory)] disabled:opacity-40"
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
                <div className="scheduler-print-split relative flex flex-1 min-h-0 overflow-hidden">
                  {draft.tasks.length === 0 ? (
                    <div className="absolute inset-0 z-10 overflow-auto bg-[var(--sched-ivory)]/95 backdrop-blur-sm print:hidden">
                      <EmptyScheduleSlot
                        onAddActivity={addTask}
                        onApplySample={applySample}
                        onApplyPasted={applyPasted}
                        onXerImport={applyXerImport}
                      />
                    </div>
                  ) : null}

                  {/* Print-only title block (P6-style) */}
                  <div className="print-only mb-3 border-b-2 border-[var(--sched-graphite-strong)] pb-2">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--sched-graphite)]">
                          CPM Schedule
                        </div>
                        <div className="text-xl font-semibold text-[var(--sched-graphite-strong)]">
                          {draft.name || "Untitled schedule"}
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-[var(--sched-graphite-strong)]">
                        <div>
                          <span className="font-semibold uppercase tracking-wide">Start </span>
                          {draft.projectStartDate || "—"}
                        </div>
                        <div>
                          <span className="font-semibold uppercase tracking-wide">Finish </span>
                          {computed?.projectFinishDate || "—"}
                        </div>
                        <div>
                          <span className="font-semibold uppercase tracking-wide">Data date </span>
                          {draft.dataDate || "—"}
                        </div>
                        <div>
                          <span className="font-semibold uppercase tracking-wide">Duration </span>
                          {computed?.projectDuration ?? 0}d ·{" "}
                          <span className="font-semibold uppercase tracking-wide">Activities </span>
                          {draft.tasks.length}
                        </div>
                        <div className="mt-1 text-[var(--sched-graphite)]">
                          Printed {new Date().toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Unified workbench — CpmGrid renders both the sticky
                      activity table (left) and the Gantt timeline (right),
                      row-for-row aligned. */}
                  <div className="scheduler-print-right relative flex flex-1 min-w-0 flex-col bg-white">
                    <div ref={rightScrollRef} className="flex-1 overflow-auto" data-gantt-container>
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
                          nearCriticalFloat={nearCriticalFloat}
                          onTaskReschedule={rescheduleTask}
                          nameColWidth={nameColWidth}
                        />
                      ) : null}
                    </div>
                    {/* Vertical resizer — pinned to the right edge of the
                        sticky activity table. Drag horizontally to widen or
                        narrow the activity-name column. */}
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize activity table"
                      onPointerDown={startColResize}
                      onDoubleClick={() => setNameColWidth(240)}
                      className="group absolute top-0 bottom-8 z-30 -ml-1 w-2 cursor-col-resize select-none print:hidden"
                      style={{ left: getCpmStickyTableWidth(nameColWidth) }}
                      title="Drag to resize · double-click to reset"
                    >
                      <div className="mx-auto h-full w-px bg-transparent group-hover:bg-[var(--sched-graphite-soft)] group-active:bg-[var(--sched-graphite-strong)]" />
                    </div>
                    {/* Legend — slim inline strip */}
                    <div className="flex shrink-0 items-center justify-center gap-4 border-t border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-4 py-1 text-[10px] text-[var(--sched-graphite)]">
                      <LegendDot color="var(--sched-graphite-strong)" label="Planned" />
                      <LegendDot color="var(--sched-critical)" label="Critical" />
                      {nearCriticalFloat > 0 ? (
                        <LegendDot
                          color="var(--sched-near-critical)"
                          label={`Near-critical (≤${nearCriticalFloat}d)`}
                        />
                      ) : null}
                      <LegendDot color="var(--sched-graphite)" label="Float / baseline" />
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rotate-45 bg-[var(--sched-brass-deep)]" /> Milestone
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-3 w-0.5 bg-[var(--sched-validated)]" /> Data date
                      </span>
                    </div>
                  </div>

                  {/* UI-2.0 moved Schedule Intelligence into the bottom-anchored
                      <IntelDock /> at the bottom of this route. The old
                      right-side drawer + Build full-screen overlay branches
                      were removed in UI-2.1. */}


                </div>


                {/* ============ ACTIVITY INSPECTOR (resizable / collapsible / expanded) ============ */}
                <div
                  className="shrink-0 border-t border-[var(--sched-surface-rule)] bg-white print:hidden"
                  style={{
                    height: inspectorCollapsed
                      ? 30
                      : inspectorExpanded
                        ? "60vh"
                        : inspectorHeight,
                  }}
                >
                  {/* Top resize handle — only active in normal mode. */}
                  {!inspectorCollapsed && !inspectorExpanded ? (
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize inspector"
                      onPointerDown={startInspectorResize}
                      className="group relative h-1.5 cursor-row-resize select-none"
                      title="Drag to resize"
                    >
                      <div className="absolute inset-x-0 top-0 h-px bg-[var(--sched-surface-rule)] group-hover:bg-[var(--sched-graphite-strong)]" />
                    </div>
                  ) : null}

                  {/* Inspector chrome: title row (when activity selected) + tabs + window controls. */}
                  {inspectorCollapsed ? (
                    <button
                      type="button"
                      onClick={() => setInspectorCollapsed(false)}
                      className="flex h-[30px] w-full items-center gap-3 border-b border-[var(--sched-surface-rule-soft)] px-4 text-left hover:bg-[var(--sched-ivory)]"
                      title="Expand inspector"
                    >
                      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">
                        {selectedTaskCalc ? "Activity" : "Schedule"} Inspector
                      </span>
                      {selectedTaskCalc ? (
                        <span className="truncate text-[11px] text-[var(--sched-graphite-strong)]">
                          {selectedTaskCalc.id} · {draft.tasks[selectedTaskIdx]?.name ?? ""}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--sched-graphite)]">
                          {computed?.projectFinishDate
                            ? `Finish ${computed.projectFinishDate}`
                            : "—"}
                        </span>
                      )}
                      <span className="ml-auto text-[var(--sched-graphite)]">▴</span>
                    </button>
                  ) : (
                    <div className="flex h-full flex-col">
                      {selectedTaskCalc && selectedTaskIdx >= 0 ? (
                        <InspectorTitleRow
                          t={selectedTaskCalc}
                          name={draft.tasks[selectedTaskIdx]?.name ?? ""}
                          wbs={draft.tasks[selectedTaskIdx]?.wbs}
                          calendarName={
                            draft.tasks[selectedTaskIdx]?.calendarId
                              ? calendars.find(
                                  (c) => c.id === draft.tasks[selectedTaskIdx]?.calendarId,
                                )?.name
                              : calendars.find((c) => c.isDefault)?.name
                          }
                          percentComplete={draft.tasks[selectedTaskIdx]?.percentComplete}
                          nearCriticalFloat={nearCriticalFloat}
                          predCount={
                            draft.dependencies.filter((d) => d.to === selectedTaskCalc.id).length
                          }
                          succCount={
                            draft.dependencies.filter((d) => d.from === selectedTaskCalc.id).length
                          }
                          onClear={() => setSelectedTaskId(null)}
                        />
                      ) : null}

                      <div className="flex items-center gap-3 border-b border-[var(--sched-surface-rule-soft)] px-4">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">
                          {selectedTaskCalc ? "Activity" : "Schedule"}
                        </span>
                        <div className="h-4 w-px bg-[var(--sched-surface-rule-soft)]" />
                        <div className="flex items-end gap-0">
                          {(
                            [
                              ["details", "Details"],
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
                                  ? "text-[var(--sched-graphite-strong)]"
                                  : "text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
                              }`}
                            >
                              {label}
                              {inspectorTab === key ? (
                                <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--sched-graphite-strong)]" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <IntelTrigger />

                          <button
                            type="button"
                            onClick={() => setInspectorExpanded((v) => !v)}
                            className="rounded p-1 text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)] hover:text-[var(--sched-graphite-strong)]"
                            title={inspectorExpanded ? "Restore" : "Expand inspector"}
                            aria-label={inspectorExpanded ? "Restore inspector" : "Expand inspector"}
                          >
                            {inspectorExpanded ? "⤡" : "⤢"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectorCollapsed(true)}
                            className="rounded p-1 text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)] hover:text-[var(--sched-graphite-strong)]"
                            title="Collapse inspector"
                            aria-label="Collapse inspector"
                          >
                            ▾
                          </button>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">

                    {!selectedTaskCalc || selectedTaskIdx < 0 ? (
                      <ScheduleContextSummary
                        draft={draft}
                        computed={computed}
                        nearCriticalFloat={nearCriticalFloat}
                        baselineActive={!!comparisonBaselineId}
                        onSelect={setSelectedTaskId}
                      />
                    ) : inspectorTab === "details" ? (
                      <InspectorDetails
                        t={selectedTaskCalc}
                        draftTask={draft.tasks[selectedTaskIdx]}
                        calendars={calendars}
                        dataDate={draft.dataDate}
                        predCount={
                          draft.dependencies.filter((d) => d.to === selectedTaskCalc.id).length
                        }
                        succCount={
                          draft.dependencies.filter((d) => d.from === selectedTaskCalc.id).length
                        }
                        codes={codesByTask.get(selectedTaskCalc.id) ?? []}
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
                      <div className="text-xs text-[var(--sched-graphite)]">
                        {draft.tasks[selectedTaskIdx]?.resourceName ||
                        draft.tasks[selectedTaskIdx]?.budgetCost ? (
                          <ResourcesPanel
                            result={computed!}
                            tasks={draft.tasks}
                            onTaskChange={updateTask}
                          />
                        ) : (
                          <div className="rounded-md border border-dashed border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] p-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
                              No resources assigned
                            </div>
                            <p className="mt-1 text-[11px] text-[var(--sched-graphite)]">
                              Add a resource label and budget to track cost and
                              crew loading. Resource leveling is not part of
                              this engine yet — these values populate dashboards
                              and EVM only.
                            </p>
                            <ResourcesPanel
                              result={computed!}
                              tasks={draft.tasks}
                              onTaskChange={updateTask}
                            />
                          </div>
                        )}
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
                        <p className="text-[10px] text-[var(--sched-graphite)]">
                          Duration walks in this calendar. Lag stays in project-default days.
                        </p>
                        {calendars.length <= 1 ? (
                          <p className="text-[10px] text-[var(--sched-graphite)]">
                            Only the project default calendar exists. Create
                            named calendars in the Structure panel to assign
                            crew or shift-specific schedules.
                          </p>
                        ) : null}
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
                          placeholder="Notes, assumptions, scope, hand-off context…"
                        />
                        <p className="text-[10px] text-[var(--sched-graphite)]">
                          Notebook entries stay with the activity and surface on
                          hover throughout the workbench.
                        </p>
                      </div>
                    ) : null}
                      </div>
                    </div>
                  )}
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
              <div className="flex flex-1 items-center justify-center text-sm text-[var(--sched-graphite)]" />
            )}
          </div>

          {/* ============ STATUS BAR ============ */}
          <footer className="flex h-8 shrink-0 items-center gap-6 border-t border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] px-4 text-[11px] text-[var(--sched-graphite)]">
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  dataQuality === "Good"
                    ? "bg-[var(--sched-validated)]"
                    : dataQuality === "Warnings"
                      ? "bg-[var(--sched-near-critical)]"
                      : dataQuality === "Errors"
                        ? "bg-[var(--sched-critical)]"
                        : "bg-[var(--sched-graphite-soft)]"
                }`}
              />
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">Data Date</span>{" "}
              <span className="font-medium text-[var(--sched-graphite-strong)]">{draft.dataDate ?? "—"}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">Baseline</span>{" "}
              <span className="font-medium text-[var(--sched-graphite-strong)]">
                {comparisonBaselineId ? "Comparing" : "—"}
              </span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">Activities</span>{" "}
              <span className="font-medium text-[var(--sched-graphite-strong)]">{totalActivities}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">Critical</span>{" "}
              <span className="font-medium text-[var(--sched-critical)]">{criticalCount}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">In Progress</span>{" "}
              <span className="font-medium text-[var(--sched-graphite-strong)]">{inProgressCount}</span>
            </span>
            <span>
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">Completed</span>{" "}
              <span className="font-medium text-[var(--sched-validated)]">{completedCount}</span>
            </span>
            <span className="ml-auto">
              <span className="uppercase tracking-wide text-[var(--sched-graphite)]">Quality</span>{" "}
              <span
                className={`font-medium ${
                  dataQuality === "Good"
                    ? "text-[var(--sched-validated)]"
                    : dataQuality === "Errors"
                      ? "text-[var(--sched-critical)]"
                      : "text-[var(--sched-near-critical)]"
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
              className="text-[var(--sched-critical)] hover:underline"
            >
              Delete
            </button>
          </footer>
        </>
      )}

      {/* ============ CONFIGURE DRAWER ============ */}
      {drawerOpen ? (
        <div
          className="fixed inset-y-0 right-0 z-50 flex"
          style={{ left: "var(--app-sidebar-w, 0px)" }}
          onClick={() => setDrawerOpen(false)}
        >
          <div className="flex-1 bg-black/30 backdrop-blur-sm" />

          <aside
            className="relative flex h-full w-[420px] flex-col overflow-hidden border-l border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[var(--sched-surface-rule)] bg-white px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--sched-graphite-strong)]">
                Configure schedule
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-[var(--sched-graphite)] hover:text-[var(--sched-graphite-strong)]"
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
    <IntelDockGate>
      <IntelDock
        reviewCount={computed?.diagnostics.length ?? 0}
        renderReview={({ wide }) => (
          <IntelDrawerContent
            draft={draft}
            computed={computed}
            selectedTask={selectedTaskCalc}
            nearCriticalFloat={nearCriticalFloat}
            dataQuality={dataQuality}
            mode={wide ? "wide" : "standard"}
          />
        )}
        renderChat={() => (
          <IntelChatPanel
            context={buildIntelScheduleContext({
              draft,
              computed,
              selectedTask: selectedTaskCalc,
              nearCriticalFloor: nearCriticalFloat,
            })}
          />
        )}
      />
    </IntelDockGate>
    <RightInspectorGate>
      <ActivityInspectorPanel
        draft={draft}
        computed={computed}
        calendars={calendars}
        selectedTaskId={selectedTaskId}
        onSelect={setSelectedTaskId}
        nearCriticalFloat={nearCriticalFloat}
      />
    </RightInspectorGate>
    <ProductModeOverlay />
    </SchedulerShell>
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

function statusFromPct(pct: number | undefined): {
  label: string;
  dot: string;
  text: string;
} {
  const p = pct ?? 0;
  if (p >= 100)
    return { label: "Complete", dot: "bg-[var(--sched-validated)]", text: "text-[var(--sched-validated)]" };
  if (p > 0)
    return { label: "In progress", dot: "bg-[var(--sched-graphite-strong)]", text: "text-[var(--sched-graphite-strong)]" };
  return { label: "Not started", dot: "bg-[var(--sched-graphite-soft)]", text: "text-[var(--sched-graphite)]" };
}

function InspectorTitleRow({
  t,
  name,
  wbs,
  calendarName,
  percentComplete,
  nearCriticalFloat,
  predCount,
  succCount,
  onClear,
}: {
  t: import("@/lib/scheduler/types").ScheduledTask;
  name: string;
  wbs?: string;
  calendarName?: string;
  percentComplete: number | undefined;
  nearCriticalFloat: number;
  predCount: number;
  succCount: number;
  onClear: () => void;
}) {
  const status = statusFromPct(percentComplete);
  const isCritical = t.isCritical;
  const isNearCrit =
    !isCritical && t.totalFloat > 0 && t.totalFloat <= nearCriticalFloat;
  return (
    <div className="flex items-center gap-3 border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-4 py-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${status.dot}`}
        title={status.label}
      />
      <span className="font-mono text-[11px] tabular-nums text-[var(--sched-graphite)]">
        {t.id}
      </span>
      <span className="text-[var(--sched-surface-rule)]">·</span>
      <span className="truncate text-[13px] font-semibold tracking-tight text-[var(--sched-graphite-strong)]">
        {name || "(unnamed activity)"}
      </span>
      {wbs ? (
        <span
          className="hidden shrink-0 rounded-sm border border-[var(--sched-surface-rule)] bg-white px-1.5 py-0.5 font-mono text-[10px] text-[var(--sched-graphite)] md:inline-block"
          title="WBS"
        >
          {wbs}
        </span>
      ) : null}
      {calendarName ? (
        <span
          className="hidden shrink-0 truncate text-[10px] text-[var(--sched-graphite)] md:inline-block"
          title="Calendar"
        >
          📅 {calendarName}
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
        <span className={`uppercase tracking-wide ${status.text}`}>
          {status.label}
          {percentComplete != null && percentComplete > 0 && percentComplete < 100
            ? ` · ${Math.round(percentComplete)}%`
            : ""}
        </span>
        <span className="text-[var(--sched-surface-rule)]">·</span>
        <span className="uppercase tracking-wide text-[var(--sched-graphite)]">
          {predCount} pred · {succCount} succ
        </span>
        <span className="text-[var(--sched-surface-rule)]">·</span>
        <span
          className="uppercase tracking-wide text-[var(--sched-graphite)]"
          title="Free float"
        >
          FF {t.freeFloat}d
        </span>
        <span className="text-[var(--sched-surface-rule)]">·</span>
        {isCritical ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--sched-critical-soft)] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--sched-critical)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sched-critical)]" />
            Critical · 0d
          </span>
        ) : isNearCrit ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--sched-near-critical-soft)] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--sched-near-critical)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sched-near-critical)]" />
            Near-crit · TF {t.totalFloat}d
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--sched-surface-rule-soft)] px-1.5 py-0.5 uppercase tracking-wide text-[var(--sched-graphite-strong)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sched-graphite-strong)]" />
            TF {t.totalFloat}d
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          className="ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--sched-graphite)] hover:bg-white hover:text-[var(--sched-graphite-strong)]"
          title="Clear selection"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ScheduleContextSummary({
  draft,
  computed,
  nearCriticalFloat,
  baselineActive,
  onSelect,
}: {
  draft: Draft;
  computed: import("@/lib/scheduler/types").ScheduleResult | null;
  nearCriticalFloat: number;
  baselineActive: boolean;
  onSelect: (id: string) => void;
}) {
  if (!computed) {
    return (
      <div className="py-4 text-center text-xs text-[var(--sched-graphite)]">
        Select an activity to inspect.
      </div>
    );
  }
  const critical = computed.tasks.filter((t) => t.isCritical);
  const nearCrit = computed.tasks
    .filter(
      (t) => !t.isCritical && t.totalFloat > 0 && t.totalFloat <= nearCriticalFloat,
    )
    .sort((a, b) => a.totalFloat - b.totalFloat);
  type DrivingTask = (typeof computed.tasks)[number];
  const drivingFinish = computed.tasks.reduce<DrivingTask | null>(
    (a, b) => (!a || b.earlyFinish > a.earlyFinish ? b : a),
    null,
  );

  // Quality / open-ends — pure read of existing draft data.
  const hasPred = new Set<string>();
  const hasSucc = new Set<string>();
  for (const d of draft.dependencies) {
    if (d.from) hasSucc.add(d.from);
    if (d.to) hasPred.add(d.to);
  }
  const startMilestones = computed.tasks.filter(
    (t) => !hasPred.has(t.id) && t.duration > 0,
  );
  const endMilestones = computed.tasks.filter(
    (t) => !hasSucc.has(t.id) && t.duration > 0,
  );
  const openEnds = startMilestones.length + endMilestones.length;
  const qualityTone: "critical" | "warn" | undefined =
    openEnds === 0 ? undefined : openEnds <= 2 ? "warn" : "critical";
  const qualityLabel =
    openEnds === 0
      ? "no open ends"
      : `${startMilestones.length} start · ${endMilestones.length} end`;

  return (
    <div className="grid grid-cols-12 gap-x-4 gap-y-3 text-[11px]">
      <SummaryMetric
        className="col-span-2"
        label="Project finish"
        value={computed.projectFinishDate ?? "—"}
        sub={`${computed.projectDuration}d · start ${draft.projectStartDate ?? "—"}`}
      />
      <SummaryMetric
        className="col-span-1"
        label="Data date"
        value={draft.dataDate ? draft.dataDate.slice(5) : "—"}
        sub={draft.dataDate ? draft.dataDate.slice(0, 4) : "not set"}
      />
      <SummaryMetric
        className="col-span-1"
        label="Activities"
        value={String(computed.tasks.length)}
        sub={`${draft.dependencies.length} links`}
      />
      <SummaryMetric
        className="col-span-2"
        label="Critical path"
        value={String(critical.length)}
        sub={
          computed.tasks.length
            ? `${Math.round((critical.length / computed.tasks.length) * 100)}% of plan`
            : "—"
        }
        tone="critical"
      />
      <SummaryMetric
        className="col-span-2"
        label={`Near-critical (≤${nearCriticalFloat}d)`}
        value={String(nearCrit.length)}
        sub={
          nearCrit.length
            ? `min float ${nearCrit[0]!.totalFloat}d`
            : "buffer healthy"
        }
        tone={nearCrit.length ? "warn" : undefined}
      />
      <SummaryMetric
        className="col-span-1"
        label="Baseline"
        value={baselineActive ? "On" : "—"}
        sub={baselineActive ? "Δ shown" : "none active"}
      />
      <SummaryMetric
        className="col-span-1"
        label="Quality"
        value={openEnds === 0 ? "OK" : String(openEnds)}
        sub={qualityLabel}
        tone={qualityTone}
      />
      <div className="col-span-2">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
          Driving path
        </div>
        {drivingFinish ? (
          <button
            type="button"
            onClick={() => onSelect(drivingFinish.id)}
            className="mt-0.5 block w-full truncate text-left text-[12px] font-semibold tabular-nums text-[var(--sched-graphite-strong)] hover:underline"
            title={drivingFinish.name}
          >
            {drivingFinish.name}
          </button>
        ) : (
          <div className="mt-0.5 text-[12px] text-[var(--sched-graphite)]">—</div>
        )}
        <div className="text-[10px] text-[var(--sched-graphite)]">
          → {drivingFinish?.earlyFinishDate ?? "—"}
        </div>
      </div>

      {nearCrit.length > 0 ? (
        <div className="col-span-12 border-t border-[var(--sched-surface-rule-soft)] pt-2">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
            Near-critical activities
          </div>
          <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 md:grid-cols-3">
            {nearCrit.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--sched-ivory)]"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sched-near-critical)]" />
                  <span className="font-mono text-[10px] text-[var(--sched-graphite)]">{t.id}</span>
                  <span className="flex-1 truncate text-[var(--sched-graphite-strong)]">{t.name}</span>
                  <span className="tabular-nums text-[10px] text-[var(--sched-near-critical)]">
                    {t.totalFloat}d
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SummaryMetric({
  className,
  label,
  value,
  sub,
  tone,
}: {
  className?: string;
  label: string;
  value: string;
  sub?: string;
  tone?: "critical" | "warn";
}) {
  const valueColor =
    tone === "critical"
      ? "text-[var(--sched-critical)]"
      : tone === "warn"
        ? "text-[var(--sched-near-critical)]"
        : "text-[var(--sched-graphite-strong)]";
  return (
    <div className={className}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
        {label}
      </div>
      <div className={`mt-0.5 text-[14px] font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub ? <div className="text-[10px] text-[var(--sched-graphite)]">{sub}</div> : null}
    </div>
  );
}

function InspectorDetails({
  t,
  draftTask,
  calendars,
  dataDate,
  predCount,
  succCount,
  codes,
  onChange,
}: {
  t: import("@/lib/scheduler/types").ScheduledTask;
  draftTask: Task;
  calendars: { id: string; name: string; isDefault: boolean }[];
  dataDate?: string;
  predCount: number;
  succCount: number;
  codes: { typeName: string; code: string; color: string | null }[];
  onChange: (patch: Partial<Task>) => void;
}) {
  const calName = draftTask.calendarId
    ? calendars.find((c) => c.id === draftTask.calendarId)?.name ?? "Unknown"
    : calendars.find((c) => c.isDefault)?.name ?? "Project default";

  // Data-date driven progress context (read-only — no engine change).
  let progressState: "future" | "inprogress" | "complete" | "behind" | null = null;
  if (dataDate && t.earlyStartDate && t.earlyFinishDate) {
    const pc = draftTask.percentComplete ?? 0;
    if (dataDate < t.earlyStartDate) progressState = "future";
    else if (pc >= 100) progressState = "complete";
    else if (dataDate > t.earlyFinishDate && pc < 100) progressState = "behind";
    else progressState = "inprogress";
  }
  const progressLabel: Record<NonNullable<typeof progressState>, string> = {
    future: "Not started",
    inprogress: "In progress",
    complete: "Complete",
    behind: "Behind data date",
  };
  const progressTone: Record<NonNullable<typeof progressState>, string> = {
    future: "bg-[var(--sched-surface-rule-soft)] text-[var(--sched-graphite-strong)]",
    inprogress: "bg-[var(--sched-near-critical-soft)] text-[var(--sched-near-critical)]",
    complete: "bg-[var(--sched-validated-soft)] text-[var(--sched-validated)]",
    behind: "bg-[var(--sched-critical-soft)] text-[var(--sched-critical)]",
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <div>
          <Label className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">
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
            <Label className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">Duration</Label>
            <Input
              type="number"
              min={0}
              className="h-8 text-sm"
              value={draftTask.duration}
              onChange={(e) => onChange({ duration: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">% Complete</Label>
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
            <Label className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">Start NET</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={draftTask.startNoEarlierThan ?? ""}
              onChange={(e) => onChange({ startNoEarlierThan: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">WBS</Label>
            <Input
              className="h-8 text-sm"
              value={draftTask.wbs ?? ""}
              onChange={(e) => onChange({ wbs: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] p-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wide text-[var(--sched-graphite)]">Calendar</span>
            <span className="truncate text-[var(--sched-graphite-strong)]">{calName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wide text-[var(--sched-graphite)]">Links</span>
            <span className="text-[var(--sched-graphite-strong)]">
              {predCount} pred · {succCount} succ
            </span>
          </div>
          {codes.length > 0 ? (
            <div className="col-span-2 flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[9px] uppercase tracking-wide text-[var(--sched-graphite)]">Codes</span>
              {codes.slice(0, 6).map((c, i) => (
                <span
                  key={`${c.typeName}-${i}`}
                  className="inline-flex items-center gap-1 rounded-sm border border-[var(--sched-surface-rule)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--sched-graphite-strong)]"
                  title={c.typeName}
                >
                  {c.color ? (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: c.color }}
                    />
                  ) : null}
                  {c.code}
                </span>
              ))}
              {codes.length > 6 ? (
                <span className="text-[10px] text-[var(--sched-graphite)]">+{codes.length - 6}</span>
              ) : null}
            </div>
          ) : null}
          {draftTask.description ? (
            <div className="col-span-2 truncate text-[10px] text-[var(--sched-graphite)]" title={draftTask.description}>
              📝 {draftTask.description}
            </div>
          ) : null}
        </div>
      </div>
      <div className="rounded-md border border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] p-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
            Date intelligence
          </div>
          <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-[var(--sched-graphite)]">
            <span>{draftTask.duration ?? 0}d</span>
            {progressState ? (
              <span
                className={`rounded-sm px-1.5 py-0.5 font-semibold uppercase tracking-wide ${progressTone[progressState]}`}
              >
                {progressLabel[progressState]}
              </span>
            ) : null}
          </div>
        </div>
        {dataDate ? (
          <div className="mt-1 text-[10px] text-[var(--sched-graphite)]">
            Data date <span className="tabular-nums text-[var(--sched-graphite)]">{dataDate}</span>
          </div>
        ) : null}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-[var(--sched-graphite-strong)]">
          <dt className="text-[var(--sched-graphite)]">Start (early)</dt>
          <dd className="text-right font-semibold tabular-nums text-[var(--sched-graphite-strong)]">
            {t.earlyStartDate ?? `d${t.earlyStart}`}
          </dd>
          <dt className="text-[var(--sched-graphite)]">Finish (early)</dt>
          <dd className="text-right font-semibold tabular-nums text-[var(--sched-graphite-strong)]">
            {t.earlyFinishDate ?? `d${t.earlyFinish}`}
          </dd>
          <dt className="text-[var(--sched-graphite)]">Late start</dt>
          <dd className="text-right font-medium tabular-nums text-[var(--sched-graphite)]">
            {t.lateStartDate ?? `d${t.lateStart}`}
          </dd>
          <dt className="text-[var(--sched-graphite)]">Late finish</dt>
          <dd className="text-right font-medium tabular-nums text-[var(--sched-graphite)]">
            {t.lateFinishDate ?? `d${t.lateFinish}`}
          </dd>
          {draftTask.startNoEarlierThan ? (
            <>
              <dt className="text-[var(--sched-graphite)]">Start NET</dt>
              <dd className="text-right font-medium tabular-nums text-[var(--sched-graphite)]">
                {draftTask.startNoEarlierThan}
              </dd>
            </>
          ) : null}
          <dt className="col-span-2 mt-1 border-t border-[var(--sched-surface-rule-soft)] pt-1" />
          <dt className="text-[var(--sched-graphite)]">Total float</dt>
          <dd
            className={`text-right font-semibold tabular-nums ${t.totalFloat <= 0 ? "text-[var(--sched-critical)]" : t.totalFloat <= 3 ? "text-[var(--sched-near-critical)]" : "text-[var(--sched-validated)]"}`}
          >
            {t.totalFloat}d
          </dd>
          <dt className="text-[var(--sched-graphite)]">Free float</dt>
          <dd className="text-right font-medium tabular-nums">{t.freeFloat}d</dd>
        </dl>
      </div>
    </div>
  );
}

function wouldCreateCycle(
  deps: Dependency[],
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  // Build adjacency excluding the candidate; then see if `to` already reaches `from`.
  const adj = new Map<string, string[]>();
  for (const d of deps) {
    if (!d.from || !d.to) continue;
    const arr = adj.get(d.from) ?? [];
    arr.push(d.to);
    adj.set(d.from, arr);
  }
  // DFS from `to` looking for `from`
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const nx of adj.get(n) ?? []) stack.push(nx);
  }
  return false;
}

function validateDep(
  deps: Dependency[],
  idx: number,
  tasks: Task[],
): string[] {
  const d = deps[idx];
  const errors: string[] = [];
  if (!d) return errors;
  const taskIds = new Set(tasks.map((t) => t.id));
  if (!d.from || !d.to) errors.push("Missing endpoint");
  if (d.from && !taskIds.has(d.from)) errors.push(`Unknown activity "${d.from}"`);
  if (d.to && !taskIds.has(d.to)) errors.push(`Unknown activity "${d.to}"`);
  if (d.from && d.to && d.from === d.to) errors.push("Self-link not allowed");
  // Duplicate (same from, to, type)
  const type = d.type ?? "FS";
  const dup = deps.some(
    (o, i) =>
      i !== idx &&
      o.from === d.from &&
      o.to === d.to &&
      (o.type ?? "FS") === type,
  );
  if (dup) errors.push("Duplicate link");
  // Cycle (consider all deps except this one)
  if (d.from && d.to && d.from !== d.to) {
    const others = deps.filter((_, i) => i !== idx);
    if (wouldCreateCycle(others, d.from, d.to)) errors.push("Creates cycle");
  }
  // Negative lag larger than predecessor duration is suspicious
  const fromTask = tasks.find((t) => t.id === d.from);
  if (typeof d.lag === "number" && d.lag < 0 && fromTask && -d.lag > (fromTask.duration ?? 0)) {
    errors.push("Lag exceeds predecessor duration");
  }
  return errors;
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

  const pickCandidate = (side: "pred" | "succ"): string | null => {
    for (const o of otherTasks) {
      const candidate: Dependency =
        side === "pred"
          ? { from: o.id, to: taskId, type: "FS", lag: 0 }
          : { from: taskId, to: o.id, type: "FS", lag: 0 };
      const probe = [...draft.dependencies, candidate];
      const errs = validateDep(probe, probe.length - 1, draft.tasks);
      if (errs.length === 0) return o.id;
    }
    return null;
  };

  const addLink = (side: "pred" | "succ") => {
    if (otherTasks.length === 0) {
      toast.error("Need another activity to link to");
      return;
    }
    const other = pickCandidate(side);
    if (!other) {
      toast.error("No valid activity available — all candidates would duplicate or cycle");
      return;
    }
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
    const errors = validateDep(draft.dependencies, di, draft.tasks);
    const hasError = errors.length > 0;
    return (
      <div key={di} className="py-0.5">
        <div className="flex items-center gap-1.5 text-xs">
          <Select
            value={otherId}
            onValueChange={(v) => updateDep(di, side === "pred" ? { from: v } : { to: v })}
          >
            <SelectTrigger
              className={`h-7 flex-1 text-xs ${hasError ? "border-[var(--sched-critical)] ring-1 ring-[var(--sched-critical)]/30" : ""}`}
            >
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
            title="Lag in working days (negative = lead)"
          />
          {driving ? (
            <span className="text-[10px] font-semibold text-[var(--sched-brass-deep)]" title="Driving">
              ★
            </span>
          ) : null}
          <button
            type="button"
            className="text-[var(--sched-critical)]"
            onClick={() => removeDep(di)}
            aria-label="Remove link"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {hasError ? (
          <div className="ml-1 mt-0.5 text-[10px] font-medium text-[var(--sched-critical)]">
            {errors.join(" · ")}
          </div>
        ) : null}
      </div>
    );
  };

  const allErrors = draft.dependencies
    .map((_, i) => validateDep(draft.dependencies, i, draft.tasks))
    .filter((e) => e.length > 0).length;

  return (
    <div className="space-y-3">
      {allErrors > 0 ? (
        <div className="rounded border border-[var(--sched-critical)]/30 bg-[var(--sched-critical-soft)] px-2 py-1 text-[11px] text-[var(--sched-critical)]">
          {allErrors} relationship issue{allErrors === 1 ? "" : "s"} — fix before saving to avoid CPM errors.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
            <span>Predecessors · {predRows.length}</span>
            <button
              type="button"
              onClick={() => addLink("pred")}
              className="text-[var(--sched-graphite-strong)] hover:underline"
            >
              + add
            </button>
          </div>
          {predRows.length === 0 ? (
            <div className="text-xs text-[var(--sched-graphite)]">No predecessors</div>
          ) : (
            predRows.map((r) => renderRow(r, "pred"))
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
            <span>Successors · {succRows.length}</span>
            <button
              type="button"
              onClick={() => addLink("succ")}
              className="text-[var(--sched-graphite-strong)] hover:underline"
            >
              + add
            </button>
          </div>
          {succRows.length === 0 ? (
            <div className="text-xs text-[var(--sched-graphite)]">No successors</div>
          ) : (
            succRows.map((r) => renderRow(r, "succ"))
          )}
        </div>
      </div>
      <div className="text-[10px] text-[var(--sched-graphite)]">
        FS = Finish-to-Start · SS = Start-to-Start · FF = Finish-to-Finish · SF = Start-to-Finish ·
        Lag in working days (negative = lead) · ★ = driving relationship
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
    <section className="overflow-hidden rounded-md border border-[var(--sched-surface-rule)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--sched-surface-rule-soft)] px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
          All dependencies · {draft.dependencies.length}
        </h3>
        <Button size="sm" variant="outline" onClick={addDep}>
          <Plus className="mr-1 h-3 w-3" /> Add dependency
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-[var(--sched-ivory)] text-[10px] uppercase tracking-wide text-[var(--sched-graphite)]">
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
            <tr key={idx} className="border-t border-[var(--sched-surface-rule-soft)]">
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
              <td colSpan={5} className="px-3 py-6 text-center text-[var(--sched-graphite)]">
                No dependencies yet. Click "Add dependency".
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

// ============================================================================
// Schedule Intelligence Drawer — deterministic, read-only review panel.
// No engine work, no AI. Pure derivations from current schedule data.
// ============================================================================
function IntelDrawerContent({
  draft,
  computed,
  selectedTask,
  nearCriticalFloat,
  dataQuality,
  mode = "standard",
}: {
  draft: import("@/lib/scheduler/types").Schedule | null;
  computed: import("@/lib/scheduler/types").ScheduleResult | null;
  selectedTask: import("@/lib/scheduler/types").ScheduledTask | null;
  nearCriticalFloat: number;
  dataQuality: string;
  mode?: "compact" | "standard" | "wide";
}) {
  if (!draft || !computed) {
    return (
      <div className="flex-1 overflow-auto p-4 text-[12px] text-[var(--sched-graphite)]">
        Load a schedule to see schedule intelligence.
      </div>
    );
  }

  const tasks = computed.tasks;
  const deps = computed.dependencies;
  const dataDate = draft.dataDate;

  const total = tasks.length;
  const critical = tasks.filter((t) => t.isCritical);
  const nearCritical = tasks.filter(
    (t) => !t.isCritical && t.totalFloat <= nearCriticalFloat && t.totalFloat > 0,
  );
  const inProgress = tasks.filter((t) => {
    const p = t.percentComplete ?? 0;
    return p > 0 && p < 100;
  });
  const completed = tasks.filter((t) => (t.percentComplete ?? 0) >= 100);
  const zeroFloat = tasks.filter((t) => t.totalFloat <= 0);
  const zeroDuration = tasks.filter((t) => t.duration === 0 && (t.percentComplete ?? 0) < 100);

  const hasPred = new Set(deps.map((d) => d.to));
  const hasSucc = new Set(deps.map((d) => d.from));
  const missingPred = tasks.filter((t, i) => !hasPred.has(t.id) && i > 0);
  const missingSucc = tasks.filter((t) => !hasSucc.has(t.id) && (t.percentComplete ?? 0) < 100);
  const missingDates = tasks.filter((t) => !t.earlyStartDate || !t.earlyFinishDate);
  const behindDataDate =
    dataDate && tasks.length > 0
      ? tasks.filter(
          (t) =>
            (t.percentComplete ?? 0) < 100 &&
            t.earlyStartDate &&
            t.earlyStartDate < dataDate,
        )
      : [];

  const criticalRatio = total > 0 ? critical.length / total : 0;
  const heavyCritical = criticalRatio > 0.4;
  const nearRatio = total > 0 ? nearCritical.length / total : 0;
  const selPct = selectedTask?.percentComplete ?? 0;
  const selStatus = selectedTask
    ? selPct >= 100
      ? "Complete"
      : selPct > 0
        ? `In progress (${selPct}%)`
        : "Not started"
    : "";


  // ---- Schedule Read (deterministic posture summary) ----
  const criticalLoad: "Low" | "Moderate" | "High" =
    criticalRatio > 0.4 ? "High" : criticalRatio > 0.2 ? "Moderate" : "Low";
  const nearExposure: "Low" | "Moderate" | "High" =
    nearRatio > 0.25 ? "High" : nearRatio > 0.1 ? "Moderate" : "Low";
  const logicIssueCount =
    missingPred.length +
    missingSucc.length +
    missingDates.length +
    zeroDuration.length;
  const logicStatus: "Clean" | "Needs review" =
    logicIssueCount === 0 ? "Clean" : "Needs review";
  const riskScore =
    (criticalLoad === "High" ? 2 : criticalLoad === "Moderate" ? 1 : 0) +
    (nearExposure === "High" ? 2 : nearExposure === "Moderate" ? 1 : 0) +
    (logicStatus === "Needs review" ? 1 : 0) +
    (behindDataDate.length > 0 ? 1 : 0);
  const posture: "Stable" | "Tight" | "Risky" =
    riskScore >= 4 ? "Risky" : riskScore >= 2 ? "Tight" : "Stable";

  // ---- Review First (prioritized deterministic issues) ----
  type Priority = {
    id: string;
    label: string;
    detail: string;
    severity: "high" | "med" | "low";
    count: number;
  };
  const priorities: Priority[] = [];
  if (heavyCritical) {
    priorities.push({
      id: "crit-concentration",
      label: "Critical path concentration",
      detail: `${critical.length} of ${total} activities are critical (${Math.round(criticalRatio * 100)}%). Logic may be over-constrained or durations aggressive.`,
      severity: "high",
      count: critical.length,
    });
  }
  if (behindDataDate.length > 0) {
    priorities.push({
      id: "behind-dd",
      label: "Behind data date",
      detail: `${behindDataDate.length} unfinished ${behindDataDate.length === 1 ? "activity has" : "activities have"} early-start before the data date. Review progress.`,
      severity: "high",
      count: behindDataDate.length,
    });
  }
  if (missingSucc.length > 0) {
    priorities.push({
      id: "missing-succ",
      label: "Missing successors",
      detail: `${missingSucc.length} open-ended ${missingSucc.length === 1 ? "activity" : "activities"}. Confirm downstream logic is intentional.`,
      severity: missingSucc.length > 5 ? "high" : "med",
      count: missingSucc.length,
    });
  }
  if (nearCritical.length > 0) {
    priorities.push({
      id: "near-crit",
      label: `Near-critical exposure (≤${nearCriticalFloat}d)`,
      detail: `${nearCritical.length} ${nearCritical.length === 1 ? "activity" : "activities"} could become critical with small slips.`,
      severity: nearExposure === "High" ? "high" : "med",
      count: nearCritical.length,
    });
  }
  if (missingPred.length > 0) {
    priorities.push({
      id: "missing-pred",
      label: "Missing predecessors",
      detail: `${missingPred.length} ${missingPred.length === 1 ? "activity" : "activities"} (excluding the first) without a predecessor. Review upstream ties.`,
      severity: "med",
      count: missingPred.length,
    });
  }
  if (zeroDuration.length > 0) {
    priorities.push({
      id: "zero-dur",
      label: "Zero-duration (non-milestone)",
      detail: `${zeroDuration.length} ${zeroDuration.length === 1 ? "activity" : "activities"} with zero duration. Mark as milestones or assign a duration.`,
      severity: "low",
      count: zeroDuration.length,
    });
  }

  // ---- Selected activity intelligence (drivers & driven) ----
  const selDrivenBy = selectedTask
    ? deps
        .filter((d) => d.to === selectedTask.id)
        .map((d) => ({ id: d.from, driving: d.isDriving }))
    : [];
  const selDrives = selectedTask
    ? deps
        .filter((d) => d.from === selectedTask.id)
        .map((d) => ({ id: d.to, driving: d.isDriving }))
    : [];
  const drivingPreds = selDrivenBy.filter((x) => x.driving);
  const drivenSuccs = selDrives.filter((x) => x.driving);
  const taskName = (id: string) => tasks.find((x) => x.id === id)?.name ?? "";

  const selWhyMatters = selectedTask
    ? selectedTask.isCritical
      ? "Sits on the critical path. Any slip here pushes the project finish by an equal amount, assuming downstream logic is unchanged."
      : selectedTask.totalFloat <= nearCriticalFloat
        ? `Near-critical with ${selectedTask.totalFloat}d of total float. Could become critical with a small slip.`
        : `Not currently controlling finish. Changes up to ${selectedTask.totalFloat} working days should not affect project finish, assuming downstream logic remains unchanged.`
    : "";
  const selRecommendation = selectedTask
    ? selectedTask.isCritical
      ? "Protect this activity. Track progress closely and resolve constraints first."
      : selectedTask.totalFloat <= nearCriticalFloat
        ? "Monitor closely. Reassess after the next update — float can erode quickly."
        : selPct >= 100
          ? "Complete. No action required from a critical-path standpoint."
          : "Lower priority for critical-path attention. Keep planned, but it is not driving finish today."
    : "";

  return (
    <div className="flex-1 overflow-auto text-[12px] leading-relaxed text-[var(--sched-graphite-strong)]">
      {/* ---- 1. SCHEDULE READ ---- */}
      <section className="border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sched-graphite)]">
            Schedule Read
          </h3>
          <PostureBadge value={posture} />
        </div>
        <div className="space-y-1">
          <IntelRow label="Project finish" value={computed.projectFinishDate ?? "—"} />
          <IntelRow label="Data date" value={dataDate ?? "—"} />
          <IntelRow
            label="Critical load"
            value={criticalLoad}
            tone={
              criticalLoad === "High" ? "danger" : criticalLoad === "Moderate" ? "warn" : "ok"
            }
          />
          <IntelRow
            label="Near-critical exposure"
            value={nearExposure}
            tone={
              nearExposure === "High" ? "danger" : nearExposure === "Moderate" ? "warn" : "ok"
            }
          />
          <IntelRow
            label="Logic review"
            value={logicStatus}
            tone={logicStatus === "Clean" ? "ok" : "warn"}
          />
        </div>
      </section>

      {/* ---- 2. REVIEW FIRST ---- */}
      <IntelSection title="Review First">
        {priorities.length === 0 ? (
          <div className="rounded border border-[var(--sched-validated-soft)] bg-[var(--sched-validated-soft)] p-2 text-[11px] text-[var(--sched-validated)]">
            No prioritized issues detected from current schedule data.
          </div>
        ) : (
          <ol className="space-y-1.5">
            {(mode === "compact" ? priorities.slice(0, 1) : priorities).map((p, i) => (
              <li
                key={p.id}
                className="rounded border border-[var(--sched-surface-rule-soft)] bg-white/70 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--sched-graphite-strong)] text-[9px] font-bold text-[var(--sched-brass-soft)]">
                      {i + 1}
                    </span>
                    <span className="text-[11.5px] font-medium text-[var(--sched-graphite-strong)]">
                      {p.label}
                    </span>
                  </div>
                  <SeverityChip severity={p.severity} />
                </div>
                <div className="mt-1 pl-6 text-[10.5px] text-[var(--sched-graphite)]">{p.detail}</div>
              </li>
            ))}
            {mode === "compact" && priorities.length > 1 ? (
              <li className="pl-1 text-[10px] text-[var(--sched-graphite)]">
                …{priorities.length - 1} more in Standard view
              </li>
            ) : null}
          </ol>
        )}
      </IntelSection>

      {mode === "compact" ? (
        <div className="px-3 pb-4 pt-2 text-[10px] uppercase tracking-wider text-[var(--sched-graphite-soft)]">
          Compact view · widen drawer for full review
        </div>
      ) : null}

      {mode !== "compact" ? (
        <div className="contents">


      {/* ---- 3. CRITICAL PATH ---- */}
      <IntelSection title="Critical Path">
        <IntelRow label="Critical activities" value={String(critical.length)} />
        <IntelRow label="Zero-float activities" value={String(zeroFloat.length)} />
        <IntelRow label="Finish date" value={computed.projectFinishDate ?? "—"} />
        {heavyCritical ? (
          <div className="mt-1 rounded border border-[var(--sched-brass-soft)] bg-[var(--sched-brass-soft)] p-2 text-[11px] text-[var(--sched-graphite)]">
            Review: more than 40% of activities are critical. Logic may be too
            tightly constrained or durations aggressive.
          </div>
        ) : null}
        {critical.length > 0 ? (
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-auto font-mono text-[10.5px] text-[var(--sched-graphite)]">
            {critical.slice(0, 12).map((t) => (
              <li key={t.id} className="truncate">
                {t.id} · <span className="font-sans">{t.name}</span>
              </li>
            ))}
            {critical.length > 12 ? (
              <li className="text-[var(--sched-graphite)]">…and {critical.length - 12} more</li>
            ) : null}
          </ul>
        ) : (
          <div className="text-[11px] text-[var(--sched-graphite)]">No critical activities detected.</div>
        )}
      </IntelSection>

      {/* ---- 4. NEAR-CRITICAL ---- */}
      <IntelSection title={`Near-Critical (≤${nearCriticalFloat}d)`}>
        {nearCritical.length === 0 ? (
          <div className="text-[11px] text-[var(--sched-graphite)]">No near-critical activities.</div>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto">
            {nearCritical.slice(0, 20).map((t) => (
              <li
                key={t.id}
                className="rounded border border-[var(--sched-surface-rule-soft)] bg-white/60 p-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] text-[var(--sched-graphite-strong)]">{t.id}</span>
                  <span className="text-[10px] text-[var(--sched-brass-deep)]">TF {t.totalFloat}d</span>
                </div>
                <div className="truncate text-[var(--sched-graphite-strong)]">{t.name}</div>
                <div className="flex items-center justify-between text-[10px] text-[var(--sched-graphite)]">
                  <span className="truncate">{t.wbs ?? "—"}</span>
                  <span>{t.earlyFinishDate ?? ""}</span>
                </div>
              </li>
            ))}
            {nearCritical.length > 20 ? (
              <li className="text-[10px] text-[var(--sched-graphite)]">
                …and {nearCritical.length - 20} more
              </li>
            ) : null}
          </ul>
        )}
      </IntelSection>

      {/* ---- 5. LOGIC REVIEW ---- */}
      <IntelSection title="Logic Review">
        <IntelReviewRow
          label="Missing predecessors"
          count={missingPred.length}
          hint="Activities (other than the first) without a predecessor. Review whether they should be tied to upstream work."
          sample={missingPred.slice(0, 5).map((t) => t.id)}
        />
        <IntelReviewRow
          label="Missing successors"
          count={missingSucc.length}
          hint="Open-ended activities. Check whether they should drive downstream work."
          sample={missingSucc.slice(0, 5).map((t) => t.id)}
        />
        <IntelReviewRow
          label="Missing dates"
          count={missingDates.length}
          hint="Activities without computed start/finish dates. Review schedule inputs."
          sample={missingDates.slice(0, 5).map((t) => t.id)}
        />
        <IntelReviewRow
          label="Zero-duration (non-milestone)"
          count={zeroDuration.length}
          hint="Potential issue: zero-duration activities not marked as milestones."
          sample={zeroDuration.slice(0, 5).map((t) => t.id)}
        />
        {dataDate ? (
          <IntelReviewRow
            label="Behind data date"
            count={behindDataDate.length}
            hint="Unfinished activities with early-start before the data date. Review progress and status."
            sample={behindDataDate.slice(0, 5).map((t) => t.id)}
          />
        ) : null}
      </IntelSection>

      {/* ---- 6. SELECTED ACTIVITY (if active) ---- */}
      {selectedTask ? (
        <IntelSection title="Selected Activity">
          <div className="space-y-2">
            <div className="font-mono text-[11px] text-[var(--sched-graphite-strong)]">
              {selectedTask.id} · <span className="font-sans">{selectedTask.name}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <MiniChip
                tone={
                  selectedTask.isCritical
                    ? "danger"
                    : selectedTask.totalFloat <= nearCriticalFloat
                      ? "warn"
                      : "ok"
                }
              >
                {selectedTask.isCritical
                  ? "Critical"
                  : selectedTask.totalFloat <= nearCriticalFloat
                    ? "Near-critical"
                    : "Non-critical"}
              </MiniChip>
              <MiniChip tone="neutral">{selStatus}</MiniChip>
              <MiniChip tone="neutral">TF {selectedTask.totalFloat}d</MiniChip>
              <MiniChip tone="neutral">FF {selectedTask.freeFloat}d</MiniChip>
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
                Why this matters
              </div>
              <div className="mt-1 text-[11px] text-[var(--sched-graphite-strong)]">{selWhyMatters}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
                  Driven by
                </div>
                {selDrivenBy.length === 0 ? (
                  <div className="mt-0.5 text-[10.5px] text-[var(--sched-graphite)]">No predecessors</div>
                ) : (
                  <ul className="mt-0.5 max-h-20 space-y-0.5 overflow-auto text-[10.5px]">
                    {selDrivenBy.slice(0, 6).map((d) => (
                      <li key={d.id} className="truncate">
                        <span
                          className={`font-mono ${d.driving ? "text-[var(--sched-critical)]" : "text-[var(--sched-graphite)]"}`}
                        >
                          {d.id}
                        </span>{" "}
                        <span className="text-[var(--sched-graphite)]">{taskName(d.id)}</span>
                      </li>
                    ))}
                    {selDrivenBy.length > 6 ? (
                      <li className="text-[var(--sched-graphite)]">…+{selDrivenBy.length - 6}</li>
                    ) : null}
                  </ul>
                )}
                {drivingPreds.length > 0 ? (
                  <div className="mt-0.5 text-[10px] text-[var(--sched-critical)]">
                    {drivingPreds.length} driving
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
                  Drives
                </div>
                {selDrives.length === 0 ? (
                  <div className="mt-0.5 text-[10.5px] text-[var(--sched-graphite)]">No successors</div>
                ) : (
                  <ul className="mt-0.5 max-h-20 space-y-0.5 overflow-auto text-[10.5px]">
                    {selDrives.slice(0, 6).map((d) => (
                      <li key={d.id} className="truncate">
                        <span
                          className={`font-mono ${d.driving ? "text-[var(--sched-critical)]" : "text-[var(--sched-graphite)]"}`}
                        >
                          {d.id}
                        </span>{" "}
                        <span className="text-[var(--sched-graphite)]">{taskName(d.id)}</span>
                      </li>
                    ))}
                    {selDrives.length > 6 ? (
                      <li className="text-[var(--sched-graphite)]">…+{selDrives.length - 6}</li>
                    ) : null}
                  </ul>
                )}
                {drivenSuccs.length > 0 ? (
                  <div className="mt-0.5 text-[10px] text-[var(--sched-critical)]">
                    {drivenSuccs.length} driving
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded border border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] p-2 text-[11px] text-[var(--sched-graphite)]">
              <span className="font-semibold text-[var(--sched-graphite-strong)]">Recommendation. </span>
              {selRecommendation}
            </div>
          </div>
        </IntelSection>
      ) : null}

      {mode === "wide" ? (
        <section className="border-t border-dashed border-[var(--sched-surface-rule)] bg-white/60 px-3 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sched-graphite)]">
            Builder workspace
          </h3>
          <div className="mt-1 text-[11px] text-[var(--sched-graphite)]">
            Reserved for AI / chat-assisted schedule building. No live behavior
            wired yet — use Standard for the current deterministic review.
          </div>
        </section>
      ) : null}

      <div className="px-3 pb-4 pt-2 text-[10px] uppercase tracking-wider text-[var(--sched-graphite-soft)]">
        {mode === "wide" ? "Standard review + reserved builder space" : "Deterministic review · derived from current schedule"}
      </div>
        </div>
      ) : null}


    </div>
  );
}

function PostureBadge({ value }: { value: "Stable" | "Tight" | "Risky" }) {
  const cls =
    value === "Risky"
      ? "border-[var(--sched-critical-soft)] bg-[var(--sched-critical-soft)] text-[var(--sched-critical)]"
      : value === "Tight"
        ? "border-[var(--sched-brass-soft)] bg-[var(--sched-brass-soft)] text-[var(--sched-graphite)]"
        : "border-[var(--sched-validated-soft)] bg-[var(--sched-validated-soft)] text-[var(--sched-validated)]";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {value}
    </span>
  );
}

function SeverityChip({ severity }: { severity: "high" | "med" | "low" }) {
  const cls =
    severity === "high"
      ? "border-[var(--sched-critical-soft)] bg-[var(--sched-critical-soft)] text-[var(--sched-critical)]"
      : severity === "med"
        ? "border-[var(--sched-brass-soft)] bg-[var(--sched-brass-soft)] text-[var(--sched-graphite)]"
        : "border-[var(--sched-graphite-soft)] bg-[var(--sched-surface-rule-soft)] text-[var(--sched-graphite)]";
  const label = severity === "high" ? "High" : severity === "med" ? "Med" : "Low";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function MiniChip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const cls =
    tone === "danger"
      ? "border-[var(--sched-critical-soft)] bg-[var(--sched-critical-soft)] text-[var(--sched-critical)]"
      : tone === "warn"
        ? "border-[var(--sched-brass-soft)] bg-[var(--sched-brass-soft)] text-[var(--sched-graphite)]"
        : tone === "ok"
          ? "border-[var(--sched-validated-soft)] bg-[var(--sched-validated-soft)] text-[var(--sched-validated)]"
          : "border-[var(--sched-surface-rule)] bg-white text-[var(--sched-graphite)]";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>
  );
}

function IntelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--sched-surface-rule-soft)] px-3 py-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sched-graphite)]">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function IntelRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-[var(--sched-critical)]"
      : tone === "warn"
        ? "text-[var(--sched-brass-deep)]"
        : tone === "ok"
          ? "text-[var(--sched-validated)]"
          : "text-[var(--sched-graphite-strong)]";
  return (
    <div className="flex items-center justify-between gap-3 text-[11.5px]">
      <span className="text-[var(--sched-graphite)]">{label}</span>
      <span className={`font-medium tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

function IntelReviewRow({
  label,
  count,
  hint,
  sample,
}: {
  label: string;
  count: number;
  hint: string;
  sample: string[];
}) {
  const tone = count === 0 ? "ok" : count > 5 ? "warn" : undefined;
  return (
    <div className="rounded border border-[var(--sched-surface-rule-soft)] bg-white/50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--sched-graphite-strong)]">{label}</span>
        <span
          className={`text-[11px] font-medium tabular-nums ${
            tone === "warn"
              ? "text-[var(--sched-brass-deep)]"
              : tone === "ok"
                ? "text-[var(--sched-validated)]"
                : "text-[var(--sched-graphite-strong)]"
          }`}
        >
          {count}
        </span>
      </div>
      {count > 0 ? (
        <>
          <div className="mt-1 text-[10.5px] text-[var(--sched-graphite)]">{hint}</div>
          {sample.length > 0 ? (
            <div className="mt-1 truncate font-mono text-[10px] text-[var(--sched-graphite)]">
              {sample.join(", ")}
              {count > sample.length ? ` …+${count - sample.length}` : ""}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * UI-2.1 — small adapter so EmptyScheduleState can trigger
 * "Build with AI" via SchedulerLayoutContext. Defined inside the route
 * file because the context only exists under <SchedulerShell />.
 */
function EmptyScheduleSlot(props: React.ComponentProps<typeof EmptyScheduleState>) {
  const { openBuildFull } = useSchedulerLayout();
  return <EmptyScheduleState {...props} onBuildWithAi={openBuildFull} />;
}

// =====================================================================
// PA-1 — Top-level product mode (Build | Schedule | Publish)
// =====================================================================

const PRODUCT_MODES = [
  { key: "build", label: "Build", caption: "Draft a CPM from scope" },
  { key: "schedule", label: "Schedule", caption: "CPM workhorse" },
  { key: "publish", label: "Publish", caption: "Reports & print" },
] as const;

function ProductModeSwitcher() {
  const { productMode, setProductMode } = useSchedulerLayout();
  return (
    <div
      role="tablist"
      aria-label="Scheduler mode"
      data-testid="product-mode-switcher"
      className="ml-2 hidden items-center gap-0.5 rounded-md border border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] p-0.5 md:inline-flex"
    >
      {PRODUCT_MODES.map((m) => {
        const active = productMode === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setProductMode(m.key)}
            title={m.caption}
            data-testid={`product-mode-${m.key}`}
            className={
              "rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors " +
              (active
                ? m.key === "build"
                  ? "bg-gradient-to-r from-[var(--sched-brass)] to-[var(--sched-brass-deep)] text-[var(--sched-graphite-strong)] shadow-[inset_0_0_0_1px_rgba(31,36,31,0.15)]"
                  : "bg-[var(--sched-graphite-strong)] text-[var(--sched-brass-soft)]"
                : "text-[var(--sched-graphite)] hover:bg-white hover:text-[var(--sched-graphite-strong)]")
            }
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/** Render the IntelDock only in Schedule mode. */
function IntelDockGate({ children }: { children: React.ReactNode }) {
  const { productMode } = useSchedulerLayout();
  if (productMode !== "schedule") return null;
  return <>{children}</>;
}

/** Full-screen overlay for Build and Publish modes. */
function ProductModeOverlay() {
  const { productMode, setProductMode } = useSchedulerLayout();
  if (productMode === "schedule") return null;
  return (
    <div
      className="fixed inset-y-0 right-0 z-40 flex flex-col bg-[var(--sched-ivory)] print:hidden"
      style={{ left: "var(--app-sidebar-w, 0px)" }}
      data-testid={`product-mode-overlay-${productMode}`}
    >

      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-[var(--sched-surface-rule)] bg-white/90 px-4 backdrop-blur">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">
          {productMode === "build" ? "Build Mode" : "Publish Mode"}
        </span>
        <ProductModeSwitcher />
        <button
          type="button"
          onClick={() => setProductMode("schedule")}
          className="ml-auto rounded border border-[var(--sched-surface-rule)] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--sched-graphite-strong)] hover:bg-[var(--sched-ivory)]"
          data-testid="product-mode-exit"
        >
          ← Back to Schedule
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {productMode === "build" ? (
          <IntelBuildWorkspace
            expanded
            onToggleExpanded={() => setProductMode("schedule")}
          />
        ) : (
          <PublishModeShell />
        )}
      </div>
    </div>
  );
}

const PUBLISH_REPORTS = [
  {
    key: "gantt-pdf",
    title: "Printable Gantt PDF",
    desc: "Full schedule or filtered slice with banner pages, legend, and signature block.",
  },
  {
    key: "owner-report",
    title: "Owner-facing schedule report",
    desc: "Branded Gantt with KPI summary and narrative copy for owner submissions.",
  },
  {
    key: "trailer-wall",
    title: "Trailer-wall schedule",
    desc: "Large-format landscape print, high-contrast, minimal chrome.",
  },
  {
    key: "lookahead",
    title: "Lookahead report",
    desc: "2-week, 3-week, or 6-week rolling windows from data date.",
  },
  {
    key: "critical-path",
    title: "Critical path report",
    desc: "Critical activities only, ladder layout with driving narrative.",
  },
  {
    key: "delay-narrative",
    title: "Delay / narrative report",
    desc: "Built from delay events, change-order flags, and AI-drafted narrative.",
  },
] as const;

function PublishModeShell() {
  return (
    <div
      className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]"
      data-testid="publish-mode-shell"
    >
      <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-[var(--sched-surface-rule-soft)] bg-white">
        <div className="shrink-0 border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">
            Report templates
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-2">
          {PUBLISH_REPORTS.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                disabled
                data-testid={`publish-report-${r.key}`}
                className="w-full cursor-not-allowed rounded border border-transparent px-2.5 py-2 text-left opacity-90 hover:border-[var(--sched-surface-rule-soft)] hover:bg-[var(--sched-ivory)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold tracking-tight text-[var(--sched-graphite-strong)]">
                    {r.title}
                  </span>
                  <span className="rounded bg-[var(--sched-surface-rule-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
                    Soon
                  </span>
                </div>
                <div className="mt-1 text-[11px] leading-snug text-[var(--sched-graphite)]">{r.desc}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 flex-col overflow-hidden rounded border border-[var(--sched-surface-rule-soft)] bg-white">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">
            Preview gallery
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--sched-graphite-soft)]">
            Rendering arrives in a later phase
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--sched-surface-rule-soft)] p-6">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {PUBLISH_REPORTS.map((r) => (
              <ReportThumbnail key={r.key} reportKey={r.key} title={r.title} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * High-end placeholder thumbnail for a publish report template.
 * Pure CSS — no PDF/render pipeline. Style varies subtly per report key.
 */
function ReportThumbnail({
  reportKey,
  title,
}: {
  reportKey: string;
  title: string;
}) {
  // Faux gantt bars — different layout per report style.
  const bars = (() => {
    switch (reportKey) {
      case "trailer-wall":
        return [70, 90, 60, 85, 75, 95, 80];
      case "lookahead":
        return [40, 55, 50, 60];
      case "critical-path":
        return [88, 92, 78, 95, 84];
      case "delay-narrative":
        return [55, 70, 45, 60];
      default:
        return [70, 50, 85, 60, 75, 45, 80];
    }
  })();
  const isCritical = reportKey === "critical-path" || reportKey === "delay-narrative";
  const accent = reportKey === "owner-report"
    ? "var(--sched-brass)"
    : isCritical
      ? "var(--sched-critical)"
      : "var(--sched-graphite-strong)";

  return (
    <figure className="group flex flex-col overflow-hidden rounded-sm border border-[var(--sched-surface-rule)] bg-white shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_20px_-12px_rgba(31,36,31,0.18)] transition hover:shadow-[0_2px_0_rgba(0,0,0,0.06),0_14px_28px_-12px_rgba(31,36,31,0.28)]">
      {/* Paper page */}
      <div className="relative aspect-[11/8.5] w-full overflow-hidden bg-white">
        {/* Page header band */}
        <div
          className="flex items-center justify-between px-3 py-2 text-[8px] font-semibold uppercase tracking-[0.22em]"
          style={{ background: accent, color: accent === "var(--sched-brass)" ? "var(--sched-graphite-strong)" : "var(--sched-brass-soft)" }}
        >
          <span className="truncate">{title}</span>
          <span className="opacity-70">AOS</span>
        </div>
        {/* Faux WBS column + gantt rows */}
        <div className="absolute inset-x-0 bottom-0 top-7 grid grid-cols-[28%_minmax(0,1fr)]">
          <div className="border-r border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-2 py-2 space-y-1.5">
            {bars.map((_, i) => (
              <div key={i} className="h-1.5 w-[85%] rounded-sm bg-[var(--sched-surface-rule)]" />
            ))}
          </div>
          <div className="relative px-2 py-2">
            {/* date tick header */}
            <div className="mb-1.5 flex gap-1 opacity-60">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-1 flex-1 rounded-sm bg-[var(--sched-surface-rule)]" />
              ))}
            </div>
            <div className="space-y-1.5">
              {bars.map((w, i) => (
                <div key={i} className="relative h-1.5 w-full">
                  <div
                    className="absolute h-1.5 rounded-sm"
                    style={{
                      left: `${(i * 4) % 35}%`,
                      width: `${w}%`,
                      background:
                        isCritical && i % 2 === 0
                          ? "var(--sched-critical)"
                          : i === bars.length - 1
                            ? "var(--sched-validated)"
                            : accent === "var(--sched-brass)"
                              ? "var(--sched-brass)"
                              : "var(--sched-graphite-strong)",
                      opacity: 0.85,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* watermark */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rotate-[-12deg] text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--sched-graphite-strong)]/[0.06]">
            Preview
          </span>
        </div>
      </div>
      <figcaption className="flex items-center justify-between gap-2 border-t border-[var(--sched-surface-rule-soft)] bg-[var(--sched-ivory)] px-3 py-2">
        <span className="truncate text-[11.5px] font-semibold tracking-tight text-[var(--sched-graphite-strong)]">
          {title}
        </span>
        <span className="rounded bg-[var(--sched-surface-rule-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)]">
          Soon
        </span>
      </figcaption>
    </figure>
  );
}


/**
 * PA-2 — Render the right-column ActivityInspectorPanel only in Schedule
 * mode. Also sets `--scheduler-right-pad` on the scheduler root via the
 * documentElement so the main work surface gets pushed left by the
 * appropriate amount and the fixed panel never covers schedule content.
 */
function RightInspectorGate({ children }: { children: React.ReactNode }) {
  const { productMode, inspectorOpen } = useSchedulerLayout();
  React.useEffect(() => {
    const pad = computeInspectorWidth({
      visible: productMode === "schedule",
      expanded: inspectorOpen,
    });
    document.documentElement.style.setProperty(
      "--scheduler-right-pad",
      `${pad}px`,
    );
    return () => {
      document.documentElement.style.removeProperty("--scheduler-right-pad");
    };
  }, [productMode, inspectorOpen]);
  if (productMode !== "schedule") return null;
  return <>{children}</>;
}

/**
 * PublishShortcut — replaces the old top-bar Print button. Routes the user
 * into Publish mode (the canonical output surface). No native print dialog;
 * Publish owns export/PDF in a later pass.
 */
function PublishShortcut({ disabled }: { disabled?: boolean }) {
  const { setProductMode } = useSchedulerLayout();
  return (
    <button
      type="button"
      onClick={() => setProductMode("publish")}
      disabled={disabled}
      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--sched-graphite)] hover:bg-[var(--sched-surface-rule-soft)] hover:text-[var(--sched-graphite-strong)] disabled:opacity-40"
      title="Open Publish mode — output, PDF, and report templates"
      data-testid="top-publish-shortcut"
    >
      ↗ Publish
    </button>
  );
}
