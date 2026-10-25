-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
-- Commercial data is separate from the broadly readable submittal record.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.mcp_change_orders (
 submittal_id uuid PRIMARY KEY REFERENCES public.mcp_submittals(id), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
 details jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_change_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial package read" ON public.mcp_change_orders FOR SELECT TO authenticated
 USING(public.mcp_gate() AND public.mcp_job_scope(job_id)='full');
REVOKE ALL ON public.mcp_change_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.mcp_change_orders TO authenticated;
GRANT ALL ON public.mcp_change_orders TO service_role;
CREATE TABLE public.mcp_change_history (
 submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id),job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),record_version integer NOT NULL,
 action text NOT NULL,snapshot jsonb NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(submittal_id,record_version)
);
ALTER TABLE public.mcp_change_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial history read" ON public.mcp_change_history FOR SELECT TO authenticated USING(public.mcp_gate() AND public.mcp_job_scope(job_id)='full');
REVOKE ALL ON public.mcp_change_history FROM PUBLIC,anon,authenticated;GRANT SELECT ON public.mcp_change_history TO authenticated;GRANT ALL ON public.mcp_change_history TO service_role;
CREATE TABLE public.mcp_change_operations (
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),request_id uuid NOT NULL,actor_id uuid NOT NULL,digest text NOT NULL,
 submittal_id uuid NOT NULL REFERENCES public.mcp_submittals(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,request_id)
);
ALTER TABLE public.mcp_change_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_change_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.mcp_change_operations TO service_role;
ALTER TABLE public.mcp_submittals DROP CONSTRAINT mcp_submittals_spec_section_check;
ALTER TABLE public.mcp_submittals ADD CONSTRAINT mcp_submittals_spec_section_check CHECK(length(spec_section)<=40 AND
 (package_purpose IN ('rfi','rfc','change_order') OR length(btrim(spec_section)) BETWEEN 1 AND 40));

CREATE FUNCTION public.mcp_change_price(_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE ln jsonb; result jsonb:='[]'; base numeric:=0; total numeric:=0; amount numeric; n int:=0;
BEGIN
 IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:Pricing needs one or more sourced cost lines.'; END IF;
 FOR ln IN SELECT value FROM jsonb_array_elements(_lines) LOOP
   IF coalesce(ln->>'category','') NOT IN ('labor','material','equipment','subcontract','other','markup')
     OR length(btrim(coalesce(ln->>'description',''))) NOT BETWEEN 1 AND 1000 OR length(btrim(coalesce(ln->>'source',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Each cost line needs its category, description and rate source.'; END IF;
   IF ln->>'category'<>'markup' THEN
     IF jsonb_typeof(ln->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(ln->'unit_rate_cents') IS DISTINCT FROM 'number'
       OR (ln->>'quantity')::numeric<0 OR (ln->>'quantity')::numeric>100000000
       OR (ln->>'unit_rate_cents')::numeric<>trunc((ln->>'unit_rate_cents')::numeric) THEN RAISE EXCEPTION 'MCP_BAD:Use a nonnegative quantity and an integer-cent rate; credits use a negative rate.'; END IF;
     amount:=round((ln->>'quantity')::numeric*(ln->>'unit_rate_cents')::numeric);base:=base+amount;
   END IF;
 END LOOP;
 FOR ln IN SELECT value FROM jsonb_array_elements(_lines) LOOP
   IF ln->>'category'='markup' THEN
     IF jsonb_typeof(ln->'rate_basis_points') IS DISTINCT FROM 'number' OR (ln->>'rate_basis_points')::numeric<>trunc((ln->>'rate_basis_points')::numeric)
       OR abs((ln->>'rate_basis_points')::numeric)>10000 THEN RAISE EXCEPTION 'MCP_BAD:Markup uses integer basis points within plus or minus 100 percent of direct costs.'; END IF;
     amount:=round(base*(ln->>'rate_basis_points')::numeric/10000);
   ELSE amount:=round((ln->>'quantity')::numeric*(ln->>'unit_rate_cents')::numeric); END IF;
   IF abs(amount)>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Cost amount exceeds the supported range.'; END IF;
   total:=total+amount;n:=n+1;
   result:=result||jsonb_build_array((ln-'amount_cents')||jsonb_build_object('amount_cents',amount::bigint));
 END LOOP;
 IF abs(total)>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Package total exceeds the supported range.'; END IF;
 RETURN jsonb_build_object('lines',result,'total_cents',total::bigint);
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_price(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_change_record(_job uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs;s public.mcp_submittals;c public.mcp_change_orders;op public.mcp_change_operations;
 rid uuid;tid uuid;tn int;seq int;v int;sig text;d jsonb;priced jsonb;ev jsonb;sent boolean;current_state text;item text;div text;
 base_cents numeric;delta_cents numeric;fee numeric;prior_total numeric;co_count int;eid uuid;ref jsonb;bound jsonb;normalized jsonb:='[]';
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Commercial change orders require full job access.'; END IF;
 IF coalesce(_action,'') NOT IN ('create','edit','price','approve','reject','execute','reopen') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>200000 THEN RAISE EXCEPTION 'MCP_BAD:Choose a change-order action and valid content.'; END IF;
 rid:=nullif(_p->>'request_id','')::uuid;IF rid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:An operation ID is required for safe retries.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 sig:=md5(jsonb_build_object('action',_action,'payload',_p-'host')::text);
 SELECT * INTO op FROM public.mcp_change_operations WHERE job_id=_job AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id<>auth.uid() OR op.digest<>sig THEN RAISE EXCEPTION 'MCP_BAD:That operation ID belongs to different content.'; END IF;
   RETURN jsonb_build_object('saved_id',op.submittal_id,'already_applied',true);
 END IF;
 IF _p ? 'references' THEN
   IF jsonb_typeof(_p->'references') IS DISTINCT FROM 'array' OR jsonb_array_length(_p->'references') NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'MCP_BAD:Cite the actual sources for this change.';END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(_p->'references') LOOP
     ref:=ref-'source_binding';
     IF nullif(ref->>'source_id','') IS NOT NULL THEN
       IF ref->>'kind' IS DISTINCT FROM 'drawing' THEN RAISE EXCEPTION 'MCP_BAD:Stored source IDs identify drawings.';END IF;
       SELECT jsonb_build_object('id',id,'content_hash',content_hash,'storage_version',version,'filename',filename,'original_source_id',coalesce(parent_id,id)) INTO bound FROM public.mcp_drawing_versions WHERE id=(ref->>'source_id')::uuid AND job_id=_job AND company_id=j.company_id;
       IF bound IS NULL THEN RAISE EXCEPTION 'MCP_BAD:The referenced stored drawing is not on this job.';END IF;
       ref:=ref||jsonb_build_object('source_binding',bound);
     END IF;
     normalized:=normalized||jsonb_build_array(ref);
   END LOOP;
   _p:=jsonb_set(_p,'{references}',normalized);
 END IF;
 IF _action='create' THEN
   IF length(btrim(coalesce(_p->>'title',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(_p->>'condition',''))) NOT BETWEEN 1 AND 12000
     OR length(btrim(coalesce(_p->>'scope',''))) NOT BETWEEN 1 AND 12000 THEN RAISE EXCEPTION 'MCP_BAD:Provide the title, actual condition and requested change.'; END IF;
   SELECT coalesce(max(substring(number FROM '[0-9]+$')::int),0)+1 INTO seq FROM public.mcp_submittals WHERE job_id=_job AND number ~ '^PCO-[0-9]{1,8}$';
   SELECT coalesce(max(number),0)+1 INTO tn FROM public.mcp_transmittals WHERE job_id=_job;
   INSERT INTO public.mcp_transmittals(company_id,job_id,number) VALUES(j.company_id,_job,tn) RETURNING id INTO tid;
   INSERT INTO public.mcp_submittals(company_id,job_id,number,revision,transmittal_id,spec_section,title,submittal_type,status,ball_in_court,source,required,package_purpose,required_by)
   VALUES(j.company_id,_job,'PCO-'||lpad(seq::text,greatest(3,length(seq::text)),'0'),0,tid,coalesce(_p->>'spec_section',''),_p->>'title','other','in_prep','gc','user',true,'change_order',nullif(_p->>'due_date','')::date) RETURNING * INTO s;
   d:=jsonb_build_object('state','draft','record_version',1,'origin',coalesce(_p->>'origin','contractor'),'condition',_p->>'condition','scope',_p->>'scope',
     'references',_p->'references','recipient_name',_p->'recipient_name','recipient_email',_p->'recipient_email','due_date',_p->'due_date',
     'owner_number',_p->'owner_number','schedule_days',_p->'schedule_days','lines','[]'::jsonb,'total_cents',NULL);
   INSERT INTO public.mcp_change_orders(submittal_id,job_id,details) VALUES(s.id,_job,d);
 ELSE
   SELECT * INTO s FROM public.mcp_submittals WHERE job_id=_job AND package_purpose='change_order' AND
     ((nullif(_p->>'submittal_id','') IS NOT NULL AND id=(_p->>'submittal_id')::uuid) OR
      (nullif(_p->>'submittal_id','') IS NULL AND (lower(number)=lower(_p->>'number') OR id IN(SELECT submittal_id FROM public.mcp_change_orders WHERE job_id=_job AND lower(details->>'co_number')=lower(_p->>'number'))))) ORDER BY revision DESC LIMIT 1 FOR UPDATE;
   IF s.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That change order is not on this job.'; END IF;
   IF EXISTS(SELECT 1 FROM public.mcp_submittals x WHERE x.job_id=_job AND x.number=s.number AND x.revision>s.revision) THEN RAISE EXCEPTION 'MCP_BAD:Use the current revision.'; END IF;
   SELECT * INTO c FROM public.mcp_change_orders WHERE submittal_id=s.id FOR UPDATE;d:=c.details;v:=(d->>'record_version')::int;
   IF nullif(_p->>'expected_version','')::int IS DISTINCT FROM v THEN RAISE EXCEPTION 'MCP_BAD:The change order changed; read it again before saving.'; END IF;
   SELECT EXISTS(SELECT 1 FROM public.mcp_submittal_mail m WHERE m.submittal_id=s.id AND m.kind='package' AND m.sent_at IS NOT NULL) INTO sent;
   current_state:=CASE WHEN d->>'state' IN ('draft','priced') AND sent THEN 'submitted' ELSE d->>'state' END;
   IF _action IN ('edit','price') THEN
     IF current_state NOT IN ('draft','priced') THEN RAISE EXCEPTION 'MCP_BAD:Preserve the issued proposal; reopen it before changing its scope or price.'; END IF;
     IF _action='edit' THEN
       d:=d||coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(_p) WHERE key IN('condition','scope','references','recipient_name','recipient_email','due_date','owner_number','schedule_days')),'{}');
       d:=d||jsonb_build_object('state','draft','lines','[]'::jsonb,'total_cents',NULL);
       UPDATE public.mcp_submittals SET title=coalesce(_p->>'title',title),spec_section=coalesce(_p->>'spec_section',spec_section),required_by=nullif(d->>'due_date','')::date,updated_at=now() WHERE id=s.id;
     ELSE priced:=public.mcp_change_price(_p->'lines');d:=d||priced||jsonb_build_object('state','priced'); END IF;
   ELSIF _action IN ('approve','reject') THEN
     IF current_state<>'submitted' OR coalesce((_p->>'confirmed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Record the decision only after submission and explicit confirmation.'; END IF;
     ev:=_p->'evidence';
     IF length(btrim(coalesce(ev->>'by','')))=0 OR length(btrim(coalesce(ev->>'reference','')))=0 OR nullif(ev->>'at','') IS NULL OR (ev->>'at')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'MCP_BAD:Provide who decided, when, and the approval or rejection reference.'; END IF;
     d:=d||jsonb_build_object('state',CASE WHEN _action='approve' THEN 'approved' ELSE 'rejected' END,'decision',ev);
     UPDATE public.mcp_submittals SET status='in_review',returned_on=((ev->>'at')::timestamptz AT TIME ZONE coalesce(nullif(j.time_zone,''),'UTC'))::date,ball_in_court='gc',updated_at=now() WHERE id=s.id;
     IF _action='approve' THEN
       SELECT coalesce(max(substring(details->>'co_number' FROM '[0-9]+$')::int),0)+1 INTO co_count FROM public.mcp_change_orders WHERE job_id=_job AND details->>'co_number' ~ '^CO-[0-9]{1,8}$';
       d:=d||jsonb_build_object('co_number','CO-'||lpad(co_count::text,greatest(3,length(co_count::text)),'0'));
     END IF;
   ELSIF _action='execute' THEN
     IF current_state<>'approved' OR coalesce((_p->>'confirmed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Execution requires the approved change and explicit confirmation.'; END IF;
     ev:=_p->'evidence';div:=_p->>'sov_division';
     IF length(btrim(coalesce(ev->>'by','')))=0 OR length(btrim(coalesce(ev->>'reference','')))=0 OR nullif(ev->>'at','') IS NULL OR (ev->>'at')::timestamptz>now()+interval '5 minutes' OR coalesce(div,'') !~ '^[0-9]{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Provide the execution authority, date, reference and two-digit SOV division.'; END IF;
     IF d->>'total_cents' IS NULL OR j.sov_fee_pct IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Price the change and record the existing SOV fee before execution.'; END IF;
     SELECT coalesce(sum(round((value->>'billable_value')::numeric*100)),0) INTO base_cents FROM public.mcp_job_facts WHERE job_id=_job AND module='sov' AND NOT(value ? 'executed_change_order');
     IF NOT EXISTS(SELECT 1 FROM public.mcp_job_facts WHERE job_id=_job AND module='sov') THEN RAISE EXCEPTION 'MCP_BAD:Record the base SOV before executing a change.'; END IF;
     SELECT coalesce(sum(round((value->>'billable_value')::numeric*100)),0) INTO delta_cents FROM public.mcp_job_facts WHERE job_id=_job AND module='sov' AND value ? 'executed_change_order';
     prior_total:=round(base_cents/(1-j.sov_fee_pct/100))+delta_cents;
     IF prior_total+(d->>'total_cents')::numeric<0 THEN RAISE EXCEPTION 'MCP_BAD:The credit exceeds the contract total.'; END IF;
     SELECT div||'.'||lpad(n::text,3,'0') INTO item FROM generate_series(1,999) n WHERE NOT EXISTS(SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module='sov' AND f.key=div||'.'||lpad(n::text,3,'0')) ORDER BY n LIMIT 1;
     IF item IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No free SOV line in that division.'; END IF;
     INSERT INTO public.mcp_job_facts(job_id,module,key,value,status,source,internal_only) VALUES(_job,'sov',item,
       jsonb_build_object('description',(d->>'co_number')||' · '||s.title,'billable_value',(d->>'total_cents')::numeric/100,'executed_change_order',s.id,'fee_included',true,'cost_codes','[]'::jsonb,'spec_section',s.spec_section),'known','member_answer',true);
     INSERT INTO public.mcp_job_facts(job_id,module,key,value,status,source,internal_only) VALUES(_job,'contract','executed_change_orders',to_jsonb((delta_cents+(d->>'total_cents')::numeric)/100),'known','member_answer',true)
       ON CONFLICT(job_id,module,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(),updated_by=auth.uid();
     d:=d||jsonb_build_object('state','executed','execution',ev||jsonb_build_object('sov_item',item));
   ELSIF _action='reopen' THEN
     IF current_state IN ('draft','priced','executed') OR coalesce((_p->>'confirmed')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'MCP_BAD:Confirm reopening an issued unexecuted proposal. Executed changes require a separate compensating change.'; END IF;
     SELECT coalesce(max(number),0)+1 INTO tn FROM public.mcp_transmittals WHERE job_id=_job;
     INSERT INTO public.mcp_transmittals(company_id,job_id,number) VALUES(j.company_id,_job,tn) RETURNING id INTO tid;
     INSERT INTO public.mcp_submittals(company_id,job_id,number,revision,previous_id,transmittal_id,spec_section,title,submittal_type,status,ball_in_court,source,required,package_purpose)
       VALUES(s.company_id,_job,s.number,s.revision+1,s.id,tid,s.spec_section,s.title,'other','in_prep','gc','user',true,'change_order') RETURNING * INTO s;
     d:=(d-'decision'-'execution'-'co_number')||jsonb_build_object('state','draft','lines','[]'::jsonb,'total_cents',NULL);
     INSERT INTO public.mcp_change_orders(submittal_id,job_id,details) VALUES(s.id,_job,d);
     INSERT INTO public.mcp_submittal_package_items(company_id,job_id,submittal_id,kind,source_party,file_ref,status,required)
       SELECT company_id,job_id,s.id,kind,source_party,file_ref,status,required FROM public.mcp_submittal_package_items WHERE submittal_id=s.previous_id;
   END IF;
   d:=jsonb_set(d,'{record_version}',to_jsonb(v+1));
   UPDATE public.mcp_change_orders SET details=d,updated_at=now() WHERE submittal_id=s.id;
 END IF;
 IF coalesce(d->>'origin','') NOT IN ('contractor','owner') OR length(btrim(coalesce(d->>'condition',''))) NOT BETWEEN 1 AND 12000 OR length(btrim(coalesce(d->>'scope',''))) NOT BETWEEN 1 AND 12000
   OR jsonb_typeof(d->'references') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'references') NOT BETWEEN 1 AND 40 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'references') r WHERE coalesce(r->>'kind','') NOT IN('drawing','spec','contract','condition') OR length(btrim(coalesce(r->>'citation',''))) NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'MCP_BAD:Provide actual scope and its drawing/specification/condition references.'; END IF;
 IF nullif(d->>'due_date','') IS NOT NULL THEN PERFORM (d->>'due_date')::date;END IF;
 IF nullif(d->>'schedule_days','') IS NOT NULL AND (d->>'schedule_days')::numeric NOT BETWEEN -3650 AND 3650 THEN RAISE EXCEPTION 'MCP_BAD:Check the schedule-day request.';END IF;
 IF nullif(d->>'recipient_email','') IS NOT NULL AND (d->>'recipient_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(d->>'recipient_email')>320) THEN RAISE EXCEPTION 'MCP_BAD:Use one valid recipient email.';END IF;
 INSERT INTO public.mcp_change_history(submittal_id,job_id,record_version,action,snapshot,actor_id) VALUES(s.id,_job,(d->>'record_version')::int,_action,d,auth.uid());
 IF _action IN('create','edit','reopen') THEN
   UPDATE public.mcp_transmittals SET to_name=d->>'recipient_name',to_email=d->>'recipient_email' WHERE id=s.transmittal_id;
 END IF;
 INSERT INTO public.mcp_change_operations(job_id,request_id,actor_id,digest,submittal_id) VALUES(_job,rid,auth.uid(),sig,s.id);
 -- General job history contains no commercial amounts or pricing rows.
 eid:=public.mcp_project_record_add(_job,'change_order_'||_action,s.number||' · '||s.title,'Change-order record updated; commercial details require full job access.',NULL,NULL,'mcp_submittals',s.id,jsonb_build_object('submittal_id',s.id,'state',d->>'state'),'user');
 RETURN jsonb_build_object('saved_id',s.id,'number',s.number,'record_version',d->'record_version','already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_record(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_change_record(uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.mcp_change_rows(_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs;rows jsonb;
BEGIN
 PERFORM public.mcp_assert_active();IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Commercial change orders require full job access.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'number'),'[]') INTO rows FROM (
 SELECT DISTINCT ON(s.number) jsonb_build_object('id',s.id,'number',s.number,'title',s.title,'revision',s.revision,'transmittal_number',t.number,
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('record_version',h.record_version,'action',h.action,'created_at',h.created_at,'snapshot',h.snapshot) ORDER BY h.record_version DESC),'[]') FROM public.mcp_change_history h WHERE h.submittal_id IN (SELECT id FROM public.mcp_submittals WHERE job_id=_job AND number=s.number)),'change_order_details',c.details||jsonb_build_object('state',CASE WHEN c.details->>'state' IN('draft','priced') AND EXISTS(SELECT 1 FROM public.mcp_submittal_mail m WHERE m.submittal_id=s.id AND m.kind='package' AND m.sent_at IS NOT NULL) THEN 'submitted' ELSE c.details->>'state' END)) row
 FROM public.mcp_submittals s JOIN public.mcp_change_orders c ON c.submittal_id=s.id JOIN public.mcp_transmittals t ON t.id=s.transmittal_id WHERE s.job_id=_job ORDER BY s.number,s.revision DESC) latest;
 RETURN jsonb_build_object('job_id',j.id,'job_number',j.job_number,'job_name',j.name,'today',to_char(now() AT TIME ZONE coalesce(nullif(j.time_zone,''),'UTC'),'YYYY-MM-DD'),'time_zone',coalesce(nullif(j.time_zone,''),'UTC'),'read_only',false,'records',rows);
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_rows(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.mcp_change_rows(uuid) TO authenticated;

-- Shared package integration: same files/builds/receipts, with commercial content
-- available only to the existing full-job role. Approval fingerprints stay intact.
DO $patch$
DECLARE original text;revised text;
BEGIN
 SELECT pg_get_functiondef('public.mcp_request_record(uuid,text,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,' INSERT INTO public.mcp_request_operations',E' IF _action IN (''create'',''edit'',''reopen'') THEN UPDATE public.mcp_transmittals SET to_name=s.request_details->>''recipient_name'',to_email=s.request_details->>''recipient_email'' WHERE id=s.transmittal_id; END IF;\n INSERT INTO public.mcp_request_operations');
 IF revised=original THEN RAISE EXCEPTION 'Request writer changed; review named request contacts.';END IF;EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_spec_required()'::regprocedure) INTO original;
 revised:=replace(original,$match$NEW.package_purpose NOT IN ('rfi','rfc')$match$,$match$NEW.package_purpose NOT IN ('rfi','rfc','change_order')$match$);
 IF revised=original THEN RAISE EXCEPTION 'Spec guard changed; review commercial package integration.';END IF;EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_package_write(uuid,uuid,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,$match$s.package_purpose NOT IN ('rfi','rfc')$match$,$match$s.package_purpose NOT IN ('rfi','rfc','change_order')$match$);
 IF revised=original THEN RAISE EXCEPTION 'Package validation changed; review commercial package integration.';END IF;EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_package_context(uuid,uuid)'::regprocedure) INTO original;
 revised:=replace(original,' SELECT * INTO j FROM public.mcp_jobs',E' IF s.package_purpose=''change_order'' AND public.mcp_job_scope(_job) IS DISTINCT FROM ''full'' THEN RAISE EXCEPTION ''MCP_BAD:Commercial change orders require full job access.''; END IF;\n SELECT * INTO j FROM public.mcp_jobs');
 revised:=replace(revised,' SELECT to_jsonb(p) INTO artifact',E' IF s.package_purpose=''change_order'' THEN snap:=snap||jsonb_build_object(''change_order_content'',(SELECT details-''state''-''decision''-''execution''-''record_version'' FROM public.mcp_change_orders WHERE submittal_id=s.id)); END IF;\n SELECT to_jsonb(p) INTO artifact');
 revised:=replace(revised,$match$'submittal',to_jsonb(s)$match$,$match$'change_order_details',CASE WHEN s.package_purpose='change_order' THEN (SELECT details FROM public.mcp_change_orders WHERE submittal_id=s.id) END,'submittal',to_jsonb(s)$match$);
 IF revised=original THEN RAISE EXCEPTION 'Package context changed; review commercial package integration.';END IF;EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_record_get(uuid,text)'::regprocedure) INTO original;
 revised:=replace(original,'  current_row :=',E'  IF cur.package_purpose=''change_order'' AND sc<>''full'' THEN RAISE EXCEPTION ''MCP_BAD:Commercial change orders require full job access.''; END IF;\n  current_row :=');
 revised:=replace(revised,$match$'current', current_row$match$,$match$'current', current_row || CASE WHEN cur.package_purpose='change_order' THEN jsonb_build_object('change_order_details',(SELECT details FROM public.mcp_change_orders WHERE submittal_id=cur.id),'change_order_history',(SELECT coalesce(jsonb_agg(jsonb_build_object('record_version',h.record_version,'action',h.action,'created_at',h.created_at,'snapshot',h.snapshot) ORDER BY h.record_version DESC),'[]') FROM public.mcp_change_history h WHERE h.submittal_id IN (SELECT id FROM public.mcp_submittals WHERE job_id=_job AND number=cur.number))) ELSE '{}'::jsonb END$match$);
 IF revised=original THEN RAISE EXCEPTION 'Record reader changed; review commercial package integration.';END IF;EXECUTE revised;
 SELECT pg_get_functiondef('public.mcp_submittal_delivery(uuid,uuid,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,$match$s.package_purpose IN ('rfi','rfc')$match$,$match$s.package_purpose IN ('rfi','rfc','change_order')$match$);
 revised:=replace(revised,$match$s.package_purpose NOT IN ('rfi','rfc')$match$,$match$s.package_purpose NOT IN ('rfi','rfc','change_order')$match$);
 -- No default review clock on a commercial proposal.
 revised:=replace(revised,$match$nullif(s.request_details->>'due_date','')::date$match$,$match$CASE WHEN s.package_purpose='change_order' THEN (SELECT nullif(details->>'due_date','')::date FROM public.mcp_change_orders WHERE submittal_id=s.id) ELSE nullif(s.request_details->>'due_date','')::date END$match$);
 IF revised=original THEN RAISE EXCEPTION 'Delivery changed; review commercial package integration.';END IF;EXECUTE revised;
END $patch$;

CREATE FUNCTION public.mcp_commercial_package_read(_submittal uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.mcp_submittals s WHERE s.id=_submittal AND
   (s.package_purpose<>'change_order' OR public.mcp_job_scope(s.job_id)='full'))
$$;
REVOKE ALL ON FUNCTION public.mcp_commercial_package_read(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_commercial_package_read(uuid) TO authenticated;
CREATE POLICY "commercial package restriction" ON public.mcp_submittal_packages AS RESTRICTIVE FOR SELECT TO authenticated USING(public.mcp_commercial_package_read(submittal_id));
CREATE POLICY "commercial pieces restriction" ON public.mcp_submittal_package_items AS RESTRICTIVE FOR SELECT TO authenticated USING(public.mcp_commercial_package_read(submittal_id));
CREATE OR REPLACE FUNCTION public.mcp_submittal_path_scope(_name text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE parts text[]:=string_to_array(_name,'/');j uuid;c uuid;sid uuid;sc text;
BEGIN
 PERFORM public.mcp_assert_active();
 IF array_length(parts,1)<>5 OR parts[3] NOT IN('pieces','packages') OR parts[5] IN('','.','..') THEN RETURN NULL;END IF;
 BEGIN j:=parts[2]::uuid;c:=parts[1]::uuid;PERFORM parts[4]::uuid;EXCEPTION WHEN OTHERS THEN RETURN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE id=j AND company_id=c) THEN RETURN NULL;END IF;
 sc:=public.mcp_job_scope(j);
 IF sc='super' THEN
   IF parts[3]='pieces' THEN SELECT submittal_id INTO sid FROM public.mcp_submittal_package_items WHERE file_ref='athena-submittals/'||_name AND job_id=j ORDER BY created_at LIMIT 1;
   ELSE SELECT submittal_id INTO sid FROM public.mcp_submittal_packages WHERE id=parts[4]::uuid AND job_id=j;END IF;
   IF sid IS NULL OR NOT public.mcp_commercial_package_read(sid) THEN RETURN NULL;END IF;
 END IF;
 RETURN sc;
END $$;

-- The same internal full-job capability used for package records opens the CO log.
CREATE FUNCTION public.mcp_change_log_open(_token_hash text,_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE link public.mcp_board_links;payload jsonb;result text:='ok';
 old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);old_role text:=current_setting('request.jwt.claim.role',true);
BEGIN
 IF coalesce(_token_hash,'') !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status','unknown','payload',NULL);END IF;
 SELECT * INTO link FROM public.mcp_board_links WHERE token_hash=_token_hash AND job_id=_job AND scope='full' AND revoked_at IS NULL AND expires_at>now();
 IF link.id IS NULL THEN RETURN jsonb_build_object('status','denied','payload',NULL);END IF;
 BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',link.created_by::text,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',link.created_by::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 payload:=public.mcp_change_rows(_job)||jsonb_build_object('read_only',true);
 INSERT INTO public.mcp_board_link_opens(link_id,job_id,page) VALUES(link.id,_job,'cos');
 UPDATE public.mcp_board_links SET view_count=view_count+1,last_viewed_at=now() WHERE id=link.id;
 EXCEPTION WHEN OTHERS THEN result:='unavailable';payload:=NULL;END;
 PERFORM set_config('request.jwt.claims',coalesce(old_claims,'{}'),true);PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);PERFORM set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 RETURN jsonb_build_object('status',result,'payload',payload);
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_log_open(text,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.mcp_change_log_open(text,uuid) TO anon,authenticated;
CREATE POLICY "commercial facts restriction" ON public.mcp_job_facts AS RESTRICTIVE FOR SELECT TO authenticated
 USING((NOT coalesce(value ? 'executed_change_order',false) AND key<>'executed_change_orders') OR public.mcp_job_scope(job_id)='full');
CREATE FUNCTION public.mcp_executed_change_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.module='sov' AND OLD.value ? 'executed_change_order' THEN RAISE EXCEPTION 'MCP_BAD:An executed change is immutable; use a separately approved compensating change.';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.mcp_executed_change_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mcp_executed_change_immutable BEFORE UPDATE OR DELETE ON public.mcp_job_facts FOR EACH ROW EXECUTE FUNCTION public.mcp_executed_change_immutable();
COMMIT;
