# Private remote MCP server: can this backend support it?

Answers only. Nothing has been changed.

## 1) OAuth Server (Dynamic Client Registration + custom consent path)
**Yes, it's possible. I can turn it on, but you can't.** Your Lovable Cloud backend has no settings screen for this, so you can't change it yourself. I have a setup action that switches on the backend's OAuth 2.1 sign-in server. It enables Dynamic Client Registration by default and accepts a custom consent path such as `/oauth/consent`. The default path is `/.lovable/oauth/consent`. The address users are sent to for consent comes from the app's own canonical address, so I don't choose it. I haven't turned it on yet.

## 2) Asymmetric JWT signing keys (ES256)
**Yes.** I have a separate action that moves the project to asymmetric signing keys. Once it runs, the JWKS and authorization-server discovery documents are served by the direct auth issuer. I haven't checked which signing method the project uses today. The usual check is to read a fresh token's header: "HS256" means it still uses a shared secret. I'll check that before running anything.

## 3) Backend URL, project ref and custom auth domain
I can't share the backend address or project ref. Lovable Cloud doesn't allow showing them. The app talks to the backend through a Lovable proxy address. External OAuth clients must use the direct issuer instead, because a proxy address fails strict issuer matching. I haven't confirmed whether a custom domain exists for sign-in itself. Your custom domain (app.alpcontractorcircle.com) serves the app and its consent page, not the auth issuer.

## 4) Edge function that skips the built-in JWT check
**Possible, but I don't recommend it.** On this kind of project, server logic belongs inside the app itself, not in separate edge functions. The supported approach is an `/mcp` endpoint built into the Hub with Lovable's MCP toolkit:
- It returns its own 401 with a `WWW-Authenticate` header.
- It publishes the protected-resource metadata at `/.well-known/oauth-protected-resource`.
- It checks each token against the direct issuer and only accepts tokens issued to OAuth clients. Copied login tokens are rejected.
- It sends the caller's token through to the database, so each user only sees their own data.

This does the same job as mcp-lite with `withOAuthProtectedResource`, with no separate function to deploy.

## If you approve, I would build
1. Turn on the OAuth server (defaults, or `/oauth/consent` if you prefer).
2. Check the signing method and move to ES256 if needed.
3. Add a consent page with Approve and Deny. Make sure password, signup and Google sign-in all return users to it.
4. Add the `/mcp` endpoint and the tools you choose. You'd need to tell me which tools to expose.
5. Generate the MCP manifest. You then publish.
