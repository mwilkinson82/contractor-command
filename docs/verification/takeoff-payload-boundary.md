# Takeoff preview payload boundary

After the host-reader release, a live ChatGPT prepare created the correct checkpoint, but the model could not recover the target image and checkpoint from its reply and submitted no observations. Claude completed prepare, observation submission, persistence and a fresh read. Neither result establishes full takeoff accuracy.

The takeoff result duplicated the full-page PNG as a base64 string in `structuredContent.preview`, in addition to actual image content blocks. A captured list response had roughly 524 KB of preview text in its structured JSON. This is unnecessary model context. It is a plausible contributor to the failed ChatGPT handoff, not a confirmed sole cause.

The follow-up moves only that display preview to `_meta["athena/takeoffView"]` after the SDK's handler wrapper, where result metadata survives. The app reconstructs the same display data from it. Image content blocks, factual text, geometry, sources, calibration and checkpoint fields remain unchanged. The viewer ignores incomplete tool-result notifications rather than clearing a valid result. Resource v6 avoids a cached older script; prior aliases and legacy in-body previews remain readable.

## Verified privately

- 2,381 tests across 227 files; all 17 locked behaviors; production build and changed-file ESLint pass.
- Typecheck output is byte-identical to the previous 32-diagnostic baseline.
- Real SDK transport tests for ChatGPT and Claude retain the private preview, actual image block and exact read-request fields. The preview is absent from model-visible structured JSON. An unrelated email-shaped result is returned unchanged.
- Browser fixture renders the original image at desktop and 390 px widths using only private preview metadata. An incomplete notification leaves the rendered result intact. Fixture has no production connection.
- Manifest extractor produces no changes: schemas and registered tool names are unchanged.

## Still open

The smaller packet has not been published or tested in live ChatGPT. A live rerun must prepare the existing private QA checkpoint, read the returned target, submit only supported observations, and verify the saved unaccepted proposals and unchanged original hash. Do not reuse a prior quantity or claim completion from a card alone.

The separately reported ChatGPT message "Athena could not load this drawing card" comes from the drawing-markup card, not the takeoff viewer. Its exact failing exchange still needs reproduction; this change does not claim to fix it. The calibrated footing-length comparison and complete document-based scope reconciliation remain separate checks.

No migration, backend inference, auth, Hub, email, connector or access changes. Release only through the existing Lovable deployment after Marshall's approval.
