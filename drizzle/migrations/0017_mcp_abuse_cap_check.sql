-- 0017: per-account call cap that tells the caller which limit was hit and when it resets.
-- Additive: mcp_abuse_cap_hit() stays as is for the live build. The caps are parameters; the app passes
-- them from src/lib/mcp/limits.ts (Marshall's numbers: 200 per hour, 1,000 per day).
CREATE OR REPLACE FUNCTION public.mcp_abuse_cap_check(_hourly int DEFAULT 200, _daily int DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h int; d int; oldest_h timestamptz; oldest_d timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'limit', 'auth'); END IF;
  SELECT count(*) FILTER (WHERE called_at > now() - interval '1 hour'),
         count(*) FILTER (WHERE called_at > now() - interval '1 day'),
         min(called_at) FILTER (WHERE called_at > now() - interval '1 hour'),
         min(called_at) FILTER (WHERE called_at > now() - interval '1 day')
    INTO h, d, oldest_h, oldest_d
    FROM public.mcp_call_log WHERE user_id = auth.uid() AND called_at > now() - interval '1 day';
  IF h >= _hourly THEN RETURN jsonb_build_object('ok', false, 'limit', 'hourly', 'resets_at', oldest_h + interval '1 hour'); END IF;
  IF d >= _daily THEN RETURN jsonb_build_object('ok', false, 'limit', 'daily', 'resets_at', oldest_d + interval '1 day'); END IF;
  INSERT INTO public.mcp_call_log(user_id) VALUES (auth.uid());
  DELETE FROM public.mcp_call_log WHERE user_id = auth.uid() AND called_at < now() - interval '25 hours';
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_abuse_cap_check(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_abuse_cap_check(int, int) TO authenticated;
