// Customer page: the shapes the database hands the page server. All strict, so an extra field (a cost, a note,
// an internal flag) makes the page refuse to render rather than show it.
import { z } from "zod";
import { customerProposalSchema } from "../selections/proposal";

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

const decisionSchema = z
  .object({
    decision: z.enum(["approved", "declined", "chosen"]),
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
]);
export type PortalItem = z.infer<typeof portalItemSchema>;

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
export type PortalPage = Omit<PortalView, "photos" | "status"> & {
  photos: SignedPhoto[];
  access_id: string;
  csrf: string;
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

/** The exact words the customer agrees to. Stored with each decision. Wording approved by Marshall (attorney), Nov 4. */
export function approvalStatement(a: {
  kind: "change_order" | "selection";
  company: string;
  label: string;
  price: string;
  scheduleDays?: number | null;
  choice?: string;
}): string {
  if (a.kind === "change_order") {
    const days =
      a.scheduleDays === null || a.scheduleDays === undefined || a.scheduleDays === 0
        ? "no change to the schedule"
        : `${a.scheduleDays > 0 ? "+" : ""}${a.scheduleDays} ${Math.abs(a.scheduleDays) === 1 ? "day" : "days"} to the schedule`;
    return `I approve ${a.label} from ${a.company} for ${a.price} and ${days}, as described on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.`;
  }
  return `I choose the ${a.choice} package for ${a.label} from ${a.company}, ${a.price} total, as described on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.`;
}
