-- 0019: P1 persistence (Job 2601 E2E, 2026-10-19).
-- 1) A job PM who isn't an Athena member is saved as a contact (name, email, title) with NO Athena access:
--    no mcp_company_members row, no mcp_job_access row, pm_user_id stays NULL.
-- 2) Delay events: any reported delay auto-creates the delay-notice item and the claim item, linked to the event.
-- 3) Guardrail: Supers can never read job facts (budget, SOV, contract money) — restrictive policy, defense in depth over 0015.
-- Additive: new columns, a new table, a new RPC, and in-place function redefinitions.

ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS pm_name text;
ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS pm_email text;
ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS pm_title text;

-- Job settings: PM by member name, or as a contact (name + optional email/title). Replaces the 3-arg version.
DROP FUNCTION IF EXISTS public.mcp_job_settings(uuid, text, text);
CREATE OR REPLACE FUNCTION public.mcp_job_settings(_job uuid, _time_zone text, _pm_name text, _pm_email text DEFAULT NULL, _pm_title text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; r text; uid uuid; nm text := nullif(btrim(_pm_name), ''); em text := nullif(lower(btrim(_pm_email)), ''); ti text := nullif(btrim(_pm_title), ''); mname text;
BEGIN
  IF public.mcp_assert_job_scope(_job) <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t change job settings.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF nullif(btrim(_time_zone), '') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = btrim(_time_zone)) THEN
      RAISE EXCEPTION 'MCP_BAD:Unknown time zone. Use an IANA name such as America/Chicago.';
    END IF;
    UPDATE public.mcp_jobs SET time_zone = btrim(_time_zone), updated_at = now() WHERE id = _job;
    UPDATE public.mcp_open_items SET status = 'resolved', resolution = 'verified', verify_state = 'verified', verified_at = now(),
      verified_evidence = 'Time zone set to ' || btrim(_time_zone), resolved_at = now()
      WHERE job_id = _job AND check_key = 'tz:job' AND status = 'open';
    PERFORM public.mcp_audit_job(_job, 'intake', 'job_time_zone_set', NULL);
  END IF;
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'MCP_BAD:That PM email doesn''t look valid.'; END IF;
  IF nm IS NOT NULL OR em IS NOT NULL OR ti IS NOT NULL THEN
    SELECT role INTO r FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = auth.uid();
    IF coalesce(r, '') NOT IN ('owner','all_access','finance') AND j.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'MCP_BAD:Only an Owner, Finance, All-access member or the job creator can assign the PM.';
    END IF;
  END IF;
  IF nm IS NOT NULL THEN
    SELECT m.user_id, m.display_name INTO uid, mname FROM public.mcp_company_members m
      WHERE m.company_id = j.company_id AND lower(m.display_name) = lower(nm) LIMIT 1;
    IF uid IS NULL AND em IS NOT NULL THEN
      SELECT m.user_id, m.display_name INTO uid, mname FROM public.mcp_company_members m JOIN auth.users u ON u.id = m.user_id
        WHERE m.company_id = j.company_id AND lower(u.email) = em LIMIT 1;
    END IF;
    IF uid IS NOT NULL THEN
      -- Member PM: the contact name follows the member; email defaults to their sign-in email.
      UPDATE public.mcp_jobs SET pm_user_id = uid, pm_name = mname,
        pm_email = coalesce(em, (SELECT lower(email) FROM auth.users WHERE id = uid)), pm_title = coalesce(ti, pm_title, 'Project Manager'), updated_at = now() WHERE id = _job;
      PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_set', uid::text);
    ELSE
      -- Contact PM: name + email only. Grants nothing (no member row, no job access).
      UPDATE public.mcp_jobs SET pm_user_id = NULL, pm_name = nm, pm_email = em, pm_title = coalesce(ti, 'Project Manager'), updated_at = now() WHERE id = _job;
      PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_contact_set', NULL);
    END IF;
  ELSIF em IS NOT NULL OR ti IS NOT NULL THEN
    UPDATE public.mcp_jobs SET pm_email = coalesce(em, pm_email), pm_title = coalesce(ti, pm_title), updated_at = now() WHERE id = _job;
    PERFORM public.mcp_audit_job(_job, 'intake', 'job_pm_contact_set', NULL);
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN jsonb_build_object('time_zone', j.time_zone,
    'pm', coalesce((SELECT display_name FROM public.mcp_company_members WHERE company_id = j.company_id AND user_id = j.pm_user_id), j.pm_name),
    'pm_email', j.pm_email, 'pm_title', j.pm_title, 'pm_is_member', j.pm_user_id IS NOT NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_job_settings(uuid, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_job_settings(uuid, text, text, text, text) TO authenticated;

-- Open item create. Body identical to 0018 except the contact-PM fallback for the default accountable person.
CREATE OR REPLACE FUNCTION public.mcp_open_item_create(_job uuid, _f jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE j public.mcp_jobs; la uuid; acc text; nb date; iid uuid; d_owner boolean := false; d_nb boolean := false; ck text := nullif(_f->>'check_key', '');
  t text; rec text; why text; help text; cs text; child jsonb; c public.mcp_checklist_items;
BEGIN
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF ck IS NOT NULL THEN
    SELECT id, item_type INTO iid, t FROM public.mcp_open_items WHERE job_id = _job AND check_key = ck AND status = 'open' LIMIT 1;
    IF iid IS NOT NULL THEN RETURN jsonb_build_object('item_id', iid, 'existing', true, 'item_type', t); END IF;
  END IF;
  t := coalesce(nullif(_f->>'item_type', ''), CASE coalesce(_f->>'kind', 'general') WHEN 'confirm_unknown' THEN 'unknown' WHEN 'gap' THEN 'no' ELSE 'deadline' END);
  IF t NOT IN ('unknown','no','na_disposition','pending_document','deadline') THEN RAISE EXCEPTION 'MCP_BAD:Unknown item_type.'; END IF;
  IF t = 'pending_document' AND (nullif(btrim(_f->>'waiting_on_document'), '') IS NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:A pending_document item needs waiting_on_document (the named document).';
  END IF;
  rec := nullif(_f->>'recommendation', ''); why := nullif(_f->>'why', ''); help := nullif(_f->>'help_offer', '');
  IF t = 'no' THEN
    IF rec IS NULL AND ck LIKE 'setup:%' THEN
      SELECT * INTO c FROM public.mcp_checklist_items WHERE key = substr(ck, 7) AND version = coalesce((_f->>'check_version')::int, 1);
      rec := c.no_recommendation;
    END IF;
    why := coalesce(why, 'Answered no on a best-practice check for this job.');
    help := coalesce(help, 'Athena can help you close this gap — ask it to draft the next step.');
  END IF;
  cs := nullif(_f->>'clause_source', '');
  IF t = 'deadline' AND cs IS NULL THEN cs := coalesce(_f->>'source', 'member_answer') || ' (due date set by member)'; END IF;
  SELECT id INTO la FROM public.mcp_lookaheads WHERE job_id = _job AND inputs->>'kind' = 'setup' ORDER BY created_at LIMIT 1;
  IF la IS NULL THEN
    INSERT INTO public.mcp_lookaheads (user_id, job_id, inputs) VALUES (auth.uid(), _job, '{"kind":"setup"}'::jsonb) RETURNING id INTO la;
  END IF;
  acc := nullif(btrim(_f->>'accountable'), '');
  IF acc IS NULL OR lower(acc) = 'unknown' THEN
    -- 0016/0018: default to the job's PM; with no PM set, 'Unassigned (no PM set)'.
    SELECT m.display_name || ' (PM)' INTO acc FROM public.mcp_company_members m WHERE m.company_id = j.company_id AND m.user_id = j.pm_user_id;
    -- 0018: with no PM on the job the item is unassigned; it no longer falls back to the caller.
    -- 0019: a PM recorded as a contact (not an Athena member) is still the default accountable person.
    IF acc IS NULL AND nullif(btrim(j.pm_name), '') IS NOT NULL THEN acc := btrim(j.pm_name) || ' (PM)'; END IF;
    IF acc IS NULL THEN acc := 'Unassigned (no PM set)'; END IF;
    d_owner := true;
  END IF;
  nb := nullif(_f->>'needed_by', '')::date;
  IF nb IS NULL THEN nb := current_date + 7; d_nb := true; END IF;
  INSERT INTO public.mcp_open_items (user_id, job_id, lookahead_id, origin_lookahead_id, check_key, check_version, trade, category, severity,
    action, detail, owner, due_date, company_id, job_number, source, accountable, needed_by, verify_state, reported_by, reported_at,
    kind, commercial_type, section, internal_only, cost_effect, time_effect, cash_effect, effect_is_estimate, next_action, next_action_approved_by,
    item_type, recommendation, why, help_offer, waiting_on_document, waiting_on_who, waiting_since, clause_source, delivery_method, recipient, parent_item_id)
  VALUES (auth.uid(), _job, la, la, coalesce(ck, 'manual:' || gen_random_uuid()), coalesce((_f->>'check_version')::int, 1),
    coalesce(_f->>'trade', 'general'), coalesce(_f->>'category', 'general'), coalesce(_f->>'severity', 'medium'),
    j.job_number || ' – ' || left(coalesce(_f->>'action', 'Open item'), 480), left(_f->>'detail', 10000), acc, nb, j.company_id, j.job_number,
    coalesce(_f->>'source', 'member_answer'), acc, nb, 'last_reported', acc, now(),
    coalesce(_f->>'kind', 'general'), _f->>'commercial_type', _f->>'section', coalesce((_f->>'internal_only')::boolean, false),
    coalesce(_f->>'cost_effect', 'unknown'), coalesce(_f->>'time_effect', 'unknown'), coalesce(_f->>'cash_effect', 'unknown'),
    coalesce((_f->>'effect_is_estimate')::boolean, true), _f->>'next_action', _f->>'next_action_approved_by',
    t, rec, why, help, nullif(_f->>'waiting_on_document', ''), nullif(_f->>'waiting_on_who', ''), nullif(_f->>'waiting_since', '')::date,
    cs, nullif(_f->>'delivery_method', ''), nullif(_f->>'recipient', ''), nullif(_f->>'parent_item_id', '')::uuid)
  RETURNING id INTO iid;
  INSERT INTO public.mcp_item_events (user_id, item_id, event, lookahead_id) VALUES (auth.uid(), iid, 'opened', la);
  PERFORM public.mcp_audit(j.company_id, j.job_number, coalesce(_f->>'tool', 'agent'), 'item_open', iid::text);
  IF t = 'deadline' AND coalesce((_f->>'clause_based')::boolean, false)
     AND (nullif(_f->>'delivery_method', '') IS NULL OR nullif(_f->>'recipient', '') IS NULL) THEN
    child := public.mcp_open_item_create(_job, jsonb_build_object(
      'check_key', 'delivery:' || iid, 'item_type', 'unknown', 'kind', 'confirm_unknown', 'section', _f->>'section',
      'category', coalesce(_f->>'category', 'Deadline'), 'tool', coalesce(_f->>'tool', 'agent'), 'parent_item_id', iid::text,
      'internal_only', coalesce((_f->>'internal_only')::boolean, false), 'accountable', acc, 'needed_by', least(nb, current_date + 2),
      'action', 'Confirm ' || concat_ws(' and ',
        CASE WHEN nullif(_f->>'delivery_method', '') IS NULL THEN 'delivery method' END,
        CASE WHEN nullif(_f->>'recipient', '') IS NULL THEN 'recipient' END) || ' for: ' || left(coalesce(_f->>'action', 'deadline'), 300)));
  END IF;
  RETURN jsonb_build_object('item_id', iid, 'existing', false, 'item_type', t, 'owner_defaulted', d_owner, 'needed_by_defaulted', d_nb,
    'accountable', acc, 'needed_by', nb, 'delivery_item', child);
END $function$;

-- Delay events
CREATE TABLE IF NOT EXISTS public.mcp_delay_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  description text NOT NULL,
  activity text,
  start_date date,
  start_known boolean NOT NULL DEFAULT false,
  days int,
  cause text,
  notice_item_id uuid,
  claim_item_id uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mcp_delay_events TO authenticated;
GRANT ALL ON public.mcp_delay_events TO service_role;
ALTER TABLE public.mcp_delay_events ENABLE ROW LEVEL SECURITY;
-- Schedule facts, no money: anyone who can view the job (incl. an assigned Super) can read. Writes only via the RPC.
CREATE POLICY "delay events read by job view" ON public.mcp_delay_events FOR SELECT TO authenticated USING (public.mcp_can_view_job(job_id));

-- _notice / _claim: {label, clause_ref, due, recipient, delivery_method} or null when the contract clause isn't recorded.
CREATE OR REPLACE FUNCTION public.mcp_delay_event_add(_job uuid, _d jsonb, _notice jsonb, _claim jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; eid uuid; known boolean := nullif(_d->>'start_date', '') IS NOT NULL; ni jsonb; ci jsonb; descr text := left(btrim(coalesce(_d->>'description', '')), 500);
  pre text;
BEGIN
  IF public.mcp_assert_job_scope(_job) <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t record delays.'; END IF;
  IF descr = '' THEN RAISE EXCEPTION 'MCP_BAD:delay_event needs a description.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  INSERT INTO public.mcp_delay_events (job_id, company_id, description, activity, start_date, start_known, days, cause)
  VALUES (_job, j.company_id, descr, nullif(left(_d->>'activity', 200), ''), nullif(_d->>'start_date', '')::date, known,
    nullif(_d->>'days', '')::int, nullif(left(_d->>'cause', 500), ''))
  RETURNING id INTO eid;
  pre := CASE WHEN known THEN '' ELSE 'Confirm start date — ' END;
  ni := public.mcp_open_item_create(_job, jsonb_build_object(
    'check_key', 'delay_notice:' || eid, 'item_type', CASE WHEN _notice IS NULL THEN 'unknown' ELSE 'deadline' END,
    'kind', CASE WHEN _notice IS NULL THEN 'confirm_unknown' ELSE 'general' END, 'section', 'contract_time', 'category', 'Delay notice',
    'action', pre || CASE WHEN _notice IS NULL THEN 'Delay notice requirement not recorded; confirm the contract notice clause and send notice for: '
      ELSE 'Send written delay notice' || coalesce(' (' || nullif(_notice->>'clause_ref', '') || ')', '') || ' for: ' END || descr,
    'detail', CASE WHEN known THEN NULL ELSE 'Delay start date unknown, so the contract due date can''t be computed. Flagged due today; confirm the start date.' END,
    'needed_by', CASE WHEN known AND _notice IS NOT NULL THEN nullif(_notice->>'due', '') ELSE current_date::text END,
    'clause_source', CASE WHEN _notice IS NULL THEN NULL ELSE concat_ws(' ', _notice->>'clause_ref', '(contract)') END,
    'recipient', _notice->>'recipient', 'delivery_method', _notice->>'delivery_method', 'tool', 'intake', 'source', 'member_answer'));
  ci := public.mcp_open_item_create(_job, jsonb_build_object(
    'check_key', 'delay_claim:' || eid, 'item_type', CASE WHEN _claim IS NULL THEN 'unknown' ELSE 'deadline' END,
    'kind', CASE WHEN _claim IS NULL THEN 'confirm_unknown' ELSE 'commercial' END, 'commercial_type', 'claim', 'section', 'contract_time', 'category', 'Delay claim',
    'action', pre || CASE WHEN _claim IS NULL THEN 'Claim notice requirement not recorded; confirm the contract claim clause for: '
      ELSE 'Submit claim notice' || coalesce(' (' || nullif(_claim->>'clause_ref', '') || ')', '') || ' for: ' END || descr,
    'detail', CASE WHEN known THEN NULL ELSE 'Delay start date unknown, so the contract due date can''t be computed. Flagged due today; confirm the start date.' END,
    'needed_by', CASE WHEN known AND _claim IS NOT NULL THEN nullif(_claim->>'due', '') ELSE current_date::text END,
    'clause_source', CASE WHEN _claim IS NULL THEN NULL ELSE concat_ws(' ', _claim->>'clause_ref', '(contract)') END,
    'recipient', _claim->>'recipient', 'delivery_method', _claim->>'delivery_method', 'tool', 'intake', 'source', 'member_answer',
    'parent_item_id', ni->>'item_id'));
  UPDATE public.mcp_delay_events SET notice_item_id = (ni->>'item_id')::uuid, claim_item_id = (ci->>'item_id')::uuid WHERE id = eid;
  PERFORM public.mcp_audit_job(_job, 'intake', 'delay_event_add', eid::text);
  RETURN jsonb_build_object('delay_event_id', eid, 'start_known', known, 'notice_item', ni, 'claim_item', ci);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_delay_event_add(uuid, jsonb, jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_delay_event_add(uuid, jsonb, jsonb, jsonb) TO authenticated;

-- Guardrail: a Super never reads job facts (budget, SOV, contract money), whatever other policy exists.
CREATE POLICY "no facts for super view" ON public.mcp_job_facts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.mcp_is_super_view(job_id));
CREATE POLICY "no flags for super view" ON public.mcp_job_flags AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.mcp_is_super_view(job_id));
