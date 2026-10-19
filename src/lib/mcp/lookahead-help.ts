// Setup check "bss_lookahead": a "no" is not accepted. Athena pushes back and offers to build one
// from the schedule; only an explicit decline is recorded (as a "no" open item).

export const LOOKAHEAD_SETUP_KEY = "bss_lookahead";

export const LOOKAHEAD_PUSHBACK =
  "Hey, we really should have a look-ahead. If the job is ongoing and there's production, you should have a look-ahead. Can I help you create one?";

/** Asked when the PM accepts help. The answers feed intake section "lookahead". */
export const LOOKAHEAD_BUILD_QUESTIONS = [
  "Which activities are in progress right now, and what percent complete is each one?",
  "Per the schedule, what starts next?",
  "What work is planned for the next 2–3 weeks? Give each activity with its planned start and finish.",
  "Who is doing each of those activities (our own crews or which sub), and how many people each?",
  "What constraints could hold that work up: submittals, RFIs, inspections, deliveries, access or work that has to finish first?",
] as const;

export const LOOKAHEAD_DECLINE_RECOMMENDATION =
  "Build a two-week look-ahead from the schedule and update it every week. Athena can build it with you from the schedule.";

export function pushbackText(prefix: string): string {
  return `${prefix}${LOOKAHEAD_PUSHBACK}\n\nNot recorded yet. Ask the member, then call answer again with check_key "${LOOKAHEAD_SETUP_KEY}", response "no" and lookahead_help "accept" (they want help) or "decline" (they don't; this logs an open item).`;
}

export function buildQuestionsText(prefix: string, jobNumber: string): string {
  return [
    `${prefix}Let's build the look-ahead from the schedule. Ask these one at a time:`,
    ...LOOKAHEAD_BUILD_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
    "",
    "Then build it: call intake with section \"lookahead\", job_number " + jobNumber + ", start_date and end_date for the two-week window,",
    "schedule_export = the schedule activities (in-progress activities with percent complete, then what's next per the schedule, then the next 2–3 weeks with start and finish),",
    "crews = who is doing each activity and how many, and the constraints in submittal_log, rfi_log, inspection_list and deliveries as they apply.",
    "Use the member's schedule export if they have one; never invent activities or dates.",
    `After the look-ahead is created, call answer with check_key "${LOOKAHEAD_SETUP_KEY}" and response "yes", then walk it with next_question and the lookahead_id.`,
  ].join("\n");
}
