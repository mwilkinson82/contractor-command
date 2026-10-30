-- LOCAL REVIEW PROPOSAL ONLY. Controller assigns a managed identity after review.
-- Requires accounting AP 0036 and private athena-financial-documents storage.
-- No existing field-expense upload, plan, membership, storage policy or grant is broadened.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.mcp_ap_original_uploads (
 id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), record_id uuid NOT NULL,
 version integer NOT NULL, filename text NOT NULL, mime_type text NOT NULL,
 storage_path text NOT NULL UNIQUE, size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), verified_at timestamptz,
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_submission_versions(record_id,version)
);
CREATE TABLE public.mcp_ap_originals (
 id uuid PRIMARY KEY REFERENCES public.mcp_ap_original_uploads(id),
 company_id uuid NOT NULL REFERENCES public.mcp_companies(id), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 record_id uuid NOT NULL, version integer NOT NULL, filename text NOT NULL, mime_type text NOT NULL,
 storage_path text NOT NULL UNIQUE, size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), linked_by uuid NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(), request_id uuid NOT NULL, payload jsonb NOT NULL,
 FOREIGN KEY(record_id,version) REFERENCES public.mcp_cost_submission_versions(record_id,version),
 UNIQUE(company_id,request_id), UNIQUE(record_id,version,sha256)
);
ALTER TABLE public.mcp_ap_original_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_ap_originals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_ap_original_uploads,public.mcp_ap_originals FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_ap_original_uploads,public.mcp_ap_originals TO service_role;
CREATE INDEX mcp_ap_original_record_version ON public.mcp_ap_originals(record_id,version);
CREATE TRIGGER mcp_ap_originals_immutable BEFORE UPDATE OR DELETE ON public.mcp_ap_originals
 FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

-- This helper uses the real membership/plan gate and all immutable allocation scopes.
CREATE FUNCTION public.mcp_ap_original_scope(_job uuid,_record uuid,_version integer,_current boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.mcp_cost_submissions; v public.mcp_cost_submission_versions; latest integer;
BEGIN
 PERFORM public.mcp_assert_active();
 IF _current THEN SELECT * INTO r FROM public.mcp_cost_submissions WHERE id=_record FOR UPDATE;
 ELSE SELECT * INTO r FROM public.mcp_cost_submissions WHERE id=_record; END IF;
 IF r.id IS NULL OR r.kind<>'supplier_bill' OR r.anchor_job_id<>_job
  OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full'
  OR public.mcp_cost_accounting_authorized(r.company_id) IS DISTINCT FROM true
  OR NOT EXISTS(SELECT 1 FROM public.mcp_jobs j WHERE j.id=_job AND j.company_id=r.company_id)
  OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a
    LEFT JOIN public.mcp_jobs j ON j.id=(a->>'job_id')::uuid
    WHERE x.record_id=_record AND (j.company_id IS DISTINCT FROM r.company_id OR public.mcp_job_scope(j.id) IS DISTINCT FROM 'full'))
 THEN RAISE EXCEPTION 'MCP_BAD:Supplier original unavailable. Accounting or owner access to every allocated job is required.'; END IF;
 SELECT max(version) INTO latest FROM public.mcp_cost_submission_versions WHERE record_id=_record;
 SELECT * INTO v FROM public.mcp_cost_submission_versions WHERE record_id=_record AND version=coalesce(_version,latest);
 IF v.record_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That bill version is unavailable.'; END IF;
 IF _current AND v.version<>latest THEN RAISE EXCEPTION 'MCP_BAD:The bill changed. Review its current version before attaching the original.'; END IF;
 RETURN jsonb_build_object('company_id',r.company_id,'job_id',_job,'record_id',r.id,'version',v.version,'facts',v.facts);
END $$;

CREATE FUNCTION public.mcp_ap_original_upload_begin(_job uuid,_record uuid,_version integer,_id uuid,_filename text,_mime text,_size integer,_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; u public.mcp_ap_original_uploads;
BEGIN
 s:=public.mcp_ap_original_scope(_job,_record,_version,true);
 IF _id IS NULL OR length(coalesce(_filename,'')) NOT BETWEEN 1 AND 120 OR _filename LIKE '%/%' OR position(chr(92) in _filename)>0 OR position('..' in _filename)>0
  OR coalesce(_mime,'') NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  OR _size IS NULL OR _size NOT BETWEEN 1 AND 10485760 OR coalesce(_sha256,'') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'MCP_BAD:Invalid supplier original.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ap-original:'||auth.uid()::text,0));
 SELECT * INTO u FROM public.mcp_ap_original_uploads WHERE id=_id OR (created_by=auth.uid() AND record_id=_record AND version=_version AND sha256=_sha256 AND (verified_at IS NOT NULL OR (expires_at>now() AND attempts<3))) ORDER BY created_at LIMIT 1;
 IF u.id IS NOT NULL THEN
  IF u.created_by<>auth.uid() OR u.job_id<>_job OR u.record_id<>_record OR u.version<>_version OR u.filename<>_filename OR u.mime_type<>_mime OR u.size_bytes<>_size OR u.sha256<>_sha256
  THEN RAISE EXCEPTION 'MCP_BAD:Upload ID or fingerprint already has different content. Keep the original ID for a retry.'; END IF;
 ELSE
  IF (SELECT count(*) FROM public.mcp_ap_original_uploads WHERE created_by=auth.uid() AND created_at>now()-interval '1 hour')>=12 THEN RAISE EXCEPTION 'MCP_BAD:Too many original uploads. Try again later.'; END IF;
  INSERT INTO public.mcp_ap_original_uploads(id,company_id,job_id,record_id,version,filename,mime_type,storage_path,size_bytes,sha256,created_by)
   VALUES(_id,(s->>'company_id')::uuid,_job,_record,_version,_filename,_mime,(s->>'company_id')||'/'||_job::text||'/'||_id::text||'/'||_filename,_size,_sha256,auth.uid()) RETURNING * INTO u;
 END IF;
 RETURN to_jsonb(u);
END $$;

CREATE FUNCTION public.mcp_ap_original_upload_get(_job uuid,_record uuid,_version integer,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_ap_original_uploads;
BEGIN
 PERFORM public.mcp_ap_original_scope(_job,_record,_version,false);
 SELECT * INTO u FROM public.mcp_ap_original_uploads WHERE id=_id AND job_id=_job AND record_id=_record AND version=_version AND created_by=auth.uid();
 IF u.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That original upload is unavailable.'; END IF;
 RETURN to_jsonb(u);
END $$;

-- Only the server can reserve an immutable object write or attest the actual bytes.
CREATE FUNCTION public.mcp_ap_original_upload_claim(_id uuid,_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_ap_original_uploads; claims text:=current_setting('request.jwt.claims',true); result jsonb;
BEGIN
 SELECT * INTO u FROM public.mcp_ap_original_uploads WHERE id=_id FOR UPDATE;
 IF _actor IS NULL OR u.id IS NULL OR u.created_by<>_actor THEN RAISE EXCEPTION 'MCP_BAD:That original upload is unavailable.'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 PERFORM public.mcp_ap_original_scope(u.job_id,u.record_id,u.version,true);
 IF u.verified_at IS NULL THEN
  IF u.expires_at<=now() OR u.attempts>=3 THEN RAISE EXCEPTION 'MCP_BAD:Upload expired or exhausted. Start a new upload.'; END IF;
  UPDATE public.mcp_ap_original_uploads SET attempts=attempts+1 WHERE id=u.id;
 END IF;
 result:=to_jsonb(u);
 PERFORM set_config('request.jwt.claims',coalesce(claims,''),true); RETURN result;
END $$;

CREATE FUNCTION public.mcp_ap_original_verify(_job uuid,_record uuid,_version integer,_id uuid,_size integer,_sha256 text,_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_ap_original_uploads; claims text:=current_setting('request.jwt.claims',true); result jsonb;
BEGIN
 IF _actor IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Verified member required.'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 PERFORM public.mcp_ap_original_scope(_job,_record,_version,true);
 SELECT * INTO u FROM public.mcp_ap_original_uploads WHERE id=_id AND job_id=_job AND record_id=_record AND version=_version AND created_by=_actor FOR UPDATE;
 IF u.id IS NULL OR _size IS DISTINCT FROM u.size_bytes OR _sha256 IS DISTINCT FROM u.sha256 OR (u.verified_at IS NULL AND u.expires_at<=now())
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='athena-financial-documents' AND name=u.storage_path)
 THEN RAISE EXCEPTION 'MCP_BAD:The stored original does not match this upload.'; END IF;
 UPDATE public.mcp_ap_original_uploads SET verified_at=coalesce(verified_at,now()) WHERE id=u.id RETURNING * INTO u;
 result:=to_jsonb(u);
 PERFORM set_config('request.jwt.claims',coalesce(claims,''),true); RETURN result;
END $$;

CREATE FUNCTION public.mcp_ap_original_review(_job uuid,_record uuid,_version integer,_upload uuid,_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; u public.mcp_ap_original_uploads; p jsonb; ticket public.mcp_cost_review_tickets;
BEGIN
 s:=public.mcp_ap_original_scope(_job,_record,_version,true);
 IF _request IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Keep a request ID for the reviewed attachment.'; END IF;
 SELECT * INTO u FROM public.mcp_ap_original_uploads WHERE id=_upload AND job_id=_job AND record_id=_record AND version=_version AND created_by=auth.uid() AND verified_at IS NOT NULL;
 IF u.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Upload and verify the exact original before reviewing its link.'; END IF;
 p:=jsonb_build_object('record_id',_record,'version',_version,'upload_id',u.id,'request_id',_request,'filename',u.filename,'sha256',u.sha256,'size_bytes',u.size_bytes);
 PERFORM pg_advisory_xact_lock(hashtextextended('ap-original-review:'||auth.uid()::text,0));
 IF (SELECT count(*) FROM public.mcp_cost_review_tickets WHERE actor_id=auth.uid() AND purpose='ap_original' AND consumed_at IS NULL AND expires_at>now())>=50 THEN RAISE EXCEPTION 'MCP_BAD:Too many pending original reviews. Try again after they expire.'; END IF;
 INSERT INTO public.mcp_cost_review_tickets(company_id,job_id,actor_id,purpose,payload) VALUES((s->>'company_id')::uuid,_job,auth.uid(),'ap_original',p) RETURNING * INTO ticket;
 RETURN jsonb_build_object('review_key',ticket.id,'expires_at',ticket.expires_at,'payload',p,'bill',s);
END $$;

CREATE FUNCTION public.mcp_ap_original_link(_job uuid,_p jsonb,_review uuid,_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; u public.mcp_ap_original_uploads; old public.mcp_ap_originals; record uuid; ver integer; request uuid;
BEGIN
 IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>4000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('record_id','version','upload_id','request_id','filename','sha256','size_bytes')) THEN RAISE EXCEPTION 'MCP_BAD:Use the exact reviewed original attachment.'; END IF;
 record:=nullif(_p->>'record_id','')::uuid; ver:=(_p->>'version')::integer; request:=nullif(_p->>'request_id','')::uuid;
 s:=public.mcp_ap_original_scope(_job,record,ver,false);
 IF request IS NULL OR _confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Review the exact original and confirm before linking.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended((s->>'company_id')||':ap-original:'||request::text,0));
 SELECT * INTO old FROM public.mcp_ap_originals WHERE company_id=(s->>'company_id')::uuid AND request_id=request;
 IF old.id IS NOT NULL THEN
  IF old.linked_by<>auth.uid() OR old.payload IS DISTINCT FROM _p THEN RAISE EXCEPTION 'MCP_BAD:Request ID already has different content.'; END IF;
  RETURN jsonb_build_object('id',old.id,'record_id',old.record_id,'version',old.version,'already_linked',true);
 END IF;
 PERFORM public.mcp_ap_original_scope(_job,record,ver,true);
 SELECT * INTO u FROM public.mcp_ap_original_uploads WHERE id=(_p->>'upload_id')::uuid AND job_id=_job AND record_id=record AND version=ver AND created_by=auth.uid() FOR UPDATE;
 IF u.id IS NULL OR u.verified_at IS NULL OR u.filename IS DISTINCT FROM _p->>'filename' OR u.sha256 IS DISTINCT FROM _p->>'sha256' OR u.size_bytes IS DISTINCT FROM (_p->>'size_bytes')::integer THEN RAISE EXCEPTION 'MCP_BAD:The original changed. Review it again.'; END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_ap_originals WHERE record_id=record AND version=ver AND sha256=u.sha256) THEN RAISE EXCEPTION 'MCP_BAD:That original is already linked to this bill version. Read its originals instead.'; END IF;
 PERFORM public.mcp_cost_review_consume(_job,'ap_original',_p,_review);
 INSERT INTO public.mcp_ap_originals(id,company_id,job_id,record_id,version,filename,mime_type,storage_path,size_bytes,sha256,linked_by,request_id,payload)
 VALUES(u.id,u.company_id,u.job_id,u.record_id,u.version,u.filename,u.mime_type,u.storage_path,u.size_bytes,u.sha256,auth.uid(),request,_p);
 RETURN jsonb_build_object('id',u.id,'record_id',record,'version',ver,'already_linked',false);
END $$;

CREATE FUNCTION public.mcp_ap_original_list(_job uuid,_record uuid,_version integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.mcp_ap_original_scope(_job,_record,_version,false);
 IF (SELECT count(*) FROM public.mcp_ap_originals WHERE record_id=_record AND (_version IS NULL OR version=_version))>200 THEN RAISE EXCEPTION 'MCP_BAD:Too many originals. Choose an exact bill version.'; END IF;
 SELECT jsonb_build_object('originals',coalesce(jsonb_agg(jsonb_build_object('id',id,'record_id',record_id,'version',version,'filename',filename,'mime_type',mime_type,'size_bytes',size_bytes,'sha256',sha256,'linked_at',linked_at,'request_id',request_id) ORDER BY version DESC,linked_at),'[]'::jsonb)) INTO result
 FROM public.mcp_ap_originals WHERE record_id=_record AND (_version IS NULL OR version=_version);
 RETURN result;
END $$;
CREATE FUNCTION public.mcp_ap_original_get(_job uuid,_record uuid,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.mcp_ap_originals;
BEGIN
 PERFORM public.mcp_ap_original_scope(_job,_record,NULL,false);
 SELECT * INTO d FROM public.mcp_ap_originals WHERE id=_id AND job_id=_job AND record_id=_record;
 IF d.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That supplier original is unavailable.'; END IF;
 RETURN to_jsonb(d)-'payload';
END $$;

REVOKE ALL ON FUNCTION public.mcp_ap_original_scope(uuid,uuid,integer,boolean),public.mcp_ap_original_upload_begin(uuid,uuid,integer,uuid,text,text,integer,text),public.mcp_ap_original_upload_get(uuid,uuid,integer,uuid),public.mcp_ap_original_upload_claim(uuid,uuid),public.mcp_ap_original_verify(uuid,uuid,integer,uuid,integer,text,uuid),public.mcp_ap_original_review(uuid,uuid,integer,uuid,uuid),public.mcp_ap_original_link(uuid,jsonb,uuid,boolean),public.mcp_ap_original_list(uuid,uuid,integer),public.mcp_ap_original_get(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ap_original_scope(uuid,uuid,integer,boolean),public.mcp_ap_original_upload_begin(uuid,uuid,integer,uuid,text,text,integer,text),public.mcp_ap_original_upload_get(uuid,uuid,integer,uuid),public.mcp_ap_original_review(uuid,uuid,integer,uuid,uuid),public.mcp_ap_original_link(uuid,jsonb,uuid,boolean),public.mcp_ap_original_list(uuid,uuid,integer),public.mcp_ap_original_get(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ap_original_upload_claim(uuid,uuid),public.mcp_ap_original_verify(uuid,uuid,integer,uuid,integer,text,uuid) TO service_role;

-- One bounded association snapshot. No file authenticity or cross-domain atomic close is inferred.
CREATE FUNCTION public.mcp_ap_original_snapshot(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 WITH j AS MATERIALIZED (
  SELECT job.id,job.company_id FROM public.mcp_jobs job
  WHERE job.id=_job AND auth.uid() IS NOT NULL AND public.mcp_job_scope(job.id)='full'
   AND public.mcp_cost_accounting_authorized(job.company_id)
   AND (
    coalesce((SELECT (public.get_circle_entitlement(u.id,coalesce(u.email,''))->>'hasAccess')::boolean FROM auth.users u WHERE u.id=auth.uid()),false)
    OR EXISTS(SELECT 1 FROM public.mcp_company_entitlements e WHERE e.company_id=job.company_id AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office'))
    OR coalesce((SELECT (public.get_circle_entitlement(u.id,coalesce(u.email,''))->>'hasAccess')::boolean FROM public.mcp_companies c JOIN auth.users u ON u.id=c.created_by WHERE c.id=job.company_id),false)
   )
 ), records AS MATERIALIZED (
  SELECT r.id,r.anchor_job_id,max(v.version) AS version,
    bool_and(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.facts->'allocations') a LEFT JOIN public.mcp_jobs allocated ON allocated.id=(a->>'job_id')::uuid WHERE allocated.company_id IS DISTINCT FROM j.company_id OR public.mcp_job_scope(allocated.id) IS DISTINCT FROM 'full')) AS accessible
  FROM public.mcp_cost_submissions r JOIN public.mcp_cost_submission_versions v ON v.record_id=r.id CROSS JOIN j
  WHERE r.company_id=j.company_id AND r.kind='supplier_bill' AND (r.anchor_job_id=j.id OR EXISTS(SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a WHERE x.record_id=r.id AND (a->>'job_id')::uuid=j.id))
  GROUP BY r.id,r.anchor_job_id,j.company_id
 ), docs AS MATERIALIZED (
  SELECT d.id,d.record_id,d.version,d.filename,d.size_bytes,d.sha256,d.linked_at FROM public.mcp_ap_originals d JOIN records r ON r.id=d.record_id CROSS JOIN j WHERE d.company_id=j.company_id AND d.job_id=j.id
 ), body AS (
  SELECT jsonb_build_object('snapshot_version',1,'complete',true,'company_id',(SELECT company_id FROM j),'job_id',_job,
    'records',coalesce((SELECT jsonb_agg(jsonb_build_object('record_id',id,'version',version) ORDER BY id) FROM records),'[]'::jsonb),
    'documents',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM docs d),'[]'::jsonb)) AS value
 ) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM j) OR (SELECT count(*) FROM records)>200 OR (SELECT count(*) FROM docs)>200 OR EXISTS(SELECT 1 FROM records WHERE accessible IS DISTINCT FROM true OR anchor_job_id<>_job) OR octet_length(value::text)>1048576 THEN jsonb_build_object('snapshot_version',1,'complete',false) ELSE value END INTO result FROM body;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_ap_original_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_ap_original_snapshot(uuid) TO authenticated;
