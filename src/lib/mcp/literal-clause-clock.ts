import { clauseKinds } from "./literal-clauses";
import type { LiteralClause } from "./literal-clauses";
import type { DayType } from "./deadlines";
/** Never flatten compound timing or turn nonnumeric wording into a deadline. */
export function literalClock(
  clauses: LiteralClause[],
  kind: "delay_notice" | "claim_notice" | "submittal_review",
) {
  const match = clauses.filter((c) => {
    if (!clauseKinds(c).includes(kind === "submittal_review" ? "submittal_review" : "notice"))
      return false;
    const t = c.text;
    if (kind === "submittal_review")
      return /\bsubmittals?\b/i.test(t) && /\b(review|return|turnaround)\b/i.test(t);
    return (
      /\b(notice|notify|notification)\b/i.test(t) &&
      (kind === "delay_notice"
        ? /\b(beginning|start|commencement)\b[^.;]{0,30}\bdelay\b|\bdelay\b[^.;]{0,15}\bbegins\b/i.test(
            t,
          ) || /delay.*notice|notice.*delay/i.test(c.heading ?? "")
        : /claim/i.test(c.heading ?? "") || /Architect[^.;]{0,40}(Decision|determination)/i.test(t))
    );
  });
  const unresolved = (problem: string) => ({
    present: match.length > 0,
    clause: null as LiteralClause | null,
    count: null as number | null,
    day_type: null as DayType | null,
    trigger: null as string | null,
    problem,
  });
  if (!match.length) return unresolved("");
  const terms = match.map((clause) => {
    const clocks = Array.from(
      clause.text.matchAll(/\b(\d{1,3})\)?\s*(calendar|business|working)?\s*days?\b/gi),
    );
    if (
      clocks.length !== 1 ||
      /reasonable promptness|promptly|as soon as practicable/i.test(clause.text)
    )
      return null;
    const c = clocks[0];
    const trigger =
      kind === "delay_notice" &&
      /\b(beginning|start|commencement)\b[^.;]{0,30}\bdelay\b|\bdelay\b[^.;]{0,15}\bbegins\b/i.test(
        clause.text,
      )
        ? "delay_start"
        : kind === "claim_notice" &&
            /Architect[^.;]{0,40}(?:Decision|determination)/i.test(clause.text)
          ? "architect_decision"
          : kind === "submittal_review" &&
              /\b(submittal|submission|receipt|received)\b/i.test(clause.text)
            ? "submission"
            : null;
    if (!c[2] || !trigger) return null;
    return { clause, count: Number(c[1]), day_type: c[2].toLowerCase() as DayType, trigger };
  });
  if (terms.some((t) => !t))
    return unresolved(
      "Source wording is compound, nonnumeric, or does not state an unambiguous day type and trigger; use the verbatim clause without inventing a deadline.",
    );
  const signatures = new Set(terms.map((t) => JSON.stringify([t!.count, t!.day_type, t!.trigger])));
  if (signatures.size !== 1)
    return unresolved(
      "Extracted source clauses contain different clocks; the conflict remains explicit.",
    );
  return { present: true, ...terms[0]!, problem: "" };
}
