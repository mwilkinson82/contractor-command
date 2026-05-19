
# Unify AOS into the Portal

Make AOS feel like part of Circle: one domain, one login, one product. AOS keeps its own codebase and database (zero risk to the 28 daily users), but Circle members enter it through a proxied `/aos/*` URL and a single-click SSO handoff. Public visitors can also use AOS for free as a funnel — a flag we flip later, no extra work now.

## The user experience

**Circle member's journey (28 paying users today):**

1. Clicks **AOS** in the portal sidebar.
2. Lands on `/aos` — a cinematic "Gateway" page (replaces today's plain explainer). Brief reveal animation, then a single primary action: **Enter AOS →**.
3. Clicks it. We mint a signed token, redirect to `/aos/sso?token=…`, which is proxied to AOS's new consume endpoint. AOS finds-or-creates the user by email, sets its session cookie, redirects to AOS's dashboard.
4. They land inside AOS, signed in, no second login form. The portal's header/sidebar are hidden inside `/aos/*` so it looks like one app.
5. To get back to Circle, they click "← Back to Circle" in AOS's chrome (small change on the AOS side) or use the browser back button.

**Edge case — already have AOS under a different email:** On the Gateway page, a small secondary link: *"Already use AOS under a different email? Link your existing account."* Opens a tiny flow that asks them to sign in to their existing AOS in a new tab, then comes back and stores the link in `aos_links.aos_email`. Future clicks SSO into that account instead of auto-provisioning. One-time, manual, only used by people who need it.

**Public visitor (eventually):** Same `/aos` gateway, but they're not signed into Circle. The CTA becomes "Start AOS free" and skips the SSO step — they sign up directly on AOS's subdomain. AOS's public side stays exactly as it is today. Nothing to build for this now; it works because AOS is already public-facing.

## The cinematic gateway

Replace the current `src/routes/aos.tsx` explainer with a full-bleed page that earns the "cloak and dagger" feeling without being gimmicky. Concept:

- Dark ink canvas. Ambient grid + a single gold signal pulse, same language as `AosHero`.
- Eyebrow: `Step 02 · Cross the threshold`
- Headline (slow staggered reveal): *"You've run the diagnostics. Now run the company."*
- Sub: *"AOS is where Circle becomes operational — vision, scorecard, rocks, weekly L10. One click and you're inside."*
- After ~600ms reveal, a single button rises into view: **Enter AOS →** with a subtle gold underline that draws on hover.
- Small secondary link below: *"Different email on AOS already? Link it."*
- Right side: a quiet "What lights up after you enter" panel (reuse from `AosHero`).

For first-time Circle members (the 21 cold ones), there's a one-sentence reassurance under the button: *"First time? We'll set up your AOS workspace automatically."* For previously-linked users it says: *"Welcome back, [Company]."*

## Technical plan

### 1. SSO handoff (the trust channel)

We already have `AOS_SHARED_SECRET` and the snapshot endpoint pattern. Add a parallel "consume" endpoint on AOS and a "mint" server function on Circle.

**Circle side** — new server function `mintAosSsoToken` in `src/lib/aos.functions.ts`:
- Protected by `requireSupabaseAuth`
- Reads email from claims, generates short-lived token: `email|ts|nonce|HMAC(secret)`
- Returns `{ url: "${AOS_BASE_URL}/api/public/circle/sso?token=..." }` to the client
- Client does `window.location.assign(url)` — full-page navigation, not a fetch

**AOS side** — new public route `/api/public/circle/sso`:
- Verifies HMAC, rejects if ts > 60s old (replay window)
- Looks up user by email in AOS's `auth.users`
  - If exists with 1 workspace → set session, redirect to dashboard
  - If exists with multiple → set session, redirect to workspace picker
  - If not exists → admin-create user, create starter workspace, set session, redirect to AOS onboarding
- Sets AOS's Supabase session cookie via admin-signed magic link (or `generateLink` + immediate consume)

The "admin-create user + set session" step needs AOS's service role key, which AOS already has. The auth pattern is: `supabaseAdmin.auth.admin.createUser({ email, email_confirm: true })` then `supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email })` and immediately redirect through that link's `token_hash` to set the session cookie.

### 2. Proxy `/aos/*` → AOS subdomain

A catch-all server route at `src/routes/api/aos/$.ts` that proxies any request under `/aos/*` to `AOS_BASE_URL/*`, streaming the response back. This is what makes the browser URL stay `contractor-command.lovable.app/aos/...` while the content comes from AOS.

Plus a thin client route at `src/routes/aos.$.tsx` that renders nothing (the proxy handles HTML responses directly via the API route) — or, simpler: skip the client route and have the gateway page navigate to AOS's real subdomain after SSO. **Recommendation: skip the proxy in v1.** After SSO, just `window.location.assign(AOS_BASE_URL)` — they land on the AOS subdomain, but already signed in. The URL bar shows the subdomain, but the experience is one-click. This avoids the entire class of proxy bugs (cookies, CORS, asset paths, websocket support) and ships in a fraction of the time.

If after using it for a week you still want the unified domain feel, we add the proxy in v2. **I'm recommending we ship without the proxy and revisit.** It's the 80% of the value for 20% of the risk.

### 3. AOS chrome adjustments (minimal, on AOS side)

- Add a small "← Back to Circle" link in AOS's top bar that points back to `contractor-command.lovable.app`.
- That's it. Don't touch anything else in AOS — the daily users are already happy with it.

### 4. Email-mismatch escape hatch

New route `src/routes/aos.link.tsx`:
- Form asks for the email they use on AOS
- Submits to `linkExistingAosAccount` server fn which: verifies the email exists on AOS (calls AOS's snapshot endpoint), then upserts into `aos_links` with `aos_email = <other email>`
- After linking, the SSO mint uses `aos_links.aos_email` instead of the Circle email

### 5. Migration data

Nothing to migrate. The 4 already-linked members get auto-recognized on first click. The 21 cold members get auto-provisioned. The 2 multi-workspace members hit the existing picker. The 1 no-workspace member lands on AOS onboarding. Marshall (you) can pre-link any of the 24 manually via admin if you happen to know their existing AOS email.

### 6. Stripe auto-revoke (separate small follow-up, mentioned earlier)

Already wired — `customer.subscription.deleted` flips status. Add a useEffect in `src/routes/__root.tsx` that calls `supabase.auth.signOut()` if `has_active_access` returns false while the user is signed in. Five-minute change, can ship with this or after. Not part of this plan's scope.

## What ships

- New gateway page replacing `src/routes/aos.tsx`
- `mintAosSsoToken` server fn in `src/lib/aos.functions.ts`
- `linkExistingAosAccount` server fn + `src/routes/aos.link.tsx` page
- One new public endpoint on AOS: `/api/public/circle/sso` (consume token, set session)
- One small UI tweak on AOS: "← Back to Circle" link
- `aos_links` already has `aos_email` column — no schema migration on Circle side
- No proxy in v1; revisit after a week of real use

## What we explicitly defer

- Full reverse proxy (`/aos/*` rewriting). Add later if the subdomain bothers you.
- Full schema merge (pulling AOS into Circle's Supabase). Multi-month project, not justified yet.
- Public free funnel. AOS subdomain is already public; we just stop hiding the link when you're ready.
- Stripe sign-out on cancel. Five-minute follow-up.

## Risks

- **AOS endpoint must be added by you** (or by me if you let me touch the AOS project too). Without it, the SSO step has nothing to call.
- **Magic-link consume pattern** is the part most likely to have subtle bugs in AOS. I'll write it defensively (replay protection, single-use tokens, short TTL).
- **The 1 no-workspace user** (kingconstructionofny) might hit a confusing AOS onboarding state. Worth a manual check before launch.

## Estimated work

- Circle side: ~3-4 hours (gateway page + 2 server fns + link page)
- AOS side: ~2-3 hours (consume endpoint + back-to-Circle link)
- Total: half a day if I have access to both projects.
