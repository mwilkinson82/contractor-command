## Tools page — editorial section headers

Promote the four group labels ("Make more money", "Protect margin and cash", "Build the machine", "Deliver better projects") from tiny mono labels into editorial-display section headers, so the page reads like a professional playbook directory instead of a flat grid.

### What changes

**`src/routes/tools.tsx` — `ToolsDirectory` group renderer (lines ~67–86):**

Each group becomes its own `<section>` with a proper header band above the tool grid:

```
─────────────────────────────────────────────  (hairline)
SECTION 01 · 03 TOOLS
Make more money                                (large serif display)
The plays that lift revenue without adding overhead.   (lede)

[ tool card ] [ tool card ] [ tool card ]
```

- **Eyebrow row**: `label-mono` reading `Section 0X · N tools` (auto-numbered, auto-counted).
- **Headline**: serif display, ~28–34px on desktop, tight tracking, full ink color.
- **Lede**: one-sentence description (~14–15px, muted) — a short tagline per group so the section feels authored, not auto-generated.
- **Hairline rule** above the eyebrow (border-border, 1px) to mark each section.
- Increase vertical rhythm between sections (`space-y-16` instead of `space-y-12`).
- Tool grid below stays as-is (the card design is already working).

### New copy (group ledes)

Added inline in `tools.tsx` as a `GROUP_LEDES` map:

- **Make more money** — "The plays that lift revenue without adding overhead."
- **Protect margin and cash** — "Stop the slow bleed inside jobs you've already won."
- **Build the machine** — "Install the systems that make the business run without you."
- **Deliver better projects** — "Tighten execution so every job ends clean."

### Out of scope

- Card design, drawer behavior, vault wiring, routing — untouched.
- Page hero / "Every tool you've got." headline — untouched.
- No changes to `command-tools.ts`.

### Files

- `src/routes/tools.tsx` — edit `ToolsDirectory` group block + small new `SectionHeader` helper.