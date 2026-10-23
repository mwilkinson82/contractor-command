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

## Live #235 and structured preview follow-up

#235 was approved, merged as decb9264 and published through Lovable deployment ab624792-417c-4ac0-b9da-cb6353a670aa. Both normal hosts load Athena's drawing card. ChatGPT displays the stored S-100 PNG; live zoom 732→1098px, keyboard pan 0→40px and reset pass. Claude displays the card but has no image/zoom section, although its separate tool image is present. This is a live FAIL for the embedded Claude preview. Claude did save one authorized QA pin as a separate dated version and its native card's PDF button opened the actual foundation-plan PDF successfully.

The follow-up includes the exact same server-rendered PNG in `structuredContent.drawing_preview`, retaining the existing image content block for model vision and older card clients. The view prefers a validated structured PNG and falls back to content images; PNG-only/base64/size restrictions are identical on both paths. There is no extra rendering, download, upload or storage write. The image is represented twice in the serialized response, a compatibility cost; no additional image is generated.

New discovery points at `ui://athena/drawing-card-v2.html` so Claude fetches updated HTML. The previous drawing URI remains readable for existing clients. Existing contract, SOV, morning-brief, email and ChatGPT widget templates are unchanged. No auth, migration, permission, connector or quantity changes.

Verification: 2,100 tests/199 files and production build pass. Four new cases reproduce a host notification with no image content and reject unsafe structured previews. Actual tool-handler tests assert the structured preview equals the original PNG, and real SDK tests retain it for both hosts and read both drawing resource URIs. Strict lint passes on new view/test files; changed legacy files pass with their pre-existing formatting rule excluded. The same 34 baseline TypeScript diagnostics remain, with no additions. Live acceptance of this follow-up requires its own approved deployment and tool refresh.
