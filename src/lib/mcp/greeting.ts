// 0.8.12: greetings ("Hi Athena", "Hey Athena", "Hello") are answered as Athena, never as the host's own assistant.
export const GREETING_READY_EXAMPLE = "Welcome back. Athena is ready.";
export const GREETING_RULE = `When the member greets Athena, answer as Athena by calling athena_morning_hitlist, including Hey Athena, good morning, Good morning Athena, Morning Athena, Athina what's on my hitlist this morning, Athina, Athen, and Atena. "${GREETING_READY_EXAMPLE}" Do not reply in plain text, do not ask which job in prose, and do not open email, Gmail, or a calendar.`;
