-- Athena accounting: AR aging, payment-due reminders and collection follow-ups (D11 addendum, standing AR behavior).
-- Additive only: three new tables and four functions. NOT APPLIED. Apply only after Marshall's yes (after the p1 and p2 files).
-- Receivables come from saved pay apps (logged as sent when submitted) and invoices logged here. Amounts in integer cents.

CREATE TABLE IF NOT EXISTS public.mcp_ar_settings (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  customer text,
  reminder_offsets integer[] NOT NULL DEFAULT ARRAY[7, 1],
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mcp_ar_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  received bigint NOT NULL DEFAULT 0 CHECK (received >= 0),
  sent_on date NOT NULL,
  approved_on date,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, invoice_no)
);
CREATE TABLE IF NOT EXISTS public.mcp_ar_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  ref text NOT NULL,
  step integer NOT NULL CHECK (step IN (1, 30, 60, 90)),
  outcome text NOT NULL CHECK (outcome IN ('offered', 'drafted', 'declined')),
  by_user uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_ar_followups_job_idx ON public.mcp_ar_followups (job_id, ref, step);

ALTER TABLE public.mcp_ar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_ar_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_ar_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ar settings read full scope" ON public.mcp_ar_settings;
CREATE POLICY "ar settings read full scope" ON public.mcp_ar_settings FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "ar invoices read full scope" ON public.mcp_ar_invoices;
CREATE POLICY "ar invoices read full scope" ON public.mcp_ar_invoices FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "ar followups read full scope" ON public.mcp_ar_followups;
CREATE POLICY "ar followups read full scope" ON public.mcp_ar_followups FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
GRANT SELECT ON public.mcp_ar_settings, public.mcp_ar_invoices, public.mcp_ar_followups TO authenticated;
GRANT ALL ON public.mcp_ar_settings, public.mcp_ar_invoices, public.mcp_ar_followups TO service_role;

-- Open receivables on every job in the company where the caller has full job access (AP, owner, all-access: all jobs;
-- PM: their own jobs; supers: none). Pay apps count once submitted.
CREATE OR REPLACE FUNCTION public.mcp_ar_items(_company uuid, _job_number text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  RETURN coalesce((
    SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('job_number', j.job_number, 'job_name', j.name, 'customer', s.customer, 'reminder_offsets', s.reminder_offsets,
        'terms', (SELECT to_jsonb(t) - 'id' - 'job_id' FROM public.mcp_payment_term_rules t WHERE t.job_id = j.id ORDER BY t.version DESC LIMIT 1),
        'kind', 'pay_app', 'ref', 'App ' || lpad(p.app_no::text, 2, '0'), 'app_no', p.app_no, 'period_to', p.period_to, 'sent_on', p.submitted_on,
        'submitted_on', p.submitted_on, 'approved_on', p.approved_on, 'gc_paid_on', p.gc_paid_on,
        'amount', coalesce((p.certified->>'total_due')::bigint, (p.g702->>'l8')::bigint),
        'received', coalesce((SELECT sum(amount) FROM public.mcp_payments m WHERE m.pay_app_id = p.id), 0),
        'offered_step', (SELECT max(step) FROM public.mcp_ar_followups f WHERE f.job_id = j.id AND f.ref = 'App ' || lpad(p.app_no::text, 2, '0'))) AS x
      FROM public.mcp_jobs j JOIN public.mcp_pay_apps p ON p.job_id = j.id LEFT JOIN public.mcp_ar_settings s ON s.job_id = j.id
      WHERE j.company_id = _company AND (_job_number IS NULL OR j.job_number = _job_number) AND p.submitted_on IS NOT NULL
        AND coalesce(public.mcp_job_scope(j.id) = 'full', false)
      UNION ALL
      SELECT jsonb_build_object('job_number', j.job_number, 'job_name', j.name, 'customer', s.customer, 'reminder_offsets', s.reminder_offsets,
        'terms', (SELECT to_jsonb(t) - 'id' - 'job_id' FROM public.mcp_payment_term_rules t WHERE t.job_id = j.id ORDER BY t.version DESC LIMIT 1),
        'kind', 'invoice', 'ref', i.invoice_no, 'app_no', NULL, 'period_to', NULL, 'sent_on', i.sent_on,
        'submitted_on', i.sent_on, 'approved_on', i.approved_on, 'gc_paid_on', NULL, 'amount', i.amount, 'received', i.received,
        'offered_step', (SELECT max(step) FROM public.mcp_ar_followups f WHERE f.job_id = j.id AND f.ref = i.invoice_no))
      FROM public.mcp_jobs j JOIN public.mcp_ar_invoices i ON i.job_id = j.id LEFT JOIN public.mcp_ar_settings s ON s.job_id = j.id
      WHERE j.company_id = _company AND (_job_number IS NULL OR j.job_number = _job_number) AND coalesce(public.mcp_job_scope(j.id) = 'full', false)
    ) q), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_ar_settings_save(_job uuid, _customer text, _offsets integer[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  INSERT INTO public.mcp_ar_settings (job_id, customer, reminder_offsets) VALUES (_job, nullif(btrim(coalesce(_customer, '')), ''), coalesce(_offsets, ARRAY[7, 1]))
  ON CONFLICT (job_id) DO UPDATE SET customer = coalesce(nullif(btrim(coalesce(_customer, '')), ''), mcp_ar_settings.customer),
    reminder_offsets = coalesce(_offsets, mcp_ar_settings.reminder_offsets), updated_by = auth.uid(), updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.mcp_ar_invoice_save(_job uuid, _invoice_no text, _amount bigint, _sent_on date, _approved_on date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job. Your role can''t save it.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_ar_invoices WHERE job_id = _job AND invoice_no = btrim(_invoice_no)) THEN RAISE EXCEPTION 'MCP_BAD:Invoice % is already logged on this job.', _invoice_no; END IF;
  INSERT INTO public.mcp_ar_invoices (job_id, invoice_no, amount, sent_on, approved_on) VALUES (_job, btrim(_invoice_no), _amount, _sent_on, _approved_on);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_ar_followup_log(_job uuid, _ref text, _step integer, _outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job) = 'full', false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:This needs full access to the job.'; END IF;
  INSERT INTO public.mcp_ar_followups (job_id, ref, step, outcome) VALUES (_job, btrim(_ref), _step, _outcome);
END $$;

REVOKE EXECUTE ON FUNCTION public.mcp_ar_items(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_ar_settings_save(uuid, text, integer[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_ar_invoice_save(uuid, text, bigint, date, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mcp_ar_followup_log(uuid, text, integer, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_ar_items(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ar_settings_save(uuid, text, integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ar_invoice_save(uuid, text, bigint, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ar_followup_log(uuid, text, integer, text) TO authenticated;
