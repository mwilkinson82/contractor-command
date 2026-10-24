# Takeoff blind test (CCW-003, 2026-10-24): causes and fixes

Base: `codex/athena-passwordless-login-only` at `d04f009d`. Branch `claude/takeoff-blind-test-fixes`. Not merged, not deployed, no data changed.

## What the Grok Bot run hit, and why

| Report item | Cause on the live branch | Fix in this branch |
| --- | --- | --- |
| 1. `takeoff_geometry` and `sheet_calibrate` say "Sheet S-100 is not in the selected stored set" while `drawing_markup` finds S-100 rev 3 | Two resolvers. `drawing_markup` searches every stored set for the sheet (`storedSheet`). The engine's `loadStoredPage` took `sources[0]`, the newest record on the job, whatever it holds; CCW-003's newest record is not the set with S-100. | `resolveStoredSource`: without a `source_id`, every set is searched and the newest revision holding the sheet wins, the same rule as markup. Every miss names the stored sets with their `source_id`, and an explicit `source_id` that lacks the sheet says which set has it. Successful replies already carry `context.source_id` and `available_sources`. |
| 2. "Prepare S-100 markup" returns the takeoff card | `drawing_markup` returned the measured-takeoff view whenever the job had engine data and no annotations, before `operation` was checked. | `prepare` always returns the markup findings preview; only a `save` without annotations opens the takeoff view. |
| 3. Red on routine review rows (G-6 to G-38) | The takeoff card flagged every gap with `holds_bid` as `risk`; most open quantities hold the bid until measured. | `reviewFlag`: red only for a `conflict` gap or a `hard` gap that holds the bid. An open quantity stays navy. |
| 4. "EXAMPLE" lines L201–L225 and GC lines L301–L311 | Data, not code: six test saves on Oct 22 built CCW-003 from version 3 (43 lines) to version 9 (79 lines). Rolling the takeoff back to version 3 removes them. | `estimate_takeoff_save` refuses a line whose item carries EXAMPLE, sample or placeholder. The card reports a line whose sheet is in no stored set as "no stored sheet" instead of counting it as unlocated, so general-conditions lines stop padding the drawing count. |
| 5. Termite treatment, piers A/B, bollards, pole bars missing | No takeoff version ever had them: a coverage gap in the takeoff build, not a lost line. | The card gains "Checklist items not on the takeoff", from the existing foundation checklist (`foundationGapPrompts`), so a missing item is named rather than silently absent. |
| First report: two polylines both labelled L2 | Labels came from `line_no` alone. | `geometryLabel`: `L2.1`, `L2.2` when one line has several shapes. |

Codex's passing run was on the job "QA-246 Private Takeoff Verification" (53 measurement rows), not on CCW-003, which has no measurements in any version. That is the other reason Grok found nothing to accept.

## Geometry across takeoff versions (still worth fixing)

`mcp_takeoff_get` reads the latest takeoff version, and geometry joins to that version's line ids. Every `estimate_takeoff_save` creates a new version. The trigger that carried geometry forward required the new row to be byte-identical to the old one, so any edit to a note, confidence or math silently orphaned a line's measurements.

Migration `20261024160000_athena_takeoff_carry_by_identity.sql`:
- `mcp_takeoff_carry_line` carries geometry when `line_no`, item and sheet match, or when item and sheet match exactly one previous line (a renumber). Geometry never moves onto a different item or sheet.
- `mcp_takeoff_get` adds `dropped_lines`: lines in the previous version that the latest save left out, with `had_geometry`. The card lists them under "Dropped since takeoff v<n>".
- Reads stay VOLATILE (the earlier compatibility migration's rule). Guards, grants and existing rows are unchanged.

## Verification

- Vitest: full suite passes (new: `takeoff/blind-test-fixes.test.ts`; `takeoff/db.test.ts` runs the migration on real PostgreSQL and proves carry on an edited note, carry on a renumber, no carry onto a different item or sheet, and the dropped-lines report).
- Production build: pass. ESLint on changed files: pass.
- **Not a live pass.** After an approved deployment: roll CCW-003 back to version 3, then in Grok Bot run `takeoff_geometry list` and `sheet_calibrate read` for S-100 with no `source_id`, `drawing_markup prepare`, and confirm the card shows the checklist gaps and no red on open quantities.
