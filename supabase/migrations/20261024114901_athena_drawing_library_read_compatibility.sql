-- The existing guarded read may refresh Athena's membership cache. PostgREST
-- must use a writable transaction for that guard, as with the takeoff reads.
-- Only volatility metadata changes: the function body, guards and ACL stay put.
ALTER FUNCTION public.mcp_drawing_records(uuid) VOLATILE;
