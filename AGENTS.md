
- MCP server lives in src/lib/mcp/ (tools, guard, server-only method rules); /mcp and /.well-known routes are plugin-generated — never hand-edit. Why: SDK owns transport and OAuth metadata.
- OAuth consent page is /oauth/consent; every sign-in path (password ?redirect, magic link via localStorage stash in oauth-return-path.ts) must return to it. Why: losing authorization_id breaks connector setup.
- MCP lookahead workflow state lives in public.mcp_* tables (own-row RLS) and checks come from mcp_checklist_items (latest version per key, ordered by position). Why: server owns the workflow; hosts are only the conversation layer.
