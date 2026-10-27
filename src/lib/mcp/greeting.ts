// Entry guidance and an explicitly requested morning brief are separate intents.
export const GREETING_READY_EXAMPLE = "Welcome back. Athena is ready.";
export const ATHENA_ROUTE_LINE =
  "A greeting or an Athena name mention alone is not a morning-brief request. For Hey Athena, let's get started, let's get started, how does Athena work, or onboarding help, call getting_started first, even when the message begins with a greeting. A simple hello, Hey Athena, Athina, Athen, or Atena opens athena_hello for saved-job choices. For Good morning Athena, Morning Athena, Athina what's on my hitlist this morning, a morning brief, what's on my plate today, overdue items, or today's deadlines on my jobs, call morning_brief. A concrete task in the same message takes priority over a generic greeting.";

export const GREETING_RULE = `When the member greets Athena, answer as Athena using the entry tool, not a host-authored greeting. "${GREETING_READY_EXAMPLE}" ${ATHENA_ROUTE_LINE} Do not ask which job in prose before showing saved-job choices.`;
