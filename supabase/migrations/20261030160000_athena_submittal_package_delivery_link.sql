-- Stage only. Apply through the approved Cloud release, never directly from a workstation.
-- Package drafts may carry the record-page address. Store the file link instead, and leave every other delivery rule as it is.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.mcp_submittal_delivery(_job uuid,_submittal uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ctx jsonb; s public.mcp_submittals; j public.mcp_jobs; m public.mcp_submittal_mail; a public.mcp_submittal_packages; p public.mcp_submittal_package_items; d jsonb; k text; v_context_key text; day date; send_day date; already_approved boolean := false; raw_link text; norm_link text; body text; decoded text; piece text; link_pkg text; record_hit text; guard int;
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
  IF s.package_purpose NOT IN ('rfi','rfc','change_order') AND s.spec_section ~* '^(needed|unknown|n/?a|tbd)$' THEN RAISE EXCEPTION 'MCP_BAD:Which spec section requires this submittal?'; END IF;
  IF k='package' THEN
   SELECT * INTO a FROM public.mcp_submittal_packages WHERE id=(_p->>'package_id')::uuid AND submittal_id=s.id;
   IF a.id IS NULL OR a.revoked_at IS NOT NULL OR a.expires_at<=now() OR a.fingerprint<>ctx->>'fingerprint' THEN RAISE EXCEPTION 'MCP_BAD:Build a current package first.'; END IF;
   -- A host that only saw the record page still saves the file link. Wrappers and a missing link are filled in here.
   -- Revoked, expired, renewed and foreign packages are refused above or below. Draft does not open or rotate the token.
   raw_link := btrim(coalesce(d->>'link',''));
   norm_link := raw_link;
   guard := 0;
   WHILE guard < 8 AND norm_link <> '' LOOP
    guard := guard + 1;
    IF norm_link ~ '^<\s*https://[^[:space:]>]+\s*>$' THEN
     norm_link := btrim(substring(norm_link FROM '<\s*(https://[^[:space:]>]+)\s*>'));
    ELSIF norm_link ~ '^\(\s*https://[^[:space:])]+\s*\)$' THEN
     norm_link := btrim(substring(norm_link FROM '\(\s*(https://[^[:space:])]+)\s*\)'));
    ELSIF norm_link ~ '^\[[^]]*\]\(\s*https://[^[:space:])]+\s*\)$' THEN
     norm_link := btrim(substring(norm_link FROM '\(\s*(https://[^[:space:])]+)\s*\)'));
    ELSIF norm_link ~ '[.,;:!?]$' THEN
     norm_link := regexp_replace(norm_link, '[.,;:!?]+$', '');
    ELSE
     EXIT;
    END IF;
   END LOOP;
   record_hit := NULL;
   IF norm_link ~* ('^https://app\.meetathena\.io/r/job/' || _job::text || '/submittal/[^?[:space:]]+\?') THEN
    link_pkg := lower(substring(norm_link FROM '[?&]package_id=([0-9a-fA-F-]{36})'));
    IF link_pkg IS NOT NULL AND link_pkg IS DISTINCT FROM lower(a.id::text) THEN
     RAISE EXCEPTION 'MCP_BAD:Use this package link exactly: %. It must be the draft link and appear in the body.', a.download_url;
    END IF;
    IF link_pkg = lower(a.id::text) AND norm_link ~* '[?&]open=package(?:&|$)' THEN
     piece := substring(norm_link FROM '/submittal/([^?]+)');
     decoded := '';
     WHILE piece IS NOT NULL AND piece <> '' LOOP
      IF left(piece,1) = '%' AND length(piece) >= 3 AND substring(piece FROM 2 FOR 2) ~ '^[0-9A-Fa-f]{2}$' THEN
       decoded := decoded || convert_from(decode(substring(piece FROM 2 FOR 2), 'hex'), 'UTF8');
       piece := substring(piece FROM 4);
      ELSE
       decoded := decoded || left(piece,1);
       piece := substring(piece FROM 2);
      END IF;
     END LOOP;
     IF lower(btrim(decoded)) = lower(btrim(s.number)) THEN record_hit := norm_link; END IF;
    END IF;
   END IF;
   IF norm_link <> '' AND norm_link IS DISTINCT FROM a.download_url AND record_hit IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Use this package link exactly: %. It must be the draft link and appear in the body.', a.download_url;
   END IF;
   IF coalesce(d->>'link','') IS DISTINCT FROM a.download_url OR position(a.download_url IN coalesce(d->>'body',''))=0 THEN
    body := coalesce(d->>'body','');
    IF position(a.download_url IN body)=0 THEN
     IF record_hit IS NOT NULL AND position(record_hit IN body)>0 THEN
      body := replace(body, record_hit, a.download_url);
     ELSIF raw_link <> '' AND position(raw_link IN body)>0 THEN
      body := replace(body, raw_link, a.download_url);
     END IF;
     IF position(a.download_url IN body)=0 THEN body := body || E'\n' || a.download_url; END IF;
    END IF;
    d := jsonb_set(jsonb_set(d, '{link}', to_jsonb(a.download_url), true), '{body}', to_jsonb(body), true);
   END IF;
   v_context_key:=a.fingerprint;
  ELSIF k='chase' THEN
   IF nullif(_p->>'package_item_id','') IS NOT NULL THEN
    SELECT * INTO p FROM public.mcp_submittal_package_items WHERE id=(_p->>'package_item_id')::uuid AND submittal_id=s.id;
    IF p.id IS NULL OR NOT p.required OR (p.status IN ('received','approved') AND coalesce(p.file_ref,'')<>'') THEN RAISE EXCEPTION 'MCP_BAD:That piece is no longer missing.'; END IF;
    IF coalesce(p.chase_name,'')='' OR p.chase_email IS DISTINCT FROM d->>'to' THEN RAISE EXCEPTION 'MCP_BAD:Confirm the piece contact before drafting.'; END IF;
    v_context_key:=md5(to_jsonb(p)::text);
   ELSE
    IF coalesce(s.chase_name,(SELECT to_name FROM public.mcp_transmittals WHERE id=s.transmittal_id),s.ball_in_court_name,'')='' OR coalesce(s.chase_email,(SELECT to_email FROM public.mcp_transmittals WHERE id=s.transmittal_id)) IS DISTINCT FROM d->>'to' THEN RAISE EXCEPTION 'MCP_BAD:Confirm the submittal contact before drafting.'; END IF;
    v_context_key:=md5((CASE WHEN s.package_purpose='approval' THEN to_jsonb(s)-'package_purpose'-'request_details' ELSE to_jsonb(s) END)::text);
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
   IF m.sent_at IS NULL AND m.context_key IS DISTINCT FROM md5((CASE WHEN s.package_purpose='approval' THEN to_jsonb(s)-'package_purpose'-'request_details' ELSE to_jsonb(s) END)::text) THEN RAISE EXCEPTION 'MCP_BAD:The submittal changed; review a fresh chase draft.'; END IF;
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
    IF s.package_purpose IN ('rfi','rfc','change_order') AND nullif(btrim(_p->>'recipient_name'),'') IS NULL THEN
      _p:=_p || jsonb_build_object('recipient_name',(SELECT nullif(btrim(to_name),'') FROM public.mcp_transmittals
        WHERE id=s.transmittal_id AND lower(to_email)=lower(m.draft->>'to')));
    END IF;
    UPDATE public.mcp_submittal_packages SET sent_at=m.sent_at WHERE id=a.id;
    UPDATE public.mcp_submittals SET status='submitted',submitted_on=(m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date,due_back=CASE WHEN s.package_purpose IN ('rfi','rfc','change_order') THEN CASE WHEN s.package_purpose='change_order' THEN (SELECT nullif(details->>'due_date','')::date FROM public.mcp_change_orders WHERE submittal_id=s.id) ELSE nullif(s.request_details->>'due_date','')::date END ELSE (m.sent_at AT TIME ZONE coalesce(nullif(j.time_zone,''),'America/New_York'))::date+review_days END,ball_in_court='architect_engineer',ball_in_court_name=_p->>'recipient_name',updated_at=now() WHERE id=s.id;
    UPDATE public.mcp_transmittals SET to_email=m.draft->>'to',to_name=_p->>'recipient_name',subject=m.draft->>'subject',sent_on=send_day,cover_note='Package '||a.filename WHERE id=s.transmittal_id;
   ELSIF p.id IS NOT NULL THEN
    UPDATE public.mcp_submittal_package_items SET status='requested',requested_at=coalesce(requested_at,m.sent_at),last_chased_at=m.sent_at,next_chase_at=send_day+7,chase_count=chase_count+1,updated_at=now() WHERE id=p.id;
   ELSE
    UPDATE public.mcp_submittals SET last_chased_at=m.sent_at,next_chase_at=send_day+7,chase_count=chase_count+1,updated_at=now() WHERE id=s.id;
   END IF;
   PERFORM public.mcp_project_record_add(_job,CASE WHEN m.kind='package' THEN 'submittal_sent' ELSE 'submittal_piece_chase' END,'Sent: '||s.number||' revision '||s.revision,'Email to '||(m.draft->>'to')||'. Provider receipt '||m.provider||': '||m.message_id,NULL,m.draft->>'to','mcp_submittal_mail',m.id,jsonb_build_object('provider',m.provider,'message_id',m.message_id,'package_id',m.package_id),'user',_p->>'host',_p->>'thread_ref');
  ELSE RAISE EXCEPTION 'MCP_BAD:Unknown delivery action.';
  END IF;
 END IF;
 RETURN to_jsonb(m)||jsonb_build_object('already_approved',already_approved);
END $$;

REVOKE ALL ON FUNCTION public.mcp_submittal_delivery(uuid,uuid,text,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_delivery(uuid,uuid,text,jsonb) TO authenticated;
COMMIT;
