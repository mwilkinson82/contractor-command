import type { Schedule, ScheduleResult } from "./types";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportScheduleCsv(
  draft: Schedule | null | undefined,
  computed: ScheduleResult | null | undefined,
) {
  if (!draft || !computed) return;
  const headers = [
    "Activity ID",
    "Activity Name",
    "WBS",
    "Duration",
    "% Complete",
    "Early Start",
    "Early Finish",
    "Late Start",
    "Late Finish",
    "Total Float",
    "Critical",
    "Resource",
    "Budget Cost",
    "Actual Cost",
  ];
  const lines = [headers.join(",")];
  const map = new Map(computed.tasks.map((t) => [t.id, t]));
  for (const t of draft.tasks) {
    const c = map.get(t.id);
    lines.push(
      [
        t.id,
        t.name,
        t.wbs ?? "",
        t.duration,
        t.percentComplete ?? 0,
        c?.earlyStartDate ?? "",
        c?.earlyFinishDate ?? "",
        c?.lateStartDate ?? "",
        c?.lateFinishDate ?? "",
        c?.totalFloat ?? "",
        c?.isCritical ? "Y" : "",
        t.resourceName ?? "",
        t.budgetCost ?? "",
        t.actualCost ?? "",
      ]
        .map(esc)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (draft.name || "schedule").replace(/[^a-z0-9-_]+/gi, "_");
  a.download = `${safe}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
