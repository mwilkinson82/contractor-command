# ChatGPT directory reviewer account (STAGED — do not run without Marshall's go)

Status: draft only. No account has been created. Nothing here has been run.

## Account
- Email: `athena-reviewer@<REVIEWER_DOMAIN_PLACEHOLDER>` — a dedicated, non-member mailbox Marshall controls
  (e.g. on meetathena.io once support@ exists). Never a real member, never a Circle member address.
- Sign-in: email + password. No magic link, no MFA, no SSO.
- Password: generated at creation (24+ chars), stored only in the OpenAI submission form's reviewer field.
- Company: "ALP Construction" (company `5300fd46-5185-45d9-a43d-f0964d34be08`), role PM, job access to **2701 only**.
- Must be on the Athena allowlist (src/lib/mcp/allowlist.ts) or the entitlement path, but must NOT get Hub/Circle membership,
  billing, or email sends.

## Password path check (blocker from section 8)
The deployed branch is "passwordless login only". The MCP OAuth flow signs in through `/login` → `/oauth/consent`.
Before creating the account, confirm `/login?redirect=/oauth/consent...` offers a password form on app.meetathena.io
(login.tsx `mode`). If it doesn't, a staged follow-up is needed: a password mode shown only for allowlisted reviewer
emails. Do not enable password sign-in for members.

## Creation steps (Marshall approves, then the dev runs — in this order)
1. Supabase Auth → Users → Add user → email above, password, "Auto confirm user" ON. (Do not "Send invite".)
2. Auth → MFA: confirm MFA is not enforced for this user (no factor enrolled).
3. Add membership row (company member, role pm) and job access to 2701 only — via the existing admin screen, not SQL.
4. Run `scripts/submission/reseed-2701.sql` (dry-run block first) so 2701's dates sit around today.
5. Sign in once from ChatGPT dev mode with this account; run the 5 positive / 3 negative cases.

## Guard rails
- Never touch jobs 2799, 2801, 2803, 2804 or the duplicate notices. No deletes.
- No outbound email to anyone from this account's activity.
- Rotate the password and disable the user after review closes (Marshall's word).
