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

## Corrective candidate after the #277 retest

The #277 release is not a three-host acceptance pass. The next candidate is based on its deployed merge `8de482fd`; job 2701 remains read-only during preparation, including T-7 through T-11 and P6/P7. Estimating remains parked.

### Seven checks

1. **Draft file links:** `/r/submittal-file/` is a recipient capability and the existing resolver correctly refuses unapproved drafts. The card already uses the authorized record URL, but the factual `download_url` let hosts offer the recipient link as a preview. A valid, unexpired, unrevoked *draft* link now redirects to its exact existing member record, without a board token or signed storage URL. That page requires the member's existing job access before signing a PDF. Approved recipient downloads and email draft/link validation remain unchanged; expired/revoked/unknown links remain unavailable. No new recipient access is granted.
2. **One committed build:** get never reserves/builds/saves. Build reuses an already-current package; intentional rebuilds name `rebuild_from_package_id`. Repeating that request reuses the result. A real PGlite/handler race reproduced two committed first-build packages in #277; deterministic snapshot/previous-package build IDs now use the existing primary key to permit only one commit across competing requests. The loser reads the committed identity rather than retrying a save. A losing race can leave an unused transmittal reservation or unreferenced immutable file; these are not registered/current packages, and originals are never deleted to tidy a test.
3. **Uniform row destination:** all log rows open the submittal record. Exact package PDFs remain separate links, on both the card and web log.
4. **Athena's duplicate warning:** get/build/upload replies include structured warnings and a navy/blue filename-check section naming every matching P-number. The browser form warns before a repeated filename is stored and preserves the warning with its receipt. Names are compared case-insensitively; a name match is not claimed as proof of identical contents. No piece is removed or overwritten.
5. **Member uploader:** upload visits read fresh member authorization instead of retaining a cached read-only record with an unchanged content stamp. Stamp failures fall back to the authoritative record read; a failed file preview cannot deny an otherwise-authorized upload. Failed member reads show retry and the existing job-account sign-in, while genuinely read-only roles remain blocked. The reported browser/connector account match is unconfirmed, per Marshall's correction; no claim is made that a role failure was proven live.
6. **Concrete upload destination:** the explicit `upload=1` route state scrolls to the uploader even when the record was already mounted. The exact encoded `03 30 00-001` URL, board key and upload fragment are covered through the native card's actual open-link handler; browser component navigation to the concrete record is also exercised privately.
7. **Full history:** build/get return every package from the existing authorized record RPC, with ID, filename, transmittal, revision, timestamp, current/superseded/revoked state and an authorized exact-copy link. The card displays the whole history; legacy same-name copies retain their full timestamp and short copy ID.

### Verification and release boundary

- App suite: **2,476 passed across 236 files**; **17/17 locked behaviors**. Real local PostgreSQL/PGlite handlers prove repeated get makes no package write, sequential/replayed builds reuse the committed result, and two racing first builds commit only one package. SDK discovery and the regenerated manifest include the rebuild field and all existing new-piece fields.
- Production build passes. New files/components pass ESLint with formatting; inherited mixed-format files pass semantic lint. The same **32 baseline TypeScript diagnostics** remain, with normalized messages identical to #277 and none in changed files. Legacy role suite: **113 passed / 57 failed**, exact failure names independently matched against `8de482fd` with the same public test project reference.
- Actual record and upload components run in a private browser harness: authorized owner, wrong account, true read-only role, stamp failure, failed preview signing, same-record upload navigation, concrete submittal navigation, real file picker, stored receipt and repeated-filename warning. The phone container is 390 px. This uses fictional data/in-memory storage, not a live deployment.
- Draft-link tests cover GET/HEAD, approved delivery unchanged, expiry/revocation/unknown tokens, and the default server lookup's hash/company/job/submittal bounds. No emails, migration, Hub changes, authentication configuration changes, role grants or server-side AI calls.
- Connector version **0.8.23**; refresh existing host tool definitions for the explicit-rebuild field. A stale client can still get/build missing content safely, but cannot request the new explicit unchanged-content rebuild until refreshed.
- **Still required after an approved release:** sign in to the deployed record with the same Athena account as the connector; test real member file-picker upload and each link in normal ChatGPT/Claude/Grok Bot; verify the first exact PDF after later reads/rebuilds. Tess must post all three passes before submittals are called complete. Local green tests are not substituted for those passes.
