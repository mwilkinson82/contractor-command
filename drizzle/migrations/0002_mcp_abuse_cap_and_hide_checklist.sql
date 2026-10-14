CREATE OR REPLACE FUNCTION public.mcp_abuse_cap_hit()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h int; d int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT count(*) FILTER (WHERE called_at > now() - interval '1 hour'),
         count(*) FILTER (WHERE called_at > now() - interval '1 day')
    INTO h, d FROM public.mcp_call_log WHERE user_id = auth.uid() AND called_at > now() - interval '1 day';
  IF h >= 60 OR d >= 300 THEN RETURN false; END IF;
  INSERT INTO public.mcp_call_log(user_id) VALUES (auth.uid());
  DELETE FROM public.mcp_call_log WHERE user_id = auth.uid() AND called_at < now() - interval '25 hours';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mcp_abuse_cap_hit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_abuse_cap_hit() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mcp_usage_hit(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_rate_hit(integer) FROM authenticated;
COMMENT ON TABLE public.mcp_usage IS 'DEPRECATED: monthly allowance removed; replaced by mcp_abuse_cap_hit()';
COMMENT ON FUNCTION public.mcp_usage_hit(integer) IS 'DEPRECATED: replaced by mcp_abuse_cap_hit()';
COMMENT ON FUNCTION public.mcp_rate_hit(integer) IS 'DEPRECATED: replaced by mcp_abuse_cap_hit()';

DROP POLICY IF EXISTS "active checks" ON public.mcp_checklist_items;
REVOKE ALL ON public.mcp_checklist_items FROM anon, authenticated;
GRANT ALL ON public.mcp_checklist_items TO service_role;