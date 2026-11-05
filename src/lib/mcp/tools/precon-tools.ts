// Pre-construction: the agreement a GC sells before there are drawings to price. The owner pays for the design
// (the architect's or draftsman's fee plus the contractor's own time), keeps the drawings, and often gets the fee
// credited toward the construction contract. One tool: read, price and save the terms, move the agreement along,
// issue its invoices and apply the credit. Full and contract job access only; a Super sees none.
// Written only by mcp_precon_save and mcp_precon_step; invoices and credits are ordinary billing evidence.
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, type Sb } from "../guard";
import { resolveSubmittalJob } from "./submittal-tools";
import type { CardModel, CardSection } from "../cards/model";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import { jobTimeZone } from "../jobs";
import { todayIn } from "../deadlines";
import {
  PHASE_LABEL,
  PHASE_STRIP,
  PRECON_PHASES,
  nextInstallment,
  preconMoney,
  preconNextStep,
  usd,
  type PreconAgreement,
  type PreconInvoice,
  type PreconPayload,
  type PreconPhase,
} from "../../precon/model";

export {
  PRECON_PHASES,
  PHASE_LABEL,
  PHASE_STRIP,
  usd,
  preconMoney,
  nextInstallment,
  preconNextStep,
  type PreconAgreement,
  type PreconInvoice,
  type PreconPayload,
  type PreconPhase,
};

const STATUS_TEXT: Record<PreconAgreement["status"], string> = {
  draft: "Draft",
  sent: "Sent to the owner",
  signed: "Signed",
  closed: "Closed",
};

/** The pre-con card. Pure, so it is tested without a database. */
export function preconCard(p: PreconPayload, note?: string | null): CardModel {
  const job = `${p.job_number} – ${p.job_name}`;
  const a = p.agreement;
  if (!a)
    return {
      state: "ask",
      show_state: false,
      title: "Pre-construction",
      job,
      sections: [
        {
          heading: "Pre-construction",
          kind: "list",
          rows: [{ cells: ["This job has no pre-construction agreement."] }],
        },
      ],
      next_move: preconNextStep(null),
    };
  const money = preconMoney(a);
  const role = a.design_role ? ` (${a.design_role})` : "";
  const sections: CardSection[] = [
    {
      heading: "Where it stands",
      kind: "chips",
      rows: (a.outcome === "lost"
        ? (["agreement", "design", "estimate", "closed"] as PreconPhase[])
        : PHASE_STRIP
      ).map((ph) => ({
        cells: [PHASE_LABEL[ph]],
        tone: ph === a.phase ? ("action" as const) : null,
      })),
    },
    {
      heading: "Price build-up",
      kind: "table",
      columns: ["Line", "Hours", "Amount"],
      rows: [
        {
          cells: [
            `${a.design_partner ?? "Design"}${role}${a.design_days ? `, ${a.design_days} days` : ""}`,
            "",
            usd(a.design_fee_cents),
          ],
        },
        ...(a.parts.markup_cents
          ? [
              {
                cells: [
                  `Markup on design (${a.design_markup_bps / 100}%)`,
                  "",
                  usd(a.parts.markup_cents),
                ],
              },
            ]
          : []),
        ...a.time_lines.map((l) => ({
          cells: [l.label, String(l.hours), usd(Math.round(l.hours * a.hourly_rate_cents))],
        })),
        {
          cells: ["Agreement price", String(a.parts.hours), usd(a.price_cents)],
          tone: "known" as const,
        },
      ],
    },
    {
      heading: "Terms",
      kind: "list",
      rows: [
        {
          cells: [
            a.billing === "full"
              ? `Billed in full at signing`
              : `Billed ${usd(a.installments[0]?.amount_cents)} at signing and ${usd(a.installments[1]?.amount_cents)} at final drawings`,
          ],
        },
        {
          cells: [
            a.owner_owns_drawings
              ? "The owner owns the drawings"
              : "The drawings stay with the contractor",
          ],
        },
        {
          cells: [
            a.credit
              ? `Fee credited to the construction contract if signed within ${a.credit_days} days of final drawings${a.credit_until ? ` (by ${a.credit_until})` : ""}`
              : "No credit toward the construction contract",
          ],
        },
        {
          cells: [
            `${STATUS_TEXT[a.status]}${a.signed_name ? ` by ${a.signed_name} on ${a.signed_on}` : a.sent_on ? ` on ${a.sent_on}` : ""}`,
          ],
        },
      ],
    },
  ];
  if (a.invoices.length || a.credit_invoice)
    sections.push({
      heading: "Invoices",
      kind: "table",
      columns: ["Invoice", "Amount", "Paid", "Status"],
      rows: [
        ...a.invoices.map((i) => ({
          cells: [
            i.number,
            usd(i.net_due_cents),
            usd(i.paid_cents + i.credited_cents),
            i.paid_cents + i.credited_cents >= i.net_due_cents
              ? "Paid"
              : i.status === "void"
                ? "Void"
                : "Open",
          ],
          refId: i.id,
        })),
        ...(a.credit_invoice
          ? [
              {
                cells: [
                  `Credit ${a.credit_invoice.number}`,
                  `−${usd(a.credit_invoice.net_due_cents)}`,
                  "",
                  "Applied to the contract",
                ],
                refId: a.credit_invoice.id,
                tone: "known" as const,
              },
            ]
          : []),
      ],
    });
  return {
    state: "result",
    show_state: false,
    title: "Pre-construction",
    job,
    kpis: [
      { label: "Agreement", value: usd(a.price_cents) },
      { label: "Paid", value: usd(money.paid) },
      { label: "Hours used", value: `${a.hours_used} of ${a.parts.hours}` },
    ],
    sections,
    next_move: `${note ? `${note} ` : ""}${preconNextStep(a)}`,
  };
}

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ data: T; error: { message?: string } | null }>
  )(fn, args);
  if (error) dbError(error);
  return data;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);

export const precon = defineTool({
  name: "precon",
  title: "Pre-construction",
  description:
    "The pre-construction agreement on a job: a contractor sells the owner the design phase before there are drawings to price. " +
    "The price is the designer's fee (architect, draftsman, engineer) plus an optional markup, plus the contractor's own hours (coordination, constructability, schedule and lead times, means and methods, the estimate) at one hourly rate. Athena computes the price; never type one. " +
    "The owner keeps the drawings. Billing is in full at signing, or split half at signing and half at final drawings. An optional credit applies the fee to the construction contract if the owner signs within a window of days after final drawings. " +
    "Actions: get; save (terms, before signing, with expected_version from get, 0 for a new agreement); step (sent, signed with the signer's name, drawings_approved, hours as a running total, won, lost, reopen); issue_invoice (the next installment, recorded as an ordinary billing invoice and linked); apply_credit (posts the fee as a credit against a submitted pay application, then links it). " +
    "Pre-con is optional per job: only start one when the member says this job has a pre-construction agreement. Read every amount, date and name from what the member says; never mark the agreement sent or signed, or the drawings approved, unless the member said so. " +
    "issue_invoice and apply_credit record money on the job: show the member the invoice or credit first and call with confirmed true only after their yes. Nothing is sent to the owner by this tool. " +
    "After each call, walk the member to the next step on the card (for example: Did the owner sign it? Issue invoice 2 for $8,500? Apply the pre-con credit to the first pay application?).",
  inputSchema: {
    action: z.enum(["get", "save", "step", "issue_invoice", "apply_credit"]),
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().uuid().optional(),
    expected_version: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("The agreement version from get; 0 to start a new agreement."),
    design_partner: text(200)
      .nullable()
      .optional()
      .describe("Who draws it: the architect's or draftsman's firm."),
    design_role: z
      .enum(["architect", "draftsman", "engineer", "designer", "other"])
      .nullable()
      .optional(),
    design_fee_cents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("The designer's fee to the contractor, in cents."),
    design_days: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .nullable()
      .optional()
      .describe("How long the designer needs, in days."),
    design_markup_bps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe("Markup on the design fee in basis points (1000 = 10%)."),
    hourly_rate_cents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("The contractor's hourly rate for their own time, in cents."),
    time_lines: z
      .array(
        z.object({
          label: text(120).min(1),
          hours: z.number().positive().max(2000),
          note: text(300).optional(),
        }),
      )
      .max(20)
      .optional()
      .describe("The contractor's own time, in quarter hours."),
    includes: z
      .array(text(200).min(1))
      .max(12)
      .optional()
      .describe("What the owner gets, in the contractor's words."),
    billing: z.enum(["full", "split"]).optional(),
    credit: z
      .boolean()
      .optional()
      .describe(
        "Is the fee credited to the construction contract if the owner hires the contractor?",
      ),
    credit_days: z
      .number()
      .int()
      .min(1)
      .max(730)
      .optional()
      .describe("Days after final drawings the credit stays open. Default 90."),
    note: text(2000).nullable().optional(),
    step: z
      .enum(["sent", "signed", "drawings_approved", "hours", "won", "lost", "reopen"])
      .optional(),
    on: date.optional().describe("The date the step happened. Default today."),
    signed_name: text(200).optional(),
    signed_via: z.enum(["client_page", "paper", "email"]).optional(),
    hours: z
      .number()
      .min(0)
      .max(100000)
      .optional()
      .describe("Total hours used so far against the agreement."),
    pay_application_id: z
      .string()
      .uuid()
      .optional()
      .describe("The construction pay application the credit applies to."),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("precon", ctx, { jobNumber: args.job_number, companyId: args.company_id }, async (sb) => {
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
      if (!job) throw new ToolError("Name the job for this pre-construction agreement.");
      const read = () => rpc<PreconPayload>(sb, "mcp_precon_get", { _job: job.job_id });
      let payload: PreconPayload;
      let note: string | null = null;

      if (args.action === "get") {
        payload = await read();
      } else if (args.action === "save") {
        if (args.expected_version === undefined)
          throw new ToolError(
            "Get the agreement first and pass its version (0 for a new one). Nothing was saved.",
          );
        const keys = [
          "expected_version",
          "design_partner",
          "design_role",
          "design_fee_cents",
          "design_days",
          "design_markup_bps",
          "hourly_rate_cents",
          "time_lines",
          "includes",
          "billing",
          "credit",
          "credit_days",
          "note",
        ] as const;
        const p: Record<string, unknown> = {};
        for (const k of keys) if (args[k] !== undefined) p[k] = args[k];
        payload = await rpc<PreconPayload>(sb, "mcp_precon_save", { _job: job.job_id, _p: p });
        note = `Saved v${payload.agreement?.version}.`;
      } else if (args.action === "step") {
        if (!args.step || args.expected_version === undefined)
          throw new ToolError("Say which step and pass the version from get. Nothing changed.");
        payload = await rpc<PreconPayload>(sb, "mcp_precon_step", {
          _job: job.job_id,
          _p: {
            action: args.step,
            expected_version: args.expected_version,
            ...(args.on ? { on: args.on } : {}),
            ...(args.signed_name ? { name: args.signed_name } : {}),
            ...(args.signed_via ? { via: args.signed_via } : {}),
            ...(args.hours !== undefined ? { hours: args.hours } : {}),
          },
        });
      } else {
        const cur = await read();
        const a = cur.agreement;
        if (!a)
          throw new ToolError("This job has no pre-construction agreement. Nothing was recorded.");
        const today = args.on ?? todayIn(await jobTimeZone(sb, job.job_id));
        if (args.action === "issue_invoice") {
          const next = nextInstallment(a);
          if (!next)
            throw new ToolError(
              a.status !== "signed" && a.status !== "closed"
                ? "The owner hasn't signed the agreement yet. Nothing was invoiced."
                : "Every installment that's due is already invoiced. Nothing was recorded.",
            );
          const number = `PC-${cur.job_number}-${next.index}`;
          if (!args.confirmed) {
            payload = cur;
            note = `Ready to record invoice ${number} for ${usd(next.amount_cents)} dated ${today}. Say yes and I'll record it.`;
          } else {
            const id = crypto.randomUUID();
            await rpc(sb, "mcp_billing_evidence_record", {
              _job: job.job_id,
              _action: "invoice",
              _p: {
                request_id: crypto.randomUUID(),
                id,
                expected_version: 0,
                kind: "invoice",
                document_number: number,
                status: "submitted",
                invoice_date: today,
                effective_date: today,
                source: `Pre-construction agreement, installment ${next.index} of ${a.installments.length}`,
                gross_cents: next.amount_cents,
                withheld_cents: 0,
                released_cents: 0,
                net_due_cents: next.amount_cents,
              },
            });
            payload = await rpc<PreconPayload>(sb, "mcp_precon_step", {
              _job: job.job_id,
              _p: { action: "link_invoice", expected_version: a.version, invoice_id: id },
            });
            note = `Recorded invoice ${number} for ${usd(next.amount_cents)}.`;
          }
        } else {
          if (!a.credit)
            throw new ToolError(
              "This agreement has no credit toward the construction contract. Nothing was recorded.",
            );
          if (a.credit_invoice)
            throw new ToolError(
              `The pre-con credit is already applied (${a.credit_invoice.number}).`,
            );
          if (!args.pay_application_id)
            throw new ToolError(
              "Which pay application does the credit go on? Nothing was recorded.",
            );
          const late = a.credit_until && today > a.credit_until;
          const number = `PC-${cur.job_number}-CREDIT`;
          if (!args.confirmed) {
            payload = cur;
            note = `${late ? `The credit window closed on ${a.credit_until}. ` : ""}Ready to post credit ${number} for ${usd(a.price_cents)} against that pay application. Say yes and I'll record it.`;
          } else {
            const id = crypto.randomUUID();
            await rpc(sb, "mcp_billing_evidence_record", {
              _job: job.job_id,
              _action: "invoice",
              _p: {
                request_id: crypto.randomUUID(),
                id,
                expected_version: 0,
                kind: "credit",
                credit_for: args.pay_application_id,
                document_number: number,
                status: "posted",
                invoice_date: today,
                effective_date: today,
                source: "Pre-construction fee credited to the construction contract",
                net_due_cents: a.price_cents,
              },
            });
            payload = await rpc<PreconPayload>(sb, "mcp_precon_step", {
              _job: job.job_id,
              _p: { action: "link_credit", expected_version: a.version, invoice_id: id },
            });
            note = `Posted credit ${number} for ${usd(a.price_cents)}.`;
          }
        }
      }
      const card = preconCard(payload, note);
      return {
        content: [{ type: "text" as const, text: renderMarkdown(card) }],
        structuredContent: {
          card,
          html: renderHtml(card),
          job_id: payload.job_id,
          status: payload.status,
          agreement: payload.agreement ?? null,
          next_step: preconNextStep(payload.agreement),
        },
        _meta: cardWidgetMeta,
      };
    }),
});
