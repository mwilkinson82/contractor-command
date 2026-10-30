# Synthetic dashboard browser verification

Verified October 29, 2026 using the real dashboard component and application stylesheet in the isolated `scripts/support-browser` harness. Router, authentication and server functions are synthetic adapters; no live ticket records, backend credentials or email transport are used. Run `node node_modules/vite/bin/vite.js --config scripts/support-browser/vite.config.ts` and open localhost:4178.

Observed checks: desktop ticket list and conversation, literal HTML-like customer text, proposed reply preview (no send action), stored attachment selection and download as support-attachment-1.untrusted.bin, nonadmin denial, sign-out removal of ticket content, empty list, service error, mobile list and long unbroken messages. Browser console contained no errors. Mobile document width equaled scroll width; the ticket table scrolls inside its container.

Browser review corrected replacement characters, spacing between Refresh and All tickets, and cramped mobile table columns. Screenshots are synthetic fixtures only and included in the release package. The long-message screenshot captures the initial viewport; long content continues below it.

Fixture URLs: `?state=nonadmin`, `?state=empty`, `?state=error`, `?ticket=00000000-0000-4000-8000-000000000001`, and `?state=long&ticket=00000000-0000-4000-8000-000000000001`.

This validates browser presentation and behavior with fixtures, not deployed login, database access, provider authentication, real attachment delivery or mail transport. Existing server authorization tests provide separate local evidence. Production release and receipt activation remain unapproved. No additional account layout changes were made.