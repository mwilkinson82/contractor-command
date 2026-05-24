# Circle → AOS: SOP Hand-off Spec

Circle mints a signed URL pointing at AOS. AOS validates, shows a confirm
screen (workspace + category + owner pre-filled), and writes the SOP into
the chosen workspace's Knowledge Hub.

## URL

```
${AOS_BASE_URL}/hub/import?payload=<base64url-json>&sig=<hex>&ts=<unix>&nonce=<str>&from=circle
```

## Payload (base64url-decoded JSON)

```ts
{
  v: 1,
  aos_email: string,           // lowercased; the AOS user this is for
  ts: number,                  // unix seconds
  nonce: string,
  source: "circle",
  source_key: string,          // stable per-SOP id, e.g. "circle-sop-pre-con-handoff"
  version_hash: string,        // sha256(canonical SopDocument JSON)
  sop: SopDocument,            // full structured doc (title, steps[], kpis[], etc.)
  defaults: { category: string | null, owner: string | null }
}
```

`SopDocument` shape: see Circle `src/lib/tools/sop-draft.ts`.

## Verification (AOS side)

1. Reject if `ts` is older than 5 minutes (replay protection).
2. Recompute `version_hash = sha256(canonicalJson(payload.sop))`. If it
   doesn't match the value inside `payload`, reject.
3. Recompute signing string:
   `${aos_email}|${ts}|${nonce}|${version_hash}`
4. HMAC-SHA256 with `AOS_SHARED_SECRET` (same secret Circle uses for
   `/api/public/circle/snapshot` and `/api/public/circle/sso`). Compare
   to `sig` using `timingSafeEqual`.
5. Require the logged-in AOS user's email to equal `payload.aos_email`.
   If not signed in, redirect to AOS login with `?next=` back to this URL.

`canonicalJson` is sorted-keys stringify; Circle uses the same function.

## Confirm screen behavior

Pre-fill:
- **Workspace**: user's active/default workspace (dropdown shows all they own).
- **Category**: `payload.defaults.category` (mapped to nearest existing
  Knowledge Hub category; user can change).
- **Owner**: `payload.defaults.owner` (free-text; user can change).
- **Title**: `payload.sop.title`.

Buttons: `Import to Knowledge Hub` / `Cancel`.

## Storage (AOS Knowledge Hub)

On confirm, insert into `documents` (or equivalent) with these columns:

| Column | Value |
|---|---|
| `workspace_id` | chosen workspace |
| `title` | `payload.sop.title` |
| `category` | chosen category |
| `owner` | chosen owner |
| `body` | rendered markdown (see Renderer below) |
| `source` | `'circle'` |
| `source_key` | `payload.source_key` |
| `source_version_hash` | `payload.version_hash` |
| `source_payload` | full `payload.sop` JSON (for re-render / future schema) |

## "New version available" (stale-copy detection)

On insert, check existing row with same `(workspace_id, source, source_key)`:
- **No existing row** → insert new.
- **Exists, same `source_version_hash`** → no-op, toast "Already imported".
- **Exists, different hash** → DO NOT overwrite. Show side-by-side:
  "You imported this SOP on {date}. A new version is available." with
  `Replace` / `Keep mine` / `Save as copy` choices.

## Renderer (markdown body)

Render the SopDocument as markdown headings: Purpose, Scope, Trigger,
Inputs, Steps (numbered), Outputs, Definition of Done, KPIs, Exceptions,
Revision Cadence. Keep raw JSON in `source_payload` so AOS can re-render
without round-tripping to Circle.

## Notes

- One-shot push (no callback to Circle needed) — payload travels in the URL.
- Token is single-use in spirit; AOS should track `(nonce, ts)` for 5 min
  to prevent replay.
- Future option 2 ("one-click from Circle, no confirm") reuses this
  endpoint with `?auto=1` and only auto-imports when the user has exactly
  one workspace; otherwise falls back to the confirm screen above.
