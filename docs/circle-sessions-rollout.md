# Current release status — October 14, 2026

Prepared on `codex/session-only-production` from approved email release `accea3a6`, excluding main's unpublished MCP/OAuth work. The application delta preserves the approved email branding and adds only the session block to Call announcements. Historical implementation notes follow below.

Owner has confirmed Lovable Cloud; parent successfully performed native Lovable read-only database queries and confirmed `circle_sessions` is absent. Use native Lovable for schema review/application. The prior external Supabase access discussion below is historical and is not a remaining requirement.

Parent coordinates the migration and first verified Calendar event. Apply reviewed migration before publishing this application. Do not activate `rollover.ts` directly: it is a tested dependency-injected contract requiring deterministic provider creation. Native automation must instead use the parent's reviewed durable unique-cadence creation ledger and stop on unknown outcomes. No Calendar event, job, database migration or email send is performed by this branch.

Validation: 673 tests across 54 files passed; TypeScript passed. Production build result is in the accompanying evidence. Hosted membership-gating and live preview checks remain post-migration validation requirements.

---

# Circle sessions and announcement review

Private implementation; no production migration, calendar event, credential, job, email, or deployment was created.

## Repository and environment

Base: `a42797a` in `mwilkinson82/contractor-command`. Work is isolated in `/Users/marshallwilkinson/Documents/Codex/2026-10-14/task/contractor-command`. Existing Mac checkouts were not changed. The clone contains no AGENTS.md, CLAUDE.md, or general engineering policy; existing Circle membership/announcement documentation was read and followed. `supabase/config.toml` names `qcbbjjjxcacrscfhgfmf`. The connected Supabase `get_project` call for that ID returned **You do not have permission to perform this action**. That ID is repository evidence, not confirmation of the deployed database. Do not use a similarly named project as a substitute.

## Application changes

`/admin/announce` offers General and Call announcement modes. General omits session details and permits an optional custom CTA. Call selects a persisted, future, scheduled session and adds its authoritative date/time/time-zone/duration and a Hub link. Admins can enter/edit manual sessions, refresh, or cancel Hub publication. Calendar-managed events are edited in Calendar and then reconciled. Save publishes to the Hub but does not send email or create Calendar events.

Rendered preview uses the same renderer and session resolution as send. Call send requires the exact content/session preview hash. Session version changes invalidate it. The server rechecks before enqueue and both existing workers recheck before delivery. Started, canceled, missing, changed, or unreadable sessions fail closed. Existing audience review, exclusions, suppression, delivery eligibility, Lovable test provider, and transactional queue remain.

Calls, home dashboard, call reminder dialog, sidebar and add-to-calendar links now derive from the same service-only table. Current calls remain available until their end even when the next call is published. No future date is fabricated when the table is empty. Members receive metadata and Hub URLs only; the Join action resolves the current persisted identity, checks canonical Circle entitlement server-side, checks session status/end, and only then returns the unique Meet URL. The topic-selected notification also points to the Hub.

This prevents the application from revealing a meeting link to an ineligible member. It does **not** prevent an eligible recipient from copying a Meet URL after obtaining it, revoke previously copied URLs, alter Google Meet settings, or remove already published links from old emails/builds/caches. Hosting and Google admission controls remain separate.

## Migration and minimal existing-authority publishing route

Unapplied migration: `supabase/migrations/20261014172528_circle_sessions.sql`.

- `public.circle_sessions`: service-role SELECT/INSERT/UPDATE only, RLS enabled, no anonymous/authenticated grants. Unique `(calendar_id, calendar_event_id)`, `cadence_date`, and `meeting_url`. Version trigger invalidates previews on updates. No seed sessions or cron activation.
- `member_announcements`: adds `announcement_mode` and safe `session_snapshot` (no Meet URL).
- `public.publish_circle_calendar_session`: SECURITY INVOKER; execution revoked from public/anon/authenticated, granted only to service_role. Atomic upsert under event advisory lock. Exact replay/older updates are no-ops; canceled records cannot be resurrected. Pending/failed conference publication is rejected. New records must be future events. Unique Meet and cadence constraints catch conflicting event creation.

After verifying the actual project, an already authorized connector may execute parameterized SQL or the existing Supabase REST RPC at `/rest/v1/rpc/publish_circle_calendar_session`. Do not expose a service key in the browser or add credentials for this work. Parameters:

```
_calendar_id text
_event_id text
_title text
_starts_at timestamptz
_time_zone text
_duration_min integer
_meeting_url text
_calendar_updated_at timestamptz
_cadence_date date
_conference_status text -- must be 'success'
_description text -- plain session summary, no Meet URL
_rollover_enabled boolean -- default false until activation is approved
```

The connector must reread Google Calendar and verify event/calendar identity, confirmed status, start/end, non-recurring event, successful conference generation, and video-entry URL before calling. `_cadence_date` is the original planned Sunday and must remain stable when an event is rescheduled. For cancellations, update that specific row to `status='canceled', rollover_enabled=false` with the expected version; reconcile Google first and preserve the tombstone. No delete grant is provided. Reopening a canceled call requires explicit review rather than automatic resurrection.

## Recurring runner integration — not activated

No Google Calendar OAuth/API client exists in the repository. The scheduler module concerns construction CPM calendars; the existing pg_cron paths process email. `rollover.ts` is a tested integration contract with dependency-injected authorized Calendar/Hub operations, not a registered live job or credential installation.

After a session starts, the runner rereads it, pauses on cancellation/rescheduling, calculates two **local-calendar Sundays** later at 17:00 America/New_York (90 minutes), ensures a separate event and fresh conference, rereads until conference success, then atomically publishes. Oct 11 → Oct 25 is 21:00Z; Oct 25 → Nov 8 is 22:00Z. Current call remains available through 18:30 local. A missed cadence, conflicting manual booking, exception, invalid conference, reused link, or cancellation needs review rather than backfilling guessed events. A failed Hub publish retries the same confirmed event.

Duplicate prevention must cover Calendar creation, not just database upsert. The code adapter requires stable provider event ID and conference request ID (SHA-256 of calendar/cadence) so timeout retries cannot create another event. If the connected Calendar create tool cannot accept a deterministic ID/idempotency key, **do not wire it directly to `ensureEvent`**. Use a durable unique-cadence reservation/attempt ledger and one runner, write the creation attempt before calling, persist returned event ID immediately, and halt unknown-outcome attempts for reconciliation. A search-then-create sequence alone is not safe under concurrent runs. Conference retries must operate on the same event; never create a replacement merely because generation is pending or a response is lost. Parent must verify this capability before activating any recurring automation.

The parent-confirmed Calendar connector supports standalone events and `add_google_meet`; its deterministic creation/idempotency semantics remain unverified. The Hub write authority is also blocked as above. No recurring runner should be activated until both are resolved. Calendar events should contain no member attendee list, and notification settings must avoid member sends.

## Review and deployment sequence

1. Verify actual deployed project/hosting and existing connector authority. Review migration and code independently.
2. Apply migration to an isolated staging database; validate RLS/service permissions and existing membership RPC. Regenerate DB types through the project's normal Lovable path when ready.
3. Deploy a private staging build and test admin session CRUD, cancellation, preview/send parity with fake delivery, current/expired/held members, absent session, and DST. The local tests use synthetic records; no hosted authenticated browser session was exercised.
4. Review integrated final logo-kit assets and email proofs. Validate asset URLs on staging. Browser checks do not establish Gmail, Apple Mail, Outlook, dark-mode or forwarded-message compatibility. Perform those inbox checks only after explicit approval to send the specific tests.
5. After production approval, apply migration before publishing application code through the existing Lovable workflow. Deploy updated queue workers together. Old code lacks new session behavior; old client bundles may still contain the historical link until caches age out.
6. Parent confirms/creates the initial actual Calendar event and conference, publishes it once using the service connector, verifies Hub readback and fresh membership gating, then separately activates the idempotent rollover runner. No emails are automatically triggered by event/session publication.
7. Rollback application if needed while retaining session data/tombstones. Do not drop the table while new queue payloads remain; withhold invalid call announcements. Pause runner first for integration failures.

## Verification and limitations

Local full suite passed 673 tests across 54 files, including new PGlite schema/ACL/idempotency tests and both actual queue worker paths with delivery mocked. TypeScript and production build passed using the lockfile's TanStack versions. The repository's pre-existing manifest/lock mismatch prevents a clean `npm ci`: config package lock is 2.23.1 while manifest requests 2.25.3, and current TanStack resolution conflicts with Vite 7. Local install used legacy peer resolution and restored locked TanStack versions without changing manifests/lockfiles. Reconcile dependency installation separately before CI release.

Responsive proof generator: `src/lib/email-templates/__tests__/responsive-preview.test.ts`. Browser runner: `output/playwright/check-email-layout.cjs`; measurements: `output/playwright/layout-results.json`; screenshots and inert HTML are under `output/playwright/`. Final responsive browser verification passed all 60 cases (five variants × six widths × standard/stress content), with no overflow, missing images, undersized primary buttons or shell-width errors. TypeScript and production build passed. All browser calls remained on loopback and no member emails were sent.

## Activation clarification (14 October 2026 follow-up)

Exact attempted operation: connected Supabase tool `mcp__codex_apps__supabase_get_project`, arguments `{"id":"qcbbjjjxcacrscfhgfmf"}`. The returned text was:

```json
{"error":{"name":"ProtocolError","message":"MCP error -32600: You do not have permission to perform this action"}}
```

The tool envelope also reported `isError: true` and structured `error_code: "INVALID_ARGUMENT"`. The explicit permission denial is the actionable result; the wrapper code does not establish that the project ID is malformed. No database query or mutation followed the denial. This was a connector/service permission denial, not an automatic local approval-review rejection. It does not identify whether account membership, OAuth organization scope, project ownership, or a managed backend is responsible. No retry with another identity, key, route, or similarly named project was attempted.

Evidence mapping is incomplete:

- `supabase/config.toml:1` contains `project_id = "qcbbjjjxcacrscfhgfmf"`.
- `src/integrations/supabase/client.ts` chooses its URL from `VITE_SUPABASE_URL` (build time) or `SUPABASE_URL` (SSR); it does not read config.toml.
- `src/integrations/supabase/client.server.ts` chooses the server URL from runtime `SUPABASE_URL`.
- Those files instruct connecting Supabase in Lovable Cloud when configuration is missing. This is evidence of the project's integration pattern, not proof of backend ownership or of the current published environment.
- No live deployment environment, authorized project-detail response, or owner-confirmed project mapping was obtained. Therefore this work **cannot claim qcbbjjjxcacrscfhgfmf is the live Hub database**.

Supported user action, without an access workaround:

1. In the existing Lovable project that publishes `app.alpcontractorcircle.com`, have its owner open **More → Cloud** and identify whether it uses Lovable's built-in backend or an externally connected Supabase project. Verify the non-secret production project reference/URL used by both deployed client and server; report only the hostname/reference, never API keys or tokens. A read-only project-info request inside that already authorized Lovable project is suitable. Do not change the configuration.
2. If it is an external Supabase project, the owner should confirm their normal Supabase dashboard can access that exact project and owning organization. Use the connector's standard sign-in/authorization flow with that authorized account and organization; if account/project permissions are absent, the organization owner must resolve them through normal access administration. Do not assume reconnecting alone fixes it, and do not create a personal access token/service key as a substitute. No such authorization or permission change has been performed in this task.
3. If it is Lovable-managed Cloud, use that project's supported Cloud database/SQL interface or Lovable support to establish the supported integration path. A personal Supabase connector is not proven to manage a Lovable-owned backend. Do not move/migrate the backend or search for privileged credentials to bypass the denial.
4. Once ownership/mapping and normal authorization are confirmed, repeat the harmless exact-project lookup (where supported) and a scoped read of the intended Hub schema. Only then review the separate migration/write authorization. A successful project read alone does not prove permission to publish sessions.

Official references: [Lovable Cloud and its More → Cloud interfaces](https://docs.lovable.dev/features/cloud), [Supabase access control](https://supabase.com/docs/guides/platform/access-control), [Supabase MCP authorization and project scoping](https://supabase.com/docs/guides/ai-tools/mcp). These document supported paths, not a diagnosis of this account's denial.

### Fail-closed Calendar procedure for a connector without proven create idempotency

- First search the **verified calendar** for the target cadence/date and stable session marker; include canceled events and inspect any previously recorded event ID. Exactly one matching confirmed event is reread and reused. Multiple candidates, conflicting details, a cancellation, or incomplete search results stop for reconciliation.
- Only after an authoritative search returns no candidate, no unresolved prior attempt exists, and one serialized runner holds a durable unique-cadence reservation may it record an attempt and call standalone event creation **once**, requesting a fresh Google Meet conference and no member attendees/notifications.
- Save the returned event ID immediately. Reread that exact event to verify calendar identity, date/time/timezone/duration, confirmed status, and conference success. Pending conference generation permits bounded **reads of the same event**, not another event creation. Failed generation stops for reconciliation of that event.
- If the create request times out, disconnects, or returns an uncertain result, mark the attempt unknown. Search/reread using the stored ID when available, cadence and stable marker. A single verified matching event may be adopted; zero or multiple matches after an uncertain create still stop for reconciliation. Zero search results do not prove the create failed, because visibility can lag. Never blindly retry create, clear the attempt, or mint a new marker.
- Publish only the confirmed event and successful unique conference. If Hub publication fails, retry only the idempotent Hub upsert for that same event. Preserve the current call until its end. Keep automatic creation paused while identity/outcome remains ambiguous.

This connector procedure is a documented activation requirement, **not implemented production scheduling or a claim that the current connector supports durable reservations**. The code adapter still requires provider-backed deterministic identity; do not map an ordinary non-idempotent create call to `ensureEvent`. No Calendar event or automation was created by this clarification.
