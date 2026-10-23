# Drawing card, preview and private downloads

The #234 live retest proved the original 17.6 MB/24-page CCW-003 PDF is stored once, identical re-sharing reuses it, S-100 opens without an upload, and two dated QA markup PDFs preserve the source and first version. The remaining host-presentation gap is separate: the drawing tools lack an MCP Apps resource, so ChatGPT rewrites their text and Claude receives fallback HTML rather than Athena's own drawing card.

## Candidate

Add `ui://athena/drawing-card.html` for `drawing_set_import` and `drawing_markup`. It renders the structured card and backend-returned PNG, with local zoom/pan/reset and a private PDF button. The two drawing results name that same resource through both `_meta.ui.resourceUri` and `openai/outputTemplate`; discovery advertises the standard UI field and keeps `openai/fileParams`. Existing contract/SOV/brief/email resources, their templates, `ui://athena/card.html`, and the existing native-card membership remain unchanged.

All drawing facts and rows remain in the tool reply. Claude's existing native-card text pass removes the dumped HTML document, without shortening the data or claiming the card appeared. Text-only hosts retain their existing fallback. No new display orders are added.

The view creates DOM nodes with literal text, never inserts result HTML/CSS, renders only base64 PNG data, makes no network or tool calls and does not send chat messages. Download requests use the standard `ui/open-link` method only after a click. A signed PDF must match the configured storage origin, exact private markup path and source parent/job; unrelated buckets, jobs, origins and embedded credentials remain inert. Exact source Drive/Dropbox links may be opened read-only. Access, auth, storage policies, source files, takeoff quantities and source/markup-save code are unchanged. No migration, email or sharing action.

## Verification

- 2,096 Vitest tests across 199 files pass, including the original 16 locked-behavior checks unchanged. Production build passes.
- 14 new tests cover parent/origin handshake boundaries, render/zoom/reset, hostile text/image/link inputs, click-only file opening, missing data and actual SDK discovery/resource/tool-result metadata in ChatGPT and Claude.
- Real SDK tests retain the exact structured data and PNG; both drawing-template references agree. Existing card/file metadata and unauthorized resource errors are preserved.
- Private browser preview with the actual QA markup image: desktop and true 390-pixel viewport checked. Phone card body width and scroll width both358px (390px viewport with preview-host margins), so no page overflow. Zoom increased the image/scroll width from330 to660px; keyboard pan moved0 to40px and back; reset and the locally intercepted PDF request passed. Browser viewport restored afterward. No production UI acceptance claimed before publication.
- Strict ESLint passes on the new files; touched legacy files pass with their existing formatting-only rule excluded. TypeScript reports the same34 pre-existing diagnostics, with no additions versus the prior baseline. Whitespace check passes.

After exact release approval and publication, refresh the existing hosts' tool definitions using their supported refresh controls, then open the stored sheet and a dated markup in normal ChatGPT and Claude. Verify the actual card, preview, zoom and private PDF action; keep quantities and the source unchanged. Grok Bot live and real Drive/Dropbox-link acceptance remain outstanding; no public file staging was used.

References: [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), [OpenAI MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui).
