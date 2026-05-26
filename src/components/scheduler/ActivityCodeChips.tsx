import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { loadStructure, assignTaskCode } from "@/lib/scheduler/structure.functions";

type Props = {
  scheduleId: string;
  taskId: string;
};

/** Per-task activity-code assignment. One value per code type. */
export function ActivityCodeChips({ scheduleId, taskId }: Props) {
  const qc = useQueryClient();
  const loadFn = useServerFn(loadStructure);
  const assignFn = useServerFn(assignTaskCode);

  const { data } = useQuery({
    queryKey: ["structure", scheduleId],
    queryFn: () => loadFn({ data: { scheduleId } }),
  });

  const mut = useMutation({
    mutationFn: (v: { typeId: string; valueId: string | null }) =>
      assignFn({ data: { scheduleId, taskId, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["structure", scheduleId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const types = data?.codeTypes ?? [];
  if (types.length === 0) {
    return (
      <p className="text-xs text-[var(--sched-graphite)]">
        Define activity-code types in the Structure panel to tag activities.
      </p>
    );
  }

  const assigned = new Map<string, string>(); // typeId -> valueId
  for (const a of data?.assignments ?? []) {
    if (a.taskId === taskId) assigned.set(a.typeId, a.valueId);
  }

  return (
    <div className="space-y-2">
      {types.map((t) => {
        const currentValueId = assigned.get(t.id) ?? "";
        const current = t.values.find((v) => v.id === currentValueId);
        return (
          <div key={t.id} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 truncate font-mono uppercase tracking-wider text-[var(--sched-graphite)]">
              {t.name}
            </span>
            <select
              className="h-7 flex-1 rounded border border-input bg-background px-1 text-xs"
              value={currentValueId}
              onChange={(e) =>
                mut.mutate({
                  typeId: t.id,
                  valueId: e.target.value === "" ? null : e.target.value,
                })
              }
            >
              <option value="">—</option>
              {t.values.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code}
                  {v.description ? ` · ${v.description}` : ""}
                </option>
              ))}
            </select>
            {current?.color ? (
              <span
                className="inline-block h-3 w-3 rounded-sm border border-black/10"
                style={{ background: current.color }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
