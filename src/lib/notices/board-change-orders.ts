import type { ChangeLogPayload, ChangeRow } from "@/lib/mcp/change-orders";

/** One change order as the board's rows show it. Amounts are the contract total the customer saw, never cost. */
export type BoardCoRow = {
  id: string;
  number: string;
  title: string;
  state: ChangeRow["change_order_details"]["state"];
  status: string;
  tone: "approved" | "declined" | "waiting" | "neutral";
  amount: string | null;
  days: string;
  /** "Approved by Rosa Delgado on the client page · Nov 5, 2:14 PM" when a decision is recorded. */
  decision: string | null;
  /** The latest change on this change order, used to put fresh decisions on top. */
  changedAt: string | null;
};

const STATUS: Record<BoardCoRow["state"], { label: string; tone: BoardCoRow["tone"] }> = {
  draft: { label: "Draft", tone: "neutral" },
  priced: { label: "Priced", tone: "neutral" },
  submitted: { label: "Waiting on client", tone: "waiting" },
  approved: { label: "Approved", tone: "approved" },
  rejected: { label: "Declined", tone: "declined" },
  executed: { label: "Executed", tone: "approved" },
};

export const BOARD_CO_ROWS = 6;

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** "Rosa Delgado <rosa@example.com>" reads as "Rosa Delgado". */
export function decisionName(by: string | null | undefined): string | null {
  const name = (by ?? "").replace(/<[^>]*>/g, "").trim();
  return name || null;
}

export function decisionTime(at: string, timeZone?: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}

function daysText(days: number | null | undefined): string {
  if (typeof days !== "number" || !Number.isFinite(days)) return "Not set";
  if (days === 0) return "No time added";
  const abs = Math.abs(days);
  return `${days > 0 ? "+" : "−"}${abs} ${abs === 1 ? "day" : "days"}`;
}

/**
 * The board's change order rows from the change order log read (mcp_change_rows). A customer page decision updates
 * mcp_change_orders and mcp_change_history, which that read returns, so it shows here on the next refresh.
 */
export function boardCoRows(payload: ChangeLogPayload): BoardCoRow[] {
  const rows = payload.records.map((r): BoardCoRow => {
    const d = r.change_order_details;
    const status = STATUS[d.state] ?? { label: d.state, tone: "neutral" as const };
    const decided = d.state === "approved" || d.state === "rejected" || d.state === "executed";
    const decisionRecord = (r.history ?? []).find((h) => h.action === "approve" || h.action === "reject");
    const who = decisionName(d.decision?.by ?? decisionRecord?.snapshot?.decision?.by);
    const at = d.decision?.at ?? decisionRecord?.created_at ?? null;
    const channel = (d.decision as { channel?: string } | null | undefined)?.channel;
    const verb = d.state === "rejected" ? "Declined" : "Approved";
    const decision =
      decided && (who || at)
        ? [
            `${verb}${who ? ` by ${who}` : ""}${channel === "customer_page" ? " on the client page" : ""}`,
            at ? decisionTime(at, payload.time_zone) : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : null;
    const latest = (r.history ?? []).map((h) => h.created_at).sort().pop() ?? null;
    return {
      id: r.id,
      number: d.co_number || r.number,
      title: r.title,
      state: d.state,
      status: status.label,
      tone: status.tone,
      amount: typeof d.total_cents === "number" ? money(d.total_cents) : null,
      days: daysText(d.schedule_days),
      decision,
      changedAt: [latest, at].filter((x): x is string => !!x).sort().pop() ?? null,
    };
  });
  return rows.sort((a, b) => (b.changedAt ?? "").localeCompare(a.changedAt ?? "") || a.number.localeCompare(b.number));
}

export function coCounts(rows: BoardCoRow[]) {
  return {
    total: rows.length,
    waiting: rows.filter((r) => r.state === "submitted" || r.state === "priced").length,
    approved: rows.filter((r) => r.state === "approved" || r.state === "executed").length,
    declined: rows.filter((r) => r.state === "rejected").length,
  };
}
