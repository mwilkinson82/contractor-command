// 0.8.13: daily morning routine. "Good morning" (or the scheduled check-in) gets ONE styled briefing built from
// one read-only morning_briefing call. Overnight email is summarized by the host's own email connector, read-only;
// Athena only instructs it and never reads, sends or stores mail.
import { ALERT_COLOR } from "./alert-color";

export const MORNING_TRIGGER_RE = /\bgood\s+morning\b|\bmorning\s+briefing\b/i;
export const isMorningAsk = (s: string) => MORNING_TRIGGER_RE.test(s);

export const MORNING_BRIEFING_RULE =
  `REQUIRED: When the member says "good morning" (also "Athena, good morning", "good morning Athena") or "morning briefing", or the scheduled daily check-in fires, call morning_briefing once and build the styled morning briefing it describes. This is not a short greeting.`;

export const FIELD_UPDATE_QUESTIONS = [
  "What % complete are we on today's activities?",
  "Any delays or new issues since yesterday?",
  "What crew is on site today, and which deliveries are coming?",
] as const;

export const MORNING_BRIEFING_VIEW_SPEC: string[] = [
  "REQUIRED VIEW – MORNING BRIEFING: build ONE styled card stack, never plain text, in this order:",
  "1. Header: date, job(s), and the \"Today's top 3\" box first (action, owner, due).",
  `2. Overdue items and risks: ${ALERT_COLOR} flags, each with owner, due date and days late.`,
  "3. Overnight emails: only if the member's own email is connected in this app, read it yourself (read-only) and summarize sender, subject and the one-line ask, with a suggested reply offered as a draft. Never send anything. If no email is connected, run the connect check: one line on connecting Google or Outlook email, then continue the briefing without this card.",
  "4. Today on the lookahead: activities starting or finishing today, critical in blue #2563EB and others in gray #9CA3AF.",
  "5. Inspections and deliveries due today or tomorrow, with clipboard-check and truck icons.",
  `6. Open RFIs and submittals: number, subject, days open, ball-in-court, ${ALERT_COLOR} when past due.`,
  "7. Reminders and contract deadlines due, each with a countdown chip.",
  `8. End by asking for field updates, ONE short question at a time: ${FIELD_UPDATE_QUESTIONS.join(" / ")} Then the Next move card.`,
  "White cards, navy titles, blue #2563EB accent, gray secondary; the alert color only for delays, risks and overdue items. No technical notes.",
];

/** Morning briefing check-in, offered at cadence item d. Created by the host only after a yes. */
export const MORNING_CHECKIN_RULE =
  "When the morning briefing time is saved, ask: \"Want me to set a daily check-in at that time?\" Only on a clear yes, set it up with this app's own scheduled task or reminder feature, to say \"good morning\" to Athena at that time on workdays. If this app can't schedule, say so in one line and offer a calendar reminder instead.";

const MONEY = /\$\s?[\d,.]+[kKmM]?|\b\d[\d,.]*\s?(dollars|usd)\b/gi;
export const stripDollars = (s: string) => s.replace(MONEY, "[amount withheld]");

export type BriefActivity = { id: string; name: string; start: string | null; finish: string | null; critical: boolean | null };
/** Activities starting or finishing today. */
export function todaysActivities(acts: BriefActivity[], today: string) {
  return acts
    .filter((a) => a.start?.slice(0, 10) === today || a.finish?.slice(0, 10) === today)
    .map((a) => ({ id: a.id, name: a.name, event: a.start?.slice(0, 10) === today ? "starts" : "finishes", critical: a.critical === true }));
}

/** PMs see only their own jobs; owner / all-access see every job they can access; supers keep their read-only jobs. */
export function visibleForRole<J extends { pm_user_id?: string | null }>(jobs: J[], role: string | null, me: string | null): J[] {
  return role === "pm" ? jobs.filter((j) => !!me && j.pm_user_id === me) : jobs;
}
