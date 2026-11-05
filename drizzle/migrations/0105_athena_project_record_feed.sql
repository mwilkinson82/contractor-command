-- Project record page: one time-stamped feed of everything logged on a job, for disputes.
-- Read-only. It adds no table and changes no existing function. It reads the append-only
-- project record (mcp_project_record_events) plus the other places Athena already time-stamps
-- work: daily reports, schedule versions, lookaheads and confirmations, delay events, estimate
-- gaps and answers, pay applications and their emails, recorded and online payments, contracts,
-- drawing sets and closed open items. Each source is read in its own block, so a source that is
-- missing on this database is listed in unavailable_sources instead of failing the page.
-- Full job access only (PM and owner roles). Dates are read in the job's time zone.

CREATE OR REPLACE FUNCTION public.mcp_record_ev(
  _src text, _id uuid, _at timestamptz, _happened date, _type text, _kind text,
  _title text, _summary text, _by text, _by_role text, _by_group text,
  _to text, _how text, _ref_table text, _ref_id uuid
) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', _src || ':' || _id::text,
    'source', _src,
    'at', _at,
    'happened_on', _happened,
    'type', _type,
    'kind', _kind,
    'title', left(coalesce(nullif(btrim(_title), ''), 'Recorded'), 300),
    'summary', nullif(left(btrim(coalesce(_summary, '')), 1200), ''),
    'by', coalesce(nullif(btrim(_by), ''), 'Not recorded'),
    'by_role', nullif(btrim(coalesce(_by_role, '')), ''),
    'by_group', coalesce(_by_group, 'team'),
    'to', nullif(btrim(coalesce(_to, '')), ''),
    'how', nullif(btrim(coalesce(_how, '')), ''),
    'ref_table', _ref_table,
    'ref_id', _ref_id
  ))
$$;
REVOKE ALL ON FUNCTION public.mcp_record_ev(text, uuid, timestamptz, date, text, text, text, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_record_who(_company uuid, _user uuid, _job uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN _user IS NULL THEN NULL ELSE coalesce(
    (SELECT nullif(btrim(m.display_name), '') FROM public.mcp_company_members m
      WHERE m.company_id = _company AND m.user_id = _user LIMIT 1),
    (SELECT nullif(btrim(j.pm_name), '') FROM public.mcp_jobs j
      WHERE j.id = _job AND j.pm_user_id = _user LIMIT 1),
    'A team member') END
$$;
REVOKE ALL ON FUNCTION public.mcp_record_who(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_record_role(_company uuid, _user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN _user IS NULL THEN NULL ELSE
    (SELECT initcap(replace(nullif(btrim(m.role), ''), '_', ' ')) FROM public.mcp_company_members m
      WHERE m.company_id = _company AND m.user_id = _user LIMIT 1) END
$$;
REVOKE ALL ON FUNCTION public.mcp_record_role(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_project_record_feed(_job uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  j public.mcp_jobs; sc text; co text; tz text; lo timestamptz; hi timestamptz;
  ev jsonb := '[]'::jsonb; part jsonb; missing text[] := ARRAY[]::text[];
  total integer; rows jsonb; cap integer := 5000;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:The project record needs full access to the job. Ask the PM or the company owner.'; END IF;
  IF _from IS NOT NULL AND _to IS NOT NULL AND _from > _to THEN RAISE EXCEPTION 'MCP_BAD:Choose a start date on or before the end date.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT name INTO co FROM public.mcp_companies WHERE id = j.company_id;
  tz := coalesce(nullif(btrim(j.time_zone), ''), 'America/New_York');
  BEGIN
    lo := CASE WHEN _from IS NULL THEN '-infinity'::timestamptz ELSE (_from::timestamp AT TIME ZONE tz) END;
  EXCEPTION WHEN invalid_parameter_value THEN
    tz := 'America/New_York';
    lo := CASE WHEN _from IS NULL THEN '-infinity'::timestamptz ELSE (_from::timestamp AT TIME ZONE tz) END;
  END;
  hi := CASE WHEN _to IS NULL THEN 'infinity'::timestamptz ELSE ((_to + 1)::timestamp AT TIME ZONE tz) END;

  -- 1. The append-only project record: submittals, RFIs and RFCs, change orders, client-page
  --    decisions and the claims, inspection and decision logs.
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev(
      'record', e.id, e.occurred_at, NULL,
      CASE
        WHEN e.kind LIKE 'rfi%' OR e.kind LIKE 'rfc%' OR e.title ~* '^(rfi|rfc)\M' THEN 'rfi'
        WHEN e.kind LIKE 'change_order%' OR e.title ~* '^(pco|co|change order)\M' THEN 'change'
        WHEN e.kind LIKE 'pay_application%' THEN 'billing'
        WHEN e.kind LIKE 'job_log_claims%' THEN 'notice'
        WHEN e.kind LIKE 'job_log%' THEN 'log'
        WHEN e.kind LIKE 'submittal%' OR e.kind LIKE 'transmittal%' THEN 'submittal'
        ELSE 'other' END,
      e.kind, e.title, e.summary,
      CASE WHEN e.actor = 'athena' THEN 'Athena'
           WHEN e.actor_id IS NOT NULL THEN public.mcp_record_who(j.company_id, e.actor_id, _job)
           ELSE coalesce(e.counterparty_name, 'Client') END,
      CASE WHEN e.actor = 'athena' THEN NULL
           WHEN e.actor_id IS NOT NULL THEN public.mcp_record_role(j.company_id, e.actor_id)
           ELSE 'Client page' END,
      CASE WHEN e.actor = 'athena' THEN 'athena' WHEN e.actor_id IS NOT NULL THEN 'team' ELSE 'client' END,
      CASE WHEN e.actor = 'athena' OR e.actor_id IS NOT NULL THEN e.counterparty_name END,
      CASE WHEN e.kind LIKE '%customer%' OR (e.actor <> 'athena' AND e.actor_id IS NULL) THEN 'Client page'
           WHEN e.kind LIKE '%_sent' THEN 'Email' END,
      e.ref_table, e.ref_id)), '[]'::jsonb) INTO part
    FROM public.mcp_project_record_events e
    WHERE e.job_id = _job AND e.occurred_at >= lo AND e.occurred_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'project record'::text;
  END;

  -- 2. Daily reports. Saving again replaces the report, so an edit shows as its own entry.
  BEGIN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO part FROM (
      SELECT public.mcp_record_ev('daily', d.id, d.created_at,
        CASE WHEN d.report_date < (d.created_at AT TIME ZONE tz)::date THEN d.report_date END,
        'daily', 'daily_report_saved',
        'Daily report saved for ' || to_char(d.report_date, 'Mon FMDD, YYYY'),
        concat_ws(' ', nullif('Crew: ' || left(btrim(coalesce(d.manpower, '')), 300), 'Crew: '),
                       nullif('Delays: ' || left(btrim(coalesce(d.delays, '')), 200), 'Delays: ')),
        public.mcp_record_who(j.company_id, d.created_by, _job), public.mcp_record_role(j.company_id, d.created_by),
        CASE WHEN d.created_by IS NULL THEN 'athena' ELSE 'team' END, NULL, NULL, 'mcp_daily_reports', d.id) AS x
      FROM public.mcp_daily_reports d
      WHERE d.job_id = _job AND d.created_at >= lo AND d.created_at < hi
      UNION ALL
      SELECT public.mcp_record_ev('daily_edit', d.id, d.updated_at, d.report_date, 'daily', 'daily_report_edited',
        'Daily report for ' || to_char(d.report_date, 'Mon FMDD, YYYY') || ' edited',
        'The saved report was changed after it was first saved. Athena keeps the latest version.',
        'Not recorded', NULL, 'team', NULL, NULL, 'mcp_daily_reports', d.id)
      FROM public.mcp_daily_reports d
      WHERE d.job_id = _job AND d.updated_at > d.created_at + interval '2 minutes'
        AND d.updated_at >= lo AND d.updated_at < hi
    ) s;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'daily reports'::text;
  END;

  -- 3. CPM schedule versions (version 1 is the first saved schedule).
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('schedule', r.id, r.created_at, NULL, 'schedule', 'schedule_saved',
      CASE WHEN r.version = 1 THEN 'Schedule saved (version 1)' ELSE 'Schedule update saved (version ' || r.version || ')' END,
      concat_ws('. ',
        CASE WHEN r.data_date IS NOT NULL THEN 'Data date ' || to_char(r.data_date, 'Mon FMDD, YYYY') END,
        CASE WHEN r.activity_count IS NOT NULL THEN r.activity_count || ' activities' END,
        nullif(btrim(r.change_what), ''), nullif(btrim(coalesce(r.change_why, '')), '')),
      coalesce(nullif(btrim(r.updated_by_name), ''), public.mcp_record_who(j.company_id, r.updated_by, _job)),
      public.mcp_record_role(j.company_id, r.updated_by), 'team', NULL, NULL, 'mcp_living_reports', r.id)), '[]'::jsonb) INTO part
    FROM public.mcp_living_reports r
    WHERE r.job_id = _job AND r.report_type = 'cpm' AND r.created_at >= lo AND r.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'schedule'::text;
  END;

  -- 4. Two-week lookaheads and their revisions.
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('lookahead', r.id, r.created_at, NULL, 'schedule', 'lookahead_revision',
      CASE WHEN r.rev <= 1 THEN 'Two-week lookahead made' ELSE 'Two-week lookahead revised (revision ' || r.rev || ')' END,
      CASE WHEN r.start_date IS NOT NULL THEN to_char(r.start_date, 'Mon FMDD') || ' to ' || to_char(coalesce(r.end_date, r.start_date), 'Mon FMDD, YYYY') END,
      public.mcp_record_who(j.company_id, r.user_id, _job), public.mcp_record_role(j.company_id, r.user_id),
      'team', NULL, NULL, 'mcp_lookaheads', l.id)), '[]'::jsonb) INTO part
    FROM public.mcp_lookahead_revisions r JOIN public.mcp_lookaheads l ON l.id = r.lookahead_id
    WHERE l.job_id = _job AND r.created_at >= lo AND r.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'lookaheads'::text;
  END;

  -- 5. Lookahead confirmations asked of subs and suppliers, and their answers.
  BEGIN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO part FROM (
      SELECT public.mcp_record_ev('confirm_ask', c.id, c.created_at, NULL, 'schedule', 'lookahead_confirm_asked',
        'Confirmation asked of ' || coalesce(nullif(btrim(c.party_name), ''), 'a sub or supplier'),
        concat_ws('. ', nullif(btrim(c.what), ''), CASE WHEN c.window_end IS NOT NULL THEN 'Answer by ' || to_char(c.window_end, 'Mon FMDD, YYYY') END),
        public.mcp_record_who(j.company_id, c.created_by, _job), public.mcp_record_role(j.company_id, c.created_by), 'team',
        c.party_name, CASE WHEN c.email_status IS NOT NULL THEN 'Email, ' || replace(c.email_status, '_', ' ') END, 'mcp_lookahead_confirms', c.id) AS x
      FROM public.mcp_lookahead_confirms c
      WHERE c.job_id = _job AND c.created_at >= lo AND c.created_at < hi
      UNION ALL
      SELECT public.mcp_record_ev('confirm_answer', c.id, c.responded_at, NULL, 'schedule', 'lookahead_confirm_answered',
        coalesce(nullif(btrim(c.party_name), ''), 'Sub or supplier') || ' answered: ' || replace(coalesce(c.status, 'answered'), '_', ' '),
        concat_ws('. ', nullif(btrim(c.what), ''), nullif(btrim(coalesce(c.response_note, '')), '')),
        coalesce(nullif(btrim(c.responder_name), ''), c.party_name), c.party_name, 'sub',
        NULL, 'Confirmation link', 'mcp_lookahead_confirms', c.id)
      FROM public.mcp_lookahead_confirms c
      WHERE c.job_id = _job AND c.responded_at IS NOT NULL AND c.responded_at >= lo AND c.responded_at < hi
    ) s;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'lookahead confirmations'::text;
  END;

  -- 6. Delay events (time entitlement).
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('delay', d.id, d.created_at,
      CASE WHEN coalesce(d.start_known, false) THEN d.start_date END, 'notice', 'delay_event',
      'Delay logged: ' || left(coalesce(nullif(btrim(d.activity), ''), d.description, 'delay'), 120),
      concat_ws('. ', nullif(btrim(d.description), ''),
        CASE WHEN d.days IS NOT NULL THEN d.days || ' day' || CASE WHEN d.days = 1 THEN '' ELSE 's' END END,
        CASE WHEN nullif(btrim(coalesce(d.cause, '')), '') IS NOT NULL THEN 'Cause: ' || d.cause END,
        CASE WHEN d.start_date IS NOT NULL AND coalesce(d.start_known, false) THEN 'Started ' || to_char(d.start_date, 'Mon FMDD, YYYY') END),
      public.mcp_record_who(j.company_id, d.created_by, _job), public.mcp_record_role(j.company_id, d.created_by),
      'team', NULL, NULL, 'mcp_delay_events', d.id)), '[]'::jsonb) INTO part
    FROM public.mcp_delay_events d
    WHERE d.job_id = _job AND d.created_at >= lo AND d.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'delay events'::text;
  END;

  -- 7. Estimate gap analysis: what Athena presented, and the estimator's answers.
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('gap', g.id, g.created_at, NULL, 'estimate', 'estimate_gap_found',
      'Gap found: ' || left(coalesce(nullif(btrim(g.title), ''), g.ref), 200),
      concat_ws(' ', nullif(btrim(coalesce(g.question, '')), ''),
        CASE WHEN nullif(btrim(coalesce(g.spec_section, '')), '') IS NOT NULL THEN 'Spec ' || g.spec_section || '.' END,
        CASE WHEN nullif(btrim(coalesce(g.sheet, '')), '') IS NOT NULL THEN 'Sheet ' || g.sheet || '.' END),
      'Athena', NULL, 'athena', NULL, 'Estimate gap check', 'mcp_estimate_gap_items', g.id)), '[]'::jsonb) INTO part
    FROM public.mcp_estimate_gap_items g
    WHERE g.job_id = _job AND g.created_at >= lo AND g.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'estimate gaps'::text;
  END;
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('gap_answer', v.id, v.created_at, NULL, 'estimate', 'estimate_item_marked',
      'Estimate answer: ' || replace(coalesce(nullif(btrim(v.mark), ''), 'marked'), '_', ' ') || ' on ' || left(coalesce(nullif(btrim(v.item_text), ''), 'an item'), 160),
      concat_ws('. ', nullif(btrim(coalesce(v.note, '')), ''),
        CASE WHEN v.corrected_qty IS NOT NULL THEN 'Corrected quantity ' || v.corrected_qty END,
        CASE WHEN nullif(btrim(coalesce(v.owner, '')), '') IS NOT NULL THEN 'Owner: ' || v.owner END),
      public.mcp_record_who(j.company_id, v.marked_by, _job), public.mcp_record_role(j.company_id, v.marked_by),
      'team', NULL, NULL, 'mcp_estimate_verdicts', v.id)), '[]'::jsonb) INTO part
    FROM public.mcp_estimate_verdicts v
    WHERE v.job_id = _job AND v.created_at >= lo AND v.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'estimate answers'::text;
  END;

  -- 8. Pay applications saved, and pay-application emails sent.
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('payapp', a.id, v.recorded_at, NULL, 'billing', 'pay_application_saved',
      'Pay application ' || coalesce(nullif(btrim(a.number), '') || ' ', '') || 'saved (version ' || v.version || ')',
      NULL, public.mcp_record_who(j.company_id, v.recorded_by, _job), public.mcp_record_role(j.company_id, v.recorded_by),
      'team', NULL, NULL, 'mcp_payment_applications', a.id)), '[]'::jsonb) INTO part
    FROM public.mcp_payment_application_versions v JOIN public.mcp_payment_applications a ON a.id = v.application_id
    WHERE v.job_id = _job AND v.recorded_at >= lo AND v.recorded_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'pay applications'::text;
  END;
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('payapp_email', m.id, m.updated_at, NULL, 'billing', 'pay_application_emailed',
      'Pay application ' || coalesce(nullif(btrim(a.number), '') || ' ', '') || 'emailed (version ' || m.application_version || ')',
      NULL, public.mcp_record_who(j.company_id, m.actor_id, _job), public.mcp_record_role(j.company_id, m.actor_id),
      'team', coalesce(m.payload #>> '{email,to}', m.payload ->> 'to'), 'Email', 'mcp_payment_applications', a.id)), '[]'::jsonb) INTO part
    FROM public.mcp_document_email_deliveries m LEFT JOIN public.mcp_payment_applications a ON a.id = m.application_id
    WHERE m.job_id = _job AND m.state = 'host_reported_provider_acceptance' AND m.updated_at >= lo AND m.updated_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'pay application emails'::text;
  END;

  -- 9. Payments: recorded checks and wires (and voids), and client payments made online.
  BEGIN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO part FROM (
      SELECT public.mcp_record_ev('payment', p.id, p.recorded_at,
        CASE WHEN p.received_on < (p.recorded_at AT TIME ZONE tz)::date THEN p.received_on END, 'billing', 'payment_recorded',
        'Payment recorded: $' || to_char(p.amount_cents / 100.0, 'FM999,999,999,990.00') || ' by ' || replace(coalesce(p.method, 'payment'), '_', ' '),
        concat_ws('. ', CASE WHEN p.received_on IS NOT NULL THEN 'Received ' || to_char(p.received_on, 'Mon FMDD, YYYY') END,
          nullif(btrim(coalesce(p.reference, '')), ''), nullif(btrim(coalesce(p.note, '')), '')),
        public.mcp_record_who(j.company_id, p.recorded_by, _job), public.mcp_record_role(j.company_id, p.recorded_by),
        'team', NULL, NULL, 'mcp_recorded_payments', p.id) AS x
      FROM public.mcp_recorded_payments p
      WHERE p.job_id = _job AND p.recorded_at >= lo AND p.recorded_at < hi
      UNION ALL
      SELECT public.mcp_record_ev('payment_void', p.id, p.voided_at, NULL, 'billing', 'payment_voided',
        'Payment record voided: $' || to_char(p.amount_cents / 100.0, 'FM999,999,999,990.00'),
        nullif(btrim(coalesce(p.void_reason, '')), ''),
        public.mcp_record_who(j.company_id, p.voided_by, _job), public.mcp_record_role(j.company_id, p.voided_by),
        'team', NULL, NULL, 'mcp_recorded_payments', p.id)
      FROM public.mcp_recorded_payments p
      WHERE p.job_id = _job AND p.voided_at IS NOT NULL AND p.voided_at >= lo AND p.voided_at < hi
    ) s;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'recorded payments'::text;
  END;
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('portal_payment', p.id, p.paid_at, NULL, 'billing', 'client_paid_online',
      'Client paid online: $' || to_char(p.amount_cents / 100.0, 'FM999,999,999,990.00'),
      CASE WHEN p.method IS NOT NULL THEN 'Paid by ' || replace(p.method, '_', ' ') END,
      'Client', 'Client page', 'client', NULL, 'Client page', 'mcp_portal_payments', p.id)), '[]'::jsonb) INTO part
    FROM public.mcp_portal_payments p
    WHERE p.job_id = _job AND p.paid_at IS NOT NULL AND p.paid_at >= lo AND p.paid_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'online payments'::text;
  END;

  -- 10. Contracts and drawing sets saved.
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('contract', c.id, v.recorded_at, NULL, 'contract', 'contract_saved',
      'Contract saved: ' || left(coalesce(nullif(btrim(c.title), ''), nullif(btrim(c.counterparty), ''), 'contract'), 160) || ' (version ' || v.version || ')',
      concat_ws('. ', nullif(btrim(coalesce(v.reason, '')), ''),
        CASE WHEN c.signed_on IS NOT NULL THEN 'Signed ' || to_char(c.signed_on, 'Mon FMDD, YYYY') END),
      public.mcp_record_who(j.company_id, v.recorded_by, _job), public.mcp_record_role(j.company_id, v.recorded_by),
      'team', c.counterparty, NULL, 'mcp_job_contracts', c.id)), '[]'::jsonb) INTO part
    FROM public.mcp_job_contract_versions v JOIN public.mcp_job_contracts c ON c.id = v.contract_id
    WHERE c.job_id = _job AND v.recorded_at >= lo AND v.recorded_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'contracts'::text;
  END;
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('drawings', d.id, d.created_at, NULL, 'contract', 'drawings_saved',
      'Drawings saved: ' || left(coalesce(nullif(btrim(d.filename), ''), 'drawing set'), 160) || ' (version ' || d.version || ')',
      CASE WHEN d.page_count IS NOT NULL THEN d.page_count || ' pages' END,
      public.mcp_record_who(j.company_id, d.created_by, _job), public.mcp_record_role(j.company_id, d.created_by),
      'team', NULL, NULL, 'mcp_drawing_versions', d.id)), '[]'::jsonb) INTO part
    FROM public.mcp_drawing_versions d
    WHERE d.job_id = _job AND d.kind = 'source' AND d.created_at >= lo AND d.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'drawings'::text;
  END;

  -- 11. Open items closed or reopened.
  BEGIN
    SELECT coalesce(jsonb_agg(public.mcp_record_ev('item', e.id, e.created_at, NULL, 'items', 'open_item_' || e.event,
      CASE WHEN e.event = 'resolved' THEN 'Open item closed: ' ELSE 'Open item reopened: ' END || left(coalesce(nullif(btrim(i.action), ''), 'item'), 200),
      coalesce(nullif(btrim(coalesce(e.note, '')), ''), nullif(btrim(coalesce(i.resolution, '')), '')),
      public.mcp_record_who(j.company_id, e.user_id, _job), public.mcp_record_role(j.company_id, e.user_id),
      'team', NULL, NULL, 'mcp_open_items', i.id)), '[]'::jsonb) INTO part
    FROM public.mcp_item_events e JOIN public.mcp_open_items i ON i.id = e.item_id
    WHERE i.job_id = _job AND e.event IN ('resolved', 'reopened') AND e.created_at >= lo AND e.created_at < hi;
    ev := ev || part;
  EXCEPTION WHEN undefined_table OR undefined_column OR undefined_function THEN missing := missing || 'open items'::text;
  END;

  total := jsonb_array_length(ev);
  SELECT coalesce(jsonb_agg(e ORDER BY (e ->> 'at')::timestamptz DESC, e ->> 'id' DESC), '[]'::jsonb) INTO rows
  FROM (
    SELECT e FROM jsonb_array_elements(ev) e
    WHERE e ? 'at'
    ORDER BY (e ->> 'at')::timestamptz DESC, e ->> 'id' DESC
    LIMIT cap
  ) s;

  RETURN jsonb_build_object(
    'job_id', _job, 'job_number', j.job_number, 'job_name', j.name, 'company', co,
    'time_zone', tz, 'from', _from, 'to', _to, 'captured_at', now(),
    'count', total, 'truncated', total > cap, 'events', rows,
    'unavailable_sources', to_jsonb(missing));
END $$;
REVOKE ALL ON FUNCTION public.mcp_project_record_feed(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_project_record_feed(uuid, date, date) TO authenticated;
COMMENT ON FUNCTION public.mcp_project_record_feed(uuid, date, date) IS 'Read-only project record feed for the job board page and its PDF and Excel export. Full job access only.';
