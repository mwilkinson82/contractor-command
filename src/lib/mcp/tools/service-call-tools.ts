// Service calls (Nov 5): a customer calls with a problem, pays an upfront service call fee, the tech diagnoses it,
// the member writes a work order priced by unit price, time and material, or hourly labor, the customer approves it
// on their client page (or signs on site), the work is logged with the customer's sign-off, and the bill goes out
// less the paid fee. Each call is a light job numbered SC-<n>, so the client page, billing and payments all reuse the
// job's own records. Anything that reaches the customer needs confirmed: true after the member's yes.
import { defineTool, ToolError, type JsonValueInput } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, text, type Sb } from "../guard";
import { audit, memberCompanies, named, resolveCompany, resolveJob, type Job } from "../jobs";
import { guide } from "../visible";
import { displayPrice } from "../../selections/format";
import { companyLogoUrl } from "../document-email-brand";
import { notifyAll } from "./customer-portal-tools";

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(fn, args);
  if (error) {
    if (isMissingFunction(error))
      throw new ToolError(
        "Service calls aren't turned on for this account yet. Nothing was changed.",
      );
    dbError(error as { message: string });
  }
  return data as T;
}

const usd = (c: number | null | undefined) =>
  typeof c === "number" ? displayPrice(c, "USD") : "not set";

export const BASIS_LABEL: Record<string, string> = {
  unit_price: "Unit price",
  time_and_material: "Time and material",
  hourly: "Hourly",
  lump_sum: "Lump sum",
};

type Rates = {
  saved: boolean;
  fee_cents: number;
  fee_credit: boolean;
  labor_rate_cents: number | null;
  hourly_rate_cents: number | null;
  overtime_bps: number;
  markup_bps: number;
  can_edit?: boolean;
};

type Bill = {
  invoice_id: string;
  number: string;
  net_due_cents: number;
  applied_cents: number;
  remaining_cents: number;
  pending_cents: number;
  paid: boolean;
  item_id: string | null;
};

type WorkOrderRow = {
  id: string;
  number: string;
  version: number;
  basis: string;
  title: string;
  state: string;
  estimate_cents: number;
  cap_cents: number | null;
  actual_cents: number | null;
  decision: { decision: string; by?: string; at?: string; channel?: string } | null;
  signoff: { name: string; at: string } | null;
  bill: Bill | null;
};

export type ServiceCall = {
  job_id: string;
  job_number: string;
  job_name: string;
  company_id: string;
  number: number;
  version: number;
  status: string;
  stage: string;
  next_step: string | null;
  customer: { name: string; phone: string | null; email: string | null };
  site_address: string;
  issue: string;
  urgency: string;
  tech_name: string | null;
  window_start: string | null;
  window_end: string | null;
  time_zone: string;
  fee_cents: number;
  fee_credit: boolean;
  fee: Bill | null;
  findings: string | null;
  recommendation: string | null;
  work_orders: WorkOrderRow[];
  portal_customers: {
    access_id: string;
    name: string;
    email: string;
    last_seen_at: string | null;
  }[];
};

const STAGE_WORD: Record<string, string> = {
  new: "New",
  scheduled: "Scheduled",
  fee_requested: "Fee sent",
  fee_paid: "Fee paid",
  diagnosed: "Diagnosed",
  work_order_draft: "Work order drafted",
  work_order_sent: "Waiting on approval",
  declined: "Work order declined",
  approved: "Approved",
  work_done: "Work done",
  billed: "Billed",
  paid: "Paid",
  closed: "Closed",
  cancelled: "Cancelled",
};

function when(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/** The call in a few lines: who, where, what, where it stands, and each work order with its money. */
export function callText(c: ServiceCall): string {
  const tz = c.time_zone || "America/Chicago";
  const win =
    c.window_start && c.window_end
      ? `${when(c.window_start, tz)} to ${when(c.window_end, tz)?.replace(/^.*?, .*?, /, "")}`
      : when(c.window_start, tz);
  const out = [
    `SC-${c.number} · ${c.customer.name} · ${STAGE_WORD[c.stage] ?? c.stage}`,
    `Site: ${c.site_address}`,
    `Problem: ${c.issue}${c.urgency !== "routine" ? ` (${c.urgency})` : ""}`,
    c.tech_name || win
      ? `Tech: ${c.tech_name ?? "not assigned"}${win ? `, arriving ${win}` : ""}`
      : null,
    c.fee_cents > 0
      ? `Service call fee: ${usd(c.fee_cents)}${c.fee_credit ? ", credited toward the repair" : ""}${c.fee ? (c.fee.paid ? " · paid" : ` · sent, ${usd(c.fee.remaining_cents)} due`) : " · not sent yet"}`
      : "No service call fee.",
    c.findings ? `Found: ${c.findings}` : null,
  ];
  for (const w of c.work_orders) {
    const price =
      w.basis === "unit_price"
        ? usd(w.estimate_cents)
        : `estimate ${usd(w.estimate_cents)}${w.cap_cents !== null ? `, not to exceed ${usd(w.cap_cents)}` : ""}`;
    const state =
      w.state === "approved" && w.decision?.by
        ? `approved by ${w.decision.by}${w.decision.channel === "on_site" ? " on site" : " on the client page"}`
        : w.state === "billed" && w.bill
          ? w.bill.paid
            ? `billed ${usd(w.bill.net_due_cents)} on ${w.bill.number}, paid`
            : `billed ${usd(w.bill.net_due_cents)} on ${w.bill.number}, ${usd(w.bill.remaining_cents)} due`
          : w.state === "done"
            ? `done, ${usd(w.actual_cents)} actual, signed off by ${w.signoff?.name ?? "the customer"}`
            : w.state;
    out.push(
      `${w.number} v${w.version} · ${w.title} · ${BASIS_LABEL[w.basis] ?? w.basis} · ${price} · ${state}`,
    );
  }
  if (!c.portal_customers.length)
    out.push(
      c.customer.email
        ? `The customer has no client page yet. Invite ${c.customer.email} with customer_portal invite on job ${c.job_number}.`
        : "The customer has no client page yet and no email on file.",
    );
  if (c.next_step) out.push("", `Next: ${c.next_step}`);
  return out.filter((l) => l !== null).join("\n");
}

/** Athena walks the member through the next step: one yes or no question, never a list of options. */
const NEXT_RULE =
  "End by offering the Next step above as one yes or no question in plain words (for example: Want me to send WO-1001 to Dana's client page now?). Do it only after the member says yes. Never say Athena can't take card or bank payments: the customer pays the fee and the bill on their client page, and checks or wires are recorded here.";
const SEND_RULE =
  "This reaches the customer: their client page and an email that it's there. Show the member what goes out and who gets it, and call again with confirmed true only after they say yes.";

function result(head: string, c: ServiceCall, lines: string[] = [], ...rules: string[]) {
  return guide(
    {
      ...text([head, ...lines, "", callText(c)].join("\n")),
      structuredContent: c as unknown as JsonValueInput,
    },
    NEXT_RULE,
    ...rules,
  );
}

const cents = z.number().int().min(0).max(1_000_000_000);
const lineSchema = z
  .object({
    kind: z.enum(["item", "labor", "material"]),
    description: z.string().trim().min(1).max(300),
    hours: z.number().positive().max(1000).optional(),
    overtime: z.boolean().optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    unit: z.string().trim().max(20).optional(),
    unit_rate_cents: cents.optional(),
    unit_cost_cents: cents.optional(),
  })
  .strict();

async function companyName(sb: Sb, companyId: string): Promise<string> {
  const cos = await memberCompanies(sb);
  return cos.find((c) => c.id === companyId)?.name ?? "Your contractor";
}

async function tell(
  sb: Sb,
  job: Job,
  r: { recipients: { access_id: string; email: string; name: string }[]; label: string },
  item: "work_order" | "service_invoice",
  notify: boolean | undefined,
): Promise<string[]> {
  if (!r.recipients.length)
    return [
      "No customer has a client page on this call yet, so nobody was emailed. Invite them with customer_portal invite.",
    ];
  if (notify === false) return ["No email went out; it shows on their client page."];
  return notifyAll(
    {
      recipients: r.recipients,
      company: await companyName(sb, job.company_id),
      job_name: job.name,
    },
    "decision",
    r.label,
    await companyLogoUrl(sb, job.company_id),
    item,
  );
}

export const SERVICE_CALL_RULE =
  " For a service call (a customer calls with a problem, a repair, a no-heat or no-power call, a trouble call), call service_call: create takes the call as a job numbered SC-<n>, request_fee sends the upfront service call fee to the customer's client page, work_order_save writes the work order priced by unit price, time and material or hourly labor, work_order_send sends it for approval, approve_on_site records a signature on site, log_work records the actual work and the customer's sign-off, bill sends the bill less the paid fee, record_payment records a check or wire. Walk the member through each next step. A project job's contract type (lump sum, unit price, cost plus, time and material) is read and set with job_contract_type; it never limits change orders, and change_order_record takes pricing_basis for a unit price, T&M or hourly change order on any job. ";

export const serviceCall = defineTool({
  name: "service_call",
  title: "Service calls",
  description:
    "Runs service calls: set the company's service rates (service call fee, T&M and hourly labor rates, overtime, materials markup), take a call (customer, site, problem, tech, arrival window), send the upfront service call fee to the customer's client page, record what the tech found, write and send a work order priced by unit price, time and material, or hourly labor (optional not-to-exceed), record an on-site approval, log the actual work with the customer's sign-off, send the bill less the paid fee, and record a check or wire payment. Each call is a job numbered SC-<n>.",
  inputSchema: {
    action: z.enum([
      "rates",
      "rates_save",
      "list",
      "create",
      "get",
      "update",
      "request_fee",
      "work_order_save",
      "work_order_send",
      "approve_on_site",
      "log_work",
      "bill",
      "record_payment",
    ]),
    company_id: z.string().trim().min(1).max(200).optional(),
    job_number: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .optional()
      .describe("The service call's job number, like SC-1001."),
    status: z.enum(["open", "closed", "cancelled", "all"]).optional(),
    request_id: z
      .string()
      .uuid()
      .optional()
      .describe("A new UUID for create or record_payment; reuse the same one on a retry."),
    customer_name: z.string().trim().min(1).max(120).optional(),
    customer_phone: z.string().trim().max(40).optional(),
    customer_email: z.string().trim().email().max(320).optional(),
    site_address: z.string().trim().min(1).max(300).optional(),
    issue: z.string().trim().min(1).max(2000).optional(),
    urgency: z.enum(["routine", "soon", "emergency"]).optional(),
    tech_name: z.string().trim().max(120).optional(),
    window_start: z.iso.datetime({ offset: true }).optional(),
    window_end: z.iso.datetime({ offset: true }).optional(),
    time_zone: z.string().trim().max(60).optional(),
    findings: z.string().trim().max(4000).optional(),
    recommendation: z.string().trim().max(4000).optional(),
    call_status: z.enum(["open", "closed", "cancelled"]).optional(),
    fee_cents: cents.optional().describe("Service call fee in cents, e.g. 14900 for $149."),
    fee_credit: z.boolean().optional().describe("Credit the paid fee toward the repair."),
    labor_rate_cents: cents.optional().describe("T&M labor rate per hour in cents."),
    hourly_rate_cents: cents.optional().describe("Hourly labor rate per hour in cents."),
    overtime_bps: z
      .number()
      .int()
      .min(10000)
      .max(30000)
      .optional()
      .describe("15000 = time and a half."),
    markup_bps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe("Materials markup on T&M, 1500 = 15%."),
    work_order_id: z.string().uuid().optional(),
    expected_version: z.number().int().min(1).optional(),
    basis: z.enum(["unit_price", "time_and_material", "hourly"]).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    scope: z.string().trim().min(1).max(4000).optional(),
    lines: z.array(lineSchema).min(1).max(60).optional(),
    cap_cents: cents.optional().describe("Not-to-exceed for T&M or hourly, in cents."),
    done: z.boolean().optional(),
    signed_name: z.string().trim().min(2).max(120).optional(),
    note: z.string().trim().max(500).optional(),
    invoice_id: z.string().uuid().optional(),
    method: z.enum(["check", "wire"]).optional(),
    amount_cents: cents.optional(),
    received_on: z.iso.date().optional(),
    reference: z.string().trim().min(1).max(80).optional(),
    due_on: z.iso.date().optional(),
    notify: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: (args, ctx) =>
    run(
      "service_call",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (args.action === "rates" || args.action === "rates_save") {
          const co = await resolveCompany(sb, args.company_id);
          let r: Rates;
          if (args.action === "rates_save") {
            const p: Record<string, unknown> = {};
            for (const k of [
              "fee_cents",
              "fee_credit",
              "labor_rate_cents",
              "hourly_rate_cents",
              "overtime_bps",
              "markup_bps",
            ] as const)
              if (args[k] !== undefined) p[k] = args[k];
            if (!Object.keys(p).length)
              throw new ToolError("Which rate should change? Nothing was saved.");
            r = await rpc<Rates>(sb, "mcp_service_rates_save", { _company: co, _p: p });
            await audit(sb, null, "service_call", "rates_save", null, co);
          } else r = await rpc<Rates>(sb, "mcp_service_rates_get", { _company: co });
          const lines = [
            r.saved ? "Service rates" : "Service rates (not set yet; these are the defaults)",
            `Service call fee: ${usd(r.fee_cents)}${r.fee_credit ? ", credited toward the repair" : ", not credited"}`,
            `T&M labor: ${r.labor_rate_cents === null ? "not set" : `${usd(r.labor_rate_cents)}/hr`}`,
            `Hourly labor: ${r.hourly_rate_cents === null ? "not set" : `${usd(r.hourly_rate_cents)}/hr`}`,
            `Overtime: ${r.overtime_bps / 10000}x`,
            `Materials markup on T&M: ${r.markup_bps / 100}%`,
          ];
          return guide(
            { ...text(lines.join("\n")), structuredContent: r as unknown as JsonValueInput },
            r.labor_rate_cents === null || r.hourly_rate_cents === null
              ? "Ask the member for any rate that isn't set before writing a T&M or hourly work order."
              : "",
          );
        }

        if (args.action === "list") {
          const co = await resolveCompany(sb, args.company_id);
          const l = await rpc<{
            calls: {
              job_number: string;
              number: number;
              stage: string;
              customer: string;
              site_address: string;
              next_step: string | null;
            }[];
          }>(sb, "mcp_service_calls_list", { _company: co, _status: args.status ?? "open" });
          const lines = l.calls.length
            ? l.calls.map(
                (c) =>
                  `- ${c.job_number} · ${c.customer} · ${c.site_address} · ${STAGE_WORD[c.stage] ?? c.stage}${c.next_step ? ` · next: ${c.next_step}` : ""}`,
              )
            : [`No ${args.status === "all" ? "" : `${args.status ?? "open"} `}service calls.`];
          return guide(
            {
              ...text(["Service calls", ...lines].join("\n")),
              structuredContent: l as unknown as JsonValueInput,
            },
            "Offer to open one, or to take a new call.",
          );
        }

        if (args.action === "create") {
          const co = await resolveCompany(sb, args.company_id);
          if (!args.request_id)
            throw new ToolError(
              "Pass a new UUID as request_id, and reuse it if you retry. Nothing was saved.",
            );
          if (!args.customer_name || !args.site_address || !args.issue)
            throw new ToolError(
              "Who's the customer, where's the call, and what's the problem? Nothing was saved.",
            );
          const c = await rpc<ServiceCall & { already_created: boolean }>(
            sb,
            "mcp_service_call_create",
            {
              _company: co,
              _p: {
                request_id: args.request_id,
                customer_name: args.customer_name,
                customer_phone: args.customer_phone,
                customer_email: args.customer_email,
                site_address: args.site_address,
                issue: args.issue,
                urgency: args.urgency,
                tech_name: args.tech_name,
                window_start: args.window_start,
                window_end: args.window_end,
                time_zone: args.time_zone,
                fee_cents: args.fee_cents,
                fee_credit: args.fee_credit,
              },
            },
          );
          await audit(sb, null, "service_call", "create", c.job_id, co);
          return result(
            c.already_created
              ? `Service call ${c.job_number} was already taken.`
              : `Took service call ${c.job_number}.`,
            c,
          );
        }

        if (!args.job_number)
          throw new ToolError("Which service call? Pass its job number, like SC-1001.");
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const head = `${named(job)} · Service call`;

        if (args.action === "get") {
          const c = await rpc<ServiceCall>(sb, "mcp_service_call_get", { _job: job.job_id });
          return result(head, c);
        }

        if (args.action === "update") {
          const p: Record<string, unknown> = {};
          for (const k of [
            "customer_name",
            "customer_phone",
            "customer_email",
            "site_address",
            "issue",
            "urgency",
            "tech_name",
            "window_start",
            "window_end",
            "fee_cents",
            "fee_credit",
            "findings",
            "recommendation",
          ] as const)
            if (args[k] !== undefined) p[k] = args[k];
          if (args.call_status) p.status = args.call_status;
          if (!Object.keys(p).length)
            throw new ToolError("What should change on the call? Nothing was saved.");
          const c = await rpc<ServiceCall>(sb, "mcp_service_call_update", {
            _job: job.job_id,
            _expected_version: args.expected_version ?? null,
            _p: p,
          });
          await audit(sb, job, "service_call", "update", job.job_id);
          return result(`${head}\nSaved.`, c);
        }

        if (args.action === "request_fee") {
          if (args.confirmed !== true) {
            const c = await rpc<ServiceCall>(sb, "mcp_service_call_get", { _job: job.job_id });
            const who = c.portal_customers.map((x) => `${x.name} <${x.email}>`).join(", ");
            throw new ToolError(
              `Show the member: the ${usd(c.fee_cents)} service call fee goes to ${who || "nobody yet (invite the customer first)"} on their client page, with an email that it's there, and they can pay by card or bank there. Ask them to confirm, then call again with confirmed true. Nothing was sent.`,
            );
          }
          const r = await rpc<{
            item_id: string;
            label: string;
            amount_cents: number;
            recipients: { access_id: string; email: string; name: string }[];
            call: ServiceCall;
          }>(sb, "mcp_service_fee_request", { _job: job.job_id, _due_on: args.due_on ?? null });
          await audit(sb, job, "service_call", "request_fee", r.item_id);
          const sent = await tell(sb, job, r, "service_invoice", args.notify);
          return result(head, r.call, [
            `Sent the ${usd(r.amount_cents)} service call fee to the client page.`,
            ...sent,
          ]);
        }

        if (args.action === "work_order_save") {
          if (!args.work_order_id && (!args.basis || !args.title || !args.scope || !args.lines))
            throw new ToolError(
              "A work order needs how it's priced (unit_price, time_and_material or hourly), a title, the scope and its lines. Nothing was saved.",
            );
          const p: Record<string, unknown> = {};
          for (const k of ["basis", "title", "scope", "lines", "cap_cents"] as const)
            if (args[k] !== undefined) p[k] = args[k];
          const w = await rpc<{
            number: string;
            version: number;
            state: string;
            estimate_cents: number;
            cap_cents: number | null;
            call: ServiceCall;
          }>(sb, "mcp_work_order_save", {
            _job: job.job_id,
            _work_order: args.work_order_id ?? null,
            _expected_version: args.expected_version ?? null,
            _p: p,
          });
          await audit(sb, job, "service_call", "work_order_save", args.work_order_id ?? null);
          return result(head, w.call, [
            `Saved ${w.number} version ${w.version} as a draft: ${usd(w.estimate_cents)}${w.cap_cents !== null ? `, not to exceed ${usd(w.cap_cents)}` : ""}.`,
          ]);
        }

        if (args.action === "work_order_send") {
          if (!args.work_order_id)
            throw new ToolError("Which work order? Use get for its id. Nothing was sent.");
          if (args.confirmed !== true) {
            const c = await rpc<ServiceCall>(sb, "mcp_service_call_get", { _job: job.job_id });
            const w = c.work_orders.find((x) => x.id === args.work_order_id);
            const who = c.portal_customers.map((x) => `${x.name} <${x.email}>`).join(", ");
            throw new ToolError(
              `Show the member ${w ? `${w.number} (${BASIS_LABEL[w.basis]}, ${usd(w.estimate_cents)}${w.cap_cents !== null ? `, not to exceed ${usd(w.cap_cents)}` : ""})` : "the work order"} and say it goes to ${who || "nobody yet (invite the customer first)"} on their client page to approve with an emailed code. Ask them to confirm, then call again with confirmed true. Nothing was sent.`,
            );
          }
          const r = await rpc<{
            item_id: string;
            label: string;
            version: number;
            recipients: { access_id: string; email: string; name: string }[];
            call: ServiceCall;
          }>(sb, "mcp_work_order_send", {
            _job: job.job_id,
            _work_order: args.work_order_id,
            _expected_version: args.expected_version ?? null,
            _due_on: args.due_on ?? null,
          });
          await audit(sb, job, "service_call", "work_order_send", r.item_id);
          const sent = await tell(sb, job, r, "work_order", args.notify);
          return result(
            head,
            r.call,
            [
              `Sent ${r.label} (version ${r.version}) to the client page for approval. The customer approves with their typed name and an emailed code.`,
              ...sent,
            ],
            "Revising the work order later takes it off the customer's page and needs a new approval.",
          );
        }

        if (args.action === "approve_on_site") {
          if (!args.work_order_id || !args.signed_name)
            throw new ToolError("Which work order, and who signed on site? Nothing was saved.");
          if (args.confirmed !== true)
            throw new ToolError(
              `Confirm with the member that ${args.signed_name} signed the work order on site, then call again with confirmed true. Nothing was saved.`,
            );
          const c = await rpc<ServiceCall>(sb, "mcp_work_order_approve_on_site", {
            _job: job.job_id,
            _work_order: args.work_order_id,
            _expected_version: args.expected_version ?? null,
            _signed_name: args.signed_name,
            _note: args.note ?? null,
          });
          await audit(sb, job, "service_call", "approve_on_site", args.work_order_id);
          return result(head, c, [`Recorded ${args.signed_name}'s approval on site.`]);
        }

        if (args.action === "log_work") {
          if (!args.work_order_id || !args.lines)
            throw new ToolError(
              "Which work order, and what was actually done (the lines)? Nothing was saved.",
            );
          if (args.done && !args.signed_name)
            throw new ToolError("Who signed off on the finished work? Nothing was saved.");
          const w = await rpc<{
            number: string;
            state: string;
            actual_cents: number;
            call: ServiceCall;
          }>(sb, "mcp_work_order_log", {
            _job: job.job_id,
            _work_order: args.work_order_id,
            _expected_version: args.expected_version ?? null,
            _p: {
              lines: args.lines,
              done: args.done === true,
              ...(args.signed_name ? { signoff_name: args.signed_name } : {}),
              ...(args.note ? { signoff_note: args.note } : {}),
            },
          });
          await audit(sb, job, "service_call", "log_work", args.work_order_id);
          return result(head, w.call, [
            w.state === "done"
              ? `Logged ${w.number} as done: ${usd(w.actual_cents)}, signed off by ${args.signed_name}.`
              : `Logged the work so far on ${w.number}: ${usd(w.actual_cents)}.`,
          ]);
        }

        if (args.action === "bill") {
          if (!args.work_order_id) throw new ToolError("Which work order? Nothing was sent.");
          if (args.confirmed !== true) {
            const c = await rpc<ServiceCall>(sb, "mcp_service_call_get", { _job: job.job_id });
            const w = c.work_orders.find((x) => x.id === args.work_order_id);
            const credit =
              c.fee_credit && c.fee?.paid ? Math.min(c.fee.applied_cents, w?.actual_cents ?? 0) : 0;
            const who = c.portal_customers.map((x) => `${x.name} <${x.email}>`).join(", ");
            throw new ToolError(
              `Show the member the bill for ${w?.number ?? "the work order"}: ${usd(w?.actual_cents)} for the work${credit ? `, less the ${usd(credit)} service call fee they paid, ${usd((w?.actual_cents ?? 0) - credit)} due` : ""}. It goes to ${who || "nobody yet (invite the customer first)"} on their client page to pay, with an email that it's there. Ask them to confirm, then call again with confirmed true. Nothing was sent.`,
            );
          }
          const r = await rpc<{
            item_id: string;
            label: string;
            amount_cents: number;
            credit_cents: number;
            due_cents: number;
            invoice_id: string;
            recipients: { access_id: string; email: string; name: string }[];
            call: ServiceCall;
          }>(sb, "mcp_service_bill", {
            _job: job.job_id,
            _work_order: args.work_order_id,
            _due_on: args.due_on ?? null,
          });
          await audit(sb, job, "service_call", "bill", r.invoice_id);
          const sent = await tell(sb, job, r, "service_invoice", args.notify);
          return result(head, r.call, [
            `Sent ${r.label}: ${usd(r.amount_cents)}${r.credit_cents ? ` less the ${usd(r.credit_cents)} fee paid` : ""}, ${usd(r.due_cents)} due. It's on the job's billing as a submitted invoice.`,
            ...sent,
          ]);
        }

        if (args.action === "record_payment") {
          if (
            !args.invoice_id ||
            !args.method ||
            !args.amount_cents ||
            !args.received_on ||
            !args.reference ||
            !args.request_id
          )
            throw new ToolError(
              "Which bill (invoice_id from get), check or wire, the amount, the date it arrived, the check number or wire reference, and a new request_id. Nothing was recorded.",
            );
          if (args.confirmed !== true)
            throw new ToolError(
              `Confirm with the member: record a ${usd(args.amount_cents)} ${args.method} (${args.reference}) received ${args.received_on}. Then call again with confirmed true. Nothing was recorded.`,
            );
          const r = await rpc<{
            already_recorded: boolean;
            remaining_cents?: number;
            call?: ServiceCall;
          }>(sb, "mcp_service_record_payment", {
            _job: job.job_id,
            _invoice: args.invoice_id,
            _id: args.request_id,
            _method: args.method,
            _amount_cents: args.amount_cents,
            _received_on: args.received_on,
            _reference: args.reference,
            _note: args.note ?? null,
          });
          await audit(sb, job, "service_call", "record_payment", args.request_id);
          const c =
            r.call ?? (await rpc<ServiceCall>(sb, "mcp_service_call_get", { _job: job.job_id }));
          return result(head, c, [
            r.already_recorded
              ? "That payment was already recorded."
              : `Recorded the ${usd(args.amount_cents)} ${args.method} as a receipt applied to the bill. ${usd(r.remaining_cents ?? 0)} is left.`,
          ]);
        }
        throw new ToolError("Unknown action.");
      },
    ),
});

const CONTRACT_LABEL: Record<string, string> = {
  lump_sum: "Lump sum",
  unit_price: "Unit price",
  cost_plus: "Cost plus",
  time_and_material: "Time and material",
};

/** The job's contract type: T&M, unit price, cost plus or lump sum. A label: it never limits the job's change orders. */
export const jobContractType = defineTool({
  name: "job_contract_type",
  title: "Job contract type",
  description:
    "Reads or sets a project job's contract type: lump sum, unit price, cost plus, or time and material (a GMP job is cost_plus). It's a label on the job and its board; any job can still carry change orders priced by lump sum, unit price, T&M or hourly (set on change_order_record with pricing_basis). Service calls are priced on each work order instead.",
  inputSchema: {
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().trim().min(1).max(200).optional(),
    contract_type: z
      .enum(["lump_sum", "unit_price", "cost_plus", "time_and_material", "none"])
      .optional()
      .describe("Leave out to read it; none clears it."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "job_contract_type",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveJob(
          sb,
          args.job_number,
          args.company_id,
          args.contract_type ? "full" : undefined,
        );
        const NOTE =
          "Any job can carry change orders priced by lump sum, unit price, time and material or hourly, whatever its contract type.";
        if (!args.contract_type) {
          const t = await rpc<{ job_kind: string; contract_type: string | null }>(
            sb,
            "mcp_job_terms",
            { _job: job.job_id },
          );
          if (t.job_kind === "service")
            return text(
              `${named(job)}\nThis is a service call: each work order is priced by unit price, time and material, or hourly.`,
            );
          return guide(
            {
              ...text(
                `${named(job)}\nContract type: ${t.contract_type ? CONTRACT_LABEL[t.contract_type] : "not set"}.\n${NOTE}`,
              ),
              structuredContent: t as unknown as JsonValueInput,
            },
            t.contract_type
              ? ""
              : "Ask the member whether the job is lump sum, unit price, cost plus, or time and material, and save their answer.",
          );
        }
        const r = await rpc<{ contract_type: string | null; changed: boolean }>(
          sb,
          "mcp_job_contract_type_set",
          {
            _job: job.job_id,
            _contract_type: args.contract_type === "none" ? null : args.contract_type,
          },
        );
        await audit(sb, job, "job_contract_type", "set", job.job_id);
        return text(
          `${named(job)}\n${r.contract_type ? `Contract type: ${CONTRACT_LABEL[r.contract_type]}.` : "Contract type cleared."}${r.changed ? "" : " (No change.)"}\n${NOTE}`,
        );
      },
    ),
});
