# Drawing upload and stored-sheet markup — PR #220

## Result

PDF intake reads the page count with the existing `pdf-lib` dependency instead of loading pdf.js and browser drawing globals. Validation is read-only (`updateMetadata:false`); malformed, encrypted and zero-page sets are rejected before storage. Ordinary catalog strings, escaped strings, compressed objects and xref streams are covered by tests.

Stored-sheet previews now use pinned `@hyzyla/pdfium` 3.0.0 and `fast-png` 6.4.0. The PDF engine is bundled as a compiled WebAssembly module in the backend deployment. It does not need DOMMatrix, Path2D, ImageData, native canvas, filesystem reads, remote rendering or runtime WASM compilation. Vite selects the package's browser implementation; Nitro's existing Workers preset emits the compiled binary alongside the server. Intake keeps the renderer lazy.

Each isolate serializes PDF rendering, closes documents/pages after use, recovers after invalid input, and retains the existing 1600-pixel preview bound. Existing stored-sheet selection, drawing geometry, dated markup versions, hash deduplication, source revisions and immutable-original protections remain in place. Athena draws supplied pins, lines and areas; it does not invent positions for saved findings without geometry. Unlocated findings remain in the numbered key.

This updates onto the live branch including #216 (merge c7b9c11b). No migration, auth, Hub, Site URL, email-code, connector-address, card-template or permission change. No production data was written. Original sources stay in athena-drawings; derived copies stay in athena-files under the existing limits. Renderer license notices are retained in docs/athena/licenses/.

## Verification

- Parser regression cases cover compressed and classic PDF structures, malformed/encrypted/empty rejection, correct sheet indexing and byte preservation.
- Intake runs with browser drawing globals absent and pdf.js imports mocked to fail if accidentally loaded.
- Pixel-level renderer tests verify that different selected pages produce their corresponding colors, previews stay bounded, absent pages return null and a bad document does not block later rendering.
- A real workerd test uses the actual storeDrawingSet, storedSheet and saveDrawingMarkup functions with in-memory storage/RPC and all outgoing network requests forbidden. It imports once, recognizes the duplicate, reopens S-100, saves two dated versions tied to the source, verifies the original bytes and inspects actual blue/red overlay pixels plus the generated PDF.
- The private actual-file proof repeats that flow with the local 17,612,902-byte, 24-page permit set. It selects S-100 at page 15, records one source upload, two distinct dated markup paths, correct source parents and unchanged stored/local originals. DOMMatrix, Path2D and ImageData remain undefined. The complete local Workers request took about three seconds including cold startup.
- Separately, the production-built renderer chunk and emitted WASM render the same S-100 in workerd. This verifies deployment packaging as well as the source test bundle.
- The actual S-100 preview, marked sheet and both PDF pages were visually inspected. Test annotations are explicitly fictional supplied geometry, not measured takeoff quantities. Private drawings, paths and generated copies are excluded from the PR.

Final local validation: **2,015 tests across 193 files pass**, and the production build passes. New renderer, test/support and config files pass ESLint. TypeScript has the identical 34 baseline diagnostic location/code pairs, with no additions. The production-built renderer was rerun successfully in workerd after the final dependency install and build. GitHub check results are recorded in the PR description after push.

## Release gate

This is local Workers and production-build proof. Live storage, signed download links and host interaction on this candidate remain untested until an approved publication. Run the complete drawing acceptance workflow in ChatGPT, normal Claude chat and Grok Bot, then docs/verification/athena-do-not-break.md. Never describe local in-memory storage tests as a live connector pass. This PR is not merged or published.
