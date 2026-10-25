-- Stage only. Apply through existing Lovable Cloud, after the CO package migration.
-- Execution requires a complete base SOV that agrees with every recorded original contract amount.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE original text;revised text;anchor text:=$old$     SELECT coalesce(sum(round((value->>'billable_value')::numeric*100)),0) INTO base_cents$old$;
 validation text:=$new$     IF EXISTS(SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module='sov' AND NOT coalesce(f.value ? 'executed_change_order',false)
       AND (f.status<>'known' OR f.key !~ '^[0-9]{2}\.[0-9]{2,3}$' OR CASE WHEN jsonb_typeof(f.value->'billable_value')='number' THEN
         (f.value->>'billable_value')::numeric<0 OR round((f.value->>'billable_value')::numeric*100)<>(f.value->>'billable_value')::numeric*100 ELSE true END)) THEN
       RAISE EXCEPTION 'MCP_BAD:Complete and verify every base SOV line before executing a change.';
     END IF;
$new$;
BEGIN
 SELECT pg_get_functiondef('public.mcp_change_record(uuid,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,anchor,validation||anchor);
 IF revised=original THEN RAISE EXCEPTION 'Execution base-value code changed; review the tie guard.';END IF;
 original:=revised;
 revised:=replace(original,
  $old$     prior_total:=round(base_cents/(1-j.sov_fee_pct/100))+delta_cents;$old$,
  $new$     IF EXISTS(SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module IN('contract','budget','job','setup')
       AND f.key IN('contract_value','contract_amount','original_contract','contract_sum','contract') AND f.status='known'
       AND jsonb_typeof(f.value) IN('number','string')
       AND CASE WHEN regexp_replace(f.value #>> '{}','[$,[:space:]]','','g') ~ '^[0-9]+(\.[0-9]+)?$'
         THEN round(regexp_replace(f.value #>> '{}','[$,[:space:]]','','g')::numeric*100)<>round(base_cents/(1-j.sov_fee_pct/100)) ELSE false END) THEN
       RAISE EXCEPTION 'MCP_BAD:The base SOV does not tie to the recorded original contract value. Reconcile it before executing this change.';
     END IF;
     prior_total:=round(base_cents/(1-j.sov_fee_pct/100))+delta_cents;$new$);
 IF revised=original THEN RAISE EXCEPTION 'Execution total code changed; review the contract tie guard.';END IF;
 EXECUTE revised;
END $patch$;
-- Preserve a known request recipient on the successful receipt when the host
-- omits the optional display name. Never carry the name onto a different email.
DO $patch$
DECLARE original text;revised text;
BEGIN
 SELECT pg_get_functiondef('public.mcp_submittal_delivery(uuid,uuid,text,jsonb)'::regprocedure) INTO original;
 revised:=replace(original,
  $old$    UPDATE public.mcp_submittal_packages SET sent_at=m.sent_at$old$,
  $new$    IF s.package_purpose IN ('rfi','rfc','change_order') AND nullif(btrim(_p->>'recipient_name'),'') IS NULL THEN
      _p:=_p || jsonb_build_object('recipient_name',(SELECT nullif(btrim(to_name),'') FROM public.mcp_transmittals
        WHERE id=s.transmittal_id AND lower(to_email)=lower(m.draft->>'to')));
    END IF;
    UPDATE public.mcp_submittal_packages SET sent_at=m.sent_at$new$);
 IF revised=original THEN RAISE EXCEPTION 'Receipt writer changed; review named request recipients.';END IF;
 EXECUTE revised;
END $patch$;
