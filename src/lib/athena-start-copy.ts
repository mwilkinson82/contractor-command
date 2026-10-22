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
