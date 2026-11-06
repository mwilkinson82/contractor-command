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
    kind = `${item.kind === "pay_app" ? "pay_app" : item.kind === "work_order" ? "wo" : "co"}_${verb}`;
    title = `${a.customer} ${verb} ${a.label}`;
    facts =
      item.kind === "work_order"
        ? clean({
            decision: verb,
            basis: item.view.basis,
            amount_cents: item.view.totals.estimate_cents,
            cap_cents: item.view.totals.cap_cents,
          })
        : item.kind === "service_invoice"
          ? clean({ decision: verb, amount_cents: item.view.totals.current_due_cents })
          : item.kind === "pay_app"
            ? clean({
                decision: verb,
                amount_cents: item.view.totals.current_due_cents,
                period_end: item.view.period_end,
              })
            : item.kind === "precon_agreement"
              ? clean({ decision: verb, amount_cents: item.view.price_cents })
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
    boardPage: item.kind === "pay_app" ? "billing" : item.kind === "work_order" ? "service" : "cos",
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

/** What mcp_portal_precon_sign returns (supabase/migrations/20261106130000_athena_precon_signing.sql). */
export type PreconSigned = {
  status: "ok";
  decision_id: string;
  decided_at: string;
  customer: string;
  customer_email: string;
  job_id: string;
  job_name: string;
  job_number: string;
  pm_email: string | null;
  pm_name: string | null;
  label: string;
  signed_on: string | null;
  /** Payment 1, put on the owner's page when it's due at signing. */
  bill: { item_id: string; number: string; amount_cents: number } | null;
};

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: c % 100 ? 2 : 0,
  });

/** The team hears the owner signed or declined the pre-construction agreement on their page. */
export function preconNotice(
  r: PreconSigned,
  a: { decision: "signed" | "declined"; note: string | null },
): JobNoticeInput {
  const signed = a.decision === "signed";
  const next = signed
    ? r.bill
      ? `Payment 1, invoice ${r.bill.number} for ${money(r.bill.amount_cents)}, is on their page to pay. The job moves to Design.`
      : "Send payment 1 to their client page when it's due. The job moves to Design."
    : "Read their note, change the terms with Athena and send it again.";
  return {
    jobId: r.job_id,
    topic: "client_decision",
    kind: signed ? "precon_signed" : "precon_declined",
    title: signed
      ? `${r.customer} signed the pre-construction agreement`
      : `${r.customer} declined the pre-construction agreement`,
    detail: [a.note ? `Their note: ${a.note}` : null, next].filter(Boolean).join("\n\n"),
    actor: r.customer,
    refTable: "mcp_portal_decisions",
    refId: r.decision_id,
    facts: clean({
      decision: a.decision,
      invoice: r.bill?.number,
      amount_cents: r.bill?.amount_cents,
    }),
    boardPage: "home",
    dedupeKey: `portal-decision:${r.decision_id}`,
  };
}

/** What mcp_portal_check_request returns. */
export type CheckRequested = {
  status: "ok";
  request_id: string;
  again: boolean;
  job_id: string;
  job_number: string;
  job_name: string;
  customer: string;
  customer_email: string;
  pm_email: string | null;
  number: string;
  label: string;
  amount_cents: number;
  note: string | null;
};

/** The team hears the owner is paying a bill by check, and that they set the pickup. */
export function checkNotice(r: CheckRequested): JobNoticeInput {
  return {
    jobId: r.job_id,
    topic: "client_decision",
    kind: "check_requested",
    title: `${r.customer} is paying ${r.number} by check`,
    detail: [
      `${r.customer} wants to pay invoice ${r.number}, ${money(r.amount_cents)}, by check for ${r.job_name}.`,
      r.note ? `Their note: ${r.note}` : null,
      "Tell Athena when you'll collect it and they'll see the date on their page.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    actor: r.customer,
    refTable: "mcp_portal_check_requests",
    refId: r.request_id,
    facts: clean({ invoice: r.number, amount_cents: r.amount_cents }),
    boardPage: "home",
    dedupeKey: `portal-check:${r.request_id}${r.again ? `:${Date.now()}` : ""}`,
  };
}
