# Mobile card layout verification

On a narrow screen, the old responsive table put its 112px label, alert heading,
and action text in the same flex row. The alert heading stretched alongside the
whole action. A later rule also restored thick red borders on every cell. This
reproduced the phone screenshot's tall red slab and squeezed action text.

The shared responsive stylesheet now gives the first cell the full row width,
puts a compact alert badge above its text, and lays out the remaining labeled
fields in two columns below. Each item has one border. Alert text is navy; the
red badge and border still identify actual overdue, risk, and delay rows.
Ordinary callouts retain their blue rule. Standalone HTML also declares the
device viewport.

The follow-up Claude screenshot also showed blank blue Job board buttons. The
generic anchor color was blue even inside a blue action chip. Action-chip links
now inherit their white text color in both renderers; ordinary links remain blue.

## Local verification, 2026-10-23

The browser loaded the actual `cardWidgetHtml()` output and `renderHtml()` output,
not hand-written replacement markup. Fixtures were fictional job 2701 examples.
These are local rendering checks, not proof of acceptance in a deployed host.

| Check | Result |
| --- | --- |
| Lookahead, contract clauses, SOV, brief, and G703 continuation; both renderers at 320, 390, 520, 521, and 900px | 50 combinations; no page overflow |
| Responsive table cells at 320, 390, and 520px | No cells clipped outside the viewport |
| Lookahead fixture | All six rows and three overdue flags retained at every width |
| 390px lookahead action | 336px text width; badge height 21.4px |
| 320px lookahead action | 266px text width; badge height 21.4px |
| Baseline comparison at 521 and 900px | 20 fixture comparisons; table cell text and geometry unchanged |
| G703 continuation at 390px | Still 960px wide inside a 364px scrolling region; keyboard panning verified |
| Action-chip links, both renderers at 390 and 900px | Before: blue text on blue; after: white on blue. Labels and destinations preserved; ordinary links remain blue |
| Full Vitest suite | 1,978 tests passed in 185 files |
| Production build | Passed |
| Lint | New helper clean; existing renderers retain the same 12 pre-existing Prettier diagnostics as the base |

The SOV remains horizontally scrollable immediately above the 520px breakpoint,
as on the base branch. Financial continuation tables deliberately keep their
horizontal scrolling at every width.

## Host retest after an approved release

1. Open job 2701's lookahead and open-items card on a phone in ChatGPT and normal
   Claude chat. Check that actions use the available width, overdue badges stay
   compact, and owner/due labels are fully visible. Compare counts and rows with
   the current saved records, rather than the fictional layout fixtures above.
2. Check ordinary callouts remain navy/blue and red is limited to actual alerts.
3. Open the SOV, contract clauses, and morning brief on phone and desktop. Check
   all content remains present, including the brief's inbox and calendar.
4. Pan a G703 continuation and the CPM Gantt. Rerun the established do-not-break
   list, including hidden-line filtering, repeated briefs, existing delay
   banners, and stored drawing pages.

Resource URIs, output-template metadata, initialization, tool data, permissions,
and storage are unchanged. No migration or deployment is part of this change.
