-- LOCAL UNREGISTERED PROPOSAL. No remote execution or managed journal ordinal assigned.
-- Additive overlay only. Prerequisites: existing company/job roles, 0034 documents,
-- 0035/0041 PO records, cost submissions, submittals and living CPM reports.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.mcp_buyout_records (
 id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 job_id uuid REFERENCES public.mcp_jobs(id), kind text NOT NULL CHECK(kind IN ('directory','party_link','package','readiness')),
 record_key text NOT NULL, version integer NOT NULL CHECK(version>0),
 CHECK((kind='directory')=(job_id IS NULL))
);
CREATE UNIQUE INDEX mcp_buyout_company_identity ON public.mcp_buyout_records(company_id,record_key) WHERE kind='directory';
CREATE UNIQUE INDEX mcp_buyout_job_identity ON public.mcp_buyout_records(job_id,kind,record_key) WHERE job_id IS NOT NULL;
CREATE TABLE public.mcp_buyout_versions (
 record_id uuid NOT NULL REFERENCES public.mcp_buyout_records(id), version integer NOT NULL CHECK(version>0), facts jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(record_id,version)
);
CREATE TABLE public.mcp_buyout_reviews (
 id uuid PRIMARY KEY, company_id uuid NOT NULL, job_id uuid, actor_id uuid NOT NULL, request_id uuid NOT NULL,
 payload_hash bytea NOT NULL, state_hash bytea NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes', cancelled boolean NOT NULL DEFAULT false
);
CREATE TABLE public.mcp_buyout_operations (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL, company_id uuid NOT NULL, job_id uuid, review_id uuid NOT NULL,
 payload_hash bytea NOT NULL, result jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_buyout_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_buyout_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_buyout_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_buyout_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_buyout_records,public.mcp_buyout_versions,public.mcp_buyout_reviews,public.mcp_buyout_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_buyout_records,public.mcp_buyout_versions,public.mcp_buyout_reviews,public.mcp_buyout_operations TO service_role;
CREATE TRIGGER mcp_buyout_versions_immutable BEFORE UPDATE OR DELETE ON public.mcp_buyout_versions FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_buyout_operations_immutable BEFORE UPDATE OR DELETE ON public.mcp_buyout_operations FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

-- Private helpers have no app EXECUTE privileges. Match the existing guarded definer architecture.
CREATE FUNCTION mcp_private.buyout_shape(_p jsonb,_shape jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text; typ text; v jsonb; s text;
BEGIN
 IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>100000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_p) x WHERE NOT _shape ? x) OR EXISTS(SELECT 1 FROM jsonb_object_keys(_shape) x WHERE NOT _p ? x) THEN RAISE EXCEPTION 'MCP_BAD:Missing or unexpected buyout facts.'; END IF;
 FOR k,typ IN SELECT * FROM jsonb_each_text(_shape) LOOP
  v:=_p->k; s:=_p->>k;
  IF v='null'::jsonb AND right(typ,1)='?' THEN CONTINUE; END IF;
  typ:=rtrim(typ,'?');
  IF typ IN ('text','uuid','date','hash') THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(btrim(s)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid text fact: %.',k; END IF;
   IF typ='uuid' AND s IS DISTINCT FROM (s::uuid)::text THEN RAISE EXCEPTION 'MCP_BAD:Use the canonical UUID returned by the source record.'; END IF;
   IF typ='hash' AND s !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid document hash.'; END IF;
   IF typ='date' THEN
    IF s !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Use complete calendar dates.'; END IF;
    PERFORM s::date;
   END IF;
  ELSIF typ IN ('int','cents') THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR s !~ '^\d+$' OR s::numeric > (CASE WHEN typ='int' THEN 2147483646 ELSE 9000000000000 END) OR (typ='int' AND s::numeric<1) THEN RAISE EXCEPTION 'MCP_BAD:Invalid integer amount or version: %.',k; END IF;
  ELSIF typ='array' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v)>50 THEN RAISE EXCEPTION 'MCP_BAD:Invalid or oversized list: %.',k; END IF;
  ELSIF typ='object' AND jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MCP_BAD:Invalid object: %.',k;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION mcp_private.buyout_shape(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mcp_private.buyout_access(_company uuid,_job uuid,_write boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text;
BEGIN
 PERFORM public.mcp_assert_active(); r:=public.mcp_member_role(_company);
 IF _company IS NULL OR r IS NULL OR public.mcp_role_allowed(_company,r) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
 IF _job IS NULL THEN
  IF r IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only the company owner manages the company directory.'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE id=_job AND company_id=_company) OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full access to this company job is required.'; END IF;
  IF _write AND r NOT IN ('owner','pm','all_access') THEN RAISE EXCEPTION 'MCP_BAD:Owner or project management review is required.'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION mcp_private.buyout_access(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_buyout_get(_company uuid,_job uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM mcp_private.buyout_access(_company,_job,false);
 RETURN jsonb_build_object('company_id',_company,'company_name',(SELECT name FROM public.mcp_companies WHERE id=_company),'job_id',_job,'job_number',(SELECT job_number FROM public.mcp_jobs WHERE id=_job),'job_name',(SELECT name FROM public.mcp_jobs WHERE id=_job),'today',to_char(clock_timestamp() AT TIME ZONE coalesce((SELECT time_zone FROM public.mcp_jobs WHERE id=_job),'America/New_York'),'YYYY-MM-DD'),
  'can_manage_directory',public.mcp_member_role(_company)='owner','can_record',public.mcp_member_role(_company) IN ('owner','pm','all_access'),
  'records',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('facts',v.facts,'versions',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.version DESC) FROM public.mcp_buyout_versions h WHERE h.record_id=r.id)) ORDER BY r.kind,r.record_key) FROM public.mcp_buyout_records r JOIN public.mcp_buyout_versions v ON v.record_id=r.id AND v.version=r.version WHERE r.company_id=_company AND (r.job_id IS NOT DISTINCT FROM _job OR (_job IS NOT NULL AND r.kind='directory' AND EXISTS(SELECT 1 FROM public.mcp_buyout_records link JOIN public.mcp_buyout_versions lv ON lv.record_id=link.id AND lv.version=link.version WHERE link.job_id=_job AND link.kind='party_link' AND lv.facts->>'directory_id'=r.id::text)))),'[]'::jsonb),
  'parties',CASE WHEN _job IS NULL THEN '[]'::jsonb ELSE (public.mcp_project_purchase_orders_get(_job)->'parties') END,
  'orders',CASE WHEN _job IS NULL THEN '[]'::jsonb ELSE (public.mcp_project_purchase_orders_get(_job)->'orders') END,
  'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'filename',d.filename,'sha256',d.sha256) ORDER BY d.id) FROM public.mcp_billing_documents d WHERE d.job_id=_job AND d.company_id=_company),'[]'::jsonb),
  'bills',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'version',bv.version,'label',bv.facts->>'description','party_id',bv.facts->>'party_id') ORDER BY b.id,bv.version) FROM public.mcp_cost_submissions b JOIN public.mcp_cost_submission_versions bv ON bv.record_id=b.id WHERE b.company_id=_company AND b.anchor_job_id=_job AND b.kind='supplier_bill' AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions av CROSS JOIN LATERAL jsonb_array_elements(av.facts->'allocations') al WHERE av.record_id=b.id AND public.mcp_job_scope((al->>'job_id')::uuid) IS DISTINCT FROM 'full')),'[]'::jsonb),
  'schedule_activities',coalesce((SELECT jsonb_agg(jsonb_build_object('activity_id',a->>'id','label',coalesce(a->>'name',a->>'id'),'report_version',lr.version) ORDER BY a->>'id') FROM public.mcp_living_reports lr CROSS JOIN LATERAL jsonb_array_elements(lr.data->'activities') a WHERE lr.job_id=_job AND lr.report_type='cpm' AND lr.version=(SELECT max(version) FROM public.mcp_living_reports WHERE job_id=_job AND report_type='cpm')),'[]'::jsonb),
  'submittals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'number',s.number,'revision',s.revision) ORDER BY s.id) FROM public.mcp_submittals s WHERE s.job_id=_job),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_buyout_get(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_buyout_get(uuid,uuid) TO authenticated;

CREATE FUNCTION mcp_private.buyout_validate(_company uuid,_job uuid,_id uuid,_kind text,_expected integer,_f jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.mcp_buyout_records; x jsonb; ref jsonb; key text; role_name text; prior jsonb; dir public.mcp_buyout_records;
BEGIN
 PERFORM mcp_private.buyout_access(_company,_job,true); role_name:=public.mcp_member_role(_company);
 IF _id IS NULL OR _expected IS NULL OR _expected<0 OR _expected>=2147483646 OR coalesce(_kind,'') NOT IN ('directory','party_link','package','readiness') OR ((_kind='directory') IS DISTINCT FROM (_job IS NULL)) THEN RAISE EXCEPTION 'MCP_BAD:Invalid buyout identity or scope.'; END IF;
 SELECT * INTO r FROM public.mcp_buyout_records WHERE id=_id;
 IF r.id IS NULL AND _expected<>0 OR r.id IS NOT NULL AND (r.company_id<>_company OR r.job_id IS DISTINCT FROM _job OR r.kind<>_kind OR r.version<>_expected) THEN RAISE EXCEPTION 'MCP_BAD:Record changed or is unavailable. Read and review again.'; END IF;
 IF r.id IS NOT NULL THEN SELECT facts INTO prior FROM public.mcp_buyout_versions WHERE record_id=r.id AND version=r.version; END IF;
 IF _kind='directory' THEN
  PERFORM mcp_private.buyout_shape(_f,'{"name":"text","kind":"text","trade":"text?","contacts":"array","source":"text","verified_on":"date?","status":"text"}');
  IF length(_f->>'name')>200 OR _f->>'kind' NOT IN ('supplier','subcontractor','both') OR _f->>'status' NOT IN ('active','inactive') OR jsonb_array_length(_f->'contacts')>30 THEN RAISE EXCEPTION 'MCP_BAD:Invalid directory entry.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(_f->'contacts') LOOP
   PERFORM mcp_private.buyout_shape(x,'{"name":"text","email":"text?","phone":"text?","role":"text","authority":"text?","source":"text","verified_on":"date?"}');
   IF x->>'email' IS NOT NULL AND (length(x->>'email')>320 OR x->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'MCP_BAD:Invalid contact email.'; END IF;
  END LOOP;
  key:=lower(btrim(_f->>'name'));
 ELSIF _kind='party_link' THEN
  IF role_name<>'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only the owner can link company identities.'; END IF;
  PERFORM mcp_private.buyout_shape(_f,'{"directory_id":"uuid","directory_version":"int","party_id":"uuid","party_version":"int","source":"text"}');
  SELECT * INTO dir FROM public.mcp_buyout_records WHERE id=(_f->>'directory_id')::uuid AND company_id=_company AND kind='directory' AND version=(_f->>'directory_version')::int;
  IF dir.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Company directory identity changed or is unavailable.'; END IF;
  IF r.id IS NOT NULL AND (prior->>'directory_id'<>_f->>'directory_id' OR prior->>'party_id'<>_f->>'party_id') THEN RAISE EXCEPTION 'MCP_BAD:Historical identity links cannot be reassigned.'; END IF;
  key:=((_f->>'party_id')::uuid)::text;
 ELSIF _kind='package' THEN
  PERFORM mcp_private.buyout_shape(_f,'{"code":"text","title":"text","scope":"text","budget_cents":"cents?","currency":"text","status":"text","candidates":"array","selected_party_id":"uuid?","commitment_refs":"array","expected_award_on":"date?","needed_by":"date?","submittal_ids":"array","schedule_ref":"object?","source":"text"}');
  IF length(_f->>'code')>120 OR _f->>'currency'<>'USD' OR _f->>'status' NOT IN ('draft','reviewed','selected','cancelled') THEN RAISE EXCEPTION 'MCP_BAD:Invalid package status or currency.'; END IF;
  IF _f->>'status'='selected' AND _f->>'selected_party_id' IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose a candidate before selection.'; END IF;
  IF prior->>'status'='cancelled' AND _f->>'status'<>'cancelled' THEN RAISE EXCEPTION 'MCP_BAD:Cancelled packages retain history; create a new package.'; END IF;
  IF r.id IS NOT NULL AND lower(btrim(prior->>'code'))<>lower(btrim(_f->>'code')) THEN RAISE EXCEPTION 'MCP_BAD:Package code is a historical identity.'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(_f->'candidates'))<>(SELECT count(DISTINCT elem->>'party_id') FROM jsonb_array_elements(_f->'candidates') elem) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate candidate.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(_f->'candidates') LOOP
   PERFORM mcp_private.buyout_shape(x,'{"party_id":"uuid","party_version":"int","quote_cents":"cents?","scope":"text","exclusions":"text?","source":"text","quoted_on":"date?","expected_delivery_on":"date?"}');
   IF NOT EXISTS(SELECT 1 FROM public.mcp_project_parties p WHERE p.id=(x->>'party_id')::uuid AND p.job_id=_job AND p.company_id=_company AND p.version=(x->>'party_version')::int) THEN RAISE EXCEPTION 'MCP_BAD:Candidate party changed or is unavailable on this job.'; END IF;
  END LOOP;
  IF _f->>'selected_party_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(_f->'candidates') elem WHERE elem->>'party_id'=_f->>'selected_party_id') THEN RAISE EXCEPTION 'MCP_BAD:Selected party must be a compared candidate.'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(_f->'commitment_refs'))<>(SELECT count(DISTINCT elem->>'po_id') FROM jsonb_array_elements(_f->'commitment_refs') elem) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate commitment reference.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(_f->'commitment_refs') LOOP
   PERFORM mcp_private.buyout_shape(x,'{"po_id":"uuid","version":"int"}');
   IF NOT EXISTS(SELECT 1 FROM public.mcp_purchase_orders p JOIN public.mcp_purchase_order_versions v ON v.po_id=p.id WHERE p.id=(x->>'po_id')::uuid AND p.job_id=_job AND p.company_id=_company AND p.party_id::text=_f->>'selected_party_id' AND v.version=(x->>'version')::int AND v.status='approved' AND v.version=(SELECT max(v2.version) FROM public.mcp_purchase_order_versions v2 WHERE v2.po_id=p.id AND v2.status='approved')) THEN RAISE EXCEPTION 'MCP_BAD:Link the current internally approved PO for the selected party.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_buyout_records br JOIN public.mcp_buyout_versions bv ON bv.record_id=br.id AND bv.version=br.version CROSS JOIN LATERAL jsonb_array_elements(bv.facts->'commitment_refs') dup_ref WHERE br.job_id=_job AND br.kind='package' AND br.id<>_id AND dup_ref->>'po_id'=x->>'po_id') THEN RAISE EXCEPTION 'MCP_BAD:This PO is already linked to a buyout package; it cannot be counted twice.'; END IF;
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(_f->'submittal_ids') LOOP
   IF jsonb_typeof(x)<>'string' OR NOT EXISTS(SELECT 1 FROM public.mcp_submittals WHERE id=(x#>>'{}')::uuid AND job_id=_job) THEN RAISE EXCEPTION 'MCP_BAD:Submittal is unavailable on this job.'; END IF;
  END LOOP;
  IF _f->'schedule_ref'<>'null'::jsonb THEN
   PERFORM mcp_private.buyout_shape(_f->'schedule_ref','{"report_version":"int","activity_id":"text"}');
   IF NOT EXISTS(SELECT 1 FROM public.mcp_living_reports lr CROSS JOIN LATERAL jsonb_array_elements(lr.data->'activities') a WHERE lr.job_id=_job AND lr.report_type='cpm' AND lr.version=(_f#>>'{schedule_ref,report_version}')::int AND a->>'id'=_f#>>'{schedule_ref,activity_id}') THEN RAISE EXCEPTION 'MCP_BAD:Schedule activity/version is unavailable on this job.'; END IF;
  END IF;
  key:=lower(btrim(_f->>'code'));
 ELSE
  PERFORM mcp_private.buyout_shape(_f,'{"party_id":"uuid","party_version":"int","requirements":"array","source":"text"}');
  IF (SELECT count(*) FROM jsonb_array_elements(_f->'requirements'))<>(SELECT count(DISTINCT lower(btrim(elem->>'key'))) FROM jsonb_array_elements(_f->'requirements') elem) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate requirement key.'; END IF;
  IF prior IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior->'requirements') old WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(_f->'requirements') cur WHERE cur->>'key'=old->>'key')) THEN RAISE EXCEPTION 'MCP_BAD:Retain requirement history; an owner can mark a sourced requirement not applicable.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(_f->'requirements') LOOP
   PERFORM mcp_private.buyout_shape(x,'{"key":"text","label":"text","kind":"text","applicability":"text","source":"text","jurisdiction":"text?","due_on":"date?","document_id":"uuid?","document_sha256":"hash?","effective_on":"date?","expires_on":"date?","review":"text","review_note":"text?","exception_expires_on":"date?","bill_id":"uuid?","bill_version":"int?"}');
   IF length(x->>'key')>120 OR x->>'kind' NOT IN ('agreement','insurance','waiver','other') OR x->>'applicability' NOT IN ('required','not_applicable','unknown') OR x->>'review' NOT IN ('pending','evidence_checked','exception') THEN RAISE EXCEPTION 'MCP_BAD:Invalid readiness requirement.'; END IF;
   IF x->>'applicability'='not_applicable' AND role_name<>'owner' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(prior->'requirements','[]'::jsonb)) old WHERE old=x) THEN RAISE EXCEPTION 'MCP_BAD:Only an owner may record a sourced not-applicable requirement.'; END IF;
   IF prior IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior->'requirements') old WHERE old->>'key'=x->>'key' AND old->>'kind'<>x->>'kind') THEN RAISE EXCEPTION 'MCP_BAD:Retain the requirement kind; add a separately sourced requirement.'; END IF;
   IF x->>'review'<>'pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(prior->'requirements','[]'::jsonb)) old WHERE old->>'key'=x->>'key' AND (old - 'review' - 'review_note' - 'exception_expires_on') IS DISTINCT FROM (x - 'review' - 'review_note' - 'exception_expires_on')) THEN RAISE EXCEPTION 'MCP_BAD:Changed requirements or evidence need a new pending review first.'; END IF;
   IF (x->>'effective_on')::date > (x->>'expires_on')::date THEN RAISE EXCEPTION 'MCP_BAD:Evidence expires before its effective date.'; END IF;
   IF (x->>'document_id' IS NULL) IS DISTINCT FROM (x->>'document_sha256' IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:Original ID and hash must be linked together.'; END IF;
   IF x->>'document_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.mcp_billing_documents d WHERE d.id=(x->>'document_id')::uuid AND d.job_id=_job AND d.company_id=_company AND d.sha256=x->>'document_sha256') THEN RAISE EXCEPTION 'MCP_BAD:Verified original is unavailable on this job.'; END IF;
   IF x->>'review'='evidence_checked' AND (x->>'document_id' IS NULL OR x->>'review_note' IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:Evidence review needs an original and review note.'; END IF;
   IF x->>'review'='exception' AND (role_name<>'owner' OR x->>'review_note' IS NULL OR x->>'exception_expires_on' IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:Only an owner may record a sourced, dated exception.'; END IF;
   IF (x->>'bill_id' IS NULL) IS DISTINCT FROM (x->>'bill_version' IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:Supply both bill identity and version.'; END IF;
   IF x->>'bill_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_submissions b JOIN public.mcp_cost_submission_versions bv ON bv.record_id=b.id WHERE b.id=(x->>'bill_id')::uuid AND b.company_id=_company AND b.anchor_job_id=_job AND bv.version=(x->>'bill_version')::int AND bv.version=(SELECT max(version) FROM public.mcp_cost_submission_versions WHERE record_id=b.id) AND bv.facts->>'party_id'=_f->>'party_id' AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions av CROSS JOIN LATERAL jsonb_array_elements(av.facts->'allocations') al WHERE av.record_id=b.id AND public.mcp_job_scope((al->>'job_id')::uuid) IS DISTINCT FROM 'full')) THEN RAISE EXCEPTION 'MCP_BAD:Bill/version or allocated job access is unavailable.'; END IF;
   IF prior IS NOT NULL AND x->>'review'<>'pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior->'requirements') old WHERE old->>'key'=x->>'key' AND (old->>'document_id' IS DISTINCT FROM x->>'document_id' OR old->>'document_sha256' IS DISTINCT FROM x->>'document_sha256')) THEN RAISE EXCEPTION 'MCP_BAD:A replaced original needs a new pending review first.'; END IF;
  END LOOP;
  IF r.id IS NOT NULL AND prior->>'party_id'<>_f->>'party_id' THEN RAISE EXCEPTION 'MCP_BAD:Readiness cannot be reassigned to another party.'; END IF;
  key:=((_f->>'party_id')::uuid)::text;
 END IF;
 IF _kind IN ('party_link','readiness') AND NOT EXISTS(SELECT 1 FROM public.mcp_project_parties p WHERE p.id=(_f->>'party_id')::uuid AND p.job_id=_job AND p.company_id=_company AND p.version=(_f->>'party_version')::int) THEN RAISE EXCEPTION 'MCP_BAD:Party changed or is unavailable on this job.'; END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_buyout_records WHERE company_id=_company AND job_id IS NOT DISTINCT FROM _job AND kind=_kind AND record_key=key AND id<>_id) THEN RAISE EXCEPTION 'MCP_BAD:This record already exists. Select and revise the existing version.'; END IF;
 RETURN key;
END $$;
REVOKE ALL ON FUNCTION mcp_private.buyout_validate(uuid,uuid,uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_buyout_review(_company uuid,_job uuid,_id uuid,_kind text,_expected integer,_facts jsonb,_reason text,_request uuid,_review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h bytea; state bytea; old public.mcp_buyout_reviews; p jsonb; identity text;
BEGIN
 PERFORM mcp_private.buyout_access(_company,_job,true);
 IF _review IS NULL OR _request IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Request, review and reason are required.'; END IF;
 -- Same company-before-job order as existing company defaults. No financial rows are written.
 PERFORM 1 FROM public.mcp_companies WHERE id=_company FOR UPDATE;
 PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 identity:=mcp_private.buyout_validate(_company,_job,_id,_kind,_expected,_facts);
 p:=jsonb_build_object('id',_id,'kind',_kind,'expected',_expected,'facts',_facts,'reason',_reason);
 h:=pg_catalog.sha256(pg_catalog.convert_to(p::text,'UTF8'));
 state:=pg_catalog.sha256(pg_catalog.convert_to(public.mcp_buyout_get(_company,_job)::text,'UTF8'));
 SELECT * INTO old FROM public.mcp_buyout_reviews WHERE id=_review;
 IF old.id IS NOT NULL THEN
  IF old.company_id IS DISTINCT FROM _company OR old.job_id IS DISTINCT FROM _job OR old.actor_id IS DISTINCT FROM auth.uid() OR old.request_id IS DISTINCT FROM _request OR old.payload_hash IS DISTINCT FROM h OR old.state_hash IS DISTINCT FROM state OR old.cancelled OR old.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'MCP_BAD:Review changed, cancelled or expired. Read and review again.'; END IF;
 ELSE
  DELETE FROM public.mcp_buyout_reviews WHERE company_id=_company AND expires_at<clock_timestamp();
  IF (SELECT count(*) FROM public.mcp_buyout_reviews WHERE actor_id=auth.uid() AND company_id=_company AND NOT cancelled)>=100 THEN RAISE EXCEPTION 'MCP_BAD:Too many pending reviews.'; END IF;
  INSERT INTO public.mcp_buyout_reviews(id,company_id,job_id,actor_id,request_id,payload_hash,state_hash) VALUES(_review,_company,_job,auth.uid(),_request,h,state) RETURNING * INTO old;
 END IF;
 RETURN jsonb_build_object('review_id',_review,'expires_at',old.expires_at,'saved',false,'identity',identity,'facts',_facts,'expected_version',_expected);
END $$;
REVOKE ALL ON FUNCTION public.mcp_buyout_review(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_buyout_review(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid) TO authenticated;

CREATE FUNCTION public.mcp_buyout_record(_company uuid,_job uuid,_id uuid,_kind text,_expected integer,_facts jsonb,_reason text,_request uuid,_review uuid,_confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h bytea; state bytea; rev public.mcp_buyout_reviews; op public.mcp_buyout_operations; p jsonb; identity text; result jsonb;
BEGIN
 PERFORM mcp_private.buyout_access(_company,_job,true);
 IF _confirmed IS DISTINCT FROM true OR _review IS NULL OR _request IS NULL OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Review and confirm these exact facts first.'; END IF;
 PERFORM 1 FROM public.mcp_companies WHERE id=_company FOR UPDATE;
 PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 p:=jsonb_build_object('id',_id,'kind',_kind,'expected',_expected,'facts',_facts,'reason',_reason);
 h:=pg_catalog.sha256(pg_catalog.convert_to(p::text,'UTF8'));
 SELECT * INTO op FROM public.mcp_buyout_operations WHERE request_id=_request;
 IF op.request_id IS NOT NULL THEN
  IF op.company_id IS DISTINCT FROM _company OR op.job_id IS DISTINCT FROM _job OR op.actor_id IS DISTINCT FROM auth.uid() OR op.payload_hash IS DISTINCT FROM h OR op.review_id IS DISTINCT FROM _review THEN RAISE EXCEPTION 'MCP_BAD:Request ID was used for different facts.'; END IF;
  RETURN op.result||jsonb_build_object('already_applied',true);
 END IF;
 SELECT * INTO rev FROM public.mcp_buyout_reviews WHERE id=_review AND company_id=_company AND job_id IS NOT DISTINCT FROM _job AND actor_id=auth.uid() AND request_id=_request AND payload_hash=h AND expires_at>=clock_timestamp() AND NOT cancelled;
 IF rev.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Review unavailable, cancelled or expired.'; END IF;
 state:=pg_catalog.sha256(pg_catalog.convert_to(public.mcp_buyout_get(_company,_job)::text,'UTF8'));
 IF state IS DISTINCT FROM rev.state_hash THEN RAISE EXCEPTION 'MCP_BAD:Source records changed since review. Read and review again.'; END IF;
 identity:=mcp_private.buyout_validate(_company,_job,_id,_kind,_expected,_facts);
 INSERT INTO public.mcp_buyout_records(id,company_id,job_id,kind,record_key,version) VALUES(_id,_company,_job,_kind,identity,_expected+1)
 ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,record_key=EXCLUDED.record_key;
 INSERT INTO public.mcp_buyout_versions(record_id,version,facts,reason,recorded_by) VALUES(_id,_expected+1,_facts,_reason,auth.uid());
 result:=jsonb_build_object('id',_id,'version',_expected+1,'saved',true,'kind',_kind,'financial_effect','none');
 INSERT INTO public.mcp_buyout_operations(request_id,actor_id,company_id,job_id,review_id,payload_hash,result) VALUES(_request,auth.uid(),_company,_job,_review,h,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_buyout_record(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_buyout_record(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid,boolean) TO authenticated;

CREATE FUNCTION public.mcp_buyout_review_cancel(_company uuid,_job uuid,_review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE applied jsonb;
BEGIN
 PERFORM mcp_private.buyout_access(_company,_job,true);
 PERFORM 1 FROM public.mcp_companies WHERE id=_company FOR UPDATE;
 PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 SELECT result INTO applied FROM public.mcp_buyout_operations WHERE review_id=_review AND company_id=_company AND job_id IS NOT DISTINCT FROM _job AND actor_id=auth.uid();
 IF applied IS NOT NULL THEN RETURN jsonb_build_object('cancelled',false,'saved',true,'result',applied); END IF;
 UPDATE public.mcp_buyout_reviews SET cancelled=true WHERE id=_review AND company_id=_company AND job_id IS NOT DISTINCT FROM _job AND actor_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Review unavailable.'; END IF;
 RETURN jsonb_build_object('cancelled',true,'saved',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_buyout_review_cancel(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_buyout_review_cancel(uuid,uuid,uuid) TO authenticated;
