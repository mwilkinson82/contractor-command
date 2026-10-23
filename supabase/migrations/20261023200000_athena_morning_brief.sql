-- Athena morning brief, piece 1. One row per member: local time, IANA zone, on/off.
-- Default 6:30 AM in America/New_York until the member sets a zone. Nothing is sent.
-- Reads and writes are the member's own row. This file does not delete data.
-- NOT APPLIED. Apply with the deploy.

CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_settings (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  send_local time NOT NULL DEFAULT '06:30',
  time_zone text NOT NULL DEFAULT 'America/New_York',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_morning_brief_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "morning brief settings read own" ON public.mcp_morning_brief_settings;
CREATE POLICY "morning brief settings read own" ON public.mcp_morning_brief_settings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "morning brief settings insert own" ON public.mcp_morning_brief_settings;
CREATE POLICY "morning brief settings insert own" ON public.mcp_morning_brief_settings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "morning brief settings update own" ON public.mcp_morning_brief_settings;
CREATE POLICY "morning brief settings update own" ON public.mcp_morning_brief_settings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.mcp_morning_brief_settings FROM anon, public;
REVOKE DELETE ON public.mcp_morning_brief_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mcp_morning_brief_settings TO authenticated;
GRANT ALL ON public.mcp_morning_brief_settings TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_settings_get() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.mcp_morning_brief_settings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  SELECT * INTO r FROM public.mcp_morning_brief_settings WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'send_local', '06:30', 'time_zone', 'America/New_York', 'saved', false);
  END IF;
  RETURN jsonb_build_object('enabled', r.enabled, 'send_local', to_char(r.send_local, 'HH24:MI'), 'time_zone', r.time_zone, 'saved', true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_settings_get() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_settings_get() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_settings_save(_enabled boolean, _send text, _tz text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE cur public.mcp_morning_brief_settings; t time; z text; onoff boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  SELECT * INTO cur FROM public.mcp_morning_brief_settings WHERE user_id = auth.uid();
  onoff := coalesce(_enabled, cur.enabled, true);
  IF _send IS NULL OR btrim(_send) = '' THEN
    t := coalesce(cur.send_local, '06:30'::time);
  ELSE
    IF btrim(_send) !~ '^\d{2}:\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Say the time like 6:30 AM. Nothing was saved.'; END IF;
    t := btrim(_send)::time;
  END IF;
  z := coalesce(nullif(btrim(_tz), ''), cur.time_zone, 'America/New_York');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = z) THEN
    RAISE EXCEPTION 'MCP_BAD:That time zone is not recognized. Use a zone like America/New_York. Nothing was saved.';
  END IF;
  INSERT INTO public.mcp_morning_brief_settings (user_id, enabled, send_local, time_zone)
  VALUES (auth.uid(), onoff, t, z)
  ON CONFLICT (user_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, send_local = EXCLUDED.send_local, time_zone = EXCLUDED.time_zone, updated_at = now();
  RETURN jsonb_build_object('enabled', onoff, 'send_local', to_char(t, 'HH24:MI'), 'time_zone', z, 'saved', true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_settings_save(boolean, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_settings_save(boolean, text, text) TO authenticated;

-- Jobs the caller can see, for the morning brief. Reuses the living-report and lookahead reads.
-- Open-item rows keep the columns the app dedupes on. Dollars stay off the superintendent scope.
CREATE OR REPLACE FUNCTION public.mcp_morning_brief_feed() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  out jsonb := '[]'::jsonb;
  rec record;
  sc text;
  items jsonb;
  la jsonb;
  cpm jsonb;
  billing jsonb;
  daily boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  IF uid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  FOR rec IN
    SELECT j.id, j.job_number, j.name, j.company_id, j.time_zone, m.role
    FROM public.mcp_jobs j
    JOIN public.mcp_company_members m ON m.company_id = j.company_id AND m.user_id = uid
    WHERE public.mcp_job_scope(j.id) IS NOT NULL
    ORDER BY j.job_number
  LOOP
    sc := public.mcp_job_scope(rec.id);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'action', i.action, 'check_key', i.check_key, 'category', i.category,
      'item_type', i.item_type, 'kind', i.kind, 'owner', i.owner, 'accountable', i.accountable,
      'needed_by', i.needed_by, 'due_date', i.due_date, 'updated_at', i.updated_at,
      'internal_only', coalesce(i.internal_only, false),
      'cost_effect', CASE WHEN sc = 'full' THEN i.cost_effect END
    )), '[]'::jsonb) INTO items
    FROM public.mcp_open_items i
    WHERE i.job_id = rec.id AND i.status = 'open'
      AND (sc = 'full' OR coalesce(i.internal_only, false) = false);

    SELECT jsonb_build_object('start_date', l.start_date, 'end_date', l.end_date) INTO la
    FROM public.mcp_lookaheads l
    WHERE l.job_id = rec.id AND coalesce(l.inputs->>'kind', '') NOT IN ('setup', 'merged')
    ORDER BY NOT EXISTS (SELECT 1 FROM public.mcp_open_items i WHERE i.lookahead_id = l.id),
             (l.start_date IS NULL), l.start_date DESC, l.end_date DESC, l.created_at DESC
    LIMIT 1;

    cpm := NULL;
    billing := NULL;
    IF sc IN ('full', 'super') THEN
      cpm := public.mcp_living_report_get(rec.id, 'cpm', NULL);
      cpm := jsonb_build_object('found', coalesce(cpm->>'found', 'false')::boolean,
        'data', jsonb_build_object('activities', coalesce(cpm #> '{data,activities}', '[]'::jsonb)));
    END IF;
    IF sc = 'full' THEN
      billing := public.mcp_living_report_get(rec.id, 'billing_forecast', NULL);
      billing := jsonb_build_object('found', coalesce(billing->>'found', 'false')::boolean,
        'contract_total', billing->'contract_total', 'data', billing->'data');
    END IF;
    daily := EXISTS (
      SELECT 1 FROM public.mcp_daily_reports d
      WHERE d.job_id = rec.id
        AND d.report_date = (now() AT TIME ZONE coalesce(nullif(btrim(rec.time_zone), ''), 'America/New_York'))::date
    );
    out := out || jsonb_build_array(jsonb_build_object(
      'job_id', rec.id, 'job_number', rec.job_number, 'name', rec.name, 'company_id', rec.company_id,
      'time_zone', coalesce(nullif(btrim(rec.time_zone), ''), 'America/New_York'),
      'scope', sc, 'seat', rec.role, 'items', items, 'lookahead', la, 'cpm', cpm, 'billing', billing,
      'daily_today', daily
    ));
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_feed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_feed() TO authenticated;
