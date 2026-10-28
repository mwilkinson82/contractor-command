-- STAGED ONLY: read-only snapshot proposal. Apply only in a coordinated migration.
-- All data, scope checks, bounds and result are evaluated in one SELECT snapshot.
CREATE FUNCTION public.mcp_cost_reconciliation_snapshot(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 WITH
 j AS MATERIALIZED (
   SELECT job.id,job.company_id FROM public.mcp_jobs job
   WHERE job.id=_job AND auth.uid() IS NOT NULL AND public.mcp_job_scope(job.id)='full' AND public.mcp_cost_accounting_authorized(job.company_id)
   -- Read the canonical entitlement decision directly. The normal active gate can
   -- provision companies, refresh caches or accept invitations, which is unsuitable
   -- for a read-only reconciliation snapshot. Unknown entitlement fails closed.
   AND (
     coalesce((SELECT (public.get_circle_entitlement(u.id,coalesce(u.email,''))->>'hasAccess')::boolean FROM auth.users u WHERE u.id=auth.uid()),false)
     OR EXISTS(SELECT 1 FROM public.mcp_company_entitlements e WHERE e.company_id=job.company_id AND e.status IN ('active','trialing') AND e.plan IN ('athena_pm','athena_office'))
     OR coalesce((SELECT (public.get_circle_entitlement(u.id,coalesce(u.email,''))->>'hasAccess')::boolean FROM public.mcp_companies c JOIN auth.users u ON u.id=c.created_by WHERE c.id=job.company_id),false)
   )
 ),
 relevant AS MATERIALIZED (
   SELECT r.id,r.company_id,r.anchor_job_id,r.kind FROM public.mcp_cost_submissions r CROSS JOIN j
   WHERE r.anchor_job_id=j.id OR EXISTS (
     SELECT 1 FROM public.mcp_cost_submission_versions v
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.facts->'allocations')='array' THEN v.facts->'allocations' ELSE '[]'::jsonb END) a
     WHERE v.record_id=r.id AND translate(lower(coalesce(a->>'job_id','')),'-{}','')=replace(j.id::text,'-',''))
   LIMIT 201
 ),
 ver AS MATERIALIZED (
   SELECT v.record_id,v.version,v.facts,v.reason,v.recorded_at FROM public.mcp_cost_submission_versions v JOIN relevant r ON r.id=v.record_id LIMIT 1001
 ),
 allocations AS MATERIALIZED (
   SELECT v.record_id,v.version,a.value AS a,
     CASE WHEN coalesce(a.value->>'job_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (a.value->>'job_id')::uuid END AS job_id,
     CASE WHEN jsonb_typeof(a.value->'amount_cents')='number' AND coalesce(a.value->>'amount_cents','') ~ '^[1-9][0-9]{0,12}$' THEN (a.value->>'amount_cents')::numeric END AS cents
   FROM ver v CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.facts->'allocations')='array' THEN v.facts->'allocations' ELSE '[]'::jsonb END) a
 ),
 approvals AS MATERIALIZED (SELECT a.record_id,a.version,a.approved_at FROM public.mcp_cost_approvals a JOIN relevant r ON r.id=a.record_id LIMIT 1001),
 business AS MATERIALIZED (SELECT b.id,b.record_id,b.version,b.job_id,b.allocated_cents,b.bill_total_cents,b.basis,b.notes,b.approved_by,b.approved_at FROM public.mcp_cost_business_approvals b JOIN relevant r ON r.id=b.record_id LIMIT 1001),
 posts AS MATERIALIZED (SELECT p.record_id,p.version,p.posted_at FROM public.mcp_cost_posting_events p JOIN relevant r ON r.id=p.record_id LIMIT 1001),
 payments AS MATERIALIZED (SELECT p.id,p.record_id,p.amount_cents,p.paid_on,p.reference,p.recorded_at FROM public.mcp_cost_payment_evidence p JOIN relevant r ON r.id=p.record_id LIMIT 1001),
 shared AS MATERIALIZED (SELECT a.payment_id,a.record_id,a.amount_cents,p.company_id,p.paid_on,p.reference,p.recorded_at FROM public.mcp_cost_shared_allocations a JOIN relevant r ON r.id=a.record_id JOIN public.mcp_cost_shared_payments p ON p.id=a.payment_id LIMIT 1001),
 corrections AS MATERIALIZED (SELECT c.id,c.payment_id,c.shared_payment_id,c.reason,c.corrected_at FROM public.mcp_cost_payment_corrections c WHERE EXISTS(SELECT 1 FROM payments p WHERE p.id=c.payment_id) OR EXISTS(SELECT 1 FROM shared s WHERE s.payment_id=c.shared_payment_id) LIMIT 1001),
 safety AS MATERIALIZED (
  SELECT
   (SELECT count(*) FROM relevant)<=200 AND (SELECT count(*) FROM ver)<=1000 AND (SELECT count(*) FROM approvals)<=1000 AND (SELECT count(*) FROM business)<=1000 AND (SELECT count(*) FROM posts)<=1000 AND (SELECT count(*) FROM payments)<=1000 AND (SELECT count(*) FROM shared)<=1000 AND (SELECT count(*) FROM corrections)<=1000
   AND NOT EXISTS(SELECT 1 FROM relevant r CROSS JOIN j WHERE r.company_id IS DISTINCT FROM j.company_id OR public.mcp_job_scope(r.anchor_job_id) IS DISTINCT FROM 'full' OR NOT EXISTS(SELECT 1 FROM ver v WHERE v.record_id=r.id))
   AND NOT EXISTS(SELECT 1 FROM ver v JOIN relevant r ON r.id=v.record_id WHERE v.facts->>'kind' IS DISTINCT FROM r.kind)
   AND NOT EXISTS(SELECT 1 FROM ver v WHERE jsonb_typeof(v.facts) IS DISTINCT FROM 'object' OR octet_length(v.facts::text)>30000 OR jsonb_typeof(v.facts->'allocations') IS DISTINCT FROM 'array' OR CASE WHEN jsonb_typeof(v.facts->'allocations')='array' THEN jsonb_array_length(v.facts->'allocations') NOT BETWEEN 1 AND 100 ELSE true END OR jsonb_typeof(v.facts->'amount_cents') IS DISTINCT FROM 'number' OR coalesce(v.facts->>'amount_cents','') !~ '^[1-9][0-9]{0,12}$' OR CASE WHEN coalesce(v.facts->>'amount_cents','') ~ '^[1-9][0-9]{0,12}$' THEN (v.facts->>'amount_cents')::numeric>9000000000000 ELSE true END OR (SELECT coalesce(sum(a.cents),0) FROM allocations a WHERE a.record_id=v.record_id AND a.version=v.version) IS DISTINCT FROM CASE WHEN coalesce(v.facts->>'amount_cents','') ~ '^[1-9][0-9]{0,12}$' THEN (v.facts->>'amount_cents')::numeric END)
   AND NOT EXISTS(SELECT 1 FROM allocations a CROSS JOIN j WHERE jsonb_typeof(a.a) IS DISTINCT FROM 'object' OR a.job_id IS NULL OR a.cents IS NULL OR a.cents>9000000000000 OR length(btrim(coalesce(a.a->>'cost_code',''))) NOT BETWEEN 1 AND 40 OR NOT EXISTS(SELECT 1 FROM public.mcp_jobs aj WHERE aj.id=a.job_id AND aj.company_id=j.company_id) OR public.mcp_job_scope(a.job_id) IS DISTINCT FROM 'full')
   AND NOT EXISTS(SELECT 1 FROM business b WHERE length(coalesce(b.notes,''))>2000 OR b.allocated_cents<=0 OR b.allocated_cents>9000000000000 OR b.bill_total_cents<=0 OR b.bill_total_cents>9000000000000 OR b.allocated_cents IS DISTINCT FROM (SELECT sum(a.cents) FROM allocations a WHERE a.record_id=b.record_id AND a.version=b.version AND a.job_id=b.job_id) OR NOT EXISTS(SELECT 1 FROM ver v WHERE v.record_id=b.record_id AND v.version=b.version AND v.facts->>'amount_cents'=b.bill_total_cents::text))
   AND NOT EXISTS(SELECT 1 FROM public.mcp_cost_business_withdrawals w JOIN business b ON b.id=w.approval_id WHERE length(w.reason)>2000)
   AND NOT EXISTS(SELECT 1 FROM ver v WHERE length(coalesce(v.reason,''))>2000)
   AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.amount_cents<=0 OR p.amount_cents>9000000000000 OR length(p.reference)>200)
   AND NOT EXISTS(SELECT 1 FROM shared s CROSS JOIN j WHERE s.company_id IS DISTINCT FROM j.company_id OR s.amount_cents<=0 OR s.amount_cents>9000000000000 OR length(s.reference)>200)
   AND NOT EXISTS(SELECT 1 FROM corrections c WHERE length(c.reason)>2000)
   AS complete
 ),
 output AS MATERIALIZED (
  SELECT CASE WHEN s.complete THEN jsonb_build_object('currency',NULL,'currency_verified',false,'cents_encoding','decimal_string','coverage','athena_cost_records_only','external_accounting_coverage',false,
   'shared_payment_conservation_available',false,'settlement_allocation_by_job_available',false,'accounting_effective_date_available',false,'original_evidence_coverage',false,
   'records',coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',r.id,'kind',r.kind,'posted_version',(SELECT max(p.version) FROM posts p WHERE p.record_id=r.id),
     'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('version',v.version,'recorded_at',v.recorded_at,'reason',v.reason,'amount_cents',v.facts->>'amount_cents','document_reference',v.facts->>'document_reference','counterparty_name',v.facts->>'counterparty_name','allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('job_id',a.job_id,'cost_code',a.a->>'cost_code','amount_cents',a.a->>'amount_cents') ORDER BY a.job_id,a.a->>'cost_code') FROM allocations a WHERE a.record_id=v.record_id AND a.version=v.version),'[]'::jsonb)) ORDER BY v.version) FROM ver v WHERE v.record_id=r.id),'[]'::jsonb),
     'accounting_approvals',coalesce((SELECT jsonb_agg(jsonb_build_object('version',a.version,'approved_at',a.approved_at) ORDER BY a.version) FROM approvals a WHERE a.record_id=r.id),'[]'::jsonb),
     'business_approvals',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'version',b.version,'job_id',b.job_id,'allocated_cents',b.allocated_cents::text,'bill_total_cents',b.bill_total_cents::text,'basis',b.basis,'notes',b.notes,'approved_by',b.approved_by,'approved_at',b.approved_at,'withdrawal',(SELECT jsonb_build_object('reason',w.reason,'withdrawn_by',w.withdrawn_by,'withdrawn_at',w.withdrawn_at) FROM public.mcp_cost_business_withdrawals w WHERE w.approval_id=b.id)) ORDER BY b.version,b.job_id,b.approved_at,b.id) FROM business b WHERE b.record_id=r.id),'[]'::jsonb),
     'posting_events',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.version,'posted_at',p.posted_at) ORDER BY p.version) FROM posts p WHERE p.record_id=r.id),'[]'::jsonb),
     'payments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'amount_cents',p.amount_cents::text,'paid_on',p.paid_on,'reference',p.reference,'recorded_at',p.recorded_at,'correction',(SELECT jsonb_build_object('id',c.id,'reason',c.reason,'corrected_at',c.corrected_at) FROM corrections c WHERE c.payment_id=p.id),'shared',false) ORDER BY p.id) FROM payments p WHERE p.record_id=r.id),'[]'::jsonb),
     'shared_allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('payment_id',x.payment_id,'amount_cents',x.amount_cents::text,'paid_on',x.paid_on,'reference',x.reference,'recorded_at',x.recorded_at,'correction',(SELECT jsonb_build_object('id',c.id,'reason',c.reason,'corrected_at',c.corrected_at) FROM corrections c WHERE c.shared_payment_id=x.payment_id)) ORDER BY x.payment_id) FROM shared x WHERE x.record_id=r.id),'[]'::jsonb)) ORDER BY r.id) FROM relevant r),'[]'::jsonb)) END AS data
  FROM safety s
 )
 SELECT CASE WHEN o.data IS NULL OR octet_length(o.data::text)>2097152 THEN jsonb_build_object('snapshot_version',1,'complete',false,'status','unavailable')
  ELSE jsonb_build_object('snapshot_version',1,'complete',true,'status','complete','company_id',j.company_id,'job_id',j.id,'ap',o.data) END
 INTO result FROM j CROSS JOIN output o;
 RETURN coalesce(result,jsonb_build_object('snapshot_version',1,'complete',false,'status','unavailable'));
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_reconciliation_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_reconciliation_snapshot(uuid) TO authenticated;
