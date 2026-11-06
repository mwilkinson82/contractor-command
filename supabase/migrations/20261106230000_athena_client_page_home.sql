-- Client page Home: the project manager's photo and where the money stands, so Home always has its full look.
--
-- * profiles.photo_path: a member's own photo, kept in the existing private athena-progress bucket under
--   people/<their user id>/. No new bucket and no storage policy: only Athena's server reads or writes that folder
--   (member storage policies there only reach company/job paths). Members set it on their account page or by
--   sending it to Athena in chat (mcp_profile_photo_set). The client page shows the job PM's photo in "Your team";
--   the page server signs the path, so the client never gets a storage path.
-- * mcp_private.portal_pm_photo: the photo of the job's PM (pm_user_id, or else the company member whose email is
--   the job's PM email). Only a member of the job's company counts.
-- * mcp_private.portal_progress: the contract (original contract value plus approved or executed change orders,
--   the same math as billing evidence) and the work the owner has approved so far (certified invoices and pay
--   applications, less posted credits on them). Nothing unapproved, no draft, no submitted bill, no receipts.
--   Null until the job has a contract value.
-- * mcp_portal_view: as in 20261106130000_athena_precon_signing, plus contractor.pm_photo_path and progress.
-- Plain SQL for Lovable to apply. Rollback: supabase/rollbacks/20261106230000_athena_client_page_home.rollback.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Stop before changing anything when the client page view isn't the one this migration was written against
-- (20261106130000_athena_precon_signing), or this migration already ran.
DO $$ DECLARE fp text; BEGIN
  SELECT md5(p.prosrc) INTO fp FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mcp_portal_view';
  IF fp IS DISTINCT FROM '1e76ae37218afbcfe5b1ccfcf05d9582' AND fp IS DISTINCT FROM 'e34e7b856b9859ef9158375e0136869c' THEN
    RAISE EXCEPTION 'mcp_portal_view changed since 20261106130000 (fingerprint %); review this migration before applying.', fp;
  END IF;
END $$;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_path text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_photo_path_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_photo_path_check
      CHECK (photo_path IS NULL OR photo_path ~ '^people/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$');
  END IF;
END $$;

-- Sets or clears the signed-in member's own photo. The path must sit in their own folder, people/<user id>/.
CREATE OR REPLACE FUNCTION public.mcp_profile_photo_set(_path text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := auth.uid(); p text := nullif(btrim(coalesce(_path, '')), '');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Sign in to set your photo.'; END IF;
  IF p IS NOT NULL AND (split_part(p, '/', 1) <> 'people' OR split_part(p, '/', 2) <> me::text
      OR p !~ '^people/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$') THEN
    RAISE EXCEPTION 'MCP_BAD:That photo isn''t in your own folder.';
  END IF;
  UPDATE public.profiles SET photo_path = p, updated_at = now() WHERE id = me;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:No profile for this sign-in.'; END IF;
  RETURN jsonb_build_object('status', 'ok', 'photo_path', p);
END $$;
REVOKE ALL ON FUNCTION public.mcp_profile_photo_set(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_profile_photo_set(text) TO authenticated;

CREATE OR REPLACE FUNCTION mcp_private.portal_pm_photo(_job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.photo_path
    FROM public.mcp_jobs j
    JOIN public.mcp_company_members m ON m.company_id = j.company_id
    JOIN public.profiles p ON p.id = m.user_id
   WHERE j.id = _job AND p.photo_path IS NOT NULL
     AND (m.user_id = j.pm_user_id
       OR (j.pm_user_id IS NULL AND nullif(btrim(j.pm_email), '') IS NOT NULL AND lower(p.email) = lower(btrim(j.pm_email))))
   ORDER BY (m.user_id = j.pm_user_id) DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_pm_photo(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.portal_progress(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE original numeric; changes numeric; incomplete boolean; contract bigint; approved numeric;
BEGIN
  SELECT CASE WHEN jsonb_typeof(f.value) = 'number' THEN (f.value::text)::numeric END INTO original
    FROM public.mcp_job_facts f WHERE f.job_id = _job AND f.module = 'contract' AND f.key = 'contract_value' AND f.status = 'known'
    LIMIT 1;
  IF original IS NULL OR original <= 0 OR original * 100 <> trunc(original * 100) OR original * 100 > 9000000000000 THEN RETURN NULL; END IF;
  -- Approved or executed change orders, latest revision of each, as billing evidence counts them.
  SELECT coalesce(sum(CASE WHEN jsonb_typeof(c.details->'total_cents') = 'number' THEN (c.details->>'total_cents')::numeric END), 0),
         coalesce(bool_or(jsonb_typeof(c.details->'total_cents') IS DISTINCT FROM 'number'), false)
    INTO changes, incomplete
    FROM public.mcp_change_orders c JOIN public.mcp_submittals sub ON sub.id = c.submittal_id AND sub.job_id = _job
   WHERE c.job_id = _job AND c.details->>'state' IN ('approved', 'executed')
     AND NOT EXISTS (SELECT 1 FROM public.mcp_submittals newer WHERE newer.job_id = _job AND newer.number = sub.number AND newer.revision > sub.revision);
  contract := (original * 100)::bigint;
  IF NOT incomplete AND changes = trunc(changes) AND contract + changes BETWEEN 1 AND 9000000000000 THEN
    contract := (contract + changes)::bigint;
  END IF;
  -- Certified bills (latest version of each), less posted credits on certified bills.
  WITH latest AS (
    SELECT DISTINCT ON (v.invoice_id) i.id, i.kind, i.credit_for, v.status, v.gross_cents, v.certified_cents, v.net_due_cents
      FROM public.mcp_billing_invoices i JOIN public.mcp_billing_invoice_versions v ON v.invoice_id = i.id
     WHERE i.job_id = _job ORDER BY v.invoice_id, v.version DESC)
  SELECT coalesce(sum(coalesce(b.gross_cents, b.certified_cents, 0)) FILTER (WHERE b.kind IN ('invoice', 'pay_application') AND b.status = 'certified'), 0)
       - coalesce(sum(b.net_due_cents) FILTER (WHERE b.kind = 'credit' AND b.status = 'posted'
           AND EXISTS (SELECT 1 FROM latest x WHERE x.id = b.credit_for AND x.status = 'certified')), 0)
    INTO approved FROM latest b;
  RETURN jsonb_build_object('contract_cents', contract, 'approved_cents', greatest(0, least(approved, contract))::bigint);
END $$;
REVOKE ALL ON FUNCTION mcp_private.portal_progress(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- As in 20261106130000_athena_precon_signing, plus contractor.pm_photo_path and progress.
CREATE OR REPLACE FUNCTION public.mcp_portal_view(_access uuid, _session_hash text, _ip text, _user_agent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; s public.mcp_portal_sessions; st text; j public.mcp_jobs; co public.mcp_companies; cpm jsonb;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  s := mcp_private.portal_session(a.id, _session_hash);
  IF s.id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '10 minutes' THEN
    UPDATE public.mcp_portal_sessions SET last_seen_at = now() WHERE id = s.id;
    UPDATE public.mcp_portal_access SET last_seen_at = now() WHERE id = a.id;
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, ip, user_agent) VALUES (a.id, a.job_id, 'viewed', left(_ip, 100), left(_user_agent, 400));
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  SELECT r.data INTO cpm FROM public.mcp_living_reports r WHERE r.job_id = a.job_id AND r.report_type = 'cpm' ORDER BY r.version DESC LIMIT 1;
  RETURN jsonb_build_object(
    'status', 'ok',
    'customer', jsonb_build_object('name', a.name, 'email', a.email),
    'contractor', jsonb_build_object('name', co.name, 'pm_name', j.pm_name, 'pm_title', j.pm_title, 'pm_email', j.pm_email,
      'pm_photo_path', mcp_private.portal_pm_photo(j.id)),
    'job', jsonb_build_object('number', j.job_number, 'name', j.name, 'completion_date', j.contract_completion_date,
      'under_contract', mcp_private.gbb_job_under_contract(j.id), 'kind', j.job_kind,
      'today', (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date),
    'progress', mcp_private.portal_progress(j.id),
    'updates', coalesce((SELECT jsonb_agg(x ORDER BY x->>'week_of' DESC) FROM (
        SELECT jsonb_build_object('week_of', u.week_of, 'title', u.title, 'body', u.body) AS x
        FROM public.mcp_portal_updates u WHERE u.job_id = a.job_id AND u.withdrawn_at IS NULL ORDER BY u.week_of DESC, u.created_at DESC LIMIT 12) q), '[]'::jsonb),
    'dailies', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (
        SELECT jsonb_build_object('date', d.report_date, 'weather', d.weather, 'manpower', d.manpower,
          'work', coalesce((SELECT jsonb_agg(w.work ORDER BY w.line_no) FROM public.mcp_daily_work_lines w WHERE w.daily_id = d.id), '[]'::jsonb)) AS x
        FROM public.mcp_daily_reports d WHERE d.job_id = a.job_id ORDER BY d.report_date DESC LIMIT 10) q), '[]'::jsonb),
    'photos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'taken_on' DESC) FROM (
        SELECT jsonb_build_object('id', p.id, 'taken_on', p.taken_on, 'area', p.area, 'work', p.work, 'storage_path', p.storage_path) AS x
        FROM public.mcp_progress_photos p WHERE p.job_id = a.job_id AND p.client_safe AND p.removed_at IS NULL
        ORDER BY p.taken_on DESC, p.created_at DESC LIMIT 60) q), '[]'::jsonb),
    'milestones', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
        SELECT jsonb_build_object('name', m->>'name',
          'date', coalesce(nullif(m->>'actual_finish', ''), nullif(m->>'finish', ''), nullif(m->>'actual_start', ''), nullif(m->>'start', '')),
          'done', (nullif(m->>'actual_finish', '') IS NOT NULL OR coalesce(nullif(m->>'pct_complete', '')::numeric, 0) >= 100)) AS x
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cpm->'activities') = 'array' THEN cpm->'activities' ELSE '[]'::jsonb END) m
        WHERE (m->>'activity_type' IN ('milestone-start', 'milestone-finish') OR (m->>'duration' ~ '^-?[0-9.]+$' AND (m->>'duration')::numeric = 0))
          AND length(btrim(coalesce(m->>'name', ''))) > 0
          AND coalesce(nullif(m->>'actual_finish', ''), nullif(m->>'finish', ''), nullif(m->>'actual_start', ''), nullif(m->>'start', '')) IS NOT NULL
        LIMIT 40) q), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'shared_on', (i.shared_at AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date,
          'due_on', i.due_on, 'fingerprint', i.fingerprint, 'view', i.view,
          'decision', (SELECT jsonb_build_object('decision', x.decision, 'choice', x.choice, 'typed_name', x.typed_name, 'decided_at', x.decided_at,
              'note', x.note, 'code_verified', x.code_verified) FROM public.mcp_portal_decisions x WHERE x.item_id = i.id))
        ORDER BY i.shared_at DESC)
      FROM public.mcp_portal_items i WHERE i.job_id = a.job_id AND i.withdrawn_at IS NULL
        -- An undecided item shows only while it still matches the record; an edit hides it until it is shared again.
        AND (EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id)
          OR (i.kind = 'change_order' AND EXISTS (SELECT 1 FROM public.mcp_change_orders c WHERE c.submittal_id = i.ref_id
                AND (c.details->>'record_version')::bigint = i.ref_version AND c.details->>'state' = 'priced'))
          OR (i.kind = 'selection' AND EXISTS (SELECT 1 FROM mcp_private.residential_selection_boards b WHERE b.job_id = i.job_id
                AND b.version = i.ref_version AND jsonb_typeof(b.body->'accepted') IS DISTINCT FROM 'object'))
          OR (i.kind = 'pay_app' AND mcp_private.portal_pay_app_open(i.job_id, i.ref_id, i.ref_version))
          OR (i.kind = 'work_order' AND EXISTS (SELECT 1 FROM public.mcp_work_orders w WHERE w.id = i.ref_id AND w.job_id = i.job_id
                AND w.version = i.ref_version AND w.state = 'sent'))
          OR (i.kind = 'service_invoice' AND mcp_private.service_invoice_open(i.job_id, i.ref_id, i.ref_version))
          OR (i.kind = 'precon_agreement' AND EXISTS (SELECT 1 FROM public.mcp_precon_agreements p WHERE p.id = i.ref_id
                AND p.job_id = i.job_id AND p.portal_item_id = i.id AND p.status = 'sent')))), '[]'::jsonb),
    'check_items', coalesce((SELECT jsonb_agg(i.id) FROM public.mcp_portal_items i
        WHERE i.job_id = a.job_id AND i.withdrawn_at IS NULL AND mcp_private.portal_check_ok(i)), '[]'::jsonb),
    'checks', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'requested_at', c.requested_at, 'note', c.note,
          'pickup_on', c.pickup_on, 'pickup_window', c.pickup_window, 'pickup_place', c.pickup_place, 'pickup_by', c.pickup_by))
        FROM public.mcp_portal_check_requests c JOIN public.mcp_portal_items i ON i.id = c.item_id
       WHERE c.job_id = a.job_id AND i.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_view(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_view(uuid, text, text, text) TO service_role;
