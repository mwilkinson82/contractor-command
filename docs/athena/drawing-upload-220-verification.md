# Drawing upload validation — PR #220

## Final change

Drawing imports validate their PDF page index with the existing `pdf-lib` dependency, without importing pdf.js or its worker, browser drawing globals, or native canvas. The parser is read-only: `updateMetadata:false`, no save or serialization, and the exact original bytes continue to the hash and storage paths. Encrypted, malformed and zero-page inputs are rejected before storage. Page-order sheet validation, duplicate detection, source revision history, the dedicated 50 MiB original bucket and immutable source protections remain in place.

The custom PDF parser is replaced with the existing library, including support for ordinary language/catalog strings, compressed objects, xref streams and escaped strings. The partial `DOMMatrix` shim is removed. The original drawing renderer is unchanged from the base branch; an upload validation fix must not be presented as a Workers rasterization fix.

No new dependency, migration, auth, Hub, Site URL, email-code, palette, widget, tool-list or connector-address change. The migration already deployed by #199 is not reapplied. #216 is not included.

## Verification

Updated onto live branch commit `255d5b26`. The default Vitest suite passes **2,010 tests across 191 files**; production `npm run build` passes. New/rewritten parser and runtime-test files pass ESLint. The legacy drawing-set file retains its existing formatting findings and the pre-existing triple-slash-reference lint error at line 1; its declaration reference is unchanged. TypeScript retains the same 34 baseline diagnostics/location-code pairs, with no added pair.

New regression coverage:

- Valid PDFs with language/catalog strings and escaped parentheses/backslashes, with both classic and compressed object storage.
- Compressed xref/object-stream fixture; encrypted, malformed and zero-page input rejection.
- Byte-for-byte original preservation.
- Actual `readDrawingBytes` with DOMMatrix, Path2D and ImageData absent and both pdf.js entry points mocked to throw if loaded. Correct sheet counts pass, excessive sheet indexes fail.

Private actual-file proof, with no production writes:

- The approved local 17,612,902-byte, 24-page permit set passes the corrected parser in local **workerd**, using the generated deployment's compatibility date and `nodejs_compat` flag.
- Actual `storeDrawingSet` also runs in workerd with in-memory storage/RPC: one source upload, identical second share recognized, `athena-drawings` bucket, saved S-100 index at page 15, and unchanged source/local-original bytes. DOMMatrix, Path2D and ImageData remain undefined.
- The same set runs through the existing renderer in **Node with native canvas**, selects S-100 without re-upload, saves two distinct dated markup copies, and preserves the original. This is Node proof, not Workers rendering proof.

The source PDF, private paths, fake-storage harness outputs and generated markup copies are not committed.

## Remaining release gate

A separate local workerd rasterization probe confirms that supplying the original #220 DOMMatrix shim is insufficient: pdf.js still requests `@napi-rs/canvas`, which workerd cannot resolve. This PR leaves the base renderer unchanged, rather than shipping a partial global shim. It repairs PDF intake; it does **not** establish that the complete stored-sheet/markup workflow works in the deployed Workers runtime.

Before calling the complete drawing workflow ready, provide a supported renderer for that runtime and verify stored-sheet retrieval plus two dated markup copies through the actual connector. Hosted transfer, live ChatGPT/Claude/Grok acceptance and the full live do-not-break checklist remain untested for this candidate. The source checklist is `docs/verification/athena-do-not-break.md`; its stored-page requirement remains a release gate. No merge or publication is claimed.
