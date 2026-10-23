// Retired: Athena access is no longer an email allowlist. It is the shared
// membership entitlement in ./entitlement (checkAthenaEntitlement). Kept only
// so older test mocks of this module still resolve; nothing reads it.
export const MCP_ALLOWED_EMAILS = new Set<string>();
