// Phase 2: pay applications in AIA G702/G703 format. Athena stores the data, runs the math and the five blocking checks,
// and returns the REQUIRED VIEW and file spec; the host draws the cards and builds the PDF and Excel files.
import { ALERT_COLOR } from "../alert-color";
import { fmt, sum } from "./cents";
import { PAYAPP_FOOTER, payAppMath, type PayAppResult, type PayLine } from "./payapp-math";
import type { RetainageRule } from "./retainage";
import { dueDate, type Due, type PaymentTermRule } from "./payment-terms";

export const PAYAPP_STATUSES = ["draft", "checked", "submitted", "certified", "paid", "partly_paid"] as const;
export type PayAppStatus = (typeof PAYAPP_STATUSES)[number];

/** A saved pay app as stored (all money in integer cents). */
export type SavedPayApp = {
  app_no: number; period_from: string | null; period_to: string; status: PayAppStatus; version: number;
  original_contract: number; net_change_orders: number; previous_certificates: number;
  lines: PayLine[]; g702: PayAppResult["g702"];
  submitted_on: string | null; approved_on: string | null; gc_paid_on: string | null;
  certified?: { lines: { id: string; g: number; i: number }[]; total_due: number; certified_by: string; certified_on: string } | null;
  received: number; // sum of payments recorded
};

/** Line-level entries for this period, keyed by SOV or CO line. */
export type PeriodEntry = { id: string; e: number; f: number; overbill_approved_by?: { name: string; role: string } | null };

/**
 * Build the next app from the last CERTIFIED app plus this period's entries. A certified cut becomes the new "previous".
 * D = last certified G minus the stored materials still carried in F on that app; prev I = certified I.
 */
export function draftNext(sov: { id: string; c: number; co?: boolean }[], last: SavedPayApp | null, entries: PeriodEntry[]): PayLine[] {
  const prev = new Map((last?.certified?.lines ?? []).map((l) => [l.id, l]));
  const prevLine = new Map((last?.lines ?? []).map((l) => [l.id, l]));
  const byId = new Map(entries.map((e) => [e.id, e]));
  return sov.map((s) => {
    const p = prev.get(s.id);
    const pl = prevLine.get(s.id);
    const certG = p?.g ?? 0;
    const prevF = Math.min(pl?.f ?? 0, certG);
    const en = byId.get(s.id);
    return { id: s.id, co: s.co, c: s.c, d: certG - prevF, e: en?.e ?? 0, f: en?.f ?? 0, prev_g: certG, prev_i: p?.i ?? 0, prev_f: prevF, overbill_approved_by: en?.overbill_approved_by ?? null };
  });
}

/** Previous certificates (line 7) from the certified record: the sum of certified current-due amounts on earlier apps. */
export const previousCertificates = (apps: SavedPayApp[], beforeNo: number) =>
  sum(apps.filter((a) => a.app_no < beforeNo && a.certified).map((a) => a.certified!.total_due));

export function computeApp(rule: RetainageRule, a: { original_contract: number; net_change_orders: number; previous_certificates: number; lines: PayLine[]; typed?: Parameters<typeof payAppMath>[1]["typed"] }) {
  return payAppMath(rule, a);
}

export const payAppDue = (terms: PaymentTermRule | null, a: Pick<SavedPayApp, "submitted_on" | "approved_on" | "gc_paid_on">): Due =>
  dueDate(terms, { submitted: a.submitted_on, approved: a.approved_on, gc_paid: a.gc_paid_on });

export const fileName = (job: string, appNo: number, periodTo: string, ext: "pdf" | "xlsx") => `${job}-PayApp-${String(appNo).padStart(2, "0")}-${periodTo}.${ext}`;

/** G702 summary rows (labels Athena's own, never AIA form text). */
export function g702Rows(g: PayAppResult["g702"]): [string, string][] {
  return [
    ["1 Original contract sum", fmt(g.l1)], ["2 Net change by change orders", fmt(g.l2)], ["3 Contract sum to date", fmt(g.l3)],
    ["4 Total completed and stored to date (column G)", fmt(g.l4)], ["5a Retainage on completed work", fmt(g.l5a)],
    ["5b Retainage on stored materials", fmt(g.l5b)], ["5 Total retainage", fmt(g.l5)], ["6 Total earned less retainage", fmt(g.l6)],
    ["7 Less previous certificates for payment", fmt(g.l7)], ["8 Current payment due", fmt(g.l8)], ["9 Balance to finish, including retainage", fmt(g.l9)],
  ];
}

export const PAYAPP_FORMAT_VIEW: string[] = [
  "REQUIRED VIEW – APPLICATION FOR PAYMENT (AIA G702/G703 format): build ONE styled view, never plain text.",
  "1. Navy header bar with a white title: \"Application for Payment No. N · Job · Period to DATE\", then Version, Last updated stamp, status chip, and the due date (with an Estimated chip when it is estimated).",
  "2. Card 1, G702-format summary: lines 1 to 9 one per row, labels gray, numbers blue, line 8 large in blue.",
  `3. Card 2, check strip: B1 to B5, a gray check mark each when passed. A failed check is a ${ALERT_COLOR} row naming the line and the amount off, and nothing below it is drawn.`,
  `4. Card 3, G703-format continuation sheet: columns A, B, C, D, E, F, G, G/C %, H, I; original lines first, CO lines after, a bold totals row; a thin blue bar in the % cell. ${ALERT_COLOR} only on a line over 100% without an approved overbill; an approved one shows a gray "approved overbill" tag.`,
  "5. Card 4, the one-line retainage note exactly as given.",
  `6. Footer: "${PAYAPP_FOOTER}" and Page X of Y on files.`,
  "7. In chat draw cards only; build the PDF and Excel only when asked or when sending. Money to the cent, percent to two places.",
];

export const PAYAPP_FILE_SPEC = (job: string, appNo: number, periodTo: string) => [
  `PDF ${fileName(job, appNo, periodTo, "pdf")}: page 1 the G702-format summary, then the G703-format sheet, signature blocks blank, Page X of Y, footer "${PAYAPP_FOOTER}".`,
  `Excel ${fileName(job, appNo, periodTo, "xlsx")}: tabs Summary, Continuation and Checks (B1 to B5), values only, no formulas.`,
];

export function nextMove(r: PayAppResult, appNo: number): string {
  const f = r.checks.find((c) => !c.ok);
  if (f) return `${f.message} Fix it and I'll run the check again.`;
  return `Pay app ${appNo} ties on all five checks. Want me to save it and draft the transmittal with the PDF attached?`;
}
