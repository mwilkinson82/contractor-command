-- Morning brief: show once per local day, and stop reloading every living report.
-- The old feed called the living-report reader twice per job. That reader re-checks the
-- membership gate and returns the full report plus its change log. A brief only needs
-- the latest activities and the billing dates, so this feed reads those rows once.
-- NOT APPLIED. Additive. No deletes.

CREATE TABLE IF NOT EXISTS public.mcp_morning_brief_shows (
  user_id uuid NOT NULL,
  shown_on date NOT NULL,
  shown_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shown_on)
);
ALTER TABLE public.mcp_morning_brief_shows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "morning brief shows read own" ON public.mcp_morning_brief_shows;
CREATE POLICY "morning brief shows read own" ON public.mcp_morning_brief_shows
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.mcp_morning_brief_shows FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_morning_brief_shows TO authenticated;
GRANT ALL ON public.mcp_morning_brief_shows TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_shows() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date;
  seen boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('shown', false); END IF;
  d := (now() AT TIME ZONE coalesce(
    (SELECT nullif(btrim(s.time_zone), '') FROM public.mcp_morning_brief_settings s WHERE s.user_id = auth.uid()),
    'America/New_York'))::date;
  SELECT true INTO seen FROM public.mcp_morning_brief_shows WHERE user_id = auth.uid() AND shown_on = d;
  RETURN jsonb_build_object('shown', coalesce(seen, false), 'day', d);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_shows() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_shows() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_mark_shown() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  d := (now() AT TIME ZONE coalesce(
    (SELECT nullif(btrim(s.time_zone), '') FROM public.mcp_morning_brief_settings s WHERE s.user_id = auth.uid()),
    'America/New_York'))::date;
  INSERT INTO public.mcp_morning_brief_shows (user_id, shown_on)
  VALUES (auth.uid(), d)
  ON CONFLICT (user_id, shown_on) DO NOTHING;
  RETURN jsonb_build_object('shown', true, 'day', d);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_mark_shown() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_mark_shown() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_morning_brief_feed() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  PERFORM public.mcp_assert_active();
  IF uid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in first.'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.job_number)
    FROM (
      SELECT
        j.id AS job_id,
        j.job_number,
        j.name,
        j.company_id,
        coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York') AS time_zone,
        s.scope,
        s.seat,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', i.id, 'action', i.action, 'check_key', i.check_key, 'category', i.category,
            'item_type', i.item_type, 'kind', i.kind, 'owner', i.owner, 'accountable', i.accountable,
            'needed_by', i.needed_by, 'due_date', i.due_date, 'updated_at', i.updated_at,
            'internal_only', coalesce(i.internal_only, false),
            'cost_effect', CASE WHEN s.scope = 'full' THEN i.cost_effect END
          ))
          FROM public.mcp_open_items i
          WHERE i.job_id = j.id AND i.status = 'open'
            AND (s.scope = 'full' OR coalesce(i.internal_only, false) = false)
        ), '[]'::jsonb) AS items,
        (
          SELECT jsonb_build_object('start_date', l.start_date, 'end_date', l.end_date)
          FROM public.mcp_lookaheads l
          WHERE l.job_id = j.id AND coalesce(l.inputs->>'kind', '') NOT IN ('setup', 'merged')
          ORDER BY NOT EXISTS (SELECT 1 FROM public.mcp_open_items oi WHERE oi.lookahead_id = l.id),
                   (l.start_date IS NULL), l.start_date DESC NULLS LAST, l.end_date DESC NULLS LAST, l.created_at DESC
          LIMIT 1
        ) AS lookahead,
        CASE WHEN s.scope IN ('full', 'super') AND cpm.job_id IS NOT NULL THEN jsonb_build_object(
          'found', true,
          'data', jsonb_build_object('activities', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', a->>'id',
              'name', coalesce(a->>'name', a->>'description', 'Activity'),
              'description', a->>'description',
              'start', a->>'start',
              'finish', a->>'finish',
              'duration', a->'duration',
              'total_float', a->'total_float',
              'critical', coalesce(a->'critical', 'false'::jsonb)
            ))
            FROM jsonb_array_elements(coalesce(cpm.data->'activities', '[]'::jsonb)) a
          ), '[]'::jsonb))
        ) END AS cpm,
        CASE WHEN s.scope = 'full' AND bill.job_id IS NOT NULL THEN jsonb_build_object(
          'found', true,
          'contract_total', bill.contract_total,
          'data', (coalesce(bill.data->'billing', bill.data) - 'activities' - 'change_log')
        ) END AS billing,
        EXISTS (
          SELECT 1 FROM public.mcp_daily_reports d
          WHERE d.job_id = j.id
            AND d.report_date = (now() AT TIME ZONE coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York'))::date
        ) AS daily_today
      FROM public.mcp_jobs j
      JOIN LATERAL (
        SELECT public.mcp_job_scope(j.id) AS scope, m.role AS seat
        FROM public.mcp_company_members m
        WHERE m.company_id = j.company_id AND m.user_id = uid
      ) s ON s.scope IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT r.job_id, r.data
        FROM public.mcp_living_reports r
        WHERE r.job_id = j.id AND r.report_type = 'cpm'
        ORDER BY r.version DESC
        LIMIT 1
      ) cpm ON true
      LEFT JOIN LATERAL (
        SELECT r.job_id, r.data, r.contract_total
        FROM public.mcp_living_reports r
        WHERE r.job_id = j.id AND r.report_type = 'billing_forecast'
        ORDER BY r.version DESC
        LIMIT 1
      ) bill ON true
    ) x
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mcp_morning_brief_feed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mcp_morning_brief_feed() TO authenticated;
