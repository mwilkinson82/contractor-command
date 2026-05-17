
## Interpretation

**1. The product**
A premium member portal for construction business owners at $497/mo. It is an *operating environment*, not a course portal or SaaS admin. Its job is to protect Marshall's time, increase member value, and route real business issues into AOS. The Six-Week Intensive ($5K) is the restrained upsell.

**AOS already exists** as its own Lovable project (project `3dc57fe8…`, "ALPOS") at `https://alpos.alpcontractorcircle.com`. The portal does NOT rebuild AOS — it links out to it and prepares work that gets carried into it. The portal will adopt AOS's exact design language so the two products feel like one family.

**2. The member journey**
Log in → see the next useful move (next call, one issue to bring, latest replay) → prepare one specific issue via Bring One Issue or run a Command Tool → generate a Command Packet → save to Company Vault → carry output into AOS → implement via templates → revisit replays. Operating memory accumulates over time.

**3. Design direction — inherited from AOS**
Match AOS exactly so the portal and AOS feel like one product:
- Warm cream background `oklch(0.972 0.018 85)`, near-black ink, soft-white card surfaces.
- Deep charcoal `oklch(0.22 0.012 80)` reserved for focus panels (e.g. active Command Tool result panel, "next session" hero block).
- Restrained gold primary `oklch(0.74 0.13 78)` for CTAs; subtle blue `oklch(0.55 0.11 245)` accent used sparingly.
- Fraunces display serif for headlines, Inter for body, mono for technical labels.
- Large radius, soft elegant shadows, generous whitespace, single-pane focus per screen.
- No double sidebars, no card walls, no calculator UI, no "coming soon" sections.

I'll copy AOS's `styles.css` tokens and font setup into this project so the design system is literally shared.

**4. Core screens (v1 build order)**
1. **Home** — command center. Charcoal focus block for next session (Join Zoom / Add to Calendar), then Bring One Issue, Open AOS, latest replay, restrained Intensive mention. Headline: "Build the company behind the projects."
2. **Business Command Tools → Growth Constraint Map** (flagship) — small "Switch Tool" + "Company Vault" top controls. Inputs surface → constraint output → Command Packet with Save / Copy to Bring One Issue / Open AOS. Full calculations + constraint priority logic per spec, demo defaults preloaded.
3. **Owner Dependency Scorecard** — second functional Command Tool, same shell.
4. **Company Vault** — memory layer for saved packets. localStorage, schema shaped for Supabase later. Status chips: Open / Brought to Session / Carried into AOS / Archived.
5. **Bring One Issue** — five-question structured prep tool, saves issue packet to Vault.
6. **AOS destination page** — explains AOS + the six parts + how portal output carries in. Single Open AOS button to `https://alpos.alpcontractorcircle.com`. No fake native integration.
7. **Work With Marshall** — Six-Week Intensive ($5K) positioning + Request Intensive CTA.
8. **Call Library** — archived judgment with tags, related AOS area, replay link or "replay link pending".
9. **Templates** — organized by contractor problem (Sell / Estimate / Contract / Launch / Manage / Bill / Lead / Install).
10. **Field Tools** — one page linking to ConstructLine Hub, Basis, Baseline, Cost Library, Trade Rate Library with the prescribed one-liners.

Account/Billing stub. No auth in v1.

## Technical approach

- TanStack Start file-based routes under `src/routes/`: `index.tsx`, `tools.tsx` + `tools.growth-constraint.tsx` + `tools.owner-dependency.tsx`, `vault.tsx`, `bring-one-issue.tsx`, `aos.tsx`, `work-with-marshall.tsx`, `calls.tsx`, `templates.tsx`, `field-tools.tsx`, `account.tsx`.
- Shared layout in `__root.tsx`: minimal top bar (wordmark, nav, member chip). No sidebar.
- Replace `src/styles.css` with AOS's token set (cream/ink/ink-panel/gold/gold-soft/blue/blue-soft, Fraunces + Inter, shadow-elegant/shadow-soft).
- `vault` module: typed `CommandPacket` and `IssuePacket` schemas, localStorage today, swappable for Supabase later.
- Growth Constraint Map: pure-function calculator with the exact formulas + constraint-priority logic; demo defaults preloaded; result renders as narrative finding + Command Packet card.
- No backend in v1. Supabase not enabled unless asked.

## Out of scope for v1
Real auth, billing, native AOS write-back, PDF export, the other 14 Command Tools (shown as a single restrained "More tools next" line, not a wall), admin tools.

## Deliverable
A cohesive portal where Home, Growth Constraint Map, Vault, Bring One Issue, and AOS page are fully built and visually continuous with AOS. Other screens shipped with real structure and copy, no placeholder filler.
