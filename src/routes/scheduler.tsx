import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listSchedules,
  loadSchedule,
  saveSchedule,
  deleteSchedule,
} from "@/lib/scheduler/persistence.functions";
import { calculateSchedule } from "@/lib/scheduler/engine";
import type { Schedule } from "@/lib/scheduler/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/scheduler")({
  head: () => ({
    meta: [{ title: "Scheduler - AOS" }],
  }),
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

function SchedulerPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSchedules);
  const loadFn = useServerFn(loadSchedule);
  const saveFn = useServerFn(saveSchedule);
  const deleteFn = useServerFn(deleteSchedule);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");

  const listQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: () => listFn(),
  });

  const loadQuery = useQuery({
    queryKey: ["schedule", selectedId],
    queryFn: () => loadFn({ data: { id: selectedId! } }),
    enabled: !!selectedId,
  });

  const createMut = useMutation({
    mutationFn: (input: { name: string; projectStartDate?: string; sample?: boolean }) =>
      saveFn({
        data: {
          name: input.name,
          projectStartDate: input.projectStartDate || undefined,
          tasks: input.sample ? SAMPLE.tasks : [],
          dependencies: input.sample ? SAMPLE.dependencies : [],
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const result = loadQuery.data ? calculateSchedule(loadQuery.data.schedule) : null;

  return (
    <div className="min-h-screen bg-[#f7f4ed] px-4 py-8 text-[#1f241f] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7a6a4d]">
            CPM Scheduler
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Schedules</h1>
          <p className="mt-2 max-w-2xl text-sm text-[#5c574e]">
            Round-trip prototype: create a schedule, persist tasks/dependencies, reload, run CPM,
            delete.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left: list + create */}
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
                </div>
              </div>
            </section>

            <section className="rounded border border-[#d8cdb8] bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                My schedules
              </h2>
              {listQuery.isLoading ? (
                <p className="text-sm text-[#746b5c]">Loading…</p>
              ) : listQuery.error ? (
                <p className="text-sm text-red-600">{(listQuery.error as Error).message}</p>
              ) : listQuery.data?.schedules.length === 0 ? (
                <p className="text-sm text-[#746b5c]">No schedules yet.</p>
              ) : (
                <ul className="space-y-1">
                  {listQuery.data?.schedules.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => setSelectedId(s.id)}
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
          </aside>

          {/* Right: detail */}
          <main className="space-y-4">
            {!selectedId ? (
              <div className="rounded border border-dashed border-[#d8cdb8] bg-white/60 p-10 text-center text-sm text-[#746b5c]">
                Select a schedule, or create one to see the CPM calculation.
              </div>
            ) : loadQuery.isLoading ? (
              <p className="text-sm text-[#746b5c]">Loading schedule…</p>
            ) : loadQuery.error ? (
              <p className="text-sm text-red-600">{(loadQuery.error as Error).message}</p>
            ) : result && loadQuery.data ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3 rounded border border-[#d8cdb8] bg-white p-4">
                  <div>
                    <h2 className="text-xl font-semibold">{result.name}</h2>
                    <p className="text-xs text-[#746b5c]">
                      {result.tasks.length} tasks · {result.dependencies.length} dependencies
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm">
                      <div className="font-medium">Duration</div>
                      <div className="text-2xl font-semibold">{result.projectDuration}d</div>
                      {result.projectFinishDate ? (
                        <div className="text-xs text-[#746b5c]">
                          Finish {result.projectFinishDate}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (confirm("Delete this schedule?")) deleteMut.mutate(selectedId);
                      }}
                      disabled={deleteMut.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <section className="overflow-hidden rounded border border-[#d8cdb8] bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-[#eee6d7] text-xs uppercase tracking-wide text-[#675d4b]">
                      <tr>
                        <th className="px-3 py-2 text-left">ID</th>
                        <th className="px-3 py-2 text-left">Task</th>
                        <th className="px-3 py-2 text-right">Dur</th>
                        <th className="px-3 py-2 text-right">ES</th>
                        <th className="px-3 py-2 text-right">EF</th>
                        <th className="px-3 py-2 text-right">TF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.tasks.map((t) => (
                        <tr key={t.id} className="border-t border-[#eee7d8]">
                          <td
                            className={`px-3 py-2 ${
                              t.isCritical ? "font-semibold text-[#b42318]" : ""
                            }`}
                          >
                            {t.id}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{t.name}</div>
                            {t.wbs ? (
                              <div className="text-xs text-[#776e5e]">{t.wbs}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right">{t.duration}</td>
                          <td className="px-3 py-2 text-right">{t.earlyStart}</td>
                          <td className="px-3 py-2 text-right">{t.earlyFinish}</td>
                          <td
                            className={`px-3 py-2 text-right ${
                              t.isCritical ? "font-semibold text-[#b42318]" : ""
                            }`}
                          >
                            {t.totalFloat}
                          </td>
                        </tr>
                      ))}
                      {result.tasks.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-[#746b5c]">
                            Empty schedule. Editing UI lands in the next pass.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </section>

                <section className="rounded border border-[#d8cdb8] bg-white p-4 text-sm">
                  <div className="text-xs uppercase tracking-wide text-[#746b5c]">
                    Critical path
                  </div>
                  <div className="mt-1 font-mono text-xs">
                    {result.criticalPath.length > 0 ? result.criticalPath.join(" → ") : "—"}
                  </div>
                  {result.diagnostics.length > 0 ? (
                    <div className="mt-3 text-xs text-[#b42318]">
                      {result.diagnostics.join("; ")}
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
