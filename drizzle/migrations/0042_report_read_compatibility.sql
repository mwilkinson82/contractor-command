-- REVIEW PROPOSAL: register once using Lovable's managed migration runner.
-- The existing membership guard refreshes its five-minute cache. PostgREST
-- starts STABLE RPC calls in READ ONLY transactions, so an expired cache makes
-- a valid signed-in project read fail with SQLSTATE 25006. Both entry points
-- must truthfully declare that existing guard side effect. Bodies, owners,
-- search paths, grants, role/job gates and application records stay unchanged.
ALTER FUNCTION public.mcp_report_page_get(text, uuid, uuid) VOLATILE;
ALTER FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) VOLATILE;
