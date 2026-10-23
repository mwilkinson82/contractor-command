import type { Sb } from "./guard";
import type { Job } from "./jobs";
import type { CardModel, CardSection } from "./cards/model";
import { dueOf, itemName } from "./open-feed";
import { formatBillingText } from "../report-format";
import { lookaheadAlert, type LaItem } from "./styled-views";

export type SavedLookaheadItem = {
  id: string; action: string; owner: string | null; due: string | null;
  status: string; severity: string | null; type: string | null;
  kind?: string | null; category?: string | null; check_key?: string | null;
};

/** Scoped, paged read. Includes closed items so the index count and detail agree. No file/export operation. */
export async function savedLookaheadItems(sb: Sb, job: Job, lookaheadId: string): Promise<SavedLookaheadItem[]> {
  const items: SavedLookaheadItem[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await sb.from("mcp_open_items")
      .select("id, action, accountable, owner, needed_by, due_date, status, severity, item_type, kind, category, check_key")
      .eq("job_id", job.job_id).eq("lookahead_id", lookaheadId)
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) items.push({
      id: row.id, action: formatBillingText(itemName(row.action)),
      owner: row.accountable ?? row.owner ?? null, due: dueOf(row) || null,
      status: row.status, severity: row.severity, type: row.item_type,
      kind: row.kind, category: row.category, check_key: row.check_key,
    });
    if (rows.length < 500) break;
  }
  return items.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.action.localeCompare(b.action));
}

export function savedItemsSection(ref: string, items: SavedLookaheadItem[], today: string): CardSection {
  return {
    heading: `${ref} · Saved items (all statuses)`, kind: "table",
    columns: ["Item", "Accountable", "Needed by", "Status"],
    rows: items.length ? items.map((item) => ({
      cells: [item.action, item.owner || "Needed", item.due || "Needed", item.status.replace(/_/g, " ")],
      refId: item.id,
      flag: item.status === "open" ? lookaheadAlert({ item, overdue: !!item.due && item.due < today }) ?? "callout" : null,
    })) : [{ cells: ["No saved items", "", "", ""] }],
  };
}

export function savedLookaheadCard(job: string, ref: string, items: SavedLookaheadItem[], today: string, context: CardSection[], jobOverdue: LaItem[] | null = null): CardModel {
  const open = items.filter((item) => item.status === "open");
  const overdue = open.filter((item) => item.due && item.due < today).length;
  return {
    state: "result", title: "14-day lookahead", show_state: false, job,
    kpis: [{ label: "Saved items", value: String(items.length) }, { label: "Open saved items", value: String(open.length) },
      { label: jobOverdue ? "Overdue on job" : "Overdue saved items", value: String(jobOverdue?.length ?? overdue), flag: (jobOverdue?.length ?? overdue) ? "overdue" : null }],
    sections: [...context, ...(jobOverdue ? [{
      heading: `Job overdue obligations · as of ${today}`, kind: "table" as const,
      columns: ["Item", "Accountable", "Needed by"],
      rows: jobOverdue.length ? jobOverdue.map((item) => ({ cells: [item.action, item.owner || "Needed", item.due || "Needed"], flag: "overdue" as const }))
        : [{ cells: ["None overdue", "", ""] }],
    }] : []), savedItemsSection(ref, items, today)],
  };
}
