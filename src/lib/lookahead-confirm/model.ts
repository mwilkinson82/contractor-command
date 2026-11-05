// Look-ahead date confirmations: a supplier confirms a delivery date, a sub confirms a crew start or work date,
// from a link Athena emails them (supabase/migrations/20261105162000_athena_lookahead_confirms.sql). Shared by the
// public page, the request email and the MCP tool.
import { z } from "zod";
import type { JobNoticeInput } from "../notices/send";

export const CONFIRM_ORIGIN = "https://app.meetathena.io";
export const confirmUrl = (token: string) => `${CONFIRM_ORIGIN}/l/${token}`;

/** How long a link works when the member doesn't say, and the most it may. */
export const CONFIRM_DEFAULT_DAYS = 14;
export const CONFIRM_MAX_DAYS = 30;

export const PARTY_KINDS = ["supplier", "sub"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];
export const ASK_KINDS = ["delivery", "start", "work"] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export const ANSWERS = ["confirmed", "proposed_new_date", "declined"] as const;
export type Answer = (typeof ANSWERS)[number];

/** What the date is for, as it reads in a sentence: "confirm your delivery date". */
export const ASK_NOUN: Record<AskKind, string> = {
  delivery: "delivery",
  start: "crew start",
  work: "work",
};
/** A supplier confirms a delivery; a sub confirms a crew start or a work date. */
export const askAllowed = (party: PartyKind, ask: AskKind) =>
  party === "supplier" ? ask === "delivery" : ask !== "delivery";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

export const publicViewSchema = z.object({
  id: z.string().uuid(),
  company: z.string(),
  logo_url: z.string().nullable().optional(),
  job_number: z.string(),
  job_name: z.string(),
  pm_name: z.string().nullable().optional(),
  party_kind: z.enum(PARTY_KINDS),
  party_name: z.string(),
  ask_kind: z.enum(ASK_KINDS),
  what: z.string(),
  asked_date: isoDate,
  window_end: isoDate.nullable().optional(),
  expires_at: z.string(),
  answer: z.enum(["asked", ...ANSWERS]),
  response_date: isoDate.nullable().optional(),
  responder_name: z.string().nullable().optional(),
  response_note: z.string().nullable().optional(),
  responded_at: z.string().nullable().optional(),
});
export type PublicView = z.infer<typeof publicViewSchema>;

export const openSchema = z.discriminatedUnion("status", [
  publicViewSchema.extend({ status: z.literal("ok") }),
  z.object({
    status: z.enum(["expired", "cancelled"]),
    company: z.string().nullable().optional(),
    logo_url: z.string().nullable().optional(),
  }),
  z.object({ status: z.literal("unknown") }),
]);
export type OpenResult = z.infer<typeof openSchema>;

export const respondSchema = z.discriminatedUnion("status", [
  publicViewSchema.extend({ status: z.literal("ok"), job_id: z.string().uuid() }),
  publicViewSchema.extend({ status: z.literal("answered"), job_id: z.string().uuid() }),
  z.object({
    status: z.literal("invalid"),
    reason: z.enum(["answer", "name", "note", "date", "same_date"]),
  }),
  z.object({ status: z.enum(["slow_down", "unknown", "expired", "cancelled"]) }),
]);
export type RespondResult = z.infer<typeof respondSchema>;

/** "Nov 12" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
/** "Thursday, Nov 12, 2026" */
export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
/** "Nov 12" or "Nov 12 to Nov 14" when the date has a window. */
export function dateSpan(asked: string, windowEnd?: string | null): string {
  return windowEnd && windowEnd.slice(0, 10) !== asked.slice(0, 10)
    ? `${shortDate(asked)} to ${shortDate(windowEnd)}`
    : shortDate(asked);
}

/**
 * The job notice for an answer: "Acme Supply confirmed delivery Nov 12", "Rivera Drywall proposed Nov 14 instead
 * of Nov 12", "Rivera Drywall can't make crew start Nov 12". A proposed date never moves the look-ahead; the
 * detail says the super or the PM makes the call.
 */
export function answerNotice(v: PublicView & { job_id: string }): JobNoticeInput {
  const asked = dateSpan(v.asked_date, v.window_end);
  const noun = ASK_NOUN[v.ask_kind];
  const answer = v.answer === "asked" ? "confirmed" : v.answer;
  const title =
    answer === "confirmed"
      ? `${v.party_name} confirmed ${noun} ${asked}`
      : answer === "proposed_new_date"
        ? `${v.party_name} proposed ${shortDate(v.response_date)} instead of ${asked}`
        : `${v.party_name} can't make ${noun} ${asked}`;
  const call =
    answer === "proposed_new_date"
      ? "This needs the super's or PM's call. The look-ahead still shows the date asked; nothing moved."
      : answer === "declined"
        ? "This needs the super's or PM's call. The look-ahead still shows the date asked."
        : null;
  const detail = [
    `${v.what}.`,
    v.responder_name ? `Answered by ${v.responder_name}.` : null,
    v.response_note ? `Their note: ${v.response_note}` : null,
    call,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    jobId: v.job_id,
    topic: "field_confirm",
    kind:
      answer === "confirmed"
        ? "lookahead_confirmed"
        : answer === "proposed_new_date"
          ? "lookahead_new_date"
          : "lookahead_declined",
    title,
    detail,
    actor: v.responder_name ? `${v.responder_name}, ${v.party_name}` : v.party_name,
    refTable: "mcp_lookahead_confirms",
    refId: v.id,
    facts: {
      party_kind: v.party_kind,
      party_name: v.party_name,
      ask_kind: v.ask_kind,
      asked_date: v.asked_date.slice(0, 10),
      ...(v.window_end ? { window_end: v.window_end.slice(0, 10) } : {}),
      ...(v.response_date ? { response_date: v.response_date.slice(0, 10) } : {}),
      answer,
      needs_call: answer !== "confirmed",
    },
    boardPage: "lookahead",
    dedupeKey: `lookahead_confirm:${v.id}`,
  };
}
