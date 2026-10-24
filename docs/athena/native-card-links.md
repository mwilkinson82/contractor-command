# Native card links after #273

## Live finding

Approved #273 was published through the existing Lovable deployment `e681a11e-3847-408f-b128-24a594e66303`, code `51ab072728a18a3059c369e6e424e437818898aa`.

Read-only live checks on existing owner-only QA-246 submittals QA-SUB-267-C/G show the cover sheet, transmittal, item/source list, Draft, not sent labels, built-package log state and exact package URLs. The authorized record URL redirects to the expected immutable package PDF. The browser pane's PDF surface is blank, so this redirect alone is not a new visual PDF-content pass; the earlier #267 PDF verification remains separate.

Claude mounts the card in a sandbox with scripts, same-origin and forms allowed, but no popup permission. Ordinary card anchors target a new tab and do not open there. ChatGPT intercepts the same link and shows its external-link confirmation. Neither observation justifies weakening the sandbox or changing access.

## Candidate fix

Native cards delegate a click on an allowed Athena report link to the initialized parent with MCP Apps `ui/open-link`. Nested labels and keyboard activation retain ordinary anchor semantics. The exact URL, board key and package ID are preserved. Off-origin, credential-bearing and non-report links never produce a navigation request. A rejected request shows a neutral notice without replacing the card or claiming success. Teardown removes the listener.

The native resource is versioned to v3 so Claude fetches the corrected client. Both v2 and the original resource remain readable. ChatGPT's legacy `ui://athena/card.html` and its outputTemplate are unchanged. No new network allowance, tool permission, migration, email, AI call, auth change or data change.

## Verification

2,438 tests across 233 files pass, including all 17 locked behaviors. Build and changed-file semantic lint pass; TypeScript retains exactly the same 32 baseline diagnostics. A private browser reproduction uses the real live package HTML in the same restricted sandbox and verifies an actual click emits the exact host link request. Unit coverage checks handshake ordering, URL boundaries, exact keys, unique request IDs, rejected requests, origin checking and teardown. Real Claude click verification remains pending candidate publication.

Marshall separately approved enabling ChatGPT's account-wide Enforce CSP for custom apps setting. The switch was changed from off to on; the refreshed-card badge and rendering check is tracked separately from this code change.
