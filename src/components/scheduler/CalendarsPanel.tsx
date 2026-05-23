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

/** Approximate working days per year given weekly bitmask + holiday ISO list (current year). */
function workingDaysPerYear(workDays: number, holidays: string[]): number {
  const year = new Date().getFullYear();
  let count = 0;
  const holidaySet = new Set(holidays);
  const d = new Date(year, 0, 1);
  while (d.getFullYear() === year) {
    // JS getDay: 0=Sun..6=Sat. Our mask: bit0=Mon..bit5=Sat,bit6=Sun.
    const js = d.getDay();
    const bit = js === 0 ? 6 : js - 1;
    const iso = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (workDays & (1 << bit) && !holidaySet.has(iso)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}


function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Nth weekday of a month, dow: 0=Sun..6=Sat. n=1..5; negative counts from end. */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  if (n > 0) {
    const first = new Date(year, month - 1, 1).getDay();
    const offset = (dow - first + 7) % 7;
    return iso(year, month, 1 + offset + (n - 1) * 7);
  }
  const lastDay = new Date(year, month, 0).getDate();
  const last = new Date(year, month - 1, lastDay).getDay();
  const offset = (last - dow + 7) % 7;
  return iso(year, month, lastDay - offset - (-n - 1) * 7);
}
/** Observed shift: Sat→Fri, Sun→Mon. */
function observed(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  if (dow === 6) return iso(y, m, d - 1);
  if (dow === 0) return iso(y, m, d + 1);
  return dateIso;
}
function usFederalHolidays(year: number): string[] {
  return [
    observed(iso(year, 1, 1)), // New Year's
    nthWeekday(year, 1, 1, 3), // MLK Day (3rd Mon Jan)
    nthWeekday(year, 2, 1, 3), // Presidents' Day (3rd Mon Feb)
    nthWeekday(year, 5, 1, -1), // Memorial Day (last Mon May)
    observed(iso(year, 6, 19)), // Juneteenth
    observed(iso(year, 7, 4)), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day (1st Mon Sep)
    nthWeekday(year, 10, 1, 2), // Columbus Day (2nd Mon Oct)
    observed(iso(year, 11, 11)), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving (4th Thu Nov)
    observed(iso(year, 12, 25)), // Christmas
  ];
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

  const dupeMut = useMutation({
    mutationFn: (c: { name: string; workDays: number; holidays: string[] }) =>
      saveFn({
        data: {
          scheduleId,
          name: `${c.name} copy`,
          workDays: c.workDays,
          holidays: c.holidays,
        },
      }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

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
                <span
                  className="rounded border border-[#d8cdb8] bg-white px-1.5 py-0.5 text-[10px] text-[#7a6a4d]"
                  title="Approx working days per year, accounting for weekly pattern and holidays"
                >
                  ~{workingDaysPerYear(c.workDays, c.holidays)}/yr
                </span>
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
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wide text-[#3554a5] hover:underline"
                  onClick={() => dupeMut.mutate(c)}
                >
                  Duplicate
                </button>

                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wide text-[#3554a5] hover:underline"
                  onClick={() => dupeMut.mutate(c)}
                >
                  Duplicate
                </button>
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
          <div className="flex flex-wrap items-center gap-1 border-t border-dashed border-[#e8ddc4] pt-1">
            <span className="text-[10px] uppercase tracking-wide text-[#7a6a4d]">Quick add:</span>
            <Input
              type="number"
              className="h-6 w-[70px] text-xs"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
            />
            <button
              type="button"
              className="rounded border border-[#d8cdb8] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#3d3527] hover:bg-[#eee6d7]"
              onClick={() => mergeDates(usFederalHolidays(year))}
            >
              US federal {year}
            </button>
            {holidays.length ? (
              <button
                type="button"
                className="ml-auto text-[10px] uppercase tracking-wide text-[#b42318] hover:underline"
                onClick={() => {
                  if (confirm("Clear all holidays?")) onChange([]);
                }}
              >
                Clear all
              </button>
            ) : null}
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
