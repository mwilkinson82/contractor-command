-- LOCAL PROPOSAL ONLY. Not registered or remotely executed.
-- Apply after 0043 through the sole release controller's managed migration path.
-- Keep existing immutable payment identities. A correction is an atomic evidence
-- reversal plus optional replacement, never a bank transfer or a payable posting.

-- Internal snapshot: authorize every historical allocation before exposing facts,
-- even on an idempotent retry. The caller serializes writes on the company row.
CREATE FUNCTION public.mcp_cost_payment_correction_state(_job uuid,_record uuid,_payment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE company uuid; source jsonb; shares jsonb; rows jsonb:='[]'; item jsonb;
 r public.mcp_cost_submissions; v public.mcp_cost_submission_versions; posted public.mcp_cost_submission_versions;
BEGIN
 PERFORM public.mcp_assert_active();
 IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 IF public.mcp_cost_accounting_authorized(company) IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Accounting access required to correct recorded payments.'; END IF;
 SELECT * INTO r FROM public.mcp_cost_submissions c WHERE c.id=_record AND c.company_id=company AND (c.anchor_job_id=_job OR EXISTS(
  SELECT 1 FROM public.mcp_cost_submission_versions av CROSS JOIN LATERAL jsonb_array_elements(av.facts->'allocations') a WHERE av.record_id=c.id AND (a->>'job_id')::uuid=_job));
 IF r.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Payment evidence unavailable.'; END IF;
 SELECT jsonb_build_object('id',e.id,'shared',false,'amount_cents',e.amount_cents::text,'paid_on',e.paid_on,'reference',e.reference,'recorded_at',e.recorded_at,'recorded_by',e.recorded_by),
   jsonb_build_array(jsonb_build_object('record_id',e.record_id,'amount_cents',e.amount_cents::text))
 INTO source,shares FROM public.mcp_cost_payment_evidence e WHERE e.id=_payment AND e.record_id=_record;
 IF source IS NULL THEN
  SELECT jsonb_build_object('id',p.id,'shared',true,'amount_cents',p.amount_cents::text,'paid_on',p.paid_on,'reference',p.reference,'recorded_at',p.recorded_at,'recorded_by',p.recorded_by),
    (SELECT jsonb_agg(jsonb_build_object('record_id',a.record_id,'amount_cents',a.amount_cents::text) ORDER BY a.record_id) FROM public.mcp_cost_shared_allocations a WHERE a.payment_id=p.id)
  INTO source,shares FROM public.mcp_cost_shared_payments p WHERE p.id=_payment AND p.company_id=company AND EXISTS(SELECT 1 FROM public.mcp_cost_shared_allocations a WHERE a.payment_id=p.id AND a.record_id=_record);
 END IF;
 IF source IS NULL OR shares IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Payment evidence unavailable.'; END IF;
 IF jsonb_array_length(shares)>50 OR (EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence WHERE id=_payment) AND EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments WHERE id=_payment)) THEN RAISE EXCEPTION 'MCP_BAD:Payment identity or allocation coverage requires accounting review.'; END IF;
 IF (SELECT sum((a->>'amount_cents')::numeric) FROM jsonb_array_elements(shares) a)<>(source->>'amount_cents')::numeric THEN RAISE EXCEPTION 'MCP_BAD:Payment allocations do not reconcile; accounting review required.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(shares) LOOP
  SELECT * INTO r FROM public.mcp_cost_submissions WHERE id=(item->>'record_id')::uuid AND company_id=company;
  IF r.id IS NULL OR public.mcp_job_scope(r.anchor_job_id) IS DISTINCT FROM 'full' OR EXISTS(
    SELECT 1 FROM public.mcp_cost_submission_versions x CROSS JOIN LATERAL jsonb_array_elements(x.facts->'allocations') a
    WHERE x.record_id=r.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full') THEN RAISE EXCEPTION 'MCP_BAD:Payment evidence unavailable.'; END IF;
  SELECT * INTO v FROM public.mcp_cost_submission_versions WHERE record_id=r.id ORDER BY version DESC LIMIT 1;
  SELECT cv.* INTO posted FROM public.mcp_cost_submission_versions cv JOIN public.mcp_cost_posting_events p ON p.record_id=cv.record_id AND p.version=cv.version WHERE cv.record_id=r.id ORDER BY cv.version DESC LIMIT 1;
  rows:=rows||jsonb_build_array(jsonb_build_object('record_id',r.id,'job_id',r.anchor_job_id,'job_number',(SELECT job_number FROM public.mcp_jobs WHERE id=r.anchor_job_id),'kind',r.kind,
    'description',v.facts->>'description','document_reference',v.facts->>'document_reference','payee',v.facts->>'counterparty_name','currency_code',posted.facts->>'currency_code',
    'current_version',v.version,'posted_version',posted.version,'posted_amount_cents',posted.facts->>'amount_cents',
    'posted_facts_fingerprint',md5(posted.facts::text),'current_facts_fingerprint',md5(v.facts::text),'original_amount_cents',item->>'amount_cents',
    'active_paid_cents',public.mcp_cost_active_paid(r.id)::text,'pm_ready',coalesce(public.mcp_cost_pm_payment_ready(r.id,posted.version),false),
    'approval_fingerprint',md5(coalesce((SELECT jsonb_agg(to_jsonb(b)||jsonb_build_object('withdrawal',(SELECT to_jsonb(w) FROM public.mcp_cost_business_withdrawals w WHERE w.approval_id=b.id)) ORDER BY b.id) FROM public.mcp_cost_business_approvals b WHERE b.record_id=r.id),'[]'::jsonb)::text),
    'payment_fingerprint',md5(coalesce((SELECT jsonb_agg(q.entry ORDER BY q.key) FROM (
      SELECT e.id AS key,to_jsonb(e)||jsonb_build_object('correction',(SELECT to_jsonb(c) FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id)) AS entry FROM public.mcp_cost_payment_evidence e WHERE e.record_id=r.id
      UNION ALL SELECT p.id,to_jsonb(p)||jsonb_build_object('allocated_cents',a.amount_cents::text,'correction',(SELECT to_jsonb(c) FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=p.id)) FROM public.mcp_cost_shared_payments p JOIN public.mcp_cost_shared_allocations a ON a.payment_id=p.id WHERE a.record_id=r.id
    ) q),'[]'::jsonb)::text)));
 END LOOP;
 IF octet_length(rows::text)>100000 THEN RAISE EXCEPTION 'MCP_BAD:Payment history exceeds the correction review limit; accounting review required.'; END IF;
 RETURN jsonb_build_object('company_id',company,'payment',source,'records',rows,
  'correction',(SELECT to_jsonb(c) FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=_payment OR c.shared_payment_id=_payment));
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_correction_state(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mcp_cost_payment_correction(_job uuid,_step text,_p jsonb,_review uuid DEFAULT NULL,_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE state jsonb; payload jsonb; revised jsonb; effects jsonb:='[]'; item jsonb; allocation jsonb;
 company uuid; record_id uuid; payment_id uuid; rid uuid; correction_id uuid; replacement_id uuid; ticket uuid; mode text;
 op public.mcp_cost_submission_operations; result jsonb; total numeric; allocated numeric; old_paid numeric; new_paid numeric; currency text; payee text;
 effective_at timestamptz;
BEGIN
 PERFORM public.mcp_assert_active();
 IF _step IS NULL OR _step NOT IN ('read','review','save') OR jsonb_typeof(_p) IS DISTINCT FROM 'object' OR octet_length(_p::text)>200000 THEN RAISE EXCEPTION 'MCP_BAD:Invalid payment correction request.'; END IF;
 -- Fixed keys prevent a silent create-payment path or a generic ledger editor.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('id','payment_id','expected_state','mode','reason','revised','request_id','correction_id','replacement_id','before','effects','as_of')) OR (_step<>'read' AND _p ? 'as_of') THEN RAISE EXCEPTION 'MCP_BAD:Invalid payment correction fields.'; END IF;
 record_id:=nullif(_p->>'id','')::uuid; payment_id:=nullif(_p->>'payment_id','')::uuid;
 IF record_id IS NULL OR payment_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Existing record and payment identity required.'; END IF;
 -- Same lock as existing accounting/submission/settlement writers.
 SELECT company_id INTO company FROM public.mcp_jobs WHERE id=_job;
 PERFORM 1 FROM public.mcp_companies WHERE id=company FOR UPDATE;
 state:=public.mcp_cost_payment_correction_state(_job,record_id,payment_id);
 IF _step='read' THEN
  IF _p ? 'as_of' AND public.mcp_cost_valid_date(_p->>'as_of') IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Valid as-of date required.'; END IF;
  RETURN jsonb_build_object('saved',false,'state',state,'expected_state',md5(state::text),
   'balances_as_of',CASE WHEN _p ? 'as_of' THEN public.mcp_cost_payment_balances_as_of(state,(_p->>'as_of')::date) END,'history',
   coalesce((SELECT jsonb_agg(o.result ORDER BY o.result->>'corrected_at') FROM public.mcp_cost_submission_operations o
    WHERE o.company_id=company AND o.result->>'status'='payment_evidence_corrected'
     AND (o.result->>'payment_id'=payment_id::text OR o.result->>'replacement_id'=payment_id::text)),'[]'::jsonb));
 END IF;
 IF _step='save' THEN
  rid:=nullif(_p->>'request_id','')::uuid;
  SELECT * INTO op FROM public.mcp_cost_submission_operations o WHERE o.company_id=company AND o.request_id=rid;
  IF op.request_id IS NOT NULL THEN
   IF op.actor_id IS DISTINCT FROM auth.uid() OR op.signature IS DISTINCT FROM _p::text THEN RAISE EXCEPTION 'MCP_BAD:Request ID belongs to different content.'; END IF;
   -- Scope was rechecked above; original evidence never changes after correction.
   RETURN op.result||jsonb_build_object('already_applied',true,'saved',true);
  END IF;
 END IF;
 IF state->'correction'<>'null'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:This payment evidence is already corrected; read its history.'; END IF;
 IF _p->>'expected_state' IS DISTINCT FROM md5(state::text) THEN RAISE EXCEPTION 'MCP_BAD:Payment or payable changed since review. Read it again and review the correction.'; END IF;
 mode:=_p->>'mode';
 IF mode IS NULL OR mode NOT IN ('replace','void') OR length(btrim(coalesce(_p->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:Correction action and reason required.'; END IF;
 revised:=_p->'revised';
 IF mode='void' THEN
  IF revised IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Removing erroneous evidence must not contain replacement facts.'; END IF;
  total:=0;
 ELSE
  IF jsonb_typeof(revised) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(revised) x WHERE x NOT IN ('amount_cents','paid_on','reference','allocations'))
   OR jsonb_typeof(revised->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(revised->>'amount_cents','') !~ '^[1-9][0-9]{0,12}$'
   OR (revised->>'amount_cents')::numeric>9000000000000 OR public.mcp_cost_valid_date(revised->>'paid_on') IS DISTINCT FROM true
   OR length(btrim(coalesce(revised->>'reference',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:Valid revised amount, date and reference required.'; END IF;
  total:=(revised->>'amount_cents')::numeric;
  IF jsonb_typeof(revised->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(revised->'allocations')<>jsonb_array_length(state->'records')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(revised->'allocations') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) x WHERE x NOT IN ('record_id','expected_version','amount_cents'))
    OR coalesce(a->>'record_id','') !~ '^[0-9a-f-]{36}$' OR jsonb_typeof(a->'expected_version') IS DISTINCT FROM 'number' OR coalesce(a->>'expected_version','') !~ '^[1-9][0-9]{0,8}$'
    OR jsonb_typeof(a->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(a->>'amount_cents','') !~ '^[1-9][0-9]{0,12}$' OR (a->>'amount_cents')::numeric>9000000000000)
   THEN RAISE EXCEPTION 'MCP_BAD:Explicit allocations for every original payable are required.'; END IF;
  IF (SELECT count(DISTINCT a->>'record_id') FROM jsonb_array_elements(revised->'allocations') a)<>jsonb_array_length(state->'records')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(revised->'allocations') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(state->'records') r WHERE r->>'record_id'=a->>'record_id'))
   OR (SELECT sum((a->>'amount_cents')::numeric) FROM jsonb_array_elements(revised->'allocations') a)<>total THEN RAISE EXCEPTION 'MCP_BAD:Allocations must preserve payable identities and equal the payment.'; END IF;
  -- Ignore the original being superseded when checking reference uniqueness.
  IF EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence e JOIN public.mcp_cost_submissions r ON r.id=e.record_id WHERE r.company_id=company AND e.id<>payment_id AND lower(btrim(e.reference))=lower(btrim(revised->>'reference')) AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id))
   OR EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments p WHERE p.company_id=company AND p.id<>payment_id AND lower(btrim(p.reference))=lower(btrim(revised->>'reference')) AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=p.id)) THEN RAISE EXCEPTION 'MCP_BAD:Payment reference already recorded.'; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(state->'records') LOOP
  allocated:=0;
  IF mode='replace' THEN
   SELECT value INTO allocation FROM jsonb_array_elements(revised->'allocations') WHERE value->>'record_id'=item->>'record_id';
   allocated:=(allocation->>'amount_cents')::numeric;
   IF (allocation->>'expected_version')::integer<>(item->>'current_version')::integer OR item->>'current_version' IS DISTINCT FROM item->>'posted_version' THEN RAISE EXCEPTION 'MCP_BAD:Posted payable unavailable or version changed.'; END IF;
   IF item->>'kind'='company_paid_expense' OR item->>'pm_ready'<>'true' OR public.mcp_cost_currency_supported(item->>'currency_code') IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Current posted payable, supported currency and PM approval are required.'; END IF;
   IF currency IS NULL THEN currency:=item->>'currency_code'; payee:=lower(btrim(item->>'payee'));
   ELSIF currency IS DISTINCT FROM item->>'currency_code' OR payee IS DISTINCT FROM lower(btrim(item->>'payee')) THEN RAISE EXCEPTION 'MCP_BAD:Payment allocations must have the same payee and currency.'; END IF;
  END IF;
  old_paid:=(item->>'active_paid_cents')::numeric;
  new_paid:=old_paid-(item->>'original_amount_cents')::numeric+allocated;
  IF new_paid<0 OR (mode='replace' AND new_paid>(item->>'posted_amount_cents')::numeric) THEN RAISE EXCEPTION 'MCP_BAD:Revised payment exceeds the posted payable.'; END IF;
  effects:=effects||jsonb_build_array(jsonb_build_object('record_id',item->>'record_id','job_number',item->>'job_number','currency_code',item->>'currency_code',
   'prior_paid_cents',old_paid::text,'revised_paid_cents',new_paid::text,
   'prior_unpaid_cents',((item->>'posted_amount_cents')::numeric-old_paid)::text,'revised_unpaid_cents',((item->>'posted_amount_cents')::numeric-new_paid)::text));
 END LOOP;
 IF _step='review' THEN
  IF _p ? 'request_id' OR _p ? 'before' OR _p ? 'effects' OR _p ? 'correction_id' OR _p ? 'replacement_id' THEN RAISE EXCEPTION 'MCP_BAD:Read and review the existing payment facts first.'; END IF;
  payload:=_p||jsonb_build_object('request_id',gen_random_uuid(),'correction_id',gen_random_uuid(),'replacement_id',CASE WHEN mode='replace' THEN gen_random_uuid() ELSE NULL END,'before',state,'effects',effects);
  -- Use existing actor/job/expiry-bound ticket infrastructure, with a dedicated purpose.
  DELETE FROM public.mcp_cost_review_tickets WHERE company_id=company AND actor_id=auth.uid() AND expires_at<now();
  IF (SELECT count(*) FROM public.mcp_cost_review_tickets WHERE company_id=company AND actor_id=auth.uid() AND consumed_at IS NULL)>=50 THEN RAISE EXCEPTION 'MCP_BAD:Too many pending reviews; try again after they expire.'; END IF;
  INSERT INTO public.mcp_cost_review_tickets(company_id,job_id,actor_id,purpose,payload) VALUES(company,_job,auth.uid(),'payment_correction',payload) RETURNING id INTO ticket;
  RETURN jsonb_build_object('saved',false,'payload',payload,'review_key',ticket,'expires_at',now()+interval '15 minutes');
 END IF;
 IF _confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Confirm the reviewed payment correction first.'; END IF;
 IF _p->'before' IS DISTINCT FROM state OR _p->'effects' IS DISTINCT FROM effects THEN RAISE EXCEPTION 'MCP_BAD:Payment correction review changed; review again.'; END IF;
 PERFORM public.mcp_cost_review_consume(_job,'payment_correction',_p,_review);
 correction_id:=nullif(_p->>'correction_id','')::uuid; replacement_id:=nullif(_p->>'replacement_id','')::uuid;
 IF rid IS NULL OR correction_id IS NULL OR (mode='replace' AND replacement_id IS NULL) OR (mode='void' AND replacement_id IS NOT NULL) THEN RAISE EXCEPTION 'MCP_BAD:Reviewed correction identity required.'; END IF;
 IF replacement_id IS NOT NULL AND (EXISTS(SELECT 1 FROM public.mcp_cost_payment_evidence WHERE id=replacement_id) OR EXISTS(SELECT 1 FROM public.mcp_cost_shared_payments WHERE id=replacement_id)) THEN RAISE EXCEPTION 'MCP_BAD:Replacement evidence identity already exists.'; END IF;
 effective_at:=clock_timestamp();
 INSERT INTO public.mcp_cost_payment_corrections(id,payment_id,shared_payment_id,reason,corrected_by,corrected_at)
 VALUES(correction_id,CASE WHEN state->'payment'->>'shared'='false' THEN payment_id END,CASE WHEN state->'payment'->>'shared'='true' THEN payment_id END,btrim(_p->>'reason'),auth.uid(),effective_at);
 IF mode='replace' THEN
  IF state->'payment'->>'shared'='true' THEN
   INSERT INTO public.mcp_cost_shared_payments(id,company_id,amount_cents,paid_on,reference,recorded_by,recorded_at) VALUES(replacement_id,company,total::bigint,(revised->>'paid_on')::date,btrim(revised->>'reference'),auth.uid(),effective_at);
   INSERT INTO public.mcp_cost_shared_allocations(payment_id,record_id,amount_cents) SELECT replacement_id,(a->>'record_id')::uuid,(a->>'amount_cents')::bigint FROM jsonb_array_elements(revised->'allocations') a;
  ELSE
   INSERT INTO public.mcp_cost_payment_evidence(id,record_id,amount_cents,paid_on,reference,recorded_by,recorded_at) VALUES(replacement_id,record_id,total::bigint,(revised->>'paid_on')::date,btrim(revised->>'reference'),auth.uid(),effective_at);
  END IF;
 END IF;
 result:=jsonb_build_object('id',record_id,'payment_id',payment_id,'replacement_id',replacement_id,'correction_id',correction_id,'status','payment_evidence_corrected',
  'mode',mode,'reason',btrim(_p->>'reason'),'corrected_by',auth.uid(),'corrected_by_name',(SELECT display_name FROM public.mcp_company_members WHERE company_id=company AND user_id=auth.uid()),'corrected_at',effective_at,'before',state,'revised',revised,'effects',effects,'request_id',rid);
 INSERT INTO public.mcp_cost_submission_operations(company_id,request_id,actor_id,signature,result) VALUES(company,rid,auth.uid(),_p::text,result);
 RETURN result||jsonb_build_object('saved',true,'already_applied',false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_correction(uuid,text,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_payment_correction(uuid,text,jsonb,uuid,boolean) TO authenticated;

-- Close the legacy void-only write path. Keep its completed request retries and
-- shared-payment behavior intact, without changing its existing ACL or role gate.
-- The guarded insertion is after its operation lookup and before confirmation.
DO $$
DECLARE definition text; needle text:=' IF _confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION ''MCP_BAD:Confirm the reviewed action first.''; END IF;';
BEGIN
 definition:=pg_get_functiondef('public.mcp_cost_settlement_action(uuid,jsonb,uuid,boolean)'::regprocedure);
 IF array_length(string_to_array(definition,needle),1)<>2 THEN RAISE EXCEPTION 'Unexpected settlement function source; stop for review.'; END IF;
 definition:=replace(definition,needle,
  ' IF action=''correct_payment'' THEN RAISE EXCEPTION ''MCP_BAD:Use the reviewed payment correction workflow.''; END IF;'||E'\n'||needle);
 EXECUTE definition;
END $$;

-- Private reporting helper. Its input comes only from the authorized state above.
-- This is a known-at cutoff, not an invented correction accounting-effective date:
-- payment paid_on AND immutable recorded_at must precede the supplied UTC day end.
CREATE FUNCTION public.mcp_cost_payment_balances_as_of(_state jsonb,_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; version_row public.mcp_cost_submission_versions; cutoff timestamptz:=(_day+1)::timestamp AT TIME ZONE 'UTC';
 paid numeric; total numeric; code text; result jsonb:='[]'; known boolean;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(_state->'records') LOOP
  SELECT v.* INTO version_row FROM public.mcp_cost_submission_versions v JOIN public.mcp_cost_posting_events p ON p.record_id=v.record_id AND p.version=v.version
   WHERE v.record_id=(item->>'record_id')::uuid AND p.accounting_effective_on<=_day AND p.posted_at<cutoff AND v.recorded_at<cutoff ORDER BY v.version DESC LIMIT 1;
  code:=version_row.facts->>'currency_code'; total:=(version_row.facts->>'amount_cents')::numeric;
  known:=version_row.record_id IS NOT NULL AND public.mcp_cost_currency_supported(code) AND NOT EXISTS(
   SELECT 1 FROM public.mcp_cost_posting_events p JOIN public.mcp_cost_submission_versions v ON v.record_id=p.record_id AND v.version=p.version
   WHERE p.record_id=(item->>'record_id')::uuid AND p.posted_at<cutoff AND (p.accounting_effective_on IS NULL OR (p.accounting_effective_on<=_day AND v.facts->>'currency_code' IS DISTINCT FROM code)));
  SELECT coalesce(sum(q.amount_cents),0) INTO paid FROM (
   SELECT e.amount_cents FROM public.mcp_cost_payment_evidence e WHERE e.record_id=(item->>'record_id')::uuid AND e.paid_on<=_day AND e.recorded_at<cutoff
    AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.payment_id=e.id AND c.corrected_at<cutoff)
   UNION ALL
   SELECT a.amount_cents FROM public.mcp_cost_shared_allocations a JOIN public.mcp_cost_shared_payments p ON p.id=a.payment_id
    WHERE a.record_id=(item->>'record_id')::uuid AND p.paid_on<=_day AND p.recorded_at<cutoff
    AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_payment_corrections c WHERE c.shared_payment_id=p.id AND c.corrected_at<cutoff)
  ) q;
  result:=result||jsonb_build_array(jsonb_build_object('record_id',item->>'record_id','job_number',item->>'job_number','as_of',_day,
   'posted_version',version_row.version,'currency_code',CASE WHEN known THEN code END,'posted_cents',CASE WHEN known THEN total::text END,
   'recorded_paid_cents',CASE WHEN known THEN paid::text END,'unpaid_cents',CASE WHEN known THEN (total-paid)::text END,
   'basis','Whole payable, known by UTC day end; paid_on and recorded_at cutoff; corrections apply only after their immutable corrected_at. Not a bank balance or per-job allocation.'));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_balances_as_of(jsonb,date) FROM PUBLIC,anon,authenticated;

-- All correction history is append-only, including privileged accidental edits.
CREATE TRIGGER mcp_cost_payment_evidence_immutable BEFORE UPDATE OR DELETE ON public.mcp_cost_payment_evidence FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_cost_shared_payments_immutable BEFORE UPDATE OR DELETE ON public.mcp_cost_shared_payments FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_cost_shared_allocations_immutable BEFORE UPDATE OR DELETE ON public.mcp_cost_shared_allocations FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_cost_payment_corrections_immutable BEFORE UPDATE OR DELETE ON public.mcp_cost_payment_corrections FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER mcp_cost_operations_immutable BEFORE UPDATE OR DELETE ON public.mcp_cost_submission_operations FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
