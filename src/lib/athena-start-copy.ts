// Shared first-use copy. Each example maps to an existing Athena tool.
export const START_HEADLINE = "Your next move, made clear.";
export const START_HOSTS = "Your jobs. Your records. One place to pick up.";
export const START_POINTS = [
  "Athena keeps a saved record for each job, so you can pick up where you left off.",
  "Ask for the job dashboard, open items, lookahead or field board when you need them.",
] as const;
export const START_EXAMPLES = ["Start a job", "Show my job list", "What needs attention?"] as const;
export const START_HABIT =
  "With Athena connected and signed in, ask naturally and name the job when you know it.";
export const START_BACKUP =
  "If your host does not use Athena, select the Athena app or connector and try again. Available routes depend on your host.";
export const DOCUMENT_ASK =
  "Where does your project information live today: files, a shared drive, project software or a spreadsheet?";
export const COST_CODE_ASK =
  "Do you already use company cost codes? If so, where is the current list?";
export const DOCUMENT_ROUTE =
  "For a contract or specifications, ask “upload this to job…” and name the job. Athena can give you a private upload link with a file picker. A readable chat attachment also works when your host supports it.";
export const CONNECTOR_ROUTE =
  "For files in another service, use a connected file tool or a signed-in browser only when this host provides that access. Otherwise, download an export yourself and attach it here.";
export const COST_CODE_ROUTE =
  "You can supply your existing code list as an attachment or paste the codes and descriptions. I can help review it for the job; this does not automatically import a company code library or map your accounts.";
export const NAVIGATION_LINE =
  "Say “show my job list” to switch jobs, “back” to choose another task, or “cancel” to stop setup. Your saved work stays in place.";

// Optional host preference, retained for members who ask about it. Never a prerequisite.
export const MEMORY_LINE = "When I say Athena, always use the Athena connector";
export const MEMORY_BONUS =
  "A host preference can help, but “Hey Athena” alone does not guarantee routing.";
export const MEMORY_WAIT =
  "Save a host preference only when you explicitly ask and the host supports it.";
export const MEMORY_ASK = "Would you like help setting a host preference?";
export const MEMORY_HOST_LINES = [
  "ChatGPT: use saved memory only if it is available.",
  "Claude: use memory or project instructions only if available.",
  "Other hosts: check their supported settings.",
] as const;
