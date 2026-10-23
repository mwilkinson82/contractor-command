# Athena icon diagnosis — October 23, 2026

## Confirmed observations

- Live branch/deployed source at investigation: `f3376033`.
- The existing server branding middleware only collected `initialize` request ids and only enriched `result.serverInfo`.
- With the installed real `@lovable.dev/mcp-js` handler, modern `server/discover`, `tools/list` and `tools/call` each return server identity in `result._meta["io.modelcontextprotocol/serverInfo"]`. Three reproductions failed because icons and websiteUrl were missing there.
- The current generated ChatGPT plugin archive has only `.app.json` and `.codex-plugin/plugin.json`. The manifest's interface has neither `logo` nor `composerIcon`. Its app connection is unchanged. ChatGPT's plugin listing uses the default cube, and the attached app uses a generic icon.
- In a fresh ChatGPT chat, the rendered Athena mention's image source is `data:image/svg+xml;utf8,connectors%3A%2F%2F…%2Flogo%3Ftheme%3Dlight` and `naturalWidth` is zero. The source is an internal connector reference encoded as SVG text, not actual SVG artwork. This is a host rendering symptom; changing the card HTML cannot repair it.
- An anonymous curl GET of the existing 64px Athena PNG returned HTTP 200, image/png, 1,684 bytes, valid PNG bytes and public cross-origin headers. Python-urllib requests received 403, so this check does not prove every image fetcher can access it. The real host fetch must still be verified.

## This code change

Preserve the SDK's server name, version, title and existing branding. Supply missing icons, website and description on both legacy serverInfo and existing modern server-identity metadata. Track request ids so modern discovery and tool responses reach the existing post-handler branding pass. Do not invent identity for responses without one. HTTP errors, JSON-RPC errors, unmatched responses, tool content, resource templates, auth and entitlement decisions are preserved.

The original legacy helper remains available. No global SDK prototype patch, new connector, sign-in change, schema migration or publication is part of this change.

## Verification

Seven new checks cover the real SDK's three modern methods, preservation of existing metadata/cache/tool fields, mismatched/identity-free/error responses, modern SSE and mixed request ids. All 2,003 tests across 189 files pass; production build and changed-file ESLint pass.

## Release and live acceptance

1. After approval, deploy the reviewed code through the existing Lovable project.
2. Refresh the existing ChatGPT app rather than creating a second connector. Confirm discovery advertises the real public PNGs and that ChatGPT loads them.
3. The generated plugin also needs actual listing/composer image assets. A private 1.0.1 candidate adds only `interface.logo`, `interface.composerIcon` and the existing 64px/256px blue artwork; its `.app.json` connection is byte-identical. An App-backed plugin's presentation may be managed by the parent App; use its supported owner controls and respect any rejection rather than replacing its binding or creating a different plugin.
4. Verify the installed-plugin listing, composer, sent @Athena mention and tool label in light/dark mode. No broken image and no generic substitute is the pass condition. If the host still serializes the internal URI as SVG after correct branding is registered/refreshed, capture that failure for OpenAI support; do not declare the icon fixed from metadata tests alone.

OpenAI documents listing `logo` and composer `composerIcon` separately: https://developers.openai.com/plugins/deploy/submission#listing-metadata.
