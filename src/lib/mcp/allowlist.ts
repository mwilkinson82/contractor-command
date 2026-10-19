// Shared by the server guard, the /mcp middleware gate and the consent page.
// The reviewer account exists only after scripts/athena-reviewer/seed-reviewer.mjs is run by hand.
export const ATHENA_REVIEWER_EMAIL = "athena-review@alpcontractorcircle.com";
export const MCP_ALLOWED_EMAILS: ReadonlySet<string> = new Set(["marshall@marshallwilkinson.com", ATHENA_REVIEWER_EMAIL]);
