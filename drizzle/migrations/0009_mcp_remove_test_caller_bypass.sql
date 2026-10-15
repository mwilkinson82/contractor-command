-- Remove the TEST-only caller bypass. No tables, columns or data change.
CREATE OR REPLACE FUNCTION public.mcp_gate() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT mcp_private.is_circle_active(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.mcp_is_test_caller() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT false $$;
REVOKE EXECUTE ON FUNCTION public.mcp_is_test_caller() FROM anon, authenticated, public;