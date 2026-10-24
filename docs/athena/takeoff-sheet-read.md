# Sheet read: every open line per tile

Base: `codex/athena-passwordless-login-only` at `3f5cc59b` (after #270 and #272). Branch `claude/takeoff-multi-line-tiles`. Not merged, not deployed, no data changed. No migration: the per-line pass tables and `mcp_takeoff_pass_save` are unchanged.

## Codex review of a17c03c3 (addressed in the second commit)

1. A line with no pass took its own candidate order when its pass was created, so its saved order could disagree with the shared tile the host had seen; the next submission then ran against the wrong tile. The sheet read now passes the shared order into `proposeTakeoffBatch`, a new pass adopts it, and two guards refuse a line whose stored order differs from the shared one or whose order names a different tile than the rendered one. Regression test: five tiles read back to front; the new line's saved order equals the shared order and the submission advances every pass by one.
2. A sheet read took every line on the takeoff, including lines assigned to another sheet. It now takes only lines whose `sheet` is this sheet; a line assigned elsewhere is listed as not ready with the reason, and a line with no sheet joins only when named in `line_nos`. Regression test covers both.

Design: "Athena Drawing Takeoff Engine", next phase, piece 1.

## Why

The host read loop after #270 is one line, one tile, one round trip. A 60-line sheet of 30 tiles is about 1,800 tool calls, each carrying an image through the member's chat. Nobody will sit through that. A sheet read hands the model one tile with every open line that could appear on it and takes one observation set back, so the same sheet is about 30 calls.

## What it does

- `takeoff_geometry propose` with no `line_no` (or with `line_nos`) is a sheet read. Athena picks the lines that are ready on this sheet: count lines with a confirmed count area; LF, SF and CY lines on the named confirmed calibration (CY only when a single-line read already recorded its cited depth). Lines that are not ready are listed with the reason; lines whose read is complete, or that have geometry from another read, are left alone.
- All lines share one tile order (`sheetOrder`: every tile touching any line's region, vector hints first) and move in lockstep. A line that is ahead waits until the others reach its tile. A line with no pass gets one at its first tile; a prepare never re-saves a checkpoint for a line that already has one.
- The prepare result carries one target tile (masked to the union of the lines' regions), one reference plan, the list of lines with their `pass_id`, region and depth, the lines waiting or skipped, the vector text on the tile, and a ready-made `submit` shape. Project context is included at cursor 0 or on `reload_context`; later tiles carry a reference with the reload call.
- The host returns `sheet_observations`: the cursor and one entry per listed line (same `pass_id`), each with findings in x/y 0–1000 on the target image, confidence and evidence; empty findings means inspected and none visible. Athena refuses a set that skips a line, names a line not on the tile, carries the wrong cursor, or pairs a line with the wrong pass.
- Each line is verified and saved by the existing per-line path (`proposeTakeoffBatch` with the tile rendered once and shared), so ink, topology, scope, partitioning, duplicate merging and the SQL guards are unchanged. One `mcp_takeoff_pass_save` per line per tile.
- The viewer card gains "Ask your AI to read the whole sheet" and a sheet-read status line. The single-line buttons stay.

## Not in this change

- Split regions on a sheet read (`split_region` stays single-line).
- Legend crops on a sheet read (per-line legends stay single-line).
- A CY line's first depth still comes from a single-line read.
- Nothing accepts geometry; nothing calls a model.

## Verification

- Vitest: full suite passes. New `takeoff/sheet-pass.test.ts` on a real PDF through `inspectSheet`: which lines are ready and why the others wait; one tile prepared for two lines with one checkpoint write for the new pass and none on a repeat; one observation set verified and saved per line with the host-reported model on each proposal; refusals for a skipped line, an unknown line, a wrong cursor and a wrong pass; lockstep when one line is ahead; nothing ready.
- Production build, typecheck and ESLint on the changed files: pass. Manifest regenerated.
- **Not a live pass.** After #270 and this change are released: on 2701 S-100, one sheet read over the open foundation lines in Claude and in ChatGPT; count the tool calls; compare the footing run to Darian's 345 LF.
