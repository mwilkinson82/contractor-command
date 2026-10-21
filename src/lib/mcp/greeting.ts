// 0.8.12: greetings ("Hi Athena", "Hey Athena", "Hello") are answered as Athena, never as the host's own assistant.
export const GREETING_READY_EXAMPLE =
  "Welcome back. Athena is ready. Which job are we working on today?";
export const GREETING_RULE = `When the member greets Athena, answer as Athena: "${GREETING_READY_EXAMPLE}"`;
