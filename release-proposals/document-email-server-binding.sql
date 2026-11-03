-- UNAPPLIED Lovable proposal. Replaces only the existing function; no grant or table changes.
-- Stop on function-body drift before changing anything.
DO $guard$
DECLARE body text;
BEGIN
 SELECT p.prosrc INTO body FROM pg_catalog.pg_proc p WHERE p.oid='public.mcp_document_email_delivery(uuid,text,jsonb)'::pg_catalog.regprocedure;
 IF body IS NULL OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex') <> 'fc07165fcf979b27766d76d51a2821380ddd7f8a376a6926b11bfc08b7a31fa1' THEN
  RAISE EXCEPTION 'Document email function drift; stop for review.';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.mcp_document_email_delivery(_job uuid, _action text, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.mcp_jobs; h public.mcp_payment_applications; d public.mcp_document_email_deliveries;
 ident uuid; appid uuid; v integer; latest integer; hash text; client_hash text; email_payload jsonb; provider_receipt jsonb;
 mailbox jsonb; observed jsonb; account_mode text; observation_ms numeric; now_ms numeric;
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
   appid:=nullif(_p->>'application_id','')::uuid; v:=nullif(_p->>'version','')::integer; client_hash:=_p->>'client_hash'; email_payload:=(_p->'payload') #- '{mailbox,observedAt}';
   IF appid IS NULL OR v IS NULL OR v<1 OR coalesce(client_hash,'') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(email_payload) IS DISTINCT FROM 'object' OR email_payload ? 'client_hash' THEN RAISE EXCEPTION 'MCP_BAD:Review the exact document and email.'; END IF;
   mailbox:=email_payload->'mailbox'; account_mode:=mailbox->>'mode';
   IF jsonb_typeof(mailbox) IS DISTINCT FROM 'object' OR account_mode NOT IN ('pinned','assistant_current_gmail') OR account_mode IS NULL OR mailbox->>'provider' IS DISTINCT FROM 'gmail' OR mailbox->'canSendMime' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(mailbox->'profileAddress') IS DISTINCT FROM 'string' OR coalesce(mailbox->>'profileAddress','') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR lower(mailbox->>'profileAddress') IS DISTINCT FROM lower(email_payload->'email'->>'from') THEN RAISE EXCEPTION 'MCP_BAD:Review the explicit Gmail account mode and sender.'; END IF;
   IF (account_mode='pinned' AND (jsonb_typeof(mailbox->'connectionId') IS DISTINCT FROM 'string' OR length(btrim(mailbox->>'connectionId')) NOT BETWEEN 1 AND 200)) OR (account_mode='assistant_current_gmail' AND mailbox ? 'connectionId') THEN RAISE EXCEPTION 'MCP_BAD:The Gmail account binding is invalid.'; END IF;
   IF email_payload->'email'->>'company_id' IS DISTINCT FROM j.company_id::text OR email_payload->'email'->>'job_id' IS DISTINCT FROM j.id::text OR email_payload->'email'->'attachment'->>'company_id' IS DISTINCT FROM j.company_id::text OR email_payload->'email'->'attachment'->>'job_id' IS DISTINCT FROM j.id::text OR email_payload->'email'->'attachment'->>'document_id' IS DISTINCT FROM appid::text OR email_payload->'email'->'attachment'->>'version' IS DISTINCT FROM v::text OR coalesce(email_payload->'email'->'attachment'->>'sha256','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:The reviewed document does not match this project and application.'; END IF;
   email_payload:=jsonb_set(email_payload,'{client_hash}',to_jsonb(client_hash),true);
   hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array('document-email-review-v1',auth.uid()::text,j.company_id::text,j.id::text,appid::text,v,email_payload)::text,'UTF8')),'hex');
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
     RETURN jsonb_build_object('id',d.id,'state',d.state,'receipt',d.receipt,'review_hash',hash,'already_exists',true);
   END IF;
   UPDATE public.mcp_document_email_deliveries SET state='cancelled',updated_at=clock_timestamp() WHERE job_id=_job AND actor_id=auth.uid() AND application_id=appid AND state='reviewed' AND expires_at<=clock_timestamp();
   INSERT INTO public.mcp_document_email_deliveries(id,job_id,company_id,actor_id,application_id,application_version,review_hash,payload,state)
     VALUES(ident,_job,j.company_id,auth.uid(),appid,v,hash,email_payload,'reviewed');
   RETURN jsonb_build_object('id',ident,'state','reviewed','review_hash',hash,'already_exists',false);
 END IF;
 IF d.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Email review is unavailable.'; END IF;
 IF _action='status' THEN RETURN jsonb_build_object('id',d.id,'state',d.state,'receipt',d.receipt,'payload',d.payload,'application_id',d.application_id,'version',d.application_version,'review_hash',d.review_hash); END IF;
 IF coalesce(_p->>'review_hash','') IS DISTINCT FROM d.review_hash THEN RAISE EXCEPTION 'MCP_BAD:Email changed after review.'; END IF;
 IF _action IN ('handoff','claim','receipt') THEN
   mailbox:=d.payload->'mailbox'; account_mode:=mailbox->>'mode';
   IF jsonb_typeof(mailbox) IS DISTINCT FROM 'object' OR account_mode IS NULL OR account_mode NOT IN ('pinned','assistant_current_gmail') OR mailbox->>'provider' IS DISTINCT FROM 'gmail' OR coalesce(d.payload->>'client_hash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:This legacy review lacks an explicit account binding; reconcile or review again.'; END IF;
   hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array('document-email-review-v1',d.actor_id::text,d.company_id::text,d.job_id::text,d.application_id::text,d.application_version,d.payload)::text,'UTF8')),'hex');
   IF hash IS DISTINCT FROM d.review_hash THEN RAISE EXCEPTION 'MCP_BAD:The reviewed email binding changed; reconcile it.'; END IF;
 END IF;
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
   observed:=_p->'mailbox';
   IF jsonb_typeof(observed) IS DISTINCT FROM 'object' OR observed->>'mode' IS NULL OR observed->>'mode' NOT IN ('pinned','assistant_current_gmail') OR jsonb_typeof(observed->'profileAddress') IS DISTINCT FROM 'string' OR coalesce(observed->>'profileAddress','') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR jsonb_typeof(observed->'observedAt') IS DISTINCT FROM 'number' OR coalesce(observed->>'observedAt','') !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'MCP_BAD:Refresh the explicit Gmail account observation.'; END IF;
   IF (observed->>'mode'='pinned' AND (jsonb_typeof(observed->'connectionId') IS DISTINCT FROM 'string' OR length(btrim(observed->>'connectionId')) NOT BETWEEN 1 AND 200)) OR (observed->>'mode'='assistant_current_gmail' AND observed ? 'connectionId') THEN RAISE EXCEPTION 'MCP_BAD:Refresh the explicit Gmail account binding.'; END IF;
   observation_ms:=(observed->>'observedAt')::numeric; now_ms:=extract(epoch FROM clock_timestamp())*1000;
   IF observation_ms>now_ms OR now_ms-observation_ms>(CASE WHEN observed->>'mode'='assistant_current_gmail' THEN 30000 ELSE 300000 END) THEN RAISE EXCEPTION 'MCP_BAD:Refresh the current Gmail profile before claiming.'; END IF;
   IF observed->>'mode' IS DISTINCT FROM account_mode OR observed->>'provider' IS DISTINCT FROM mailbox->>'provider' OR lower(observed->>'profileAddress') IS DISTINCT FROM lower(mailbox->>'profileAddress') OR (account_mode='pinned' AND observed->>'connectionId' IS DISTINCT FROM mailbox->>'connectionId') THEN
     UPDATE public.mcp_document_email_deliveries SET state='cancelled',updated_at=clock_timestamp() WHERE id=ident;
     RETURN jsonb_build_object('id',ident,'state','cancelled','claimed',false,'reason','account_mismatch');
   END IF;
   IF observed->'canSendMime' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Confirm PDF attachment support before claiming.'; END IF;
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
   IF provider_receipt->>'binding_mode' IS DISTINCT FROM account_mode OR provider_receipt->>'provider' IS DISTINCT FROM mailbox->>'provider' OR (account_mode='pinned' AND provider_receipt->>'connection_id' IS DISTINCT FROM mailbox->>'connectionId') OR (account_mode='assistant_current_gmail' AND provider_receipt ? 'connection_id') OR lower(provider_receipt->>'from') IS DISTINCT FROM lower(mailbox->>'profileAddress') OR lower(provider_receipt->>'from') IS DISTINCT FROM lower(d.payload->'email'->>'from') OR provider_receipt->>'review_hash' IS DISTINCT FROM d.review_hash OR provider_receipt->>'attachment_sha256' IS DISTINCT FROM d.payload->'email'->'attachment'->>'sha256' THEN RAISE EXCEPTION 'MCP_BAD:The receipt does not match the reviewed account.'; END IF;
   IF d.state='host_reported_provider_acceptance' AND d.receipt=provider_receipt THEN RETURN jsonb_build_object('id',ident,'state','host_reported_provider_acceptance','receipt',d.receipt,'already_recorded',true); END IF;
   IF d.state NOT IN ('claimed','uncertain') THEN RAISE EXCEPTION 'MCP_BAD:This email has not been claimed for sending.'; END IF;
   UPDATE public.mcp_document_email_deliveries SET state='host_reported_provider_acceptance',receipt=provider_receipt,updated_at=now() WHERE id=ident;
   RETURN jsonb_build_object('id',ident,'state','host_reported_provider_acceptance','receipt',provider_receipt,'already_recorded',false);
 END IF;
 RAISE EXCEPTION 'MCP_BAD:Invalid document email action.';
END $$;
