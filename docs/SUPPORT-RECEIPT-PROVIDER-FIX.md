# Support receipt provider identity correction

Live source base: 5aad97fed9efaa745ddbe349bf1f0adf0fba10bd. Local equivalent baseline: 65a7854.
Athena/Circle customer receipt flags remain OFF; intake and the dashboard remain live. A2 original and reply were each sent once. Preserve ATH-0005 and ATH-0006; no ticket/history rewriting, original resend or unapproved replay.

## Cause and behavior
The provider replaced the requested Message-ID. The original receipt was delivered with an SES Message-ID, which the authentic same-sender reply correctly referenced. The app correlated only the originally requested random support Message-ID. Sender SPF/DKIM/DMARC all passed. A2 therefore split into ATH-0006 and suppressed its receipt.

The fix retains the provider's accepted email ID immediately after send, retrieves its actual Message-ID through the existing authenticated GET /emails/:email_id API, validates the ID and exact frozen from/to/no-CC/BCC identity, and completes receipt identity plus sent state atomically. A lookup/database response retry uses the retained provider ID and never POSTs again. If acceptance could not be persisted, the existing frozen payload and same idempotency key remain the only send retry; the existing 23-hour unknown-send bound remains. Known accepted IDs allow read-only metadata recovery beyond that window. Permanent identity conflicts enter review. An early verified reply waits for pending receipt identity instead of guessing a join or prematurely creating a second ticket.

The existing sender/brand/live-receipt/review predicates remain. No subject-number join, arbitrary customer Message-ID join, auth relaxation, new credential, app-role grant, customer-content change, or automated substantive answer is introduced. Frozen delivery payload retains the originally requested header even after actual receipt metadata is committed.

## Managed SQL proposal
File: docs/migrations/support_receipt_provider_identity.sql
Bytes: 11660
SHA256: 591fce98f3b3f7b08fe36bb54920c59afffc96eca74c6f544b8cb4ab0b8070e5

Apply this exact proposal once with the supported managed runner after fresh history/source reconciliation. It adds one nullable provider_email_id column and private unique index, adds two token-bound SECURITY INVOKER completion functions restricted to the existing service role, and replaces record/claim functions only to expose retained delivery identity and defer an early reply. No legacy backfill or row merging. Existing four-argument finish function is retained for transition compatibility. The managed runner assigns the next collision-free identity and regenerates only its normal migration/type metadata; do not manually edit or replay the journal.

Index creation is an ordinary bounded write lock on the small support-delivery table; no concurrent-index runner dependency. If the actual table size or backlog differs materially, report before application. No intake hold is required for this additive transition with receipts OFF. Stage source through native editing; reconcile exact diff; apply managed SQL; verify private ACLs/functions and compile; publish compatible source. Coordinate this with the accepted accounting/account patches in one release; do not overwrite their source.

After new accepted provider identities exist, recover by forward repair with receipt flags OFF; do not roll back to an old processor that ignores accepted IDs or restore the whole database. Preserve financial/support history.

## Evidence and honest limits
- 89 focused tests passed, including real PGlite SQL + processing tests with provider header replacement, same-ticket continuation, no replay sends, lookup outage, accepted-ID persistence failure, early reply, stale token, foreign sender/brand, preview and unverified sender refusals.
- Nine PostgreSQL 17.6 socket-only synthetic cases passed: atomic migration, concurrent claims, immutable acceptance race, early-reply deferral, actual ID continuation, isolation, concurrent receiving replay, metadata recovery after send-key lifetime, app-role denial/service-role completion.
- TypeScript, scoped ESLint, build passed. Build-generated MCP transport files were restored to exact baseline; none are in this correction.
- Broad suite: 3029 passed, 18 failed, four skipped, two existing TODOs. All 18 failures reproduced in unchanged 65a7854 baseline. No claim of a fully green broad suite.
- Two existing support test fixture paths now load the actually installed drizzle 0043 SQL instead of an absent supabase proposal; no schema duplication.
- Managed provider GET capability and positive delivered-mail continuity still require verification after release. Keep customer receipts OFF until the coordinated native same-sender acceptance succeeds. Do not claim local mocks establish provider runtime behavior.
- New original test sends must be specifically coordinated; never blindly resend A2. No additional mail was sent during this local repair.

Official provider contract: https://resend.com/docs/api-reference/emails/retrieve-email (response includes id, message_id, from, to). Existing production observation independently confirms this metadata.
