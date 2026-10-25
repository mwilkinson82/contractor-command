# Preserve member construction references in card text

The live #282 test reported that P9 on job 2701, submittal 05 12 00-001,
keeps `TEST upload #282, delete later` on the record page and in ChatGPT,
but loses `#282` in Claude and Grok Bot. The saved source is intact per the
tester's report. P9 is left unchanged for their full acceptance rerun.

## Cause and change

`plainLabel` removed `#` plus one to four digits from every cell, and treated
standalone hash references as internal IDs. Server-built HTML for Claude and
the styled Markdown fallback use this shared function. A separate copy of the
same rule existed in the ChatGPT widget. It could also erase construction
references in notes, RFI titles and change order titles.

Both renderers now preserve hash references as visible content, including
standalone numbers and alphanumeric references. Explicit `row.refId` stays in
metadata; UUID suppression and existing link validation remain. HTML still
escapes member content. No storage/write, package/build, auth, Hub, email,
AI-call, migration, template URI or permission changes are involved.

## Verification

- New regression suite fails all eight cases against the prior renderers.
- Full suite: 2,518 tests across 242 files pass, including 17 locked behaviors.
- Production build passes. New test passes strict ESLint; touched legacy files
  pass ESLint with only their existing formatting rule disabled.
- Tests cover the exact P9 source text, notes with RFI #12 / CO #3 / Bulletin #4,
  RFI and change order titles, standalone/long/alphanumeric references, and HTML
  escaping in table/list/chip layouts. The ChatGPT widget script is executed.
- A local PostgreSQL test saves a source through the real submittal log function,
  reads it through the package handler, and checks the saved value plus all three
  renderer outputs. Get creates no package.
- No production records were read, uploaded, deleted, built or sent for this fix.

After an approved publication, Grok Bot owns live acceptance: get the existing
P9 in all three hosts and compare its source to the record page. No upload,
rebuild, send, data cleanup or historical renumbering is needed. Other #282
passes and the full #278 checklist remain required. This local verification is
not a live-host acceptance pass.
