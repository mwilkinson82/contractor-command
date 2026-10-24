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
