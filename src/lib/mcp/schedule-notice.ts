import type { LiteralClause } from "./literal-clauses";
import { clauseKinds } from "./literal-clauses";
import { findDelayTerms, termDue } from "./delays";
import { readScheduleControl } from "./schedule-control";
import type { LivingData } from "./living";

/** Editable draft only. A schedule comparison is not a contract entitlement finding. */
export function draftScheduleNotice(input: {
  job_label: string;
  event: {
    id: string;
    description: string;
    delay_start: string | null;
    affected_activity_ids: string[];
    source_refs: string[];
  };
  clauses: LiteralClause[];
  source_issues: string[];
  data: LivingData | null;
}) {
  const clauses = input.clauses.filter((c) =>
    clauseKinds(c).some(
      (k) => k === "delay_notice" || k === "claim_notice" || k === "schedule_context",
    ),
  );
  const terms = findDelayTerms([], {}, [], clauses);
  const due = (term: typeof terms.notice) =>
    term?.day_type && term.day_type !== "calendar"
      ? {
          due: null,
          math: "The clause uses business/working days; its governing calendar and holiday rules are not established by the scheduling calendar.",
          precautions: [
            "Verify the actual contract notice calendar before calculating this deadline.",
          ],
        }
      : termDue(term, input.event.delay_start);
  const notice = due(terms.notice);
  const claim = due(terms.claim);
  const missing = [
    ...input.source_issues,
    ...(terms.source_issues ?? []).filter((s): s is string => typeof s === "string"),
    ...(!clauses.length ? ["Applicable contract/spec clause and physical page"] : []),
    ...(!input.event.delay_start ? ["Reported delay start date"] : []),
    ...(!terms.notice?.recipient ? ["Contract-designated notice recipient"] : []),
    ...(!terms.notice?.delivery_method ? ["Contract-required delivery method"] : []),
    ...(!notice.due ? ["Verified notice trigger/date and deadline"] : []),
    ...(!claim.due ? ["Claim/interim notice requirements and deadline"] : []),
  ];
  const analysis = readScheduleControl(input.data)?.analysis;
  const matching =
    !!analysis &&
    analysis.event_id === input.event.id &&
    analysis.event_date === input.event.delay_start &&
    JSON.stringify([...analysis.affected_activity_ids].sort()) ===
      JSON.stringify([...input.event.affected_activity_ids].sort()) &&
    input.event.source_refs.every((s) => analysis.source_refs.includes(s));
  const citations = clauses.map((c) => ({
    source_id: c.source_id,
    filename: c.filename,
    file_sha256: c.file_sha256,
    section: c.section,
    physical_pages: c.parts.map((p) => p.page),
    text: c.text,
  }));
  const body = [
    "DRAFT — NOT SENT",
    `Subject: Notice of reported delay — ${input.job_label} — ${input.event.id}`,
    "",
    `To: ${terms.notice?.recipient ?? "[Contract-designated recipient needed]"}`,
    "",
    `We give notice of the following reported event: ${input.event.description}`,
    `Reported delay start: ${input.event.delay_start ?? "[Needed]"}. Affected activities: ${input.event.affected_activity_ids.join(", ")}.`,
    "Time and costs are being tracked. Full impact is not yet determined; a time impact analysis and supporting records will follow assessment or event completion, subject to the contract's interim requirements. We reserve our rights to request applicable time and damages; this draft makes no determination of entitlement.",
    ...(matching
      ? [
          `The current modeled comparison moves completion from ${analysis.prior_completion} to ${analysis.updated_completion} (${analysis.impact_calendar_days} calendar days). This is a modeled schedule result; causation, concurrent events, responsibility and compensability require separate review.`,
        ]
      : [
          "No matching calculated event comparison is saved. No quantified event impact is asserted.",
        ]),
    "",
    "Contract review (complete every applicable interim obligation):",
    ...citations.map(
      (c) =>
        `${c.filename}${c.section ? ` §${c.section}` : ""}, PDF physical page(s) ${c.physical_pages.join(", ")}:\n${c.text}`,
    ),
    `Notice deadline: ${notice.due ?? "Unknown"}. ${notice.math}`,
    `Claim deadline: ${claim.due ?? "Unknown"}. ${claim.math}`,
    `Delivery method: ${terms.notice?.delivery_method ?? "Unknown"}.`,
    ...missing.map((m) => `Open: ${m}`),
    "",
    "Review and edit this draft against the actual contract and event evidence. A separate specific approval is required to send; this workflow has no send action.",
  ].join("\n");
  return {
    body,
    missing,
    citations,
    notice,
    claim,
    event: input.event,
    matching_calculated_comparison: matching,
    ready_for_delivery: false,
  };
}
