# Submittal retest corrections after #275

Candidate only. Do not call this a Tess pass or deploy without approval of the exact release. Estimating remains parked.

## Acceptance criteria

- A build reply, subsequent get, living log, record, filename and actual PDF agree on the saved package ID, revision and transmittal. A mismatch must not be called a current package.
- A PDF link issued by one host still opens the same immutable package after another host reads it. Existing board/member authorization and package revocation still apply.
- The package/Collect card, log card, web log rows and record offer an upload link. Full-access members can upload a listed piece or add an unlogged piece with its kind and source, and see a verified receipt. A board key alone grants no write access.
- Actual SDK tools/list, including the native-card transport, exposes optional new_piece, its allowed kinds (product_cut, shop_drawing, sample, calc, warranty, other), source_party and required. Existing pieces keep IDs/P-numbers and original files.
- Historical PDFs are preserved. Rebuilds keep their own reserved transmittal and immutable filename. Old copies with identical historical names can be distinguished by full build timestamp and copy ID; they are not retroactively renamed or renumbered.
- No emails, access/role changes, auth/Hub changes, migrations or Athena AI calls. Existing cards and 17 locked behaviors keep passing.

## Findings and changes

1. The old get/build path minted a new preview token and overwrote the single preview_hash on the package. A second read invalidated the first link, even within seconds. The primary PDF link now uses the already-working authorized record route with open=package and the exact package_id. It signs that immutable PDF on open. Get no longer writes preview state. Existing recipient links and legacy preview routes remain available under their existing rules.
2. The reported stale build/get was not reproduced by a fresh signed-in read: job 2701 had already advanced to T-6 during concurrent testing and the fresh reply matched that package. The old handler nevertheless trusted the context embedded in a writer response. It now reads committed context in a separate RPC after attach/build/renew; a build checks the new ID, path, filename and reserved transmittal before reporting success. A historical artifact with a mismatched fingerprint/transmittal is not called current. Replies carry as_of plus explicit package identity/revision/transmittal and an exact open_url. Tests inject a stale writer reply and a mismatched historical artifact rather than claiming the host-side symptom was definitively diagnosed.
3. new_piece was already in #275's published manifest, including all kinds and source_party. This connected client still exposed an older schema. The candidate shares validation between MCP and browser upload, proves discovery through the real SDK and transport, and bumps connector version to 0.8.22. Host tool-definition refresh is still required where discovery is cached; no global SDK patch or reconnect workaround was introduced.
4. There was no member uploader on the record. The new form uploads through the existing signed-in client and immutable Storage INSERT policy, attaches through the existing guarded writer, then reads the record to verify the receipt. This also recovers a committed attachment when its write response is lost. It never deletes source files or modifies supplier copies. Token-only viewers must use the existing member sign-in before uploading; restricted members remain read only.

## Private verification

- Real local PostgreSQL/PGlite RPCs and immutable PDF/storage fixtures: browser member upload adds P3 without changing P1/P2, recovers a lost write response, and builds the source PDFs; source hashes and no-send assertions pass.
- Rebuilds generate three different IDs, transmittals and filenames; record/log agree on the current one and actual cover PDFs are retained for inspection.
- Repeated ChatGPT/Claude/Grok transport reads preserve the first exact PDF link and do not mutate preview hashes. Existing record target checks and revocation tests remain in place.
- Actual SDK tools/list and native presentation seam expose the complete new_piece schema and file metadata.
- Actual React upload form exercised in Chrome through the real file chooser at a 390px container width, with a fictional local PDF and in-memory backend. The receipt remains visible, P1/P2 remain, and the phone fields have no horizontal overflow. This is a local UI proof, not a deployed host pass.
- Final results recorded in the PR. Local evidence is under verification/submittal-275-retest in Marshall's private Athena workspace.

## Live retest after an approved release

Tess must pass all three hosts. Record the deploy ID and tool-definition version first. Refresh existing tool definitions where necessary; confirm new_piece is visible before attempting an unlogged-piece attachment.

Use the current job 2701 record (05 12 00-001); T-5/P3 from the reported test and later T-6/P4 from concurrent testing were not modified by this work. Do not delete them or assume T-5 is still current. Record package identity before any approved rebuild.

1. Build, then get from each host. Compare the exact ID, transmittal, filename, record/log current flags and PDF cover; the old filename must not be described as the new build.
2. Keep the first Open package PDF link, read from a second host, then open the first link again. It must still open its exact package.
3. Open Upload a package piece from the Collect/package card, log card/web log row and record. With approved fictional test data, upload one unlogged piece with kind/source, verify its ID/P-number/source/file receipt, then build and verify it is included. Confirm earlier pieces and package history are intact.
4. Confirm token-only access cannot upload without member authentication; restricted roles cannot write. No emails.
5. Preserve the three passing #275 link/PDF checks and rerun the do-not-break list. Submittals are not complete until Tess posts ChatGPT, Claude and Grok Bot passes.
