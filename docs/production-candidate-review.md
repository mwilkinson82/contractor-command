# Production-based email/session candidate

This note supersedes historical environment and release-status statements in the cherry-picked rollout notes.

Base: `fd09657cb821f9ff306405740a5b3e12ea2311b0`, verified in the public login HTML's explicit data-commit-sha under deployment `5017e2b5-9ec7-4d0b-ad13-ef83905bb8d6`. Branch: `codex/production-email-session-candidate`.

- `31f44e2`: approved responsive email templates/assets and explicit auth queue Reply-To.
- `79c66fe`: canonical Circle sessions, Call/General announcements, preview/send validation and membership-gated unique Meet resolution.
- `2f53bda`: separately reviewable safe login correction; only the three reviewed login/server/consent files plus one focused security test file.

The newer main patch returned not_a_live_member and suppressed to unauthenticated callers. This candidate deliberately does not import those disclosures. Every valid magic-link request receives the identical `{ok:true, action:"accepted"}` response; actual outcomes remain server-side. The login UI acknowledges receipt without claiming delivery, gives a spelling/password fallback, and uses a generic transport-failure message. OAuth sign-in defaults to password, and authenticated consent makes switching accounts clearer while preserving its authorization redirect. Six mocked outcome tests cover sent, suppressed, failed delivery, absent account, link generation failure and internal failure; they assert response equality and the existing 600 ms minimum delay. This preserves the baseline delay, not a claim of constant-time processing or complete timing-side-channel elimination.

No changes relative to production in MCP implementation, plugin-managed routes, .lovable configuration, Drizzle migrations, AGENTS.md, or dependency manifests/lockfiles. The newer main MCP work is excluded. The session schema migration is included as existing feature source/history; the parent confirms it is already applied live. Do not run migrations during this release. The separate creation-ledger migration was not cherry-picked. Existing October 25 event/session must be reused; no creation or email send accompanies publication.

The native Lovable test sender's Reply-To remains unverified. The app SDK supports reply_to; the native preview contract and published test controls expose no proven setting. Application queue changes do not prove native test-header behavior.

Validation: 679 tests across 55 files and TypeScript passed. The production build result is provided in the handoff. Dependencies were already installed locally with legacy peer resolution; manifests/lockfiles remain identical to production. No live authentication or delivery test was performed.

Release: review these commits against the verified production base, obtain pending push authorization, then obtain explicit deployment authorization. After deployment check both PNG URLs, canonical October 25 Calls metadata, Call preview/Hub CTA and membership gating. Keep the existing rollover automation fail-closed until its canonical-integration preflight passes. No publish, push, live migration, event mutation or email send was performed while preparing this candidate.
