-- UNAPPLIED Lovable migration proposal. No direct table privileges.
CREATE TABLE public.mcp_document_email_deliveries (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL,
 actor_id uuid NOT NULL, application_id uuid NOT NULL, application_version integer NOT NULL,
 review_hash text NOT NULL CHECK (review_hash ~ '^[0-9a-f]{64}$'), payload jsonb NOT NULL,
 state text NOT NULL CHECK (state IN ('reviewed','handoff_pending','claimed','uncertain','host_reported_provider_acceptance','cancelled')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_document_email_one_open ON public.mcp_document_email_deliveries(job_id,actor_id,application_id) WHERE state IN ('reviewed','handoff_pending','claimed','uncertain');
ALTER TABLE public.mcp_document_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_document_email_deliveries FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.mcp_document_email_delivery(_job uuid, _action text, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.mcp_jobs; h public.mcp_payment_applications; d public.mcp_document_email_deliveries;
 ident uuid; appid uuid; v integer; latest integer; hash text; email_payload jsonb; provider_receipt jsonb;
BEGIN
 PERFORM public.mcp_assert_active();
 IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access is required.'; END IF;
 IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>40000 OR _action NOT IN ('review','handoff','claim','receipt','uncertain','cancel','status') THEN RAISE EXCEPTION 'MCP_BAD:Invalid document email request.'; END IF;
 ident:=nullif(_p->>'delivery_id','')::uuid;
 IF ident IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Keep the email review identity.'; END IF;
 -- Same lock order as application writes. Recheck access after waiting.
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 PERFORM public.mcp_assert_active();
 IF j.id IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access is required.'; END IF;
 SELECT * INTO d FROM public.mcp_document_email_deliveries WHERE id=ident FOR UPDATE;
 IF d.id IS NOT NULL AND (d.job_id IS DISTINCT FROM _job OR d.company_id IS DISTINCT FROM j.company_id OR d.actor_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'MCP_BAD:Email review is unavailable.'; END IF;
 IF _action='review' THEN
   appid:=nullif(_p->>'application_id','')::uuid; v:=nullif(_p->>'version','')::integer; hash:=_p->>'review_hash'; email_payload:=(_p->'payload') #- '{mailbox,observedAt}';
   IF appid IS NULL OR v IS NULL OR v<1 OR coalesce(hash,'') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(email_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MCP_BAD:Review the exact document and email.'; END IF;
   SELECT * INTO h FROM public.mcp_payment_applications WHERE id=appid AND job_id=_job FOR UPDATE;
   SELECT max(version) INTO latest FROM public.mcp_payment_application_versions WHERE application_id=appid AND job_id=_job;
   IF h.id IS NULL OR latest IS DISTINCT FROM v OR NOT EXISTS (SELECT 1 FROM public.mcp_payment_application_versions WHERE application_id=appid AND version=v AND working_state IS NULL) THEN RAISE EXCEPTION 'MCP_BAD:The saved application changed or is unavailable.'; END IF;
   IF d.id IS NOT NULL THEN
     IF d.application_id IS DISTINCT FROM appid OR d.application_version IS DISTINCT FROM v THEN RAISE EXCEPTION 'MCP_BAD:This review identity belongs to another document.'; END IF;
     IF d.review_hash IS NOT DISTINCT FROM hash AND d.payload IS DISTINCT FROM email_payload THEN RAISE EXCEPTION 'MCP_BAD:This review identity belongs to different content.'; END IF;
     IF d.review_hash IS DISTINCT FROM hash THEN
       IF coalesce(_p->>'expected_review_hash','') IS DISTINCT FROM d.review_hash THEN RAISE EXCEPTION 'MCP_BAD:Email review changed. Refresh before editing.'; END IF;
       IF d.state<>'reviewed' OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_BAD:This email is already pending or its review expired.'; END IF;
       UPDATE public.mcp_document_email_deliveries SET review_hash=hash,payload=email_payload,updated_at=clock_timestamp() WHERE id=ident;
     END IF;
     RETURN jsonb_build_object('id',d.id,'state',d.state,'receipt',d.receipt,'already_exists',true);
   END IF;
   UPDATE public.mcp_document_email_deliveries SET state='cancelled',updated_at=clock_timestamp() WHERE job_id=_job AND actor_id=auth.uid() AND application_id=appid AND state='reviewed' AND expires_at<=clock_timestamp();
   INSERT INTO public.mcp_document_email_deliveries(id,job_id,company_id,actor_id,application_id,application_version,review_hash,payload,state)
     VALUES(ident,_job,j.company_id,auth.uid(),appid,v,hash,email_payload,'reviewed');
   RETURN jsonb_build_object('id',ident,'state','reviewed','already_exists',false);
 END IF;
 IF d.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Email review is unavailable.'; END IF;
 IF _action='status' THEN RETURN jsonb_build_object('id',d.id,'state',d.state,'receipt',d.receipt,'payload',d.payload,'application_id',d.application_id,'version',d.application_version,'review_hash',d.review_hash); END IF;
 IF coalesce(_p->>'review_hash','') IS DISTINCT FROM d.review_hash THEN RAISE EXCEPTION 'MCP_BAD:Email changed after review.'; END IF;
 IF _action='handoff' THEN
   IF _p->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Confirm the exact email first.'; END IF;
   IF d.state<>'reviewed' THEN RETURN jsonb_build_object('id',d.id,'state',d.state,'handoff',false); END IF;
   IF d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_BAD:Email review expired; review again.'; END IF;
   UPDATE public.mcp_document_email_deliveries SET state='handoff_pending',updated_at=clock_timestamp() WHERE id=ident;
   RETURN jsonb_build_object('id',ident,'state','handoff_pending','handoff',true);
 ELSIF _action='claim' THEN
   IF _p->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Confirm the exact email first.'; END IF;
   IF d.state<>'handoff_pending' THEN RETURN jsonb_build_object('id',d.id,'state',d.state,'claimed',false,'receipt',d.receipt); END IF;
   IF d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_BAD:Email review expired; review again.'; END IF;
   SELECT * INTO h FROM public.mcp_payment_applications WHERE id=d.application_id AND job_id=_job FOR UPDATE;
   SELECT max(version) INTO latest FROM public.mcp_payment_application_versions WHERE application_id=d.application_id AND job_id=_job;
   PERFORM public.mcp_assert_active();
   IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' OR h.id IS NULL OR latest IS DISTINCT FROM d.application_version THEN RAISE EXCEPTION 'MCP_BAD:Access or application version changed; review again.'; END IF;
   IF d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'MCP_BAD:Email review expired; review again.'; END IF;
   UPDATE public.mcp_document_email_deliveries SET state='claimed',updated_at=clock_timestamp() WHERE id=ident;
   RETURN jsonb_build_object('id',ident,'state','claimed','claimed',true);
 ELSIF _action='cancel' THEN
   IF d.state NOT IN ('reviewed','handoff_pending') THEN RAISE EXCEPTION 'MCP_BAD:This send may already have started; reconcile it first.'; END IF;
   IF d.state='handoff_pending' AND _p->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Confirm cancellation of the pending handoff.'; END IF;
   UPDATE public.mcp_document_email_deliveries SET state='cancelled',updated_at=now() WHERE id=ident;
   RETURN jsonb_build_object('id',ident,'state','cancelled');
 ELSIF _action='uncertain' THEN
   IF d.state IN ('claimed','uncertain') THEN UPDATE public.mcp_document_email_deliveries SET state='uncertain',updated_at=now() WHERE id=ident; RETURN jsonb_build_object('id',ident,'state','uncertain'); END IF;
   RAISE EXCEPTION 'MCP_BAD:There is no unresolved send.';
 ELSIF _action='receipt' THEN
   provider_receipt:=_p->'receipt';
   IF jsonb_typeof(provider_receipt) IS DISTINCT FROM 'object' OR coalesce(provider_receipt->>'provider','')='' OR coalesce(provider_receipt->>'message_id','')='' OR coalesce(provider_receipt->>'sent_at','')='' OR octet_length(provider_receipt::text)>4000 THEN RAISE EXCEPTION 'MCP_BAD:A provider receipt is required.'; END IF;
   IF provider_receipt->>'provider' IS DISTINCT FROM d.payload->'mailbox'->>'provider' OR provider_receipt->>'connection_id' IS DISTINCT FROM d.payload->'mailbox'->>'connectionId' OR lower(provider_receipt->>'from') IS DISTINCT FROM lower(d.payload->'email'->>'from') OR provider_receipt->>'review_hash' IS DISTINCT FROM d.review_hash OR provider_receipt->>'attachment_sha256' IS DISTINCT FROM d.payload->'email'->'attachment'->>'sha256' THEN RAISE EXCEPTION 'MCP_BAD:The receipt does not match the reviewed account.'; END IF;
   IF d.state='host_reported_provider_acceptance' AND d.receipt=provider_receipt THEN RETURN jsonb_build_object('id',ident,'state','host_reported_provider_acceptance','receipt',d.receipt,'already_recorded',true); END IF;
   IF d.state NOT IN ('claimed','uncertain') THEN RAISE EXCEPTION 'MCP_BAD:This email has not been claimed for sending.'; END IF;
   UPDATE public.mcp_document_email_deliveries SET state='host_reported_provider_acceptance',receipt=provider_receipt,updated_at=now() WHERE id=ident;
   RETURN jsonb_build_object('id',ident,'state','host_reported_provider_acceptance','receipt',provider_receipt,'already_recorded',false);
 END IF;
 RAISE EXCEPTION 'MCP_BAD:Invalid document email action.';
END $$;
REVOKE ALL ON FUNCTION public.mcp_document_email_delivery(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_document_email_delivery(uuid,text,jsonb) TO authenticated;
