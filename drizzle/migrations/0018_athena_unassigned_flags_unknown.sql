-- 0018: live retest 2026-10-19 (build 637c36ac).
-- 1) Open items with no accountable person default to the job's PM, else 'Unassigned (no PM set)' (was: the caller).
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


-- 2) A member's explicit "not specified" sets an applicability flag back to unknown, even over an earlier value
--    (mcp_set_flags never lets unknown overwrite a value). Opens the usual confirm item.
CREATE OR REPLACE FUNCTION public.mcp_flags_unknown(_job uuid, _keys text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; done text[] := '{}';
BEGIN
  PERFORM public.mcp_assert_job(_job);
  FOREACH k IN ARRAY coalesce(_keys, '{}') LOOP
    IF k NOT IN ('has_retainage','beneficial_use','has_lds','notice_requirements') THEN CONTINUE; END IF;
    INSERT INTO public.mcp_job_flags (job_id, flag_key, value, source) VALUES (_job, k, 'unknown', 'member_answer')
      ON CONFLICT (job_id, flag_key) DO UPDATE SET value = 'unknown', source = 'member_answer', set_by = auth.uid(), set_at = now();
    PERFORM public.mcp_open_item_create(_job, jsonb_build_object('check_key', 'flag:' || k, 'kind', 'confirm_unknown',
      'category', 'Applicability', 'section', 'applicability', 'source', 'member_answer', 'tool', 'intake',
      'action', 'Confirm whether this applies: ' || replace(k, '_', ' ')));
    done := done || k;
  END LOOP;
  RETURN jsonb_build_object('unknown', to_jsonb(done));
END $$;
REVOKE ALL ON FUNCTION public.mcp_flags_unknown(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_flags_unknown(uuid, text[]) TO authenticated;

-- 3) DATA CHANGE (flagged for Marshall): open items that were defaulted to their creator are re-pointed to the
--    job's PM, or 'Unassigned (no PM set)'. Only rows whose accountable is exactly the creator's name (old default)
--    or name + role (0016 default); anything assigned to someone else is untouched.
UPDATE public.mcp_open_items i
   SET accountable = coalesce((SELECT pm.display_name || ' (PM)' FROM public.mcp_jobs j JOIN public.mcp_company_members pm
                                 ON pm.company_id = j.company_id AND pm.user_id = j.pm_user_id WHERE j.id = i.job_id), 'Unassigned (no PM set)'),
       updated_at = now()
  FROM public.mcp_jobs j2, public.mcp_company_members m
 WHERE i.status = 'open' AND j2.id = i.job_id AND m.company_id = j2.company_id AND m.user_id = i.user_id
   AND (i.accountable = m.display_name OR i.accountable LIKE m.display_name || ' (%)');
