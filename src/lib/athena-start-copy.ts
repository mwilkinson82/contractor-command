// Shared copy for the first-chat card and the app.meetathena.io start tip.
// The asks map to tools Athena already has.

export const START_HEADLINE = "Hey Athena, let's get started";
export const START_HOSTS = "ChatGPT, Claude and Grok Bot";

export const START_POINTS = [
  "The same Athena knows your jobs wherever you open her, in ChatGPT, Claude and Grok Bot.",
  "Your work lives on Athena's servers.",
  "Every job has its own dashboard and boards that stay up to date.",
] as const;

export const START_EXAMPLES = [
  "Hey Athena, run my PM meeting",
  "Hey Athena, give me the 2-week lookahead",
  "Hey Athena, where's my billing forecast",
  "Hey Athena, log today's daily",
  "Hey Athena, show open change orders",
  "Hey Athena, show the field board",
] as const;

export const START_BACKUP =
  "If it misses, start with @Athena. It routes the ask to Athena instead of the general AI.";

/** Lines that show @Athena as the way to start. They sit on the get-started card, before the memory offer. */
export const START_AT_EXAMPLES = [
  "@Athena, run my PM meeting",
  "@Athena, what's on my plate today?",
  "@Athena, show the field board",
] as const;

/** The line the member can save, and the line that removes it. */
export const START_CONNECTOR_MEMORY = "When I say Athena, always use the Athena connector";
export const START_MEMORY_OFFER = `Want me to save this? ${START_CONNECTOR_MEMORY}. Say yes and I will. To remove it, say forget that memory.`;
