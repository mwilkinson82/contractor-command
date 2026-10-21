// AR aging, payment-due reminders and collection follow-ups (D11 addendum + standing behavior).
// The database returns receivables only for jobs where the caller has full job access: accounting (AP), owner and
// all-access see every job; a PM sees only their own jobs; supers see no dollars.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { audit, prefix, resolveCompany, resolveJob } from "../jobs";
import { guide } from "../visible";
import { rpc } from "../accounting/db";
import { fmt, toCents } from "../accounting/cents";
import { requireApproved, accountingScope } from "../accounting/foundations";
import { dueDate, AGING_BUCKETS, type PaymentTermRule } from "../accounting/payment-terms";
import { fileName } from "../accounting/payapp";
import { AR_VIEW_SPEC, DEFAULT_REMINDER_OFFSETS, arAging, arSection, collectionDraftSpec, reminderEvents, type Receivable } from "../accounting/ar";
import { todayIn } from "../deadlines";

const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company.");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

type Row = {
  job_number: string; job_name: string; customer: string | null; reminder_offsets: number[] | null; terms: PaymentTermRule | null;
  kind: "pay_app" | "invoice"; ref: string; app_no: number | null; period_to: string | null; sent_on: string;
  submitted_on: string | null; approved_on: string | null; gc_paid_on: string | null; amount: number; received: number; offered_step: number | null;
};

export function toReceivables(rows: Row[]): { items: Receivable[]; offsets: Record<string, number[]>; offered: Record<string, number> } {
  const offsets: Record<string, number[]> = {};
  const offered: Record<string, number> = {};
  const items = rows.map((r) => {
    offsets[r.job_number] = r.reminder_offsets ?? DEFAULT_REMINDER_OFFSETS;
    if (r.offered_step) offered[`${r.job_number}|${r.ref}`] = r.offered_step;
    const d = dueDate(r.terms, { submitted: r.submitted_on ?? r.sent_on, approved: r.approved_on, gc_paid: r.gc_paid_on });
    return { job_number: r.job_number, job_name: r.job_name, customer: r.customer, ref: r.ref, kind: r.kind, sent_on: r.sent_on, due: d.due, due_estimated: d.estimated, amount: Number(r.amount), received: Number(r.received), file_name: r.kind === "pay_app" && r.app_no && r.period_to ? fileName(r.job_number, r.app_no, r.period_to, "pdf") : null } as Receivable;
  });
  return { items, offsets, offered };
}

export const arAgingTool = defineTool({
  name: "ar_aging",
  title: "AR aging, due soon and overdue",
  description: "AR aging by job and by customer (current, 1-30, 31-60, 61-90, 90+), the \"AR due and overdue\" section, payment-due reminders and collection follow-up offers. Call it on every greeting, morning briefing, PM meeting and nudge, without being asked, and include the AR section when anything is due soon or overdue. Accounting, owner and all-access see every job; PMs see their own jobs; supers see no dollars. Read-only.",
  inputSchema: { company_id: companyId, job_number: jobNumber.optional().describe("One job; leave out for every job you can see."), as_of: date.optional().describe("Default today in the job's time zone.") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("ar_aging", ctx, { jobNumber: args.job_number }, async (sb) => {
      const company = await resolveCompany(sb, args.company_id);
      if (args.job_number) accountingScope(await resolveJob(sb, args.job_number, args.company_id), "dollars");
      const rows = await rpc<Row[]>(sb, "mcp_ar_items", { _company: company, _job_number: args.job_number ?? null });
      const asOf = args.as_of ?? todayIn("America/New_York");
      const { items, offsets, offered } = toReceivables(rows ?? []);
      const ag = arAging(items, asOf);
      const sec = arSection(items, asOf, [...new Set(Object.values(offsets).flat())], offered);
      const row = (r: (typeof ag.byJob)[number]) => `- ${r.key} · ${AGING_BUCKETS.map((b) => `${b} ${fmt(r[b])}`).join(" · ")}${r.needed ? ` · Needed ${fmt(r.needed)}` : ""} · total ${fmt(r.total)}`;
      await audit(sb, null, "ar_aging", "view_ar_aging", null, company);
      return guide(
        {
          ...text([...AR_VIEW_SPEC, `AR Aging · as of ${asOf}`, "By job:", ...ag.byJob.map(row), "By customer:", ...ag.byCustomer.map(row), row(ag.total), "", ...sec.lines, ...sec.offers.map((o) => o.ask)].join("\n")),
          structuredContent: { as_of: asOf, by_job: ag.byJob, by_customer: ag.byCustomer, total: ag.total, due_soon: sec.soon, overdue: sec.overdue, offers: sec.offers.map((o) => ({ ...o, draft_spec: collectionDraftSpec(o) })), reminders: items.flatMap((i) => reminderEvents([i], offsets[i.job_number])) },
        },
        "Calendar reminders: run the connect check first; if the calendar isn't connected, say so and list the reminders instead. For a collection draft, only after the user says yes, follow each offer's draft_spec, then call ar_followup_log. Never send it yourself.",
      );
    }),
});

export const arSettingsSave = defineTool({
  name: "ar_settings_save",
  title: "Save a job's AR settings (after approval)",
  description: "Sets the job's bill-to customer and its payment-due reminder days (default 7 and 1 days before due), part of the job cadence. Call only after the user says yes. Full job access only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, approved: z.literal(true), customer: z.string().trim().max(160).optional(), reminder_days_before: z.array(z.number().int().min(0).max(60)).max(5).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("ar_settings_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      await rpc(sb, "mcp_ar_settings_save", { _job: job.job_id, _customer: args.customer ?? null, _offsets: args.reminder_days_before ?? null });
      await audit(sb, job, "ar_settings_save", "save_ar_settings", null);
      return text(`${prefix(job)}AR settings saved.${args.customer ? ` Customer: ${args.customer}.` : ""}${args.reminder_days_before ? ` Reminders ${args.reminder_days_before.join(" and ")} days before due.` : ""}`);
    }),
});

export const arInvoiceSave = defineTool({
  name: "ar_invoice_save",
  title: "Log an invoice as sent (after approval)",
  description: "Logs an invoice (outside a pay app) as sent so AR tracks it, with its due date from the job's payment terms. Call only after the user says yes. Full job access only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, approved: z.literal(true), invoice_no: z.string().trim().min(1).max(40), amount: z.union([z.number(), z.string()]), sent_on: date, approved_on: date.optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("ar_invoice_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const amt = toCents(args.amount);
      if (amt <= 0) throw new ToolError("The invoice amount must be more than $0.00. Nothing was saved.");
      await rpc(sb, "mcp_ar_invoice_save", { _job: job.job_id, _invoice_no: args.invoice_no, _amount: amt, _sent_on: args.sent_on, _approved_on: args.approved_on ?? null });
      await audit(sb, job, "ar_invoice_save", "save_invoice", null);
      return guide(text(`${prefix(job)}Invoice ${args.invoice_no} for ${fmt(amt)} logged as sent ${args.sent_on}. AR is tracking it.`), "Next move: offer the payment-due reminders on the calendar.");
    }),
});

export const arFollowupLog = defineTool({
  name: "ar_followup_log",
  title: "Log a collection follow-up step",
  description: "Records that the collection follow-up for an overdue item was offered, drafted or declined at its escalation step (due date, 30, 60 or 90 days), so the ask repeats only at the next step. Saves no email and sends nothing.",
  inputSchema: { job_number: jobNumber, company_id: companyId, ref: z.string().trim().min(1).max(40).describe("\"App 03\" or the invoice number."), step: z.union([z.literal(1), z.literal(30), z.literal(60), z.literal(90)]), outcome: z.enum(["offered", "drafted", "declined"]) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("ar_followup_log", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      await rpc(sb, "mcp_ar_followup_log", { _job: job.job_id, _ref: args.ref, _step: args.step, _outcome: args.outcome });
      return text(`${prefix(job)}Noted: ${args.ref} follow-up ${args.outcome} at the ${args.step === 1 ? "due date" : `${args.step}-day`} step.`);
    }),
});

export const AR_TOOLS = [arAgingTool, arSettingsSave, arInvoiceSave, arFollowupLog];
