// Customer page: the shapes the database hands the page server. All strict, so an extra field (a cost, a note,
// an internal flag) makes the page refuse to render rather than show it.
import { z } from "zod";
import { customerProposalSchema } from "../selections/proposal";
import { timeSentence } from "../selections/change-terms";
import { displayPrice } from "../selections/format";

export const PORTAL_ORIGIN = "https://app.meetathena.io";
export const portalInviteUrl = (token: string) => `${PORTAL_ORIGIN}/c/i/${token}`;
export const portalUrl = (accessId: string) => `${PORTAL_ORIGIN}/c/${accessId}`;

export const UUID = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const nstr = z.string().nullable();

export const changeOrderViewSchema = z
  .object({
    number: z.string(),
    title: z.string(),
    why: nstr,
    scope: nstr,
    price_cents: z.number().int(),
    schedule_days: z.number().nullable(),
    due_on: nstr,
  })
  .strict();
export type ChangeOrderView = z.infer<typeof changeOrderViewSchema>;

export const selectionViewSchema = z.object({ proposal: customerProposalSchema }).strict();

const cents = z.number().int();
/** One SOV line as the owner sees it: no cost, fee, retainage inputs or sources. */
export const payAppLineSchema = z
  .object({
    item: z.string(),
    description: z.string(),
    scheduled_cents: cents,
    previous_cents: cents,
    this_period_cents: cents,
    /** Materials stored on site or off, not yet installed. */
    stored_cents: cents,
    completed_to_date_cents: cents,
    percent_complete: z.number().nullable(),
  })
  .strict();
/** A shared pay application, frozen when shared. A strict whitelist: anything else makes the page refuse to render. */
export const payAppViewSchema = z
  .object({
    number: z.string(),
    period_start: isoDate,
    period_end: isoDate,
    original_contract_cents: cents.nullable(),
    approved_changes_cents: cents.nullable(),
    contract_total_cents: cents,
    lines: z.array(payAppLineSchema).min(1).max(100),
    totals: z
      .object({
        completed_and_stored_cents: cents,
        retainage_percent: z.number().nullable(),
        retainage_cents: cents,
        previous_certified_cents: cents,
        current_due_cents: cents,
      })
      .strict(),
  })
  .strict();
export type PayAppView = z.infer<typeof payAppViewSchema>;

/** A work order the customer approves before work starts: how it's billed, the lines, the limit. A strict whitelist. */
export const workOrderViewSchema = z
  .object({
    number: z.string(),
    title: z.string(),
    basis: z.enum(["unit_price", "time_and_material", "hourly"]),
    basis_label: z.string(),
    scope: nstr,
    findings: nstr,
    site_address: nstr,
    lines: z
      .array(
        z
          .object({
            kind: z.enum(["item", "labor", "material"]),
            description: z.string(),
            detail: nstr,
            amount_cents: cents,
          })
          .strict(),
      )
      .max(100),
    totals: z
      .object({
        labor_cents: cents,
        material_cents: cents,
        items_cents: cents,
        markup_cents: cents,
        estimate_cents: cents,
        cap_cents: cents.nullable(),
        fee_credit_cents: cents,
      })
      .strict(),
    terms: z.string(),
  })
  .strict();
export type WorkOrderView = z.infer<typeof workOrderViewSchema>;

/** A service invoice: the upfront service call fee, or the bill for a finished work order. A strict whitelist. */
export const serviceInvoiceViewSchema = z
  .object({
    number: z.string(),
    stage: z.enum(["fee", "bill"]),
    title: z.string(),
    work_order: nstr,
    site_address: nstr,
    issue: nstr,
    lines: z
      .array(z.object({ description: z.string(), detail: nstr, amount_cents: cents }).strict())
      .min(1)
      .max(100),
    signoff: z.object({ name: z.string(), date: isoDate }).strict().nullable(),
    totals: z
      .object({ subtotal_cents: cents, credit_cents: cents, current_due_cents: cents })
      .strict(),
    note: nstr,
  })
  .strict();
export type ServiceInvoiceView = z.infer<typeof serviceInvoiceViewSchema>;

/** A pre-construction agreement for the owner to sign: what they get, who draws it, the price, the payments and the
 * terms, in the contractor's words. A strict whitelist: the fee build-up (design fee, hours, markup) never reaches it. */
export const preconPaymentSchema = z
  .object({
    index: z.number().int().min(1).max(12),
    amount_cents: cents,
    due: z.enum(["signing", "final_drawings", "date", "step"]),
    on: nstr,
    when: nstr,
  })
  .strict();
export type PreconPayment = z.infer<typeof preconPaymentSchema>;
export const preconAgreementViewSchema = z
  .object({
    title: z.string(),
    price_cents: cents,
    design_partner: nstr,
    design_role: nstr,
    design_days: z.number().int().nullable(),
    includes: z.array(z.string()).max(12),
    payments: z.array(preconPaymentSchema).min(1).max(12),
    owner_owns_drawings: z.boolean(),
    credit_days: z.number().int().nullable(),
    own_terms: z.array(z.string()).max(10),
    construction_line: z.boolean(),
  })
  .strict();
export type PreconAgreementView = z.infer<typeof preconAgreementViewSchema>;

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
/** A price as an agreement reads it: "$17,000", "$5,250.50". */
export const wholePrice = (c: number, currency = "USD") =>
  displayPrice(c, currency).replace(/\.00$/, "");
/** When a payment is due, read after its amount: "when you sign", "on December 1, 2026". Same words as the SQL. */
export function preconDueWords(p: Pick<PreconPayment, "due" | "on" | "when">): string {
  if (p.due === "signing") return "when you sign";
  if (p.due === "final_drawings") return "when you approve the final drawings";
  if (p.due === "date" && p.on) return `on ${longDate(p.on)}`;
  return p.when ?? "as agreed";
}
/** "When you sign", for a heading or a row label. */
export const preconDueLabel = (p: Pick<PreconPayment, "due" | "on" | "when">) => {
  const w = preconDueWords(p);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const NUMBER_WORD = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const joinAnd = (xs: string[]) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : xs.length === 2
      ? `${xs[0]} and ${xs[1]}`
      : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;

/**
 * The agreement's terms, in order, as the owner reads and signs them: each a heading and its sentence. Built from the
 * agreement itself (the contractor's own payments and own terms), so every agreement reads its own way. Wording shown to
 * and approved by Marshall (attorney) in the Nov 5 preview.
 */
export function preconTerms(
  v: PreconAgreementView,
  company: string,
  job: string,
  currency = "USD",
): { heading: string; text: string }[] {
  const money = (c: number) => wholePrice(c, currency);
  const partner = v.design_partner
    ? ` works with ${v.design_partner}${v.design_role ? `, the ${v.design_role},` : ""} to design ${job}`
    : ` designs ${job}`;
  const out = [
    {
      heading: "What you get",
      text: `${company}${partner} and gives you everything listed under What you get.${
        v.design_days ? ` Design is planned to take about ${v.design_days} days from signing.` : ""
      }`,
    },
  ];
  const pays = v.payments;
  out.push({
    heading: "Price and payments",
    text:
      pays.length === 1
        ? `The price is ${money(v.price_cents)}, paid ${preconDueWords(pays[0]!)}.`
        : `The price is ${money(v.price_cents)}, paid in ${NUMBER_WORD[pays.length] ?? pays.length} payments: ${joinAnd(
            pays.map((p) => `${money(p.amount_cents)} ${preconDueWords(p)}`),
          )}.`,
  });
  if (v.owner_owns_drawings)
    out.push({
      heading: "Your drawings",
      text: "You own the final drawings and can use them with any builder.",
    });
  if (v.credit_days)
    out.push({
      heading: "Credit toward building",
      text: `If you hire ${company} to build the project within ${v.credit_days} days of the final drawings, the full ${money(v.price_cents)} is credited to your construction contract.`,
    });
  for (const t of v.own_terms) out.push({ heading: "Also agreed", text: t });
  if (v.construction_line)
    out.push({
      heading: "Construction",
      text: "This agreement covers design and pre-construction only. Building the project needs its own construction contract.",
    });
  return out;
}

/** The owner's agreement to do business electronically, stored word for word with the signature. Approved by Marshall, Nov 5. */
export function preconConsent(company: string, email: string): string {
  return `I agree to review and sign this agreement electronically. ${company} can send me the agreement, my signed copy and notices about it by email at ${email} and on this page. I can ask ${company} for a paper copy at no charge, and I can stop doing business electronically by telling them. That doesn't undo anything I've already signed.`;
}
/** The signature statement. Approved by Marshall, Nov 5. */
export function preconStatement(company: string, job: string, price: string): string {
  return `I have read the pre-construction agreement from ${company} for ${job}, ${price}, and I agree to its terms as shown on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.`;
}

/** What a work order approval is for, in the customer's words: a fixed total, or the actual time up to the limit. */
export function workOrderPrice(v: WorkOrderView, currency = "USD"): string {
  const t = v.totals;
  if (v.basis === "unit_price") return displayPrice(t.estimate_cents, currency);
  if (t.cap_cents !== null) return `the actual cost, up to ${displayPrice(t.cap_cents, currency)}`;
  return `the actual cost, estimated at ${displayPrice(t.estimate_cents, currency)}`;
}

/** The name the member confirmed when sharing, exactly; a bare number reads "Payment Application 3". Same rule as the SQL label. */
export function payAppLabel(number: string): string {
  const n = number.trim();
  return /^#?\d{1,4}$/.test(n) ? `Payment Application ${n.replace(/^#+/, "")}` : n;
}

const decisionSchema = z
  .object({
    decision: z.enum(["approved", "declined", "chosen", "signed"]),
    choice: z.enum(["good", "better", "best"]).nullable(),
    typed_name: z.string(),
    decided_at: z.string(),
    note: nstr,
    code_verified: z.boolean(),
  })
  .strict();

const itemBase = {
  id: UUID,
  shared_on: isoDate,
  due_on: nstr,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  decision: decisionSchema.nullable(),
};
export const portalItemSchema = z.discriminatedUnion("kind", [
  z.object({ ...itemBase, kind: z.literal("change_order"), view: changeOrderViewSchema }).strict(),
  z.object({ ...itemBase, kind: z.literal("selection"), view: selectionViewSchema }).strict(),
  z.object({ ...itemBase, kind: z.literal("pay_app"), view: payAppViewSchema }).strict(),
  z.object({ ...itemBase, kind: z.literal("work_order"), view: workOrderViewSchema }).strict(),
  z
    .object({ ...itemBase, kind: z.literal("service_invoice"), view: serviceInvoiceViewSchema })
    .strict(),
  z
    .object({ ...itemBase, kind: z.literal("precon_agreement"), view: preconAgreementViewSchema })
    .strict(),
]);
export type PortalItem = z.infer<typeof portalItemSchema>;

export const portalCheckSchema = z
  .object({
    item_id: UUID,
    requested_at: nstr,
    note: nstr,
    pickup_on: nstr,
    pickup_window: nstr,
    pickup_place: nstr,
    pickup_by: nstr,
  })
  .strict();
export type PortalCheck = z.infer<typeof portalCheckSchema>;

export const portalViewSchema = z
  .object({
    status: z.literal("ok"),
    customer: z.object({ name: z.string(), email: z.string() }).strict(),
    contractor: z
      .object({ name: z.string(), pm_name: nstr, pm_title: nstr, pm_email: nstr })
      .strict(),
    job: z
      .object({
        number: z.string(),
        name: z.string(),
        completion_date: nstr,
        today: isoDate,
        /** True once the job has a known contract value: a package change is then a change order. */
        under_contract: z.boolean().optional(),
        /** A service call's page shows work orders and bills; a project's shows the full job. */
        kind: z.enum(["project", "service"]).optional(),
      })
      .strict(),
    updates: z
      .array(z.object({ week_of: isoDate, title: z.string(), body: z.string() }).strict())
      .max(12),
    dailies: z
      .array(
        z
          .object({
            date: isoDate,
            weather: nstr,
            manpower: nstr,
            work: z.array(z.string().nullable()),
          })
          .strict(),
      )
      .max(10),
    photos: z
      .array(
        z
          .object({ id: UUID, taken_on: isoDate, area: nstr, work: nstr, storage_path: z.string() })
          .strict(),
      )
      .max(60),
    milestones: z
      .array(z.object({ name: z.string(), date: z.string(), done: z.boolean() }).strict())
      .max(40),
    items: z.array(portalItemSchema),
    /** Bills the owner can pay by check from this page (pre-con bills for now). */
    check_items: z.array(UUID).optional(),
    /** The owner paying by check, and the pickup the contractor set. */
    checks: z.array(portalCheckSchema).optional(),
  })
  .strict();
export type PortalView = z.infer<typeof portalViewSchema>;

/** A photo after the server signed its storage path; the path itself never reaches the page. */
export type SignedPhoto = {
  id: string;
  taken_on: string;
  area: string | null;
  work: string | null;
  url: string | null;
};
/** One message in the customer's conversation with the team, as the customer sees it. */
export const portalMessageSchema = z
  .object({
    id: UUID,
    author_kind: z.enum(["client", "team"]),
    author_name: z.string(),
    body: z.string(),
    created_at: z.string(),
    item_id: UUID.nullable(),
    about_label: nstr,
  })
  .strict();
export type PortalMessage = z.infer<typeof portalMessageSchema>;
export const portalMessagesSchema = z
  .object({
    status: z.literal("ok"),
    /** Team messages the customer hadn't opened before this read. */
    unread: z.number().int().min(0),
    messages: z.array(portalMessageSchema).max(200),
  })
  .strict();

/** One online payment on a pay application, as the customer may see it. Never Athena's fee. */
export const portalPaymentSchema = z.object({
  item_id: UUID,
  status: z.enum([
    "open",
    "processing",
    "paid",
    "failed",
    "expired",
    "refunded",
    "partially_refunded",
  ]),
  method: z.string().nullable(),
  amount_cents: z.number().int(),
  refunded_cents: z.number().int().nullable().optional(),
  paid_at: z.string().nullable().optional(),
  test: z.boolean(),
  updated_at: z.string().nullable().optional(),
});
export type PortalPayment = z.infer<typeof portalPaymentSchema>;

/** Whether the contractor takes payments on this page, and the customer's payments on this job. */
export const portalPaymentsSchema = z.object({
  status: z.literal("ok"),
  accepting: z.boolean(),
  test: z.boolean(),
  card: z.boolean(),
  bank: z.boolean(),
  card_max_cents: z.number().int(),
  payments: z.array(portalPaymentSchema).max(500),
  /** Wire and check payments the contractor recorded, per shared pay application. */
  recorded: z
    .array(
      z.object({
        item_id: UUID,
        amount_cents: z.number().int(),
        method: z.enum(["wire", "check", "mixed"]),
        received_on: z.string().nullable(),
      }),
    )
    .max(500)
    .default([]),
});
export type PortalPayments = Omit<z.infer<typeof portalPaymentsSchema>, "status">;

export type PortalPage = Omit<PortalView, "photos" | "status"> & {
  photos: SignedPhoto[];
  access_id: string;
  csrf: string;
  /** The customer's conversation with the team. Null when it couldn't be read; the rest of the page still shows. */
  messages?: { unread: number; list: PortalMessage[] } | null;
  /** Online payments for pay applications. Absent or null: the page shows no way to pay. */
  payments?: PortalPayments | null;
};

export const inviteOpenSchema = z.union([
  z
    .object({
      status: z.literal("ok"),
      access_id: UUID,
      email: z.string(),
      name: z.string(),
      company: z.string(),
      job_name: z.string(),
      job_number: z.string(),
    })
    .strict(),
  z.object({ status: z.enum(["unknown", "expired", "revoked", "closed"]) }).strict(),
]);
export type InviteOpen = z.infer<typeof inviteOpenSchema>;

export const statusOnly = z.object({ status: z.string() }).passthrough();

/** Masks an address for display before sign-in: "rosa@harbor.com" -> "r***@harbor.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your email";
  return `${email[0]}***${email.slice(at)}`;
}

export const TIER_NAME = { good: "Good", better: "Better", best: "Best" } as const;

/**
 * The exact words the customer agrees to. Stored with each decision. Change order and selection wording approved by
 * Marshall (attorney), Nov 4; pay application wording approved by Marshall, Nov 5. Work order wording follows the change
 * order wording (Nov 5 service calls build); the price is workOrderPrice.
 */
export function approvalStatement(a: {
  kind: "change_order" | "selection" | "pay_app" | "work_order";
  company: string;
  label: string;
  /** The price, the package total, or for a pay application the amount due now. */
  price: string;
  scheduleDays?: number | null;
  choice?: string;
  /** Pay application: the last day of work it bills for, as shown on the page. */
  periodEnd?: string;
  /**
   * A package choice on a job under contract that changes the price or the time: the choice is the
   * change order approval, for this signed difference (as shown, e.g. "+$4,949.10").
   */
  changeOrder?: { difference: string } | null;
}): string {
  if (a.kind === "work_order")
    return `I approve ${a.label} from ${a.company} for ${a.price}, as described on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.`;
  if (a.kind === "pay_app")
    return `I approve ${a.label} from ${a.company} for ${a.price} due for work through ${a.periodEnd ?? ""}, as described on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.`;
  if (a.kind === "change_order") {
    const days =
      a.scheduleDays === null || a.scheduleDays === undefined || a.scheduleDays === 0
        ? "no change to the schedule"
        : `${a.scheduleDays > 0 ? "+" : ""}${a.scheduleDays} ${Math.abs(a.scheduleDays) === 1 ? "day" : "days"} to the schedule`;
    return `I approve ${a.label} from ${a.company} for ${a.price} and ${days}, as described on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.`;
  }
  const sign =
    "I understand that typing my name and confirming with the emailed code is my electronic signature.";
  const days = a.scheduleDays ?? 0;
  if (a.changeOrder)
    return `I choose the ${a.choice} package for ${a.label} from ${a.company} and approve it as a change order to my contract for ${a.changeOrder.difference}, as described on this page. ${timeSentence(days)} ${sign}`;
  return `I choose the ${a.choice} package for ${a.label} from ${a.company}, ${a.price} total, as described on this page.${days > 0 ? ` ${timeSentence(days)}` : ""} ${sign}`;
}

/**
 * What a package choice signs. On a job under contract, a package that changes the price or the
 * time is a change order, and the customer's choice approves it for the signed difference, with
 * the added time stated. Otherwise the choice sets the proposal price.
 */
export function choiceTerms(
  underContract: boolean | null | undefined,
  pk: { difference_cents: number; schedule_days?: number },
  currency: string,
): { days: number; changeOrder: { difference: string } | null } {
  const days = pk.schedule_days ?? 0;
  const c = pk.difference_cents;
  const difference = `${c > 0 ? "+" : c < 0 ? "-" : ""}${displayPrice(Math.abs(c), currency)}`;
  return { days, changeOrder: underContract && (c !== 0 || days > 0) ? { difference } : null };
}
