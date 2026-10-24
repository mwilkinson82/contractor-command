# Geometry-based takeoff engine

Working implementation from `Athena Takeoff Engine.md`, based on live commit
8a4a6268. This document is a work record, not a production acceptance claim.

## Required end-to-end result

A stored sheet is inspected at estimator-readable resolution. Counts, lengths,
areas with openings, and volumes are computed from source-bound geometry and a
confirmed scale for the relevant plan/detail. The same geometry draws the
highlights, produces dated immutable PDFs, and supplies the estimate quantities.
AI results remain proposals until the estimator accepts them. Unlocated and
unaccepted lines cannot become a final verified bid. Non-drawable exceptions
require a stated basis. Every edit has an actor, source/version and audit record.

## Implementation decisions

- Keep the current original-file storage, indexing, source-ID binding and risk
  markup working. Add a dedicated measurement viewer/resource and guarded tools.
- Coordinates are normalized in the displayed immutable PDF page; measurements
  use PDF physical page units, independent of preview resolution and render dpi.
- A page may have multiple named rectangular calibration regions for different
  detail scales. Geometry must fit one calibration region.
- Render clipped 1024px tiles directly with the pinned PDFium native API, using
  the renderer's existing serialized queue. Never allocate the full 200dpi sheet.
  A 36×24 sheet with 128px overlap takes 48 tiles, rather than the proposal's 40.
- Reuse the existing server AI gateway/Gemini connection. Process bounded tile
  batches with resumable coverage. Ink/path evidence is a geometric check, not
  proof that the model identified the right construction item.
- All geometry revisions and dated exports remain immutable. A changed scale or
  drawing invalidates verification; it never silently moves accepted quantities.
- Existing saved PDFs and original files are preserved. Legacy takeoff lines
  remain readable and are explicitly unlocated until verified or excepted.
- Only additive database objects; stage and test locally first. Production SQL
  is applied through Lovable Cloud after exact release review and approval.

## Verification required before completion

1. Deterministic math and invalid geometry/scale/unit cases.
2. Real PDFium inspection, clipping, rotation and source-byte preservation.
3. Actual additive SQL in local Postgres with role, inactive-member, cross-job,
   immutable-history, revision-conflict and forged-quantity tests.
4. Real tool registration and integration with takeoff save/read/status/export,
   drawing markup and final estimate build.
5. Viewer interactions at desktop and phone sizes, exact tool-call payloads,
   acceptance/conflict/error handling, and actual generated PDFs.
6. Real CCW-003 sheets and independent reference measurements; unresolved
   workbook disagreements are not scored as ground truth.
7. Full Vitest, original16 locked behaviors, build, changed-file lint/type
   comparison and Workers runtime checks.
8. Live normal ChatGPT/Claude candidate checks only in an approved environment;
   no production migration or publication from a generic build instruction.

## Verified private candidate

- Full application Vitest: 2,249 passing tests in 214 files.
- Locked-behavior file: 17/17 (the original 16 plus the already-existing exact-host regression).
- Production build passes. New engine and changed runtime files pass ESLint.
- Type comparison: 32 existing diagnostics versus 34 on unchanged 8a4a6268;
  no new file/error-code families. Type checking is not globally green.
- Legacy role harness: 113 pass, 57 fail on both unchanged base and candidate;
  all 57 failing test names match. The engine's actual guarded SQL tests pass.
- SQL exercised both after current drawing migrations and in historical filename
  order, before the later drawing migration. No production SQL was run.
- Known synthetic end-to-end quantities: 3 EA, 70 LF, 1,150 SF net of an
  opening, and 1,150 × 0.5 / 27 CY from an explicitly cited 6-inch depth.
  The test uses actual PDFium, local Postgres functions, private storage adapters,
  dated PDF/PNG exports, a seven-page final estimate and a changed source revision.
- Original PDF bytes remain identical after measurement and two dated exports.
- The real Workers isolate read CCW-003 pages 3, 15 and 19 from the 17.6 MB
  original, using 48 clipped tiles per 36×24 page. Raw tile bitmap <= 4 MB.
  Source SHA-256 remained unchanged. The fictional 100-foot healthcheck in this
  runtime script proves arithmetic only, not a measured building dimension.
- A browser ran the actual resource with an explicit local fixture host:
  successful handshake, visible source-bound geometry, separate acceptance
  confirmation with exact revision, a simulated save conflict without false
  acceptance, and the 390px phone layout. This is not a live host acceptance pass.
- The real AI SDK request is tested with intercepted network transport. No
  paid provider inference has been executed for this candidate.

Reproduce private checks:

```sh
npx lovable-mcp-extract-manifest .
npx vitest run
npx vitest run src/lib/mcp/athena-locked-behaviors.test.ts
npm run build
node scripts/verify-takeoff-worker.mjs /absolute/path/to/plans.pdf 3,15,19
```

## Deliberate conservative behavior

- Inspection and clipped tiles are generated on demand from the hash-verified
  original. Import does not synchronously run dozens of model calls or store
  hundreds of megabytes of duplicate bitmaps. Stable source/tile/crop references
  preserve reproducibility; only derived dated outputs are persisted.
- Automatic scale confirmation requires two independent nonparallel dimensions.
  Mixed-scale sheets such as CCW-003 S-100 require named calibration regions.
- Large areas whose complete boundary is not visible in a tile require estimator
  tracing in the viewer. Athena never closes a boundary at a tile edge to invent
  a measured area. Ambiguous or missing findings remain unsettled.
- Ink/topology checks establish that a location is drawn; they cannot establish
  that the drawing symbol is the correct construction item or that scope is
  complete. The estimator reviews every proposal and the coverage uncertainties.
- Files over the existing derived-output limit split into private PDF volumes.
  A single oversized marked sheet is refused explicitly, never silently omitted.
- Phone users can review, zoom and accept; precision drawing requires >=768px.

## Exact release and remaining acceptance

The candidate adds the migration
`20261024005713_athena_takeoff_engine.sql`: three append-only RLS-protected
measurement tables, guarded functions, and an insert trigger that carries only
unchanged takeoff-line geometry into a new takeoff version. It does not rewrite
existing takeoff rows, source files or quantities. Production application must
happen through Lovable Cloud, after Marshall approves the exact PR revision.

The migration enables measurement gates for existing historical takeoff lines:
they stay readable, but final measured estimates require accepted geometry or a
reasoned confirmed non-drawable basis. This is a visible intentional behavior
change, not an automatic certification of previous takeoffs.

Before claiming the automated engine ready, verify the existing gateway secret
is configured, run the real provider against three independently checked real
sheets, and run normal ChatGPT/Claude card round trips (plus the text/image
fallback) against the approved candidate. Score counts and location correctness,
length error <=2%, and rejected blank/uncalibrated proposals. Do not score the
three conflicting CCW workbook rows as ground truth. Run job 2701's full
read-only do-not-break checks after the approved publication.

Proposed live test scope: one private fictional QA job owned only by Marshall,
no invites, using the already-approved immutable CCW-003 original. Store only
QA calibrations, proposed geometry, explicit QA decisions and derived files in
that job. At most 144 vision tile calls through Athena's existing Lovable/Gemini
gateway. No edits to the live 2701/CCW estimates, no email, public share, new
connector, auth/Hub changes, or original-file changes. Posting a user update
email is outside this release and needs its own exact content approval.

# Image-coordinate reader after live #250

The next live reply was refused for its vertical coordinate field. The reader now uses numeric x/y locations normalized to 0–1000 on the clean target tile, avoiding the grid-cell offset arithmetic that repeatedly failed. This follows the image-coordinate scale described in Google's image-understanding documentation (https://ai.google.dev/gemini-api/docs/image-understanding#object-detection); point extraction remains Athena's application contract, not a claim of native provider-enforced schema.

The server reads the target PNG dimensions, converts locations exactly into its unchanged internal verification coordinates, and runs the same ink, confidence, calibration, path and geometry checks. Malformed, oversized, mixed-format and out-of-range values are refused, never clamped or snapped. Edge coordinates beyond the actual bitmap remain rejected. Old saved geometry and checkpoints keep the same page-coordinate meaning.

The detailed target is sent clean, without the grid obscuring its features or a duplicate target image. A blue footprint marks that target on the reference-only whole-sheet copy, giving spatial context without asking the model to calculate where the crop belongs. Neither the original PDF nor clean target pixels are modified. The historical grid helper remains available for inspection; it is no longer the automatic provider wire format.

Tests cover non-square image conversion and polygon openings, actual ink verification after decoding, rejection of a boundary point without clamping, input-size guards, exact reference footprint and unchanged source pixels. Linear/area reads now scan the tiles intersecting their explicitly confirmed calibration region; a visible scope note and saved scope bounds identify that limit. Counts keep full-sheet coverage. Overlap ownership and boundary coverage are tested so this does not drop or double-measure any part of the confirmed region. No expected benchmark quantities or positions are sent to the provider.

# Same-sheet scope context and reader feedback

Live #249 correctly refused two more invalid reader replies at the same saved checkpoint. The error now reports a small fixed category (such as an unrecognized cell label or wrong measurement kind), without exposing the model's content, raw validator paths or original drawing text. A rejection never advances tile coverage or saves that tile's geometry.

Each read now includes a bounded overview rendered from the exact same immutable stored page, plus the target tile's normalized page bounds and any named calibration region. The overview is reference-only: it helps distinguish multiple plan views and understand a run crossing a tile edge. All proposed locations still refer to the first gridded detailed tile and pass the same raster, geometry, confidence and scale checks. Geometry audit records cite the same-sheet reference. No benchmark quantities or expected locations are supplied to the reader.

A real PDFium pipeline test checks the overview/frame, saves an ink-verified pin from geometry rather than the line's historical typed quantity, rejects blank-paper geometry, and confirms a reader failure writes no checkpoint. Source bytes remain identical.

# Printed-grid coordinate contract after live #248

The gateway now reads real tiles and saves resumable checkpoints. On the private live QA pass, two successive responses for the same next tile returned row numbers outside the allowed 0–10 grid; validation rejected both without saving their findings. Four tiles were checkpointed, all candidates so far rejected for ink evidence; this is not an accuracy pass.

The provider contract now asks for the actual printed label (`A1` through `K11`) plus bounded pixel offsets. The server decodes that exact label to its existing zero-based grid coordinates, then runs the unchanged geometry and raster checks. Invalid labels, absolute pixel rows, and out-of-range offsets are refused, never clamped or snapped. Polygon holes use the same decoder. The live pass also rejected line traces returned for a count request; the provider schema now permits only the geometry kind appropriate to that measure type (pins for EA, polylines for LF, areas for SF/CY), before the independent server check. Invalid reader responses produce a plain explanation rather than exposing raw validation internals. Existing checkpoints and stored geometry remain compatible because only the provider wire representation changes.

# Gateway compatibility after live #247

The published native `json_schema` configuration was rejected by the existing gateway with `Request contains an invalid argument`; no AI checkpoint or geometry was saved. This establishes a request-format incompatibility, not a measurement pass or a specific unsupported schema keyword.

The reader now uses the gateway's previously working `json_object` mode through `Output.json()`. It supplies the complete JSON schema explicitly in the server-owned system prompt, then parses the result with the unchanged bounded Zod validator before raster verification or persistence. Thus the original missing-schema problem is fixed without asking the gateway to compile a native decoding grammar it rejected. The provider factory returns to its original signature; other gateway callers keep their previous behavior. There is no automatic retry or fallback to an invented empty read.

The actual SDK request test reproduces a gateway rejecting `json_schema` and verifies both supported JSON mode and the complete prompt schema. Additional cases reject wrong root fields, non-array findings, out-of-range grid coordinates, invalid confidence and a provider HTTP rejection. The prompt also identifies the printed symbol stroke as the pin location; blank centers of hollow symbols must not be used as ink evidence or silently snapped elsewhere. All existing geometry, source, scale, confidence and estimator-approval checks remain.

This follow-up needs an approved publication before the private live inference tests can resume. Local request-contract tests are not proof of drawing accuracy. The #247 viewer and publication work remains intact.

# Live verification follow-up

The first published engine opened its stored-source viewer in ChatGPT and in a fresh normal Claude chat. A pre-refresh Claude conversation returned facts without a viewer; a fresh conversation rendered the registered resource. This does not establish measurement accuracy.

Two bounded live proposal requests saved no geometry: the first timed out and the second returned `No object generated: response did not match schema`. An actual AI SDK request interception then reproduced a configuration defect: the compatible provider defaults to `supportsStructuredOutputs: false`, so it sent `response_format: {type: "json_object"}` and silently omitted the geometry schema. The takeoff reader now explicitly enables structured output. The regression checks the outgoing JSON schema, including the required findings and uncertainties fields. Existing gateway callers retain their default configuration; invalid or uncertain results still fail closed.

The viewer now strips the legacy HTML error fallback from its status label. It also offers the standard host-approved fullscreen request when available: a narrow desktop chat otherwise hides the drawing controls under the phone/review breakpoint. Phone editing remains disabled below 768 px. The host's actual response mode is respected. Resource v2 makes the revised client discoverable without relying on hosts to discard cached v1 HTML; v1 remains readable for existing conversations.

Private browser verification exercised 700 px review mode, expansion to a 1100 px drawing workspace, a failed operation containing an HTML fallback, and 390 px phone review. These are local host-bridge tests, not live inference or live fullscreen acceptance. The three-sheet live accuracy, review and export checks must resume after an approved release of this follow-up. No measured quantity has been accepted on the strength of the failed live reads.
# Confirmed count areas

Automatic counts now require a named, explicitly confirmed plan or room boundary. `takeoff_geometry` operation `scope` stores a zero-progress checkpoint using the existing append-only pass RPC. It establishes neither a quantity nor a scale. The drawing card supports a two-corner rectangle or explicit normalized page bounds; confirming a whole sheet explicitly includes every view and detail. Source, page, line and takeoff version bind the checkpoint.

The reader receives a copy with pixels outside that area masked white. Verification uses the unchanged original pixels and independently rejects count pins outside the area. Each pin is checked separately so a rejected candidate does not discard a valid pin in the same response. Acceptance of automatic geometry requires completed coverage; old unscoped count passes cannot be resumed or accepted. Estimator-placed geometry retains its existing review path. The v3 resource keeps v1/v2 resource reads working.

Verification for this correction: 2,282 tests across 216 files, including 17 locked behaviors, pass. Production build and changed-file lint pass. Type checking retains the same 32 baseline diagnostics, with none in this change. Real local PostgreSQL verifies that confirming an area saves no geometry or line quantity. The private browser fixture verifies the separate confirmation and exact source/line/bounds payload, and hides precision controls at phone width. These are software checks; independent real-sheet accuracy testing remains required before declaring automatic takeoff complete. No migration, authentication, Hub, email, permissions or general card-template change.

# Reader context and model follow-up

Live #252 correctly rejected out-of-area pins, but an in-area roof proposal matched the wrong feature and a linear proposal matched the wrong span. Both were rejected in the private QA job; neither established an accepted quantity. Ink checks establish source location, not semantic correctness.

The reader now receives a directly rendered, bounded overview of the confirmed plan/room rather than a reduced whole sheet. Its native bitmap is limited to 1600 px per edge, and outward rounding preserves edge coverage. The blue target footprint is mapped into that cropped reference. Reference plan and legend images appear first with explicit labels; the detailed target tile appears last and is the only coordinate image. Extracted text remains available, while raw PDF path coordinates stay in native indexing/verification instead of being mixed with target-image coordinates in the vision input. Measurement and ink verification still use the unchanged 200-dpi source tile. No expected benchmark quantities or object coordinates enter the reader.

The default takeoff-only model moves to `google/gemini-3.8-flash` through the existing gateway; the existing environment override is preserved. Lovable lists this model for multimodal chat (https://docs.lovable.dev/features/ai-chat), and Google documents its exact model code (https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). Geometry audit evidence records the provider-reported model. Resumable calls reserve more time before starting another tile, reducing avoidable deadline interruptions. No extra model review call, credentials, fallback-to-empty read, acceptance bypass or model target quantity is introduced.

Checks: 2,284 tests across 216 files, including 17 locked behaviors; build and changed-file lint pass, with the same 32 baseline TypeScript diagnostics. Real Workers checks render the three private source sheets and bounded plan references while preserving the original hash. The real plan-reference images were inspected privately. This is not yet a live model accuracy pass; repeat the independent three-sheet test after publication. No migration, auth, Hub, email, access or card-resource change.

# Read reliability after live #253

The live reader placed all 15 fixture pins inside the independent source envelopes, with no extras or duplicates, before coverage reached 13/18. That is not a completed/accepted count. The next overlap tile exceeded the old 18-second request budget. A roof call also reported PostgreSQL `25006` after saving its fourth checkpoint; fresh state confirmed that progress was preserved.

The three new takeoff read RPCs were marked `STABLE`. PostgREST runs STABLE RPCs in read-only transactions even for POST (https://docs.postgrest.org/en/stable/references/transactions.html#access-mode-on-functions). Their existing membership guard can refresh the five-minute entitlement cache, which writes a row. A real local PostgreSQL test now expires that cache and reproduces `25006` for get, history and exports under the PostgREST transaction classification. The small migration changes only those three entrypoints to `VOLATILE`; it leaves function bodies, guards, ACLs, RLS, and all job/drawing records unchanged. The same test verifies successful cache refresh afterward, unchanged job state, and continued rejection of an unrelated member. Apply this migration only through Lovable Cloud and record it normally.

Each read request now performs one atomic tile/checkpoint with a 35-second preparation/inference budget, instead of starting multiple calls within 18 seconds. The existing card resumes from that checkpoint and already allows 90 seconds per bridge request. No retry skips coverage or accepts a partial quantity. Existing correct source/model/scope checkpoints can continue; no restart or loss of the 15 proposals is required.

Validation: 2,286 tests/216 files including 17 locked behaviors, build and changed-file lint pass. Same 32 baseline TypeScript diagnostics, none in this change. Fresh migration ordering, expired-cache reads, preserved permissions, and one-step resumability are tested. Live completion of the remaining count coverage and the roof/linear checks is pending publication of this correction. No sign-in, membership decision, Hub, email, connector, card-template, or original-drawing change.

# Repeated reads and ordinal span selection

An old card can request an earlier unfinished checkpoint even after a later pass
completed the same line. The server now reuses the completed equivalent read
when all active geometry belongs to it, with no model call or write. Equivalence
requires the same source hash, page, takeoff version, calibration and count-area
bounds. A different scope or foreign active geometry is refused even when the
caller supplies an explicit pass ID. A partial pass can still resume its own
geometry. This does not accept proposals or alter a saved measurement.

The model schema previously called its coordinates the FIRST image while the
actual coordinate image is the final detailed target tile. Both schema axes now
agree with the actual message order. The reader also resolves ordinal endpoints
across the entire confirmed plan, counts physical features once, excludes
perpendicular returns on a named horizontal run, and never substitutes an
adjacent span when the requested endpoints fall outside the tile.

Verification: 2,288 tests across 216 files and all 17 locked behaviors pass.
Changed-file ESLint passes. TypeScript retains the same 32 baseline diagnostics,
with none in the changed takeoff files. The real-PDF tests prove completed-read
reuse makes zero provider calls and zero writes, rejects a different count area
and foreign-pass geometry, and preserves same-pass resume. No migration, auth,
Hub, email, access, card resource or existing widget changes.

Live status before this correction: one private count case completed all 18
tiles, independently matched all 15 instances without extras or duplicates,
was accepted through Claude's card, and produced its dated measured PDF with
the original unchanged. A second count is still being checked. The ordinal wall
case selected the neighboring span and was rejected; its new reader wording
must be verified live after release. Automated checks are not that live pass.

# Exact run edges and selected-line read controls

The live reader now chose the requested wall span, but its adjoining tile was
rejected because a valid normalized endpoint of 1000 maps exactly to the
mathematical right edge. Linear runs may now end on that closed boundary without
moving their coordinates. Ink checking examines only existing pixels in the
inward six-pixel neighborhood; path continuity and overlap ownership remain
required. Out-of-range points, edge pins, unsupported area closures and blank
crossings remain refused. This does not snap a location or fit a target quantity.

The viewer's progress/continue controls now follow the selected line, exact
source hash, takeoff version and calibration. Calibration selection persists
through results and newly saved calibrations are selected. Completed reads take
precedence over older unfinished ones. After geometry is rejected, an explicit
confirmed fresh read preserves its old history and uses the same stored scope;
a changed selection cancels that pending confirmation. Ordinary malformed reader
JSON now produces factual resume guidance without exposing the reply or silently
retrying. No acceptance happens automatically.

Resource v4 keeps v1/v2/v3 resource reads supported. No changes to the general
ChatGPT card, email templates, auth, Hub, permissions or schema; no migration.
Verification: 2,295 tests/216 files, all 17 locked behaviors, build and changed-file
ESLint pass; same 32 baseline TypeScript diagnostics, none in the changed takeoff
files. A real-PDF test crosses three overlapping 200-dpi tiles and reconciles its
full run once, preserving exact endpoints and the source hash. Actual browser
fixture interactions verify line/calibration progress, no request on a stale
confirmation, the source/scope restart payload, preserved calibration after
results, and the 390-pixel layout. Fixture results are not real-sheet accuracy.
The private live wall accuracy case must still be rerun after publication.

