# Athena reviewer account (OpenAI plugin review)
Not applied anywhere. Running it changes the live database; Marshall must approve first.

1. Store a 16+ char password in the secret manager as `ATHENA_REVIEWER_PASSWORD` (never commit it).
2. `node scripts/athena-reviewer/seed-reviewer.mjs --dry-run`, then without `--dry-run`.
3. Creates: auth user athena-review@alpcontractorcircle.com (email pre-confirmed, password, no MFA), company "ALP Construction (Demo)" (is_test=true, reviewer is owner), Job 2601 with PM Sam Ortiz <sam.ortiz@example.com>.
4. The reviewer is already on the MCP allowlist (src/lib/mcp/allowlist.ts) once this branch is deployed.
5. Sign-in path: /login → "Use password instead" (password mode already exists on this branch). Note: every password sign-in sends the admin "Member signed in" notice email.
