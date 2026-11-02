-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- No new authenticated execute grants or direct table access.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE public.mcp_payment_applications (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), company_id uuid NOT NULL,
 number text NOT NULL CHECK(length(btrim(number)) BETWEEN 1 AND 120), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_payment_application_number ON public.mcp_payment_applications(job_id,lower(btrim(number)));
CREATE TABLE public.mcp_payment_application_versions (
 application_id uuid NOT NULL REFERENCES public.mcp_payment_applications(id), version integer NOT NULL CHECK(version>0),
 job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), body jsonb NOT NULL, calculation jsonb NOT NULL,
 billing_version integer, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(application_id,version)
);
CREATE INDEX mcp_payment_application_predecessor ON public.mcp_payment_application_versions(job_id,(body->'prior_application'->>'id'));
CREATE TABLE public.mcp_payment_application_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), actor_id uuid NOT NULL,
 payload jsonb NOT NULL, context_hash text NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', consumed_at timestamptz
);
ALTER TABLE public.mcp_payment_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_payment_application_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_payment_application_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_payment_applications,public.mcp_payment_application_versions,public.mcp_payment_application_reviews FROM PUBLIC,anon,authenticated;

-- Strict nullable integer parser. A missing figure remains NULL, never an assumed zero.
CREATE FUNCTION public.mcp_pa_number(v jsonb, signed boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE n numeric;
BEGIN
 IF v IS NULL OR v='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'MCP_BAD:Use integer USD cents.'; END IF;
 n:=(v::text)::numeric;
 IF n<>trunc(n) OR abs(n)>9000000000000 OR (NOT signed AND n<0) THEN RAISE EXCEPTION 'MCP_BAD:Amount is outside the supported integer-cent range.'; END IF;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.mcp_pa_number(jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_pa_snapshot(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE lines jsonb; f numeric; base numeric; changes numeric; contract numeric; value numeric; approved numeric; r record;
BEGIN
 SELECT sov_fee_pct INTO f FROM public.mcp_jobs WHERE id=_job;
 IF f IS NULL OR f<0 OR f>=100 THEN RAISE EXCEPTION 'MCP_BAD:The saved SOV fee basis is needed, including an explicit zero fee.'; END IF;
 lines:='[]'; base:=0; changes:=0;
 FOR r IN SELECT f.key,f.value,f.status FROM public.mcp_job_facts f WHERE job_id=_job AND module='sov' ORDER BY key LOOP
   IF r.status<>'known' OR jsonb_typeof(r.value->'billable_value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Every saved SOV line needs a known scheduled value.'; END IF;
   value:=(r.value->>'billable_value')::numeric*100;
   IF value<>trunc(value) OR abs(value)>9000000000000 OR length(r.key)>40 OR r.key='CF' THEN RAISE EXCEPTION 'MCP_BAD:Reconcile the saved SOV line values and identifiers.'; END IF;
   IF nullif(r.value->>'executed_change_order','') IS NOT NULL AND r.value->>'fee_included'='true' THEN changes:=changes+value; ELSE base:=base+value; END IF;
   lines:=lines||jsonb_build_array(jsonb_build_object('item',r.key,'description',left(coalesce(r.value->>'description',r.key),500),'scheduled_cents',value));
 END LOOP;
 IF jsonb_array_length(lines) NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'MCP_BAD:A saved SOV with at most 99 work lines is needed.'; END IF;
 contract:=round(base/(1-f/100))+changes;
 IF contract<0 OR contract>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Reconcile the saved SOV contract total.'; END IF;
 approved:=public.mcp_pa_number(public.mcp_billing_evidence_get(_job)->'recorded_contract'->'approved_cents');
 IF approved IS NULL OR approved<>contract THEN RAISE EXCEPTION 'MCP_BAD:Reconcile the saved SOV with the recorded approved contract and change orders.'; END IF;
 IF contract<>base+changes THEN lines:=lines||jsonb_build_array(jsonb_build_object('item','CF','description','Contractor fee','scheduled_cents',contract-base-changes)); END IF;
 RETURN jsonb_build_object('fingerprint',md5(jsonb_build_object('lines',lines,'fee_pct',f,'contract_cents',contract)::text),'contract_cents',contract,'lines',lines);
END $$;
REVOKE ALL ON FUNCTION public.mcp_pa_snapshot(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_pa_evidence(_job uuid,_exclude uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'version',v.version,'number',i.document_number,'kind',i.kind,'status',v.status,
 'invoice_date',v.invoice_date,'gross_cents',v.gross_cents,'net_due_cents',v.net_due_cents,'certified_cents',v.certified_cents,'credit_for',i.credit_for) ORDER BY i.document_number),'[]')
 FROM public.mcp_billing_invoices i JOIN LATERAL(SELECT * FROM public.mcp_billing_invoice_versions WHERE invoice_id=i.id ORDER BY version DESC LIMIT 1)v ON true
 WHERE i.job_id=_job AND i.id IS DISTINCT FROM _exclude AND v.status IN ('submitted','certified','posted')
$$;
REVOKE ALL ON FUNCTION public.mcp_pa_evidence(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_pa_calculate(a jsonb,evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE issues jsonb:='[]'; rows jsonb:='[]'; l jsonb; s jsonb; e jsonb; choice jsonb; k text; n numeric;
 c numeric; pw numeric; ps numeric; ph numeric; w numeric; st numeric; wb numeric; sb numeric; transfer numeric; rel numeric; g numeric; h numeric;
 gross numeric:=0; held numeric:=0; priorgross numeric:=0; priorheld numeric:=0; contract numeric; priorcert numeric; due numeric; delta numeric; billed numeric:=0;
 startday date; endday date; cutoff date; label text; missing boolean; ident text;
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR octet_length(a::text)>200000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid application.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(a) t(k) WHERE t.k NOT IN ('number','period_start','period_end','prior_cutoff','state','source','reason','retainage_basis','prior_mode','prior_application','prior_certified_net_cents','prior_basis','certification','evidence','lines','snapshot')) THEN RAISE EXCEPTION 'MCP_BAD:Unexpected application field.'; END IF;
 FOREACH k IN ARRAY ARRAY['number','source','reason','retainage_basis','prior_basis','period_start','period_end','prior_cutoff','state','prior_mode'] LOOP
   IF jsonb_typeof(a->k) IS DISTINCT FROM 'string' OR length(a->>k)>2000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid application text.'; END IF;
 END LOOP;
 IF length(btrim(a->>'number')) NOT BETWEEN 1 AND 120 OR length(btrim(a->>'source'))<1 OR a->>'state' NOT IN ('draft','ready','submitted','certified') OR a->>'prior_mode' NOT IN ('first','external','saved') THEN RAISE EXCEPTION 'MCP_BAD:Provide the application number, source and valid states.'; END IF;
 FOREACH k IN ARRAY ARRAY['period_start','period_end','prior_cutoff'] LOOP
   IF a->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Use valid calendar dates.'; END IF;
 END LOOP;
 startday:=(a->>'period_start')::date; endday:=(a->>'period_end')::date; cutoff:=(a->>'prior_cutoff')::date;
 IF startday>endday THEN issues:=issues||jsonb_build_array('The application period ends before it starts.'); END IF;
 IF cutoff>=startday THEN issues:=issues||jsonb_build_array('The prior certificate cutoff must precede this period.'); END IF;
 IF length(btrim(a->>'prior_basis'))=0 THEN issues:=issues||jsonb_build_array('Record the prior certificate basis.'); END IF;
 IF length(btrim(a->>'retainage_basis'))=0 THEN issues:=issues||jsonb_build_array('Record the applicable retainage terms, including an explicit zero rate where applicable.'); END IF;
 priorcert:=public.mcp_pa_number(a->'prior_certified_net_cents');
 IF priorcert IS NULL THEN issues:=issues||jsonb_build_array('Prior certified net amount is needed; cash and credits do not supply it automatically.'); END IF;
 IF a->>'prior_mode'='saved' THEN
   IF jsonb_typeof(a->'prior_application') IS DISTINCT FROM 'object' THEN issues:=issues||jsonb_build_array('Choose the exact prior certified application.'); END IF;
 ELSIF a->'prior_application' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:The prior application reference conflicts with its basis.'; END IF;
 IF jsonb_typeof(a->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'lines') NOT BETWEEN 1 AND 100 OR jsonb_typeof(a->'snapshot'->'lines') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MCP_BAD:Application continuation lines are needed.'; END IF;
 contract:=public.mcp_pa_number(a->'snapshot'->'contract_cents');
 IF contract IS NULL OR (SELECT sum(public.mcp_pa_number(x->'scheduled_cents',true)) FROM jsonb_array_elements(a->'snapshot'->'lines')x)<>contract THEN RAISE EXCEPTION 'MCP_BAD:The SOV does not tie to its contract total.'; END IF;
 IF jsonb_array_length(a->'lines')<>jsonb_array_length(a->'snapshot'->'lines') OR EXISTS(SELECT 1 FROM jsonb_array_elements(a->'lines')x GROUP BY x->>'item' HAVING count(*)<>1) THEN RAISE EXCEPTION 'MCP_BAD:Application lines must match the exact saved SOV without duplicates or omissions.'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(a->'lines') LOOP
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(l)t(k) WHERE t.k NOT IN ('item','prior_work_cents','prior_stored_cents','prior_retained_cents','work_cents','stored_cents','stored_to_work_cents','work_retainage_bps','stored_retainage_bps','release_cents','stored_basis','release_basis')) THEN RAISE EXCEPTION 'MCP_BAD:Unexpected continuation field.'; END IF;
   IF jsonb_typeof(l->'item') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MCP_BAD:Use the exact SOV line identifier.'; END IF;
   SELECT x INTO s FROM jsonb_array_elements(a->'snapshot'->'lines')x WHERE x->>'item'=l->>'item';
   IF s IS NULL THEN RAISE EXCEPTION 'MCP_BAD:An application line is outside the saved SOV.'; END IF;
   c:=public.mcp_pa_number(s->'scheduled_cents',true); label:=s->>'description';
   pw:=public.mcp_pa_number(l->'prior_work_cents',true); ps:=public.mcp_pa_number(l->'prior_stored_cents'); ph:=public.mcp_pa_number(l->'prior_retained_cents',true);
   w:=public.mcp_pa_number(l->'work_cents',true); st:=public.mcp_pa_number(l->'stored_cents'); transfer:=public.mcp_pa_number(l->'stored_to_work_cents'); wb:=public.mcp_pa_number(l->'work_retainage_bps'); sb:=public.mcp_pa_number(l->'stored_retainage_bps'); rel:=public.mcp_pa_number(l->'release_cents');
   FOREACH k IN ARRAY ARRAY['stored_basis','release_basis'] LOOP IF jsonb_typeof(l->k) IS DISTINCT FROM 'string' OR length(l->>k)>2000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid line evidence basis.'; END IF; END LOOP;
   IF wb>10000 OR sb>10000 THEN RAISE EXCEPTION 'MCP_BAD:Retainage rates must be between zero and 100 percent.'; END IF;
   missing:=pw IS NULL OR ps IS NULL OR ph IS NULL OR w IS NULL OR st IS NULL OR transfer IS NULL OR wb IS NULL OR sb IS NULL OR rel IS NULL;
   IF missing THEN issues:=issues||jsonb_build_array(label||': current work, stored materials, prior values and retainage inputs are needed.'); END IF;
   IF pw<least(0,c) OR pw>greatest(0,c) OR w<least(0,c) OR w>greatest(0,c) OR pw+ps<least(0,c) OR pw+ps>greatest(0,c) OR w+st<least(0,c) OR w+st>greatest(0,c) THEN issues:=issues||jsonb_build_array(label||': completed and stored amount exceeds its SOV scope.'); END IF;
   IF (c>=0 AND (w<pw OR w+st<pw+ps)) OR (c<0 AND (w>pw OR w+st>pw+ps)) THEN issues:=issues||jsonb_build_array(label||': reconcile the prior certificate before reducing cumulative earned work.'); END IF;
   IF transfer>ps OR transfer>greatest(0,w-pw) OR st-ps+transfer<0 THEN issues:=issues||jsonb_build_array(label||': reconcile the explicit stored-to-installed transfer and new eligible stored materials.'); END IF;
   IF c<0 AND (st<>0 OR ps<>0 OR rel<>0) THEN issues:=issues||jsonb_build_array(label||': a credit SOV line cannot contain stored materials or a positive retainage release.'); END IF;
   IF st>0 AND length(btrim(l->>'stored_basis'))=0 THEN issues:=issues||jsonb_build_array(label||': the stored-material source and eligibility basis are needed.'); END IF;
   IF rel>0 AND length(btrim(l->>'release_basis'))=0 THEN issues:=issues||jsonb_build_array(label||': the retainage release source and approval basis are needed.'); END IF;
   IF (c>=0 AND (ph<0 OR ph>pw+ps)) OR (c<0 AND (ph>0 OR ph<pw+ps)) THEN issues:=issues||jsonb_build_array(label||': prior retainage is outside the prior earned amount.'); END IF;
   h:=CASE WHEN transfer IS NULL THEN NULL ELSE round(w*wb/10000)+round(st*sb/10000)-rel END; g:=w+st;
   IF rel>greatest(0,round(w*wb/10000)+round(st*sb/10000)) THEN issues:=issues||jsonb_build_array(label||': retainage release exceeds calculated retainage.'); END IF;
   gross:=gross+g; held:=held+h; priorgross:=priorgross+pw+ps; priorheld:=priorheld+ph;
   rows:=rows||jsonb_build_array(l||jsonb_build_object('description',label,'scheduled_cents',c,'this_period_work_cents',w-pw,'gross_cents',g,'retained_cents',h,'earned_net_cents',g-h,'balance_cents',c-g));
 END LOOP;
 IF a->>'prior_mode'='first' AND (priorgross IS DISTINCT FROM 0 OR priorheld IS DISTINCT FROM 0 OR priorcert IS DISTINCT FROM 0) THEN issues:=issues||jsonb_build_array('A first application requires explicitly confirmed zero prior work, storage, retainage and certification.'); END IF;
 IF priorcert>priorgross-priorheld THEN issues:=issues||jsonb_build_array('Prior certification exceeds its reconciled prior earned net amount.'); END IF;
 due:=gross-held-priorcert;
 IF due<0 THEN issues:=issues||jsonb_build_array('A negative application requires the separate reviewed credit/correction workflow.'); END IF;
 IF a->>'state'='certified' THEN
   IF jsonb_typeof(a->'certification') IS DISTINCT FROM 'object' OR jsonb_typeof(a->'certification'->'date') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'certification'->'source') IS DISTINCT FROM 'string' OR public.mcp_pa_number(a->'certification'->'amount_cents') IS NULL OR length(btrim(coalesce(a->'certification'->>'source','')))=0 OR length(a->'certification'->>'source')>2000 OR a->'certification'->>'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'MCP_BAD:Record the actual certificate amount, date and source.'; END IF;
   PERFORM (a->'certification'->>'date')::date;
   IF public.mcp_pa_number(a->'certification'->'amount_cents')>due THEN issues:=issues||jsonb_build_array('Certification exceeds the requested amount.'); END IF;
 ELSIF a->'certification' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Certification facts require the certified state.'; END IF;
 IF jsonb_typeof(a->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'evidence')>200 OR jsonb_array_length(evidence)>200 THEN RAISE EXCEPTION 'MCP_BAD:Reconcile the billing evidence set.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'evidence')x GROUP BY x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence contains duplicate selections.'; END IF;
 FOR choice IN SELECT * FROM jsonb_array_elements(a->'evidence') LOOP
   IF jsonb_typeof(choice->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(choice->'treatment') IS DISTINCT FROM 'string' OR jsonb_typeof(choice->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(choice->'id') IS DISTINCT FROM 'string' OR choice->>'treatment' NOT IN ('prior_billing','separate') OR length(btrim(coalesce(choice->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Explain each billing evidence reconciliation.'; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence)x WHERE x->>'id'=choice->>'id' AND x->'version'=choice->'version') THEN issues:=issues||jsonb_build_array('Billing evidence changed or has not been explicitly reconciled.'); END IF;
 END LOOP;
 FOR e IN SELECT * FROM jsonb_array_elements(evidence) LOOP
   SELECT x INTO choice FROM jsonb_array_elements(a->'evidence')x WHERE x->>'id'=e->>'id' AND x->'version'=e->'version';
   IF choice IS NULL THEN issues:=issues||jsonb_build_array('Billing evidence changed or has not been explicitly reconciled.');
   ELSIF choice->>'treatment'='prior_billing' THEN
     IF (e->>'invoice_date')::date>cutoff THEN issues:=issues||jsonb_build_array((e->>'number')||': evidence is later than the prior cutoff.'); END IF;
     IF e->>'kind'='credit' THEN
       IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'evidence')x WHERE x->>'id'=e->>'credit_for' AND x->>'treatment'='prior_billing') THEN issues:=issues||jsonb_build_array('Reconcile the credit with its linked invoice.'); END IF;
       billed:=billed-public.mcp_pa_number(e->'net_due_cents');
     ELSE billed:=billed+public.mcp_pa_number(e->'net_due_cents'); END IF;
   END IF;
 END LOOP;
 IF billed>priorcert THEN issues:=issues||jsonb_build_array('Prior issued billing exceeds the stated previous certification. Reconcile it before adding another bill.'); END IF;
 IF abs(gross)>9000000000000 OR abs(held)>9000000000000 OR abs(priorgross)>9000000000000 OR abs(due)>9000000000000 THEN issues:=issues||jsonb_build_array('Application totals exceed the supported cent range.'); END IF;
 delta:=held-priorheld;
 RETURN jsonb_build_object('evidence',evidence,'complete',jsonb_array_length(issues)=0,'issues',issues,'rows',rows,'contract_cents',contract,
 'prior_gross_cents',priorgross,'prior_retained_cents',priorheld,'prior_certified_net_cents',priorcert,
 'gross_cents',gross,'retained_cents',held,'earned_net_cents',gross-held,'payment_due_cents',due,
 'unearned_cents',contract-gross,'balance_including_retainage_cents',contract-gross+held,
 'billing_gross_cents',due+CASE WHEN delta>=0 THEN delta ELSE 0 END-CASE WHEN delta<0 THEN -delta ELSE 0 END,
 'billing_withheld_cents',CASE WHEN delta IS NULL THEN NULL ELSE greatest(0,delta) END,'billing_released_cents',CASE WHEN delta IS NULL THEN NULL ELSE greatest(0,-delta) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_pa_calculate(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_pa_dispatch(_job uuid,_action text,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE j public.mcp_jobs; head public.mcp_payment_applications; prev public.mcp_payment_application_versions; predecessor public.mcp_payment_application_versions;
 ticket public.mcp_payment_application_reviews; op public.mcp_billing_operations; existing public.mcp_billing_invoice_versions;
 ident uuid; rid uuid; reviewid uuid; expected integer; sig text; a jsonb; snapshot jsonb; evidence jsonb; calc jsonb; result jsonb; listing jsonb; selected jsonb;
 l jsonb; oldline jsonb; snapshot_issue text; issue jsonb:='[]'; bv integer; used numeric; credits numeric; latest integer;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.'; END IF;
 IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>210000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid payment application request.'; END IF;
 SELECT * INTO j FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
 ident:=nullif(_p->>'id','')::uuid;
 IF _action='payment_application_outcome' THEN
   rid:=nullif(_p->>'request_id','')::uuid;
   SELECT * INTO op FROM public.mcp_billing_operations WHERE job_id=_job AND request_id=rid;
   IF op.request_id IS NULL THEN RETURN jsonb_build_object('applied',false); END IF;
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM md5((_p-'review_key')::text) THEN RAISE EXCEPTION 'MCP_BAD:Operation belongs to different content.'; END IF;
   RETURN op.result||jsonb_build_object('applied',true);
 END IF;
 IF _action='payment_application_read' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'number',h.number,'version',v.version,'state',v.body->>'state','period_start',v.body->>'period_start','period_end',v.body->>'period_end','recorded_at',v.recorded_at) ORDER BY h.created_at DESC),'[]') INTO listing
   FROM public.mcp_payment_applications h JOIN LATERAL(SELECT * FROM public.mcp_payment_application_versions WHERE application_id=h.id ORDER BY version DESC LIMIT 1)v ON true WHERE h.job_id=_job;
   IF jsonb_array_length(listing)>200 THEN RAISE EXCEPTION 'MCP_BAD:Narrow the application archive before continuing.'; END IF;
   IF ident IS NOT NULL THEN
     SELECT * INTO head FROM public.mcp_payment_applications WHERE id=ident AND job_id=_job;
     IF head.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This payment application is unavailable in this job.'; END IF;
     SELECT max(version) INTO latest FROM public.mcp_payment_application_versions WHERE application_id=ident;
     expected:=coalesce((_p->>'version')::integer,latest);
     SELECT to_jsonb(v)||jsonb_build_object('number',head.number,'latest_version',latest,'history',(SELECT jsonb_agg(jsonb_build_object('version',h.version,'state',h.body->>'state','recorded_at',h.recorded_at,'reason',h.body->>'reason') ORDER BY h.version DESC) FROM public.mcp_payment_application_versions h WHERE h.application_id=ident)) INTO selected
     FROM public.mcp_payment_application_versions v WHERE v.application_id=ident AND v.version=expected;
     IF selected IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This exact payment application version is unavailable.'; END IF;
   END IF;
   -- A historical document remains readable if today's SOV is incomplete.
   BEGIN snapshot:=public.mcp_pa_snapshot(_job); EXCEPTION WHEN raise_exception THEN
     IF SQLERRM NOT LIKE 'MCP_BAD:%' THEN RAISE; END IF;
     snapshot:=NULL; snapshot_issue:=substring(SQLERRM FROM 9);
   END;
   RETURN jsonb_build_object('job',jsonb_build_object('number',j.job_number,'name',j.name),'currency','USD','snapshot',snapshot,'snapshot_issue',snapshot_issue,'evidence',public.mcp_pa_evidence(_job,ident),'applications',listing,'selected',selected);
 END IF;
 IF _action NOT IN ('payment_application_review','payment_application_save') THEN RAISE EXCEPTION 'MCP_BAD:Unknown application action.'; END IF;
 rid:=nullif(_p->>'request_id','')::uuid; expected:=(_p->>'expected_version')::integer; a:=_p->'application';
 IF rid IS NULL OR ident IS NULL OR expected IS NULL OR expected<0 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_p)t(k) WHERE t.k NOT IN ('id','request_id','expected_version','application','review_key')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid versioned application request.'; END IF;
 sig:=md5((_p-'review_key')::text);
 SELECT * INTO op FROM public.mcp_billing_operations WHERE job_id=_job AND request_id=rid;
 IF op.request_id IS NOT NULL THEN
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM sig THEN RAISE EXCEPTION 'MCP_BAD:Operation ID belongs to different content.'; END IF;
   RETURN op.result||jsonb_build_object('already_applied',true);
 END IF;
 SELECT * INTO head FROM public.mcp_payment_applications WHERE id=ident;
 IF head.id IS NOT NULL AND head.job_id<>_job THEN RAISE EXCEPTION 'MCP_BAD:This payment application is unavailable in this job.'; END IF;
 SELECT * INTO prev FROM public.mcp_payment_application_versions WHERE application_id=ident ORDER BY version DESC LIMIT 1;
 IF coalesce(prev.version,0)<>expected THEN RAISE EXCEPTION 'MCP_BAD:The application version changed. Read it again before review.'; END IF;
 IF prev.version IS NOT NULL AND (a->>'number' IS DISTINCT FROM head.number OR length(btrim(coalesce(a->>'reason',''))) NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'MCP_BAD:Keep the application number and explain this revision.'; END IF;
 IF prev.version IS NULL AND EXISTS(SELECT 1 FROM public.mcp_billing_invoices WHERE id=ident AND job_id=_job) THEN RAISE EXCEPTION 'MCP_BAD:Choose a new application identity.'; END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_payment_applications WHERE job_id=_job AND lower(btrim(number))=lower(btrim(a->>'number')) AND id<>ident) OR EXISTS(SELECT 1 FROM public.mcp_billing_invoices WHERE job_id=_job AND lower(btrim(document_number))=lower(btrim(a->>'number')) AND id<>ident) THEN RAISE EXCEPTION 'MCP_BAD:This application or billing number already exists.'; END IF;
 snapshot:=public.mcp_pa_snapshot(_job);
 IF a->'snapshot' IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'MCP_BAD:The saved SOV changed. Refresh and reconcile the application before review.'; END IF;
 evidence:=public.mcp_pa_evidence(_job,ident); calc:=public.mcp_pa_calculate(a,evidence);
 IF a->>'prior_mode'='saved' AND jsonb_typeof(a->'prior_application')='object' THEN
   SELECT * INTO predecessor FROM public.mcp_payment_application_versions WHERE application_id=(a->'prior_application'->>'id')::uuid AND version=(a->'prior_application'->>'version')::integer AND job_id=_job;
   IF predecessor.application_id=ident OR predecessor.body->>'state' IS DISTINCT FROM 'certified' OR predecessor.version IS DISTINCT FROM (SELECT max(version) FROM public.mcp_payment_application_versions WHERE application_id=predecessor.application_id) THEN RAISE EXCEPTION 'MCP_BAD:Choose the current exact certified predecessor in this job.'; END IF;
   IF a->>'prior_cutoff' IS DISTINCT FROM predecessor.body->>'period_end' OR public.mcp_pa_number(a->'prior_certified_net_cents') IS DISTINCT FROM public.mcp_pa_number(predecessor.body->'prior_certified_net_cents')+public.mcp_pa_number(predecessor.body->'certification'->'amount_cents') THEN RAISE EXCEPTION 'MCP_BAD:Prior cutoff and certified amount must carry forward the actual saved certificate.'; END IF;
   FOR oldline IN SELECT * FROM jsonb_array_elements(predecessor.calculation->'rows') LOOP
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'lines')x WHERE x->>'item'=oldline->>'item') THEN RAISE EXCEPTION 'MCP_BAD:Reconcile removed prior SOV lines before proceeding.'; END IF;
   END LOOP;
   FOR l IN SELECT * FROM jsonb_array_elements(a->'lines') LOOP
     SELECT x INTO oldline FROM jsonb_array_elements(predecessor.calculation->'rows')x WHERE x->>'item'=l->>'item';
     IF oldline IS NULL THEN
       IF public.mcp_pa_number(l->'prior_work_cents',true)<>0 OR public.mcp_pa_number(l->'prior_stored_cents')<>0 OR public.mcp_pa_number(l->'prior_retained_cents',true)<>0 THEN RAISE EXCEPTION 'MCP_BAD:Reconcile a new SOV line with the prior certificate; do not invent prior amounts.'; END IF;
       CONTINUE;
     END IF;
     IF public.mcp_pa_number(l->'prior_work_cents',true) IS DISTINCT FROM coalesce(public.mcp_pa_number(oldline->'work_cents',true),0) OR public.mcp_pa_number(l->'prior_stored_cents') IS DISTINCT FROM coalesce(public.mcp_pa_number(oldline->'stored_cents'),0) OR public.mcp_pa_number(l->'prior_retained_cents',true) IS DISTINCT FROM coalesce(public.mcp_pa_number(oldline->'retained_cents',true),0) THEN RAISE EXCEPTION 'MCP_BAD:Prior line work, storage and retainage must match the saved certificate.'; END IF;
   END LOOP;
 END IF;
 IF (prev.body->>'state' IN ('submitted','certified') AND a->>'state' IN ('draft','ready')) OR (prev.body->>'state'='certified' AND a->>'state'<>'certified') OR (a->>'state'='certified' AND coalesce(prev.body->>'state','') NOT IN ('submitted','certified')) THEN RAISE EXCEPTION 'MCP_BAD:Invalid application state transition.'; END IF;
 IF prev.body->>'state' IN ('submitted','certified') AND EXISTS(SELECT 1 FROM public.mcp_payment_application_versions v WHERE v.job_id=_job AND v.body->'prior_application'->>'id'=ident::text) THEN RAISE EXCEPTION 'MCP_BAD:A later saved application references this certificate. Reconcile its lineage before revising.'; END IF;
 IF a->>'state' IN ('submitted','certified') AND EXISTS(SELECT 1 FROM public.mcp_payment_applications h JOIN LATERAL(SELECT body FROM public.mcp_payment_application_versions WHERE application_id=h.id ORDER BY version DESC LIMIT 1)v ON true WHERE h.job_id=_job AND h.id<>ident AND v.body->>'state' IN ('submitted','certified') AND (v.body->>'period_start')::date<=(a->>'period_end')::date AND (v.body->>'period_end')::date>=(a->>'period_start')::date) THEN RAISE EXCEPTION 'MCP_BAD:An issued application already covers this period. Revise that application instead.'; END IF;
 IF a->>'state'<>'draft' AND calc->>'complete'<>'true' THEN RAISE EXCEPTION 'MCP_BAD:Complete and reconcile the Needed inputs before marking ready, submitting or certifying.'; END IF;
 IF public.mcp_pa_number(calc->'billing_gross_cents',true)<0 THEN RAISE EXCEPTION 'MCP_BAD:The current billing gross requires a separate reviewed correction.'; END IF;
 IF _action='payment_application_review' THEN
   INSERT INTO public.mcp_payment_application_reviews(job_id,actor_id,payload,context_hash) VALUES(_job,auth.uid(),_p-'review_key',md5(jsonb_build_object('snapshot',snapshot,'evidence',evidence,'calculation',calc)::text)) RETURNING * INTO ticket;
   RETURN jsonb_build_object('review_key',ticket.id,'expires_at',ticket.expires_at,'payload',_p-'review_key','calculation',calc,'state',a->>'state','billing_effect',CASE WHEN a->>'state' IN ('submitted','certified') THEN 'One current-amount billing record; no payment is sent.' ELSE 'Saved application only; no issued billing.' END);
 END IF;
 reviewid:=nullif(_p->>'review_key','')::uuid;
 UPDATE public.mcp_payment_application_reviews SET consumed_at=now() WHERE id=reviewid AND job_id=_job AND actor_id=auth.uid() AND payload=_p-'review_key' AND context_hash=md5(jsonb_build_object('snapshot',snapshot,'evidence',evidence,'calculation',calc)::text) AND consumed_at IS NULL AND expires_at>now() RETURNING * INTO ticket;
 IF ticket.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Review expired, changed or already used. Review this exact application again.'; END IF;
 IF head.id IS NULL THEN INSERT INTO public.mcp_payment_applications(id,job_id,company_id,number,created_by) VALUES(ident,_job,j.company_id,btrim(a->>'number'),auth.uid()); END IF;
 bv:=prev.billing_version;
 IF a->>'state' IN ('submitted','certified') THEN
   SELECT * INTO existing FROM public.mcp_billing_invoice_versions WHERE invoice_id=ident ORDER BY version DESC LIMIT 1;
   IF existing.version IS DISTINCT FROM prev.billing_version THEN RAISE EXCEPTION 'MCP_BAD:The linked billing record changed. Reconcile it before proceeding.'; END IF;
   used:=coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id=ident AND job_id=_job),0);
   credits:=public.mcp_billing_posted_credits(_job,ident,NULL);
   IF public.mcp_pa_number(calc->'payment_due_cents')<used+credits THEN RAISE EXCEPTION 'MCP_BAD:Application amount cannot be less than allocated cash and posted credits.'; END IF;
   IF existing.invoice_id IS NULL THEN INSERT INTO public.mcp_billing_invoices(id,job_id,company_id,document_number,kind,created_by) VALUES(ident,_job,j.company_id,btrim(a->>'number'),'pay_application',auth.uid()); END IF;
   bv:=coalesce(existing.version,0)+1;
   INSERT INTO public.mcp_billing_invoice_versions(invoice_id,job_id,version,status,invoice_date,period_start,period_end,effective_date,source,gross_cents,withheld_cents,released_cents,net_due_cents,certified_cents,certified_date,reason,recorded_by)
   VALUES(ident,_job,bv,a->>'state',(a->>'period_end')::date,(a->>'period_start')::date,(a->>'period_end')::date,(a->>'period_end')::date,a->>'source',public.mcp_pa_number(calc->'billing_gross_cents'),public.mcp_pa_number(calc->'billing_withheld_cents'),public.mcp_pa_number(calc->'billing_released_cents'),public.mcp_pa_number(calc->'payment_due_cents'),public.mcp_pa_number(a->'certification'->'amount_cents'),(a->'certification'->>'date')::date,nullif(a->>'reason',''),auth.uid());
 END IF;
 INSERT INTO public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,billing_version,recorded_by) VALUES(ident,expected+1,_job,a,calc,bv,auth.uid());
 result:=jsonb_build_object('id',ident,'version',expected+1,'state',a->>'state','billing_version',bv);
 INSERT INTO public.mcp_billing_operations(job_id,request_id,actor_id,signature,result) VALUES(_job,rid,auth.uid(),sig,result);
 RETURN result||jsonb_build_object('already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_pa_dispatch(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

-- Extend the existing gated RPC in place: preserve its owner, ACL, signature and all legacy paths.
DO $patch$
DECLARE original text; definition text; changed text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc WHERE oid='public.mcp_billing_evidence_record(uuid,text,jsonb)'::regprocedure;
 IF position('payment_application_read' IN original)>0 OR position(E'BEGIN\n PERFORM public.mcp_assert_active();' IN original)=0 OR position(' IF _action=''invoice'' THEN' IN original)=0 THEN RAISE EXCEPTION 'Unexpected billing function shape; stop for review.'; END IF;
 changed:=replace(original,E'BEGIN\n PERFORM public.mcp_assert_active();',E'BEGIN\n IF _action IN (''payment_application_read'',''payment_application_outcome'',''payment_application_review'',''payment_application_save'') THEN RETURN public.mcp_pa_dispatch(_job,_action,_p); END IF;\n PERFORM public.mcp_assert_active();');
 changed:=replace(changed,' IF _action=''invoice'' THEN',E' IF _action=''invoice'' THEN\n   IF EXISTS(SELECT 1 FROM public.mcp_payment_applications WHERE id=ident AND job_id=_job) THEN RAISE EXCEPTION ''MCP_BAD:Use the saved payment application workflow for this linked record.''; END IF;');
 EXECUTE replace(definition,original,changed);
END $patch$;
NOTIFY pgrst, 'reload schema';
