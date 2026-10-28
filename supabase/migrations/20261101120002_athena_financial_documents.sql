-- Staged only: apply in the coordinated managed migration sequence.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The dedicated bucket is provisioned through Lovable's supported Storage UI, never SQL.
-- Fail closed unless it already exists and is private. There are no authenticated object policies.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='athena-financial-documents' AND public=false) THEN
    RAISE EXCEPTION 'Financial-document storage must be private.';
  END IF;
END $$;

CREATE TABLE public.mcp_billing_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  filename text NOT NULL, mime_type text NOT NULL, storage_path text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','finished')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  expires_at timestamptz NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_billing_documents (
  id uuid PRIMARY KEY REFERENCES public.mcp_billing_uploads(id),
  company_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  filename text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), storage_path text NOT NULL,
  created_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_billing_document_links (
  document_id uuid NOT NULL REFERENCES public.mcp_billing_documents(id),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  invoice_id uuid, invoice_version integer, receipt_id uuid,
  recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((invoice_id IS NOT NULL AND invoice_version IS NOT NULL AND receipt_id IS NULL)
      OR (invoice_id IS NULL AND invoice_version IS NULL AND receipt_id IS NOT NULL)),
  FOREIGN KEY(invoice_id, invoice_version) REFERENCES public.mcp_billing_invoice_versions(invoice_id, version),
  FOREIGN KEY(receipt_id) REFERENCES public.mcp_billing_receipts(id)
);
CREATE UNIQUE INDEX mcp_billing_document_invoice_link_idx ON public.mcp_billing_document_links(document_id, invoice_id, invoice_version) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX mcp_billing_document_receipt_link_idx ON public.mcp_billing_document_links(document_id, receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX mcp_billing_document_links_job_idx ON public.mcp_billing_document_links(job_id);
ALTER TABLE public.mcp_billing_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_billing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_billing_document_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_billing_uploads, public.mcp_billing_documents, public.mcp_billing_document_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_billing_uploads, public.mcp_billing_documents, public.mcp_billing_document_links TO service_role;

CREATE FUNCTION public.mcp_billing_upload_begin(_job uuid, _filename text, _mime text, _token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; u public.mcp_billing_uploads; ident uuid := gen_random_uuid();
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  IF length(coalesce(_filename,'')) NOT BETWEEN 1 AND 120 OR _filename LIKE '%/%' OR _filename LIKE '%\\%' OR _token_hash !~ '^[0-9a-f]{64}$' OR _mime NOT IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/jpeg','image/png') THEN RAISE EXCEPTION 'MCP_BAD:Invalid financial document.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-upload:' || auth.uid()::text, 0));
  IF (SELECT count(*) FROM public.mcp_billing_uploads WHERE created_by=auth.uid() AND created_at > now()-interval '1 hour') >= 12 THEN RAISE EXCEPTION 'MCP_BAD:Too many billing uploads. Please try again later.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
  INSERT INTO public.mcp_billing_uploads(id,company_id,job_id,filename,mime_type,storage_path,token_hash,expires_at,created_by)
  VALUES(ident,j.company_id,_job,_filename,_mime,j.company_id::text||'/'||_job::text||'/'||ident::text||'/'||_filename,_token_hash,now()+interval '2 hours',auth.uid()) RETURNING * INTO u;
  RETURN jsonb_build_object('id',u.id,'job_id',u.job_id,'company_id',u.company_id,'filename',u.filename,'mime_type',u.mime_type,'storage_path',u.storage_path,'expires_at',u.expires_at,'status',u.status);
END $$;

CREATE FUNCTION public.mcp_billing_upload_get(_job uuid, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_billing_uploads;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  SELECT * INTO u FROM public.mcp_billing_uploads WHERE id=_id AND job_id=_job AND created_by=auth.uid();
  IF u.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',u.id,'job_id',u.job_id,'company_id',u.company_id,'filename',u.filename,'mime_type',u.mime_type,'storage_path',u.storage_path,'expires_at',u.expires_at,'status',u.status);
END $$;

-- Each upload attempt is reserved by the server, using either the original member
-- identity or the opaque upload token. Recheck active full job access in both paths.
CREATE FUNCTION public.mcp_billing_upload_claim(_id uuid, _actor uuid, _token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_billing_uploads; previous_claims text := current_setting('request.jwt.claims', true); result jsonb;
BEGIN
  SELECT * INTO u FROM public.mcp_billing_uploads WHERE id=_id FOR UPDATE;
  IF u.id IS NULL OR ((_actor IS NULL OR _actor IS DISTINCT FROM u.created_by) AND (_token_hash IS NULL OR _token_hash IS DISTINCT FROM u.token_hash)) THEN
    RAISE EXCEPTION 'MCP_BAD:That upload is unavailable.';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u.created_by,'role','authenticated')::text,true);
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(u.job_id) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  IF u.expires_at <= now() THEN RAISE EXCEPTION 'MCP_BAD:That upload is expired.'; END IF;
  IF u.attempts >= 3 THEN RAISE EXCEPTION 'MCP_BAD:Too many attempts for this upload. Start a new upload.'; END IF;
  UPDATE public.mcp_billing_uploads SET attempts=attempts+1 WHERE id=u.id;
  result := jsonb_build_object('id',u.id,'company_id',u.company_id,'job_id',u.job_id,'filename',u.filename,'mime_type',u.mime_type,'storage_path',u.storage_path,'status',u.status);
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_billing_upload_claim(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_upload_claim(uuid,uuid,text) TO service_role;

-- Only the server may attest a fingerprint, after reading and validating the stored bytes.
-- It resolves the actor from a verified user token; repeat the normal membership and scope
-- checks here under that actor, and never expose this function to authenticated clients.
CREATE FUNCTION public.mcp_billing_document_register(_job uuid, _id uuid, _size bigint, _sha256 text, _actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.mcp_billing_uploads; d public.mcp_billing_documents; previous_claims text := current_setting('request.jwt.claims', true); result jsonb;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Verified member required.'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  SELECT * INTO u FROM public.mcp_billing_uploads WHERE id=_id AND job_id=_job AND created_by=auth.uid() FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That upload is not available for this project.'; END IF;
  SELECT * INTO d FROM public.mcp_billing_documents WHERE id=_id;
  IF d.id IS NOT NULL THEN
    IF d.sha256 IS DISTINCT FROM _sha256 OR d.size_bytes IS DISTINCT FROM _size THEN RAISE EXCEPTION 'MCP_BAD:Upload does not match the stored document.'; END IF;
    result := jsonb_build_object('id',d.id,'sha256',d.sha256,'size_bytes',d.size_bytes,'already_stored',true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RETURN result;
  END IF;
  IF u.status <> 'open' OR u.expires_at <= now() OR _size NOT BETWEEN 1 AND 10485760 OR _sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Upload is expired or invalid.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='athena-financial-documents' AND name=u.storage_path) THEN RAISE EXCEPTION 'MCP_BAD:Original file is not stored.'; END IF;
  INSERT INTO public.mcp_billing_documents(id,company_id,job_id,filename,mime_type,size_bytes,sha256,storage_path,created_by)
    VALUES(u.id,u.company_id,u.job_id,u.filename,u.mime_type,_size,_sha256,u.storage_path,auth.uid());
  UPDATE public.mcp_billing_uploads SET status='finished' WHERE id=u.id;
  PERFORM public.mcp_audit_job(_job,'billing_document','store_original',u.id::text);
  result := jsonb_build_object('id',u.id,'sha256',_sha256,'size_bytes',_size,'already_stored',false);
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RETURN result;
END $$;

CREATE FUNCTION public.mcp_billing_documents_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  RETURN jsonb_build_object('documents',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.recorded_at DESC) FROM public.mcp_billing_documents d WHERE d.job_id=_job),'[]'::jsonb),
    'links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.recorded_at) FROM public.mcp_billing_document_links l WHERE l.job_id=_job),'[]'::jsonb));
END $$;

CREATE FUNCTION public.mcp_billing_record_document(_job uuid, _action text, _p jsonb, _actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE doc uuid; result jsonb; rid uuid; ver integer; previous_claims text := current_setting('request.jwt.claims', true);
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Verified member required.'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  doc:=nullif(_p->>'document_id','')::uuid;
  IF doc IS NOT NULL AND (_action NOT IN ('invoice','receipt') OR NOT EXISTS(SELECT 1 FROM public.mcp_billing_documents d WHERE d.id=doc AND d.job_id=_job)) THEN RAISE EXCEPTION 'MCP_BAD:That document is not available for this record and project.'; END IF;
  result:=public.mcp_billing_evidence_record(_job,_action,_p);
  IF doc IS NOT NULL THEN
    rid:=nullif(result->>'id','')::uuid;
    IF _action='invoice' THEN
      ver:=nullif(result->>'version','')::integer;
      INSERT INTO public.mcp_billing_document_links(document_id,job_id,invoice_id,invoice_version,recorded_by) VALUES(doc,_job,rid,ver,auth.uid()) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.mcp_billing_document_links(document_id,job_id,receipt_id,recorded_by) VALUES(doc,_job,rid,auth.uid()) ON CONFLICT DO NOTHING;
    END IF;
    IF coalesce((result->>'already_applied')::boolean,false)=false THEN
      PERFORM public.mcp_audit_job(_job,'billing_document','associate_original',doc::text);
    END IF;
  END IF;
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RETURN result;
END $$;

-- Attach a verified original to an existing record without changing financial facts.
-- The verified-document table can only be populated by the server attestation function.
CREATE FUNCTION public.mcp_billing_document_link(_job uuid, _document uuid, _invoice uuid, _version integer, _receipt uuid, _actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE added integer; previous_claims text := current_setting('request.jwt.claims', true); result jsonb;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Verified member required.'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_billing_documents WHERE id=_document AND job_id=_job) THEN RAISE EXCEPTION 'MCP_BAD:That verified document is not available for this project.'; END IF;
  IF _invoice IS NOT NULL AND _version IS NOT NULL AND _receipt IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.mcp_billing_invoice_versions v JOIN public.mcp_billing_invoices i ON i.id=v.invoice_id AND i.job_id=v.job_id WHERE v.job_id=_job AND v.invoice_id=_invoice AND v.version=_version) THEN RAISE EXCEPTION 'MCP_BAD:That invoice version is not available for this project.'; END IF;
    INSERT INTO public.mcp_billing_document_links(document_id,job_id,invoice_id,invoice_version,recorded_by) VALUES(_document,_job,_invoice,_version,auth.uid()) ON CONFLICT DO NOTHING;
  ELSIF _invoice IS NULL AND _version IS NULL AND _receipt IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.mcp_billing_receipts WHERE id=_receipt AND job_id=_job) THEN RAISE EXCEPTION 'MCP_BAD:That receipt is not available for this project.'; END IF;
    INSERT INTO public.mcp_billing_document_links(document_id,job_id,receipt_id,recorded_by) VALUES(_document,_job,_receipt,auth.uid()) ON CONFLICT DO NOTHING;
  ELSE RAISE EXCEPTION 'MCP_BAD:Choose exactly one invoice version or receipt.';
  END IF;
  GET DIAGNOSTICS added = ROW_COUNT;
  IF added=1 THEN PERFORM public.mcp_audit_job(_job,'billing_document','associate_original',_document::text); END IF;
  result := jsonb_build_object('document_id',_document,'invoice_id',_invoice,'invoice_version',_version,'receipt_id',_receipt,'already_linked',added=0);
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_billing_document_link(uuid,uuid,uuid,integer,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_document_link(uuid,uuid,uuid,integer,uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.mcp_billing_upload_begin(uuid,text,text,text), public.mcp_billing_upload_get(uuid,uuid), public.mcp_billing_document_register(uuid,uuid,bigint,text,uuid), public.mcp_billing_documents_get(uuid), public.mcp_billing_record_document(uuid,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_upload_begin(uuid,text,text,text), public.mcp_billing_upload_get(uuid,uuid), public.mcp_billing_documents_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_document_register(uuid,uuid,bigint,text,uuid), public.mcp_billing_record_document(uuid,text,jsonb,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
