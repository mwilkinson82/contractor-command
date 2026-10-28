-- Synthetic read-only contract fixture from PR351 local f3f02445; no production migration or write handlers.

CREATE TABLE public.mcp_cost_submissions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  anchor_job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  kind text NOT NULL CHECK (kind IN ('supplier_bill','company_paid_expense','reimbursable_expense')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_cost_submissions ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_submissions FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_submission_versions (
  record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id),
  version integer NOT NULL CHECK (version > 0),
  facts jsonb NOT NULL,
  reason text,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(record_id,version)
);

ALTER TABLE public.mcp_cost_submission_versions ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_submission_versions FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_approvals (
 record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), version integer NOT NULL,
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id,version),
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_submission_versions(record_id,version)
);

ALTER TABLE public.mcp_cost_approvals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_approvals FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_posting_events (
 record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), version integer NOT NULL,
 posted_by uuid NOT NULL, posted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id,version),
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_approvals(record_id,version)
);

ALTER TABLE public.mcp_cost_posting_events ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_posting_events FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_payment_evidence (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), amount_cents bigint NOT NULL CHECK(amount_cents>0),
 paid_on date NOT NULL, reference text NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_cost_payment_evidence ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_payment_evidence FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_shared_payments (
 id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.mcp_companies(id), amount_cents bigint NOT NULL CHECK(amount_cents>0), paid_on date NOT NULL,
 reference text NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_cost_shared_payments ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_shared_payments FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_shared_allocations (
 payment_id uuid NOT NULL REFERENCES public.mcp_cost_shared_payments(id), record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), amount_cents bigint NOT NULL CHECK(amount_cents>0),
 PRIMARY KEY(payment_id,record_id)
);

ALTER TABLE public.mcp_cost_shared_allocations ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_shared_allocations FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_payment_corrections (
 id uuid PRIMARY KEY, payment_id uuid REFERENCES public.mcp_cost_payment_evidence(id), shared_payment_id uuid REFERENCES public.mcp_cost_shared_payments(id),
 reason text NOT NULL, corrected_by uuid NOT NULL, corrected_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((payment_id IS NULL) <> (shared_payment_id IS NULL)), UNIQUE(payment_id), UNIQUE(shared_payment_id)
);

ALTER TABLE public.mcp_cost_payment_corrections ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_payment_corrections FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_business_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL, version integer NOT NULL, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 allocated_cents bigint NOT NULL CHECK(allocated_cents>0), bill_total_cents bigint NOT NULL CHECK(bill_total_cents>0),
 basis text NOT NULL CHECK(basis IN ('work_verified','delivery_needed','advance','deposit','owner_exception')),
 notes text, approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_submission_versions(record_id,version)
);

ALTER TABLE public.mcp_cost_business_approvals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_business_approvals FROM PUBLIC,anon,authenticated;

CREATE TABLE public.mcp_cost_business_withdrawals (
 approval_id uuid PRIMARY KEY REFERENCES public.mcp_cost_business_approvals(id), reason text NOT NULL,
 withdrawn_by uuid NOT NULL, withdrawn_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_cost_business_withdrawals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.mcp_cost_business_withdrawals FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.mcp_company_members m WHERE m.company_id=_company AND m.user_id=auth.uid() AND m.role IN ('owner','ap') AND public.mcp_role_allowed(m.company_id,m.role)) $$;

REVOKE ALL ON FUNCTION public.mcp_cost_accounting_authorized(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_cost_active_paid(_record uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT sum(e.amount_cents) FROM public.mcp_cost_payment_evidence e WHERE e.record_id=_record AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id)),0)
  + coalesce((SELECT sum(a.amount_cents) FROM public.mcp_cost_shared_allocations a WHERE a.record_id=_record AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=a.payment_id)),0)
$$;

REVOKE ALL ON FUNCTION public.mcp_cost_active_paid(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mcp_cost_submission_read(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; company uuid;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'versions',
   (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_cost_submission_versions v WHERE v.record_id=r.id),
   'approved_versions',(SELECT coalesce(jsonb_agg(a.version ORDER BY a.version),'[]'::jsonb) FROM public.mcp_cost_approvals a WHERE a.record_id=r.id),
   'posted_version',(SELECT max(p.version) FROM public.mcp_cost_posting_events p WHERE p.record_id=r.id),
   'business_approvals',(SELECT coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('withdrawn',EXISTS(SELECT 1 FROM public.mcp_cost_business_withdrawals w WHERE w.approval_id=b.id)) ORDER BY b.version,b.job_id,b.approved_at),'[]'::jsonb) FROM public.mcp_cost_business_approvals b WHERE b.record_id=r.id),
   'payments',(SELECT coalesce(jsonb_agg(q.entry ORDER BY q.recorded_at),'[]'::jsonb) FROM (
      SELECT e.recorded_at,to_jsonb(e)||jsonb_build_object('corrected',EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id),'correction',(SELECT jsonb_build_object('reason',c.reason,'corrected_by',c.corrected_by,'corrected_at',c.corrected_at) FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id),'shared',false) entry FROM public.mcp_cost_payment_evidence e WHERE e.record_id=r.id
      UNION ALL SELECT p.recorded_at,jsonb_build_object('id',p.id,'record_id',a.record_id,'amount_cents',a.amount_cents,'paid_on',p.paid_on,'reference',p.reference,'recorded_by',p.recorded_by,'recorded_at',p.recorded_at,'shared',true,'corrected',EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=p.id),'correction',(SELECT jsonb_build_object('reason',c.reason,'corrected_by',c.corrected_by,'corrected_at',c.corrected_at) FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=p.id)) FROM public.mcp_cost_shared_allocations a JOIN public.mcp_cost_shared_payments p ON p.id=a.payment_id WHERE a.record_id=r.id) q),
   'active_settlement_cents',public.mcp_cost_active_paid(r.id)) ORDER BY r.created_at DESC),'[]'::jsonb)
 INTO result FROM public.mcp_cost_submissions r
 WHERE (r.anchor_job_id=_job OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') a WHERE v.record_id=r.id AND (a->>'job_id')::uuid=_job))
 AND public.mcp_job_scope(r.anchor_job_id)='full'
 AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') a WHERE v.record_id=r.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full');
 RETURN jsonb_build_object('records',result,'originals_available',false,'posting_available',public.mcp_cost_accounting_authorized(company));
END $$;

REVOKE ALL ON FUNCTION public.mcp_cost_submission_read(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.mcp_cost_submission_read(uuid) TO authenticated;
