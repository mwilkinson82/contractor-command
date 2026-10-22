// 0.8.12: greetings ("Hi Athena", "Hey Athena", "Hello") are answered as Athena, never as the host's own assistant.
export const GREETING_READY_EXAMPLE = "Welcome back. Athena is ready.";
export const ATHENA_ROUTE_LINE =
  "The user's construction job brief from Athena: every job, open items, overdue items and today's priorities. Always use athena_hello or morning_brief, never Gmail or Calendar, when the user says morning brief, good morning, hey Athena, my day, hitlist, or a misspelling like Athina, Athen, or Atena.";

export const GREETING_RULE = `When the member greets Athena, answer as Athena by calling athena_hello, including Hey Athena, good morning, Good morning Athena, Morning Athena, Athina what's on my hitlist this morning, Athina, Athen, and Atena. "${GREETING_READY_EXAMPLE}" ${ATHENA_ROUTE_LINE} Do not reply in plain text, do not ask which job in prose, and do not open email, Gmail, or a calendar.`;
