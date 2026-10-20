/**
 * Hosts whose Origin/Referer the CSRF guard in start.ts trusts.
 * Athena's MCP is served on every connected domain of one deployment (no host
 * redirects); meetathena.io is the new Athena MCP host, app.alpcontractorcircle.com
 * keeps working during the overlap (see /workspace/athena/mcp-url-migration-plan.md).
 */
export const TRUSTED_HOST_SUFFIXES = [".lovable.app", ".lovableproject.com", ".lovable.dev"] as const;

export const TRUSTED_HOSTS: ReadonlySet<string> = new Set([
  "app.alpcontractorcircle.com",
  "contractor-command.lovable.app",
  "meetathena.io",
  "www.meetathena.io",
]);

export function isTrustedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (TRUSTED_HOSTS.has(h)) return true;
  return TRUSTED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}
