-- Stage only. Apply through the approved Cloud release, never directly from a workstation.
-- Immutable source files and versioned packages; approval and actual send are separate records.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE public.mcp_submittal_packages (
 id uuid PRIMARY KEY, company_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id), fingerprint text NOT NULL,
 path text NOT NULL UNIQUE, filename text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 52428800),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), page_count int NOT NULL CHECK(page_count BETWEEN 1 AND 500),
 cover_date date NOT NULL, manifest jsonb NOT NULL, token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 signed_url text NOT NULL, download_url text NOT NULL, expires_at timestamptz NOT NULL,
 preview_hash text UNIQUE, preview_expires_at timestamptz, preview_signed_url text, sent_at timestamptz, approved_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(submittal_id,fingerprint)
);
CREATE TABLE public.mcp_submittal_mail (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id), package_id uuid REFERENCES public.mcp_submittal_packages(id),
 package_item_id uuid REFERENCES public.mcp_submittal_package_items(id), kind text NOT NULL CHECK(kind IN ('package','chase')),
 draft jsonb NOT NULL, draft_key text NOT NULL, context_key text NOT NULL,
 approved_at timestamptz, sent_at timestamptz, provider text, message_id text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(submittal_id,kind,draft_key,context_key),
 CHECK((sent_at IS NULL) OR (approved_at IS NOT NULL AND length(message_id)>0 AND length(provider)>0)),
 CHECK((kind='package')=(package_id IS NOT NULL))
);
CREATE UNIQUE INDEX mcp_submittal_mail_receipt ON public.mcp_submittal_mail(provider,message_id) WHERE sent_at IS NOT NULL;
CREATE INDEX ON public.mcp_submittal_packages(job_id,submittal_id);
CREATE INDEX ON public.mcp_submittal_mail(job_id,submittal_id);
ALTER TABLE public.mcp_submittal_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_submittal_mail ENABLE ROW LEVEL SECURITY;
CREATE POLICY "package read" ON public.mcp_submittal_packages FOR SELECT TO authenticated USING(public.mcp_gate() AND public.mcp_job_scope(job_id) IN ('full','super'));
CREATE POLICY "submittal draft read" ON public.mcp_submittal_mail FOR SELECT TO authenticated USING(public.mcp_gate() AND public.mcp_job_scope(job_id)='full');
REVOKE ALL ON public.mcp_submittal_packages,public.mcp_submittal_mail FROM public,anon,authenticated;
GRANT SELECT ON public.mcp_submittal_packages,public.mcp_submittal_mail TO authenticated;
GRANT ALL ON public.mcp_submittal_packages,public.mcp_submittal_mail TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('athena-submittals','athena-submittals',false,52428800,ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'])
ON CONFLICT(id) DO NOTHING;
CREATE FUNCTION public.mcp_submittal_path_scope(_name text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE parts text[]:=string_to_array(_name,'/'); j uuid; c uuid;
BEGIN
 PERFORM public.mcp_assert_active();
 IF array_length(parts,1)<>5 OR parts[3] NOT IN ('pieces','packages') OR parts[5] IN ('','.','..') THEN RETURN NULL; END IF;
 BEGIN j:=parts[2]::uuid; c:=parts[1]::uuid; PERFORM parts[4]::uuid; EXCEPTION WHEN others THEN RETURN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE id=j AND company_id=c) THEN RETURN NULL; END IF;
 RETURN public.mcp_job_scope(j);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_path_scope(text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_path_scope(text) TO authenticated;
CREATE POLICY "submittal files insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='athena-submittals' AND public.mcp_submittal_path_scope(name)='full');
CREATE POLICY "submittal files read" ON storage.objects FOR SELECT TO authenticated USING(bucket_id='athena-submittals' AND public.mcp_submittal_path_scope(name) IN ('full','super'));
-- No UPDATE/DELETE policy: received documents and historical packages are preserved.

CREATE FUNCTION public.mcp_submittal_package_context(_job uuid,_submittal uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.mcp_submittals; j public.mcp_jobs; brand jsonb; items jsonb; snap jsonb; artifact jsonb;
BEGIN
 PERFORM public.mcp_assert_active();
 IF coalesce(public.mcp_job_scope(_job),'none') NOT IN ('full','super') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
 SELECT * INTO s FROM public.mcp_submittals WHERE id=_submittal AND job_id=_job;
 IF s.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That submittal is not on this job.'; END IF;

 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 SELECT jsonb_build_object('name',name,'logo_url',logo_url,'license_number',license_number,'contact_name',contact_name,'contact_phone',contact_phone,'website',website) INTO brand FROM public.mcp_companies WHERE id=j.company_id;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at,p.id),'[]') INTO items FROM public.mcp_submittal_package_items p WHERE submittal_id=s.id;
 snap:=jsonb_build_object('number',s.number,'revision',s.revision,'title',s.title,'spec_section',s.spec_section,'transmittal_id',s.transmittal_id,'brand',brand,'job_number',j.job_number,'job_name',j.name,'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','kind',p->>'kind','source_party',p->>'source_party','status',p->>'status','required',p->'required','file_ref',p->>'file_ref') ORDER BY p->>'id'),'[]') FROM jsonb_array_elements(items) p));
 SELECT to_jsonb(p) INTO artifact FROM public.mcp_submittal_packages p WHERE submittal_id=s.id AND (fingerprint=md5(snap::text) OR EXISTS(SELECT 1 FROM public.mcp_submittals newer WHERE newer.job_id=_job AND lower(btrim(newer.number))=lower(btrim(s.number)) AND newer.revision>s.revision)) ORDER BY (fingerprint=md5(snap::text)) DESC,created_at DESC LIMIT 1;
 RETURN jsonb_build_object('is_current',NOT EXISTS(SELECT 1 FROM public.mcp_submittals newer WHERE newer.job_id=_job AND lower(btrim(newer.number))=lower(btrim(s.number)) AND newer.revision>s.revision),'submittal',to_jsonb(s),'items',items,'brand',brand,'job_number',j.job_number,'job_name',j.name,'today',to_char(now() AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'),'YYYY-MM-DD'),'transmittal_number',(SELECT number FROM public.mcp_transmittals WHERE id=s.transmittal_id),'fingerprint',md5(snap::text),'package',artifact);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_package_context(uuid,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_package_context(uuid,uuid) TO authenticated;

CREATE FUNCTION public.mcp_submittal_package_write(_job uuid,_submittal uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ctx jsonb; s public.mcp_submittals; j public.mcp_jobs; pid uuid; path text; artifact public.mcp_submittal_packages;
BEGIN
 PERFORM public.mcp_assert_active();
 IF coalesce(public.mcp_job_scope(_job),'none')<>'full' THEN RAISE EXCEPTION 'MCP_BAD:Full job access is required.'; END IF;
 PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 ctx:=public.mcp_submittal_package_context(_job,_submittal);
 IF _action NOT IN ('get','revoke') AND (ctx->>'is_current')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Use the latest revision from the living log.'; END IF;
 SELECT * INTO s FROM public.mcp_submittals WHERE id=_submittal;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 IF _action='attach' THEN
  pid:=(_p->>'item_id')::uuid; path:=_p->>'path';
  IF NOT EXISTS(SELECT 1 FROM public.mcp_submittal_package_items WHERE id=pid AND submittal_id=s.id) THEN RAISE EXCEPTION 'MCP_BAD:That piece is not on this submittal.'; END IF;
  IF path NOT LIKE j.company_id::text||'/'||_job::text||'/pieces/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='athena-submittals' AND name=path) THEN RAISE EXCEPTION 'MCP_BAD:The received file must be stored on this job.'; END IF;
  UPDATE public.mcp_submittal_package_items SET file_ref='athena-submittals/'||path,status='received',received_at=now(),next_chase_at=NULL,updated_at=now() WHERE id=pid;
 ELSIF _action='save' THEN
  IF _p->>'fingerprint' IS DISTINCT FROM ctx->>'fingerprint' OR _p->>'cover_date' IS DISTINCT FROM ctx->>'today' THEN RAISE EXCEPTION 'MCP_BAD:The package changed while building; build it again.'; END IF;
  IF coalesce(btrim(s.spec_section),'') ~* '^(|needed|unknown|n/?a|tbd)$' THEN RAISE EXCEPTION 'MCP_BAD:Which spec section requires this submittal?'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'items') p WHERE (p->>'required')::boolean) OR EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'items') p WHERE (p->>'required')::boolean AND (p->>'status' NOT IN ('received','approved') OR coalesce(btrim(p->>'file_ref'),'')='')) THEN RAISE EXCEPTION 'MCP_BAD:Collect every required piece and its stored file before building.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->'items') p WHERE (p->>'required')::boolean AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=split_part(p->>'file_ref','/',1) AND o.bucket_id IN ('athena-submittals','athena-files','athena-drawings') AND o.name=substring(p->>'file_ref' FROM position('/' IN p->>'file_ref')+1) AND o.name LIKE j.company_id::text||'/'||_job::text||'/%')) THEN RAISE EXCEPTION 'MCP_BAD:A required source file is missing from this job storage.'; END IF;
  pid:=(_p->>'id')::uuid; path:=_p->>'path';
  IF path NOT LIKE j.company_id::text||'/'||_job::text||'/packages/'||pid::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='athena-submittals' AND name=path) THEN RAISE EXCEPTION 'MCP_BAD:The package file is not stored on this job.'; END IF;
  IF _p->>'signed_url' !~ '^https://' OR _p->>'signed_url' NOT LIKE '%/storage/v1/object/sign/athena-submittals/'||path||'?token=%' OR _p->>'download_url' !~ '^https://app\.meetathena\.io/(f|r/submittal-file)/[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'MCP_BAD:The package link is invalid.'; END IF;
  IF (_p->>'expires_at')::timestamptz>now()+interval '31 days' OR (_p->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'MCP_BAD:The package link expiry is invalid.'; END IF;
  INSERT INTO public.mcp_submittal_packages(id,company_id,job_id,submittal_id,fingerprint,path,filename,size_bytes,sha256,page_count,cover_date,manifest,token_hash,signed_url,download_url,expires_at)
  VALUES(pid,j.company_id,_job,s.id,ctx->>'fingerprint',path,_p->>'filename',(_p->>'size_bytes')::bigint,_p->>'sha256',(_p->>'page_count')::int,(_p->>'cover_date')::date,_p->'manifest',_p->>'token_hash',_p->>'signed_url',_p->>'download_url',(_p->>'expires_at')::timestamptz)
  ON CONFLICT(submittal_id,fingerprint) DO NOTHING;
 ELSIF _action='renew' THEN
  SELECT * INTO artifact FROM public.mcp_submittal_packages WHERE id=(_p->>'package_id')::uuid AND submittal_id=s.id;
  IF artifact.id IS NULL OR artifact.fingerprint<>ctx->>'fingerprint' THEN RAISE EXCEPTION 'MCP_BAD:Build a current package first.'; END IF;
  IF _p->>'signed_url' NOT LIKE '%/storage/v1/object/sign/athena-submittals/'||artifact.path||'?token=%' OR _p->>'download_url' !~ '^https://app\.meetathena\.io/r/submittal-file/[A-Za-z0-9_-]{43}$' OR (_p->>'expires_at')::timestamptz>now()+interval '31 days' OR (_p->>'expires_at')::timestamptz<=now() THEN RAISE EXCEPTION 'MCP_BAD:Invalid renewed package link.'; END IF;
  UPDATE public.mcp_submittal_packages SET token_hash=_p->>'token_hash',signed_url=_p->>'signed_url',download_url=_p->>'download_url',expires_at=(_p->>'expires_at')::timestamptz,approved_at=NULL,revoked_at=NULL WHERE id=artifact.id;
 ELSIF _action='revoke' THEN
  UPDATE public.mcp_submittal_packages SET revoked_at=now(),preview_hash=NULL WHERE id=(_p->>'package_id')::uuid AND submittal_id=s.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:That package is not on this submittal.'; END IF;
 ELSE RAISE EXCEPTION 'MCP_BAD:Unknown package action.';
 END IF;
 RETURN public.mcp_submittal_package_context(_job,s.id);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_package_write(uuid,uuid,text,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_package_write(uuid,uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.mcp_submittal_delivery(_job uuid,_submittal uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ctx jsonb; s public.mcp_submittals; j public.mcp_jobs; m public.mcp_submittal_mail; a public.mcp_submittal_packages; p public.mcp_submittal_package_items; d jsonb; k text; v_context_key text; day date; send_day date; already_approved boolean := false;
BEGIN
 PERFORM public.mcp_assert_active();
 IF coalesce(public.mcp_job_scope(_job),'none')<>'full' THEN RAISE EXCEPTION 'MCP_BAD:Full job access is required.'; END IF;
 PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 ctx:=public.mcp_submittal_package_context(_job,_submittal);
 IF _action NOT IN ('get','revoke') AND (ctx->>'is_current')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Use the latest revision from the living log.'; END IF;
 SELECT * INTO s FROM public.mcp_submittals WHERE id=_submittal;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 day:=(ctx->>'today')::date;
 IF _action='draft' THEN
  d:=_p->'draft'; k:=_p->>'kind';
  IF coalesce(d->>'to','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR coalesce(length(btrim(d->>'body')),0)=0 OR coalesce(length(btrim(d->>'subject')),0)=0 OR jsonb_typeof(d->'cc') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MCP_BAD:The draft needs a valid recipient, subject and body.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'cc') e WHERE e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'MCP_BAD:Check the CC addresses.'; END IF;
  IF s.spec_section ~* '^(needed|unknown|n/?a|tbd)$' THEN RAISE EXCEPTION 'MCP_BAD:Which spec section requires this submittal?'; END IF;
  IF k='package' THEN
   SELECT * INTO a FROM public.mcp_submittal_packages WHERE id=(_p->>'package_id')::uuid AND submittal_id=s.id;
   IF a.id IS NULL OR a.revoked_at IS NOT NULL OR a.expires_at<=now() OR a.fingerprint<>ctx->>'fingerprint' THEN RAISE EXCEPTION 'MCP_BAD:Build a current package first.'; END IF;
   IF d->>'link' IS DISTINCT FROM a.download_url OR position(a.download_url IN d->>'body')=0 THEN RAISE EXCEPTION 'MCP_BAD:The draft must include this exact package link.'; END IF;
   v_context_key:=a.fingerprint;
  ELSIF k='chase' THEN
   IF nullif(_p->>'package_item_id','') IS NOT NULL THEN
    SELECT * INTO p FROM public.mcp_submittal_package_items WHERE id=(_p->>'package_item_id')::uuid AND submittal_id=s.id;
    IF p.id IS NULL OR NOT p.required OR (p.status IN ('received','approved') AND coalesce(p.file_ref,'')<>'') THEN RAISE EXCEPTION 'MCP_BAD:That piece is no longer missing.'; END IF;
    IF coalesce(p.chase_name,'')='' OR p.chase_email IS DISTINCT FROM d->>'to' THEN RAISE EXCEPTION 'MCP_BAD:Confirm the piece contact before drafting.'; END IF;
    v_context_key:=md5(to_jsonb(p)::text);
   ELSE
    IF coalesce(s.chase_name,(SELECT to_name FROM public.mcp_transmittals WHERE id=s.transmittal_id),s.ball_in_court_name,'')='' OR coalesce(s.chase_email,(SELECT to_email FROM public.mcp_transmittals WHERE id=s.transmittal_id)) IS DISTINCT FROM d->>'to' THEN RAISE EXCEPTION 'MCP_BAD:Confirm the submittal contact before drafting.'; END IF;
    v_context_key:=md5(to_jsonb(s)::text);
   END IF;
  ELSE RAISE EXCEPTION 'MCP_BAD:Choose package or chase.';
  END IF;
  SELECT * INTO m FROM public.mcp_submittal_mail WHERE submittal_id=s.id AND kind=k AND draft=d AND context_key=v_context_key;
  IF m.id IS NULL THEN
   INSERT INTO public.mcp_submittal_mail(company_id,job_id,submittal_id,package_id,package_item_id,kind,draft,draft_key,context_key)
   VALUES(j.company_id,_job,s.id,a.id,p.id,k,d,replace(gen_random_uuid()::text,'-',''),v_context_key) RETURNING * INTO m;
  END IF;
 ELSE
  SELECT * INTO m FROM public.mcp_submittal_mail WHERE id=(_p->>'delivery_id')::uuid AND submittal_id=s.id FOR UPDATE;
  IF m.id IS NULL OR m.draft_key IS DISTINCT FROM _p->>'draft_key' THEN RAISE EXCEPTION 'MCP_BAD:Show the exact saved draft before approval.'; END IF;
  IF _action='get' THEN RETURN to_jsonb(m); END IF;
  IF m.kind='package' THEN
   SELECT * INTO a FROM public.mcp_submittal_packages WHERE id=m.package_id;
   IF a.revoked_at IS NOT NULL OR a.expires_at<=now() OR a.fingerprint<>ctx->>'fingerprint' OR m.draft->>'link' IS DISTINCT FROM a.download_url THEN RAISE EXCEPTION 'MCP_BAD:The package changed or expired; build and review a new draft.'; END IF;
  ELSIF m.package_item_id IS NOT NULL THEN
   SELECT * INTO p FROM public.mcp_submittal_package_items WHERE id=m.package_item_id;
   IF m.sent_at IS NULL AND m.context_key IS DISTINCT FROM md5(to_jsonb(p)::text) THEN RAISE EXCEPTION 'MCP_BAD:The piece changed; review a fresh chase draft.'; END IF;
  ELSE
   IF m.sent_at IS NULL AND m.context_key IS DISTINCT FROM md5(to_jsonb(s)::text) THEN RAISE EXCEPTION 'MCP_BAD:The submittal changed; review a fresh chase draft.'; END IF;
  END IF;
  IF _action='approve' THEN
   already_approved:=m.approved_at IS NOT NULL;
   IF coalesce((_p->>'confirmed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Wait for the member''s yes.'; END IF;
   UPDATE public.mcp_submittal_mail SET approved_at=coalesce(approved_at,now()) WHERE id=m.id RETURNING * INTO m;
   IF a.id IS NOT NULL THEN UPDATE public.mcp_submittal_packages SET approved_at=coalesce(approved_at,now()) WHERE id=a.id; END IF;
  ELSIF _action='record_sent' THEN
   IF m.approved_at IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This draft has not been approved.'; END IF;
   IF coalesce(length(btrim(_p->>'provider')),0) NOT BETWEEN 1 AND 80 OR coalesce(length(btrim(_p->>'message_id')),0) NOT BETWEEN 1 AND 300 OR nullif(_p->>'sent_at','') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Record the successful email provider receipt, not an intention to send.'; END IF;
   IF (_p->>'sent_at')::timestamptz>now()+interval '5 minutes' OR (_p->>'sent_at')::timestamptz<m.approved_at-interval '1 minute' THEN RAISE EXCEPTION 'MCP_BAD:The receipt time must follow approval.'; END IF;
   IF m.sent_at IS NOT NULL THEN
    IF m.provider IS DISTINCT FROM _p->>'provider' OR m.message_id IS DISTINCT FROM _p->>'message_id' THEN RAISE EXCEPTION 'MCP_BAD:This draft already has a different send receipt.'; END IF;
    RETURN to_jsonb(m);
   END IF;
   UPDATE public.mcp_submittal_mail SET provider=_p->>'provider',message_id=_p->>'message_id',sent_at=(_p->>'sent_at')::timestamptz WHERE id=m.id RETURNING * INTO m;
   send_day:=(m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date;
   IF m.kind='package' THEN
    UPDATE public.mcp_submittal_packages SET sent_at=m.sent_at WHERE id=a.id;
    UPDATE public.mcp_submittals SET status='submitted',submitted_on=(m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date,due_back=(m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date+review_days,ball_in_court='architect_engineer',ball_in_court_name=_p->>'recipient_name',updated_at=now() WHERE id=s.id;
    UPDATE public.mcp_transmittals SET to_email=m.draft->>'to',to_name=_p->>'recipient_name',subject=m.draft->>'subject',sent_on=send_day,cover_note='Package '||a.filename WHERE id=s.transmittal_id;
   ELSIF p.id IS NOT NULL THEN
    UPDATE public.mcp_submittal_package_items SET status='requested',requested_at=coalesce(requested_at,m.sent_at),last_chased_at=m.sent_at,next_chase_at=send_day+7,chase_count=chase_count+1,updated_at=now() WHERE id=p.id;
   ELSE
    UPDATE public.mcp_submittals SET last_chased_at=m.sent_at,next_chase_at=send_day+7,chase_count=chase_count+1,updated_at=now() WHERE id=s.id;
   END IF;
   PERFORM public.mcp_project_record_add(_job,CASE WHEN m.kind='package' THEN 'submittal_sent' ELSE 'submittal_piece_chase' END,'Sent: '||s.number||' revision '||s.revision,'Email to '||(m.draft->>'to')||'. Provider receipt '||m.provider||': '||m.message_id,NULL,m.draft->>'to','mcp_submittal_mail',m.id,jsonb_build_object('provider',m.provider,'message_id',m.message_id,'package_id',m.package_id),'user');
  ELSE RAISE EXCEPTION 'MCP_BAD:Unknown delivery action.';
  END IF;
 END IF;
 RETURN to_jsonb(m)||jsonb_build_object('already_approved',already_approved);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_delivery(uuid,uuid,text,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_delivery(uuid,uuid,text,jsonb) TO authenticated;

-- Preserve every existing file-share response. Package capabilities activate only after the reviewed draft's yes.
ALTER FUNCTION public.mcp_file_share_open(text,boolean) RENAME TO mcp_file_share_open_before_packages;
REVOKE ALL ON FUNCTION public.mcp_file_share_open_before_packages(text,boolean) FROM public,anon,authenticated;
CREATE FUNCTION public.mcp_file_share_open(_token_hash text,_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.mcp_submittal_packages; legacy jsonb;
BEGIN
 legacy:=public.mcp_file_share_open_before_packages(_token_hash,_count);
 IF legacy IS NOT NULL THEN RETURN legacy; END IF;
 SELECT * INTO a FROM public.mcp_submittal_packages WHERE token_hash=_token_hash AND approved_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now();
 IF a.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('filename',a.filename,'mime_type','application/pdf','size_bytes',a.size_bytes,'signed_url',a.signed_url,'package_path',a.path);
END $$;
REVOKE ALL ON FUNCTION public.mcp_file_share_open(text,boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_file_share_open(text,boolean) TO anon,authenticated;

-- Chase only registered, current submittals, one target per missing required piece.
CREATE OR REPLACE FUNCTION public.mcp_submittal_chase_rows(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.mcp_jobs; sc text; today date; rows jsonb;
BEGIN
 PERFORM public.mcp_assert_active(); sc:=public.mcp_job_scope(_job);
 IF coalesce(sc,'none') NOT IN ('full','super') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 today:=(now() AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date;
 WITH current_subs AS (SELECT DISTINCT ON(lower(btrim(number))) * FROM public.mcp_submittals WHERE job_id=_job ORDER BY lower(btrim(number)),revision DESC,id DESC), targets AS (
 SELECT s.id AS submittal_id,p.id AS package_item_id,s.number,s.revision,s.title,s.spec_section,s.status,s.ball_in_court,s.ball_in_court_name,s.required_by,s.submitted_on,s.due_back,s.returned_on,
 ((s.required_by<today AND s.submitted_on IS NULL) OR (s.due_back<today AND s.returned_on IS NULL)) IS TRUE AS overdue,
 CASE WHEN p.id IS NOT NULL THEN replace(p.kind,'_',' ')||' from '||p.source_party ELSE '' END AS missing,
 CASE WHEN p.id IS NULL THEN s.chase_role ELSE p.chase_role END AS chase_role,
 CASE WHEN p.id IS NULL THEN coalesce(s.chase_name,(SELECT to_name FROM public.mcp_transmittals WHERE id=s.transmittal_id),s.ball_in_court_name) ELSE p.chase_name END AS chase_name,
 CASE WHEN p.id IS NULL THEN coalesce(s.chase_email,(SELECT to_email FROM public.mcp_transmittals WHERE id=s.transmittal_id)) ELSE p.chase_email END AS chase_email,
 CASE WHEN p.id IS NULL THEN s.chase_count ELSE p.chase_count END AS chase_count,
 CASE WHEN p.id IS NULL THEN s.last_chased_at ELSE p.last_chased_at END AS last_chased_at,
 CASE WHEN p.id IS NULL THEN s.next_chase_at ELSE p.next_chase_at END AS next_chase_at
 FROM current_subs s LEFT JOIN public.mcp_submittal_package_items p ON p.submittal_id=s.id AND p.required AND (p.status NOT IN ('received','approved') OR coalesce(btrim(p.file_ref),'')='')
 WHERE s.required AND (p.id IS NOT NULL OR s.status NOT IN ('closed','approved','approved_as_noted'))
 ) SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.overdue DESC,t.number,t.package_item_id),'[]') INTO rows FROM targets t WHERE t.missing<>'' OR t.overdue;
 RETURN jsonb_build_object('job_number',j.job_number,'job_name',j.name,'today',to_char(today,'YYYY-MM-DD'),'read_only',sc<>'full','chases',rows);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_chase_rows(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_chase_rows(uuid) TO authenticated;

-- Only the receipt-backed delivery function may advance legacy chase counters.
REVOKE EXECUTE ON FUNCTION public.mcp_submittal_chase_mark(uuid,uuid,text,text,text) FROM authenticated;

-- The living page and tool share the same delivery evidence, including historical revisions.
ALTER FUNCTION public.mcp_submittal_rows(uuid) RENAME TO mcp_submittal_rows_before_packages;
REVOKE ALL ON FUNCTION public.mcp_submittal_rows_before_packages(uuid) FROM public,anon,authenticated;
CREATE FUNCTION public.mcp_submittal_rows(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE result jsonb; rows jsonb;
BEGIN
 result:=public.mcp_submittal_rows_before_packages(_job);
 SELECT coalesce(jsonb_agg(s||jsonb_build_object('submission_sent_at',(SELECT max(p.sent_at) FROM public.mcp_submittal_packages p WHERE p.submittal_id=(s->>'id')::uuid))),'[]') INTO rows FROM jsonb_array_elements(result->'submittals') s;
 RETURN jsonb_set(result,'{submittals}',rows);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_rows(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_rows(uuid) TO authenticated;

-- Short, private review links work in both host widgets without broadening their existing link policy.
CREATE FUNCTION public.mcp_submittal_preview(_job uuid,_package uuid,_token_hash text,_signed_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 PERFORM public.mcp_assert_active();
 IF coalesce(public.mcp_job_scope(_job),'none') NOT IN ('full','super') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
 IF coalesce(_token_hash,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid preview token.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mcp_submittal_packages WHERE id=_package AND job_id=_job AND _signed_url LIKE '%/storage/v1/object/sign/athena-submittals/'||path||'?token=%') THEN RAISE EXCEPTION 'MCP_BAD:Invalid private preview link.'; END IF;
 UPDATE public.mcp_submittal_packages SET preview_hash=_token_hash,preview_expires_at=now()+interval '10 minutes',preview_signed_url=_signed_url WHERE id=_package AND job_id=_job;
 IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:This package link is off or expired.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_preview(uuid,uuid,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_preview(uuid,uuid,text,text) TO authenticated;
CREATE FUNCTION public.mcp_submittal_preview_open(_token_hash text,_count boolean DEFAULT true) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT jsonb_build_object('filename',filename,'mime_type','application/pdf','size_bytes',size_bytes,'signed_url',preview_signed_url,'package_path',path) FROM public.mcp_submittal_packages WHERE preview_hash=_token_hash AND preview_expires_at>now()
$$;
REVOKE ALL ON FUNCTION public.mcp_submittal_preview_open(text,boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_preview_open(text,boolean) TO anon,authenticated;

-- New submittals/revisions may not use placeholders in place of the requiring spec section.
CREATE FUNCTION public.mcp_submittal_spec_required() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
 IF coalesce(btrim(NEW.spec_section),'') ~* '^(|needed|unknown|n/?a|tbd|pending)$' THEN RAISE EXCEPTION 'MCP_BAD:Which spec section requires this submittal?'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_spec_required() FROM public,anon,authenticated;
CREATE TRIGGER mcp_submittal_spec_required BEFORE INSERT OR UPDATE OF spec_section ON public.mcp_submittals FOR EACH ROW EXECUTE FUNCTION public.mcp_submittal_spec_required();


-- Keep the existing allocator/log logic and grants; resolve its two shadowed RHS values explicitly.
-- The package helper also needs the same job/member checks as its guarded outer tool.
DO $patch$
DECLARE routine regprocedure; definition text; revised text;
BEGIN
 FOREACH routine IN ARRAY ARRAY['public.mcp_submittal_log(uuid,text,jsonb)'::regprocedure,'public.mcp_submittal_items_write(uuid,uuid,uuid,jsonb)'::regprocedure] LOOP
  definition:=pg_get_functiondef(routine);
  revised:=replace(definition,E'AS $function$\n',E'AS $function$\n#variable_conflict use_variable\n');
  IF revised=definition THEN RAISE EXCEPTION 'Submittal function format changed; review this migration before applying.'; END IF;
  IF routine='public.mcp_submittal_items_write(uuid,uuid,uuid,jsonb)'::regprocedure THEN
   revised:=replace(revised,E'BEGIN\n',E'BEGIN\n  PERFORM public.mcp_assert_active();\n  IF public.mcp_job_scope(_job) IS DISTINCT FROM ''full'' OR NOT EXISTS(SELECT 1 FROM public.mcp_submittals s WHERE s.id=_submittal AND s.job_id=_job AND s.company_id=_company) THEN RAISE EXCEPTION ''MCP_BAD:Full access to this job and submittal is required.''; END IF;\n');
   revised:=replace(revised,'UPDATE public.mcp_submittal_package_items SET','UPDATE public.mcp_submittal_package_items AS existing SET');
   revised:=replace(revised,$old$file_ref = nullif(btrim(coalesce(item->>'file_ref', '')), '')$old$,$new$file_ref = CASE WHEN item ? 'file_ref' THEN nullif(btrim(coalesce(item->>'file_ref', '')), '') ELSE existing.file_ref END$new$);
   revised:=replace(revised,'status = st, required = req','status = CASE WHEN item ? ''status'' THEN st ELSE existing.status END, required = CASE WHEN item ? ''required'' THEN req ELSE existing.required END');
   revised:=replace(revised,'chase_role = role','chase_role = CASE WHEN item ? ''chase_role'' THEN role ELSE existing.chase_role END');
   revised:=replace(revised,$old$chase_name = nullif(btrim(coalesce(item->>'chase_name', '')), '')$old$,$new$chase_name = CASE WHEN item ? 'chase_name' THEN nullif(btrim(coalesce(item->>'chase_name', '')), '') ELSE existing.chase_name END$new$);
   revised:=replace(revised,'chase_email = email','chase_email = CASE WHEN item ? ''chase_email'' THEN email ELSE existing.chase_email END');
   revised:=replace(revised,'chase_count = n,','chase_count = CASE WHEN item ? ''chase_count'' THEN n ELSE existing.chase_count END,');
  END IF;
  EXECUTE revised;
 END LOOP;
END $patch$;

COMMIT;
