-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105120000_athena_portal_pay_apps.sql.
--
-- Customer page: the name the customer sees on a shared pay application.
-- Before: the customer saw the application's saved number, so a code like "WC-2810-PA-NOV-2026-DRAFT" reached the
-- page, the approval statement and the emails as "Pay application WC-2810-PA-NOV-2026-DRAFT". Saved numbers are
-- locked once a version is saved, so they can't be fixed by renaming.
-- After:
--   * mcp_portal_share_pay_app takes an optional _client_number, 1 to 40 characters ("2" shows as
--     "Pay application 2"). It is frozen into the shared view, so the page, the approval words, the fingerprint and
--     the emails all use it. The saved application, its number and billing don't change.
--   * A re-share of the same undecided version with a new name updates the shared view and its fingerprint, so a
--     customer looking at the old name has to reload before approving.
--   * Left out, a re-share reuses the name the application was last shared under; a plain saved number ("2", "#2",
--     "Pay application 2") is used as it is; any other saved number is refused with a question for the member.
-- The old five-argument function is dropped so there is one signature; grants are as before (authenticated only).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- True for a number a customer can read as it is: "2", "#2", "Pay application 2", "Application 2", "Pay app 2".
CREATE OR REPLACE FUNCTION mcp_private.portal_pay_app_plain(_number text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT btrim(coalesce(_number, '')) ~* '^((pay[[:space:]]+)?app(lication)?[[:space:]]*)?#?[0-9]{1,4}$'
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_pay_app_plain(text) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date);

CREATE FUNCTION public.mcp_portal_share_pay_app(_job uuid, _application uuid, _number text, _expected_version integer, _due_on date,
  _client_number text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; h public.mcp_payment_applications; v public.mcp_payment_application_versions; latest integer;
  v_view jsonb; it public.mcp_portal_items; today date; shown text;
BEGIN
  j := mcp_private.portal_full_job(_job);
  IF _application IS NOT NULL THEN
    SELECT * INTO h FROM public.mcp_payment_applications WHERE id = _application AND job_id = _job AND company_id = j.company_id;
  ELSIF length(btrim(coalesce(_number, ''))) BETWEEN 1 AND 120 THEN
    SELECT * INTO h FROM public.mcp_payment_applications
     WHERE job_id = _job AND company_id = j.company_id AND lower(btrim(number)) = lower(btrim(_number));
  END IF;
  IF h.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That pay application is not on this job.'; END IF;
  SELECT max(version) INTO latest FROM public.mcp_payment_application_versions WHERE application_id = h.id;
  IF _expected_version IS NOT NULL AND _expected_version IS DISTINCT FROM latest THEN
    RAISE EXCEPTION 'MCP_BAD:The pay application changed; read it again before sharing.';
  END IF;
  SELECT * INTO v FROM public.mcp_payment_application_versions WHERE application_id = h.id AND version = latest AND job_id = _job;
  IF v.application_id IS NULL OR v.working_state IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_BAD:This pay application is still a working draft. Review it and mark it ready or submitted before sharing.';
  END IF;
  IF v.body->>'state' IS DISTINCT FROM 'ready' AND v.body->>'state' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'MCP_BAD:Only a ready or submitted pay application can go to the customer. A draft is not finished, and a certified one is already settled.';
  END IF;
  IF v.calculation->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'MCP_BAD:Complete the pay application before sharing it.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_portal_items i JOIN public.mcp_portal_decisions x ON x.item_id = i.id
              WHERE i.kind = 'pay_app' AND i.ref_id = h.id AND i.ref_version = latest) THEN
    RAISE EXCEPTION 'MCP_BAD:The customer already decided on this version of the pay application.';
  END IF;
  today := (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date;
  IF _due_on IS NOT NULL AND (_due_on < today OR _due_on > today + 366) THEN
    RAISE EXCEPTION 'MCP_BAD:Use an approve-by date from today to a year out.';
  END IF;
  v_view := mcp_private.portal_pay_app_view(v.body, v.calculation);
  -- The name the customer sees: the one given now, else the one this application was last shared under, else its
  -- saved number when that is already plain ("2", "#2", "Pay application 2"). A code-like number is never guessed at.
  shown := nullif(btrim(coalesce(_client_number, '')), '');
  IF shown IS NOT NULL AND (length(shown) > 40 OR shown ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'MCP_BAD:Keep the name the customer sees to 40 characters, like 2 or Pay application 2.';
  END IF;
  IF shown IS NULL THEN
    SELECT i.view->>'number' INTO shown FROM public.mcp_portal_items i
     WHERE i.kind = 'pay_app' AND i.job_id = _job AND i.ref_id = h.id ORDER BY i.shared_at DESC LIMIT 1;
  END IF;
  IF shown IS NULL AND NOT mcp_private.portal_pay_app_plain(v_view->>'number') THEN
    RAISE EXCEPTION 'MCP_BAD:This pay application is saved as "%". Ask the member what their customer should see it called, like 2 or Pay application 2, and pass it as client_number. Nothing was shared.', left(v_view->>'number', 120);
  END IF;
  v_view := jsonb_set(v_view, '{number}', to_jsonb(coalesce(shown, v_view->>'number')));
  PERFORM mcp_private.portal_pay_app_view_check(v_view);
  UPDATE public.mcp_portal_items i SET withdrawn_at = now(), withdrawn_by = auth.uid()
   WHERE i.kind = 'pay_app' AND i.job_id = _job AND i.ref_id = h.id AND i.ref_version <> latest AND i.withdrawn_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id);
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (j.company_id, _job, 'pay_app', h.id, latest, v_view, mcp_private.portal_fingerprint(v_view), _due_on, auth.uid())
  -- A re-share of the same undecided version may carry a new name, so the frozen view and its fingerprint follow it.
  ON CONFLICT (kind, ref_id, ref_version) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL, due_on = EXCLUDED.due_on,
    view = EXCLUDED.view, fingerprint = EXCLUDED.fingerprint
  RETURNING * INTO it;
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'pay_app', 'application_id', h.id, 'version', latest,
    'number', v_view->>'number', 'label', mcp_private.portal_pay_app_label(v_view->>'number'), 'due_on', it.due_on,
    'view', v_view, 'fingerprint', it.fingerprint,
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', id, 'email', email, 'name', name)) FROM public.mcp_portal_access WHERE job_id = _job AND revoked_at IS NULL), '[]'::jsonb),
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id), 'job_name', j.name);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date, text) TO authenticated;
