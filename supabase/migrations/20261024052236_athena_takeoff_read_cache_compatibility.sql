-- These reads retain their existing membership/job guards. The guard can
-- refresh the existing five-minute entitlement cache. PostgREST runs STABLE
-- RPCs in READ ONLY transactions even for POST, which rejects that refresh
-- after a long drawing read. Only transaction classification changes here:
-- bodies, permissions, guards, RLS and job/drawing records are unchanged.
ALTER FUNCTION public.mcp_takeoff_get(uuid) VOLATILE;
ALTER FUNCTION public.mcp_takeoff_history(uuid, uuid, integer) VOLATILE;
ALTER FUNCTION public.mcp_takeoff_exports(uuid, uuid, uuid, integer) VOLATILE;
