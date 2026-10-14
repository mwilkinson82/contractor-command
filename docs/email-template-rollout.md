# Responsive email rollout

## Source and runtime map

Verified against GitHub main c8a1cb30 and the same Lovable Hub source revision (project 362c776b-68ab-4871-bedb-c42cb9843c1b).

| Path | Rendering / existing behavior |
| --- | --- |
| Signup verification and other auth emails | `src/routes/lovable/email/auth/webhook.ts` maps signup, invite, magiclink, recovery, email_change and reauthentication to React templates. Signed webhook props supply recipient, confirmation URL and token. Renders HTML/plain text, then enqueues `auth_emails`. |
| Stripe Circle welcome | `src/routes/api/public/stripe/webhook.ts` calls `enqueueCircleWelcome`; `circle-welcome` is rendered before `transactional_emails` enqueue. Existing subscription idempotency and suppression remain unchanged. |
| Login reminders | `enqueue-login-nudge.ts` and `send-login-nudge-now.ts` render the existing `login-nudge`. The direct-send provider call is unchanged. |
| Control Loop / orientation outreach | `CONTROL_BASELINE_CAMPAIGN` supplies current subject, Markdown and `/start-here` CTA to the existing audience-reviewed member-announcement workflow. The redesigned shell wraps that same content. |
| First-step design | `circle-first-step` is registered for existing explicit transactional-template selection/preview. No new automatic onboarding campaign, trigger, or member send is added. |
| Admin announcements | `src/lib/announce.functions.ts` renders `member-announcement` using existing headline/body/preheader/optional CTA/signoff bindings. Audience review, exclusions, membership eligibility and suppression are unchanged. No session schema or callSession prop is required. |
| Other transactional templates | Existing registry and consumers continue unchanged. Shared header/footer refresh also reaches admin activity and State of Control report templates. |
| Delivery | `process-queue.server.ts` sends saved HTML through `sendLovableEmail`. It does not rerender templates. Provider acceptance is not proof of inbox delivery. |

## What is persisted before publication

Auth and transactional queues contain already-rendered HTML/plain text. Transactional approval staging also stores `email_approvals.html` and `plain_text`; approval sends those saved values. Publishing new templates affects new rendering only. Existing queued messages, approvals and delivered mail keep their old HTML. Do not rewrite those rows, recreate campaigns or resend members as part of this release. Live row counts were not inspected: prior database denial is respected.

## Deployment boundary

These are TanStack Start server routes bundled into the Lovable application. There is no `supabase/functions` renderer in this repository. Publish the full application server build plus `public/brand/circle-v1/email-cream.png` and `email-ink.png`; no separate hosted template registration, queue worker deployment, database migration, auth-hook reconfiguration or provider change is required by this patch. Existing configuration must continue pointing to the same app routes. An editor commit or Git merge alone is not a production deployment.

## Isolation from unpublished MCP work

Current main includes MCP/OAuth changes explicitly marked Do NOT publish in Lovable history. Do not publish current main wholesale. Keep the template integration PR based on main for future integration, and prepare a separate release branch from verified published baseline 60c2fc736afba5d4be4bad909ab0ff559aefe4f5 with only this email patch. Do not reset/revert main or toggle the MCP feature.

Lovable documents the active Git branch picker under Project settings > Git > GitHub (https://docs.lovable.dev/integrations/github). The publishing tool exposes no commit selector. Proposed release: review isolated release diff; use that existing branch picker after release coordination; verify Lovable sync and publish preview match the exact isolated revision; publish only that revision; verify new assets and authenticated read-only auth/transactional previews. If the UI cannot establish the selected publish revision, stop and obtain a supported commit-targeted release route. Preserve main's work and restore its editor branch after coordinated release without republishing it.

No publication or branch setting change is performed by this implementation pass. No test/member emails are sent. To verify real delivery later, inspect normal authorized provider activity for naturally generated new messages; do not call send/webhook/queue-drain endpoints merely to verify design.

## Validation

652 tests across 52 files, TypeScript and application production build pass on the current-main integration branch. Render test covers every registered template plus all six auth types and current campaign variants. 42 Chrome layout cases (21 variants at 320px and 800px) have no horizontal overflow and all images loaded. Screenshots are synthetic local previews, not inbox/client certification. Gmail, Outlook and Apple Mail delivery/client rendering were not exercised because no emails were authorized.

The pre-existing manifest/package-lock mismatch still prevents plain npm ci; local validation uses installed dependencies with the existing locked TanStack versions and does not alter manifests.
