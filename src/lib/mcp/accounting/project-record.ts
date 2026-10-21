// Phase 6: Project Record. One living record per job, sections in a fixed order.
// D9 (Marshall, 2026-10-20): PMs see dollars in the Project Record on their own jobs. Owner, all-access and accounting see
// dollars on every job. Supers see the record with no dollar sections and no dollar amounts. The database scope
// (mcp_job_scope 'full' vs 'super') decides; this module only shapes the output.
import { ALERT_COLOR } from "../alert-color";

export const SECTIONS = [
  { key: "summary", title: "Job summary", dollars: false },
  { key: "contract", title: "Contract and payment terms", dollars: true },
  { key: "schedule", title: "Schedule and lookahead", dollars: false },
  { key: "logs", title: "Logs (RFI, submittal, change order, transmittal, notice)", dollars: false },
  { key: "notices", title: "Notices and deadlines", dollars: false },
  { key: "pay_apps", title: "Pay applications", dollars: true },
  { key: "ar", title: "AR due and overdue", dollars: true },
  { key: "ledger", title: "Job cost ledger and over/under", dollars: true },
  { key: "change_log", title: "Change log", dollars: false },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];
export type Audience = "full" | "super";

export const sectionsFor = (a: Audience) => SECTIONS.filter((s) => a === "full" || !s.dollars);

export type SectionBody = { key: SectionKey; lines: string[]; alerts: number };

const MONEY = /\$\s?\d/;
/** Builds the record in the fixed order; drops dollar sections for supers, and refuses if a dollar figure would leak. */
export function buildRecord(a: Audience, bodies: Partial<Record<SectionKey, Omit<SectionBody, "key">>>) {
  const want = sectionsFor(a);
  const sections = want.map((s) => ({ key: s.key, title: s.title, ...(bodies[s.key] ?? { lines: ["Nothing on file yet."], alerts: 0 }) }));
  if (a === "super") for (const s of sections) if (s.lines.some((l) => MONEY.test(l))) throw new Error(`Section ${s.title} carries a dollar figure; the super view can't include it.`);
  const count = countCheck(a, sections.map((s) => s.key));
  return { sections, count };
}

/** Count check: exactly the expected sections, in order, once each. */
export function countCheck(a: Audience, keys: string[]) {
  const want = sectionsFor(a).map((s) => s.key as string);
  return { expected: want.length, got: keys.length, ok: keys.length === want.length && keys.every((k, i) => k === want[i]) };
}

/** R3: a super asking for dollars in the record gets this refusal, never the figures. */
export const R3_REFUSAL = "Dollar figures in the Project Record are limited to owners, all-access, accounting and the job's PM. Your view shows the schedule, logs and notices. Ask your PM or owner for the financial sections.";
export const asksForDollars = (q: string) => /\$|dollar|money|cost|bill|pay ?app|invoice|AR\b|ledger|over ?bill|under ?bill|contract (sum|value)|retainage/i.test(q);

export const RECORD_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – PROJECT RECORD: navy header bar \"Project Record · <job> · v<n> · Last updated <stamp>\".",
  "Sections in this order, each with a navy subhead and a count of its open items; only the sections this person may see.",
  `Alerts (overdue, risks, delays) in ${ALERT_COLOR}; everything else navy, blue #2563EB and gray.`,
  "Files on request: <job>-Project-Record-<date>.pdf, Excel when asked.",
];
