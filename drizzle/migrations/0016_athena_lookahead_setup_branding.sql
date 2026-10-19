-- 0016: Athena job-setup additions. Additive except where noted. NOT applied to live; Marshall signs off first.
-- Look-ahead question wording: APPROVED by Marshall 2026-10-19 10:49 AM (Manaus).

-- 1) Look-ahead: retire the six PLACEHOLDER questions (kept for history, inactive) and add production questions.
UPDATE public.mcp_checklist_items
   SET active = false, superseded_at = now(), superseded_reason = 'Replaced by production look-ahead questions (0016)'
 WHERE module = 'lookahead' AND is_placeholder AND key LIKE 'placeholder\_%' AND active;

INSERT INTO public.mcp_checklist_items (key, version, category, trade, prompt, rule_type, required_inputs, severity, position, is_placeholder, module, section, applies_when, record_ref) VALUES
 ('la_resources', 1, 'Manpower', 'general', 'For every activity in this two-week window, is the labor committed (our own forces and each subcontractor) at the manpower the schedule needs?', 'confirm', ARRAY['crews','lookahead_dates'], 'high', 10, false, 'lookahead', NULL, '{}', NULL),
 ('la_submittals', 1, 'Submittals', 'general', 'Which submittals still need approval before work in this window can start? List each one with its status and who has it, or say none.', 'list', ARRAY['submittal_log'], 'high', 20, false, 'lookahead', NULL, '{}', NULL),
 ('la_rfis', 1, 'RFIs', 'general', 'Which open RFIs are holding up work in this window? List each one with the date it was sent and who owes the answer, or say none.', 'list', ARRAY['rfi_log'], 'high', 30, false, 'lookahead', NULL, '{}', NULL),
 ('la_inspections', 1, 'Inspections', 'general', 'Are all inspections and approvals needed in this window scheduled with the inspector, owner or engineer?', 'confirm', ARRAY['inspection_list'], 'medium', 40, false, 'lookahead', NULL, '{}', NULL),
 ('la_deliveries', 1, 'Deliveries', 'general', 'Is every material and equipment delivery needed in this window confirmed by the supplier with a delivery date?', 'confirm', ARRAY['deliveries'], 'medium', 50, false, 'lookahead', NULL, '{}', NULL),
 ('la_sequence', 1, 'Schedule logic', 'general', 'Is any activity in this window planned to start before the work it depends on is finished? List each one, or say none.', 'list', ARRAY['schedule_export'], 'high', 60, false, 'lookahead', NULL, '{}', NULL)
ON CONFLICT DO NOTHING;

-- 2) Job setup: two-week look-ahead check. A "no" is not accepted by the answer tool (it offers to build one
--    from the schedule); only an explicit decline records "no", which opens a gap item with this recommendation.
INSERT INTO public.mcp_checklist_items (key, version, category, trade, prompt, rule_type, required_inputs, severity, position, is_placeholder, module, section, applies_when, record_ref, display_label, no_recommendation) VALUES
 ('bss_lookahead', 1, 'Schedule', 'general', 'A two-week look-ahead is in place for this job and updated every week (N/A if work has not started).', 'confirm', '{}', 'high', 45, false, 'job_setup', 'budget_sov_schedule', '{}', NULL, 'Two-week look-ahead', 'Build a two-week look-ahead from the schedule and update it every week. Athena can build it with you from the schedule.')
ON CONFLICT DO NOTHING;

-- 3) mcp_open_item_create. Body is identical to 0009 (verified against the live definition on 2026-10-19) except:
--    a) the default help text on "no" items names Athena;
--    b) an item with no accountable person defaults to the job's PM, else the caller with their role (was: caller's bare name).
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
    -- 0016: default to the job's PM; with no PM set, to the caller labeled with their role.
    SELECT m.display_name || ' (PM)' INTO acc FROM public.mcp_company_members m WHERE m.company_id = j.company_id AND m.user_id = j.pm_user_id;
    IF acc IS NULL THEN
      SELECT m.display_name || ' (' || CASE m.role WHEN 'pm' THEN 'PM' WHEN 'all_access' THEN 'All-access' ELSE initcap(m.role) END || ')' INTO acc
        FROM public.mcp_company_members m WHERE m.company_id = j.company_id AND m.user_id = auth.uid();
    END IF;
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

-- 3b) Billing forecast (asked only when the job is NOT cost-loaded): v2 recommendation no longer tells the member to
--     cost-load the schedule they already said no to. wording approved by Marshall 2026-10-19. v1 stays for history.
INSERT INTO public.mcp_checklist_items (key, version, category, trade, prompt, rule_type, required_inputs, severity, position, is_placeholder, module, section, applies_when, record_ref, display_label, no_recommendation)
SELECT 'bss_billing_forecast', coalesce(max(version), 0) + 1, 'Budget, SOV, schedule', 'general', 'A monthly billing forecast is built from the budget, SOV and schedule.', 'confirm', '{}', 'high', 44, false, 'job_setup', 'budget_sov_schedule',
       '{"flag":"cost_loaded","in":["no"]}', NULL, 'D12', 'Build a monthly billing forecast from the budget, SOV and schedule: spread each SOV line over the months the schedule says that work happens. I can help you build it. Why: a monthly billing forecast tells you whether you''re hitting your revenue target, shows you how to make it up if delays hit, and helps you sequence the work to capture revenue. Without it, you find out you''re behind on billing after the month is gone.'
  FROM public.mcp_checklist_items WHERE key = 'bss_billing_forecast';
UPDATE public.mcp_checklist_items SET superseded_at = now(), superseded_reason = 'v2: recommendation respects cost_loaded = no (0016)'
 WHERE key = 'bss_billing_forecast' AND version < (SELECT max(version) FROM public.mcp_checklist_items WHERE key = 'bss_billing_forecast') AND superseded_at IS NULL;

-- 4) Branding: new companies default to "Athena PM" (product line: "Athena powered by ALP, construction agents";
--    later agents follow the same pattern: "Athena Estimating", "Athena Accounts Payable").
ALTER TABLE public.mcp_companies ALTER COLUMN agent_name SET DEFAULT 'Athena PM';

-- 5) DATA CHANGE (flagged for Marshall): companies still on the old default label move to the new one.
--    Only rows exactly equal to the old default; a custom name is never touched.
UPDATE public.mcp_companies SET agent_name = 'Athena PM' WHERE agent_name = 'PM agent';

-- 6) Open items still carrying the old default help line get the new one (exact match only).
UPDATE public.mcp_open_items SET help_offer = 'Athena can help you close this gap — ask it to draft the next step.'
 WHERE help_offer = 'The PM agent can help you close this gap — ask it to draft the next step.';
