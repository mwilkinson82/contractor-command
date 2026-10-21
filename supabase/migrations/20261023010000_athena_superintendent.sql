-- Athena superintendent: field board, daily reports, production rates, schedule percents,
-- progress photos and a per-job daily reminder. Additive only. NOT APPLIED.
-- Does not replace mcp_job_scope. Super stays 'super' on assigned jobs (no dollars, still
-- read-only on the tools that already existed). New tables:
--   full and super  — field board, dailies, photos, schedule feed, reminders
--   full, super and contract — production rates (estimating reads hours against quantities)
--   pay-app dollars are not stored; the server builds them for full scope only
-- Writes go through SECURITY DEFINER functions. Members have SELECT only.
-- The reminder table defaults to off. This migration sends no email.

CREATE TABLE IF NOT EXISTS public.mcp_field_activities (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  activity_id text NOT NULL CHECK (length(btrim(activity_id)) BETWEEN 1 AND 20),
  self_perform boolean NOT NULL,
  sub_name text,
  crew_size numeric CHECK (crew_size IS NULL OR crew_size > 0),
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, activity_id),
  CHECK (self_perform = (sub_name IS NULL)),
  CHECK (self_perform OR length(btrim(coalesce(sub_name, ''))) > 0)
);

CREATE TABLE IF NOT EXISTS public.mcp_daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'saved' CHECK (status = 'saved'),
  weather text NOT NULL,
  manpower text NOT NULL,
  subs_on_site text NOT NULL,
  deliveries text NOT NULL,
  issues text NOT NULL,
  delays text NOT NULL,
  safety text NOT NULL,
  transcript text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, report_date)
);
CREATE INDEX IF NOT EXISTS mcp_daily_reports_job_idx ON public.mcp_daily_reports (job_id, report_date DESC);

CREATE TABLE IF NOT EXISTS public.mcp_daily_work_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_id uuid NOT NULL REFERENCES public.mcp_daily_reports(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no >= 1),
  work text NOT NULL CHECK (length(btrim(work)) BETWEEN 1 AND 400),
  sov_item text NOT NULL CHECK (sov_item ~ '^\d{2}\.\d{2,3}$'),
  activity_id text NOT NULL CHECK (length(btrim(activity_id)) BETWEEN 1 AND 20),
  qty numeric NOT NULL CHECK (qty > 0),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  crew numeric NOT NULL CHECK (crew > 0),
  hours numeric NOT NULL CHECK (hours > 0),
  pct_complete numeric CHECK (pct_complete IS NULL OR (pct_complete >= 0 AND pct_complete <= 100)),
  UNIQUE (daily_id, line_no)
);
CREATE INDEX IF NOT EXISTS mcp_daily_work_lines_job_idx ON public.mcp_daily_work_lines (job_id, sov_item);

-- No dollar columns. Estimating (contract scope) can read these.
CREATE TABLE IF NOT EXISTS public.mcp_production_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  daily_id uuid NOT NULL REFERENCES public.mcp_daily_reports(id) ON DELETE CASCADE,
  work text NOT NULL,
  sov_item text NOT NULL,
  activity_id text NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  unit text NOT NULL,
  crew numeric NOT NULL CHECK (crew > 0),
  hours numeric NOT NULL CHECK (hours > 0),
  man_hours numeric NOT NULL CHECK (man_hours > 0),
  qty_per_man_hour numeric NOT NULL CHECK (qty_per_man_hour > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_production_rates_job_idx ON public.mcp_production_rates (job_id, created_at DESC);

-- Proposed CPM percent from dailies. Reading this does not change the saved schedule.
CREATE TABLE IF NOT EXISTS public.mcp_field_schedule_feed (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  activity_id text NOT NULL,
  pct_complete numeric NOT NULL CHECK (pct_complete >= 0 AND pct_complete <= 100),
  report_date date NOT NULL,
  daily_id uuid NOT NULL REFERENCES public.mcp_daily_reports(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, activity_id)
);

CREATE TABLE IF NOT EXISTS public.mcp_progress_photos (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  daily_id uuid REFERENCES public.mcp_daily_reports(id) ON DELETE SET NULL,
  taken_on date NOT NULL,
  area text NOT NULL CHECK (length(btrim(area)) BETWEEN 1 AND 160),
  work text,
  sov_item text,
  activity_id text,
  client_safe boolean NOT NULL DEFAULT false,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_progress_photos_job_idx ON public.mcp_progress_photos (job_id, taken_on DESC);

-- Off until someone turns it on for that job. 14:30 local is about 2–3 PM.
CREATE TABLE IF NOT EXISTS public.mcp_daily_reminders (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  send_local time NOT NULL DEFAULT '14:30',
  time_zone text,
  last_sent_on date,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_field_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_daily_work_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_production_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_field_schedule_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_progress_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_daily_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field activity read" ON public.mcp_field_activities;
CREATE POLICY "field activity read" ON public.mcp_field_activities FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
DROP POLICY IF EXISTS "daily report read" ON public.mcp_daily_reports;
CREATE POLICY "daily report read" ON public.mcp_daily_reports FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
DROP POLICY IF EXISTS "daily line read" ON public.mcp_daily_work_lines;
CREATE POLICY "daily line read" ON public.mcp_daily_work_lines FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
DROP POLICY IF EXISTS "production rate read" ON public.mcp_production_rates;
CREATE POLICY "production rate read" ON public.mcp_production_rates FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super', 'contract'), false));
DROP POLICY IF EXISTS "schedule feed read" ON public.mcp_field_schedule_feed;
CREATE POLICY "schedule feed read" ON public.mcp_field_schedule_feed FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
DROP POLICY IF EXISTS "progress photo read" ON public.mcp_progress_photos;
CREATE POLICY "progress photo read" ON public.mcp_progress_photos FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));
DROP POLICY IF EXISTS "daily reminder read" ON public.mcp_daily_reminders;
CREATE POLICY "daily reminder read" ON public.mcp_daily_reminders FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'super'), false));

REVOKE INSERT, UPDATE, DELETE ON public.mcp_field_activities FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_daily_reports FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_daily_work_lines FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_production_rates FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_field_schedule_feed FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_progress_photos FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_daily_reminders FROM anon, authenticated, public;

GRANT SELECT ON public.mcp_field_activities, public.mcp_daily_reports, public.mcp_daily_work_lines,
  public.mcp_production_rates, public.mcp_field_schedule_feed, public.mcp_progress_photos, public.mcp_daily_reminders
  TO authenticated;
GRANT ALL ON public.mcp_field_activities, public.mcp_daily_reports, public.mcp_daily_work_lines,
  public.mcp_production_rates, public.mcp_field_schedule_feed, public.mcp_progress_photos, public.mcp_daily_reminders
  TO service_role;

-- Private bucket. Signed URLs only; never a public object.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('athena-progress', 'athena-progress', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "athena progress insert" ON storage.objects;
CREATE POLICY "athena progress insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'athena-progress' AND public.mcp_file_path_scope(name) IN ('full', 'super'));
DROP POLICY IF EXISTS "athena progress select" ON storage.objects;
CREATE POLICY "athena progress select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'athena-progress' AND public.mcp_file_path_scope(name) IN ('full', 'super'));
DROP POLICY IF EXISTS "athena progress delete" ON storage.objects;
CREATE POLICY "athena progress delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'athena-progress' AND public.mcp_file_path_scope(name) IN ('full', 'super'));

CREATE OR REPLACE FUNCTION public.mcp_field_guard(_job uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; cid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t do it.'; END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  IF cid IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  RETURN cid;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_guard(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_guard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_field_board(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; co text; cpm jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  cpm := public.mcp_living_report_get(_job, 'cpm', NULL);
  RETURN jsonb_build_object(
    'page', 'field',
    'company', co,
    'job_number', j.job_number,
    'job_name', j.name,
    'scope', sc,
    'time_zone', j.time_zone,
    'data_date', cpm->>'data_date',
    'lookahead', public.mcp_report_latest_lookahead(_job),
    'activities', coalesce(cpm->'data'->'activities', '[]'::jsonb),
    'assignments', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'activity_id', a.activity_id, 'self_perform', a.self_perform, 'sub_name', a.sub_name, 'crew_size', a.crew_size))
      FROM public.mcp_field_activities a WHERE a.job_id = _job), '[]'::jsonb),
    'materials', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'item', l.item, 'material', l.material, 'qty', l.qty, 'unit', l.unit, 'trade', l.trade))
      FROM public.mcp_estimate_takeoff_lines l
      JOIN public.mcp_estimate_takeoffs t ON t.id = l.takeoff_id
      WHERE l.job_id = _job AND t.version = (SELECT max(version) FROM public.mcp_estimate_takeoffs WHERE job_id = _job)), '[]'::jsonb),
    'rates', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'activity_id', r.activity_id, 'sov_item', r.sov_item, 'unit', r.unit, 'qty_per_man_hour', r.qty_per_man_hour,
      'crew', r.crew, 'hours', r.hours) ORDER BY r.created_at DESC)
      FROM public.mcp_production_rates r WHERE r.job_id = _job), '[]'::jsonb),
    'installed', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'activity_id', w.activity_id, 'sov_item', w.sov_item, 'qty', w.qty, 'unit', w.unit))
      FROM public.mcp_daily_work_lines w WHERE w.job_id = _job), '[]'::jsonb),
    'items', public.mcp_report_open_items(_job, sc <> 'full')
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_board(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_board(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_field_activity_save(_job uuid, _activity text, _self boolean, _sub text, _crew numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_field_guard(_job);
  IF coalesce(btrim(_activity), '') = '' THEN RAISE EXCEPTION 'MCP_BAD:Which activity? Nothing was saved.'; END IF;
  IF _self IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Say whether this activity is self-perform. Nothing was saved.'; END IF;
  IF _self AND nullif(btrim(coalesce(_sub, '')), '') IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:A self-perform activity has no sub. Nothing was saved.'; END IF;
  IF NOT _self AND nullif(btrim(coalesce(_sub, '')), '') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Name the sub on this activity. Nothing was saved.'; END IF;
  IF _crew IS NOT NULL AND _crew <= 0 THEN RAISE EXCEPTION 'MCP_BAD:Crew size has to be at least one. Nothing was saved.'; END IF;
  INSERT INTO public.mcp_field_activities (job_id, company_id, activity_id, self_perform, sub_name, crew_size)
  VALUES (_job, cid, btrim(_activity), _self, CASE WHEN _self THEN NULL ELSE btrim(_sub) END, _crew)
  ON CONFLICT (job_id, activity_id) DO UPDATE SET
    self_perform = EXCLUDED.self_perform, sub_name = EXCLUDED.sub_name, crew_size = EXCLUDED.crew_size,
    updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('activity_id', btrim(_activity), 'self_perform', _self);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_activity_save(uuid, text, boolean, text, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_activity_save(uuid, text, boolean, text, numeric) TO authenticated;

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
    sov := btrim(coalesce(ln->>'sov_item', ''));
    act := btrim(coalesce(ln->>'activity_id', ''));
    qty := nullif(ln->>'qty', '')::numeric;
    unit := btrim(coalesce(ln->>'unit', ''));
    crew := nullif(ln->>'crew', '')::numeric;
    hours := nullif(ln->>'hours', '')::numeric;
    pct := nullif(ln->>'pct_complete', '')::numeric;
    IF work = '' OR sov !~ '^\d{2}\.\d{2,3}$' OR act = '' OR qty IS NULL OR qty <= 0 OR unit = '' OR crew IS NULL OR crew <= 0 OR hours IS NULL OR hours <= 0 THEN
      RAISE EXCEPTION 'MCP_BAD:A work line is missing the SOV item, the activity, the quantity, the crew or the hours. Nothing was saved.';
    END IF;
    IF pct IS NOT NULL AND (pct < 0 OR pct > 100) THEN RAISE EXCEPTION 'MCP_BAD:Percent complete has to be from 0 to 100. Nothing was saved.'; END IF;
    INSERT INTO public.mcp_daily_work_lines (daily_id, job_id, company_id, line_no, work, sov_item, activity_id, qty, unit, crew, hours, pct_complete)
    VALUES (did, _job, cid, i + 1, work, sov, act, qty, unit, crew, hours, pct);
    mh := crew * hours;
    INSERT INTO public.mcp_production_rates (job_id, company_id, daily_id, work, sov_item, activity_id, qty, unit, crew, hours, man_hours, qty_per_man_hour)
    VALUES (_job, cid, did, work, sov, act, qty, unit, crew, hours, mh, qty / mh);
    IF pct IS NOT NULL THEN
      INSERT INTO public.mcp_field_schedule_feed (job_id, company_id, activity_id, pct_complete, report_date, daily_id)
      VALUES (_job, cid, act, pct, _date, did)
      ON CONFLICT (job_id, activity_id) DO UPDATE SET
        pct_complete = EXCLUDED.pct_complete, report_date = EXCLUDED.report_date, daily_id = EXCLUDED.daily_id, updated_at = now()
      WHERE public.mcp_field_schedule_feed.report_date <= EXCLUDED.report_date;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('id', did, 'report_date', _date, 'lines', n, 'saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_report_save(uuid, date, boolean, text, text, text, text, text, text, text, text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_daily_report_save(uuid, date, boolean, text, text, text, text, text, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_daily_report_get(_job uuid, _date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; r public.mcp_daily_reports; lines jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO r FROM public.mcp_daily_reports WHERE job_id = _job AND report_date = _date;
  IF r.id IS NULL THEN RETURN jsonb_build_object('found', false, 'page', 'daily'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'work', w.work, 'sov_item', w.sov_item, 'activity_id', w.activity_id, 'qty', w.qty, 'unit', w.unit,
    'crew', w.crew, 'hours', w.hours, 'pct_complete', w.pct_complete) ORDER BY w.line_no), '[]'::jsonb)
  INTO lines FROM public.mcp_daily_work_lines w WHERE w.daily_id = r.id;
  RETURN jsonb_build_object('found', true, 'page', 'daily', 'report_date', r.report_date, 'weather', r.weather,
    'manpower', r.manpower, 'subs_on_site', r.subs_on_site, 'deliveries', r.deliveries, 'issues', r.issues,
    'delays', r.delays, 'safety', r.safety, 'lines', lines);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_report_get(uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_daily_report_get(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_field_daily_page(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co text; d date; body jsonb;
BEGIN
  IF public.mcp_job_scope(_job) NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  SELECT max(report_date) INTO d FROM public.mcp_daily_reports WHERE job_id = _job;
  body := public.mcp_daily_report_get(_job, d);
  RETURN body || jsonb_build_object('company', co, 'job_number', j.job_number, 'job_name', j.name);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_daily_page(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_daily_page(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_progress_photo_create(
  _id uuid, _job uuid, _taken date, _area text, _work text, _sov text, _activity text,
  _client_safe boolean, _path text, _mime text, _size bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; did uuid; linked boolean := false;
BEGIN
  cid := public.mcp_field_guard(_job);
  IF _taken IS NULL OR nullif(btrim(coalesce(_area, '')), '') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A photo needs a date and where on site it was taken. Nothing was saved.'; END IF;
  IF _path <> cid::text || '/' || _job::text || '/' || _id::text || '/' || regexp_replace(_path, '^.*/', '') THEN RAISE EXCEPTION 'MCP_BAD:Photo path doesn''t match the job.'; END IF;
  IF _mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN RAISE EXCEPTION 'MCP_BAD:Use a JPEG, PNG or WebP photo. Nothing was saved.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'athena-progress' AND name = _path) THEN RAISE EXCEPTION 'MCP_BAD:The photo wasn''t stored. Nothing was saved.'; END IF;
  SELECT id INTO did FROM public.mcp_daily_reports WHERE job_id = _job AND report_date = _taken;
  linked := did IS NOT NULL;
  INSERT INTO public.mcp_progress_photos (id, job_id, company_id, daily_id, taken_on, area, work, sov_item, activity_id, client_safe, storage_path, mime_type, size_bytes)
  VALUES (_id, _job, cid, did, _taken, btrim(_area), nullif(btrim(coalesce(_work, '')), ''), nullif(btrim(coalesce(_sov, '')), ''),
    nullif(btrim(coalesce(_activity, '')), ''), coalesce(_client_safe, false), _path, _mime, _size);
  RETURN jsonb_build_object('id', _id, 'taken_on', _taken, 'linked_daily', linked, 'client_safe', coalesce(_client_safe, false));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_progress_photo_create(uuid, uuid, date, text, text, text, text, boolean, text, text, bigint) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_progress_photo_create(uuid, uuid, date, text, text, text, text, boolean, text, text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_progress_photos_list(_job uuid, _from date, _to date, _item text, _area text, _client_safe boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; rows jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'taken_on', p.taken_on, 'area', p.area, 'work', p.work, 'sov_item', p.sov_item,
    'activity_id', p.activity_id, 'client_safe', p.client_safe, 'storage_path', p.storage_path, 'mime_type', p.mime_type)
    ORDER BY p.taken_on DESC, p.created_at DESC), '[]'::jsonb) INTO rows
  FROM (
    SELECT * FROM public.mcp_progress_photos p
    WHERE p.job_id = _job
      AND (_from IS NULL OR p.taken_on >= _from)
      AND (_to IS NULL OR p.taken_on <= _to)
      AND (_area IS NULL OR p.area ILIKE '%' || _area || '%')
      AND (_item IS NULL OR p.sov_item = _item OR p.activity_id = _item OR p.work ILIKE '%' || _item || '%')
      AND (_client_safe IS NULL OR p.client_safe = _client_safe)
    ORDER BY p.taken_on DESC, p.created_at DESC
    LIMIT 60
  ) p;
  RETURN rows;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_progress_photos_list(uuid, date, date, text, text, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_progress_photos_list(uuid, date, date, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_field_photo_page(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co text;
BEGIN
  IF public.mcp_job_scope(_job) NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  RETURN jsonb_build_object('page', 'photos', 'company', co, 'job_number', j.job_number, 'job_name', j.name,
    'photos', public.mcp_progress_photos_list(_job, NULL, NULL, NULL, NULL, NULL));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_photo_page(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_photo_page(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_daily_reminder_save(_job uuid, _enabled boolean, _send text, _tz text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; t time; z text;
BEGIN
  cid := public.mcp_field_guard(_job);
  IF _enabled IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Say whether the reminder is on or off. Nothing was saved.'; END IF;
  BEGIN
    t := coalesce(nullif(btrim(coalesce(_send, '')), ''), '14:30')::time;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'MCP_BAD:Use a time like 14:30. Nothing was saved.';
  END;
  z := nullif(btrim(coalesce(_tz, '')), '');
  IF z IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = z) THEN
    RAISE EXCEPTION 'MCP_BAD:That time zone isn''t recognized. Nothing was saved.';
  END IF;
  INSERT INTO public.mcp_daily_reminders (job_id, company_id, enabled, send_local, time_zone)
  VALUES (_job, cid, _enabled, t, z)
  ON CONFLICT (job_id) DO UPDATE SET enabled = EXCLUDED.enabled, send_local = EXCLUDED.send_local,
    time_zone = EXCLUDED.time_zone, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('enabled', _enabled, 'send_local', to_char(t, 'HH24:MI'), 'time_zone', z);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_daily_reminder_save(uuid, boolean, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_daily_reminder_save(uuid, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_field_reminder_preview(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; r public.mcp_daily_reminders; people jsonb;
BEGIN
  PERFORM public.mcp_field_guard(_job);
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO r FROM public.mcp_daily_reminders WHERE job_id = _job;
  SELECT coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'name', m.display_name)), '[]'::jsonb) INTO people
  FROM public.mcp_company_members m
  JOIN auth.users u ON u.id = m.user_id
  JOIN public.mcp_job_access a ON a.job_id = _job AND a.user_id = m.user_id
  WHERE m.company_id = j.company_id AND m.role = 'super' AND nullif(btrim(u.email), '') IS NOT NULL;
  RETURN jsonb_build_object(
    'enabled', coalesce(r.enabled, false),
    'send_local', to_char(coalesce(r.send_local, '14:30'::time), 'HH24:MI'),
    'time_zone', coalesce(r.time_zone, j.time_zone),
    'last_sent_on', r.last_sent_on,
    'job_number', j.job_number,
    'job_name', j.name,
    'recipients', people
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_reminder_preview(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_reminder_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_field_reminder_mark(_job uuid, _day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  PERFORM public.mcp_field_guard(_job);
  UPDATE public.mcp_daily_reminders SET last_sent_on = _day, updated_at = now()
  WHERE job_id = _job AND enabled = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('marked', n > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_field_reminder_mark(uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_field_reminder_mark(uuid, date) TO authenticated;

-- Report pages: same ior / schedule / lookahead / payapp / briefing branches, plus field, daily and photos.
-- Share links stay on the original pages. Supers can open the new pages; contract scope cannot.
CREATE OR REPLACE FUNCTION public.mcp_report_page_get(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; co public.mcp_companies; sc text;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT * INTO co FROM public.mcp_companies WHERE id = _company;
    RETURN jsonb_build_object('page', 'portfolio', 'company', co.name, 'jobs', public.mcp_report_portfolio_rows(_company, true), 'money', true);
  END IF;
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing', 'field', 'daily', 'photos') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO co FROM public.mcp_companies WHERE id = j.company_id;
  IF _page IN ('ior', 'schedule', 'payapp') THEN
    RETURN jsonb_build_object('page', _page, 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'report', public.mcp_living_report_get(_job, CASE _page WHEN 'schedule' THEN 'cpm' WHEN 'payapp' THEN 'billing_forecast' ELSE 'ior' END, NULL));
  END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'super') THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  IF _page = 'lookahead' THEN
    RETURN jsonb_build_object('page', 'lookahead', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
      'lookahead', public.mcp_report_latest_lookahead(_job), 'report', public.mcp_living_report_get(_job, 'cpm', NULL),
      'items', public.mcp_report_open_items(_job, sc <> 'full'));
  END IF;
  IF _page = 'field' THEN RETURN public.mcp_field_board(_job); END IF;
  IF _page = 'daily' THEN RETURN public.mcp_field_daily_page(_job); END IF;
  IF _page = 'photos' THEN RETURN public.mcp_field_photo_page(_job); END IF;
  RETURN jsonb_build_object('page', 'briefing', 'company', co.name, 'job_number', j.job_number, 'job_name', j.name,
    'today', (now() AT TIME ZONE coalesce(j.time_zone, 'America/Chicago'))::date, 'items', public.mcp_report_open_items(_job, sc <> 'full'),
    'report', jsonb_build_object('found', true, 'contract_completion_date', j.contract_completion_date, 'scope', sc));
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_get(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_report_page_stamp(_page text, _job uuid, _company uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; s text;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _page = 'portfolio' THEN
    IF _company IS NULL OR NOT public.mcp_is_company_leader(_company) THEN RAISE EXCEPTION 'MCP_BAD:The portfolio is for owners and leadership.'; END IF;
    SELECT count(*)::text || '|' || coalesce(max(r.created_at)::text, '') || '|' || (SELECT count(*) FROM public.mcp_jobs WHERE company_id = _company)::text INTO s
      FROM public.mcp_living_reports r JOIN public.mcp_jobs j ON j.id = r.job_id WHERE j.company_id = _company;
    RETURN s;
  END IF;
  IF _page NOT IN ('ior', 'schedule', 'lookahead', 'payapp', 'briefing', 'field', 'daily', 'photos') THEN RAISE EXCEPTION 'MCP_BAD:Unknown page.'; END IF;
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF (_page IN ('ior', 'payapp') AND sc <> 'full') OR (_page IN ('schedule', 'lookahead', 'briefing', 'field', 'daily', 'photos') AND sc NOT IN ('full', 'super')) THEN RAISE EXCEPTION 'MCP_BAD:No access.'; END IF;
  IF _page IN ('lookahead', 'briefing', 'field', 'daily', 'photos') THEN
    SELECT coalesce((SELECT max(version)::text || '|' || max(created_at)::text FROM public.mcp_living_reports WHERE job_id = _job AND report_type = 'cpm'), 'none')
      || '|' || coalesce((SELECT count(*)::text || '|' || max(updated_at)::text FROM public.mcp_open_items WHERE job_id = _job AND status = 'open'), '')
      || '|' || coalesce((SELECT max(created_at)::text FROM public.mcp_lookaheads WHERE job_id = _job), '')
      || '|' || CASE WHEN _page = 'briefing' THEN current_date::text ELSE '' END
      || '|' || coalesce((SELECT max(updated_at)::text FROM public.mcp_field_activities WHERE job_id = _job), '')
      || '|' || coalesce((SELECT max(updated_at)::text FROM public.mcp_daily_reports WHERE job_id = _job), '')
      || '|' || coalesce((SELECT max(created_at)::text FROM public.mcp_progress_photos WHERE job_id = _job), '')
      INTO s;
    RETURN s;
  END IF;
  SELECT r.version::text || '|' || r.created_at::text INTO s FROM public.mcp_living_reports r
    WHERE r.job_id = _job AND r.report_type = CASE _page WHEN 'schedule' THEN 'cpm' WHEN 'payapp' THEN 'billing_forecast' ELSE 'ior' END ORDER BY r.version DESC LIMIT 1;
  RETURN coalesce(s, 'none');
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_report_page_stamp(text, uuid, uuid) TO authenticated;
