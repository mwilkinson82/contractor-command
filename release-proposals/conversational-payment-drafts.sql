-- Unapplied Lovable Cloud proposal; native runner supplies the transaction.
-- Working copies use the existing application/version history and never create billing.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE public.mcp_payment_applications ALTER COLUMN number DROP NOT NULL;
ALTER TABLE public.mcp_payment_application_versions ADD COLUMN working_state text CHECK(working_state IN ('open','cancelled'));
ALTER TABLE public.mcp_payment_application_versions ADD COLUMN working_intent jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(working_intent)='object');

-- Allow incomplete headers in the shared calculator, but keep the final reviewed path strict.
DO $patch$
DECLARE original text; definition text; changed text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc WHERE oid='public.mcp_pa_calculate(jsonb,jsonb)'::regprocedure;
 IF md5(original)<>'106e3d44b907a5f1393c5c41ce66e6d5' THEN RAISE EXCEPTION 'Calculator source drift; stop for review.'; END IF;
 IF length(original)-length(replace(original,$old$IF length(btrim(a->>'number')) NOT BETWEEN 1 AND 120 OR length(btrim(a->>'source'))<1 OR$old$,''))<>length($old$IF length(btrim(a->>'number')) NOT BETWEEN 1 AND 120 OR length(btrim(a->>'source'))<1 OR$old$) THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(original,$old$IF length(btrim(a->>'number')) NOT BETWEEN 1 AND 120 OR length(btrim(a->>'source'))<1 OR$old$,$new$IF length(btrim(a->>'number'))>120 OR$new$);
 IF length(changed)-length(replace(changed,$old$   IF a->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Use valid calendar dates.'; END IF;$old$,''))<>length($old$   IF a->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Use valid calendar dates.'; END IF;$old$) THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(changed,$old$   IF a->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Use valid calendar dates.'; END IF;$old$,$new$   IF a->>k='' THEN issues:=issues||jsonb_build_array(k||' is Needed.'); ELSIF a->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Use valid calendar dates.'; END IF;$new$);
 IF length(changed)-length(replace(changed,$old$ startday:=(a->>'period_start')::date; endday:=(a->>'period_end')::date; cutoff:=(a->>'prior_cutoff')::date;$old$,''))<>length($old$ startday:=(a->>'period_start')::date; endday:=(a->>'period_end')::date; cutoff:=(a->>'prior_cutoff')::date;$old$) THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(changed,$old$ startday:=(a->>'period_start')::date; endday:=(a->>'period_end')::date; cutoff:=(a->>'prior_cutoff')::date;$old$,$new$ startday:=nullif(a->>'period_start','')::date; endday:=nullif(a->>'period_end','')::date; cutoff:=nullif(a->>'prior_cutoff','')::date;
 IF btrim(a->>'number')='' THEN issues:=issues||jsonb_build_array('Application number is Needed.'); END IF;
 IF btrim(a->>'source')='' THEN issues:=issues||jsonb_build_array('Progress/application source is Needed.'); END IF;$new$);
 IF length(changed)-length(replace(changed,' delta:=held-priorheld;',''))<>length(' delta:=held-priorheld;') THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(changed,' delta:=held-priorheld;',$new$ IF btrim(a->>'number')='' OR btrim(a->>'source')='' OR startday IS NULL OR endday IS NULL OR cutoff IS NULL THEN due:=NULL; END IF;
 delta:=held-priorheld;$new$);
 IF changed=original OR position('startday:=nullif' IN changed)=0 THEN RAISE EXCEPTION 'Calculator patch shape mismatch.'; END IF;
 EXECUTE replace(definition,original,changed);

 SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc WHERE oid='public.mcp_pa_dispatch(uuid,text,jsonb)'::regprocedure;
 IF md5(original)<>'bf717751c70daf608d6b957d6697b9e1' THEN RAISE EXCEPTION 'Application source drift; stop for review.'; END IF;
 IF length(original)-length(replace(original,$old$'id',h.id,'number',h.number,'version',v.version,$old$,''))<>length($old$'id',h.id,'number',h.number,'version',v.version,$old$) THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(original,$old$'id',h.id,'number',h.number,'version',v.version,$old$,$new$'id',h.id,'number',coalesce(nullif(v.body->>'number',''),'Working application'),'working_state',v.working_state,'version',v.version,$new$);
 IF length(changed)-length(replace(changed,$old$ IF prev.version IS NOT NULL AND (a->>'number' IS DISTINCT FROM head.number OR length(btrim(coalesce(a->>'reason',''))) NOT BETWEEN 1 AND 2000) THEN$old$,''))<>length($old$ IF prev.version IS NOT NULL AND (a->>'number' IS DISTINCT FROM head.number OR length(btrim(coalesce(a->>'reason',''))) NOT BETWEEN 1 AND 2000) THEN$old$) THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(changed,$old$ IF prev.version IS NOT NULL AND (a->>'number' IS DISTINCT FROM head.number OR length(btrim(coalesce(a->>'reason',''))) NOT BETWEEN 1 AND 2000) THEN$old$,$new$ IF prev.working_state='cancelled' THEN RAISE EXCEPTION 'MCP_BAD:Resume the cancelled working draft before review.'; END IF;
 IF prev.version IS NOT NULL AND prev.working_state IS NULL AND (a->>'number' IS DISTINCT FROM head.number OR length(btrim(coalesce(a->>'reason',''))) NOT BETWEEN 1 AND 2000) THEN$new$);
 IF length(changed)-length(replace(changed,' calc:=public.mcp_pa_calculate(a,evidence);',''))<>length(' calc:=public.mcp_pa_calculate(a,evidence);') THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(changed,' calc:=public.mcp_pa_calculate(a,evidence);',$new$ IF prev.working_state='open' AND (jsonb_set(a,'{source}',to_jsonb(btrim(a->>'source',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')))-'state'-'certification') IS DISTINCT FROM (jsonb_set(prev.body,'{source}',to_jsonb(btrim(prev.body->>'source',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')))-'state'-'certification') THEN RAISE EXCEPTION 'MCP_BAD:Save the working changes before final review.'; END IF;
 IF prev.working_state='open' AND EXISTS(SELECT 1 FROM jsonb_each(prev.working_intent) i JOIN LATERAL (SELECT line_values.val FROM jsonb_array_elements(prev.body->'lines') AS line_values(val) WHERE line_values.val->>'item'=i.key) matched ON true WHERE i.value->>'basis'='this_period' AND i.value->'amount_cents'<>'null'::jsonb AND (matched.val->'prior_work_cents'='null'::jsonb OR matched.val->'work_cents'='null'::jsonb)) THEN RAISE EXCEPTION 'MCP_BAD:Prior installed work is Needed before reviewing this-period work. Keep it in the working draft.'; END IF;
 IF length(btrim(coalesce(a->>'number',''))) NOT BETWEEN 1 AND 120 OR length(btrim(coalesce(a->>'source','')))=0 OR coalesce(a->>'period_start','')='' OR coalesce(a->>'period_end','')='' OR coalesce(a->>'prior_cutoff','')='' THEN RAISE EXCEPTION 'MCP_BAD:Complete the application number, period, cutoff and source before final review.'; END IF;
 calc:=public.mcp_pa_calculate(a,evidence);$new$);
 IF length(changed)-length(replace(changed,' INSERT INTO public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,billing_version,recorded_by)',''))<>length(' INSERT INTO public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,billing_version,recorded_by)') THEN RAISE EXCEPTION 'Expected source anchor must occur exactly once.'; END IF;
 changed:=replace(changed,' INSERT INTO public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,billing_version,recorded_by)',$new$ IF prev.working_state='open' THEN UPDATE public.mcp_payment_applications SET number=btrim(a->>'number') WHERE id=ident AND job_id=_job; END IF;
 INSERT INTO public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,billing_version,recorded_by)$new$);
 IF changed=original OR position('Complete the application number' IN changed)=0 THEN RAISE EXCEPTION 'Application patch shape mismatch.'; END IF;
 EXECUTE replace(definition,original,changed);
END $patch$;

CREATE FUNCTION public.mcp_pa_working(_job uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE j public.mcp_jobs; head public.mcp_payment_applications; prev public.mcp_payment_application_versions;
 op public.mcp_billing_operations; ident uuid; rid uuid; expected integer; sig text; request_hash text; result jsonb;
 a jsonb; intent jsonb; entry record; line jsonb; rows jsonb:='[]'; snapshot jsonb; calc jsonb; evidence jsonb; state text; amount numeric; derived numeric; scheduled numeric;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Payment drafts require full project access.'; END IF;
 IF coalesce(_action,'') NOT IN ('payment_application_working','payment_application_working_outcome') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>230000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid working draft.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 PERFORM public.mcp_assert_active();
 IF j.id IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Payment drafts require full project access.'; END IF;
 ident:=nullif(_p->>'id','')::uuid; rid:=nullif(_p->>'request_id','')::uuid; request_hash:=_p->>'request_hash';
 IF ident IS NULL OR rid IS NULL OR coalesce(request_hash,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Retain the exact draft request identity.'; END IF;
 SELECT * INTO op FROM public.mcp_billing_operations WHERE job_id=_job AND request_id=rid;
 sig:=md5(jsonb_build_object('kind','working_application','payload',_p)::text);
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.result->>'request_hash' IS DISTINCT FROM request_hash OR op.result->>'id' IS DISTINCT FROM ident::text OR (_action<>'payment_application_working_outcome' AND op.signature IS DISTINCT FROM sig) THEN RAISE EXCEPTION 'MCP_BAD:Draft request belongs to different content.'; END IF;
   PERFORM public.mcp_assert_active();
   IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Payment drafts require full project access.'; END IF;
   RETURN op.result||jsonb_build_object('applied',true,'already_applied',true);
 END IF;
 IF _action='payment_application_working_outcome' THEN
   PERFORM public.mcp_assert_active();
   IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Payment drafts require full project access.'; END IF;
   RETURN jsonb_build_object('applied',false);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_p)t(k) WHERE t.k NOT IN ('id','request_id','request_hash','expected_version','operation','application','intent')) THEN RAISE EXCEPTION 'MCP_BAD:Unexpected working draft field.'; END IF;
 expected:=(_p->>'expected_version')::integer;
 IF expected IS NULL OR expected<0 OR coalesce(_p->>'operation','') NOT IN ('save','cancel','resume') THEN RAISE EXCEPTION 'MCP_BAD:Choose the exact draft version and operation.'; END IF;
 SELECT * INTO head FROM public.mcp_payment_applications WHERE id=ident FOR UPDATE;
 IF head.id IS NOT NULL AND head.job_id<>_job THEN RAISE EXCEPTION 'MCP_BAD:This draft is unavailable in this job.'; END IF;
 SELECT * INTO prev FROM public.mcp_payment_application_versions WHERE application_id=ident ORDER BY version DESC LIMIT 1;
 IF coalesce(prev.version,0)<>expected THEN RAISE EXCEPTION 'MCP_BAD:This draft changed in chat or the form. Read the latest version and reconcile your changes.'; END IF;
 IF prev.body->>'state' IN ('submitted','certified') OR prev.billing_version IS NOT NULL OR EXISTS(SELECT 1 FROM public.mcp_billing_invoices WHERE id=ident) THEN RAISE EXCEPTION 'MCP_BAD:Issued applications require their reviewed revision workflow.'; END IF;
 IF _p->>'operation' IN ('cancel','resume') THEN
   IF prev.working_state IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose an existing working draft.'; END IF;
   a:=prev.body; intent:=prev.working_intent; calc:=prev.calculation;
   state:=CASE WHEN _p->>'operation'='cancel' THEN 'cancelled' ELSE 'open' END;
 ELSE
   IF prev.working_state='cancelled' THEN RAISE EXCEPTION 'MCP_BAD:Resume this cancelled draft explicitly before editing.'; END IF;
   a:=_p->'application'; intent:=_p->'intent'; state:='open';
   IF jsonb_typeof(a->'source')='string' THEN a:=jsonb_set(a,'{source}',to_jsonb(btrim(a->>'source',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))); END IF;
   IF a->>'state' IS DISTINCT FROM 'draft' OR a->'certification' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(intent) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MCP_BAD:A working draft cannot submit, approve or certify billing.'; END IF;
   snapshot:=public.mcp_pa_snapshot(_job);
   IF a->'snapshot' IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'MCP_BAD:The saved SOV changed. Reconcile it before editing this draft.'; END IF;
   FOR entry IN SELECT * FROM jsonb_each(intent) LOOP
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'lines')l WHERE l->>'item'=entry.key) OR jsonb_typeof(entry.value) IS DISTINCT FROM 'object' OR coalesce(entry.value->>'basis','') NOT IN ('this_period','cumulative') OR NOT(entry.value ? 'amount_cents') OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry.value)t(k) WHERE t.k NOT IN ('basis','amount_cents')) THEN RAISE EXCEPTION 'MCP_BAD:Use an exact SOV line and explicit amount basis.'; END IF;
     PERFORM public.mcp_pa_number(entry.value->'amount_cents',true);
   END LOOP;
   FOR line IN SELECT * FROM jsonb_array_elements(a->'lines') LOOP
     SELECT public.mcp_pa_number(l->'scheduled_cents',true) INTO scheduled FROM jsonb_array_elements(snapshot->'lines')l WHERE l->>'item'=line->>'item';
     IF intent ? (line->>'item') THEN
       amount:=public.mcp_pa_number(intent->(line->>'item')->'amount_cents',true);
       IF amount>greatest(0,scheduled) OR amount<least(0,scheduled) THEN RAISE EXCEPTION 'MCP_BAD:Requested work exceeds the remaining line capacity.'; END IF;
       derived:=CASE WHEN intent->(line->>'item')->>'basis'='cumulative' THEN amount ELSE public.mcp_pa_number(line->'prior_work_cents',true)+amount END;
       line:=jsonb_set(line,'{work_cents}',coalesce(to_jsonb(derived),'null'::jsonb));
     END IF;
     IF public.mcp_pa_number(line->'work_cents',true)>greatest(0,scheduled) OR public.mcp_pa_number(line->'work_cents',true)<least(0,scheduled) OR public.mcp_pa_number(line->'work_cents',true)+public.mcp_pa_number(line->'stored_cents')>greatest(0,scheduled) OR public.mcp_pa_number(line->'work_cents',true)+public.mcp_pa_number(line->'stored_cents')<least(0,scheduled) OR (scheduled>=0 AND public.mcp_pa_number(line->'work_cents',true)<public.mcp_pa_number(line->'prior_work_cents',true)) OR (scheduled<0 AND public.mcp_pa_number(line->'work_cents',true)>public.mcp_pa_number(line->'prior_work_cents',true)) THEN RAISE EXCEPTION 'MCP_BAD:Requested work exceeds line capacity or reduces the prior certificate. Reconcile it first.'; END IF;
     rows:=rows||jsonb_build_array(line);
   END LOOP;
   a:=jsonb_set(a,'{lines}',rows);
   evidence:=public.mcp_pa_evidence(_job,ident); calc:=public.mcp_pa_calculate(a,evidence);
   IF nullif(btrim(a->>'number'),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.mcp_billing_invoices WHERE job_id=_job AND id<>ident AND lower(btrim(document_number))=lower(btrim(a->>'number'))) THEN RAISE EXCEPTION 'MCP_BAD:That billing number already exists.'; END IF;
 END IF;
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Payment drafts require full project access.'; END IF;
 IF head.id IS NULL THEN INSERT INTO public.mcp_payment_applications(id,job_id,company_id,number,created_by) VALUES(ident,_job,j.company_id,nullif(btrim(a->>'number'),''),auth.uid());
 ELSE UPDATE public.mcp_payment_applications SET number=nullif(btrim(a->>'number'),'') WHERE id=ident AND job_id=_job; END IF;
 INSERT INTO public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,billing_version,recorded_by,working_state,working_intent) VALUES(ident,expected+1,_job,a,calc,NULL,auth.uid(),state,intent);
 result:=jsonb_build_object('id',ident,'version',expected+1,'working_state',state,'request_hash',request_hash);
 INSERT INTO public.mcp_billing_operations(job_id,request_id,actor_id,signature,result) VALUES(_job,rid,auth.uid(),sig,result);
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Payment drafts require full project access.'; END IF;
 RETURN result||jsonb_build_object('applied',true,'already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_pa_working(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
DO $patch$
DECLARE original text; definition text; changed text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc WHERE oid='public.mcp_billing_evidence_record(uuid,text,jsonb)'::regprocedure;
 IF md5(original)<>'1a3313ab35120fcd2f4b12d3a4cf139a' THEN RAISE EXCEPTION 'Billing source drift; stop for review.'; END IF;
 changed:=replace(original,E'BEGIN\n IF _action IN (',E'BEGIN\n IF _action IN (''payment_application_working'',''payment_application_working_outcome'') THEN RETURN public.mcp_pa_working(_job,_action,_p); END IF;\n IF _action IN (');
 EXECUTE replace(definition,original,changed);
END $patch$;
NOTIFY pgrst,'reload schema';
