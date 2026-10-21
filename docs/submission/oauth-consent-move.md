# Move the OAuth consent page to app.meetathena.io (PLAN — nothing applied)

## Why
Supabase's OAuth server sends users to `<Site URL><Authorization path>`. Site URL is today
`https://contractor-command.lovable.app`, so ChatGPT/Claude/Codex/Grok Bot users see that host. Reviewers must see only Athena/ALP.

## Code changes
None required. Checked on this branch:
- `/oauth/consent` (src/routes/oauth.consent.tsx) is host-agnostic; Athena branding is chosen by host (`onAthenaHost()`, src/lib/athena-host-current.ts), so on app.meetathena.io it renders Athena.
- Login → consent return uses relative `/oauth/consent?authorization_id=…` (oauth.consent.tsx:125).
- Magic links for the connect flow already use `athenaAppOrigin()` = https://app.meetathena.io (magic-link.functions.ts:161).
- `allowedRequestOrigin` already allows app.meetathena.io, app.alpcontractorcircle.com and the lovable.app host (magic-link.functions.ts:30).
- Hub emails pass an explicit redirect: magic-link (`${origin}/auth/callback`), admin invites (`app.alpcontractorcircle.com/welcome`, `/reset-password`), signup (`window.location.origin`). Auth email webhook uses Supabase's `payload.data.url`.
- `/.well-known/oauth-protected-resource` points at the Supabase AS, which is unchanged.

## Supabase changes (Marshall's call — do NOT apply without his yes)
Auth → URL Configuration:
1. **Redirect URLs (add first, before step 2):**
   - `https://app.alpcontractorcircle.com/**`
   - `https://app.meetathena.io/**`
   - `https://contractor-command.lovable.app/**` (keep for rollback and old links)
   - `https://id-preview--362c776b-68ab-4871-bedb-c42cb9843c1b.lovable.app/**`
   - `http://localhost:*/**` (if already present, keep)
2. **Site URL:** `https://contractor-command.lovable.app` → `https://app.meetathena.io`
Auth → OAuth Server: Authorization path stays `/oauth/consent`. No client re-registration needed (redirect URIs are the hosts' callbacks, unchanged).

## Effect on Hub sign-in email links
- Links that carry `redirect_to` on the allow-list: unchanged — they still land on app.alpcontractorcircle.com.
- Any link whose redirect is NOT on the allow-list (or that has none) falls back to the Site URL → would land on app.meetathena.io with Athena branding. That's why step 1 must go first.
- Email template `{{ .SiteURL }}` usages: check the Supabase email templates; the custom webhook (mail.alpcontractorcircle.com) uses `payload.data.url`, so it's unaffected. If any template uses `{{ .SiteURL }}`, change it to `{{ .RedirectTo }}`.
- Links already sent before the switch keep working (they're Supabase verify URLs with their own redirect).

## Rollback
Set Site URL back to `https://contractor-command.lovable.app`. Leave the allow-list as is. Effect is immediate; in-flight consent
sessions restart from the client's Connect button.

## Connect-test checklist (after the change, test account only — never real members)
For each: ChatGPT (dev mode connector), Claude (custom connector), Codex (`codex mcp add` + login), Grok Bot (MCP connect):
- [ ] Connect → browser opens a **meetathena.io** URL; no lovable.app / supabase.co shown on screen.
- [ ] Login page shows Athena branding; sign-in completes; consent shows "Athena by ALP" and Approve.
- [ ] Back in the client, tools list loads (17 tools); `onboarding` read returns "ALP Construction".
- [ ] Deny on consent → client shows a clean failure, no token.
- [ ] Disconnect + reconnect works; stale session goes to login (v0.8.9.1 behavior).
Hub regression (same window):
- [ ] Hub magic-link sign-in from app.alpcontractorcircle.com lands on the Hub, Hub branding.
- [ ] Admin invite / reset-password links land on app.alpcontractorcircle.com.
- [ ] Signup confirm email lands on the origin it was started from.
