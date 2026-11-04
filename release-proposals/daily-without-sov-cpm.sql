-- Daily reports on jobs with no schedule of values or no CPM schedule.
-- Plain SQL for Lovable to apply as one migration. Safe to rerun.
--
-- Before: every daily work line had to carry an SOV item (like 26.04) and a CPM
-- activity, so a job without an SOV or a CPM could never save a daily.
-- After: a work line can save with no SOV item, no CPM activity, or neither.
-- When they are given they are checked exactly as before, and the pay app and
-- schedule feed keep using them. Work, quantity, unit, crew and hours are still
-- required. Progress photos for the same date now join the daily when it saves.
--
-- Touches only: mcp_daily_work_lines and mcp_production_rates (two columns each
-- become optional), mcp_daily_report_save (same name, inputs and grants), and
-- the daily_id link on mcp_progress_photos rows of the job and date being saved.

ALTER TABLE public.mcp_daily_work_lines ALTER COLUMN sov_item DROP NOT NULL;
ALTER TABLE public.mcp_daily_work_lines ALTER COLUMN activity_id DROP NOT NULL;
ALTER TABLE public.mcp_production_rates ALTER COLUMN sov_item DROP NOT NULL;
ALTER TABLE public.mcp_production_rates ALTER COLUMN activity_id DROP NOT NULL;
-- The existing format checks still apply whenever a value is present.

CREATE OR REPLACE FUNCTION public.mcp_daily_report_save(
  _job uuid, _date date, _confirmed boolean,
  _weather text, _manpower text, _subs text, _deliveries text, _issues text, _delays text, _safety text,
  _transcript text, _lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; did uuid; i int; ln jsonb; n int; work text; sov text; act text; qty numeric; unit text; crew numeric; hours numeric; pct numeric; mh numeric;
BEGIN
  cid := public.mcp_field_guard(_job);
  IF coalesce(_confirmed, false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Ask the superintendent to confirm this daily first. Nothing was saved.'; END IF;
  IF _date IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Which date is this daily for? Nothing was saved.'; END IF;
  IF nullif(btrim(coalesce(_weather, '')), '') IS NULL OR nullif(btrim(coalesce(_manpower, '')), '') IS NULL
     OR nullif(btrim(coalesce(_subs, '')), '') IS NULL OR nullif(btrim(coalesce(_deliveries, '')), '') IS NULL
     OR nullif(btrim(coalesce(_issues, '')), '') IS NULL OR nullif(btrim(coalesce(_delays, '')), '') IS NULL
     OR nullif(btrim(coalesce(_safety, '')), '') IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:The daily is still missing a section. Nothing was saved.';
  END IF;
  n := coalesce(jsonb_array_length(_lines), 0);
  IF n < 1 THEN RAISE EXCEPTION 'MCP_BAD:A daily needs the work that was performed. Nothing was saved.'; END IF;
  INSERT INTO public.mcp_daily_reports (job_id, company_id, report_date, weather, manpower, subs_on_site, deliveries, issues, delays, safety, transcript)
  VALUES (_job, cid, _date, btrim(_weather), btrim(_manpower), btrim(_subs), btrim(_deliveries), btrim(_issues), btrim(_delays), btrim(_safety), nullif(btrim(coalesce(_transcript, '')), ''))
  ON CONFLICT (job_id, report_date) DO UPDATE SET
    weather = EXCLUDED.weather, manpower = EXCLUDED.manpower, subs_on_site = EXCLUDED.subs_on_site,
    deliveries = EXCLUDED.deliveries, issues = EXCLUDED.issues, delays = EXCLUDED.delays, safety = EXCLUDED.safety,
    transcript = EXCLUDED.transcript, updated_at = now()
  RETURNING id INTO did;
  DELETE FROM public.mcp_production_rates WHERE daily_id = did;
  DELETE FROM public.mcp_daily_work_lines WHERE daily_id = did;
  FOR i IN 0 .. n - 1 LOOP
    ln := _lines -> i;
    work := btrim(coalesce(ln->>'work', ''));
    -- No SOV item or no CPM activity is allowed: the job may not have one.
    sov := nullif(btrim(coalesce(ln->>'sov_item', '')), '');
    act := nullif(btrim(coalesce(ln->>'activity_id', '')), '');
    IF lower(sov) IN ('none', 'n/a', 'na') THEN sov := NULL; END IF;
    IF lower(act) IN ('none', 'n/a', 'na') THEN act := NULL; END IF;
    qty := nullif(ln->>'qty', '')::numeric;
    unit := btrim(coalesce(ln->>'unit', ''));
    crew := nullif(ln->>'crew', '')::numeric;
    hours := nullif(ln->>'hours', '')::numeric;
    pct := nullif(ln->>'pct_complete', '')::numeric;
    IF work = '' OR qty IS NULL OR qty <= 0 OR unit = '' OR crew IS NULL OR crew <= 0 OR hours IS NULL OR hours <= 0 THEN
      RAISE EXCEPTION 'MCP_BAD:A work line is missing the work, the quantity, the unit, the crew or the hours. Nothing was saved.';
    END IF;
    IF sov IS NOT NULL AND sov !~ '^\d{2}\.\d{2,3}$' THEN
      RAISE EXCEPTION 'MCP_BAD:An SOV item looks like 26.04. Say none if the job has no schedule of values. Nothing was saved.';
    END IF;
    IF act IS NOT NULL AND length(act) > 20 THEN
      RAISE EXCEPTION 'MCP_BAD:A CPM activity ID is 20 characters or fewer. Say none if the job has no CPM schedule. Nothing was saved.';
    END IF;
    IF pct IS NOT NULL AND (pct < 0 OR pct > 100) THEN RAISE EXCEPTION 'MCP_BAD:Percent complete has to be from 0 to 100. Nothing was saved.'; END IF;
    INSERT INTO public.mcp_daily_work_lines (daily_id, job_id, company_id, line_no, work, sov_item, activity_id, qty, unit, crew, hours, pct_complete)
    VALUES (did, _job, cid, i + 1, work, sov, act, qty, unit, crew, hours, pct);
    mh := crew * hours;
    INSERT INTO public.mcp_production_rates (job_id, company_id, daily_id, work, sov_item, activity_id, qty, unit, crew, hours, man_hours, qty_per_man_hour)
    VALUES (_job, cid, did, work, sov, act, qty, unit, crew, hours, mh, qty / mh);
    -- The schedule feed is per CPM activity, so only lines with one feed it.
    IF pct IS NOT NULL AND act IS NOT NULL THEN
      INSERT INTO public.mcp_field_schedule_feed (job_id, company_id, activity_id, pct_complete, report_date, daily_id)
      VALUES (_job, cid, act, pct, _date, did)
      ON CONFLICT (job_id, activity_id) DO UPDATE SET
        pct_complete = EXCLUDED.pct_complete, report_date = EXCLUDED.report_date, daily_id = EXCLUDED.daily_id, updated_at = now()
      WHERE public.mcp_field_schedule_feed.report_date <= EXCLUDED.report_date;
    END IF;
  END LOOP;
  -- Progress photos saved for this date before the daily join it now.
  UPDATE public.mcp_progress_photos SET daily_id = did
  WHERE job_id = _job AND taken_on = _date AND daily_id IS NULL;
  RETURN jsonb_build_object('id', did, 'report_date', _date, 'lines', n, 'saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_report_save(uuid, date, boolean, text, text, text, text, text, text, text, text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_daily_report_save(uuid, date, boolean, text, text, text, text, text, text, text, text, jsonb) TO authenticated;
