import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { loadStructure, type WbsNode } from "@/lib/scheduler/structure.functions";

type Props = {
  scheduleId: string;
  value: string;
  onChange: (next: string) => void;
};

/** Flatten the WBS tree into "1.1 · Foundations"-style labels (the value we
 *  write back into Task.wbs, so the existing string-based grouping works). */
function flatten(nodes: WbsNode[]): { value: string; depth: number; node: WbsNode }[] {
  const byParent = new Map<string | null, WbsNode[]>();
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  const out: { value: string; depth: number; node: WbsNode }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of byParent.get(parent) ?? []) {
      out.push({ value: `${n.code} · ${n.name}`, depth, node: n });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function WbsSelect({ scheduleId, value, onChange }: Props) {
  const loadFn = useServerFn(loadStructure);
  const { data } = useQuery({
    queryKey: ["structure", scheduleId],
    queryFn: () => loadFn({ data: { scheduleId } }),
  });
  const options = useMemo(() => flatten(data?.wbs ?? []), [data]);

  return (
    <select
      className="h-8 w-40 rounded border border-input bg-background px-1 text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Assign WBS"
    >
      <option value="">— Unassigned —</option>
      {options.map((o) => (
        <option key={o.node.id} value={o.value}>
          {"\u00A0".repeat(o.depth * 2)}
          {o.value}
        </option>
      ))}
      {/* Preserve free-text value if it isn't in the WBS tree */}
      {value && !options.some((o) => o.value === value) ? (
        <option value={value}>{value} (free)</option>
      ) : null}
    </select>
  );
}
