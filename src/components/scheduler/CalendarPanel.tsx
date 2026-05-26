import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";

/**
 * Project calendar editor.
 * workDays bitmask: bit0=Mon, bit1=Tue, … bit5=Sat, bit6=Sun. Default 31 = M–F.
 */
const DAYS: { idx: number; label: string }[] = [
  { idx: 0, label: "Mon" },
  { idx: 1, label: "Tue" },
  { idx: 2, label: "Wed" },
  { idx: 3, label: "Thu" },
  { idx: 4, label: "Fri" },
  { idx: 5, label: "Sat" },
  { idx: 6, label: "Sun" },
];

interface Props {
  workDays: number;
  holidays: string[];
  onChange: (next: { workDays: number; holidays: string[] }) => void;
}

export function CalendarPanel({ workDays, holidays, onChange }: Props) {
  const [newHoliday, setNewHoliday] = useState("");

  const toggleDay = (idx: number) => {
    const next = workDays ^ (1 << idx);
    onChange({ workDays: next, holidays });
  };

  const preset = (mask: number) => onChange({ workDays: mask, holidays });

  const addHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newHoliday)) return;
    if (holidays.includes(newHoliday)) return;
    onChange({ workDays, holidays: [...holidays, newHoliday].sort() });
    setNewHoliday("");
  };

  const removeHoliday = (h: string) =>
    onChange({ workDays, holidays: holidays.filter((x) => x !== h) });

  const dayCount = DAYS.filter((d) => workDays & (1 << d.idx)).length;

  return (
    <section className="rounded border border-[var(--sched-surface-rule)] bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
        Calendar
      </h3>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-[var(--sched-graphite)]">
          Working days ({dayCount}/wk)
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded border border-[var(--sched-surface-rule)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--sched-surface-rule-soft)]"
            onClick={() => preset(31)}
          >
            5d
          </button>
          <button
            type="button"
            className="rounded border border-[var(--sched-surface-rule)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--sched-surface-rule-soft)]"
            onClick={() => preset(63)}
          >
            6d
          </button>
          <button
            type="button"
            className="rounded border border-[var(--sched-surface-rule)] px-1.5 py-0.5 text-[10px] hover:bg-[var(--sched-surface-rule-soft)]"
            onClick={() => preset(127)}
          >
            7d
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {DAYS.map((d) => {
          const on = !!(workDays & (1 << d.idx));
          return (
            <button
              key={d.idx}
              type="button"
              onClick={() => toggleDay(d.idx)}
              className={`rounded py-1 text-[10px] font-semibold uppercase ${
                on
                  ? "bg-[var(--sched-graphite-strong)] text-white"
                  : "border border-[var(--sched-surface-rule)] text-[var(--sched-graphite-soft)] hover:bg-[var(--sched-surface-rule-soft)]"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--sched-graphite)]">
        Holidays / weather days
      </div>
      <div className="mb-2 flex gap-2">
        <Input
          type="date"
          className="h-8"
          value={newHoliday}
          onChange={(e) => setNewHoliday(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={addHoliday} disabled={!newHoliday}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {holidays.length === 0 ? (
        <p className="text-[11px] text-[var(--sched-graphite)]">No non-working dates.</p>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {holidays.map((h) => (
            <li
              key={h}
              className="flex items-center justify-between rounded px-1.5 py-0.5 text-xs hover:bg-[var(--sched-surface-rule-soft)]"
            >
              <span className="font-mono">{h}</span>
              <button
                type="button"
                onClick={() => removeHoliday(h)}
                className="text-[var(--sched-graphite-soft)] hover:text-[var(--sched-critical)]"
                aria-label="Remove holiday"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
