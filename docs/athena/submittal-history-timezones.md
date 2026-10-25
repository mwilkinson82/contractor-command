# Submittal build-history time zones

This replaces #281's fixed Manaus build-history display. The Owner upload fix and
two-copy wording remain unchanged.

## Display and saved context

The record RPC returns `time_zone_context`: raw saved job, company and member
zones. Card and record history select the first valid zone in that order, never
the server or viewing device's zone. The existing legacy `time_zone` field still
serves its original callers; its assumed New York default cannot outrank an
actual saved company/member setting. A record with no new context can still use
that legacy field during rollout.

Company defaults did not have a storage field. This change adds nullable
`mcp_companies.time_zone`, with no backfill. The existing Owner-only
`onboarding save_company` flow accepts `time_zone`, validates it against PostgreSQL
IANA names, and permits an empty value to clear it. No permission/grant/RLS change.
Member fallback uses the member's saved `mcp_morning_brief_settings.time_zone`.
If none of the three is saved/valid, the display explicitly says UTC and **no
saved time zone**, rather than inventing a local setting.

Times name the IANA zone and its historical abbreviation/offset, with the date:

- `2026-10-24T19:11:33+00:00`, Chicago job: **Oct 24, 2026, 2:11 PM CDT (America/Chicago)**.
- Same instant, New York job: **Oct 24, 2026, 3:11 PM EDT (America/New_York)**.
- `2026-12-01T02:11:33Z`, New York: **Nov 30, 2026, 9:11 PM EST (America/New_York)**.

Read-only Cloud inspection found job 2701's actual saved zone is America/Chicago.
It was not changed. The saved job setting takes precedence over a member in New
York. No build/send instant, historical copy ID, filename, PDF, fingerprint,
transmittal or current/superseded status is rewritten.

The record freshness stamp now includes the three preferences, so changing a
saved zone refreshes the member page's time labels without changing a package.
Token-backed record readers retain the existing authorization and use the same
record context; the member fallback there belongs to the authorized link issuer.

## Cloud migration and safeguards

Apply **only through existing Lovable Cloud**, once:
`supabase/migrations/20261025111504_athena_submittal_display_time_zone.sql`.

It adds the nullable company column and narrowly patches the existing company
save, record get and record stamp definitions. Guards refuse unexpected source
shapes. Existing gates, Owner checks, roles, function security/volatility/grants,
all stored build timestamps, package data and policies remain intact. No emails,
uploads, builds, sign-in changes or Hub changes are part of this release.

Local PostgreSQL tests run the migration on the real feature prerequisites,
exercise all three zone sources, cache refresh, Owner-only updates, invalid-zone
rejection, excluded-role denial and preserved package instants. Tests also render
the record and actual tool card with different job/company/member zones and cover
DST, midnight rollover, a half-hour offset and missing settings. The actual SDK
Owner-upload regression from #281 continues to run.

Grok Bot owns live acceptance in ChatGPT, Claude and Grok Bot after publication.
Use the existing 2701 record/current package; read-only checks suffice. Expect
America/Chicago and 2:11 PM CDT for the cited UTC instant while the saved job zone
remains Chicago. Check that Owner upload and **Both copies** stay passed. Do not
alter a real job zone or rebuild/upload/send anything just to obtain a pass.
