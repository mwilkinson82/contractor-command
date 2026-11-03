-- LOCAL UNAPPLIED PROPOSAL. Requires immutable estimate source snapshots and
-- estimating-destination-versions.sql. ONE new service_role-only EXECUTE grant
-- requires specific access review before Lovable installation. No authenticated
-- caller can submit an attested calculation or privileged actor.
CREATE TABLE mcp_private.estimate_facts_handoff_reviews (
  request_id uuid PRIMARY KEY,
  actor uuid NOT NULL,
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  destination text NOT NULL CHECK(destination IN ('budget','sov:official','sov:draft')),
  snapshot_id uuid NOT NULL REFERENCES mcp_private.estimate_source_snapshot(id),
  source_version bigint NOT NULL,
  observed_source_version bigint NOT NULL,
  expected_destination_version bigint NOT NULL,
  correction_of uuid,
  canonical_json text NOT NULL,
  canonical_sha256 text NOT NULL,
  mapping jsonb NOT NULL,
  payload_hash text NOT NULL,
  review_result jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes'
);
CREATE TABLE mcp_private.estimate_facts_handoff_operations (
  request_id uuid PRIMARY KEY REFERENCES mcp_private.estimate_facts_handoff_reviews(request_id),
  accepted_seq bigint GENERATED ALWAYS AS IDENTITY,
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Active projection only. Immutable review/operation rows audit replacements.
CREATE TABLE mcp_private.estimate_facts_handoff_claims (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  destination text NOT NULL,
  component_id text NOT NULL,
  request_id uuid NOT NULL REFERENCES mcp_private.estimate_facts_handoff_operations(request_id),
  PRIMARY KEY(job_id,destination,component_id)
);
CREATE TABLE mcp_private.estimate_facts_handoff_cancellations (
  request_id uuid PRIMARY KEY REFERENCES mcp_private.estimate_facts_handoff_reviews(request_id),
  cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON mcp_private.estimate_facts_handoff_reviews,
  mcp_private.estimate_facts_handoff_operations,
  mcp_private.estimate_facts_handoff_claims,
  mcp_private.estimate_facts_handoff_cancellations FROM PUBLIC,anon,authenticated;
CREATE TRIGGER estimate_facts_review_immutable BEFORE UPDATE OR DELETE ON mcp_private.estimate_facts_handoff_reviews FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER estimate_facts_operation_immutable BEFORE UPDATE OR DELETE ON mcp_private.estimate_facts_handoff_operations FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();
CREATE TRIGGER estimate_facts_cancel_immutable BEFORE UPDATE OR DELETE ON mcp_private.estimate_facts_handoff_cancellations FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

CREATE FUNCTION public.mcp_estimate_facts_handoff(
  _job uuid,_actor uuid,_step text,_request uuid,_p jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  previous_claims text:=current_setting('request.jwt.claims',true);
  cid uuid; source_now bigint; dest_now jsonb; saved jsonb;
  r mcp_private.estimate_facts_handoff_reviews;
  s mcp_private.estimate_source_snapshot;
  prior mcp_private.estimate_facts_handoff_reviews;
  latest uuid; correction uuid; receipt jsonb; mapping jsonb; facts jsonb; terms jsonb;
  canonical_json text; canonical_sha text; dest_key text; payload_hash text;
  result jsonb; operation jsonb; expired boolean; cancelled boolean; released jsonb;
BEGIN
  IF _job IS NULL OR _actor IS NULL OR _request IS NULL OR
     coalesce(_step,'') NOT IN ('review','save','read','cancel') OR
     coalesce(_p->>'kind','') NOT IN ('budget','sov') THEN
    RAISE EXCEPTION 'MCP_BAD:Choose an exact member, job, destination and request.';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id=_job;
  PERFORM mcp_private.buyout_access(cid,_job,true);
  PERFORM 1 FROM public.mcp_companies WHERE id=cid FOR UPDATE;
  PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
  source_now:=mcp_private.estimate_lock(_job);
  dest_now:=public.mcp_estimate_destination_snapshot(_job);
  PERFORM mcp_private.buyout_access(cid,_job,true);
  IF public.mcp_estimate_guard(_job) IS DISTINCT FROM cid THEN RAISE EXCEPTION 'MCP_NO_ACCESS'; END IF;
  SELECT * INTO r FROM mcp_private.estimate_facts_handoff_reviews WHERE request_id=_request;
  IF FOUND AND (r.actor IS DISTINCT FROM _actor OR r.job_id IS DISTINCT FROM _job OR
      r.company_id IS DISTINCT FROM cid OR split_part(r.destination,':',1) IS DISTINCT FROM _p->>'kind') THEN
    RAISE EXCEPTION 'MCP_BAD:This request identifies a different handoff.';
  END IF;
  IF _step<>'review' AND r.request_id IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Review the exact frozen source and destination first.';
  END IF;
  IF r.request_id IS NOT NULL THEN
    SELECT o.result INTO operation FROM mcp_private.estimate_facts_handoff_operations o WHERE o.request_id=_request;
    expired:=r.expires_at<clock_timestamp();
    cancelled:=EXISTS(SELECT 1 FROM mcp_private.estimate_facts_handoff_cancellations WHERE request_id=_request);
    IF _step='read' THEN
      result:=coalesce(operation,r.review_result)||jsonb_build_object(
        'accepted',operation IS NOT NULL,'expired',expired,'cancelled',cancelled,
        'source_current',source_now=r.source_version,'destination_current_version',dest_now->'version');
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
    END IF;
    IF _step='cancel' THEN
      IF operation IS NULL THEN
        INSERT INTO mcp_private.estimate_facts_handoff_cancellations(request_id) VALUES(_request) ON CONFLICT DO NOTHING;
      END IF;
      result:=jsonb_build_object('cancelled',operation IS NULL,'accepted',operation IS NOT NULL,'request_id',_request);
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
    END IF;
    IF _step='save' THEN
      IF _p->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN
        RAISE EXCEPTION 'MCP_BAD:Explicitly confirm the exact source, split mapping and replacement values.';
      END IF;
      IF operation IS NOT NULL THEN
        result:=operation||jsonb_build_object('already_applied',true,'source_current',source_now=r.source_version,'destination_current_version',dest_now->'version');
        PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
      END IF;
      IF expired OR cancelled THEN RAISE EXCEPTION 'MCP_BAD:Review expired or cancelled. Start a new review.'; END IF;
      IF source_now<>r.observed_source_version OR (dest_now->>'version')::bigint<>r.expected_destination_version THEN
        RAISE EXCEPTION 'MCP_BAD:Source or destination changed since review. Read current state and review again.';
      END IF;
    END IF;
  END IF;
  IF _step='review' THEN
    payload_hash:=encode(sha256(convert_to(_p::text,'UTF8')),'hex');
    IF r.request_id IS NOT NULL THEN
      IF r.payload_hash IS DISTINCT FROM payload_hash THEN RAISE EXCEPTION 'MCP_BAD:This request identifies different facts.'; END IF;
      IF operation IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN operation||jsonb_build_object('already_applied',true);
      END IF;
      IF expired OR cancelled OR source_now<>r.observed_source_version OR
         (dest_now->>'version')::bigint<>r.expected_destination_version THEN
        RAISE EXCEPTION 'MCP_BAD:Review changed, expired or cancelled. Read and review again.';
      END IF;
      PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN r.review_result;
    END IF;
    IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' OR
       (_p->>'expected_version')!~'^\d+$' OR
       (_p->>'expected_version')::numeric<> (dest_now->>'version')::bigint OR
       jsonb_typeof(_p->'allow_historical') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'MCP_BAD:Choose the current destination version and explicit historical-source decision.';
    END IF;
    SELECT * INTO s FROM mcp_private.estimate_source_snapshot
      WHERE id=(_p->>'snapshot_id')::uuid AND job_id=_job AND company_id=cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Immutable source is unavailable on this job.'; END IF;
    IF s.source_version<>source_now AND _p->'allow_historical' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'MCP_BAD:Explicitly choose historical source or review the current estimate.';
    END IF;
    canonical_json:=_p->>'canonical_json'; canonical_sha:=_p->>'canonical_sha256';
    IF canonical_json IS NULL OR octet_length(canonical_json)>8388608 OR
       canonical_sha !~ '^[a-f0-9]{64}$' OR
       encode(sha256(convert_to(canonical_json,'UTF8')),'hex') IS DISTINCT FROM canonical_sha THEN
      RAISE EXCEPTION 'MCP_BAD:Trusted calculation fingerprint does not match.';
    END IF;
    receipt:=canonical_json::jsonb;
    IF receipt->'schema' IS DISTINCT FROM '1'::jsonb OR
       receipt->>'companyId' IS DISTINCT FROM cid::text OR receipt->>'jobId' IS DISTINCT FROM _job::text OR
       receipt->'snapshot' IS DISTINCT FROM s.source_data THEN
      RAISE EXCEPTION 'MCP_BAD:Calculation does not identify the immutable source.';
    END IF;
    IF octet_length(coalesce(_p->>'mapping_json','')) NOT BETWEEN 2 AND 4194304 THEN
      RAISE EXCEPTION 'MCP_BAD:Trusted mapping is missing or too large.';
    END IF;
    mapping:=(_p->>'mapping_json')::jsonb;
    IF mapping->>'kind' IS DISTINCT FROM _p->>'kind' OR
       mapping->'plan'->>'kind' IS DISTINCT FROM _p->>'kind' OR
       jsonb_typeof(mapping->'facts') IS DISTINCT FROM 'object' OR
       jsonb_typeof(mapping->'terms') IS DISTINCT FROM 'object' OR
       jsonb_typeof(mapping->'target_keys') IS DISTINCT FROM 'array' OR
       jsonb_typeof(mapping->'allocated_components') IS DISTINCT FROM 'array' OR
       mapping->'review'->'source_total_cents' IS DISTINCT FROM receipt->'breakdown'->'totalCents' THEN
      RAISE EXCEPTION 'MCP_BAD:Trusted mapping does not reconcile to its source.';
    END IF;
    dest_key:=CASE WHEN _p->>'kind'='budget' THEN 'budget' ELSE 'sov:'||(mapping->>'copy') END;
    IF dest_key IS NULL OR dest_key NOT IN ('budget','sov:official','sov:draft') OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(mapping->'facts') k WHERE k<>CASE dest_key WHEN 'budget' THEN 'budget' WHEN 'sov:official' THEN 'sov' ELSE 'sov_draft' END) OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(mapping->'terms') k WHERE
         CASE dest_key WHEN 'budget' THEN true WHEN 'sov:official' THEN k NOT IN ('sov_fee_pct','sov_basis') ELSE k NOT IN ('sov_draft_fee_pct','sov_draft_basis') END) THEN
      RAISE EXCEPTION 'MCP_BAD:Mapping attempts to change an unreviewed destination.';
    END IF;
    correction:=nullif(_p->>'correction_of','')::uuid;
  ELSE
    dest_key:=r.destination; correction:=r.correction_of; mapping:=r.mapping;
  END IF;
  SELECT old.request_id INTO latest
    FROM mcp_private.estimate_facts_handoff_reviews old
    JOIN mcp_private.estimate_facts_handoff_operations o ON o.request_id=old.request_id
    WHERE old.job_id=_job AND old.destination=dest_key ORDER BY o.accepted_seq DESC LIMIT 1;
  IF latest IS DISTINCT FROM correction THEN
    RAISE EXCEPTION 'MCP_BAD:Review the latest accepted handoff explicitly before replacing its destination allocation.';
  END IF;
  released:='[]'::jsonb;
  IF correction IS NOT NULL THEN
    SELECT * INTO prior FROM mcp_private.estimate_facts_handoff_reviews WHERE request_id=correction;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(prior.mapping->'target_keys') old
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(mapping->'target_keys') cur WHERE cur=old)) THEN
      RAISE EXCEPTION 'MCP_BAD:Explicitly map or zero every previous destination target before replacing its allocation.';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('component_id',c.component_id,'prior_request',c.request_id)),'[]') INTO released
      FROM mcp_private.estimate_facts_handoff_claims c WHERE c.job_id=_job AND c.destination=dest_key AND c.request_id=correction;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(mapping->'allocated_components') component
      JOIN mcp_private.estimate_facts_handoff_claims c ON c.job_id=_job AND c.destination=dest_key AND c.component_id=component
      WHERE c.request_id IS DISTINCT FROM correction) THEN
    RAISE EXCEPTION 'MCP_BAD:A source component is already allocated by another active handoff.';
  END IF;
  IF _step='save' THEN
    facts:=mapping->'facts'; terms:=mapping->'terms';
    saved:=public.mcp_estimate_destination_save(
      _job,r.expected_destination_version,
      facts->'budget',facts->'sov',facts->'sov_draft',
      (terms->>'sov_fee_pct')::numeric,terms->>'sov_basis',
      (terms->>'sov_draft_fee_pct')::numeric,terms->>'sov_draft_basis');
    result:=r.review_result||jsonb_build_object(
      'status','accepted','accepted',true,'destination_version',saved->'version',
      'released_components',released,'commitment_approval',false,'payment_authorization',false);
    INSERT INTO mcp_private.estimate_facts_handoff_operations(request_id,result) VALUES(_request,result);
    IF correction IS NOT NULL THEN DELETE FROM mcp_private.estimate_facts_handoff_claims
      WHERE job_id=_job AND destination=dest_key AND request_id=correction; END IF;
    INSERT INTO mcp_private.estimate_facts_handoff_claims(job_id,destination,component_id,request_id)
      SELECT _job,dest_key,c,_request FROM jsonb_array_elements_text(mapping->'allocated_components') c;
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
  END IF;
  result:=jsonb_build_object(
    'status','review','accepted',false,'request_id',_request,'destination',dest_key,
    'source_snapshot_id',s.id,'source_version',s.source_version,'source_current',s.source_version=source_now,
    'source_sha256',s.source_sha256,'canonical_sha256',canonical_sha,'calculation_schema',1,
    'destination_before',dest_now,
    'expected_destination_version',dest_now->'version','reason',_p->>'reason',
    'mapping',mapping,'correction_of',correction,'released_components',released,
    'previous_handoff',CASE WHEN correction IS NULL THEN NULL ELSE prior.review_result-'previous_handoff'-'destination_before' END);
  INSERT INTO mcp_private.estimate_facts_handoff_reviews(
    request_id,actor,company_id,job_id,destination,snapshot_id,source_version,
    observed_source_version,expected_destination_version,correction_of,
    canonical_json,canonical_sha256,mapping,payload_hash,review_result)
  VALUES(_request,_actor,cid,_job,dest_key,s.id,s.source_version,source_now,
    (dest_now->>'version')::bigint,correction,canonical_json,canonical_sha,mapping,payload_hash,result);
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_facts_handoff(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_facts_handoff(uuid,uuid,text,uuid,jsonb) TO service_role;
