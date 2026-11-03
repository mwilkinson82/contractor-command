-- LOCAL UNAPPLIED PROPOSAL. Requires the source-snapshot proposal and the
-- existing supplier/buyout workflow. One NEW service_role EXECUTE grant needs
-- specific access review before any Lovable installation. No authenticated
-- EXECUTE surface is added. The server verifies the member and calculates the
-- immutable source; ordinary clients cannot attest a calculation or actor.
-- Existing package review/record functions remain the only destination writer.
CREATE TABLE mcp_private.estimate_handoff_reviews (
  request_id uuid PRIMARY KEY, actor uuid NOT NULL, company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), snapshot_id uuid NOT NULL REFERENCES mcp_private.estimate_source_snapshot(id),
  source_version bigint NOT NULL, observed_version bigint NOT NULL,
  package_id uuid NOT NULL, expected_version integer NOT NULL, buyout_review uuid NOT NULL, correction_of uuid,
  payload_hash text NOT NULL, canonical_json text NOT NULL, canonical_sha256 text NOT NULL,
  allocations jsonb NOT NULL, facts jsonb NOT NULL, reason text NOT NULL, review_result jsonb NOT NULL
);
CREATE TABLE mcp_private.estimate_handoff_operations (
  request_id uuid PRIMARY KEY REFERENCES mcp_private.estimate_handoff_reviews(request_id),
  result jsonb NOT NULL, accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mcp_private.estimate_handoff_component_claims (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id), component_id text NOT NULL,
  request_id uuid NOT NULL REFERENCES mcp_private.estimate_handoff_operations(request_id),
  PRIMARY KEY(job_id,component_id)
);
REVOKE ALL ON mcp_private.estimate_handoff_reviews,mcp_private.estimate_handoff_operations,mcp_private.estimate_handoff_component_claims FROM PUBLIC,anon,authenticated;
CREATE TRIGGER estimate_handoff_reviews_immutable BEFORE UPDATE OR DELETE ON mcp_private.estimate_handoff_reviews FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER estimate_handoff_operations_immutable BEFORE UPDATE OR DELETE ON mcp_private.estimate_handoff_operations FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
-- Claims are a private active projection; corrections replace them atomically.
-- Reviews and operations retain the immutable acceptance/retirement history.
ALTER TABLE mcp_private.estimate_handoff_reviews ADD FOREIGN KEY (correction_of)
  REFERENCES mcp_private.estimate_handoff_operations(request_id);

CREATE FUNCTION public.mcp_estimate_buyout_handoff(_job uuid,_actor uuid,_step text,_request uuid,_p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_claims text:=current_setting('request.jwt.claims',true); cid uuid; ver bigint;
  rev mcp_private.estimate_handoff_reviews; src mcp_private.estimate_source_snapshot;
  target public.mcp_buyout_records; prior jsonb; facts jsonb; result jsonb; op jsonb;
  payload jsonb; b jsonb; components jsonb; allocations jsonb; x jsonb; comp jsonb;
  mapped bigint:=0; excluded bigint:=0; included integer:=0; total numeric;
  canonical_sha text; canonical_json text; hash text; reason text; review_id uuid;
  correction uuid; latest uuid; released jsonb; prior_accepted jsonb;
BEGIN
  IF _actor IS NULL OR _job IS NULL OR _request IS NULL OR coalesce(_step,'') NOT IN ('review','save','read','cancel') THEN RAISE EXCEPTION 'MCP_BAD:An exact member, job and request are required.'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id=_job;
  PERFORM mcp_private.buyout_access(cid,_job,true);
  -- Match the destination's existing company-before-job lock order.
  PERFORM 1 FROM public.mcp_companies WHERE id=cid FOR UPDATE;
  PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
  ver:=mcp_private.estimate_lock(_job);
  PERFORM mcp_private.buyout_access(cid,_job,true);
  IF public.mcp_estimate_guard(_job) IS DISTINCT FROM cid THEN RAISE EXCEPTION 'MCP_NO_ACCESS'; END IF;
  SELECT * INTO rev FROM mcp_private.estimate_handoff_reviews WHERE request_id=_request;
  IF FOUND AND (rev.actor IS DISTINCT FROM _actor OR rev.company_id IS DISTINCT FROM cid OR rev.job_id IS DISTINCT FROM _job) THEN RAISE EXCEPTION 'MCP_BAD:This request belongs to another review.'; END IF;
  IF _step IN ('read','cancel','save') AND rev.request_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Review the exact frozen source and destination first.'; END IF;
  IF rev.request_id IS NOT NULL THEN
    SELECT saved.result INTO op FROM mcp_private.estimate_handoff_operations saved WHERE saved.request_id=_request;
    IF _step='read' THEN
      result:=coalesce(op,rev.review_result)||jsonb_build_object(
        'accepted', op IS NOT NULL,
        'source_current', rev.source_version=ver,
        'destination_current_version', (SELECT version FROM public.mcp_buyout_records WHERE id=rev.package_id),
        'cancelled', coalesce((SELECT cancelled FROM public.mcp_buyout_reviews WHERE id=rev.buyout_review),false),
        'expired', coalesce((SELECT expires_at<clock_timestamp() FROM public.mcp_buyout_reviews WHERE id=rev.buyout_review),true)
      );
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
    END IF;
    IF _step='cancel' THEN
      result:=public.mcp_buyout_review_cancel(cid,_job,rev.buyout_review)||jsonb_build_object('request_id',_request,'source_snapshot_id',rev.snapshot_id);
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
    END IF;
    IF _step='save' THEN
      IF _p->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Explicitly confirm the reviewed mapping and replacement budget.'; END IF;
      IF op IS NOT NULL THEN
        result:=op||jsonb_build_object(
          'already_applied',true,
          'source_current',rev.source_version=ver,
          'destination_current_version',(SELECT version FROM public.mcp_buyout_records WHERE id=rev.package_id)
        );
        PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
      END IF;
      IF ver<>rev.observed_version THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed since destination review. Read and review again.'; END IF;
      SELECT r.request_id INTO latest
        FROM mcp_private.estimate_handoff_reviews r
        JOIN mcp_private.estimate_handoff_operations o ON o.request_id=r.request_id
        WHERE r.job_id=_job AND r.package_id=rev.package_id
        ORDER BY (o.result->>'version')::integer DESC,o.accepted_at DESC LIMIT 1;
      IF latest IS DISTINCT FROM rev.correction_of THEN
        RAISE EXCEPTION 'MCP_BAD:The prior accepted handoff changed. Read and explicitly review the latest correction.';
      END IF;
      IF EXISTS(
        SELECT 1 FROM jsonb_array_elements(rev.allocations) a
        JOIN mcp_private.estimate_handoff_component_claims c ON c.job_id=_job AND c.component_id=a->>'component_id'
        JOIN mcp_private.estimate_handoff_reviews r ON r.request_id=c.request_id
        WHERE a->'include'='true'::jsonb AND (rev.correction_of IS NULL OR r.package_id<>rev.package_id)
      ) THEN RAISE EXCEPTION 'MCP_BAD:A component is active on another package. Explicitly release it there before reallocating.'; END IF;
      result:=public.mcp_buyout_record(cid,_job,rev.package_id,'package',rev.expected_version,rev.facts,rev.reason,_request,rev.buyout_review,true);
      result:=rev.review_result||result||jsonb_build_object(
        'status', 'accepted',
        'accepted', true,
        'request_id', _request,
        'source_snapshot_id', rev.snapshot_id,
        'source_version', rev.source_version,
        'canonical_sha256', rev.canonical_sha256,
        'calculation_schema', 1,
        'allocations', rev.allocations,
        'correction_of', rev.correction_of,
        'released_components', rev.review_result->'released_components',
        'source_was_current_at_review', rev.review_result->'source_current',
        'effect', 'replace_internal_package_budget_only',
        'commitment_approval', false,
        'payment_authorization', false
      );
      INSERT INTO mcp_private.estimate_handoff_operations(request_id,result) VALUES(_request,result);
      IF rev.correction_of IS NOT NULL THEN
        DELETE FROM mcp_private.estimate_handoff_component_claims c
          USING mcp_private.estimate_handoff_reviews r
          WHERE c.job_id=_job AND c.request_id=r.request_id AND r.package_id=rev.package_id;
      END IF;
      INSERT INTO mcp_private.estimate_handoff_component_claims(job_id,component_id,request_id)
        SELECT _job,a->>'component_id',_request FROM jsonb_array_elements(rev.allocations) a WHERE a->'include'='true'::jsonb;
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
    END IF;
  END IF;
  IF _step<>'review' THEN RAISE EXCEPTION 'MCP_BAD:Review before accepting.'; END IF;
  hash:=encode(sha256(convert_to(_p::text,'UTF8')),'hex');
  IF rev.request_id IS NOT NULL THEN
    IF hash IS DISTINCT FROM rev.payload_hash THEN RAISE EXCEPTION 'MCP_BAD:Request already identifies different facts. Start a new review.'; END IF;
    PERFORM public.mcp_buyout_review(cid,_job,rev.package_id,'package',rev.expected_version,rev.facts,rev.reason,_request,rev.buyout_review);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN rev.review_result;
  END IF;
  IF jsonb_typeof(_p->'allow_historical') IS DISTINCT FROM 'boolean' OR jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' OR (_p->>'expected_version')!~'^\d+$' OR (_p->>'expected_version')::numeric NOT BETWEEN 1 AND 2147483645 THEN RAISE EXCEPTION 'MCP_BAD:Use a current destination version and explicit historical-source choice.'; END IF;
  SELECT * INTO src FROM mcp_private.estimate_source_snapshot WHERE id=(_p->>'snapshot_id')::uuid AND job_id=_job AND company_id=cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Saved source is unavailable on this job.'; END IF;
  IF src.source_version<>ver AND _p->'allow_historical' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Explicitly review historical source or choose the current estimate.'; END IF;
  canonical_json:=_p->>'canonical_json'; canonical_sha:=_p->>'canonical_sha256';
  IF canonical_json IS NULL OR octet_length(canonical_json)>8388608 OR canonical_sha !~ '^[0-9a-f]{64}$' OR encode(sha256(convert_to(canonical_json,'UTF8')),'hex') IS DISTINCT FROM canonical_sha THEN RAISE EXCEPTION 'MCP_BAD:Trusted calculation fingerprint does not match.'; END IF;
  payload:=canonical_json::jsonb; b:=payload->'breakdown';
  IF payload->'schema' IS DISTINCT FROM '1'::jsonb OR payload->>'companyId' IS DISTINCT FROM cid::text OR payload->>'jobId' IS DISTINCT FROM _job::text OR payload->'snapshot' IS DISTINCT FROM src.source_data THEN RAISE EXCEPTION 'MCP_BAD:Calculation does not identify the immutable source.'; END IF;
  IF jsonb_typeof(b->'direct') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'generalConditions') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'requirements') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MCP_BAD:Incomplete calculated components.'; END IF;
  SELECT jsonb_agg(c) INTO components FROM (
    SELECT jsonb_build_object('id','direct:'||(v->>'ref'),'cents',v->'amountCents') c FROM jsonb_array_elements(b->'direct') v
    UNION ALL SELECT jsonb_build_object('id','gc:'||coalesce(v->>'ref',v->>'label'),'cents',v->'amountCents') FROM jsonb_array_elements(b->'generalConditions') v
    UNION ALL SELECT jsonb_build_object('id','requirement:'||(v->>'ref'),'cents',v->'amountCents') FROM jsonb_array_elements(b->'requirements') v
    UNION ALL SELECT jsonb_build_object('id','overhead','cents',b->'overheadCents')
    UNION ALL SELECT jsonb_build_object('id','profit','cents',b->'profitCents')
  ) q;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(components) c WHERE c->>'id' IS NULL OR jsonb_typeof(c->'cents') IS DISTINCT FROM 'number' OR (c->>'cents')!~'^\d+$' OR (c->>'cents')::numeric>9007199254740991) OR (SELECT count(*) FROM jsonb_array_elements(components))<>(SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(components) c) THEN RAISE EXCEPTION 'MCP_BAD:Ambiguous or invalid calculated components.'; END IF;
  SELECT sum((c->>'cents')::numeric) INTO total FROM jsonb_array_elements(components) c;
  IF jsonb_typeof(b->'totalCents') IS DISTINCT FROM 'number' OR total>9007199254740991 OR total IS DISTINCT FROM (b->>'totalCents')::numeric THEN RAISE EXCEPTION 'MCP_BAD:Calculated components do not reconcile.'; END IF;
  allocations:=_p->'allocations';
  IF jsonb_typeof(allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(allocations)<>jsonb_array_length(components) OR jsonb_array_length(allocations)>2000 OR (SELECT count(DISTINCT a->>'component_id') FROM jsonb_array_elements(allocations) a)<>jsonb_array_length(allocations) THEN RAISE EXCEPTION 'MCP_BAD:Choose each component exactly once.'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(allocations) LOOP
    PERFORM mcp_private.buyout_shape(x,'{"component_id":"text","include":"boolean","exclusion_reason":"text?"}');
    IF jsonb_typeof(x->'include') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'MCP_BAD:An inclusion must be a boolean.'; END IF;
    SELECT c INTO comp FROM jsonb_array_elements(components) c WHERE c->>'id'=x->>'component_id';
    IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Unknown source component.'; END IF;
    IF x->'include'='true'::jsonb THEN
      IF x->'exclusion_reason' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'MCP_BAD:Included components cannot also be excluded.'; END IF;
      mapped:=mapped+(comp->>'cents')::bigint; included:=included+1;
    ELSE
      IF coalesce(length(btrim(x->>'exclusion_reason')),0)=0 THEN RAISE EXCEPTION 'MCP_BAD:Give an explicit reason for every excluded component.'; END IF;
      excluded:=excluded+(comp->>'cents')::bigint;
    END IF;
  END LOOP;
  IF mapped>9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Choose components within the existing package budget limit.'; END IF;
  SELECT * INTO target FROM public.mcp_buyout_records WHERE id=(_p->>'package_id')::uuid AND company_id=cid AND job_id=_job AND kind='package' AND version=(_p->>'expected_version')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Destination changed or is unavailable. Read and review again.'; END IF;
  IF coalesce(jsonb_typeof(_p->'correction_of'),'null') NOT IN ('null','string') THEN
    RAISE EXCEPTION 'MCP_BAD:Choose the exact prior accepted handoff for a correction.';
  END IF;
  correction:=(_p->>'correction_of')::uuid;
  SELECT r.request_id INTO latest
    FROM mcp_private.estimate_handoff_reviews r
    JOIN mcp_private.estimate_handoff_operations o ON o.request_id=r.request_id
    WHERE r.job_id=_job AND r.package_id=target.id
    ORDER BY (o.result->>'version')::integer DESC,o.accepted_at DESC LIMIT 1;
  IF correction IS DISTINCT FROM latest THEN
    IF latest IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This package has no accepted handoff to correct.'; END IF;
    RAISE EXCEPTION 'MCP_BAD:Explicit correction required. Choose the latest accepted handoff for this package.';
  END IF;
  IF included=0 AND correction IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Choose included components, or explicitly correct a prior handoff to release all.';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(allocations) a
    JOIN mcp_private.estimate_handoff_component_claims c ON c.job_id=_job AND c.component_id=a->>'component_id'
    JOIN mcp_private.estimate_handoff_reviews r ON r.request_id=c.request_id
    WHERE a->'include'='true'::jsonb AND (correction IS NULL OR r.package_id<>target.id)
  ) THEN RAISE EXCEPTION 'MCP_BAD:A component is active on another package. Explicitly release it there before reallocating.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'component_id',c.component_id,'request_id',c.request_id,
    'amount_cents',(SELECT part->'cents' FROM jsonb_array_elements(r.review_result->'components') part WHERE part->>'id'=c.component_id),
    'source_snapshot_id',r.snapshot_id,'source_version',r.source_version
  ) ORDER BY c.component_id),'[]'::jsonb) INTO released
    FROM mcp_private.estimate_handoff_component_claims c
    JOIN mcp_private.estimate_handoff_reviews r ON r.request_id=c.request_id
    WHERE c.job_id=_job AND r.package_id=target.id;
  SELECT jsonb_build_object(
    'request_id',r.request_id,'package_version',o.result->'version',
    'budget_cents',r.review_result->'proposed_budget_cents','allocations',r.allocations,
    'components',r.review_result->'components','source_snapshot_id',r.snapshot_id,
    'source_version',r.source_version,'canonical_sha256',r.canonical_sha256
  ) INTO prior_accepted
    FROM mcp_private.estimate_handoff_reviews r
    JOIN mcp_private.estimate_handoff_operations o ON o.request_id=r.request_id
    WHERE r.request_id=correction;
  SELECT v.facts INTO prior FROM public.mcp_buyout_versions v WHERE v.record_id=target.id AND v.version=target.version;
  IF prior->>'status'='cancelled' THEN RAISE EXCEPTION 'MCP_BAD:A cancelled package cannot receive a handoff.'; END IF;
  reason:=_p->>'reason';
  IF coalesce(length(btrim(reason)),0) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'MCP_BAD:Give the explicit mapping source and reason.'; END IF;
  facts:=prior||jsonb_build_object('budget_cents',mapped,'source','Estimate snapshot '||src.id::text||' v'||src.source_version::text||'; handoff '||_request::text||'. '||reason);
  review_id:=gen_random_uuid();
  PERFORM public.mcp_buyout_review(cid,_job,target.id,'package',target.version,facts,reason,_request,review_id);
  result:=jsonb_build_object(
    'status', 'review',
    'accepted', false,
    'expires_at', (SELECT expires_at FROM public.mcp_buyout_reviews WHERE id=review_id),
    'request_id', _request,
    'source_snapshot_id', src.id,
    'source_version', src.source_version,
    'source_current', src.source_version=ver,
    'source_sha256', src.source_sha256,
    'canonical_sha256', canonical_sha,
    'calculation_schema', 1,
    'package_id', target.id,
    'expected_version', target.version,
    'correction_of', correction,
    'prior_accepted', prior_accepted,
    'released_components', released,
    'reason', reason,
    'previous_source', prior->>'source',
    'proposed_source', facts->>'source',
    'previous_budget_cents', prior->'budget_cents',
    'proposed_budget_cents', mapped,
    'excluded_cents', excluded,
    'source_total_cents', total,
    'components', components,
    'allocations', allocations,
    'preserved_package_facts', prior-'budget_cents'-'source',
    'effect', 'replace_internal_package_budget_only'
  );
  INSERT INTO mcp_private.estimate_handoff_reviews(request_id,actor,company_id,job_id,snapshot_id,source_version,observed_version,package_id,expected_version,buyout_review,correction_of,payload_hash,canonical_json,canonical_sha256,allocations,facts,reason,review_result)
    VALUES(_request,_actor,cid,_job,src.id,src.source_version,ver,target.id,target.version,review_id,correction,hash,canonical_json,canonical_sha,allocations,facts,reason,result);
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_buyout_handoff(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_buyout_handoff(uuid,uuid,text,uuid,jsonb) TO service_role;
