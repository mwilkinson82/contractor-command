## Grant Circle access to Ken & Paul

Two-step data operation, no code changes:

### 1. Create comped Circle subscriptions
Insert one row per user into `public.subscriptions`:
- `email`: ken@gmworksonline.com / paul@gmworksonline.com
- `tier`: `circle`
- `status`: `active`
- `is_comped`: `true`
- `metadata`: `{"source": "admin_comp", "granted_by": "marshall", "note": "manual add"}`

This immediately unlocks Circle-tier access (templates, replays, all tools, unlimited AOS seats/workspaces) the moment they sign in. `get_user_tier` / `get_user_aos_limits` resolve via email match until `user_id` gets linked on first login (the `claim_pending_subscription` trigger handles that automatically).

### 2. Send portal invites
Use Supabase admin `inviteUserByEmail` for each (same path as `sendMemberAccessLink`):
- Redirect to `https://app.alpcontractorcircle.com/welcome`
- They click the link, set a password, and land in the portal already on the Circle tier.

### Ken's AOS alignment
AOS membership is keyed on email. As long as Ken signs into the portal with `ken@gmworksonline.com` (the same email he uses in AOS), the existing `aos_links` flow + `get_user_aos_limits` will see his Circle tier and grant unlimited seats/workspaces. No data migration needed — the email is the join key. If his AOS account is under a different email, he'd need to use the `/aos/link` flow to link them; flag that to him in the invite if uncertain.

### Execution
- `supabase--insert` — two INSERT rows into `subscriptions`
- `code--exec` — call `inviteUserByEmail` via a small node script using the service role key, OR I can do it through the admin UI's existing `sendMemberAccessLink` server fn if you'd rather trigger it from `/admin` yourself

No migrations, no schema changes, no new code.
