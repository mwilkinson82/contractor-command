-- Remove the TEST-only caller bypass. No tables, columns or data change.
-- mcp_gate goes back to the single membership decision for every caller.
CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT mcp_private.is_circle_active(auth.uid())
$$;

-- Neutralize the helper (kept as a stub so nothing that references it breaks) and remove caller access.
CREATE OR REPLACE FUNCTION public.mcp_is_test_caller() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT false $$;
REVOKE EXECUTE ON FUNCTION public.mcp_is_test_caller() FROM anon, authenticated, public;
