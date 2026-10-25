-- STAGED. Apply only through the existing Lovable Cloud managed migration flow.
-- RFI/RFC records use the existing submittal files/build/transmittal/delivery engine.
-- Existing approval packages keep their data, hashes, access and behavior.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.mcp_submittals
  ADD COLUMN package_purpose text NOT NULL DEFAULT 'approval'
    CHECK (package_purpose IN ('approval','rfi','rfc','change_order')),
  ADD COLUMN request_details jsonb;
ALTER TABLE public.mcp_submittals DROP CONSTRAINT mcp_submittals_spec_section_check;
ALTER TABLE public.mcp_submittals ADD CONSTRAINT mcp_submittals_spec_section_check
  CHECK (length(spec_section) <= 40 AND
    (package_purpose IN ('rfi','rfc') OR length(btrim(spec_section)) BETWEEN 1 AND 40));
ALTER TABLE public.mcp_submittals ADD CONSTRAINT mcp_submittals_request_content_check
  CHECK (package_purpose NOT IN ('rfi','rfc') OR (
    request_details IS NOT NULL AND jsonb_typeof(request_details)='object'
    AND length(btrim(coalesce(request_details->>'condition',''))) BETWEEN 1 AND 12000
    AND length(btrim(coalesce(request_details->>'question',''))) BETWEEN 1 AND 12000
    AND btrim(request_details->>'condition') !~* '^(needed|unknown|n/?a|tbd|pending|not provided)$'
    AND btrim(request_details->>'question') !~* '^(needed|unknown|n/?a|tbd|pending|not provided)$'
    AND jsonb_typeof(request_details->'references')='array'
    AND jsonb_array_length(request_details->'references') BETWEEN 1 AND 40
    AND request_details->>'state' IN ('draft','answered','closed')
    AND status IN ('in_prep','submitted','in_review','closed')
  ));
CREATE INDEX mcp_submittals_request_log_idx ON public.mcp_submittals(job_id,package_purpose,number,revision DESC)
  WHERE package_purpose IN ('rfi','rfc');

-- An installation still requires its actual spec section. A request can instead
-- cite the actual drawing/detail or field condition; never manufacture a spec.
DO $patch$
DECLARE original text; revised text;
BEGIN
 SELECT pg_get_functiondef('public.mcp_submittal_spec_required()'::regprocedure) INTO original;
 revised:=replace(original,'IF coalesce(btrim(NEW.spec_section)',
   'IF NEW.package_purpose NOT IN (''rfi'',''rfc'') AND coalesce(btrim(NEW.spec_section)');
 IF revised=original THEN RAISE EXCEPTION 'Spec trigger changed; review request integration.'; END IF;
 EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_package_write(uuid,uuid,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,'IF coalesce(btrim(s.spec_section)',
   'IF s.package_purpose NOT IN (''rfi'',''rfc'') AND coalesce(btrim(s.spec_section)');
 revised:=replace(revised,
   'IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->''items'') p WHERE (p->>''required'')::boolean) OR EXISTS',
   'IF (s.package_purpose NOT IN (''rfi'',''rfc'') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx->''items'') p WHERE (p->>''required'')::boolean)) OR EXISTS');
 IF revised=original THEN RAISE EXCEPTION 'Package validation changed; review request integration.'; END IF;
 EXECUTE revised;
END $patch$;

CREATE TABLE public.mcp_request_operations (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  digest text NOT NULL,
  submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,request_id)
);
ALTER TABLE public.mcp_request_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_request_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.mcp_request_operations TO service_role;

-- Outgoing content only: answering a question does not invalidate its sent PDF.
CREATE FUNCTION public.mcp_request_package_content(_details jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_build_object('condition',_details->'condition','question',_details->'question',
   'references',_details->'references','suggested_resolution',_details->'suggested_resolution',
   'recipient_name',_details->'recipient_name','recipient_role',_details->'recipient_role',
   'recipient_email',_details->'recipient_email','due_date',_details->'due_date')
$$;
REVOKE ALL ON FUNCTION public.mcp_request_package_content(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_request_content_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.previous_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.mcp_submittals p
   WHERE p.id=NEW.previous_id AND p.package_purpose<>NEW.package_purpose) THEN
   RAISE EXCEPTION 'MCP_BAD:A revision must keep its package purpose.';
 END IF;
 IF TG_OP='UPDATE' AND OLD.package_purpose IS DISTINCT FROM NEW.package_purpose THEN
   RAISE EXCEPTION 'MCP_BAD:A record cannot change its package purpose.';
 END IF;
 IF NEW.package_purpose IN ('rfi','rfc') THEN
   IF NEW.status='closed' AND NEW.request_details->>'state' IS DISTINCT FROM 'closed' THEN
     RAISE EXCEPTION 'MCP_BAD:Close the answered request explicitly.';
   END IF;
   IF NEW.status='submitted' AND NOT EXISTS(SELECT 1 FROM public.mcp_submittal_mail m
     WHERE m.submittal_id=NEW.id AND m.kind='package' AND m.sent_at IS NOT NULL) THEN
     RAISE EXCEPTION 'MCP_BAD:A successful package send receipt is required.';
   END IF;
   IF TG_OP='UPDATE' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.spec_section IS DISTINCT FROM OLD.spec_section
     OR public.mcp_request_package_content(NEW.request_details) IS DISTINCT FROM public.mcp_request_package_content(OLD.request_details))
     AND coalesce((NEW.request_details->>'record_version')::int,0)<>coalesce((OLD.request_details->>'record_version')::int,0)+1 THEN
     RAISE EXCEPTION 'MCP_BAD:Edit this request through its saved record version.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mcp_request_content_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mcp_request_content_guard BEFORE INSERT OR UPDATE ON public.mcp_submittals
  FOR EACH ROW EXECUTE FUNCTION public.mcp_request_content_guard();

CREATE FUNCTION public.mcp_request_record(_job uuid,_kind text,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; s public.mcp_submittals; prior public.mcp_submittals;
 op public.mcp_request_operations; rid uuid; tid uuid; seq int; tn int; details jsonb;
 sig text; sent boolean; current_state text; answer jsonb; refs jsonb; v int; event_id uuid;
 ref jsonb; bound jsonb; normalized jsonb:='[]'::jsonb;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Managing this package needs full access to its job.'; END IF;
 IF coalesce(_kind,'') NOT IN ('rfi','rfc') OR coalesce(_action,'') NOT IN ('create','edit','answer','close','reopen') THEN
   RAISE EXCEPTION 'MCP_BAD:Choose a request type and supported action.';
 END IF;
 IF _p IS NULL OR jsonb_typeof(_p)<>'object' OR octet_length(_p::text)>100000 THEN
   RAISE EXCEPTION 'MCP_BAD:Request content is missing or too large.';
 END IF;
 rid:=nullif(_p->>'request_id','')::uuid;
 IF rid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request operation ID is required for safe retries.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
 IF _kind='rfc' AND coalesce(public.mcp_company_tier(j.company_id),'') NOT IN ('athena_office','circle','hardcore') THEN
   RAISE EXCEPTION 'MCP_BAD:Bid clarification packages are included in Athena Office, Circle and Hardcore. Your PM tools remain available.';
 END IF;
 sig:=md5(jsonb_build_object('kind',_kind,'action',_action,'payload',_p-'host')::text);
 SELECT * INTO op FROM public.mcp_request_operations WHERE job_id=_job AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id<>auth.uid() OR op.digest<>sig THEN RAISE EXCEPTION 'MCP_BAD:That operation ID already belongs to different content.'; END IF;
   RETURN jsonb_build_object('saved_id',op.submittal_id,'already_applied',true);
 END IF;

 IF _p ? 'references' THEN
   IF jsonb_typeof(_p->'references') IS DISTINCT FROM 'array' OR jsonb_array_length(_p->'references') NOT BETWEEN 1 AND 40 THEN
     RAISE EXCEPTION 'MCP_BAD:Provide at least one real drawing, specification, contract or condition citation.';
   END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(_p->'references') LOOP
     ref:=ref-'source_binding';
     IF nullif(ref->>'source_id','') IS NOT NULL THEN
       IF ref->>'kind' IS DISTINCT FROM 'drawing' THEN RAISE EXCEPTION 'MCP_BAD:Stored source IDs identify drawings; other references use their exact citation.'; END IF;
       SELECT jsonb_build_object('id',d.id,'content_hash',d.content_hash,'storage_version',d.version,
         'filename',d.filename,'record_kind',d.kind,'original_source_id',coalesce(d.parent_id,d.id)) INTO bound
         FROM public.mcp_drawing_versions d WHERE d.id=(ref->>'source_id')::uuid AND d.job_id=_job AND d.company_id=j.company_id;
       IF bound IS NULL THEN RAISE EXCEPTION 'MCP_BAD:The referenced stored drawing is not on this job.'; END IF;
       ref:=ref || jsonb_build_object('source_binding',bound);
     END IF;
     normalized:=normalized || jsonb_build_array(ref);
   END LOOP;
   _p:=jsonb_set(_p,'{references}',normalized);
 END IF;

 IF _action='create' THEN
   IF length(btrim(coalesce(_p->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:A request needs a title.'; END IF;
   SELECT coalesce(max(substring(number FROM '[0-9]+$')::int),0)+1 INTO seq
     FROM public.mcp_submittals WHERE job_id=_job AND number ~ ('^'||upper(_kind)||'-[0-9]{1,8}$');
   SELECT coalesce(max(number),0)+1 INTO tn FROM public.mcp_transmittals WHERE job_id=_job;
   INSERT INTO public.mcp_transmittals(company_id,job_id,number) VALUES(j.company_id,_job,tn) RETURNING id INTO tid;
   details:=jsonb_build_object('condition',_p->>'condition','question',_p->>'question','references',_p->'references',
     'suggested_resolution',_p->'suggested_resolution','recipient_name',_p->'recipient_name',
     'recipient_role',_p->'recipient_role','recipient_email',_p->'recipient_email',
     'due_date',_p->'due_date','due_basis',CASE WHEN nullif(_p->>'due_date','') IS NOT NULL THEN 'member_target' END,
     'state','draft','record_version',1);
   INSERT INTO public.mcp_submittals(company_id,job_id,number,revision,transmittal_id,spec_section,title,
     submittal_type,status,ball_in_court,source,required,package_purpose,request_details,required_by)
   VALUES(j.company_id,_job,upper(_kind)||'-'||lpad(seq::text,greatest(3,length(seq::text)),'0'),0,tid,
     coalesce(_p->>'spec_section',''),_p->>'title','other','in_prep','gc','user',true,_kind,details,
     nullif(_p->>'due_date','')::date) RETURNING * INTO s;
 ELSE
   SELECT * INTO s FROM public.mcp_submittals WHERE job_id=_job AND package_purpose=_kind
     AND ((nullif(_p->>'submittal_id','') IS NOT NULL AND id=(_p->>'submittal_id')::uuid)
       OR (nullif(_p->>'submittal_id','') IS NULL AND lower(number)=lower(_p->>'number'))) ORDER BY revision DESC LIMIT 1 FOR UPDATE;
   IF s.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That request is not on this job.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_submittals newer WHERE newer.job_id=_job AND newer.number=s.number AND newer.revision>s.revision) THEN
     RAISE EXCEPTION 'MCP_BAD:Use the current request revision.';
   END IF;
   details:=s.request_details;
   v:=(details->>'record_version')::int;
   IF nullif(_p->>'expected_version','')::int IS DISTINCT FROM v THEN RAISE EXCEPTION 'MCP_BAD:The request changed. Read it again before saving.'; END IF;
   SELECT EXISTS(SELECT 1 FROM public.mcp_submittal_mail m WHERE m.submittal_id=s.id AND m.kind='package' AND m.sent_at IS NOT NULL) INTO sent;
   current_state:=CASE WHEN details->>'state' IN ('answered','closed') THEN details->>'state' WHEN sent THEN 'sent' ELSE 'draft' END;
   IF _action='edit' THEN
     IF current_state<>'draft' THEN RAISE EXCEPTION 'MCP_BAD:Sent questions are preserved. Reopen to prepare a new revision.'; END IF;
     details:=details || coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(_p)
       WHERE key IN ('condition','question','references','suggested_resolution','recipient_name','recipient_role','recipient_email','due_date')),'{}'::jsonb);
     details:=jsonb_set(details,'{record_version}',to_jsonb(v+1));
     details:=jsonb_set(details,'{due_basis}',to_jsonb(CASE WHEN nullif(details->>'due_date','') IS NOT NULL THEN 'member_target' ELSE '' END));
     UPDATE public.mcp_submittals SET title=coalesce(_p->>'title',title),spec_section=coalesce(_p->>'spec_section',spec_section),
       request_details=details,required_by=nullif(details->>'due_date','')::date,updated_at=now() WHERE id=s.id RETURNING * INTO s;
   ELSIF _action='answer' THEN
     IF current_state<>'sent' THEN RAISE EXCEPTION 'MCP_BAD:Capture an answer against the sent request revision.'; END IF;
     answer:=_p->'answer';
     IF jsonb_typeof(answer) IS DISTINCT FROM 'object' OR length(btrim(coalesce(answer->>'text',''))) NOT BETWEEN 1 AND 12000
       OR length(btrim(coalesce(answer->>'received_from',''))) NOT BETWEEN 1 AND 320
       OR nullif(answer->>'received_at','') IS NULL THEN RAISE EXCEPTION 'MCP_BAD:An answer needs its text, respondent and received time.'; END IF;
     IF (answer->>'received_at')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'MCP_BAD:The received time cannot be in the future.'; END IF;
     details:=details || jsonb_build_object('state','answered','answer',answer,'record_version',v+1);
     UPDATE public.mcp_submittals SET request_details=details,status='in_review',ball_in_court='gc',
       returned_on=((answer->>'received_at')::timestamptz AT TIME ZONE coalesce(nullif(j.time_zone,''),'UTC'))::date,updated_at=now()
       WHERE id=s.id RETURNING * INTO s;
   ELSIF _action='close' THEN
     IF current_state<>'answered' OR coalesce((_p->>'confirmed')::boolean,false) IS NOT TRUE THEN
       RAISE EXCEPTION 'MCP_BAD:Review the answer and explicitly confirm closure.';
     END IF;
     UPDATE public.mcp_submittals SET status='closed',request_details=details || jsonb_build_object('state','closed','record_version',v+1),updated_at=now()
       WHERE id=s.id RETURNING * INTO s;
   ELSIF _action='reopen' THEN
     IF current_state='draft' OR coalesce((_p->>'confirmed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Confirm reopening this sent or answered request as a new draft revision.'; END IF;
     prior:=s;
     SELECT coalesce(max(number),0)+1 INTO tn FROM public.mcp_transmittals WHERE job_id=_job;
     INSERT INTO public.mcp_transmittals(company_id,job_id,number) VALUES(j.company_id,_job,tn) RETURNING id INTO tid;
     details:=(details-'answer') || jsonb_build_object('state','draft','record_version',v+1,'due_date',_p->'due_date',
       'due_basis',CASE WHEN nullif(_p->>'due_date','') IS NOT NULL THEN 'member_target' END);
     INSERT INTO public.mcp_submittals(company_id,job_id,number,revision,previous_id,transmittal_id,spec_section,title,submittal_type,
       status,ball_in_court,source,required,package_purpose,request_details,required_by)
     VALUES(j.company_id,_job,prior.number,prior.revision+1,prior.id,tid,prior.spec_section,prior.title,'other','in_prep','gc','user',true,
       _kind,details,nullif(_p->>'due_date','')::date) RETURNING * INTO s;
     INSERT INTO public.mcp_submittal_package_items(company_id,job_id,submittal_id,kind,source_party,file_ref,status,required)
       SELECT company_id,job_id,s.id,kind,source_party,file_ref,status,required FROM public.mcp_submittal_package_items WHERE submittal_id=prior.id;
   END IF;
 END IF;

 refs:=s.request_details->'references';
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs) NOT BETWEEN 1 AND 40 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(refs) x WHERE jsonb_typeof(x)<>'object'
     OR coalesce(x->>'kind','') NOT IN ('drawing','spec','contract','condition')
     OR length(btrim(coalesce(x->>'citation',''))) NOT BETWEEN 1 AND 2000
     OR btrim(x->>'citation') ~* '^(needed|unknown|n/?a|tbd|pending|not provided)$') THEN
   RAISE EXCEPTION 'MCP_BAD:Cite the drawing/detail, specification, contract or condition for the question.';
 END IF;
 IF nullif(s.request_details->>'recipient_email','') IS NOT NULL AND
   (length(s.request_details->>'recipient_email')>320 OR s.request_details->>'recipient_email' ~ '[\r\n]' OR
     s.request_details->>'recipient_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
   RAISE EXCEPTION 'MCP_BAD:Use one valid recipient email address.';
 END IF;
 INSERT INTO public.mcp_request_operations(job_id,request_id,actor_id,digest,submittal_id)
 VALUES(_job,rid,auth.uid(),sig,s.id);
 event_id:=public.mcp_project_record_add(_job,_kind||'_'||_action,upper(_kind)||' '||s.number||' · '||s.title,
   CASE _action WHEN 'answer' THEN 'Answer captured; closure remains separate.' WHEN 'close' THEN 'Request closed after confirmation.'
     WHEN 'reopen' THEN 'New draft revision; the earlier sent question and files are preserved.' ELSE 'Request saved. Draft, not sent.' END,
   s.request_details->>'recipient_name',s.request_details->>'recipient_email','mcp_submittals',s.id,
   jsonb_build_object('number',s.number,'revision',s.revision,'package_purpose',_kind,'request_details',s.request_details,'host',_p->>'host'),'user');
 RETURN jsonb_build_object('saved_id',s.id,'number',s.number,'record_version',s.request_details->'record_version','already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_request_record(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_request_record(uuid,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.mcp_request_rows(_job uuid,_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs; rows jsonb; sc text;
BEGIN
 PERFORM public.mcp_assert_active();
 sc:=public.mcp_job_scope(_job);
 IF coalesce(sc,'none') NOT IN ('full','super') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
 IF _kind NOT IN ('rfi','rfc') THEN RAISE EXCEPTION 'MCP_BAD:Choose the RFI or RFC log.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 SELECT coalesce(jsonb_agg(record ORDER BY record->>'number'),'[]') INTO rows FROM (
   SELECT DISTINCT ON (s.number) to_jsonb(s)-'company_id'-'created_by' || jsonb_build_object(
     'transmittal_number',(SELECT number FROM public.mcp_transmittals WHERE id=s.transmittal_id),
     'state',CASE WHEN s.request_details->>'state' IN ('answered','closed') THEN s.request_details->>'state'
       WHEN EXISTS(SELECT 1 FROM public.mcp_submittal_mail m WHERE m.submittal_id=s.id AND m.kind='package' AND m.sent_at IS NOT NULL) THEN 'sent' ELSE 'draft' END)
     AS record FROM public.mcp_submittals s WHERE s.job_id=_job AND s.package_purpose=_kind ORDER BY s.number,s.revision DESC
 ) current_rows;
 RETURN jsonb_build_object('job_id',j.id,'job_number',j.job_number,'job_name',j.name,'time_zone',coalesce(nullif(j.time_zone,''),'UTC'),
   'today',to_char(now() AT TIME ZONE coalesce(nullif(j.time_zone,''),'UTC'),'YYYY-MM-DD'),'read_only',sc<>'full','records',rows);
END $$;
REVOKE ALL ON FUNCTION public.mcp_request_rows(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_request_rows(uuid,text) TO authenticated;

-- Include request content in the existing build snapshot, leaving approval hashes unchanged.
DO $patch$
DECLARE original text; revised text;
BEGIN
 SELECT pg_get_functiondef('public.mcp_submittal_package_context(uuid,uuid)'::regprocedure) INTO original;
 revised:=replace(original,' SELECT to_jsonb(p) INTO artifact',
   E' IF s.package_purpose<>''approval'' THEN snap:=snap || jsonb_build_object(''package_purpose'',s.package_purpose,''request_content'',public.mcp_request_package_content(s.request_details)); END IF;\n SELECT to_jsonb(p) INTO artifact');
 IF revised=original THEN RAISE EXCEPTION 'Package context changed; review request snapshot integration.'; END IF;
 EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_delivery(uuid,uuid,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,'IF s.spec_section ~*','IF s.package_purpose NOT IN (''rfi'',''rfc'') AND s.spec_section ~*');
 -- Existing chase approvals used the old whole-row JSON. Preserve that exact
 -- representation for approval packages after adding the two metadata columns.
 revised:=replace(revised,'md5(to_jsonb(s)::text)',
   'md5((CASE WHEN s.package_purpose=''approval'' THEN to_jsonb(s)-''package_purpose''-''request_details'' ELSE to_jsonb(s) END)::text)');
 revised:=replace(revised,
   $old$due_back=(m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date+review_days$old$,
   $new$due_back=CASE WHEN s.package_purpose IN ('rfi','rfc') THEN nullif(s.request_details->>'due_date','')::date ELSE (m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date+review_days END$new$);
 IF revised=original THEN RAISE EXCEPTION 'Delivery changed; review request target-date integration.'; END IF;
 EXECUTE revised;
END $patch$;

-- Existing internal board capability, restricted to this job's RFI/RFC log.
-- Restore the caller claims even on failure; token reads never grant a write.
CREATE FUNCTION public.mcp_request_log_open(_token_hash text,_job uuid,_kind text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE checked jsonb; payload jsonb; link public.mcp_board_links;
 old_claims text:=current_setting('request.jwt.claims',true);
 old_sub text:=current_setting('request.jwt.claim.sub',true);
 old_role text:=current_setting('request.jwt.claim.role',true);
BEGIN
 IF coalesce(_kind,'') NOT IN ('rfi','rfc') THEN RETURN jsonb_build_object('status','denied','payload',NULL); END IF;
 IF coalesce(_token_hash,'') !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status','unknown','payload',NULL); END IF;
 SELECT * INTO link FROM public.mcp_board_links WHERE token_hash=_token_hash;
 IF link.id IS NULL THEN RETURN jsonb_build_object('status','unknown','payload',NULL); END IF;
 IF link.job_id<>_job THEN RETURN jsonb_build_object('status','wrong_job','payload',NULL); END IF;
 IF link.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status','revoked','payload',NULL); END IF;
 IF link.expires_at<=now() THEN RETURN jsonb_build_object('status','expired','payload',NULL); END IF;
 IF link.scope NOT IN ('full','super') THEN RETURN jsonb_build_object('status','denied','payload',NULL); END IF;
 BEGIN
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',link.created_by::text,'role','authenticated')::text,true);
   PERFORM set_config('request.jwt.claim.sub',link.created_by::text,true);
   PERFORM set_config('request.jwt.claim.role','authenticated',true);
   payload:=public.mcp_request_rows(_job,_kind) || jsonb_build_object('read_only',true);
   checked:=jsonb_build_object('status','ok');
   INSERT INTO public.mcp_board_link_opens(link_id,job_id,page) VALUES(link.id,_job,_kind||'s');
   UPDATE public.mcp_board_links SET view_count=view_count+1,last_viewed_at=now() WHERE id=link.id;
 EXCEPTION WHEN OTHERS THEN
   checked:=jsonb_build_object('status',CASE WHEN SQLERRM ~ 'MCP_NO_JOB|MCP_INACTIVE' THEN 'denied' ELSE 'unavailable' END); payload:=NULL;
 END;
 PERFORM set_config('request.jwt.claims',coalesce(old_claims,'{}'),true);
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 PERFORM set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 RETURN jsonb_build_object('status',coalesce(checked->>'status','unknown'),'payload',payload);
END $$;
REVOKE ALL ON FUNCTION public.mcp_request_log_open(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_request_log_open(text,uuid,text) TO anon,authenticated;
