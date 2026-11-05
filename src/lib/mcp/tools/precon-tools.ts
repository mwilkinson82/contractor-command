// Pre-construction: the agreement a GC sells before there are drawings to price. The owner pays for the design
// (the architect's or draftsman's fee plus the contractor's own time), keeps the drawings, and often gets the fee
// credited toward the construction contract. One tool: read, price and save the terms, move the agreement along,
// issue its invoices and apply the credit. Full and contract job access only; a Super sees none.
// Written only by mcp_precon_save and mcp_precon_step; invoices and credits are ordinary billing evidence.
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, isMissingFunction, run, type Sb } from "../guard";
import { resolveSubmittalJob } from "./submittal-tools";
import type { CardModel, CardSection } from "../cards/model";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import { jobTimeZone, memberCompanies } from "../jobs";
import { todayIn } from "../deadlines";
import {
  PHASE_LABEL,
  PHASE_STRIP,
  PRECON_PHASES,
  checkWaiting,
  creditState,
  installmentWords,
  nextInstallment,
  preconMoney,
  preconNextStep,
  usd,
  type PreconAgreement,
  type PreconCreditChange,
  type PreconInvoice,
  type PreconPayload,
  type PreconPhase,
} from "../../precon/model";
import { companyLogoUrl } from "../document-email-brand";
import { emailedLine, notifyAll } from "./customer-portal-tools";
import {
  portalUrl,
  preconDueWords,
  preconTerms,
  wholePrice,
  type PreconAgreementView,
} from "../../customer-portal/model";
import { checkPickupEmail, sendPortalEmail } from "../../customer-portal/email";
import { newToken } from "../file-share";

export {
  PRECON_PHASES,
  PHASE_LABEL,
  PHASE_STRIP,
  usd,
  preconMoney,
  nextInstallment,
  preconNextStep,
  creditState,
  type PreconAgreement,
  type PreconCreditChange,
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
            a.installments.length === 1
              ? `Paid ${installmentWords(a.installments[0]!)}`
              : `Paid in ${a.installments.length} payments: ${a.installments.map((i) => `${usd(i.amount_cents)} ${installmentWords(i)}`).join(", ")}`,
          ],
        },
        ...(a.own_terms ?? []).map((t) => ({ cells: [`Also agreed: ${t}`] })),
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
  const sig = a.signature;
  if (sig)
    sections.push({
      heading: "Signed on the client page",
      kind: "table",
      columns: ["", ""],
      rows: [
        { cells: ["Signed by", `${sig.typed_name} <${sig.email}>`] },
        { cells: ["When", new Date(sig.decided_at).toUTCString().replace("GMT", "UTC")] },
        {
          cells: [
            "Confirmed",
            sig.code_verified ? "With a code emailed to the owner" : "Without a code",
          ],
        },
        ...(sig.consent ? [{ cells: ["Electronic consent", sig.consent] }] : []),
        ...(sig.ip || sig.user_agent
          ? [{ cells: ["From", [sig.ip, sig.user_agent].filter(Boolean).join(" · ")] }]
          : []),
        { cells: ["Document fingerprint", sig.fingerprint] },
        { cells: ["Exact words agreed", sig.statement] },
      ],
    });
  const cc = a.credit_change;
  if (a.invoices.length || cc)
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
                : (checkLabel(a, i.id) ?? "Open"),
          ],
          refId: i.id,
        })),
        ...(cc
          ? [
              {
                cells: [
                  `Credit ${cc.co_number ?? cc.number}`,
                  `−${usd(Math.abs(cc.total_cents ?? a.price_cents))}`,
                  "",
                  creditState(a) === "applied"
                    ? "On the contract"
                    : cc.state === "rejected"
                      ? "Rejected"
                      : "Change order waiting on the owner",
                ],
                refId: cc.id,
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

/** "Owner paying by check, pickup Nov 10" on an open invoice, or null. */
function checkLabel(a: PreconAgreement, invoiceId: string): string | null {
  const c = (a.checks ?? []).find((x) => x.invoice_id === invoiceId);
  if (!c) return null;
  if (c.pickup_on)
    return `Check pickup ${c.pickup_on}${c.pickup_window ? `, ${c.pickup_window}` : ""}`;
  return c.requested_at ? "Owner paying by check, pickup not set yet" : null;
}

/** The agreement as the owner would see it on their page, for reading the terms back before saving or sending. */
export function ownerView(
  a: PreconAgreement,
  job: string,
  change: {
    payments?: { amount_cents: number; due: string; on?: string | null; when?: string | null }[];
    own_terms?: string[];
    construction_line?: boolean;
  } = {},
): PreconAgreementView {
  const pays = change.payments?.length
    ? change.payments.map((p, n) => ({
        index: n + 1,
        amount_cents: p.amount_cents,
        due: p.due as PreconAgreementView["payments"][number]["due"],
        on: p.on ?? null,
        when: p.when
          ? p.when.charAt(0).toLowerCase() + p.when.slice(1).replace(/[.;,]+$/, "")
          : null,
      }))
    : a.installments.map((i, n) => ({
        index: n + 1,
        amount_cents: i.amount_cents,
        due: i.when,
        on: i.on ?? null,
        when: i.step ?? null,
      }));
  return {
    title: `Pre-construction agreement · ${job}`,
    price_cents: a.price_cents,
    design_partner: a.design_partner,
    design_role: a.design_role,
    design_days: a.design_days,
    includes: a.includes,
    payments: pays,
    owner_owns_drawings: a.owner_owns_drawings,
    credit_days: a.credit ? a.credit_days : null,
    own_terms: change.own_terms ?? a.own_terms ?? [],
    construction_line: change.construction_line ?? a.construction_line ?? true,
  };
}

/** The terms read back word for word, numbered as the owner sees them. */
export function termsReadBack(v: PreconAgreementView, company: string, job: string): string {
  return preconTerms(v, company, job)
    .map((t, n) => `${n + 1}. ${t.heading}. ${t.text}`)
    .join("\n");
}

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ data: T; error: { message?: string } | null }>
  )(fn, args);
  if (error) {
    if (isMissingFunction(error as { message?: string; code?: string }))
      throw new ToolError(
        "Pre-construction isn't turned on for this account yet. Nothing was changed.",
      );
    dbError(error as { message: string });
  }
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
    "Actions: get; save (terms, before signing, with expected_version from get, 0 for a new agreement); step (sent, signed with the signer's name, drawings_approved, hours as a running total, won, lost, reopen); issue_invoice (sends the next installment to the owner's client page as a bill they can pay by card or bank, with no fee build-up on it); apply_credit (the fee credit goes on the construction contract as a deductive change order the owner approves: without change_order_id it says how to make it with change_order_record, with one it links it). " +
    "Pre-con is optional per job: only start one when the member says this job has a pre-construction agreement. Read every amount, date and name from what the member says; never mark the agreement sent or signed, or the drawings approved, unless the member said so. " +
    "issue_invoice reaches the owner and apply_credit changes the job's money: show the member what goes out first and call with confirmed true only after their yes. " +
    "Owners sign on their client page: terms saves this agreement's own payments (each an amount in cents and when it's due: signing, final_drawings, date with on, or step with when in the owner's words like \"when you approve the schematic design\"; they must add up to the price), the contractor's own extra terms (own_terms, up to 10 sentences, word for word) and whether to show the standard construction line. Every agreement's terms are different, so ask the member for the payments and anything else they want in it before sending; read them back exactly as the owner will see them and save with confirmed true only on their yes. " +
    "send_to_client_page puts the agreement on the owner's client page to sign (due_on is the sign-by date), and emails them; the owner reads what they get, who draws it, the payments and the terms (never the fee build-up), agrees to sign electronically, and signs with a code we email them and their typed name. Changing the terms after sending takes it off their page until it's sent again. Show the member who gets it and call with confirmed true only after their yes. " +
    "When an owner says they're paying a pre-con bill by check, check_pickup sets when the contractor collects it (on, pickup_window like \"9:00 to 10:00 AM\", pickup_place, pickup_by); the owner sees it on their page and by email. Read it back and call with confirmed true only after the member's yes. Record the check itself as a payment once it's in hand. " +
    "After each call, walk the member to the next step on the card (for example: Did the owner sign it? Send invoice 2 for $8,500 to the owner's client page? Add the pre-con credit to the contract as a change order?).",
  inputSchema: {
    action: z.enum([
      "get",
      "save",
      "step",
      "issue_invoice",
      "apply_credit",
      "terms",
      "send_to_client_page",
      "check_pickup",
    ]),
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
    on: date.optional().describe("step: the date it happened. Default today."),
    signed_name: text(200).optional(),
    signed_via: z.enum(["client_page", "paper", "email"]).optional(),
    hours: z
      .number()
      .min(0)
      .max(100000)
      .optional()
      .describe("Total hours used so far against the agreement."),
    due_on: date
      .optional()
      .describe(
        "issue_invoice: when the owner should pay, today to a year out. Default on receipt.",
      ),
    notify: z
      .boolean()
      .optional()
      .describe("issue_invoice: false to skip the email that the invoice is on their client page."),
    change_order_id: z
      .string()
      .uuid()
      .optional()
      .describe("apply_credit: the deductive change order that carries the credit."),
    payments: z
      .array(
        z.object({
          amount_cents: z.number().int().min(1),
          due: z.enum(["signing", "final_drawings", "date", "step"]),
          on: date.optional(),
          when: text(120).optional(),
        }),
      )
      .max(12)
      .optional()
      .describe("terms: the owner's payments in order; they must add up to the agreement price."),
    own_terms: z
      .array(text(600).min(1))
      .max(10)
      .optional()
      .describe("terms: the contractor's own extra terms, word for word."),
    construction_line: z
      .boolean()
      .optional()
      .describe(
        "terms: show the line that building needs its own construction contract. Default true.",
      ),
    invoice_id: z
      .string()
      .uuid()
      .optional()
      .describe("check_pickup: the pre-con invoice; default the one the owner is paying by check."),
    pickup_window: text(60).optional().describe("check_pickup: the time, like 9:00 to 10:00 AM."),
    pickup_place: text(200).optional().describe("check_pickup: where, like the job site."),
    pickup_by: text(120).optional().describe("check_pickup: who collects it."),
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
      } else if (
        args.action === "terms" ||
        args.action === "send_to_client_page" ||
        args.action === "check_pickup"
      ) {
        const cur = await read();
        const a = cur.agreement;
        if (!a)
          throw new ToolError(
            "This job has no pre-construction agreement. Start one first. Nothing was saved.",
          );
        const company =
          (await memberCompanies(sb)).find((c) => c.id === job.company_id)?.name ?? "Your company";
        const who = (cur.portal_customers ?? []).map((x) => `${x.name} <${x.email}>`).join(", ");
        if (args.action === "terms") {
          if (
            args.payments === undefined &&
            args.own_terms === undefined &&
            args.construction_line === undefined
          )
            throw new ToolError(
              "Send the payments, your own terms or the construction line. Nothing was saved.",
            );
          if (args.payments?.length) {
            const total = args.payments.reduce((t, p) => t + p.amount_cents, 0);
            if (total !== a.price_cents)
              throw new ToolError(
                `The payments add up to ${usd(total)}, and the agreement price is ${usd(a.price_cents)}. Make them match. Nothing was saved.`,
              );
          }
          const v = ownerView(a, job.name, {
            payments: args.payments,
            own_terms: args.own_terms,
            construction_line: args.construction_line,
          });
          if (!args.confirmed) {
            payload = cur;
            note = `Here are the terms exactly as the owner will read them:\n${termsReadBack(v, company, job.name)}\nShould I save these terms on the agreement?`;
          } else {
            payload = await rpc<PreconPayload>(sb, "mcp_precon_terms_save", {
              _job: job.job_id,
              _p: {
                expected_version: a.version,
                ...(args.payments !== undefined
                  ? {
                      payments: args.payments.map((p) => ({
                        amount_cents: p.amount_cents,
                        due: p.due,
                        ...(p.due === "date" ? { on: p.on } : {}),
                        ...(p.due === "step" ? { when: p.when } : {}),
                      })),
                    }
                  : {}),
                ...(args.own_terms !== undefined ? { own_terms: args.own_terms } : {}),
                ...(args.construction_line !== undefined
                  ? { construction_line: args.construction_line }
                  : {}),
              },
            });
            note = `Saved the terms (v${payload.agreement?.version}).${a.portal ? " The earlier version came off the owner's client page, so send it again for them to sign." : ""}`;
          }
        } else if (args.action === "send_to_client_page") {
          if (!args.confirmed) {
            payload = cur;
            const v = ownerView(a, job.name);
            note = !who
              ? "Nobody has a client page on this job yet. Invite the owner with customer_portal invite first, then I'll send the agreement."
              : `Ready to put the ${wholePrice(a.price_cents)} pre-construction agreement on ${who}'s client page to sign${args.due_on ? `, sign by ${args.due_on}` : ""}, with an email that it's there. They'll see what they get, who draws it, the payments (${v.payments.map((p) => `${wholePrice(p.amount_cents)} ${preconDueWords(p)}`).join(", ")}) and these terms, never your fee build-up:\n${termsReadBack(v, company, job.name)}\nThey agree to sign electronically and sign with a code we email them and their typed name. Should I send it?`;
          } else {
            const r = await rpc<
              PreconPayload & {
                label: string;
                recipients: { access_id: string; email: string; name: string }[];
              }
            >(sb, "mcp_precon_portal_send", {
              _job: job.job_id,
              _p: { expected_version: a.version, ...(args.due_on ? { due_on: args.due_on } : {}) },
            });
            payload = { ...cur, agreement: r.agreement };
            const sent =
              args.notify === false
                ? ["No email went out; it shows on their client page."]
                : await notifyAll(
                    { recipients: r.recipients, company, job_name: job.name },
                    "decision",
                    r.label,
                    await companyLogoUrl(sb, job.company_id),
                    "precon_agreement",
                  );
            note = ["Sent the agreement to the owner's client page to sign.", ...sent].join(" ");
          }
        } else {
          const waiting = checkWaiting(a);
          const invoiceId = args.invoice_id ?? waiting?.invoice.id;
          const inv = a.invoices.find((i) => i.id === invoiceId);
          if (!inv)
            throw new ToolError("Say which pre-con invoice the check is for. Nothing was set.");
          if (!args.on)
            throw new ToolError("Say the day you'll collect the check. Nothing was set.");
          const day = new Date(`${args.on}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          });
          const owner = cur.portal_customers?.[0]?.name ?? "The owner";
          if (!args.confirmed) {
            payload = cur;
            note = `Set the check pickup for ${inv.number} (${wholePrice(inv.net_due_cents)}) on ${day}${args.pickup_window ? `, ${args.pickup_window}` : ""}${args.pickup_place ? ` at ${args.pickup_place}` : ""}${args.pickup_by ? `, with ${args.pickup_by} collecting` : ""}? ${owner} sees it on their page${who ? " and gets an email" : ""}.`;
          } else {
            const r = await rpc<
              PreconPayload & {
                number: string;
                amount_cents: number;
                pickup_on: string;
                pickup_window: string | null;
                pickup_place: string | null;
                pickup_by: string | null;
                recipients: { access_id: string; email: string; name: string }[];
              }
            >(sb, "mcp_precon_check_pickup", {
              _job: job.job_id,
              _p: {
                invoice_id: inv.id,
                on: args.on,
                ...(args.pickup_window ? { window: args.pickup_window } : {}),
                ...(args.pickup_place ? { place: args.pickup_place } : {}),
                ...(args.pickup_by ? { by: args.pickup_by } : {}),
              },
            });
            payload = { ...cur, agreement: r.agreement };
            const logo = await companyLogoUrl(sb, job.company_id);
            const sent: string[] = [];
            if (args.notify !== false)
              for (const x of r.recipients) {
                const res = await sendPortalEmail(
                  checkPickupEmail({
                    to: x.email,
                    name: x.name,
                    company,
                    jobName: job.name,
                    amount: wholePrice(r.amount_cents),
                    day,
                    window: r.pickup_window,
                    place: r.pickup_place,
                    by: r.pickup_by,
                    link: `${portalUrl(x.access_id)}?s=billing`,
                    logo,
                    nonce: newToken(),
                  }),
                );
                sent.push(
                  emailedLine(x.email, res),
                );
              }
            note = [
              `Done. ${owner} has the pickup date. When you have the check, tell me and I'll record it as paid.`,
              ...sent,
            ].join(" ");
          }
        }
      } else {
        const cur = await read();
        const a = cur.agreement;
        if (!a)
          throw new ToolError("This job has no pre-construction agreement. Nothing was recorded.");
        const today = todayIn(await jobTimeZone(sb, job.job_id));
        if (args.action === "issue_invoice") {
          const next = nextInstallment(a);
          if (!next)
            throw new ToolError(
              a.status !== "signed" && a.status !== "closed"
                ? "The owner hasn't signed the agreement yet. Nothing was billed."
                : a.invoices.filter((i) => i.status !== "void").length < a.installments.length
                  ? "The next payment is due when the owner approves the final drawings. Tell me when they do. Nothing was billed."
                  : "Every installment is already billed. Nothing was billed.",
            );
          const who = (cur.portal_customers ?? []).map((x) => `${x.name} <${x.email}>`).join(", ");
          if (!args.confirmed) {
            payload = cur;
            note = `Ready to send payment ${next.index} for ${usd(next.amount_cents)} (due ${next.words})${args.due_on ? `, pay by ${args.due_on}` : ""} to ${who ? `${who} on their client page, with an email that it's there` : "the owner's client page (nobody has one on this job yet, so invite the owner first or it waits there)"}. They can pay there by card or bank when your payments are set up, or tell you they're paying by check. They see what the agreement includes, never your fee build-up. Say yes and I'll send it.`;
          } else {
            const r = await rpc<
              PreconPayload & {
                number: string;
                label: string;
                amount_cents: number;
                recipients: { access_id: string; email: string; name: string }[];
              }
            >(sb, "mcp_precon_invoice_share", {
              _job: job.job_id,
              _p: { expected_version: a.version, ...(args.due_on ? { due_on: args.due_on } : {}) },
            });
            payload = { ...cur, agreement: r.agreement };
            let sent: string[];
            if (!r.recipients.length)
              sent = [
                "Nobody has a client page on this job yet, so nobody was emailed. Invite the owner with customer_portal invite.",
              ];
            else if (args.notify === false)
              sent = ["No email went out; it shows on their client page."];
            else
              sent = await notifyAll(
                {
                  recipients: r.recipients,
                  company:
                    (await memberCompanies(sb)).find((c) => c.id === job.company_id)?.name ??
                    "Your contractor",
                  job_name: job.name,
                },
                "decision",
                r.label,
                await companyLogoUrl(sb, job.company_id),
                "service_invoice",
              );
            note = [
              `Sent invoice ${r.number} for ${usd(r.amount_cents)} to the client page.`,
              ...sent,
            ].join(" ");
          }
        } else {
          if (!a.credit)
            throw new ToolError(
              "This agreement has no credit toward the construction contract. Nothing was recorded.",
            );
          const state = creditState(a);
          if (state === "applied")
            throw new ToolError(
              `The pre-con credit is already on the contract (${a.credit_change?.co_number ?? a.credit_change?.number}).`,
            );
          if (state === "waiting" && !args.change_order_id)
            throw new ToolError(
              `The pre-con credit is change order ${a.credit_change?.number}, ${a.credit_change?.state}. Move it on with change_order_record: send it to the owner to approve, then execute it. Nothing was recorded.`,
            );
          if (!args.change_order_id) {
            if (!a.contract_sov)
              throw new ToolError(
                "The credit goes on the construction contract, and this job has no contract schedule of values yet. Set up the SOV first, then apply the credit. Nothing was recorded.",
              );
            const late = a.credit_until && today > a.credit_until;
            payload = cur;
            note =
              `${late ? `The credit window closed on ${a.credit_until}, so the credit is your call. ` : ""}` +
              `The ${usd(a.price_cents)} credit goes on the contract as a deductive change order with no time, so the owner approves it on their client page and every pay application, the client page and card or bank payments show the lower amount. ` +
              `Make it with change_order_record (action create, origin contractor, title "Pre-construction credit", schedule_days 0, pricing_basis lump_sum, one line: category other, description "Pre-construction credit", quantity 1, unit LS, unit_rate_cents ${-a.price_cents}, source "Pre-construction agreement credit clause"; reference kind contract, citation "Pre-construction agreement, signed ${a.signed_on ?? "by the owner"}"), then call apply_credit with its change_order_id to link it.`;
          } else if (!args.confirmed) {
            payload = cur;
            note = `Ready to link that change order as the ${usd(a.price_cents)} pre-con credit. Say yes and I'll link it.`;
          } else {
            payload = await rpc<PreconPayload>(sb, "mcp_precon_step", {
              _job: job.job_id,
              _p: {
                action: "link_credit",
                expected_version: a.version,
                change_order_id: args.change_order_id,
              },
            });
            note = `Linked the pre-con credit to change order ${payload.agreement?.credit_change?.number}.`;
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
