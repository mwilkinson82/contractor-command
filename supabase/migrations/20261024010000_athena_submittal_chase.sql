-- Chase tracker on the submittal. Additive. Does not remove tables or rows.
-- A chase email still goes through email_draft and email_confirm_send. Nothing here sends mail.

ALTER TABLE public.mcp_submittals
  ADD COLUMN IF NOT EXISTS chase_role text,
  ADD COLUMN IF NOT EXISTS chase_name text,
  ADD COLUMN IF NOT EXISTS chase_email text,
  ADD COLUMN IF NOT EXISTS last_chased_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_chase_at date,
  ADD COLUMN IF NOT EXISTS chase_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.mcp_submittals
    ADD CONSTRAINT mcp_submittals_chase_role_check
    CHECK (chase_role IS NULL OR chase_role IN ('supplier', 'manufacturer', 'sub'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.mcp_submittals
    ADD CONSTRAINT mcp_submittals_chase_count_check
    CHECK (chase_count >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_submittal_chase_rows(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; sc text; zone text; today date; rows jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  zone := coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York');
  today := (now() AT TIME ZONE zone)::date;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.overdue DESC, s.number), '[]'::jsonb) INTO rows
  FROM (
    SELECT sub.id AS submittal_id, sub.number, sub.revision, sub.title, sub.spec_section, sub.status,
      sub.ball_in_court, sub.ball_in_court_name, sub.required_by, sub.submitted_on, sub.due_back, sub.returned_on,
      (
        (sub.due_back IS NOT NULL AND sub.due_back < today AND sub.returned_on IS NULL)
        OR (sub.required_by IS NOT NULL AND sub.required_by < today AND sub.submitted_on IS NULL)
      ) AS overdue,
      coalesce((
        SELECT string_agg(p.kind, ', ' ORDER BY p.created_at)
        FROM public.mcp_submittal_package_items p
        WHERE p.submittal_id = sub.id AND p.required AND p.status NOT IN ('received', 'approved')
      ), '') AS missing,
      coalesce(sub.chase_role, (
        SELECT p.chase_role FROM public.mcp_submittal_package_items p
        WHERE p.submittal_id = sub.id AND p.chase_email IS NOT NULL
        ORDER BY (p.required AND p.status NOT IN ('received', 'approved')) DESC, p.created_at
        LIMIT 1
      )) AS chase_role,
      coalesce(sub.chase_name, (
        SELECT p.chase_name FROM public.mcp_submittal_package_items p
        WHERE p.submittal_id = sub.id AND p.chase_email IS NOT NULL
        ORDER BY (p.required AND p.status NOT IN ('received', 'approved')) DESC, p.created_at
        LIMIT 1
      )) AS chase_name,
      coalesce(sub.chase_email, (
        SELECT p.chase_email FROM public.mcp_submittal_package_items p
        WHERE p.submittal_id = sub.id AND p.chase_email IS NOT NULL
        ORDER BY (p.required AND p.status NOT IN ('received', 'approved')) DESC, p.created_at
        LIMIT 1
      )) AS chase_email,
      sub.chase_count, sub.last_chased_at, sub.next_chase_at
    FROM (
      SELECT DISTINCT ON (lower(btrim(number))) * FROM public.mcp_submittals
      WHERE job_id = _job
      ORDER BY lower(btrim(number)), revision DESC, id DESC
    ) sub
  ) s
  WHERE s.overdue OR s.missing <> '' OR (s.next_chase_at IS NOT NULL AND s.next_chase_at <= today);
  RETURN jsonb_build_object('job_number', j.job_number, 'job_name', j.name, 'today', to_char(today, 'YYYY-MM-DD'), 'read_only', sc <> 'full', 'chases', rows);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_chase_rows(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_chase_rows(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_chase_due() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE out jsonb := '[]'::jsonb; j record; one jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  FOR j IN
    SELECT id FROM public.mcp_jobs WHERE public.mcp_job_scope(id) IS NOT NULL
  LOOP
    one := public.mcp_submittal_chase_rows(j.id);
    out := out || coalesce((
      SELECT jsonb_agg((e.value || jsonb_build_object('job_id', j.id, 'job_number', one->>'job_number', 'job_name', one->>'job_name', 'today', one->>'today')))
      FROM jsonb_array_elements(coalesce(one->'chases', '[]'::jsonb)) e
      WHERE (e.value->>'next_chase_at') IS NOT NULL AND (e.value->>'next_chase_at') <= (one->>'today')
         OR coalesce((e.value->>'chase_count')::int, 0) = 0
    ), '[]'::jsonb);
  END LOOP;
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_chase_due() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_chase_due() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_chase_mark(_job uuid, _submittal uuid, _email text, _name text, _subject text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; sc text; s public.mcp_submittals; zone text; nxt date; n int;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t do it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = _submittal AND job_id = _job;
  IF s.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That submittal is not on this job. Nothing was saved.'; END IF;
  zone := coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York');
  nxt := ((now() AT TIME ZONE zone)::date + 7);
  n := s.chase_count + 1;
  UPDATE public.mcp_submittals SET
    chase_email = coalesce(nullif(btrim(coalesce(_email, '')), ''), chase_email),
    chase_name = coalesce(nullif(btrim(coalesce(_name, '')), ''), chase_name),
    last_chased_at = now(),
    next_chase_at = nxt,
    chase_count = n,
    updated_at = now()
  WHERE id = s.id;
  PERFORM public.mcp_project_record_add(
    _job, 'submittal_chase',
    'Chase ' || s.number || ' revision ' || s.revision::text,
    'Emailed ' || coalesce(nullif(btrim(coalesce(_name, '')), ''), 'the contact') || ' at ' || coalesce(nullif(btrim(coalesce(_email, '')), ''), 'an unknown address') || '. Chase ' || n::text || '. Next follow-up ' || to_char(nxt, 'YYYY-MM-DD') || '. Subject: ' || left(coalesce(_subject, ''), 200) || '.',
    nullif(btrim(coalesce(_name, '')), ''),
    nullif(btrim(coalesce(_email, '')), ''),
    'mcp_submittals', s.id,
    jsonb_build_object('chase_count', n, 'next_chase_at', nxt, 'subject', _subject, 'number', s.number, 'revision', s.revision),
    'user'
  );
  RETURN jsonb_build_object('submittal_id', s.id, 'chase_count', n, 'next_chase_at', nxt, 'last_chased_at', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_chase_mark(uuid, uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_chase_mark(uuid, uuid, text, text, text) TO authenticated;
