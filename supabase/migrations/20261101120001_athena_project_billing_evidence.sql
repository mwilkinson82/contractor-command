-- Staged project billing evidence. Apply only through the managed release lane.
-- Amounts are source-entered USD cents; no production or forecast values are posted here.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.mcp_billing_invoices (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL,
 document_number text NOT NULL CHECK (length(btrim(document_number)) BETWEEN 1 AND 120),
 kind text NOT NULL CHECK (kind IN ('invoice','pay_application','credit')),
 credit_for uuid REFERENCES public.mcp_billing_invoices(id),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 UNIQUE(job_id, document_number),
 CHECK ((kind = 'credit') = (credit_for IS NOT NULL))
);
CREATE UNIQUE INDEX mcp_billing_invoice_source_number_idx ON public.mcp_billing_invoices(job_id, lower(btrim(document_number)));
CREATE TABLE public.mcp_billing_invoice_versions (
 invoice_id uuid NOT NULL REFERENCES public.mcp_billing_invoices(id), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 version integer NOT NULL CHECK (version > 0), status text NOT NULL CHECK (status IN ('draft','submitted','certified','void')),
 invoice_date date NOT NULL, period_start date, period_end date, effective_date date NOT NULL,
 source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 2000),
 gross_cents bigint NOT NULL CHECK (gross_cents >= 0), withheld_cents bigint NOT NULL CHECK (withheld_cents >= 0),
 released_cents bigint NOT NULL CHECK (released_cents >= 0), net_due_cents bigint NOT NULL CHECK (net_due_cents >= 0),
 certified_cents bigint CHECK (certified_cents >= 0), certified_date date, reason text,
 recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by uuid NOT NULL,
 PRIMARY KEY(invoice_id,version), CHECK(period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
 CHECK ((certified_cents IS NULL) = (certified_date IS NULL)),
 CHECK (status <> 'certified' OR certified_cents IS NOT NULL)
);
CREATE INDEX mcp_billing_invoice_versions_job_idx ON public.mcp_billing_invoice_versions(job_id, invoice_id, version DESC);
CREATE TABLE public.mcp_billing_receipts (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL,
 receipt_date date NOT NULL, source text NOT NULL CHECK(length(btrim(source)) BETWEEN 1 AND 2000),
 amount_cents bigint NOT NULL CHECK(amount_cents > 0), recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by uuid NOT NULL
);
CREATE INDEX mcp_billing_receipts_job_idx ON public.mcp_billing_receipts(job_id, receipt_date DESC);
CREATE UNIQUE INDEX mcp_billing_receipt_source_idx ON public.mcp_billing_receipts(job_id, lower(btrim(source)));
CREATE TABLE public.mcp_billing_allocations (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), receipt_id uuid NOT NULL REFERENCES public.mcp_billing_receipts(id),
 invoice_id uuid NOT NULL REFERENCES public.mcp_billing_invoices(id), amount_cents bigint NOT NULL CHECK(amount_cents > 0),
 reversal_of uuid REFERENCES public.mcp_billing_allocations(id),
 effective_date date NOT NULL, source text NOT NULL CHECK(length(btrim(source)) BETWEEN 1 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by uuid NOT NULL
);
CREATE INDEX mcp_billing_allocations_receipt_idx ON public.mcp_billing_allocations(receipt_id);
CREATE INDEX mcp_billing_allocations_invoice_idx ON public.mcp_billing_allocations(invoice_id);
CREATE TABLE public.mcp_billing_operations (
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), request_id uuid NOT NULL, actor_id uuid NOT NULL,
 signature text NOT NULL, result jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,request_id)
);

ALTER TABLE public.mcp_billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_billing_invoice_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_billing_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_billing_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_billing_operations ENABLE ROW LEVEL SECURITY;
-- All reads and writes go through the gated functions below. No direct client privileges.
REVOKE ALL ON public.mcp_billing_invoices, public.mcp_billing_invoice_versions, public.mcp_billing_receipts, public.mcp_billing_allocations, public.mcp_billing_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_billing_invoices, public.mcp_billing_invoice_versions, public.mcp_billing_receipts, public.mcp_billing_allocations, public.mcp_billing_operations TO service_role;

CREATE FUNCTION public.mcp_billing_evidence_get(_job uuid) RETURNS jsonb
-- The active-member gate can write its cache/sync; PostgREST must use a writable transaction.
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE invoices jsonb; receipts jsonb; allocations jsonb;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object('versions',
   (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_billing_invoice_versions v WHERE v.invoice_id=i.id)) ORDER BY i.created_at DESC),'[]'::jsonb)
 INTO invoices FROM public.mcp_billing_invoices i WHERE i.job_id=_job;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.receipt_date DESC, r.recorded_at DESC),'[]'::jsonb)
 INTO receipts FROM public.mcp_billing_receipts r WHERE r.job_id=_job;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.recorded_at),'[]'::jsonb)
 INTO allocations FROM public.mcp_billing_allocations a WHERE a.job_id=_job;
 RETURN jsonb_build_object('invoices',invoices,'receipts',receipts,'allocations',allocations,'currency','USD');
END $$;
REVOKE ALL ON FUNCTION public.mcp_billing_evidence_get(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_evidence_get(uuid) TO authenticated;

CREATE FUNCTION public.mcp_billing_evidence_record(_job uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; op public.mcp_billing_operations; inv public.mcp_billing_invoices; prev public.mcp_billing_invoice_versions;
 rid uuid; ident uuid; ref uuid; v integer; sig text; result jsonb; a numeric; used numeric; due numeric; status text;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
 IF coalesce(_action,'') NOT IN ('invoice','receipt','allocation','reverse_allocation') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>20000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid billing record.'; END IF;
 rid:=nullif(_p->>'request_id','')::uuid;
 IF rid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:An operation ID is required.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 sig:=md5(jsonb_build_object('action',_action,'payload',_p)::text);
 SELECT * INTO op FROM public.mcp_billing_operations WHERE job_id=_job AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Operation ID belongs to different content.'; END IF;
   RETURN op.result || jsonb_build_object('already_applied',true);
 END IF;
 IF length(btrim(coalesce(_p->>'source',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Record the source of this evidence.'; END IF;
 ident:=nullif(_p->>'id','')::uuid;
 IF ident IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A record ID is required.'; END IF;
 IF _action='invoice' THEN
   SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id=ident AND job_id=_job;
   v:=coalesce(nullif(_p->>'expected_version','')::integer,-1);
   IF inv.id IS NULL THEN
     IF v<>0 THEN RAISE EXCEPTION 'MCP_BAD:Invoice version changed.'; END IF;
     IF coalesce(_p->>'kind','') NOT IN ('invoice','pay_application','credit') OR length(btrim(coalesce(_p->>'document_number',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Provide the document type and number.'; END IF;
     ref:=nullif(_p->>'credit_for','')::uuid;
     IF _p->>'kind'='credit' THEN
       IF NOT EXISTS(SELECT 1 FROM public.mcp_billing_invoices WHERE id=ref AND job_id=_job AND kind<>'credit') THEN RAISE EXCEPTION 'MCP_BAD:Choose the invoice this credit references.'; END IF;
     ELSIF ref IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Only a credit references an invoice.'; END IF;
     INSERT INTO public.mcp_billing_invoices(id,job_id,company_id,document_number,kind,credit_for,created_by)
     VALUES(ident,_job,j.company_id,btrim(_p->>'document_number'),_p->>'kind',ref,auth.uid());
   ELSE
     SELECT * INTO prev FROM public.mcp_billing_invoice_versions WHERE invoice_id=ident ORDER BY version DESC LIMIT 1;
     IF v<>prev.version THEN RAISE EXCEPTION 'MCP_BAD:Invoice version changed.'; END IF;
     IF prev.status='void' THEN RAISE EXCEPTION 'MCP_BAD:Void records cannot be revised.'; END IF;
     IF length(btrim(coalesce(_p->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Explain this revision.'; END IF;
   END IF;
   status:=_p->>'status';
   IF coalesce(status,'') NOT IN ('draft','submitted','certified','void') OR (prev.status IN ('submitted','certified') AND status='draft') OR (prev.status='certified' AND status='submitted') OR (v=0 AND status IN ('certified','void')) OR (status='certified' AND prev.status NOT IN ('submitted','certified')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid invoice status transition.'; END IF;
   IF status IN ('draft','submitted') AND (nullif(_p->>'certified_cents','') IS NOT NULL OR nullif(_p->>'certified_date','') IS NOT NULL) THEN RAISE EXCEPTION 'MCP_BAD:Certification requires certified status.'; END IF;
   IF status='void' AND coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id=ident),0)>0 THEN RAISE EXCEPTION 'MCP_BAD:This invoice has allocated cash; resolve the allocation before voiding.'; END IF;
   FOREACH status IN ARRAY ARRAY['gross_cents','withheld_cents','released_cents','net_due_cents'] LOOP
     IF jsonb_typeof(_p->status) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Amounts must be integer USD cents.'; END IF;
     a:=(_p->>status)::numeric;
     IF a<>trunc(a) OR a<0 OR a>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Amounts must be nonnegative integer USD cents.'; END IF;
   END LOOP;
   IF _p ? 'certified_cents' AND _p->'certified_cents'<>'null'::jsonb THEN
     IF jsonb_typeof(_p->'certified_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Certification must use integer cents.'; END IF;
     a:=(_p->>'certified_cents')::numeric;
     IF a<>trunc(a) OR a<0 OR a>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Certification must use nonnegative integer cents.'; END IF;
   END IF;
   used:=coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id=ident),0);
   IF (_p->>'net_due_cents')::numeric<used THEN RAISE EXCEPTION 'MCP_BAD:Net due cannot be less than allocated cash.'; END IF;
   INSERT INTO public.mcp_billing_invoice_versions(invoice_id,job_id,version,status,invoice_date,period_start,period_end,effective_date,source,gross_cents,withheld_cents,released_cents,net_due_cents,certified_cents,certified_date,reason,recorded_by)
   VALUES(ident,_job,v+1,_p->>'status',(_p->>'invoice_date')::date,nullif(_p->>'period_start','')::date,nullif(_p->>'period_end','')::date,(_p->>'effective_date')::date,btrim(_p->>'source'),(_p->>'gross_cents')::bigint,(_p->>'withheld_cents')::bigint,(_p->>'released_cents')::bigint,(_p->>'net_due_cents')::bigint,nullif(_p->>'certified_cents','')::bigint,nullif(_p->>'certified_date','')::date,nullif(btrim(coalesce(_p->>'reason','')),''),auth.uid());
   result:=jsonb_build_object('id',ident,'version',v+1);
 ELSIF _action='receipt' THEN
   IF jsonb_typeof(_p->'amount_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Receipt must use integer USD cents.'; END IF;
   a:=(_p->>'amount_cents')::numeric;
   IF a<>trunc(a) OR a<=0 OR a>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Receipt must use positive integer USD cents.'; END IF;
   INSERT INTO public.mcp_billing_receipts(id,job_id,company_id,receipt_date,source,amount_cents,recorded_by) VALUES(ident,_job,j.company_id,(_p->>'receipt_date')::date,btrim(_p->>'source'),a::bigint,auth.uid());
   result:=jsonb_build_object('id',ident);
 ELSIF _action='allocation' THEN
   ref:=nullif(_p->>'receipt_id','')::uuid;
   IF jsonb_typeof(_p->'amount_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Allocation must use integer USD cents.'; END IF;
   a:=(_p->>'amount_cents')::numeric;
   IF a<>trunc(a) OR a<=0 OR a>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Allocation must use positive integer USD cents.'; END IF;
   SELECT amount_cents INTO due FROM public.mcp_billing_receipts WHERE id=ref AND job_id=_job;
   IF due IS NULL OR due<coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE receipt_id=ref),0)+a THEN RAISE EXCEPTION 'MCP_BAD:Receipt unavailable or allocation exceeds unapplied cash.'; END IF;
   SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id=nullif(_p->>'invoice_id','')::uuid AND job_id=_job;
   SELECT * INTO prev FROM public.mcp_billing_invoice_versions WHERE invoice_id=inv.id ORDER BY version DESC LIMIT 1;
   IF inv.id IS NULL OR inv.kind='credit' OR prev.status NOT IN ('submitted','certified') OR prev.net_due_cents<coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id=inv.id),0)+a THEN RAISE EXCEPTION 'MCP_BAD:Invoice unavailable or allocation exceeds its recorded net due.'; END IF;
   INSERT INTO public.mcp_billing_allocations(id,job_id,receipt_id,invoice_id,amount_cents,effective_date,source,recorded_by) VALUES(ident,_job,ref,inv.id,a::bigint,(_p->>'effective_date')::date,btrim(_p->>'source'),auth.uid());
   result:=jsonb_build_object('id',ident);
 ELSE
   ref:=nullif(_p->>'allocation_id','')::uuid;
   IF jsonb_typeof(_p->'amount_cents') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Reversal must use integer USD cents.'; END IF;
   a:=(_p->>'amount_cents')::numeric;
   IF a<>trunc(a) OR a<=0 OR a>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Reversal must use positive integer USD cents.'; END IF;
   SELECT amount_cents - coalesce((SELECT sum(r.amount_cents) FROM public.mcp_billing_allocations r WHERE r.reversal_of=orig.id),0) INTO due FROM public.mcp_billing_allocations orig WHERE orig.id=ref AND orig.job_id=_job AND orig.reversal_of IS NULL;
   IF due IS NULL OR a>due THEN RAISE EXCEPTION 'MCP_BAD:Allocation unavailable or reversal exceeds its remaining amount.'; END IF;
   INSERT INTO public.mcp_billing_allocations(id,job_id,receipt_id,invoice_id,amount_cents,reversal_of,effective_date,source,recorded_by) SELECT ident,_job,receipt_id,invoice_id,a::bigint,ref,(_p->>'effective_date')::date,btrim(_p->>'source'),auth.uid() FROM public.mcp_billing_allocations WHERE id=ref AND job_id=_job;
   result:=jsonb_build_object('id',ident);
 END IF;
 INSERT INTO public.mcp_billing_operations(job_id,request_id,actor_id,signature,result) VALUES(_job,rid,auth.uid(),sig,result);
 RETURN result || jsonb_build_object('already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_billing_evidence_record(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_evidence_record(uuid,text,jsonb) TO authenticated;
COMMIT;
