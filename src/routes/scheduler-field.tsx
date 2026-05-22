import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listSchedules,
  loadSchedule,
  saveSchedule,
} from "@/lib/scheduler/persistence.functions";
import { calculateSchedule } from "@/lib/scheduler/engine";
import type { Schedule, Task } from "@/lib/scheduler/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, Calendar } from "lucide-react";

export const Route = createFileRoute("/scheduler-field")({
  head: () => ({ meta: [{ title: "Field Update - AOS" }] }),
  component: FieldUpdatePage,
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function FieldUpdatePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSchedules);
  const loadFn = useServerFn(loadSchedule);
  const saveFn = useServerFn(saveSchedule);

  const [activeId, setActiveId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["schedules"],
    queryFn: () => listFn(),
  });

  const loaded = useQuery({
    enabled: !!activeId,
    queryKey: ["schedule", activeId],
    queryFn: () => loadFn({ data: { id: activeId! } }),
  });

  const save = useMutation({
    mutationFn: (sch: Schedule) =>
      saveFn({
        data: {
          id: sch.id,
          name: sch.name,
          projectStartDate: sch.projectStartDate ?? null,
          dataDate: sch.dataDate ?? null,
          workDays: sch.calendar?.workDays ?? 31,
          holidays: sch.calendar?.holidays ?? [],
          annotations: sch.annotations ?? [],
          tasks: sch.tasks.map((t) => ({
            id: t.id,
            name: t.name,
            duration: t.duration,
            wbs: t.wbs ?? null,
            description: t.description ?? null,
            percentComplete: t.percentComplete ?? null,
            budgetCost: t.budgetCost ?? null,
            actualCost: t.actualCost ?? null,
            resourceName: t.resourceName ?? null,
            resourceUnitsPerDay: t.resourceUnitsPerDay ?? null,
            startNoEarlierThan: t.startNoEarlierThan ?? null,
          })),
          dependencies: sch.dependencies.map((d) => ({
            from: d.from,
            to: d.to,
            type: d.type,
            lag: d.lag,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Field update saved");
      qc.invalidateQueries({ queryKey: ["schedule", activeId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!activeId) {
    return (
      <div className="min-h-screen bg-[#f5f0e2] px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold text-[#1f241f]">Field Update</h1>
        <p className="mb-4 text-sm text-[#776e5e]">
          Pick a schedule to update from the field.
        </p>
        {list.isLoading ? (
          <p className="text-sm text-[#776e5e]">Loading…</p>
        ) : (list.data?.schedules ?? []).length === 0 ? (
          <p className="text-sm text-[#776e5e]">No schedules yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.data!.schedules.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setActiveId(s.id)}
                  className="block w-full rounded border border-[#d8cdb8] bg-white px-4 py-3 text-left active:bg-[#eee6d7]"
                >
                  <div className="font-medium text-[#1f241f]">{s.name}</div>
                  <div className="mt-1 text-xs text-[#776e5e]">
                    Updated {new Date(s.updatedAt).toLocaleDateString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6">
          <Link to="/scheduler" className="text-sm text-[#776e5e] underline">
            Back to full scheduler
          </Link>
        </div>
      </div>
    );
  }

  if (loaded.isLoading || !loaded.data) {
    return (
      <div className="min-h-screen bg-[#f5f0e2] px-4 py-6 text-sm text-[#776e5e]">
        Loading schedule…
      </div>
    );
  }

  return (
    <FieldUpdateActive
      schedule={loaded.data.schedule}
      onBack={() => setActiveId(null)}
      onSave={(s) => save.mutate(s)}
      saving={save.isPending}
    />
  );
}

function FieldUpdateActive({
  schedule,
  onBack,
  onSave,
  saving,
}: {
  schedule: Schedule;
  onBack: () => void;
  onSave: (s: Schedule) => void;
  saving: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>(schedule.tasks);
  const [dataDate, setDataDate] = useState<string>(schedule.dataDate ?? todayIso());

  const result = useMemo(
    () =>
      calculateSchedule({
        ...schedule,
        tasks,
        dataDate,
      }),
    [schedule, tasks, dataDate],
  );

  // Show in-progress + upcoming (next 14 working days), hide completed
  const visible = useMemo(() => {
    return result.tasks
      .filter((t) => (t.percentComplete ?? 0) < 100)
      .sort((a, b) => a.earlyStart - b.earlyStart)
      .slice(0, 30);
  }, [result]);

  function patch(id: string, p: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }

  return (
    <div className="min-h-screen bg-[#f5f0e2]">
      <header className="sticky top-0 z-10 border-b border-[#d8cdb8] bg-[#f5f0e2]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 text-[#1f241f]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Schedules
          </Button>
        </div>
        <h1 className="mt-1 text-lg font-semibold text-[#1f241f]">{schedule.name}</h1>
        <div className="mt-2 flex items-center gap-2 text-xs text-[#776e5e]">
          <Calendar className="h-3.5 w-3.5" />
          <span>Data date</span>
          <input
            type="date"
            value={dataDate}
            onChange={(e) => setDataDate(e.target.value)}
            className="rounded border border-[#d8cdb8] bg-white px-2 py-1 text-xs"
          />
          <Button
            size="sm"
            onClick={() =>
              onSave({
                ...schedule,
                tasks,
                dataDate,
              })
            }
            disabled={saving}
            className="ml-auto"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <main className="px-4 py-3 pb-24">
        {visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#776e5e]">
            All activities complete.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((t) => {
              const pct = t.percentComplete ?? 0;
              return (
                <li
                  key={t.id}
                  className="rounded border border-[#d8cdb8] bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#1f241f]">
                        {t.id} · {t.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#776e5e]">
                        {t.wbs ? `${t.wbs} · ` : ""}
                        {t.duration}d
                        {t.earlyStartDate ? ` · plan ${t.earlyStartDate} → ${t.earlyFinishDate}` : ""}
                        {t.isCritical ? " · CRITICAL" : ""}
                      </div>
                    </div>
                    {pct === 100 ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-[#2f7a3e]" />
                    ) : null}
                  </div>

                  {/* Quick % chips */}
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {[0, 25, 50, 75, 100].map((v) => (
                      <button
                        key={v}
                        onClick={() => patch(t.id, { percentComplete: v })}
                        className={`rounded border px-2 py-2 text-xs font-medium transition-colors ${
                          pct === v
                            ? "border-[#1f241f] bg-[#1f241f] text-white"
                            : "border-[#d8cdb8] bg-white text-[#1f241f] active:bg-[#eee6d7]"
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>

                  {/* Fine slider */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={pct}
                    onChange={(e) =>
                      patch(t.id, { percentComplete: Number(e.target.value) })
                    }
                    className="mt-3 w-full accent-[#1f241f]"
                  />
                  <div className="mt-1 text-right text-[11px] text-[#776e5e]">
                    {pct}% complete
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
