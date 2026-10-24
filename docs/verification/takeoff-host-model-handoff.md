# Takeoff reading belongs to the member's model

Candidate off `codex/athena-passwordless-login-only` at `57873d40` (#268). Not merged or deployed. The live reader still uses the previous backend inference path until this candidate is approved and published. No production propose calls were used to test this candidate.

## Ownership and workflow

The member's chosen AI interprets drawings, notes, specifications and contract requirements. Athena supplies stored originals and readable regions, retains project context and scope decisions, validates coordinates and geometry, computes from confirmed scales, stores proposals/checkpoints, and renders editable geometry and dated versions. Estimator approval remains separate. There is no Athena inference provider or paid fallback.

At intake and on the drawing card, the member sees: “Before we start, switch to the strongest model available in your AI app that can read images and reason through drawings. Enable its deeper reasoning option if available. Athena cannot change that switch for you.” No specific model name is guessed from the app name. Optional `observations.reported_model` is stored as **host-reported**, never detected identity.

1. Confirm role, trade scope, document revisions and agreed inclusions/exclusions through existing intake.
2. The connected AI reviews this job's drawings, notes, schedules, specifications and contract. Existing `estimate_doc_review` stores the sheet/spec comparison; `estimate_gap_analysis` stores cited supported findings, missing requirements, conflicts and estimator questions. The fixed foundation checklist supplements this process and does not certify coverage.
3. `takeoff_geometry propose` without observations prepares the exact source/hash/version/line/checkpoint and returns target/reference PNGs plus saved project context. Context is provided in factual text as well as structured data, since some hosts expose only text to their model. Missing context and truncated contract excerpts are explicit; saved review records do not prove the underlying documents have been read.
4. The member AI inspects the images and returns `observations.findings` (image-relative x/y 0–1000), visible evidence, confidence and unresolved questions with the same pass ID/cursor. Reference images are not counted. An empty observation means inspected but no matching instance, not proof nothing exists elsewhere.
5. Athena validates schema, source, checkpoint, scope, ink, topology and calibration, computes quantities using the existing deterministic engine, and stores **proposals**. It does not invent locations or copy a target quantity. A passed ink check does not establish semantic identity or complete scope coverage.
6. The estimator reviews geometry, evidence and uncertainties and explicitly accepts exact revisions. Accepted dimensional geometry remains classified Verify unless its confirmed calibration is dimension-checked on the same source/page; this annotation does not undo acceptance or invent a scale check. Counts need no scale. The gap review stays open for unresolved or unread scope even when the current lines or tile pass are settled. Card wording says “regions reviewed; check unresolved findings,” not “coverage complete.”

The two card buttons send a member-initiated MCP Apps `ui/message` to the connected AI. They do not run a server read loop. Hosts without that capability receive a continuation instruction in the card; no backend inference fallback is available. A model unable to inspect images must state that limitation rather than fabricate observations.

## Dense regions and old history

`split_region: true` returns four smaller PNGs of only the pending region. All four distinct parts must be returned before the parent advances; positions map back to the exact parent frame, including odd pixel dimensions. Previous checkpoints remain. This is an explicit continuation control, not an automatic host-timeout detector (the server cannot observe the host model's own thinking timeout).

The current card omits historical EXAMPLE/sample/placeholder lines from its dropped-lines panel. Historical records remain intact and real dropped scope remains visible. All six extracted S-100 captions remain unchanged.

## Inference boundary and protected Hub features

The scoped ESLint rule and transitive import test prevent Athena MCP code from reaching `src/lib/ai-gateway.ts` or inference SDK imports. Runtime search for `ai-gateway` and `LOVABLE_API_KEY` in Athena MCP source is empty.

The shared helper and all six Hub entry points are byte-identical to the base: Ask chat, contract scan, owner plays, SOP backlog, SOP drafts and scheduler draft. Automated checks verify their gateway imports remain permitted. These checks and the production build are **not** a live six-feature inference test; no paid Hub requests were made.

No migration, auth, Hub, email, permissions, connector or stored original changes. Production database work, if needed later, remains exclusively through Lovable Cloud.

## Verification and limits

- Full app suite: 2,367 tests across 226 files pass, including 17/17 locked behaviors; production build and manifest synchronization pass. Changed-source lint passes except four pre-existing formatting findings in index.ts (unchanged count); estimate-tools.ts is clean. TypeScript has the same 32 baseline diagnostics, none in the new takeoff code.
- Workers verification denies every outbound request, renders actual approved PDF pages 3/15/19, produces the member-model handoff, parses observations and splits the target without inference.
- Private browser fixture verified both AI buttons send `ui/message` with the selected source, line, calibration and split flag, with no `tools/call` or implicit acceptance. Phone-width layout checked at 390 px.
- In signed-in normal ChatGPT and Claude chats, read-only `tile` calls supplied actual S-100 tile 18 from the owner-only QA-246 job. Claude returned a source-cited footing pin with unresolved questions; the candidate's independent raster/location check passed it on the locally rendered source tile. Nothing was saved or estimator-accepted. ChatGPT at Medium returned no pin and specific unresolved identification questions, including after adjoining context was requested; at the highest available Pro setting it returned a source-cited footing pin that also passed the independent raster/location check. These are different interpretation-confidence reports, not accuracy probabilities. This is evidence of differing interpretations, not an end-to-end quantity accuracy pass.
- The candidate's registered `observations` schema and full prepare→submit→persist loop have not been tested live because it is not published. Automated pipeline tests cover that sequence. Live acceptance follows Marshall's exact release approval.
- No full CCW-003 quantity/coverage score is claimed. The approved workbook has three unresolved conflicting quantities; scope sources also conflict. Those rows remain unscored. A proper benchmark needs the agreed scope, per-line source/evidence, baseline from the same host/model and independent quantity comparisons. A single accepted location does not establish that Athena-assisted takeoff beats that baseline.

## Post-approval release check

Merge only this reviewed head into the Athena branch; publish through the existing Lovable deployment, then refresh existing tool schemas. Verify no runtime inference calls, the real prepare→host observations→proposal path in ChatGPT and Claude, checkpoint continuation/split, dated geometry output and explicit estimator acceptance. Preserve job 2701 checks, current cards, sources and originals. Use owner-only QA and do not modify production job quantities to force a pass.
