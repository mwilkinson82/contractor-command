-- Athena accounting phase 2: pay applications (AIA G702/G703 format), certifications and payments received.
-- Additive only: three new tables, four functions.
-- NOT APPLIED. Apply only after Marshall's yes (after 20261022000000_athena_accounting_p1.sql).
-- Money is integer cents (bigint). The server checks the five ties before calling save; these functions re-check scope,
-- version and the G702 identities so a stale or hand-built call can't save numbers that don't tie.


CREATE TABLE IF NOT EXISTS public.mcp_pay_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  app_no integer NOT NULL CHECK (app_no >= 1),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  period_from date,
  period_to date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'checked', 'submitted', 'certified', 'paid', 'partly_paid')),
  original_contract bigint NOT NULL,
  net_change_orders bigint NOT NULL DEFAULT 0,
  previous_certificates bigint NOT NULL DEFAULT 0,
  lines jsonb NOT NULL,             -- G703-format lines (C, D, E, F, prev G, prev I, overbill approval), cents
  g702 jsonb NOT NULL,              -- l1..l9, cents
  retainage_rule jsonb NOT NULL,    -- snapshot of the rule the app was checked against
  submitted_on date,
  approved_on date,
  gc_paid_on date,
  certified jsonb,                  -- certified lines (G, I) and total_due, by whom, when
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, app_no),
  CHECK ((g702->>'l3')::bigint = (g702->>'l1')::bigint + (g702->>'l2')::bigint),
  CHECK ((g702->>'l6')::bigint = (g702->>'l4')::bigint - (g702->>'l5')::bigint),
  CHECK ((g702->>'l8')::bigint = (g702->>'l6')::bigint - (g702->>'l7')::bigint),
  CHECK ((g702->>'l5')::bigint = (g702->>'l5a')::bigint + (g702->>'l5b')::bigint)
);
CREATE TABLE IF NOT EXISTS public.mcp_pay_app_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_app_id uuid NOT NULL REFERENCES public.mcp_pay_apps(id) ON DELETE CASCADE,
  certified_by text NOT NULL,
  certified_on date NOT NULL,
  total_due bigint NOT NULL,
  lines jsonb NOT NULL,
  cuts jsonb NOT NULL DEFAULT '[]'::jsonb,
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mcp_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_app_id uuid NOT NULL REFERENCES public.mcp_pay_apps(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  reference text,
  short_pay_reason text,
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_pay_apps_job_idx ON public.mcp_pay_apps (job_id, app_no);
CREATE INDEX IF NOT EXISTS mcp_payments_app_idx ON public.mcp_payments (pay_app_id);

ALTER TABLE public.mcp_pay_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_pay_app_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_payments ENABLE ROW LEVEL SECURITY;
-- Dollars: full job scope only (supers see no dollars). Writes only through the functions below.
DROP POLICY IF EXISTS "pay apps read full scope" ON public.mcp_pay_apps;
CREATE POLICY "pay apps read full scope" ON public.mcp_pay_apps FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "pay app certs read full scope" ON public.mcp_pay_app_certifications;
CREATE POLICY "pay app certs read full scope" ON public.mcp_pay_app_certifications FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_pay_apps p WHERE p.id = pay_app_id AND coalesce(public.mcp_job_scope(p.job_id) = 'full', false)));
DROP POLICY IF EXISTS "payments read full scope" ON public.mcp_payments;
CREATE POLICY "payments read full scope" ON public.mcp_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_pay_apps p WHERE p.id = pay_app_id AND coalesce(public.mcp_job_scope(p.job_id) = 'full', false)));
GRANT SELECT ON public.mcp_pay_apps, public.mcp_pay_app_certifications, public.mcp_payments TO authenticated;
GRANT ALL ON public.mcp_pay_apps, public.mcp_pay_app_certifications, public.mcp_payments TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_payapp_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t see it.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'app_no', p.app_no, 'version', p.version, 'period_from', p.period_from, 'period_to', p.period_to, 'status', p.status,
    'original_contract', p.original_contract, 'net_change_orders', p.net_change_orders, 'previous_certificates', p.previous_certificates,
    'lines', p.lines, 'g702', p.g702, 'submitted_on', p.submitted_on, 'approved_on', p.approved_on, 'gc_paid_on', p.gc_paid_on,
    'certified', p.certified, 'received', coalesce((SELECT sum(amount) FROM public.mcp_payments m WHERE m.pay_app_id = p.id), 0)
  ) ORDER BY p.app_no) FROM public.mcp_pay_apps p WHERE p.job_id = _job), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_payapp_save(_job uuid, _app_no integer, _base_version integer, _row jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur public.mcp_pay_apps; nid uuid; v integer;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':payapp'));
  SELECT * INTO cur FROM public.mcp_pay_apps WHERE job_id = _job AND app_no = _app_no;
  IF coalesce(cur.version, 0) <> coalesce(_base_version, 0) THEN RAISE EXCEPTION 'MCP_BAD:Pay app % moved to v%. Reload first.', _app_no, coalesce(cur.version, 0); END IF;
  IF cur.certified IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Pay app % is already certified and can''t be changed.', _app_no; END IF;
  IF cur.id IS NULL AND _app_no > 1 AND NOT EXISTS (SELECT 1 FROM public.mcp_pay_apps WHERE job_id = _job AND app_no = _app_no - 1) THEN
    RAISE EXCEPTION 'MCP_BAD:Pay app % comes before this one and isn''t saved.', _app_no - 1;
  END IF;
  IF (_row->'g702'->>'l4')::bigint <> (SELECT coalesce(sum((l->>'d')::bigint + (l->>'e')::bigint + (l->>'f')::bigint), 0) FROM jsonb_array_elements(_row->'lines') l) THEN
    RAISE EXCEPTION 'MCP_BAD:Not saved: line 4 doesn''t equal the G703 column G total.';
  END IF;
  IF (SELECT coalesce(sum((l->>'c')::bigint), 0) FROM jsonb_array_elements(_row->'lines') l) <> (_row->'g702'->>'l3')::bigint THEN
    RAISE EXCEPTION 'MCP_BAD:Not saved: the SOV doesn''t equal the contract sum to date.';
  END IF;
  IF cur.id IS NULL THEN
    INSERT INTO public.mcp_pay_apps (job_id, app_no, period_from, period_to, status, original_contract, net_change_orders, previous_certificates, lines, g702, retainage_rule, submitted_on)
    VALUES (_job, _app_no, (_row->>'period_from')::date, (_row->>'period_to')::date, _row->>'status', (_row->>'original_contract')::bigint,
      (_row->>'net_change_orders')::bigint, (_row->>'previous_certificates')::bigint, _row->'lines', _row->'g702', _row->'retainage_rule', (_row->>'submitted_on')::date)
    RETURNING id, version INTO nid, v;
  ELSE
    UPDATE public.mcp_pay_apps SET version = version + 1, period_from = (_row->>'period_from')::date, period_to = (_row->>'period_to')::date,
      status = _row->>'status', original_contract = (_row->>'original_contract')::bigint, net_change_orders = (_row->>'net_change_orders')::bigint,
      previous_certificates = (_row->>'previous_certificates')::bigint, lines = _row->'lines', g702 = _row->'g702', retainage_rule = _row->'retainage_rule',
      submitted_on = coalesce((_row->>'submitted_on')::date, submitted_on), updated_by = auth.uid(), updated_at = now()
    WHERE id = cur.id RETURNING id, version INTO nid, v;
  END IF;
  RETURN jsonb_build_object('id', nid, 'version', v);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_payapp_certify(_job uuid, _app_no integer, _base_version integer, _certified jsonb, _cuts jsonb, _gc_paid_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur public.mcp_pay_apps;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':payapp'));
  SELECT * INTO cur FROM public.mcp_pay_apps WHERE job_id = _job AND app_no = _app_no;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Pay app % isn''t in the pay app log.', _app_no; END IF;
  IF cur.version <> _base_version THEN RAISE EXCEPTION 'MCP_BAD:Pay app % moved to v%. Reload first.', _app_no, cur.version; END IF;
  INSERT INTO public.mcp_pay_app_certifications (pay_app_id, certified_by, certified_on, total_due, lines, cuts)
  VALUES (cur.id, _certified->>'certified_by', (_certified->>'certified_on')::date, (_certified->>'total_due')::bigint, _certified->'lines', coalesce(_cuts, '[]'::jsonb));
  UPDATE public.mcp_pay_apps SET certified = _certified, status = 'certified', approved_on = (_certified->>'certified_on')::date,
    gc_paid_on = coalesce(_gc_paid_on, gc_paid_on), version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = cur.id;
  RETURN jsonb_build_object('version', cur.version + 1);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_payment_record(_job uuid, _app_no integer, _amount bigint, _received_on date, _reference text, _short_pay_reason text, _gc_paid_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cur public.mcp_pay_apps; nid uuid; got bigint;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  SELECT * INTO cur FROM public.mcp_pay_apps WHERE job_id = _job AND app_no = _app_no FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Pay app % isn''t in the pay app log.', _app_no; END IF;
  INSERT INTO public.mcp_payments (pay_app_id, amount, received_on, reference, short_pay_reason) VALUES (cur.id, _amount, _received_on, _reference, nullif(btrim(coalesce(_short_pay_reason, '')), ''))
  RETURNING id INTO nid;
  SELECT sum(amount) INTO got FROM public.mcp_payments WHERE pay_app_id = cur.id;
  UPDATE public.mcp_pay_apps SET gc_paid_on = coalesce(_gc_paid_on, gc_paid_on),
    status = CASE WHEN cur.certified IS NOT NULL AND got >= (cur.certified->>'total_due')::bigint THEN 'paid' ELSE 'partly_paid' END, updated_at = now()
  WHERE id = cur.id;
  RETURN jsonb_build_object('id', nid, 'received', got);
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_payapp_list(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_payapp_save(uuid, integer, integer, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_payapp_certify(uuid, integer, integer, jsonb, jsonb, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_payment_record(uuid, integer, bigint, date, text, text, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_payapp_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_payapp_save(uuid, integer, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_payapp_certify(uuid, integer, integer, jsonb, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_payment_record(uuid, integer, bigint, date, text, text, date) TO authenticated;
