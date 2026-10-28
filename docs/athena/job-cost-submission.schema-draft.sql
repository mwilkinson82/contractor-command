-- STAGED DESIGN ONLY: not a migration. Generate a later migration after coordination.
-- Submit/read only. Approval, posting and payment are deliberately unavailable pending authority policy.
CREATE TABLE public.mcp_cost_submissions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  anchor_job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  kind text NOT NULL CHECK (kind IN ('supplier_bill','company_paid_expense','reimbursable_expense')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_cost_submission_versions (
  record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id),
  version integer NOT NULL CHECK (version > 0),
  facts jsonb NOT NULL,
  reason text,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(record_id,version)
);
CREATE TABLE public.mcp_cost_submission_references (
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  kind text NOT NULL,
  counterparty_key text NOT NULL,
  document_key text NOT NULL,
  record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id),
  PRIMARY KEY(company_id,kind,counterparty_key,document_key)
);
CREATE TABLE public.mcp_cost_submission_operations (
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  signature text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(company_id,request_id)
);
ALTER TABLE public.mcp_cost_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_submission_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_submission_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_submission_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_cost_submissions,public.mcp_cost_submission_versions,public.mcp_cost_submission_references,public.mcp_cost_submission_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_cost_submissions,public.mcp_cost_submission_versions,public.mcp_cost_submission_references,public.mcp_cost_submission_operations TO service_role;

CREATE FUNCTION public.mcp_cost_submission_read(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'status','submitted','versions',
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version DESC) FROM public.mcp_cost_submission_versions v WHERE v.record_id=r.id)) ORDER BY r.created_at DESC),'[]'::jsonb)
  INTO result FROM public.mcp_cost_submissions r
  WHERE (r.anchor_job_id=_job OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') a WHERE v.record_id=r.id AND (a->>'job_id')::uuid=_job))
  AND public.mcp_job_scope(r.anchor_job_id)='full'
  AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') a WHERE v.record_id=r.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full');
  RETURN jsonb_build_object('records',result,'originals_available',false,'posting_available',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_submission_read(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_submission_read(uuid) TO authenticated;

-- Provisional cross-track contract: reject links when supplier tables are absent, and validate exact project/party when present.
CREATE FUNCTION public.mcp_cost_validate_project_refs(_company uuid,_job uuid,_party uuid,_po uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ok boolean;
BEGIN
 IF _party IS NOT NULL THEN
   IF to_regclass('public.mcp_project_parties') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Supplier and PO links are not available yet.'; END IF;
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.mcp_project_parties WHERE id=$1 AND company_id=$2 AND job_id=$3)' INTO ok USING _party,_company,_job;
   IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Party unavailable for this company and job.'; END IF;
 END IF;
 IF _po IS NOT NULL THEN
   IF to_regclass('public.mcp_purchase_orders') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Supplier and PO links are not available yet.'; END IF;
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.mcp_purchase_orders WHERE id=$1 AND company_id=$2 AND job_id=$3 AND ($4::uuid IS NULL OR party_id=$4))' INTO ok USING _po,_company,_job,_party;
   IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Purchase order unavailable for this company, job or party.'; END IF;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_validate_project_refs(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.mcp_cost_submission_save(_job uuid,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; rec public.mcp_cost_submissions; old public.mcp_cost_submission_versions; op public.mcp_cost_submission_operations;
  rid uuid; ident uuid; expected integer; sig text; f jsonb; a jsonb; aid uuid; amount numeric; total numeric:=0; seen text[]:=ARRAY[]::text[]; k text; doc text; party text; result jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>30000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid cost submission.'; END IF;
  rid:=nullif(_p->>'request_id','')::uuid; ident:=nullif(_p->>'id','')::uuid;
  IF rid IS NULL OR ident IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Record and request IDs are required.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
  PERFORM 1 FROM public.mcp_companies WHERE id=j.company_id FOR UPDATE;
  sig:=_p::text;
  SELECT * INTO op FROM public.mcp_cost_submission_operations WHERE company_id=j.company_id AND request_id=rid;
  IF op.request_id IS NOT NULL THEN
    IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Request ID belongs to different content.'; END IF;
    SELECT * INTO rec FROM public.mcp_cost_submissions WHERE mcp_cost_submissions.id=(op.result->>'id')::uuid AND company_id=j.company_id;
    IF rec.id IS NULL OR public.mcp_job_scope(rec.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') x WHERE v.record_id=rec.id AND public.mcp_job_scope((x->>'job_id')::uuid) IS DISTINCT FROM 'full') THEN RAISE EXCEPTION 'MCP_BAD:Record unavailable.'; END IF;
    RETURN op.result || jsonb_build_object('already_applied',true);
  END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' OR (_p->>'expected_version') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'MCP_BAD:Expected version is required.'; END IF;
  expected:=(_p->>'expected_version')::integer; f:=_p->'facts';
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) x WHERE x NOT IN ('kind','description','counterparty_name','incurred_on','amount_cents','allocations','document_reference','original','party_id','purchase_order_id')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid cost facts.'; END IF;
  IF (f ? 'party_id' AND nullif(f->>'party_id','') IS NULL) OR (f ? 'purchase_order_id' AND nullif(f->>'purchase_order_id','') IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:Invalid supplier or PO reference.'; END IF;
  IF coalesce(f->>'kind','') NOT IN ('supplier_bill','company_paid_expense','reimbursable_expense') OR length(btrim(coalesce(f->>'description',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(f->>'counterparty_name',''))) NOT BETWEEN 1 AND 200 OR f->>'original' IS DISTINCT FROM 'missing' THEN RAISE EXCEPTION 'MCP_BAD:Provide the cost type, description, payee and missing original status.'; END IF;
  IF coalesce(f->>'incurred_on','') !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((f->>'incurred_on')::date,'YYYY-MM-DD') <> f->>'incurred_on' THEN RAISE EXCEPTION 'MCP_BAD:Valid date required.'; END IF;
  IF jsonb_typeof(f->'amount_cents') IS DISTINCT FROM 'number' OR (f->>'amount_cents') !~ '^[0-9]{1,13}$' THEN RAISE EXCEPTION 'MCP_BAD:Positive integer cents required.'; END IF;
  amount:=(f->>'amount_cents')::numeric;
  IF amount<=0 OR amount>9000000000000 OR jsonb_typeof(f->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'allocations') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'MCP_BAD:Amount and allocations required.'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(f->'allocations') LOOP
    IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) x WHERE x NOT IN ('job_id','cost_code','amount_cents')) OR length(btrim(coalesce(a->>'cost_code',''))) NOT BETWEEN 1 AND 40 OR jsonb_typeof(a->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(a->>'amount_cents','') !~ '^[0-9]{1,13}$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid allocation.'; END IF;
    aid:=nullif(a->>'job_id','')::uuid;
    IF aid IS NULL OR NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE mcp_jobs.id=aid AND company_id=j.company_id) OR public.mcp_job_scope(aid) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full access to every allocated company job is required.'; END IF;
    IF (a->>'amount_cents')::numeric<=0 THEN RAISE EXCEPTION 'MCP_BAD:Allocation must be positive.'; END IF;
    k:=aid::text || ':' || lower(btrim(a->>'cost_code'));
    IF k=ANY(seen) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate allocation.'; END IF;
    seen:=array_append(seen,k); total:=total+(a->>'amount_cents')::numeric;
  END LOOP;
  IF total<>amount THEN RAISE EXCEPTION 'MCP_BAD:Allocations must equal the cost amount.'; END IF;
  IF f ? 'party_id' OR f ? 'purchase_order_id' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(f->'allocations') x WHERE (x->>'job_id')::uuid<>_job) THEN RAISE EXCEPTION 'MCP_BAD:Project-linked supplier or PO cannot apply to other jobs.'; END IF;
    PERFORM public.mcp_cost_validate_project_refs(j.company_id,_job,nullif(f->>'party_id','')::uuid,nullif(f->>'purchase_order_id','')::uuid);
  END IF;
  SELECT * INTO rec FROM public.mcp_cost_submissions WHERE mcp_cost_submissions.id=ident;
  IF rec.id IS NULL THEN
    IF expected<>0 THEN RAISE EXCEPTION 'MCP_BAD:Cost version changed.'; END IF;
    INSERT INTO public.mcp_cost_submissions(id,company_id,anchor_job_id,kind,created_by) VALUES(ident,j.company_id,_job,f->>'kind',auth.uid());
  ELSE
    IF rec.company_id<>j.company_id OR rec.anchor_job_id<>_job OR public.mcp_job_scope(rec.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') x WHERE v.record_id=rec.id AND public.mcp_job_scope((x->>'job_id')::uuid) IS DISTINCT FROM 'full') THEN RAISE EXCEPTION 'MCP_BAD:Record unavailable.'; END IF;
    SELECT * INTO old FROM public.mcp_cost_submission_versions v WHERE v.record_id=ident ORDER BY version DESC LIMIT 1;
    IF expected<>old.version OR rec.kind<>f->>'kind' THEN RAISE EXCEPTION 'MCP_BAD:Cost version or type changed.'; END IF;
    IF length(btrim(coalesce(_p->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Correction reason required.'; END IF;
  END IF;
  doc:=nullif(lower(btrim(f->>'document_reference')),''); party:=lower(btrim(f->>'counterparty_name'));
  IF f ? 'document_reference' AND (doc IS NULL OR length(doc)>200) THEN RAISE EXCEPTION 'MCP_BAD:Invalid document reference.'; END IF;
  IF doc IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.mcp_cost_submission_references q WHERE q.company_id=j.company_id AND q.kind=f->>'kind' AND q.counterparty_key=party AND q.document_key=doc AND q.record_id<>ident) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate counterparty and document reference.'; END IF;
    INSERT INTO public.mcp_cost_submission_references VALUES(j.company_id,f->>'kind',party,doc,ident) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.mcp_cost_submission_versions(record_id,version,facts,reason,recorded_by) VALUES(ident,expected+1,f,nullif(btrim(coalesce(_p->>'reason','')),''),auth.uid());
  result:=jsonb_build_object('id',ident,'version',expected+1,'status','submitted');
  INSERT INTO public.mcp_cost_submission_operations VALUES(j.company_id,rid,auth.uid(),sig,result);
  RETURN result || jsonb_build_object('already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_submission_save(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_submission_save(uuid,jsonb) TO authenticated;

-- Accounting transitions are staged behind a fail-closed authority hook. No role is granted accounting authority here.
CREATE TABLE public.mcp_cost_approvals (
 record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), version integer NOT NULL,
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id,version),
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_submission_versions(record_id,version)
);
CREATE TABLE public.mcp_cost_posting_events (
 record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), version integer NOT NULL,
 posted_by uuid NOT NULL, posted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id,version),
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_approvals(record_id,version)
);
CREATE TABLE public.mcp_cost_payment_evidence (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), amount_cents bigint NOT NULL CHECK(amount_cents>0),
 paid_on date NOT NULL, reference text NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_cost_payment_record_index ON public.mcp_cost_payment_evidence(record_id);
CREATE TABLE public.mcp_cost_shared_payments (
 id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.mcp_companies(id), amount_cents bigint NOT NULL CHECK(amount_cents>0), paid_on date NOT NULL,
 reference text NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_cost_shared_allocations (
 payment_id uuid NOT NULL REFERENCES public.mcp_cost_shared_payments(id), record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id), amount_cents bigint NOT NULL CHECK(amount_cents>0),
 PRIMARY KEY(payment_id,record_id)
);
CREATE INDEX mcp_cost_shared_allocations_record ON public.mcp_cost_shared_allocations(record_id);
-- These reverse an erroneous ledger entry, not a bank payment or an actual refund.
CREATE TABLE public.mcp_cost_payment_corrections (
 id uuid PRIMARY KEY, payment_id uuid REFERENCES public.mcp_cost_payment_evidence(id), shared_payment_id uuid REFERENCES public.mcp_cost_shared_payments(id),
 reason text NOT NULL, corrected_by uuid NOT NULL, corrected_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((payment_id IS NULL) <> (shared_payment_id IS NULL)), UNIQUE(payment_id), UNIQUE(shared_payment_id)
);
ALTER TABLE public.mcp_cost_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_posting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_payment_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_shared_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_shared_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_payment_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_cost_approvals,public.mcp_cost_posting_events,public.mcp_cost_payment_evidence,public.mcp_cost_shared_payments,public.mcp_cost_shared_allocations,public.mcp_cost_payment_corrections FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_cost_approvals,public.mcp_cost_posting_events,public.mcp_cost_payment_evidence,public.mcp_cost_shared_payments,public.mcp_cost_shared_allocations,public.mcp_cost_payment_corrections TO service_role;
CREATE FUNCTION public.mcp_cost_accounting_authorized(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.mcp_cost_accounting_authorized(uuid) FROM PUBLIC,anon,authenticated;

-- Helpers are only callable from guarded server functions.
CREATE FUNCTION public.mcp_cost_active_paid(_record uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT sum(e.amount_cents) FROM public.mcp_cost_payment_evidence e WHERE e.record_id=_record AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id)),0)
  + coalesce((SELECT sum(a.amount_cents) FROM public.mcp_cost_shared_allocations a WHERE a.record_id=_record AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=a.payment_id)),0)
$$;
REVOKE ALL ON FUNCTION public.mcp_cost_active_paid(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.mcp_cost_reference_in_use(_company uuid,_reference text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence e JOIN public.mcp_cost_submissions r ON r.id=e.record_id WHERE r.company_id=_company AND lower(btrim(e.reference))=lower(btrim(_reference)) AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id))
 OR EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments p WHERE p.company_id=_company AND lower(btrim(p.reference))=lower(btrim(_reference)) AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=p.id))
$$;
REVOKE ALL ON FUNCTION public.mcp_cost_reference_in_use(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.mcp_cost_accounting_action(_job uuid,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; rec public.mcp_cost_submissions; v public.mcp_cost_submission_versions; posted public.mcp_cost_submission_versions;
 op public.mcp_cost_submission_operations; ident uuid; rid uuid; payment_id uuid; ver integer; action text; sig text; result jsonb; paid numeric; amt numeric;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 IF public.mcp_cost_accounting_authorized(j.company_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Accounting approval, posting and settlement are not available.'; END IF;
 IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>10000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('action','id','request_id','expected_version','payment_id','amount_cents','paid_on','reference')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid accounting action.'; END IF;
 ident:=nullif(_p->>'id','')::uuid; rid:=nullif(_p->>'request_id','')::uuid; action:=_p->>'action';
 IF ident IS NULL OR rid IS NULL OR coalesce(action,'') NOT IN ('approve','post','payment') THEN RAISE EXCEPTION 'MCP_BAD:Invalid accounting action.'; END IF;
 PERFORM 1 FROM public.mcp_companies WHERE id=j.company_id FOR UPDATE;
 SELECT * INTO rec FROM public.mcp_cost_submissions WHERE id=ident AND company_id=j.company_id;
 IF rec.id IS NULL OR rec.anchor_job_id<>_job OR public.mcp_job_scope(rec.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a WHERE x.record_id=rec.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full') THEN RAISE EXCEPTION 'MCP_BAD:Record unavailable.'; END IF;
 sig:=_p::text;
 SELECT * INTO op FROM public.mcp_cost_submission_operations WHERE company_id=j.company_id AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Request ID belongs to different content.'; END IF;
   RETURN op.result || jsonb_build_object('already_applied',true);
 END IF;
 IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' OR coalesce(_p->>'expected_version','') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'MCP_BAD:Expected version is required.'; END IF;
 ver:=(_p->>'expected_version')::integer;
 SELECT * INTO v FROM public.mcp_cost_submission_versions WHERE record_id=ident ORDER BY version DESC LIMIT 1;
 IF ver<>v.version THEN RAISE EXCEPTION 'MCP_BAD:Cost version changed.'; END IF;
 IF action='approve' THEN
   IF EXISTS(SELECT 1 FROM public.mcp_cost_approvals WHERE record_id=ident AND version=ver) THEN RAISE EXCEPTION 'MCP_BAD:Version is already approved.'; END IF;
   INSERT INTO public.mcp_cost_approvals(record_id,version,approved_by) VALUES(ident,ver,auth.uid());
   result:=jsonb_build_object('id',ident,'version',ver,'status','approved');
 ELSIF action='post' THEN
   IF NOT EXISTS(SELECT 1 FROM public.mcp_cost_approvals WHERE record_id=ident AND version=ver) THEN RAISE EXCEPTION 'MCP_BAD:Approval is required before posting.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_cost_posting_events WHERE record_id=ident AND version=ver) THEN RAISE EXCEPTION 'MCP_BAD:Version is already posted.'; END IF;
   paid:=public.mcp_cost_active_paid(ident);
   SELECT cv.* INTO posted FROM public.mcp_cost_submission_versions cv JOIN public.mcp_cost_posting_events pe ON pe.record_id=cv.record_id AND pe.version=cv.version WHERE cv.record_id=ident ORDER BY pe.version DESC LIMIT 1;
   IF paid>(v.facts->>'amount_cents')::numeric THEN RAISE EXCEPTION 'MCP_BAD:Corrected amount is below recorded settlement.'; END IF;
   IF paid>0 AND (lower(btrim(v.facts->>'counterparty_name')) IS DISTINCT FROM lower(btrim(posted.facts->>'counterparty_name'))) THEN RAISE EXCEPTION 'MCP_BAD:Resolve recorded settlement before changing the payee.'; END IF;
   INSERT INTO public.mcp_cost_posting_events(record_id,version,posted_by) VALUES(ident,ver,auth.uid());
   result:=jsonb_build_object('id',ident,'version',ver,'status','posted');
 ELSE
   IF rec.kind='company_paid_expense' THEN RAISE EXCEPTION 'MCP_BAD:Company-paid expense has no supplier payable or employee reimbursement.'; END IF;
   SELECT cv.* INTO posted FROM public.mcp_cost_submission_versions cv JOIN public.mcp_cost_posting_events pe ON pe.record_id=cv.record_id AND pe.version=cv.version WHERE cv.record_id=ident ORDER BY pe.version DESC LIMIT 1;
   IF posted.record_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No posted payable is available.'; END IF;
   IF ver<>posted.version THEN RAISE EXCEPTION 'MCP_BAD:Resolve the pending correction before recording settlement.'; END IF;
   payment_id:=nullif(_p->>'payment_id','')::uuid;
   IF payment_id IS NULL OR jsonb_typeof(_p->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(_p->>'amount_cents','') !~ '^[0-9]{1,13}$' OR length(btrim(coalesce(_p->>'reference',''))) NOT BETWEEN 1 AND 200 OR coalesce(_p->>'paid_on','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Payment ID, date, positive amount and reference are required.'; END IF;
   amt:=(_p->>'amount_cents')::numeric;
   paid:=public.mcp_cost_active_paid(ident);
   IF amt<=0 OR amt>9000000000000 OR paid+amt>(posted.facts->>'amount_cents')::numeric THEN RAISE EXCEPTION 'MCP_BAD:Payment exceeds the posted payable.'; END IF;
   IF public.mcp_cost_reference_in_use(j.company_id,_p->>'reference') THEN RAISE EXCEPTION 'MCP_BAD:Payment reference already recorded.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments WHERE id=payment_id) OR EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence WHERE id=payment_id) THEN RAISE EXCEPTION 'MCP_BAD:Payment ID already exists.'; END IF;
   INSERT INTO public.mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by) VALUES(payment_id,ident,amt::bigint,(_p->>'paid_on')::date,btrim(_p->>'reference'),auth.uid());
   result:=jsonb_build_object('id',ident,'payment_id',payment_id,'status','payment_recorded');
 END IF;
 INSERT INTO public.mcp_cost_submission_operations VALUES(j.company_id,rid,auth.uid(),sig,result);
 RETURN result || jsonb_build_object('already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_accounting_action(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_accounting_action(uuid,jsonb) TO authenticated;

-- Shared payments are fully allocated in one transaction. Corrections remove erroneous evidence only;
-- they never execute or represent a bank reversal/refund. Partial refunds remain unsupported.
-- Names are not identity: deny shared payment until a validated common payee contract is integrated.
CREATE FUNCTION public.mcp_cost_shared_identity_validated(_company uuid,_records uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.mcp_cost_shared_identity_validated(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.mcp_cost_settlement_action(_job uuid,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_variable
DECLARE j public.mcp_jobs; r public.mcp_cost_submissions; target public.mcp_cost_submissions; v public.mcp_cost_submission_versions; posted public.mcp_cost_submission_versions;
 op public.mcp_cost_submission_operations; action text; rid uuid; anchor uuid; payment_id uuid; correction_id uuid; item jsonb; target_id uuid;
 sig text; result jsonb; total numeric:=0; amt numeric; sum_alloc numeric:=0; ids uuid[]:=ARRAY[]::uuid[]; payee text; ref text; ptype text;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 IF public.mcp_cost_accounting_authorized(j.company_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Accounting approval, posting and settlement are not available.'; END IF;
 IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>30000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('action','id','request_id','payment_id','correction_id','amount_cents','paid_on','reference','allocations','reason')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid settlement action.'; END IF;
 action:=_p->>'action'; rid:=nullif(_p->>'request_id','')::uuid; anchor:=nullif(_p->>'id','')::uuid; payment_id:=nullif(_p->>'payment_id','')::uuid;
 IF coalesce(action,'') NOT IN ('shared_payment','correct_payment') OR rid IS NULL OR anchor IS NULL OR payment_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Action and IDs are required.'; END IF;
 PERFORM 1 FROM public.mcp_companies WHERE id=j.company_id FOR UPDATE;
 SELECT * INTO r FROM public.mcp_cost_submissions WHERE id=anchor AND company_id=j.company_id AND anchor_job_id=_job;
 IF r.id IS NULL OR public.mcp_job_scope(r.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a WHERE x.record_id=r.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full') THEN RAISE EXCEPTION 'MCP_BAD:Record unavailable.'; END IF;
 -- Recheck all associated record scope before returning even an idempotent retry.
 IF action='shared_payment' THEN
   IF jsonb_typeof(_p->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(_p->'allocations') NOT BETWEEN 2 AND 50 THEN RAISE EXCEPTION 'MCP_BAD:Two or more allocations are required.'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(_p->'allocations') LOOP
     IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) x WHERE x NOT IN ('record_id','expected_version','amount_cents')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid payment allocation.'; END IF;
     target_id:=nullif(item->>'record_id','')::uuid;
     SELECT * INTO target FROM public.mcp_cost_submissions WHERE id=target_id AND company_id=j.company_id;
     IF target.id IS NULL OR public.mcp_job_scope(target.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a WHERE x.record_id=target.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full') THEN RAISE EXCEPTION 'MCP_BAD:Every allocated record requires full project access.'; END IF;
   END LOOP;
 ELSE
   IF EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence e WHERE e.id=payment_id AND e.record_id=anchor) THEN ptype:='single';
   ELSIF EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments p JOIN public.mcp_cost_shared_allocations a ON a.payment_id=p.id WHERE p.id=payment_id AND p.company_id=j.company_id AND a.record_id=anchor) THEN
     ptype:='shared';
     IF EXISTS(SELECT 1 FROM public.mcp_cost_shared_allocations sa JOIN public.mcp_cost_submissions c ON c.id=sa.record_id WHERE sa.payment_id=payment_id AND (c.company_id<>j.company_id OR public.mcp_job_scope(c.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a WHERE x.record_id=c.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full'))) THEN RAISE EXCEPTION 'MCP_BAD:Every allocated record requires full project access.'; END IF;
   ELSE RAISE EXCEPTION 'MCP_BAD:Payment evidence unavailable.'; END IF;
 END IF;
 sig:=_p::text; SELECT * INTO op FROM public.mcp_cost_submission_operations WHERE company_id=j.company_id AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Request ID belongs to different content.'; END IF;
   RETURN op.result || jsonb_build_object('already_applied',true);
 END IF;
 IF action='shared_payment' THEN
   IF jsonb_typeof(_p->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(_p->>'amount_cents','') !~ '^[0-9]{1,13}$' OR length(btrim(coalesce(_p->>'reference',''))) NOT BETWEEN 1 AND 200 OR coalesce(_p->>'paid_on','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Payment amount, date and reference are required.'; END IF;
   total:=(_p->>'amount_cents')::numeric; ref:=btrim(_p->>'reference');
   IF total<=0 OR total>9000000000000 OR public.mcp_cost_reference_in_use(j.company_id,ref) OR EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence e WHERE e.id=payment_id) OR EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments p WHERE p.id=payment_id) THEN RAISE EXCEPTION 'MCP_BAD:Invalid amount or duplicate payment reference or ID.'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(_p->'allocations') LOOP
     target_id:=(item->>'record_id')::uuid;
     IF target_id=ANY(ids) OR jsonb_typeof(item->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(item->>'amount_cents','') !~ '^[0-9]{1,13}$' OR jsonb_typeof(item->'expected_version') IS DISTINCT FROM 'number' OR coalesce(item->>'expected_version','') !~ '^[0-9]{1,9}$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid or duplicate payment allocation.'; END IF;
     ids:=array_append(ids,target_id); amt:=(item->>'amount_cents')::numeric; sum_alloc:=sum_alloc+amt;
     SELECT * INTO target FROM public.mcp_cost_submissions WHERE id=target_id;
     IF target.kind='company_paid_expense' THEN RAISE EXCEPTION 'MCP_BAD:Company-paid expenses have no payable.'; END IF;
     SELECT * INTO v FROM public.mcp_cost_submission_versions WHERE record_id=target_id ORDER BY version DESC LIMIT 1;
     SELECT cv.* INTO posted FROM public.mcp_cost_submission_versions cv JOIN public.mcp_cost_posting_events pe ON pe.record_id=cv.record_id AND pe.version=cv.version WHERE cv.record_id=target_id ORDER BY pe.version DESC LIMIT 1;
     IF posted.record_id IS NULL OR v.version<>posted.version OR v.version<>(item->>'expected_version')::integer THEN RAISE EXCEPTION 'MCP_BAD:Posted payable unavailable or version changed.'; END IF;
     IF payee IS NULL THEN payee:=lower(btrim(v.facts->>'counterparty_name')); ELSIF payee<>lower(btrim(v.facts->>'counterparty_name')) THEN RAISE EXCEPTION 'MCP_BAD:Shared payment requires the same payee.'; END IF;
     IF amt<=0 OR amt>9000000000000 OR public.mcp_cost_active_paid(target_id)+amt>(posted.facts->>'amount_cents')::numeric THEN RAISE EXCEPTION 'MCP_BAD:Allocation exceeds a posted payable.'; END IF;
   END LOOP;
   IF NOT anchor=ANY(ids) OR sum_alloc<>total THEN RAISE EXCEPTION 'MCP_BAD:Allocations must include this record and equal the payment.'; END IF;
   IF public.mcp_cost_shared_identity_validated(j.company_id,ids) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Shared payee identity is not validated yet.'; END IF;
   INSERT INTO public.mcp_cost_shared_payments(id,company_id,amount_cents,paid_on,reference,recorded_by) VALUES(payment_id,j.company_id,total::bigint,(_p->>'paid_on')::date,ref,auth.uid());
   FOR item IN SELECT value FROM jsonb_array_elements(_p->'allocations') LOOP
     INSERT INTO public.mcp_cost_shared_allocations(payment_id,record_id,amount_cents) VALUES(payment_id,(item->>'record_id')::uuid,(item->>'amount_cents')::bigint);
   END LOOP;
   result:=jsonb_build_object('id',anchor,'payment_id',payment_id,'status','payment_recorded');
 ELSE
   correction_id:=nullif(_p->>'correction_id','')::uuid;
   IF correction_id IS NULL OR length(btrim(coalesce(_p->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Correction ID and reason are required.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE (ptype='single' AND c.payment_id=payment_id) OR (ptype='shared' AND c.shared_payment_id=payment_id)) THEN RAISE EXCEPTION 'MCP_BAD:Payment evidence already corrected.'; END IF;
   INSERT INTO public.mcp_cost_payment_corrections(id,payment_id,shared_payment_id,reason,corrected_by) VALUES(correction_id,CASE WHEN ptype='single' THEN payment_id END,CASE WHEN ptype='shared' THEN payment_id END,btrim(_p->>'reason'),auth.uid());
   result:=jsonb_build_object('id',anchor,'payment_id',payment_id,'correction_id',correction_id,'status','evidence_corrected');
 END IF;
 INSERT INTO public.mcp_cost_submission_operations VALUES(j.company_id,rid,auth.uid(),sig,result);
 RETURN result || jsonb_build_object('already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_settlement_action(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_settlement_action(uuid,jsonb) TO authenticated;

-- Return evidence separately; only the latest posted version is a cost effect.
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
