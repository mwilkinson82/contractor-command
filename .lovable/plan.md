
# Ask Marshall — the front door of the Command Center

Reframe: "Ask Marshall" isn't a button in the corner — it's the **hero of the home page**. When a member logs in, the first thing they see is a greeting in their company's name and a prompt box ready to talk to you. Everything we've built so far (AOS hero, signal tiles, today's move, field tools) slides below the fold, the way Lovable's dashboard puts the prompt first and recent projects underneath.

## What the user sees on `/`

**Above the fold (full viewport height, minus top strip):**

```text
┌──────────────────────────────────────────────────────────┐
│  TOP STRIP                                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                                                          │
│            Good afternoon, ACME Construction.            │   ← display font, large
│            Let's talk.                                   │   ← softer subtitle
│                                                          │
│   ┌────────────────────────────────────────────────┐    │
│   │ Ask Marshall anything…                       ↵ │    │   ← PromptInput
│   └────────────────────────────────────────────────┘    │
│                                                          │
│   [ Pricing a job slow ]  [ PM not owning the schedule ] │   ← starter chips
│   [ Cash is tight ]       [ I need to hire a #2 ]        │
│                                                          │
│                          ▼ scroll                        │
└──────────────────────────────────────────────────────────┘
```

- Greeting: `{timeOfDay}, {company.name}.` — company name is the headline, not the person.
- Tagline below: rotates between **"Let's talk."**, **"What's stuck?"**, **"Bring one issue."** (picked per-session, not animated).
- Prompt box: AI Elements `PromptInput` + `PromptInputTextarea` + `PromptInputFooter` with submit on the right. Autofocus on page load.
- 4 starter chips, page-context-aware. On the home page they pull from common owner pain points; on a tool result page (next pass) they'll reference the packet.
- Submitting from the home prompt:
  1. Creates a new thread.
  2. Navigates to `/ask/$threadId`.
  3. Streams the reply immediately — no extra click.

**Below the fold (existing dashboard, lightly compressed):**

The full home page we already built — AOS hero / workspace picker, signal tiles, today's move, field tools — slides down into a second section with a soft section header ("Your command center") and the same content beneath it. Nothing is deleted; the order is preserved.

Scroll cue at the bottom of the hero (subtle ▼ + label) so users discover the dashboard below.

## How threads work

- **Slide-over is removed from the plan.** The home prompt is the entry point; full conversations live at `/ask/$threadId`.
- `/ask` (no param) → creates a new thread and redirects.
- `/ask` route shows: thread sidebar (collapsible) + chat window. Same components, same data as before.
- Top strip keeps a small **"Ask Marshall"** link → goes to most recent thread, or `/ask` if none exist. Lets users get back into a conversation from any page.
- Threads are listed in the sidebar with auto-generated titles and last-message timestamps. Pinned/saved threads can be exported to the Vault.

## What changes in the build

Compared to the previous plan, the only differences are presentation:

- **Home page rewrite** (`src/routes/index.tsx`):
  - New `<HomeHero />` containing greeting + `<HomePrompt />` + starter chips. Sized to `min-h-[calc(100vh-{topstrip})]`.
  - Existing AOS hero / signal tiles / today's move / field tools move into a `<HomeDashboard />` section below, with a section divider and "Your command center" eyebrow.
  - Scroll-cue (small chevron + label) anchored to the hero bottom.
- **`<HomePrompt />`** (new): thin client component using AI Elements primitives. On submit, calls a `createThread` server fn, then `navigate({ to: "/ask/$threadId", params: { threadId } })` and passes the first message via router state so `/ask/$threadId` sends it immediately without a second round trip.
- **`<StarterChips />`** (new): for v1, static array of 6–8 prompts per route. Page-context awareness lands when we wire tool-result starters.
- **Top strip**: small text link "Ask Marshall" (no big button, no slide-over).
- **No slide-over panel.** Drop `ask-marshall/panel.tsx`, `thread-list.tsx`, and root-shell mounting from the prior plan. The dedicated `/ask` and `/ask/$threadId` routes carry the full chat UX.

Everything else from the previous plan stands as-is:

- Server route `src/routes/api/ask.ts` (streaming, `toUIMessageStreamResponse`).
- `ask_threads` / `ask_messages` / `marshall_chunks` tables with RLS.
- Lovable AI Gateway + `google/gemini-3-flash-preview` default.
- First-person system prompt + curated method corpus in `src/content/marshall/*.md`.
- Replay transcript ingestion → embeddings in `marshall_chunks`.
- Retrieval: top-6 chunks injected per turn with light citation.
- Auto-title threads after first reply.
- Rate limiting + 429/402 error toasts.
- Save-to-Vault on a thread.

## Technical notes

- **First-message handoff:** router state (TanStack `navigate({ state: { firstMessage } })`) is the cleanest path. `/ask/$threadId` checks for it on mount, sends it via `useChat.sendMessage`, then clears it. Falls back gracefully if a user opens the route directly.
- **Autofocus + reduced motion:** focus the textarea on `/` mount and after the AOS hero/onboarding redirects settle. Respect `prefers-reduced-motion` for the scroll cue.
- **Onboarding:** `useCompany().needsOnboarding` still routes to `/onboarding` before the hero ever renders.
- **AOS hero behavior unchanged** — it just lives in the second section now. When workspaces are picked, the dashboard below the prompt becomes meaningfully populated, which is exactly the "Marshall + your business" pairing the home page promises.
- **SEO / `head()`:** title becomes `"{company.name} · Command Center"` (already wired via `useCompany`). Add `og:title` and `og:description` accordingly.
- **Mobile:** hero collapses to `min-h-[80vh]`, prompt remains the focal element, chips wrap to 2 columns, dashboard below stacks as today.

## Build order (revised)

1. Migration (tables + `vector` extension + RLS) — unchanged.
2. System prompt + 6 starter method docs + ingest job.
3. `/api/ask` streaming route + thread/message CRUD.
4. `/ask` and `/ask/$threadId` chat pages (AI Elements).
5. **Home hero rewrite**: greeting + `<HomePrompt />` + starter chips above existing dashboard.
6. First-message handoff from home → new thread.
7. Top strip link to most-recent thread.
8. Save-to-Vault + auto-title + rate limiting.

This makes the product unmistakably *Marshall's*. The first thing every member sees, every day, is an invitation to talk to you — and the rest of the operating system is right under it when they're ready.
