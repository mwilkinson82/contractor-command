# Stored drawing indexes and dated markup after #244

Tess reports that #244's direct PDF upload and missing-source refusal pass in both ChatGPT and Claude. Claude also uses the stored sheet with visible pins and the correct palette. This follow-up addresses the four remaining failures; it does not change the download path that passed.

## Behavior

- A new PDF without sheet names remains stored and returns a clear question, its page count and a form for the complete sheet order. Saving that answer calls `drawing_set_import` with the stored `source_id` and sheet names. It downloads and checks that exact original, then uses the existing source-save RPC. No re-upload or original-file rewrite occurs. A changed index creates an immutable metadata revision referencing the same object; the original registry record is preserved too. Re-sharing the same bytes subsequently reuses the indexed revision.
- The form requires one name per PDF page. An incomplete answer leaves the existing index intact and reports that the original is still stored. A newly stored unindexed set blocks implicit fallback to an older indexed sheet. Its markup request opens the index question instead.
- Import reads/indexing and markup resolve an explicit source ID before considering a host-renamed filename. Unknown or foreign-job IDs do not fall back to another file. The stored result offers a sheet selector whose preview call carries only the exact source ID, selected sheet and job context.
- A dated save becomes available once at least one finding is located. The card explicitly counts located findings and findings remaining in the key only. No locations or quantities are invented for the others. Missing host `serverTools` still disables saving and now explains why.
- A confirmed upload/index/save result survives stale empty-form, old-index and preview notifications in the same view. `ui/update-model-context` sends factual source identity and sheet names for the next model turn, without a new chat message or display commands. Where ChatGPT's optional widget-state API is available, it stores a source reference, not file bytes or signed URLs. An upload-view remount re-reads that source through the existing authorized tool before showing it; widget state does not establish access or replace server data. "Store another PDF" is an explicit member action.
- Drawing resource v4 keeps v3, v2 and the original resource readable. Other card/email resources and templates remain unchanged. There are no auth, Hub, Site URL, email-code, connector, permission, migration, bucket or quantity changes.

## Verification

The regression starts with an older indexed S-100 and a different newly stored five-page PDF without names. It verifies the index question, refusal to substitute the old sheet, a saved five-name index by source ID, later lookup despite a changed host filename, and a dated PDF with one positioned finding and one key-only finding. It also checks unchanged original bytes, no duplicate original upload, incomplete-index rejection and an unknown-ID refusal.

UI tests cover the multi-finding Save button, stale response replay, exact source-ID calls, factual model-context updates, widget remount retrieval and isolation from another job's widget state. A private real-browser fixture verifies the index-save/preview controls, replay behavior and an enabled save after placing one of two findings. At 390px, the sheet form and pin/save view have no page overflow. The fixture makes no production uploads, markup versions or external calls.

Candidate checks: 2,156 app tests across 202 files, including the original 16 locked behaviors; production build; changed-file lint with the pre-existing formatting rule excluded; real Workers PDF/download/reindex check. TypeScript retains the same 34 baseline diagnostics. This is not a live ChatGPT/Claude candidate acceptance pass.

## Post-publication acceptance

1. Refresh the existing tools. On Tess's already stored unindexed set, ask for S-100. Athena must ask for the page-order names and keep that original stored; it must not use an older set. Verify the actual order before saving it. Do not guess the order from a filename.
2. Save the sheet names once. Open S-100 from the stored-sheet selector, then request it again in chat. Confirm the returned source identity matches the saved indexed revision even if the host's attachment filename changes.
3. Place one of multiple findings. Save must enable, the remaining key-only count must be visible, and a single approved dated version must save with that pin. Open the dated PDF and verify the source fingerprint, visible pin, palette and unlocated key entries. Recheck the original afterward.
4. Reopen the upload result and replay/reload as supported by the host. The stored result must remain available rather than silently becoming an empty upload form. Verify model follow-up uses the current source ID. Retest in normal Claude chat and ChatGPT; do not infer a cross-host pass from the private browser fixture.

Any production index changes or additional QA markup versions require approval of their exact source, page order and annotations. The previous QA-244-G and QA-244-C copies are already saved and must not be created again.
