# Athena locked behaviors

These behaviors are checked by `src/lib/mcp/athena-locked-behaviors.test.ts`.

## Grok Bot does not show render orders

Grok Bot prints tool text to the member. These lines are host orders, so they must not appear in that text:

- `REQUIRED VIEW` (including `REQUIRED VIEW: render this HTML card as-is… (spec V6QPP3)`)
- `Card shown. Do not add text.`
- `REQUIRED: Any email card`

Where they are built:

- `REQUIRED VIEW: render this HTML card as-is…` is `htmlBlock()` in `src/lib/mcp/cards/markdown.ts`. `stampCanary()` in `src/lib/mcp/security.ts` appends ` (spec V6QPP3)` to a `REQUIRED VIEW` line.
- `Card shown. Do not add text.` is `CARD_SHOWN` in `src/lib/mcp/cards/silence.ts`, appended by `applyCardClosing()`.
- `REQUIRED: Any email card… To:` is `sovRequiredTop()` in `src/lib/mcp/visible.ts`.

On a Grok Bot `tools/call` for the contract (`contract_terms`), the SOV (`report`), the morning brief (`morning_brief`), the morning meeting (`pm_morning`, and the same meeting card on `pm_meeting`, `pm_evening`, `athena_morning_hitlist`, `athena_hello`), and drawing markup (`drawing_markup`), those lines are removed from `content` text and appended to `structuredContent.assistant_guidance`. That field is the non-displayed channel the model can still read. The HTML document in the text is not edited. Fenced member text that quotes an order is left as written.

`NATIVE_CARD_TOOLS` is unchanged. Morning meeting and drawing markup are not added to it.

## ChatGPT and Claude cards stay byte-identical

ChatGPT does not show these lines to the member. Its `tools/call` result is not rewritten: the same object goes out, including the HTML card and the orders in the text. Claude's native-card reply is still the existing facts-only pass (`cards/claude-reply.ts`). `structuredContent.html` is not modified for either host.

## ChatGPT drawing attachment hosts are an exact list

`allowedDrawingDownloadUrl` in `src/lib/mcp/drawing-set.ts` accepts an attachment download only over HTTPS, with no userinfo and no non-default port. Hosts are the existing file hosts (`oaiusercontent.com` and `openai.com`, including `files.oaiusercontent.com`) plus these exact storage accounts:

- `oaisdmntprbrazilsouth.blob.core.windows.net`
- `oaisdmntpreastus2.blob.core.windows.net`

There is no prefix and no `*.blob.core.windows.net` pattern. Azure storage account names are first-come, so these are refused before any fetch:

- `oaiexample.blob.core.windows.net`
- `oaisdmntpreastus3.blob.core.windows.net`
- `evil-oaisdmntpre.blob.core.windows.net`
- `oaisdmntpre.blob.core.windows.net.evil.com`
- any other `*.blob.core.windows.net` account
- `http://` links to an otherwise exact host

Fetch uses `redirect: "manual"` and refuses every 3xx. The 50 MB cap, PDF validation, hash dedupe, and immutable originals stay as they are. `drawing_markup` does not download an attachment. A rejected import returns before a markup is saved.
