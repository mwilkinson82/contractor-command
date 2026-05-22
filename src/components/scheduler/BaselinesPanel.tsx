import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Camera } from "lucide-react";
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

export function BaselinesPanel({
  scheduleId,
  comparisonId,
  onComparisonChange,
  dirty,
}: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listBaselines);
  const captureFn = useServerFn(captureBaseline);
  const deleteFn = useServerFn(deleteBaseline);

  const [name, setName] = useState("");

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

  return (
    <section className="rounded border border-[#d8cdb8] bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
        Baselines
      </h3>
      <div className="mb-3 flex gap-2">
        <Input
          className="h-8"
          placeholder="Baseline name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => captureMut.mutate()}
          disabled={captureMut.isPending || dirty}
          title={dirty ? "Save changes before capturing a baseline" : ""}
        >
          <Camera className="mr-1 h-4 w-4" /> Capture
        </Button>
      </div>
      {dirty ? (
        <p className="mb-2 text-[11px] text-[#b42318]">
          Save your edits first — baselines snapshot what is in the database.
        </p>
      ) : null}

      {q.isLoading ? (
        <p className="text-xs text-[#746b5c]">Loading…</p>
      ) : (q.data?.baselines.length ?? 0) === 0 ? (
        <p className="text-xs text-[#746b5c]">No baselines yet.</p>
      ) : (
        <ul className="space-y-1">
          {q.data?.baselines.map((b) => {
            const isActive = comparisonId === b.id;
            return (
              <li
                key={b.id}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
                  isActive ? "bg-[#1f241f] text-white" : "hover:bg-[#eee6d7]"
                }`}
              >
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => onComparisonChange(isActive ? null : b.id)}
                >
                  <div className="text-sm font-medium">{b.name}</div>
                  <div
                    className={`text-[11px] ${
                      isActive ? "text-white/70" : "text-[#776e5e]"
                    }`}
                  >
                    {new Date(b.createdAt).toLocaleString()}
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={isActive ? "text-white hover:text-white" : ""}
                  onClick={() => {
                    if (confirm(`Delete baseline "${b.name}"?`)) delMut.mutate(b.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {comparisonId ? (
        <p className="mt-3 text-[11px] text-[#5c574e]">
          Gantt is showing baseline as a tan ghost bar below each activity. Slip days appear
          next to each label.
        </p>
      ) : null}
    </section>
  );
}
