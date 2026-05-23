import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listCalendars,
  saveCalendar,
  deleteCalendar,
  setDefaultCalendar,
} from "@/lib/scheduler/calendars.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  scheduleId: string;
  /** Called after the project default changes so the parent can re-load the schedule (which re-reads work_days/holidays). */
  onDefaultChanged?: () => void;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toggleBit(mask: number, bit: number): number {
  return mask ^ (1 << bit);
}

export function CalendarsPanel({ scheduleId, onDefaultChanged }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCalendars);
  const saveFn = useServerFn(saveCalendar);
  const delFn = useServerFn(deleteCalendar);
  const setDefaultFn = useServerFn(setDefaultCalendar);

  const { data } = useQuery({
    queryKey: ["calendars", scheduleId],
    queryFn: () => listFn({ data: { scheduleId } }),
  });

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftMask, setDraftMask] = useState(31);

  const refresh = () => qc.invalidateQueries({ queryKey: ["calendars", scheduleId] });

  const addMut = useMutation({
    mutationFn: () =>
      saveFn({ data: { scheduleId, name: draftName.trim(), workDays: draftMask, holidays: [] } }),
    onSuccess: () => {
      refresh();
      setDraftName("");
      setDraftMask(31);
      setAdding(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; name?: string; workDays?: number; holidays?: string[] }) =>
      saveFn({
        data: {
          id: v.id,
          scheduleId,
          name: v.name!,
          workDays: v.workDays!,
          holidays: v.holidays ?? [],
        },
      }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const promoteMut = useMutation({
    mutationFn: (id: string) => setDefaultFn({ data: { id } }),
    onSuccess: () => {
      refresh();
      onDefaultChanged?.();
      toast.success("Project default calendar updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cals = data?.calendars ?? [];

  return (
    <section className="rounded border border-[#d8cdb8] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
          Project calendars
        </h3>
        {!adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            + Calendar
          </Button>
        ) : null}
      </div>

      {cals.length === 0 && !adding ? (
        <p className="text-xs text-[#776e5e]">
          No named calendars yet. Add one (e.g. 6-day site calendar) and promote it to project
          default to drive schedule math.
        </p>
      ) : null}

      <ul className="space-y-2">
        {cals.map((c) => (
          <li key={c.id} className="rounded border border-[#eee7d8] bg-[#fbf8f0] p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <Input
                className="h-7 max-w-[160px] text-xs"
                value={c.name}
                onChange={(e) =>
                  updateMut.mutate({
                    id: c.id,
                    name: e.target.value,
                    workDays: c.workDays,
                    holidays: c.holidays,
                  })
                }
              />
              <div className="flex items-center gap-1">
                {c.isDefault ? (
                  <span className="rounded bg-[#1f241f] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-[10px] uppercase tracking-wide text-[#3554a5] hover:underline"
                    onClick={() => promoteMut.mutate(c.id)}
                  >
                    Set default
                  </button>
                )}
                {!c.isDefault ? (
                  <button
                    type="button"
                    className="text-[10px] uppercase tracking-wide text-[#b42318] hover:underline"
                    onClick={() => {
                      if (confirm(`Delete calendar "${c.name}"?`)) delMut.mutate(c.id);
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {DOW.map((d, i) => {
                const on = !!(c.workDays & (1 << i));
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      updateMut.mutate({
                        id: c.id,
                        name: c.name,
                        workDays: toggleBit(c.workDays, i),
                        holidays: c.holidays,
                      })
                    }
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      on
                        ? "bg-[#1f241f] text-white"
                        : "border border-[#d8cdb8] text-[#7a6a4d] hover:bg-[#eee6d7]"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <HolidaysEditor
              holidays={c.holidays}
              onChange={(next) =>
                updateMut.mutate({
                  id: c.id,
                  name: c.name,
                  workDays: c.workDays,
                  holidays: next,
                })
              }
            />
          </li>

        ))}
      </ul>

      {adding ? (
        <div className="mt-3 space-y-2 rounded border border-dashed border-[#d8cdb8] bg-white p-2">
          <Input
            className="h-7 text-xs"
            placeholder="Calendar name (e.g. 6-day site)"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {DOW.map((d, i) => {
              const on = !!(draftMask & (1 << i));
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDraftMask((m) => toggleBit(m, i))}
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                    on
                      ? "bg-[#1f241f] text-white"
                      : "border border-[#d8cdb8] text-[#7a6a4d] hover:bg-[#eee6d7]"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraftName("");
                setDraftMask(31);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draftName.trim() || addMut.isPending}
              onClick={() => addMut.mutate()}
            >
              {addMut.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-snug text-[#776e5e]">
        The default calendar drives lag math and any activity without a per-activity calendar.
        Activity-level calendars drive each activity's own duration walk.
      </p>
    </section>
  );
}

function HolidaysEditor({
  holidays,
  onChange,
}: {
  holidays: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const sorted = [...holidays].sort();

  const mergeDates = (extras: string[]) => {
    const set = new Set([...holidays, ...extras]);
    onChange([...set]);
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-[10px] uppercase tracking-wide text-[#3554a5] hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide" : "Edit"} holidays ({holidays.length})
      </button>
      {open ? (
        <div className="mt-1 space-y-1 rounded border border-dashed border-[#d8cdb8] bg-white p-2">
          <div className="flex gap-1">
            <Input
              type="date"
              className="h-7 text-xs"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!date || holidays.includes(date)}
              onClick={() => {
                onChange([...holidays, date]);
                setDate("");
              }}
            >
              Add
            </Button>
          </div>
          {sorted.length ? (
            <div className="flex flex-wrap gap-1">
              {sorted.map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1 rounded bg-[#eee6d7] px-1.5 py-0.5 text-[10px] text-[#3d3527]"
                >
                  {h}
                  <button
                    type="button"
                    className="text-[#b42318] hover:underline"
                    onClick={() => onChange(holidays.filter((x) => x !== h))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-[#7a6a4d]">No holidays yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
