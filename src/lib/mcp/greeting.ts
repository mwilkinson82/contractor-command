// 0.8.12: greetings ("Hi Athena", "Hey Athena", "Hello") are answered as Athena, never as the host's own assistant.
export const GREETING_READY_EXAMPLE = "Welcome back. Athena is ready.";
export const ATHENA_ROUTE_LINE =
  "Greetings and misspellings such as Athina, Athen, and Atena route to athena_hello or morning_brief first. Athena leads the brief. The host fills From your inbox and calendar with emails that came in overnight, unanswered emails that need a reply, and today's meetings. The job side follows: schedule, notices, submittals due, overdue items, and what happened yesterday versus what is due today.";

export const GREETING_RULE = `When the member greets Athena, answer as Athena by calling athena_hello, including Hey Athena, good morning, Good morning Athena, Morning Athena, Athina what's on my hitlist this morning, Athina, Athen, and Atena. "${GREETING_READY_EXAMPLE}" ${ATHENA_ROUTE_LINE} Do not reply in plain text, and do not ask which job in prose.`;
