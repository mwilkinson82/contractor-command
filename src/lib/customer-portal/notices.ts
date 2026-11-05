// What the team hears about a customer's action on their page: one job notice per decision or message
// (src/lib/notices/send.ts). Titles name the customer and the item; facts carry only what the customer saw (price,
// amount due, days, the package), never cost, markup or fees.
import type { JobNoticeInput } from "../notices/send";
import { TIER_NAME, type PortalItem } from "./model";

/** What mcp_portal_decide returns that a notice uses. co_number and schedule_days come with the change terms migration. */
export type DecideResult = {
  decision_id?: string;
  under_contract?: boolean;
  difference_cents?: number | null;
  change_order_number?: string | null;
  co_number?: string | null;
  schedule_days?: number | null;
};

const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export function decisionNotice(a: {
  jobId: string;
  customer: string;
  item: PortalItem;
  label: string;
  decision: string;
  choice: "good" | "better" | "best" | null;
  note: string | null;
  next: string | null;
  r: DecideResult & { decision_id: string };
}): JobNoticeInput {
  const { item, r } = a;
  let kind: string;
  let title: string;
  let facts: Record<string, unknown>;
  if (item.kind === "selection") {
    const pk = item.view.proposal.packages.find((k) => k.tier === a.choice);
    const co = r.co_number ?? null;
    kind = "choice_made";
    title = `${a.customer} chose ${a.choice ? TIER_NAME[a.choice] : "a package"} for ${a.label}${co ? `, approving ${co}` : ""}`;
    facts = clean({
      choice: a.choice,
      amount_cents: pk?.total_cents,
      difference_cents: typeof r.difference_cents === "number" ? r.difference_cents : undefined,
      days: typeof r.schedule_days === "number" ? r.schedule_days : pk?.schedule_days,
      co_number: co,
      change_order_number: r.change_order_number ?? null,
      currency: item.view.proposal.currency,
    });
  } else {
    const verb = a.decision === "approved" ? "approved" : "declined";
    kind = `${item.kind === "pay_app" ? "pay_app" : "co"}_${verb}`;
    title = `${a.customer} ${verb} ${a.label}`;
    facts =
      item.kind === "pay_app"
        ? clean({
            decision: verb,
            amount_cents: item.view.totals.current_due_cents,
            period_end: item.view.period_end,
          })
        : clean({
            decision: verb,
            amount_cents: item.view.price_cents,
            days: item.view.schedule_days,
          });
  }
  const detail = [a.note ? `Their note: ${a.note}` : null, a.next].filter(Boolean).join("\n\n");
  return {
    jobId: a.jobId,
    topic: "client_decision",
    kind,
    title,
    detail: detail || null,
    actor: a.customer,
    refTable: "mcp_portal_decisions",
    refId: r.decision_id,
    facts,
    boardPage: item.kind === "pay_app" ? "billing" : "cos",
    dedupeKey: `portal-decision:${r.decision_id}`,
  };
}

/** What mcp_portal_message_post returns. */
export type PostedMessage = {
  status: "ok";
  message_id: string;
  created_at: string;
  job_id: string;
  job_number: string;
  job_name: string;
  customer: string;
  item_id: string | null;
  about_kind: string | null;
  about_label: string | null;
};

export function messageNotice(m: PostedMessage, body: string, access: string): JobNoticeInput {
  return {
    jobId: m.job_id,
    topic: "client_message",
    kind: m.item_id ? "client_question" : "client_message",
    title: m.about_label
      ? `${m.customer} asked about ${m.about_label}`
      : `${m.customer} sent a message`,
    detail: body,
    actor: m.customer,
    refTable: "mcp_portal_messages",
    refId: m.message_id,
    facts: clean({ access_id: access, item_id: m.item_id, about_kind: m.about_kind }),
    boardPage: "messages",
    dedupeKey: `portal-message:${m.message_id}`,
  };
}
