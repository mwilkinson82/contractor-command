
- MCP server lives in src/lib/mcp/ (tools, guard, server-only method rules); /mcp and /.well-known routes are plugin-generated — never hand-edit. Why: SDK owns transport and OAuth metadata.
- OAuth consent page is /oauth/consent; every sign-in path (password ?redirect, magic link via localStorage stash in oauth-return-path.ts) must return to it. Why: losing authorization_id breaks connector setup.
