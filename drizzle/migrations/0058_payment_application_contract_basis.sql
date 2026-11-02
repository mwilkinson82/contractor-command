-- Unapplied Lovable Cloud proposal; the native runner supplies the transaction.
-- Reuse the existing gated billing RPC and fact writer. No new access grants.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE FUNCTION public.mcp_pa_contract_basis(_job uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE j public.mcp_jobs; ctx jsonb; facts jsonb; changes jsonb; basis jsonb; contract jsonb;
 token text; proposed numeric; approved numeric; expected_sov numeric; base numeric:=0; extra numeric:=0; linefact record;
 rid uuid; reviewid uuid; sig text; ticket public.mcp_payment_application_reviews; op public.mcp_billing_operations;
 result jsonb; placeholders uuid[]:='{}'; inserted uuid; k text;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Contract basis requires full project access.'; END IF;
 IF _action NOT IN ('contract_basis_read','contract_basis_review','contract_basis_save','contract_basis_outcome') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>12000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid contract basis request.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 PERFORM public.mcp_assert_active();
 IF j.id IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Contract basis requires full project access.'; END IF;
 IF _action<>'contract_basis_read' THEN
   rid:=nullif(_p->>'request_id','')::uuid;
   proposed:=public.mcp_pa_number(_p->'original_cents');
   IF rid IS NULL OR proposed IS NULL OR proposed<0 OR jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'string' OR jsonb_typeof(_p->'basis') IS DISTINCT FROM 'string' OR length(btrim(_p->>'basis')) NOT BETWEEN 1 AND 2000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_p)t(k) WHERE t.k NOT IN ('request_id','original_cents','basis','expected_version','review_key')) THEN RAISE EXCEPTION 'MCP_BAD:Provide a non-negative original contract amount and its basis.'; END IF;
   sig:=md5(jsonb_build_object('kind','contract_basis','payload',_p-'review_key')::text);
   SELECT * INTO op FROM public.mcp_billing_operations WHERE job_id=_job AND request_id=rid;
   IF op.request_id IS NOT NULL THEN
     IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Operation belongs to different content.'; END IF;
     RETURN op.result||jsonb_build_object('applied',true,'already_applied',true);
   END IF;
   IF _action='contract_basis_outcome' THEN RETURN jsonb_build_object('applied',false); END IF;
 END IF;
 IF _action='contract_basis_save' THEN
   -- Lock even an absent value before comparing the reviewed version. A concurrent insert
   -- must become visible before the comparison, never get overwritten by a stale review.
   FOREACH k IN ARRAY ARRAY['contract_value','contract_value_basis'] LOOP
     inserted:=NULL;
     INSERT INTO public.mcp_job_facts(job_id,module,key,value,status,source,updated_by)
       VALUES(_job,'contract',k,NULL,'unknown','member_answer',auth.uid())
       ON CONFLICT(job_id,module,key) DO NOTHING RETURNING id INTO inserted;
     IF inserted IS NOT NULL THEN placeholders:=array_append(placeholders,inserted); END IF;
   END LOOP;
   PERFORM 1 FROM public.mcp_job_facts WHERE job_id=_job AND module IN ('contract','sov') ORDER BY id FOR UPDATE;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.module,f.key),'[]') INTO facts FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module IN ('contract','sov') AND NOT(f.id=ANY(placeholders));
 SELECT coalesce(jsonb_agg(jsonb_build_object('record',to_jsonb(c),'number',s.number,'revision',s.revision) ORDER BY s.number,s.revision),'[]') INTO changes FROM public.mcp_change_orders c JOIN public.mcp_submittals s ON s.id=c.submittal_id AND s.job_id=_job WHERE c.job_id=_job;
 ctx:=jsonb_build_object('facts',facts,'changes',changes,'fee',j.sov_fee_pct); token:=md5(ctx::text);
 SELECT value INTO basis FROM public.mcp_job_facts WHERE job_id=_job AND module='contract' AND key='contract_value_basis' AND status='known';
 contract:=public.mcp_billing_evidence_get(_job)->'recorded_contract';
 IF j.sov_fee_pct IS NOT NULL AND j.sov_fee_pct>=0 AND j.sov_fee_pct<100 AND EXISTS(SELECT 1 FROM public.mcp_job_facts WHERE job_id=_job AND module='sov') THEN
   expected_sov:=0;
   FOR linefact IN SELECT key,value,status FROM public.mcp_job_facts WHERE job_id=_job AND module='sov' LOOP
     IF linefact.status<>'known' OR jsonb_typeof(linefact.value->'billable_value') IS DISTINCT FROM 'number' THEN expected_sov:=NULL; EXIT; END IF;
     IF nullif(linefact.value->>'executed_change_order','') IS NOT NULL AND linefact.value->>'fee_included'='true' THEN extra:=extra+(linefact.value->>'billable_value')::numeric*100;
     ELSE base:=base+(linefact.value->>'billable_value')::numeric*100; END IF;
   END LOOP;
   IF expected_sov IS NOT NULL THEN expected_sov:=round(base/(1-j.sov_fee_pct/100))+extra; END IF;
 END IF;
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Contract basis requires full project access.'; END IF;
 IF _action='contract_basis_read' THEN RETURN jsonb_build_object('version',token,'original_cents',contract->'original_cents','approved_cents',contract->'approved_cents','change_cents',contract->'recorded_change_cents','sov_cents',expected_sov,'basis',basis->>'reference','provenance','member-provided basis; not independently verified'); END IF;
 IF _p->>'expected_version' IS DISTINCT FROM token THEN RAISE EXCEPTION 'MCP_BAD:The contract or SOV changed. Reload the basis and review again.'; END IF;
 approved:=proposed+public.mcp_pa_number(contract->'recorded_change_cents',true);
 IF approved IS NULL OR expected_sov IS NULL OR approved<>expected_sov OR approved<0 OR approved>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Reconcile the original contract, approved change orders and saved SOV before saving this basis.'; END IF;
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Contract basis requires full project access.'; END IF;
 IF _action='contract_basis_review' THEN
   INSERT INTO public.mcp_payment_application_reviews(job_id,actor_id,payload,context_hash) VALUES(_job,auth.uid(),jsonb_build_object('kind','contract_basis','payload',_p-'review_key'),token) RETURNING * INTO ticket;
   RETURN jsonb_build_object('review_key',ticket.id,'expires_at',ticket.expires_at,'payload',_p-'review_key','approved_cents',approved,'sov_cents',expected_sov);
 END IF;
 reviewid:=nullif(_p->>'review_key','')::uuid;
 UPDATE public.mcp_payment_application_reviews SET consumed_at=now() WHERE id=reviewid AND job_id=_job AND actor_id=auth.uid() AND payload=jsonb_build_object('kind','contract_basis','payload',_p-'review_key') AND context_hash=token AND consumed_at IS NULL AND expires_at>now() RETURNING * INTO ticket;
 IF ticket.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Review expired or changed. Review the exact contract basis again.'; END IF;
 PERFORM public.mcp_set_facts(_job,'contract',jsonb_build_object('contract_value',proposed/100,'contract_value_basis',jsonb_build_object('reference',btrim(_p->>'basis'),'provided_by',auth.uid(),'provided_at',now())),'member_answer');
 -- Roll back the entire save if the actual canonical calculator prerequisites still fail.
 PERFORM public.mcp_pa_snapshot(_job);
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Contract basis requires full project access.'; END IF;
 result:=jsonb_build_object('original_cents',proposed,'approved_cents',approved,'basis',btrim(_p->>'basis'),'saved',true);
 INSERT INTO public.mcp_billing_operations(job_id,request_id,actor_id,signature,result) VALUES(_job,rid,auth.uid(),sig,result);
 RETURN result||jsonb_build_object('applied',true,'already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_pa_contract_basis(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
DO $patch$
DECLARE original text; definition text; changed text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc WHERE oid='public.mcp_billing_evidence_record(uuid,text,jsonb)'::regprocedure;
 IF md5(original)<>'e69bb92e7a5877e63fe687c0fdd64f75' THEN RAISE EXCEPTION 'Billing source drifted from reviewed 0057; stop for review.'; END IF;
 IF position('contract_basis_read' IN original)>0 OR position('payment_application_read' IN original)=0 OR position(E'BEGIN\n IF _action IN (' IN original)=0 THEN RAISE EXCEPTION 'Unexpected billing function shape; stop for review.'; END IF;
 changed:=replace(original,E'BEGIN\n IF _action IN (',E'BEGIN\n IF _action IN (''contract_basis_read'',''contract_basis_review'',''contract_basis_save'',''contract_basis_outcome'') THEN RETURN public.mcp_pa_contract_basis(_job,_action,_p); END IF;\n IF _action IN (');
 EXECUTE replace(definition,original,changed);
END $patch$;
NOTIFY pgrst,'reload schema';
