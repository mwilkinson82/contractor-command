import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trash2, Camera, ChevronDown } from "lucide-react";
import {
  captureBaseline,
  deleteBaseline,
  listBaselines,
} from "@/lib/scheduler/persistence.functions";

interface Props {
  scheduleId: string;
  comparisonId: string | null;
  onComparisonChange: (id: string | null) => void;
  dirty: boolean;
}

/**
 * Compact toolbar control. Renders as a small button that opens a popover
 * containing the baseline list and capture form. Does NOT render a floating
 * card over the workbench.
 */
export function BaselinesPanel({ scheduleId, comparisonId, onComparisonChange, dirty }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listBaselines);
  const captureFn = useServerFn(captureBaseline);
  const deleteFn = useServerFn(deleteBaseline);

  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["baselines", scheduleId],
    queryFn: () => listFn({ data: { scheduleId } }),
  });

  const captureMut = useMutation({
    mutationFn: () =>
      captureFn({
        data: {
          scheduleId,
          name: name || `Baseline ${new Date().toLocaleDateString()}`,
        },
      }),
    onSuccess: () => {
      toast.success("Baseline captured");
      setName("");
      qc.invalidateQueries({ queryKey: ["baselines", scheduleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (_res, id) => {
      toast.success("Baseline removed");
      if (comparisonId === id) onComparisonChange(null);
      qc.invalidateQueries({ queryKey: ["baselines", scheduleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baselines = q.data?.baselines ?? [];
  const active = baselines.find((b) => b.id === comparisonId);
  const label = active ? active.name : "Baseline";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#e6dfd0] bg-white px-2 text-[11px] font-medium text-[#3d3527] hover:bg-[var(--sched-ivory)]"
          title="Baselines"
        >
          <span className="inline-block h-2 w-2 rounded-sm bg-[#c7b89d]" />
          <span className="max-w-[140px] truncate">{label}</span>
          <ChevronDown className="h-3 w-3 text-[#9c8b6e]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#7a6a4d]">
          Baselines
        </div>
        <div className="mb-2 flex gap-1.5">
          <Input
            className="h-7 text-xs"
            placeholder="Baseline name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => captureMut.mutate()}
            disabled={captureMut.isPending || dirty}
            title={dirty ? "Save changes before capturing a baseline" : ""}
            className="h-7 px-2"
          >
            <Camera className="mr-1 h-3 w-3" /> Capture
          </Button>
        </div>
        {dirty ? (
          <p className="mb-2 text-[10px] text-[var(--sched-critical)]">
            Save your edits first — baselines snapshot what is in the database.
          </p>
        ) : null}

        {q.isLoading ? (
          <p className="text-xs text-[#746b5c]">Loading…</p>
        ) : baselines.length === 0 ? (
          <p className="text-xs text-[#746b5c]">No baselines yet.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-auto">
            {baselines.map((b) => {
              const isActive = comparisonId === b.id;
              return (
                <li
                  key={b.id}
                  className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
                    isActive ? "bg-[var(--sched-graphite-strong)] text-white" : "hover:bg-[#eee6d7]"
                  }`}
                >
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => onComparisonChange(isActive ? null : b.id)}
                  >
                    <div className="text-xs font-medium">{b.name}</div>
                    <div className={`text-[10px] ${isActive ? "text-white/70" : "text-[#776e5e]"}`}>
                      {new Date(b.createdAt).toLocaleString()}
                    </div>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-6 w-6 p-0 ${isActive ? "text-white hover:text-white" : ""}`}
                    onClick={() => {
                      if (confirm(`Delete baseline "${b.name}"?`)) delMut.mutate(b.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {comparisonId ? (
          <p className="mt-2 text-[10px] text-[#5c574e]">
            Gantt shows the baseline as a tan ghost bar with slip days.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
