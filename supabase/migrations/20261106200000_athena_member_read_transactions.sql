-- Apply through Lovable Cloud only. Plain SQL for Lovable to apply; nothing in this repo applies it.
-- PostgREST runs a STABLE RPC in a READ ONLY transaction, even for POST. These readers call
-- mcp_assert_active -> mcp_gate -> circle_sync_user, which locks and can update a Contractor Circle
-- member's provisioning rows. For those members every call failed with "cannot execute SELECT FOR
-- UPDATE in a read-only transaction": a contract saved from chat was reported as an error and the
-- job board's Contracts section showed nothing (support ticket ATH-0008). Same fix as the earlier
-- readers (0055, 0056, 20261025042056): volatility only. No function body, grant, policy, table or
-- data change, and every check in each function stays as it is. Safe to run more than once.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER FUNCTION public.mcp_job_contract_rows(uuid) VOLATILE;
ALTER FUNCTION public.mcp_change_order_pricing_list(uuid) VOLATILE;
ALTER FUNCTION public.mcp_job_terms(uuid) VOLATILE;
ALTER FUNCTION public.mcp_client_payments_get(uuid) VOLATILE;
ALTER FUNCTION public.mcp_job_import_context(uuid, text, text) VOLATILE;
ALTER FUNCTION public.mcp_job_log_rows(uuid, text) VOLATILE;
ALTER FUNCTION public.mcp_project_record_feed(uuid, date, date) VOLATILE;
ALTER FUNCTION public.mcp_push_test_targets(uuid) VOLATILE;
ALTER FUNCTION public.mcp_service_calls_list(uuid, text) VOLATILE;
ALTER FUNCTION public.mcp_service_rates_get(uuid) VOLATILE;
NOTIFY pgrst, 'reload schema';
