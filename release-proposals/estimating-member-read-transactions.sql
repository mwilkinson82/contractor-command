-- Review and apply through Lovable Cloud only.
-- These RPCs invoke the existing verified-member gate, which may synchronize
-- membership/provisioning rows and refresh its cache. PostgREST runs STABLE
-- RPCs in READ ONLY mode even for POST; that rejects the gate's existing locks.
-- Correct transaction classification only: no body, ACL, policy, plan or data edit.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER FUNCTION public.mcp_estimate_guard(uuid) VOLATILE;
ALTER FUNCTION public.mcp_estimate_get(uuid) VOLATILE;
ALTER FUNCTION public.mcp_estimate_bid_get(uuid) VOLATILE;
ALTER FUNCTION public.mcp_estimate_profile_get(uuid) VOLATILE;
NOTIFY pgrst, 'reload schema';
