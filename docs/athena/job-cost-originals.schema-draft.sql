-- STAGED ONLY. Requires job-cost and financial-original storage schemas; not a migration.
-- Separate upload sessions and receipts bind every file to one existing field submission.
CREATE TABLE public.mcp_cost_receipt_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id),
 filename text NOT NULL, mime_type text NOT NULL, storage_path text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','finished')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_cost_receipts (
 id uuid PRIMARY KEY REFERENCES public.mcp_cost_receipt_uploads(id), company_id uuid NOT NULL,
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id),
 filename text NOT NULL, mime_type text NOT NULL, storage_path text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 created_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_cost_receipt_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_cost_receipt_uploads,public.mcp_cost_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mcp_cost_receipt_uploads,public.mcp_cost_receipts TO service_role;
CREATE INDEX mcp_cost_receipts_record_idx ON public.mcp_cost_receipts(record_id);

-- Used only inside scoped functions; users cannot execute the predicate directly.
CREATE FUNCTION public.mcp_cost_own_field_receipt_access(_job uuid,_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.mcp_job_scope(_job)='super' AND EXISTS (
  SELECT 1 FROM public.mcp_cost_submissions r JOIN public.mcp_jobs j ON j.id=r.anchor_job_id
  WHERE r.id=_record AND r.anchor_job_id=_job AND r.company_id=j.company_id AND r.created_by=auth.uid()
   AND r.kind IN ('company_paid_expense','reimbursable_expense'))
$$;
REVOKE ALL ON FUNCTION public.mcp_cost_own_field_receipt_access(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_cost_receipt_upload_begin(_job uuid,_record uuid,_filename text,_mime text,_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; u public.mcp_cost_receipt_uploads; ident uuid:=gen_random_uuid();
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_cost_own_field_receipt_access(_job,_record) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Your own assigned field submission is required.'; END IF;
 IF length(coalesce(_filename,'')) NOT BETWEEN 1 AND 120 OR _filename LIKE '%/%' OR position(chr(92) in _filename)>0 OR position('..' in _filename)>0 OR coalesce(_token_hash,'') !~ '^[0-9a-f]{64}$' OR coalesce(_mime,'') NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') THEN RAISE EXCEPTION 'MCP_BAD:Invalid financial document.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cost-receipt-upload:'||auth.uid()::text,0));
 IF (SELECT count(*) FROM public.mcp_cost_receipt_uploads WHERE created_by=auth.uid() AND created_at>now()-interval '1 hour')>=12 THEN RAISE EXCEPTION 'MCP_BAD:Too many receipt uploads.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 INSERT INTO public.mcp_cost_receipt_uploads(id,company_id,job_id,record_id,filename,mime_type,storage_path,token_hash,expires_at,created_by)
 VALUES(ident,j.company_id,_job,_record,_filename,_mime,j.company_id::text||'/'||_job::text||'/'||ident::text||'/'||_filename,_token_hash,now()+interval '2 hours',auth.uid()) RETURNING * INTO u;
 RETURN jsonb_build_object('id',u.id,'job_id',u.job_id,'company_id',u.company_id,'record_id',u.record_id,'filename',u.filename,'mime_type',u.mime_type,'storage_path',u.storage_path,'expires_at',u.expires_at,'status',u.status);
END $$;
CREATE FUNCTION public.mcp_cost_receipt_upload_get(_job uuid,_record uuid,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_cost_receipt_uploads;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_cost_own_field_receipt_access(_job,_record) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Your own assigned field submission is required.'; END IF;
 SELECT * INTO u FROM public.mcp_cost_receipt_uploads WHERE id=_id AND job_id=_job AND record_id=_record AND created_by=auth.uid();
 IF u.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',u.id,'job_id',u.job_id,'company_id',u.company_id,'record_id',u.record_id,'filename',u.filename,'mime_type',u.mime_type,'storage_path',u.storage_path,'expires_at',u.expires_at,'status',u.status);
END $$;
CREATE FUNCTION public.mcp_cost_receipt_upload_claim(_id uuid,_actor uuid,_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_cost_receipt_uploads; previous_claims text:=current_setting('request.jwt.claims',true); result jsonb;
BEGIN
 SELECT * INTO u FROM public.mcp_cost_receipt_uploads WHERE id=_id FOR UPDATE;
 IF u.id IS NULL OR ((_actor IS NULL OR _actor IS DISTINCT FROM u.created_by) AND (_token_hash IS NULL OR _token_hash IS DISTINCT FROM u.token_hash)) THEN RAISE EXCEPTION 'MCP_BAD:That upload is unavailable.'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u.created_by,'role','authenticated')::text,true);
 PERFORM public.mcp_assert_active();
 IF public.mcp_cost_own_field_receipt_access(u.job_id,u.record_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:That upload is unavailable.'; END IF;
 IF u.expires_at<=now() OR u.attempts>=3 THEN RAISE EXCEPTION 'MCP_BAD:That upload is expired or exhausted.'; END IF;
 UPDATE public.mcp_cost_receipt_uploads SET attempts=attempts+1 WHERE id=u.id;
 result:=jsonb_build_object('id',u.id,'company_id',u.company_id,'job_id',u.job_id,'record_id',u.record_id,'filename',u.filename,'mime_type',u.mime_type,'storage_path',u.storage_path,'status',u.status);
 PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
END $$;
CREATE FUNCTION public.mcp_cost_receipt_register(_job uuid,_record uuid,_id uuid,_size bigint,_sha256 text,_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_cost_receipt_uploads; d public.mcp_cost_receipts; previous_claims text:=current_setting('request.jwt.claims',true); result jsonb;
BEGIN
 IF _actor IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Verified member required.'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 PERFORM public.mcp_assert_active();
 IF public.mcp_cost_own_field_receipt_access(_job,_record) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:That upload is unavailable.'; END IF;
 SELECT * INTO u FROM public.mcp_cost_receipt_uploads WHERE id=_id AND job_id=_job AND record_id=_record AND created_by=_actor FOR UPDATE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That upload is unavailable.'; END IF;
 SELECT * INTO d FROM public.mcp_cost_receipts WHERE id=_id;
 IF d.id IS NOT NULL THEN
  IF d.sha256 IS DISTINCT FROM _sha256 OR d.size_bytes IS DISTINCT FROM _size THEN RAISE EXCEPTION 'MCP_BAD:Upload does not match the stored receipt.'; END IF;
  result:=jsonb_build_object('id',d.id,'already_stored',true);
 ELSE
  IF u.status<>'open' OR u.expires_at<=now() OR _size NOT BETWEEN 1 AND 10485760 OR _sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Upload is expired or invalid.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='athena-financial-documents' AND name=u.storage_path) THEN RAISE EXCEPTION 'MCP_BAD:Original file is not stored.'; END IF;
  INSERT INTO public.mcp_cost_receipts(id,company_id,job_id,record_id,filename,mime_type,storage_path,size_bytes,sha256,created_by)
  VALUES(u.id,u.company_id,u.job_id,u.record_id,u.filename,u.mime_type,u.storage_path,_size,_sha256,_actor);
  UPDATE public.mcp_cost_receipt_uploads SET status='finished' WHERE id=u.id;
  -- mcp_audit_job excludes the superintendent role; record the already verified actor directly.
  INSERT INTO public.mcp_audit_log(actor,company_id,job_number,tool,action,object_id)
    SELECT _actor,j.company_id,left(j.job_number,60),'cost_receipt','store_original',u.id::text FROM public.mcp_jobs j WHERE j.id=_job AND j.company_id=u.company_id;
  result:=jsonb_build_object('id',u.id,'already_stored',false);
 END IF;
 PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
END $$;
-- Returns metadata for precisely one linked receipt. No bucket permission or signed URL is granted.
CREATE FUNCTION public.mcp_cost_receipt_get(_job uuid,_record uuid,_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.mcp_cost_receipts; company uuid; allowed boolean;
BEGIN
 PERFORM public.mcp_assert_active();
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 allowed:=public.mcp_cost_own_field_receipt_access(_job,_record) OR (public.mcp_job_scope(_job)='full' AND public.mcp_cost_accounting_authorized(company));
 IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Receipt unavailable.'; END IF;
 SELECT * INTO d FROM public.mcp_cost_receipts WHERE id=_id AND job_id=_job AND record_id=_record AND company_id=company;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_receipt_upload_begin(uuid,uuid,text,text,text),public.mcp_cost_receipt_upload_get(uuid,uuid,uuid),public.mcp_cost_receipt_upload_claim(uuid,uuid,text),public.mcp_cost_receipt_register(uuid,uuid,uuid,bigint,text,uuid),public.mcp_cost_receipt_get(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_receipt_upload_begin(uuid,uuid,text,text,text),public.mcp_cost_receipt_upload_get(uuid,uuid,uuid),public.mcp_cost_receipt_get(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_receipt_upload_claim(uuid,uuid,text),public.mcp_cost_receipt_register(uuid,uuid,uuid,bigint,text,uuid) TO service_role;
CREATE FUNCTION public.mcp_cost_receipt_list(_job uuid,_record uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE company uuid; allowed boolean;
BEGIN
 PERFORM public.mcp_assert_active();
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 allowed:=public.mcp_cost_own_field_receipt_access(_job,_record) OR (public.mcp_job_scope(_job)='full' AND public.mcp_cost_accounting_authorized(company));
 IF allowed IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.mcp_cost_submissions WHERE id=_record AND anchor_job_id=_job AND company_id=company) THEN RAISE EXCEPTION 'MCP_BAD:Receipt unavailable.'; END IF;
 RETURN jsonb_build_object('receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'filename',d.filename,'size_bytes',d.size_bytes,'sha256',d.sha256,'recorded_at',d.recorded_at) ORDER BY d.recorded_at) FROM public.mcp_cost_receipts d WHERE d.job_id=_job AND d.record_id=_record AND d.company_id=company),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_receipt_list(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_receipt_list(uuid,uuid) TO authenticated;
