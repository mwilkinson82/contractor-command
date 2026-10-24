# Drawing references in the takeoff viewer

The fixed foundation checklist did not expose drawing details outside its eight items. A viewer could therefore show the checklist while never naming uncited details visible on its stored sheet.

The viewer now extracts labelled plan, detail, schedule and section captions from the selected PDF page's existing text objects. Each reference retains its normalized location; structured results identify the exact stored source, hash and page. Existing takeoff lines are linked only when their detail field explicitly cites the caption on the same sheet. Caption matching tolerates sheet punctuation, but does not merge distinct detail identifiers.

The styled section asks the estimator to reconcile uncited references with the agreed scope. A citation is not a measured quantity or proof of inclusion. The response always reports `coverage_complete: false`: text labels cannot establish complete drawing coverage, and scanned, split or unlabelled content still requires visual review. Empty or truncated extraction is explicitly unresolved. At most 40 captions are displayed, with a partial-list warning if more exist. Routine review uses the existing navy/blue/gray presentation.

No takeoff line, calibration, geometry, quantity, original drawing or permission is written by this feature. It adds no migration, tool, template URI, download, provider call or authorization path.

## Verification

- Full application suite: 2,357 tests across 223 files, including six new reference tests.
- The 17 locked-behavior checks remain green.
- Production build and ESLint on changed source/test files pass.
- Private source probe: the actual CCW-003 permit PDF's S-100 page yields separate Pier A and Pier B captions, neither cited by the approved 43-line takeoff. The footing schedule cites existing L14–L18. No expected quantities were supplied to extraction, and no job data was written.
- The rendered candidate was checked in the browser using the production card renderer. Live-host verification follows publication; a local preview is not a live Claude, ChatGPT or Grok Bot pass.

This improves reference reconciliation. It does not complete the missing CCW-003 quantities, decide disputed scope, or constitute a complete blind takeoff pass.
