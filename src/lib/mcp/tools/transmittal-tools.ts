// Phase 4 tools. transmittal_draft is read-only; transmittal_save and transmittal_mark_sent write after approval.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { audit, jobTimeZone, prefix, resolveJob } from "../jobs";
import { guide } from "../visible";
import { caller, rpc } from "../accounting/db";
import { accountingScope, requireApproved, requireBase } from "../accounting/foundations";
import { PURPOSES, PURPOSE_LABEL, TRANSMITTAL_VIEW_SPEC, dueBack, emailCardSpec, missingItems, overdueBack, transmittalFile, transmittalNumber } from "../accounting/transmittal";
import { todayIn } from "../deadlines";
import { logsFor } from "./log-tools";

const companyId = z.string().trim().min(1).max(200).optional().describe("Only needed if you belong to more than one company.");
const jobNumber = z.string().trim().min(1).max(40).describe("Job number, exact match (e.g. 2701).");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const item = z.object({ ref: z.string().trim().min(1).max(60), description: z.string().trim().max(200).optional(), copies: z.number().int().min(1).max(99).optional() });
const draftInput = {
  job_number: jobNumber, company_id: companyId, to: z.string().trim().min(1).max(200), purpose: z.enum(PURPOSES), sent_on: date.optional(),
  items: z.array(item).min(1).max(50), remarks: z.string().trim().max(1000).optional(), due_back_days: z.number().int().min(1).max(90).optional().describe("Working days from the contract clause, when on file."),
};

export const transmittalDraft = defineTool({
  name: "transmittal_draft",
  title: "Draft a transmittal",
  description: "Builds the next transmittal (per-job number, due back from its purpose, item check against the logs) for the user to review. Saves nothing and sends nothing. Read-only.",
  inputSchema: draftInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("transmittal_draft", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      accountingScope(job, "schedule_logs");
      const { entries } = await logsFor(sb, job, null);
      const missing = missingItems(args.items, new Set(entries.map((e) => e.number)));
      if (missing.length) throw new ToolError(`I can't find ${missing.join(", ")} in this job's logs. Which item did you mean, or should I log it first? Nothing was drafted.`);
      const sent = args.sent_on ?? todayIn(await jobTimeZone(sb, job.job_id));
      const nextNo = transmittalNumber(entries.filter((e) => e.log_type === "transmittal").length + 1);
      const due = dueBack(args.purpose, sent, args.due_back_days);
      const late = entries.filter((e) => e.log_type === "transmittal").map((e) => ({ n: e.number, d: overdueBack(e.due, e.closed, sent) })).filter((x) => x.d > 0);
      return guide(
        { ...text(`${prefix(job)}${[...TRANSMITTAL_VIEW_SPEC, `Transmittal ${nextNo} (number confirmed on save) · To ${args.to} · ${PURPOSE_LABEL[args.purpose]} · Date ${sent} · Due back ${due ?? "not required"}`, ...args.items.map((i) => `- ${i.ref}${i.description ? ` ${i.description}` : ""} · ${i.copies ?? 1}`), ...late.map((l) => `${l.n} is ${l.d} days overdue coming back.`)].join("\n")}`), structuredContent: { number: nextNo, due_back: due, sent_on: sent, items: args.items, overdue_back: late } },
        "Next move: ask \"Save this transmittal?\" On yes call transmittal_save.",
      );
    }),
});

export const transmittalSave = defineTool({
  name: "transmittal_save",
  title: "Save a transmittal as ready to send (after approval)",
  description: "Saves the transmittal with the next per-job number and status Ready to send, and returns the email card spec. Does not send; \"Sent\" is recorded only through transmittal_mark_sent after the host confirms. Full job access only.",
  inputSchema: { ...draftInput, approved: z.literal(true), base_version: z.number().int().min(0) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: (args, ctx) =>
    run("transmittal_save", ctx, { jobNumber: args.job_number }, async (sb) => {
      requireApproved(args);
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const { entries, versions } = await logsFor(sb, job, null);
      requireBase("Transmittal Log", versions["log:transmittal"]?.version ?? 0, args.base_version);
      const missing = missingItems(args.items, new Set(entries.map((e) => e.number)));
      if (missing.length) throw new ToolError(`I can't find ${missing.join(", ")} in this job's logs. Nothing was saved.`);
      const tz = await jobTimeZone(sb, job.job_id);
      const sent = args.sent_on ?? todayIn(tz);
      const n = await rpc<number>(sb, "mcp_next_number", { _company: job.company_id, _job: job.job_id, _seq_type: "log:transmittal" });
      const number = transmittalNumber(n);
      const due = dueBack(args.purpose, sent, args.due_back_days);
      const me = await caller(sb, job.company_id, ctx.getUserId?.());
      const r = await rpc<{ id: string; version: number }>(sb, "mcp_log_save", {
        _job: job.job_id, _base_version: args.base_version, _number: number, _what: `${number} saved, ready to send`, _who: me.name, _tz: tz,
        _entry: { log_type: "transmittal", title: `${PURPOSE_LABEL[args.purpose]} to ${args.to}`, opened: sent, due, status: "ready_to_send", ball_in_court: { name: args.to, company: null }, fields: { purpose: args.purpose, items: args.items, remarks: args.remarks ?? null } },
      });
      await audit(sb, job, "transmittal_save", "save_transmittal", r.id);
      const file = transmittalFile(job.job_number, number, sent);
      return guide({ ...text(`${prefix(job)}${number} saved as Ready to send. Due back ${due ?? "not required"}.\n${emailCardSpec({ job_number: job.job_number, number, to: args.to, subject: `${job.job_number} ${number} ${PURPOSE_LABEL[args.purpose]}`, file_name: file }).join("\n")}`), structuredContent: { id: r.id, number, due_back: due, file_name: file, status: "ready_to_send" } }, "Next move: build the PDF and the email card. Never send it yourself.");
    }),
});

export const transmittalMarkSent = defineTool({
  name: "transmittal_mark_sent",
  title: "Record a transmittal as sent (after the host confirms)",
  description: "Records Sent only when the host has confirmed the user sent the email. Without that confirmation nothing changes. Full job access only.",
  inputSchema: { job_number: jobNumber, company_id: companyId, id: z.string().uuid(), base_version: z.number().int().min(0), host_confirmed: z.literal(true), sent_on: date },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("transmittal_mark_sent", ctx, { jobNumber: args.job_number }, async (sb) => {
      if (args.host_confirmed !== true) throw new ToolError("The host hasn't confirmed the send. It stays Ready to send.");
      const job = await resolveJob(sb, args.job_number, args.company_id, "full");
      const { entries } = await logsFor(sb, job, "transmittal");
      const e = entries.find((x) => x.id === args.id);
      if (!e) throw new ToolError("That transmittal is not on this job. Nothing was changed.");
      const me = await caller(sb, job.company_id, ctx.getUserId?.());
      const tz = await jobTimeZone(sb, job.job_id);
      await rpc(sb, "mcp_log_save", { _job: job.job_id, _base_version: args.base_version, _number: null, _what: `${e.number} sent ${args.sent_on}`, _who: me.name, _tz: tz, _entry: { id: args.id, log_type: "transmittal", status: "sent", sent: args.sent_on } });
      return text(`${prefix(job)}${e.number} recorded as sent ${args.sent_on}.`);
    }),
});

export const TRANSMITTAL_TOOLS = [transmittalDraft, transmittalSave, transmittalMarkSent];
