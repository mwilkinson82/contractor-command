// Phase 2: pay app tools (AIA G702/G703 format). Reads never write; every save needs approved + base_version.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text, type Sb } from "../guard";
import { audit, prefix, resolveJob, type Job } from "../jobs";
import { guide } from "../visible";
import { rpc, rpcSoft, caller } from "../accounting/db";
import { toCents, fmt, sum } from "../accounting/cents";
import { accountingScope, requireApproved, requireBase } from "../accounting/foundations";
import { PAYAPP_FOOTER, type PayAppResult, type PayLine } from "../accounting/payapp-math";
import { PAYAPP_FILE_SPEC, PAYAPP_FORMAT_VIEW, computeApp, draftNext, g702Rows, nextMove, payAppDue, previousCertificates, type SavedPayApp } from "../accounting/payapp";
import { savedPaymentTerms, savedRetainageRule } from "./accounting-tools";

const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company. Pass the company name exactly as Athena lists it.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.union([z.number(), z.string()]).describe("Dollars with cents, e.g. 49000 or \"49,000.00\".");
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const entry = z.object({ id: z.string().trim().min(1).max(20).describe("SOV line (26.01) or CO line (CO-001)."), this_period: money, stored: money.optional(), overbill_approved: z.boolean().optional().describe("true only when an owner or all-access member approved this line going over its scheduled value.") });
const coLine = z.object({ id: z.string().trim().min(1).max(20), scheduled_value: money });

export async function payAppsFor(sb: Sb, job: Job): Promise<SavedPayApp[]> {
  return (await rpcSoft<SavedPayApp[]>(sb, "mcp_payapp_list", { _job: job.job_id })) ?? [];
}

/** SOV lines from the saved SOV (cents). */
export async function sovLines(sb: Sb, job: Job): Promise<{ id: string; c: number }[]> {
  const { data, error } = await sb.from("mcp_job_facts").select("key, value").eq("job_id", job.job_id).eq("module", "sov");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { key: string; value: { billable_value?: number | null } | null }[])
    .filter((f) => typeof f.value?.billable_value === "number")
    .map((f) => ({ id: f.key, c: toCents(f.value!.billable_value!) }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function context(sb: Sb, job: Job) {
  const [rule, terms, apps, sov] = await Promise.all([savedRetainageRule(sb, job), savedPaymentTerms(sb, job), payAppsFor(sb, job), sovLines(sb, job)]);
  if (!rule) throw new ToolError(`${prefix(job)}No retainage rule is saved for this job, so a pay app can't be checked. Read the contract's retainage clause (or ask the PM) and save it first. Nothing was built.`);
  return { rule, terms, apps, sov };
}

function body(job: Job, appNo: number, periodTo: string, r: PayAppResult, due: ReturnType<typeof payAppDue>, status: string, version: number | null) {
  return [
    ...PAYAPP_FORMAT_VIEW,
    `${prefix(job)}Application for Payment No. ${appNo} · Period to ${periodTo} · ${version ? `v${version}` : "Draft: not saved"} · ${status}`,
    `Due: ${due.due ?? "Needed"}${due.estimated ? " (Estimated)" : ""} · ${due.basis}`,
    ...g702Rows(r.g702).map(([k, v]) => `- ${k}: ${v}`),
    `Checks: ${r.checks.map((c) => `${c.key} ${c.ok ? "pass" : `FAIL: ${c.message}`}`).join(" · ")}`,
    `Retainage: ${r.retainage.note}`,
    ...r.g703.map((l) => `- ${l.id} · C ${fmt(l.c)} · D ${fmt(l.d)} · E ${fmt(l.e)} · F ${fmt(l.f)} · G ${fmt(l.g)} · ${l.pct} · H ${fmt(l.h)} · I ${fmt(l.i)}`),
    PAYAPP_FOOTER,
  ].join("\n");
}

const structured = (appNo: number, r: PayAppResult, due: ReturnType<typeof payAppDue>, job: Job, periodTo: string) => ({
  app_no: appNo, g702: r.g702, g702_display: Object.fromEntries(g702Rows(r.g702)), g703: r.g703, checks: r.checks, ok: r.ok,
  retainage_note: r.retainage.note, due_date: due.due, due_estimated: due.estimated, due_basis: due.basis, footer: PAYAPP_FOOTER,
  files: PAYAPP_FILE_SPEC(job.job_number, appNo, periodTo),
});

async function buildDraft(sb: Sb, job: Job, ctxUser: string | undefined, args: { entries: z.infer<typeof entry>[]; co_lines?: z.infer<typeof coLine>[]; net_change_orders?: string | number }) {
  const { rule, terms, apps, sov } = await context(sb, job);
  const lastCert = [...apps].filter((a) => a.certified).sort((a, b) => b.app_no - a.app_no)[0] ?? null;
  const appNo = (apps.reduce((m, a) => Math.max(m, a.app_no), 0) || 0) + 1;
  const me = await caller(sb, job.company_id, ctxUser);
  const allSov = [...sov, ...(args.co_lines ?? []).map((c) => ({ id: c.id, c: toCents(c.scheduled_value), co: true }))];
  const lines = draftNext(allSov, lastCert, args.entries.map((e) => ({ id: e.id, e: toCents(e.this_period), f: toCents(e.stored ?? 0), overbill_approved_by: e.overbill_approved ? { name: me.name ?? "member", role: me.role ?? "" } : null })));
  const unknown = args.entries.filter((e) => !allSov.some((s) => s.id === e.id)).map((e) => e.id);
  if (unknown.length) throw new ToolError(`${prefix(job)}Not on the SOV: ${unknown.join(", ")}. Add approved change orders as CO lines. Nothing was built.`);
  const original = sum(sov.map((s) => s.c));
  const netCo = args.net_change_orders !== undefined ? toCents(args.net_change_orders) : sum((args.co_lines ?? []).map((c) => toCents(c.scheduled_value)));
  const r = computeApp(rule, { original_contract: original, net_change_orders: netCo, previous_certificates: previousCertificates(apps, appNo), lines });
  return { rule, terms, apps, appNo, lines, r, original, netCo };
}

const draftInput = {
  job_number: jobNumber, company_id: companyId,
  period_to: date.describe("Period end date."),
  entries: z.array(entry).max(300).describe("This period's work (E) and materials presently stored (F) per line. Lines left out are $0.00 this period."),
  co_lines: z.array(coLine).max(100).optional().describe("Approved change order lines to bill, each as its own line."),
};

// ---------- payapp_draft ----------
export const payappDraft = defineTool({
  name: "payapp_draft",
  title: "Draft the next pay app",
  description: "Builds the next application for payment in AIA G702/G703 format from the last certified app plus this period's entries, runs the five checks against the saved retainage rule (zero tolerance) and returns the due date from the saved payment terms. Saves nothing: show it as \"Draft: not saved\". Full job access only.",
  inputSchema: draftInput,
  annotations: READ,
  handler: (args, ctx) =>
    run("payapp_draft", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "dollars");
      const d = await buildDraft(sb, job, ctx.getUserId?.(), args);
      const due = payAppDue(d.terms, { submitted_on: null, approved_on: null, gc_paid_on: null });
      return guide({ ...text(body(job, d.appNo, args.period_to, d.r, due, "draft", null)), structuredContent: { draft: true, ...structured(d.appNo, d.r, due, job, args.period_to) } }, nextMove(d.r, d.appNo));
    }),
});

// ---------- payapp_check ----------
export const payappCheck = defineTool({
  name: "payapp_check",
  title: "Check a pay app before it goes out",
  description: "Runs the five blocking checks (SOV ties to the contract, G703 totals equal G702, no line over its value without an owner or all-access approval, retainage equals the saved rule to the cent, previous equals the certified record) on a typed pay app. Returns pass, or the line and the amount off. Read-only.",
  inputSchema: {
    ...draftInput,
    typed: z.object({ line4: money.optional(), line5: money.optional(), line5a: money.optional(), line5b: money.optional(), line7: money.optional() }).optional().describe("G702 amounts as typed on the user's pay app."),
    typed_retainage: z.array(z.object({ id: z.string().trim().min(1).max(20), retainage: money })).max(300).optional().describe("Column I per line as typed."),
  },
  annotations: READ,
  handler: (args, ctx) =>
    run("payapp_check", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "dollars");
      const d = await buildDraft(sb, job, ctx.getUserId?.(), args);
      const ti = new Map((args.typed_retainage ?? []).map((t) => [t.id, toCents(t.retainage)]));
      const lines: PayLine[] = d.lines.map((l) => (ti.has(l.id) ? { ...l, typed_i: ti.get(l.id) } : l));
      const t = args.typed;
      const typed = t ? Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toCents(v as string | number)])) : undefined;
      const r = computeApp(d.rule, { original_contract: d.original, net_change_orders: d.netCo, previous_certificates: previousCertificates(d.apps, d.appNo), lines, typed });
      const failed = r.checks.filter((c) => !c.ok);
      return guide({ ...text(`${prefix(job)}Pay app ${d.appNo} check: ${failed.length ? `stopped.\n${failed.map((c) => `- ${c.key}: ${c.message}`).join("\n")}` : "all five checks pass."}`), structuredContent: { checks: r.checks, ok: r.ok, g702: r.g702 } }, nextMove(r, d.appNo));
    }),
});

// ---------- payapp_get ----------
export const payappGet = defineTool({
  name: "payapp_get",
  title: "Pay app or pay app log",
  description: "One saved pay app (G702/G703 format, checks, due date, file spec) or the job's pay app log with due dates and AR aging. Read-only. Full job access only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, app_no: z.number().int().min(1).optional().describe("One app; leave out for the log.") },
  annotations: READ,
  handler: (args, ctx) =>
    run("payapp_get", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "dollars");
      const [rule, terms, apps] = await Promise.all([savedRetainageRule(sb, job), savedPaymentTerms(sb, job), payAppsFor(sb, job)]);
      await audit(sb, job, "payapp_get", "view_payapp", null);
      if (args.app_no === undefined) {
        const rows = apps.map((a) => ({ app_no: a.app_no, period_to: a.period_to, status: a.status, gross: a.g702.l4, net_due: a.certified?.total_due ?? a.g702.l8, received: a.received, ...(() => { const d = payAppDue(terms, a); return { due_date: d.due, due_estimated: d.estimated }; })() }));
        return guide({ ...text([`${prefix(job)}Pay app log (${apps.length})`, ...rows.map((x) => `- App ${String(x.app_no).padStart(2, "0")} · to ${x.period_to} · ${x.status} · net ${fmt(x.net_due)} · received ${fmt(x.received)} · due ${x.due_date ?? "Needed"}${x.due_estimated ? " (Estimated)" : ""}`)].join("\n")), structuredContent: { apps: rows } });
      }
      const a = apps.find((x) => x.app_no === args.app_no);
      if (!a) throw new ToolError(`${prefix(job)}Pay app ${args.app_no} isn't in the pay app log.`);
      if (!rule) throw new ToolError(`${prefix(job)}No retainage rule is saved, so the app can't be checked.`);
      const r = computeApp(rule, { original_contract: a.original_contract, net_change_orders: a.net_change_orders, previous_certificates: a.previous_certificates, lines: a.lines });
      const due = payAppDue(terms, a);
      return guide({ ...text(body(job, a.app_no, a.period_to, r, due, a.status, a.version)), structuredContent: structured(a.app_no, r, due, job, a.period_to) }, nextMove(r, a.app_no));
    }),
});

// ---------- payapp_save ----------
export const payappSave = defineTool({
  name: "payapp_save",
  title: "Save a pay app (after approval)",
  description: "Saves the drafted pay app, or marks it submitted. Refused if any of the five checks fails. Call only after the user says yes to this exact app. Needs approved true and base_version. Full job access only.",
  inputSchema: { ...draftInput, period_from: date.optional(), approved: z.literal(true).describe("true only after the user said yes to saving this exact app."), base_version: z.number().int().min(0).describe("The app's version (0 for a new app)."), submitted_on: date.optional().describe("The date it went to the GC or owner, when marking it submitted.") },
  annotations: WRITE,
  handler: (args, ctx) =>
    run("payapp_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "write");
      const d = await buildDraft(sb, job, ctx.getUserId?.(), args);
      if (!d.r.ok) {
        await audit(sb, job, "payapp_save", "payapp_refused", null);
        throw new ToolError(`${prefix(job)}Pay app ${d.appNo} not saved.\n${d.r.checks.filter((c) => !c.ok).map((c) => `- ${c.message}`).join("\n")}`);
      }
      const existing = d.apps.find((a) => a.app_no === d.appNo);
      requireBase(`Pay app ${d.appNo}`, existing?.version ?? 0, args.base_version);
      const saved = await rpc<{ id: string; version: number }>(sb, "mcp_payapp_save", {
        _job: job.job_id, _app_no: d.appNo, _base_version: args.base_version,
        _row: { period_from: args.period_from ?? null, period_to: args.period_to, status: args.submitted_on ? "submitted" : "checked", submitted_on: args.submitted_on ?? null, original_contract: d.original, net_change_orders: d.netCo, previous_certificates: d.r.g702.l7, lines: d.lines, g702: d.r.g702, retainage_rule: d.rule },
      });
      await audit(sb, job, "payapp_save", "save_payapp", saved.id);
      const due = payAppDue(d.terms, { submitted_on: args.submitted_on ?? null, approved_on: null, gc_paid_on: null });
      return guide({ ...text(`${prefix(job)}Pay app ${d.appNo} saved as v${saved.version}${args.submitted_on ? `, submitted ${args.submitted_on}` : ""}. Current payment due ${fmt(d.r.g702.l8)}. Due ${due.due ?? "Needed"}${due.estimated ? " (Estimated)" : ""}. AR is now tracking it.`), structuredContent: { saved: true, version: saved.version, ...structured(d.appNo, d.r, due, job, args.period_to) } },
        args.submitted_on ? "Next move: offer the transmittal with the PDF attached, and the payment-due reminders on the calendar." : "Next move: offer to mark it submitted once it goes to the GC.");
    }),
});

// ---------- payapp_certify ----------
export const payappCertify = defineTool({
  name: "payapp_certify",
  title: "Record the certified pay app (after approval)",
  description: "Records the GC's or architect's certified amounts line by line. Athena recomputes retainage on the certified amounts with the saved rule; a cut becomes the starting point for the next app. Logs the approval date (and the GC's paid date when given), which sets the due date. Needs approved true and base_version. Full job access only.",
  inputSchema: {
    job_number: jobNumber, company_id: companyId, app_no: z.number().int().min(1),
    approved: z.literal(true).describe("true only after the user said yes to recording this certification."), base_version: z.number().int().min(1),
    certified_by: z.string().trim().min(1).max(160), certified_on: date,
    cuts: z.array(z.object({ id: z.string().trim().min(1).max(20), certified_this_period: money.optional(), certified_stored: money.optional(), reason: z.string().trim().max(300) })).max(300).optional().describe("Only lines the certifier changed."),
    gc_paid_on: date.optional().describe("The date the GC was paid by the owner, when known (pay-when-paid due dates)."),
  },
  annotations: WRITE,
  handler: (args, ctx) =>
    run("payapp_certify", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "write");
      const { rule, terms, apps } = await context(sb, job);
      const a = apps.find((x) => x.app_no === args.app_no);
      if (!a) throw new ToolError(`${prefix(job)}Pay app ${args.app_no} isn't in the pay app log. Nothing was recorded.`);
      requireBase(`Pay app ${a.app_no}`, a.version, args.base_version);
      const cut = new Map((args.cuts ?? []).map((c) => [c.id, c]));
      const lines = a.lines.map((l) => { const c = cut.get(l.id); return c ? { ...l, e: c.certified_this_period !== undefined ? toCents(c.certified_this_period) : l.e, f: c.certified_stored !== undefined ? toCents(c.certified_stored) : l.f } : l; });
      const r = computeApp(rule, { original_contract: a.original_contract, net_change_orders: a.net_change_orders, previous_certificates: a.previous_certificates, lines });
      const certified = { lines: r.g703.map((l) => ({ id: l.id, g: l.g, i: l.i })), total_due: r.g702.l8, certified_by: args.certified_by, certified_on: args.certified_on };
      const saved = await rpc<{ version: number }>(sb, "mcp_payapp_certify", { _job: job.job_id, _app_no: a.app_no, _base_version: args.base_version, _certified: certified, _cuts: args.cuts ?? [], _gc_paid_on: args.gc_paid_on ?? null });
      await audit(sb, job, "payapp_certify", "certify_payapp", null);
      const diff = a.g702.l8 - r.g702.l8;
      const due = payAppDue(terms, { submitted_on: a.submitted_on, approved_on: args.certified_on, gc_paid_on: args.gc_paid_on ?? a.gc_paid_on });
      return guide({ ...text(`${prefix(job)}Pay app ${a.app_no} certified by ${args.certified_by} on ${args.certified_on}: ${fmt(r.g702.l8)}${diff ? ` (${fmt(diff)} less than billed)` : " as billed"}. Due ${due.due ?? "Needed"}${due.estimated ? " (Estimated)" : ""}.`), structuredContent: { certified: true, version: saved.version, certified_due: r.g702.l8, cut_total: diff, due_date: due.due, due_estimated: due.estimated } },
        diff ? `Next move: "The GC certified ${fmt(diff)} less than billed on app ${a.app_no}. I've set that as the starting point for app ${a.app_no + 1}. Want a short note asking what's needed to release it?"` : "Next move: offer the payment-due reminders on the calendar.");
    }),
});

// ---------- payment_record ----------
export const paymentRecord = defineTool({
  name: "payment_record",
  title: "Record a payment received (after approval)",
  description: "Records money received against a pay app. A payment that differs from the certified amount needs a short-pay reason, or Athena asks \"typo or short pay?\" first. Logging the GC's paid date turns an Estimated due date into a firm one. Needs approved true. Full job access only.",
  inputSchema: {
    job_number: jobNumber, company_id: companyId, app_no: z.number().int().min(1),
    approved: z.literal(true).describe("true only after the user said yes to recording this payment."),
    amount: money, received_on: date, reference: z.string().trim().max(120).optional(),
    short_pay_reason: z.string().trim().max(300).optional().describe("Required when the amount differs from the certified amount."),
    gc_paid_on: date.optional().describe("The date the GC was paid by the owner, if learned now."),
  },
  annotations: WRITE,
  handler: (args, ctx) =>
    run("payment_record", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      accountingScope(job, "write");
      const apps = await payAppsFor(sb, job);
      const a = apps.find((x) => x.app_no === args.app_no);
      if (!a) throw new ToolError(`${prefix(job)}Pay app ${args.app_no} isn't in the pay app log. Nothing was recorded.`);
      const amt = toCents(args.amount);
      const certified = a.certified?.total_due ?? null;
      const after = a.received + amt;
      if (certified !== null && after !== certified && !args.short_pay_reason)
        throw new ToolError(after > certified
          ? `${prefix(job)}That payment is ${fmt(after - certified)} more than certified on app ${a.app_no}. Is it a typo or an overpayment? Nothing was recorded.`
          : `${prefix(job)}That payment leaves ${fmt(certified - after)} open against the certified ${fmt(certified)} on app ${a.app_no}. Is it a typo or a short pay? Nothing was recorded.`);
      const r = await rpc<{ id: string; received: number }>(sb, "mcp_payment_record", { _job: job.job_id, _app_no: a.app_no, _amount: amt, _received_on: args.received_on, _reference: args.reference ?? null, _short_pay_reason: args.short_pay_reason ?? null, _gc_paid_on: args.gc_paid_on ?? null });
      await audit(sb, job, "payment_record", "record_payment", r.id);
      return guide({ ...text(`${prefix(job)}Recorded ${fmt(amt)} received ${args.received_on} on app ${a.app_no}. Received to date ${fmt(r.received)}.`), structuredContent: { recorded: true, received_to_date: r.received } });
    }),
});

export const PAYAPP_TOOLS = [payappDraft, payappCheck, payappGet, payappSave, payappCertify, paymentRecord];
