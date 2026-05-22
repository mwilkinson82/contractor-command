import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarClock, ArrowRight } from "lucide-react";
import {
  captureBaseline,
  listBaselines,
  loadBaseline,
} from "@/lib/scheduler/persistence.functions";
import { calculateSchedule } from "@/lib/scheduler/engine";
import type { ScheduleResult } from "@/lib/scheduler/types";

interface Props {
  scheduleId: string;
  dirty: boolean;
  dataDate?: string;
  computed: ScheduleResult | null;
  /** Called after a cycle is closed — should bump data date roughly one cycle. */
  onCycleClosed: (nextDataDate: string) => void;
}

const UPDATE_PREFIX = "Update ";

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function UpdateCyclePanel({
  scheduleId,
  dirty,
  dataDate,
  computed,
  onCycleClosed,
}: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listBaselines);
  const captureFn = useServerFn(captureBaseline);
  const loadFn = useServerFn(loadBaseline);

  const q = useQuery({
    queryKey: ["baselines", scheduleId],
    queryFn: () => listFn({ data: { scheduleId } }),
  });

  const updates = useMemo(() => {
    const all = q.data?.baselines ?? [];
    return all
      .filter((b) => b.name.startsWith(UPDATE_PREFIX))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [q.data]);

  const nextNumber = updates.length + 1;

  const closeMut = useMutation({
    mutationFn: async () => {
      if (!dataDate) throw new Error("Set a data date first");
      const name = `${UPDATE_PREFIX}${String(nextNumber).padStart(2, "0")} — ${dataDate}`;
      const notes = JSON.stringify({
        dataDate,
        finishDate: computed?.projectFinishDate,
        duration: computed?.projectDuration,
      });
      return captureFn({ data: { scheduleId, name, notes } });
    },
    onSuccess: () => {
      toast.success(`Update ${nextNumber} closed out`);
      qc.invalidateQueries({ queryKey: ["baselines", scheduleId] });
      if (dataDate) onCycleClosed(addDays(dataDate, 28));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Lazily compute finish-date trend for each update from the snapshot's notes
  type UpdateRow = {
    id: string;
    label: string;
    capturedAt: string;
    dataDate?: string;
    finishDate?: string;
    duration?: number;
  };

  const rows: UpdateRow[] = updates.map((u) => {
    let parsed: { dataDate?: string; finishDate?: string; duration?: number } = {};
    if (u.notes) {
      try {
        parsed = JSON.parse(u.notes);
      } catch {
        // legacy / freeform notes — ignore
      }
    }
    return {
      id: u.id,
      label: u.name.replace(UPDATE_PREFIX, ""),
      capturedAt: u.createdAt,
      dataDate: parsed.dataDate,
      finishDate: parsed.finishDate,
      duration: parsed.duration,
    };
  });

  const recomputeMut = useMutation({
    mutationFn: async (id: string) => {
      const { schedule } = await loadFn({ data: { id } });
      const r = calculateSchedule(schedule);
      return { id, finishDate: r.projectFinishDate, duration: r.projectDuration };
    },
    onSuccess: (res) => {
      toast.success(
        `${res.finishDate ?? "—"} · ${res.duration}d (recomputed from snapshot)`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baselineFinish = computed?.projectFinishDate;
  const firstUpdateFinish = rows[0]?.finishDate;
  const lastUpdateFinish = rows[rows.length - 1]?.finishDate;

  return (
    <section className="rounded border border-[#d8cdb8] bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
        <CalendarClock className="h-4 w-4" /> Update cycles
      </h2>
      <p className="mb-3 text-[11px] text-[#776e5e]">
        Close out each progress period — snapshots the schedule for trend tracking and slip reporting.
      </p>

      <div className="mb-3 rounded border border-[#eee7d8] bg-[#faf6ec] p-2 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-[#776e5e]">Next update</span>
          <span className="font-semibold text-[#1f241f]">#{String(nextNumber).padStart(2, "0")}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#776e5e]">Data date</span>
          <span className="font-mono text-[#1f241f]">{dataDate ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#776e5e]">Current finish</span>
          <span className="font-mono text-[#1f241f]">{baselineFinish ?? "—"}</span>
        </div>
      </div>

      <Button
        onClick={() => closeMut.mutate()}
        disabled={!dataDate || dirty || closeMut.isPending}
        className="w-full"
        size="sm"
        title={
          dirty
            ? "Save changes first"
            : !dataDate
              ? "Set a data date first"
              : ""
        }
      >
        Close out period {String(nextNumber).padStart(2, "0")}
      </Button>
      {dirty ? (
        <p className="mt-2 text-[11px] text-[#b42318]">
          Save your edits first — snapshots read from the database.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#675d4b]">
              History
            </h3>
            {firstUpdateFinish && lastUpdateFinish ? (
              <span className="text-[10px] text-[#776e5e]">
                {firstUpdateFinish} <ArrowRight className="inline h-3 w-3" /> {lastUpdateFinish}
              </span>
            ) : null}
          </div>
          <ul className="space-y-1">
            {rows
              .slice()
              .reverse()
              .map((r, idx, arr) => {
                const next = arr[idx - 1]; // newer (since we reversed)
                const slip =
                  r.duration !== undefined && next?.duration !== undefined
                    ? next.duration - r.duration
                    : null;
                return (
                  <li
                    key={r.id}
                    className="rounded border border-[#eee7d8] px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#1f241f]">{r.label}</span>
                      {slip !== null && slip !== 0 ? (
                        <span
                          className={`font-mono text-[10px] ${slip > 0 ? "text-[#b42318]" : "text-[#2f7a3e]"}`}
                        >
                          {slip > 0 ? "+" : ""}
                          {slip}d
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-[#776e5e]">
                      <span>Finish {r.finishDate ?? "—"} · {r.duration ?? "—"}d</span>
                      <button
                        type="button"
                        onClick={() => recomputeMut.mutate(r.id)}
                        className="underline-offset-2 hover:underline"
                      >
                        recompute
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
