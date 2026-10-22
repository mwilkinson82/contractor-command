-- In-app morning card. One show per member per local day.
-- Additive. Does not send email and does not change the push log.
-- The card uses the member's morning-brief settings. Default 6:30 AM America/New_York, on.

CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_shows (
  user_id uuid NOT NULL,
  shown_on date NOT NULL,
  shown_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shown_on)
);

ALTER TABLE public.mcp_morning_brief_shows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "morning brief show read own" ON public.mcp_morning_brief_shows;
CREATE POLICY "morning brief show read own" ON public.mcp_morning_brief_shows
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.mcp_morning_brief_shows FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_morning_brief_shows TO authenticated;
GRANT ALL ON public.mcp_morning_brief_shows TO service_role;

-- Clock and whether today's card was already shown. No write.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_card_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.mcp_morning_brief_settings;
  tz text;
  local_ts timestamp;
  send_at time;
  onoff boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO s FROM public.mcp_morning_brief_settings WHERE user_id = auth.uid();
  onoff := coalesce(s.enabled, true);
  send_at := coalesce(s.send_local, time '06:30');
  tz := coalesce(nullif(btrim(s.time_zone), ''), 'America/New_York');
  BEGIN
    local_ts := now() AT TIME ZONE tz;
  EXCEPTION WHEN others THEN
    tz := 'America/New_York';
    local_ts := now() AT TIME ZONE tz;
  END;
  RETURN jsonb_build_object(
    'found', true,
    'enabled', onoff,
    'send_local', to_char(send_at, 'HH24:MI'),
    'time_zone', tz,
    'local_date', local_ts::date,
    'local_minutes', extract(hour FROM local_ts)::int * 60 + extract(minute FROM local_ts)::int,
    'already_shown', EXISTS (
      SELECT 1 FROM public.mcp_morning_brief_shows
      WHERE user_id = auth.uid() AND shown_on = local_ts::date
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_card_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_card_status() TO authenticated;

-- Records the show. A second call the same day records nothing.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_mark_shown(_day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR _day IS NULL THEN RETURN jsonb_build_object('recorded', false); END IF;
  INSERT INTO public.mcp_morning_brief_shows (user_id, shown_on)
  VALUES (auth.uid(), _day)
  ON CONFLICT (user_id, shown_on) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('recorded', n > 0);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_mark_shown(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_mark_shown(date) TO authenticated;
