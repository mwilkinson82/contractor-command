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
  sig:=md5(_p::text);
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
  IF f ? 'party_id' OR f ? 'purchase_order_id' THEN RAISE EXCEPTION 'MCP_BAD:Supplier and PO links are not available yet.'; END IF;
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
