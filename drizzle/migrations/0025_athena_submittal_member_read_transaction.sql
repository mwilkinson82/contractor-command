-- Apply through Lovable Cloud only. No function body, grant, policy or table change.
-- PostgREST executes STABLE RPCs in READ ONLY transactions even for POST.
-- These readers call mcp_assert_active -> mcp_gate -> circle_sync_user, whose
-- existing verified-member sync can lock/update membership rows. Match that
-- existing gate's transaction needs without removing or bypassing any check.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER FUNCTION public.mcp_submittal_record_get(uuid, text) VOLATILE;
ALTER FUNCTION public.mcp_submittal_record_stamp(uuid, text) VOLATILE;
NOTIFY pgrst, 'reload schema';
