# Email repair review — October 14, 2026

Base: main `02a8c17eb24c07088e2073ad8aa7c6e42475874e`.

This repair restores the previously approved responsive email patch and its two PNG assets onto current main. It preserves the newer login, consent, and MCP work. Both production asset URLs returned 404 during diagnosis; received welcome HTML references `email-ink.png` on the custom domain.

Auth webhook queue payloads now explicitly include `reply_to: MEMBER_REPLY_TO`. Both existing queue processors already default to that address; normal welcome/login senders already set it. Native Lovable test emails bypass these application send paths, so this change does not establish that native test emails will gain Reply-To. Their received headers must be checked independently, and a platform-supported native-test configuration is still needed if that flow must carry the header.

Login evidence: the separate Lovable investigation reports a 22:49 UTC request for a mistyped `mashallwilkinson.com` domain and a `not_a_live_member` result. Its fix to false-success reporting is preserved in the base. No auth-user/subscription or queue-count queries canceled by the user were retried. No login emails were sent during this repair.

Production regression verified: deployment `5017e2b5-9ec7-4d0b-ad13-ef83905bb8d6` serves `/assets/calls-Iz2sT45d.js`; its Calls component uses the imported static next-of-kind selector, matching current main's `nextOfKind("Biweekly Call")`, rather than canonical session loading. The authenticated QA tab is now signed out, so no login request was made. The calendar/session feature needs separate reconciliation from the preserved session release.

Validation: TypeScript and production build passed with current-main dependencies installed in this isolated checkout. Both restored PNG hashes match the previously approved release. No changes to login/consent/MCP files.

Release checks: review this diff against current main; do not overwrite any newer commits. No migration required for this email-only repair. Publishing requires explicit approval of the resulting release, including any unpublished work already in its base. After deployment verify unauthenticated GET of both PNG URLs returns HTTP 200 and image/png, then verify received email images and raw Reply-To headers. This branch does not restore the separately isolated calendar/session feature; reconcile that feature before a combined release.
