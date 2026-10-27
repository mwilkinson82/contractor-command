import type { ScheduledTask } from "@/lib/scheduler/types";
import type { WbsNode } from "@/lib/scheduler/structure.functions";

export type CpmRow =
  | {
      kind: "group";
      key: string;
      label: string;
      depth: number;
      minES: number;
      maxEF: number;
      anyCritical: boolean;
      collapsed: boolean;
      taskCount: number;
    }
  | { kind: "task"; task: ScheduledTask; depth: number };

/** Percent complete is the legacy schedule's only recorded progress measure. */
export function cpmProgress(percentComplete?: number) {
  return Number.isFinite(percentComplete) ? Math.max(0, Math.min(100, percentComplete!)) : 0;
}

export const CPM_ACTUAL = "#2563eb";
export const CPM_REMAINING = "#16834a";
export const CPM_CRITICAL = "#c12d2d";

/** Build display rows without changing the underlying schedule or inventing WBS parents. */
export function buildCpmRows(
  tasks: ScheduledTask[],
  mode: "wbs" | "critical" | "none",
  nodes: WbsNode[],
  collapsed: Set<string> = new Set(),
): CpmRow[] {
  const rows: CpmRow[] = [];
  const sortedTasks = (ts: ScheduledTask[]) => [...ts].sort((a, b) => a.earlyStart - b.earlyStart);
  const group = (key: string, label: string, depth: number, ts: ScheduledTask[]) => {
    rows.push({
      kind: "group",
      key,
      label,
      depth,
      minES: Math.min(...ts.map((t) => t.earlyStart)),
      maxEF: Math.max(...ts.map((t) => t.earlyFinish)),
      anyCritical: ts.some((t) => t.isCritical),
      collapsed: collapsed.has(key),
      taskCount: ts.length,
    });
  };
  const flat = (input: ScheduledTask[], keyFor: (t: ScheduledTask) => string) => {
    const groups = new Map<string, ScheduledTask[]>();
    for (const t of input) {
      const key = keyFor(t);
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    for (const [label, ts] of [...groups].sort(
      (a, b) =>
        Math.min(...a[1].map((t) => t.earlyStart)) - Math.min(...b[1].map((t) => t.earlyStart)) ||
        a[0].localeCompare(b[0]),
    )) {
      const key = mode === "wbs" ? `flat:${label}` : label;
      group(key, label, 0, ts);
      if (!collapsed.has(key))
        for (const task of sortedTasks(ts)) rows.push({ kind: "task", task, depth: 1 });
    }
  };
  if (mode !== "wbs" || !nodes.length) {
    flat(tasks, (t) =>
      mode === "none"
        ? "All activities"
        : mode === "critical"
          ? t.isCritical
            ? "Critical path"
            : "Non-critical"
          : t.wbs?.trim() || "Unassigned",
    );
    return rows;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const labels = new Map<string, WbsNode[]>();
  for (const n of nodes) {
    const label = `${n.code} · ${n.name}`;
    labels.set(label, [...(labels.get(label) ?? []), n]);
  }
  // A missing parent or cycle is not evidence of a valid hierarchy.
  const valid = (node: WbsNode) => {
    const seen = new Set<string>();
    let current: WbsNode | undefined = node;
    while (current) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      if (current.parentId && !byId.has(current.parentId)) return false;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };
  const assigned = new Map<string, ScheduledTask[]>();
  const unmatched: ScheduledTask[] = [];
  for (const t of tasks) {
    const matches = labels.get(t.wbs?.trim() ?? "") ?? [];
    if (matches.length !== 1 || !valid(matches[0])) {
      unmatched.push(t);
      continue;
    }
    const id = matches[0].id;
    assigned.set(id, [...(assigned.get(id) ?? []), t]);
  }
  const children = new Map<string | null, WbsNode[]>();
  for (const n of nodes.filter(valid))
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  for (const list of children.values())
    list.sort(
      (a, b) => a.position - b.position || a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
    );
  const descendants = (n: WbsNode): ScheduledTask[] => [
    ...(assigned.get(n.id) ?? []),
    ...(children.get(n.id) ?? []).flatMap(descendants),
  ];
  const walk = (n: WbsNode, depth: number) => {
    const ts = descendants(n);
    if (!ts.length) return;
    const key = `wbs:${n.id}`;
    group(key, `${n.code} · ${n.name}`, depth, ts);
    if (collapsed.has(key)) return;
    for (const task of sortedTasks(assigned.get(n.id) ?? []))
      rows.push({ kind: "task", task, depth: depth + 1 });
    for (const child of children.get(n.id) ?? []) walk(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  flat(unmatched, (t) => t.wbs?.trim() || "Unassigned");
  return rows;
}
