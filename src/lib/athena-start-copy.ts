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

/** The one habit. The memory line is only the bonus. */
export const START_HABIT = "Start every message with @Athena.";

/** Saved in the member's own AI, and only after they say yes. Exact line. */
export const MEMORY_LINE = "When I say Athena, always use the Athena connector";

export const MEMORY_BONUS = "That line is the bonus, so plain Hey Athena also works.";

export const MEMORY_WAIT = "Nothing is saved until you say yes.";

export const MEMORY_ASK = "Save this line in your AI? Yes or no?";

export const MEMORY_HOST_LINES = [
  "ChatGPT: ask ChatGPT to remember it in saved memory.",
  "Claude: save it in memory or project instructions.",
  "Grok Bot: save it in memory.",
] as const;
