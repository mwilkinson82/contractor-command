-- Local review proposal only. Do not apply without migration/security review.
-- Requires the estimating tables, drawing/takeoff engine, and the separately
-- reviewed VOLATILE correction for estimating reads. Existing ACLs are unchanged.
-- New callable RPCs use the same mcp_estimate_guard as the existing estimate RPCs.
-- Legacy mcp_estimate_pricing_save remains callable. Quote comparisons are
-- append-only: editing/removing old entries now rejects; append the revised quote
-- and classify the older quote as comparison until a reviewed removal workflow
-- exists. This deliberately changes legacy quote-replacement behavior. Legacy
-- rate and factor-source saves may create, preserve or append unique entries;
-- changing/removing an existing entry requires a version-checked save.
-- Native multi-session PostgreSQL concurrency/deadlock tests are mandatory before
-- release. Legacy UPDATE can lock a tuple before its BEFORE trigger gets the job
-- lock while a versioned writer holds the job lock and waits on the tuple. Postgres
-- aborts a deadlock victim atomically; callers must re-read before any retry.

CREATE TABLE mcp_private.estimate_revision (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0
);
CREATE TABLE mcp_private.estimate_quote_review (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor uuid NOT NULL,
  version bigint NOT NULL,
  input jsonb NOT NULL,
  decisions jsonb NOT NULL,
  saved_version bigint,
  PRIMARY KEY(job_id, request_id)
);
CREATE TABLE mcp_private.estimate_quote_selection (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor uuid NOT NULL,
  version bigint NOT NULL,
  decisions jsonb NOT NULL
);

-- A single advisory transaction lock is taken before every source-table write
-- and by all snapshot/review/save operations. Hash collisions only serialize
-- unrelated jobs. The version row and all writes roll back with the transaction.
CREATE FUNCTION mcp_private.estimate_lock(_job uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('estimate-coverage:' || _job::text, 0));
  INSERT INTO mcp_private.estimate_revision(job_id) VALUES(_job) ON CONFLICT DO NOTHING;
  SELECT version INTO v FROM mcp_private.estimate_revision WHERE job_id=_job FOR UPDATE;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_lock(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION mcp_private.estimate_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j uuid;
BEGIN
  j := CASE WHEN TG_OP='DELETE' THEN OLD.job_id ELSE NEW.job_id END;
  IF TG_OP='UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
    -- Invalidate both jobs, taking the advisory locks in deterministic order.
    IF OLD.job_id::text < NEW.job_id::text THEN
      PERFORM mcp_private.estimate_lock(OLD.job_id);
      PERFORM mcp_private.estimate_lock(NEW.job_id);
    ELSE
      PERFORM mcp_private.estimate_lock(NEW.job_id);
      PERFORM mcp_private.estimate_lock(OLD.job_id);
    END IF;
    UPDATE mcp_private.estimate_revision SET version=version+1 WHERE job_id IN (OLD.job_id,NEW.job_id);
    RETURN NEW;
  END IF;
  PERFORM mcp_private.estimate_lock(j);
  UPDATE mcp_private.estimate_revision SET version=version+1 WHERE job_id=j;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_changed() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION mcp_private.estimate_preserve_quotes() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF jsonb_typeof(OLD.quotes) IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.quotes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'MCP_BAD:Existing quotes must be preserved as an array.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (SELECT value, count(*) AS n FROM jsonb_array_elements(OLD.quotes) GROUP BY value) o
    LEFT JOIN (SELECT value, count(*) AS n FROM jsonb_array_elements(NEW.quotes) GROUP BY value) n ON n.value=o.value
    WHERE coalesce(n.n,0)<o.n
  ) THEN
    RAISE EXCEPTION 'MCP_BAD:Existing quotes cannot be removed or changed. Refresh and append the revised quote; keep the earlier quote for comparison.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_preserve_quotes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER estimate_preserve_quotes BEFORE UPDATE OF quotes ON public.mcp_estimate_pricing
  FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_preserve_quotes();

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'mcp_estimate_setup','mcp_estimate_takeoffs','mcp_estimate_takeoff_lines',
    'mcp_estimate_gap_items','mcp_estimate_verdicts','mcp_estimate_pricing',
    'mcp_estimate_general_conditions','mcp_estimate_requirements','mcp_estimate_bids',
    'mcp_takeoff_calibrations','mcp_takeoff_geometry','mcp_takeoff_markups','mcp_drawing_versions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER estimate_coverage_changed BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_changed()',tbl);
  END LOOP;
END $$;

CREATE FUNCTION public.mcp_estimate_coverage_snapshot(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v bigint; selected mcp_private.estimate_quote_selection;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  v := mcp_private.estimate_lock(_job);
  -- The job lock can wait while membership or job scope changes.
  PERFORM public.mcp_estimate_guard(_job);
  SELECT * INTO selected FROM mcp_private.estimate_quote_selection WHERE job_id=_job;
  RETURN jsonb_build_object('version',v,'estimate',public.mcp_estimate_get(_job),
    'takeoff',public.mcp_takeoff_get(_job),'bid',public.mcp_estimate_bid_get(_job),
    'capabilities',jsonb_build_object('gc_requirements_cas',
      to_regprocedure('mcp_private.estimate_gc_requirements_cas_marker()') IS NOT NULL),
    'requirements_max_ref',coalesce((SELECT max(substring(ref from 3)::numeric) FROM public.mcp_estimate_requirements WHERE job_id=_job AND ref ~ '^R-[0-9]+$'),0),
    'selection',CASE WHEN selected.job_id IS NULL THEN NULL ELSE jsonb_build_object(
      'version',selected.version,'current',selected.version=v,'decisions',selected.decisions) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_coverage_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_coverage_snapshot(uuid) TO authenticated;

CREATE FUNCTION public.mcp_estimate_coverage_review(_job uuid,_request uuid,_expected_version bigint,_decisions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v bigint; old mcp_private.estimate_quote_review; quotes jsonb; d jsonb; q jsonb; ln jsonb;
  idx integer; r text; choice text; result jsonb := '[]'::jsonb; seen integer[] := '{}'; carried text[] := '{}'; tid uuid;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  IF _request IS NULL OR auth.uid() IS NULL OR _expected_version IS NULL OR jsonb_typeof(_decisions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'MCP_BAD:Review needs a request, current version and quote decisions.';
  END IF;
  v := mcp_private.estimate_lock(_job);
  PERFORM public.mcp_estimate_guard(_job);
  SELECT * INTO old FROM mcp_private.estimate_quote_review WHERE job_id=_job AND request_id=_request;
  IF FOUND THEN
    IF old.actor IS DISTINCT FROM auth.uid() OR old.version <> _expected_version OR old.input <> _decisions THEN
      RAISE EXCEPTION 'MCP_BAD:This request already identifies a different review.';
    END IF;
    RETURN jsonb_build_object('request',_request,'version',coalesce(old.saved_version,old.version),
      'current',coalesce(old.saved_version,old.version)=v,'status',CASE WHEN old.saved_version IS NULL THEN 'review' ELSE 'saved' END,'decisions',old.decisions);
  END IF;
  IF v <> _expected_version THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh and review quote coverage again.'; END IF;
  SELECT coalesce(p.quotes,'[]'::jsonb) INTO quotes FROM public.mcp_estimate_pricing p WHERE p.job_id=_job;
  quotes:=coalesce(quotes,'[]'::jsonb);
  IF jsonb_typeof(quotes) <> 'array' OR jsonb_array_length(quotes)=0 OR jsonb_array_length(_decisions) <> jsonb_array_length(quotes) THEN
    RAISE EXCEPTION 'MCP_BAD:Review every current quote exactly once.';
  END IF;
  SELECT id INTO tid FROM public.mcp_estimate_takeoffs WHERE job_id=_job ORDER BY version DESC LIMIT 1;
  FOR d IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
    IF jsonb_typeof(d) <> 'object' OR coalesce(d->>'quote_index','') !~ '^(0|[1-9][0-9]{0,3})$' THEN
      RAISE EXCEPTION 'MCP_BAD:Each decision needs a current quote index.';
    END IF;
    idx := (d->>'quote_index')::int;
    IF idx >= jsonb_array_length(quotes) OR idx=ANY(seen) THEN RAISE EXCEPTION 'MCP_BAD:Quote indices must identify each quote exactly once.'; END IF;
    seen := array_append(seen,idx);
    q := quotes->idx; choice:=d->>'decision'; r:=nullif(btrim(d->>'ref'),'');
    IF choice NOT IN ('carry','compare') OR choice IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose carry or compare for each quote.'; END IF;
    IF choice='carry' THEN
      IF r IS NULL OR r !~ '^T-[1-9][0-9]*$' OR r=ANY(carried) OR d->'replace_labor_and_material' IS DISTINCT FROM 'true'::jsonb
        OR d->'exclusive_to_line' IS DISTINCT FROM 'true'::jsonb
        OR jsonb_typeof(d->'source_note') IS DISTINCT FROM 'string' OR jsonb_typeof(d->'scope_note') IS DISTINCT FROM 'string'
        OR jsonb_typeof(d->'exclusions_note') IS DISTINCT FROM 'string'
        OR coalesce(length(btrim(d->>'source_note')),0)=0 OR coalesce(length(btrim(d->>'scope_note')),0)=0 OR coalesce(length(btrim(d->>'exclusions_note')),0)=0 THEN
        RAISE EXCEPTION 'MCP_BAD:For each carried quote identify one whole line, source, scope and exclusions, confirm replacement of labor and material, and confirm the quote covers only that line and no other priced scope or cost, including direct lines, gaps, general conditions or requirements.';
      END IF;
      IF jsonb_typeof(q->'amount') IS DISTINCT FROM 'number' OR (q->>'amount')::numeric < 0 OR (q->>'amount')::numeric <> round((q->>'amount')::numeric,2) OR (q->>'amount')::numeric > 90071992547409 THEN
        RAISE EXCEPTION 'MCP_BAD:A carried quote needs a valid amount in cents.';
      END IF;
      SELECT to_jsonb(l) INTO ln FROM public.mcp_estimate_takeoff_lines l WHERE l.takeoff_id=tid AND l.line_no=(substring(r from 3))::int;
      IF ln IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Select a current takeoff line.'; END IF;
      IF nullif(btrim(q->>'ref'),'') IS NOT NULL AND btrim(q->>'ref') <> r THEN
        RAISE EXCEPTION 'MCP_BAD:Quote reference conflicts with the selected line.';
      END IF;
      carried:=array_append(carried,r);
    ELSE
      ln:=NULL;
    END IF;
    result:=result || jsonb_build_array(jsonb_build_object('quote_index',idx,'decision',choice,'ref',r,
      'quote',q,'line',ln,'replace_labor_and_material',CASE WHEN choice='carry' THEN true ELSE false END,
      'exclusive_to_line',CASE WHEN choice='carry' THEN true ELSE false END,
      'source_note',CASE WHEN choice='carry' THEN btrim(d->>'source_note') ELSE NULL END,
      'scope_note',CASE WHEN choice='carry' THEN btrim(d->>'scope_note') ELSE NULL END,
      'exclusions_note',CASE WHEN choice='carry' THEN btrim(d->>'exclusions_note') ELSE NULL END));
  END LOOP;
  INSERT INTO mcp_private.estimate_quote_review(job_id,request_id,actor,version,input,decisions)
    VALUES(_job,_request,auth.uid(),v,_decisions,result);
  RETURN jsonb_build_object('request',_request,'version',v,'current',true,'status','review','decisions',result);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_coverage_review(uuid,uuid,bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_coverage_review(uuid,uuid,bigint,jsonb) TO authenticated;

CREATE FUNCTION public.mcp_estimate_coverage_save(_job uuid,_request uuid,_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v bigint; r mcp_private.estimate_quote_review;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  IF _confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'MCP_BAD:Confirm the reviewed selection before saving.'; END IF;
  v:=mcp_private.estimate_lock(_job);
  PERFORM public.mcp_estimate_guard(_job);
  SELECT * INTO r FROM mcp_private.estimate_quote_review WHERE job_id=_job AND request_id=_request;
  IF NOT FOUND OR r.actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'MCP_BAD:Review this selection first.'; END IF;
  IF r.saved_version IS NOT NULL THEN
    RETURN jsonb_build_object('request',_request,'version',r.saved_version,'current',r.saved_version=v,'status','saved','decisions',r.decisions);
  END IF;
  IF r.version <> v THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh and review quote coverage again.'; END IF;
  UPDATE mcp_private.estimate_revision SET version=version+1 WHERE job_id=_job RETURNING version INTO v;
  INSERT INTO mcp_private.estimate_quote_selection(job_id,request_id,actor,version,decisions)
    VALUES(_job,_request,auth.uid(),v,r.decisions)
    ON CONFLICT(job_id) DO UPDATE SET request_id=excluded.request_id,actor=excluded.actor,version=excluded.version,decisions=excluded.decisions;
  UPDATE mcp_private.estimate_quote_review SET saved_version=v WHERE job_id=_job AND request_id=_request;
  RETURN jsonb_build_object('request',_request,'version',v,'current',true,'status','saved','decisions',r.decisions);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_coverage_save(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_coverage_save(uuid,uuid,boolean) TO authenticated;

-- An unversioned request cannot distinguish an intentional replacement from a
-- stale one. Preserve its signature and ACL while allowing only non-destructive
-- creates, no-ops and additions of unique references. All checks and the write
-- hold the same job lock as versioned saves. The entire request rolls back on a
-- conflict, including any otherwise-valid changes to its other arrays.
CREATE OR REPLACE FUNCTION public.mcp_estimate_pricing_save(_job uuid,_labor jsonb,_material jsonb,_quotes jsonb,_sources jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; prior public.mcp_estimate_pricing; part record;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  PERFORM mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  IF (_labor IS NOT NULL AND jsonb_typeof(_labor) IS DISTINCT FROM 'array') OR
     (_material IS NOT NULL AND jsonb_typeof(_material) IS DISTINCT FROM 'array') OR
     (_quotes IS NOT NULL AND jsonb_typeof(_quotes) IS DISTINCT FROM 'array') OR
     (_sources IS NOT NULL AND jsonb_typeof(_sources) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'MCP_BAD:Pricing fields must be arrays or omitted. Nothing was saved.';
  END IF;
  SELECT * INTO prior FROM public.mcp_estimate_pricing WHERE job_id=_job;
  FOR part IN SELECT * FROM (VALUES
    ('labor',coalesce(prior.labor,'[]'::jsonb),_labor,'ref'),
    ('material',coalesce(prior.material,'[]'::jsonb),_material,'ref'),
    ('factor sources',coalesce(prior.rate_sources,'[]'::jsonb),_sources,'source')
  ) AS components(label,existing,incoming,key_name) LOOP
    IF part.incoming IS NOT NULL THEN
      IF jsonb_typeof(part.existing) IS DISTINCT FROM 'array' OR EXISTS (
        SELECT 1 FROM (SELECT value,count(*) AS n FROM jsonb_array_elements(part.existing) GROUP BY value) o
        LEFT JOIN (SELECT value,count(*) AS n FROM jsonb_array_elements(part.incoming) GROUP BY value) n ON n.value=o.value
        WHERE coalesce(n.n,0)<o.n
      ) THEN
        RAISE EXCEPTION 'MCP_BAD:Existing % changed or was removed. Reload and use version-checked pricing. Nothing was saved.',part.label;
      END IF;
      IF EXISTS (
        SELECT 1 FROM
          (SELECT coalesce(value->>part.key_name,'') AS k,count(*) AS n FROM jsonb_array_elements(part.incoming) GROUP BY 1) i
        LEFT JOIN
          (SELECT coalesce(value->>part.key_name,'') AS k,count(*) AS n FROM jsonb_array_elements(part.existing) GROUP BY 1) o ON o.k=i.k
        WHERE (i.k='' AND i.n>coalesce(o.n,0)) OR (i.n>1 AND i.n>coalesce(o.n,0))
      ) THEN
        RAISE EXCEPTION 'MCP_BAD:New % entries need unique references. Reload and use version-checked pricing. Nothing was saved.',part.label;
      END IF;
    END IF;
  END LOOP;
  IF prior.job_id IS NOT NULL AND (_labor IS NULL OR _labor=prior.labor) AND
     (_material IS NULL OR _material=prior.material) AND (_quotes IS NULL OR _quotes=prior.quotes) AND
     (_sources IS NULL OR _sources=prior.rate_sources) THEN
    RETURN jsonb_build_object('saved',true);
  END IF;
  INSERT INTO public.mcp_estimate_pricing(job_id,company_id,labor,material,quotes,rate_sources)
  VALUES(_job,cid,coalesce(_labor,'[]'::jsonb),coalesce(_material,'[]'::jsonb),coalesce(_quotes,'[]'::jsonb),coalesce(_sources,'[]'::jsonb))
  ON CONFLICT(job_id) DO UPDATE SET
    labor=CASE WHEN _labor IS NULL THEN public.mcp_estimate_pricing.labor ELSE EXCLUDED.labor END,
    material=CASE WHEN _material IS NULL THEN public.mcp_estimate_pricing.material ELSE EXCLUDED.material END,
    quotes=CASE WHEN _quotes IS NULL THEN public.mcp_estimate_pricing.quotes ELSE EXCLUDED.quotes END,
    rate_sources=CASE WHEN _sources IS NULL THEN public.mcp_estimate_pricing.rate_sources ELSE EXCLUDED.rate_sources END,
    updated_by=auth.uid(),updated_at=now();
  RETURN jsonb_build_object('saved',true);
END $$;

CREATE FUNCTION public.mcp_estimate_pricing_save_versioned(_job uuid,_expected_version bigint,_labor jsonb,_material jsonb,_quotes jsonb,_sources jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v bigint; cid uuid;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  v:=mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  IF _expected_version IS NULL OR _expected_version <> v THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh pricing before saving.'; END IF;
  IF (_labor IS NOT NULL AND jsonb_typeof(_labor) <> 'array') OR (_material IS NOT NULL AND jsonb_typeof(_material) <> 'array') OR
     (_quotes IS NOT NULL AND jsonb_typeof(_quotes) <> 'array') OR (_sources IS NOT NULL AND jsonb_typeof(_sources) <> 'array') THEN
    RAISE EXCEPTION 'MCP_BAD:Pricing fields must be arrays or omitted.';
  END IF;
  IF _sources IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(_sources) s GROUP BY s->>'source'
    HAVING coalesce(s->>'source','')='' OR count(*)>1
  ) THEN RAISE EXCEPTION 'MCP_BAD:Factor sources need unique references. Nothing was saved.'; END IF;
  -- This replacement is permitted only after the matching-version check. The
  -- existing table trigger still prevents removing or changing saved quotes.
  INSERT INTO public.mcp_estimate_pricing(job_id,company_id,labor,material,quotes,rate_sources)
  VALUES(_job,cid,coalesce(_labor,'[]'::jsonb),coalesce(_material,'[]'::jsonb),coalesce(_quotes,'[]'::jsonb),coalesce(_sources,'[]'::jsonb))
  ON CONFLICT(job_id) DO UPDATE SET
    labor=CASE WHEN _labor IS NULL THEN public.mcp_estimate_pricing.labor ELSE EXCLUDED.labor END,
    material=CASE WHEN _material IS NULL THEN public.mcp_estimate_pricing.material ELSE EXCLUDED.material END,
    quotes=CASE WHEN _quotes IS NULL THEN public.mcp_estimate_pricing.quotes ELSE EXCLUDED.quotes END,
    rate_sources=CASE WHEN _sources IS NULL THEN public.mcp_estimate_pricing.rate_sources ELSE EXCLUDED.rate_sources END,
    updated_by=auth.uid(),updated_at=now();
  SELECT version INTO v FROM mcp_private.estimate_revision WHERE job_id=_job;
  RETURN jsonb_build_object('saved',true,'version',v);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_pricing_save_versioned(uuid,bigint,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_pricing_save_versioned(uuid,bigint,jsonb,jsonb,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.mcp_estimate_bid_save_versioned(_job uuid,_expected_version bigint,_overhead numeric,_profit numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v bigint;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  v:=mcp_private.estimate_lock(_job);
  PERFORM public.mcp_estimate_guard(_job);
  IF _expected_version IS NULL OR _expected_version <> v THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh the bid before saving.'; END IF;
  PERFORM public.mcp_estimate_bid_save(_job,_overhead,_profit);
  SELECT version INTO v FROM mcp_private.estimate_revision WHERE job_id=_job;
  RETURN jsonb_build_object('saved',true,'version',v);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_bid_save_versioned(uuid,bigint,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_bid_save_versioned(uuid,bigint,numeric,numeric) TO authenticated;
-- Strict persisted pricing type validation, part of this local proposal.
-- No new callable RPC, roles, policies, or permissions are added. Historical
-- malformed rows can be left untouched, but canonical pricing holds them.
CREATE FUNCTION mcp_private.validate_estimate_pricing_types() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE component text; rows jsonb; row_value jsonb; key_name text; numeric_value numeric;
BEGIN
  FOR component, rows IN
    SELECT * FROM (VALUES
      ('labor', CASE WHEN TG_OP='INSERT' OR NEW.labor IS DISTINCT FROM OLD.labor THEN NEW.labor ELSE NULL END),
      ('material', CASE WHEN TG_OP='INSERT' OR NEW.material IS DISTINCT FROM OLD.material THEN NEW.material ELSE NULL END),
      ('source', CASE WHEN TG_OP='INSERT' OR NEW.rate_sources IS DISTINCT FROM OLD.rate_sources THEN NEW.rate_sources ELSE NULL END)
    ) AS inputs(kind, value)
  LOOP
    IF rows IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(rows) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'MCP_BAD:Pricing entries must be arrays. Nothing was saved.';
    END IF;
    FOR row_value IN SELECT value FROM jsonb_array_elements(rows) LOOP
      IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'MCP_BAD:Each pricing entry must be an object. Nothing was saved.';
      END IF;
      IF component='source' THEN
        IF jsonb_typeof(row_value->'source') IS DISTINCT FROM 'string' OR row_value->>'source' NOT IN ('rsmeans','neca','smacna','mcaa') OR
           jsonb_typeof(row_value->'carry') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'MCP_BAD:Each factor source needs a recognized identity and a true or false carry decision. Nothing was saved.';
        END IF;
        IF row_value ? 'confirmed' AND jsonb_typeof(row_value->'confirmed') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'MCP_BAD:Factor confirmation must be true or false. Nothing was saved.';
        END IF;
        IF row_value ? 'metro' AND jsonb_typeof(row_value->'metro') <> 'null' AND
           (jsonb_typeof(row_value->'metro') IS DISTINCT FROM 'string' OR row_value->>'metro' NOT IN ('NYC','Chicago','Miami','Austin','Dallas','LA','SF','Boston','Philly','DC')) THEN
          RAISE EXCEPTION 'MCP_BAD:Factor location is not recognized. Nothing was saved.';
        END IF;
        IF row_value ? 'work_type' AND jsonb_typeof(row_value->'work_type') <> 'null' AND
           (jsonb_typeof(row_value->'work_type') IS DISTINCT FROM 'string' OR row_value->>'work_type' NOT IN ('commercial','residential','industrial','healthcare')) THEN
          RAISE EXCEPTION 'MCP_BAD:Factor work type is not recognized. Nothing was saved.';
        END IF;
        FOR key_name IN SELECT unnest(ARRAY['location_factor','work_factor']) LOOP
          IF row_value ? key_name AND jsonb_typeof(row_value->key_name) <> 'null' THEN
            IF jsonb_typeof(row_value->key_name) IS DISTINCT FROM 'number' THEN
              RAISE EXCEPTION 'MCP_BAD:Factors must be numeric and greater than zero. Nothing was saved.';
            END IF;
            numeric_value:=(row_value->>key_name)::numeric;
            IF numeric_value<=0 THEN RAISE EXCEPTION 'MCP_BAD:Factors must be numeric and greater than zero. Nothing was saved.'; END IF;
          END IF;
        END LOOP;
      ELSE
        IF jsonb_typeof(row_value->'ref') IS DISTINCT FROM 'string' OR coalesce(length(btrim(row_value->>'ref')),0)=0 THEN
          RAISE EXCEPTION 'MCP_BAD:Each rate needs a reference. Nothing was saved.';
        END IF;
        FOREACH key_name IN ARRAY ARRAY['confirmed','apply_factor'] LOOP
          IF row_value ? key_name AND jsonb_typeof(row_value->key_name) IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'MCP_BAD:Rate confirmation and factor application must be true or false. Nothing was saved.';
          END IF;
        END LOOP;
        IF row_value ? 'source' AND jsonb_typeof(row_value->'source') <> 'null' AND
           (jsonb_typeof(row_value->'source') IS DISTINCT FROM 'string' OR row_value->>'source' NOT IN ('rsmeans','neca','smacna','mcaa')) THEN
          RAISE EXCEPTION 'MCP_BAD:Rate source is not recognized. Nothing was saved.';
        END IF;
        FOR key_name IN SELECT unnest(CASE WHEN component='labor' THEN
          ARRAY['production_per_man_hour','man_hours','man_days','crew_size','hours_per_day','hourly_rate','crew_rate'] ELSE ARRAY['unit_price'] END) LOOP
          IF row_value ? key_name AND jsonb_typeof(row_value->key_name) <> 'null' THEN
            IF jsonb_typeof(row_value->key_name) IS DISTINCT FROM 'number' THEN
              RAISE EXCEPTION 'MCP_BAD:Rate values must be numeric. Nothing was saved.';
            END IF;
            numeric_value:=(row_value->>key_name)::numeric;
            IF numeric_value<0 OR (key_name IN ('production_per_man_hour','crew_size','hours_per_day') AND numeric_value=0) OR
               (key_name='hours_per_day' AND numeric_value>24) THEN
              RAISE EXCEPTION 'MCP_BAD:Rate values are outside the supported range. Nothing was saved.';
            END IF;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mcp_private.validate_estimate_pricing_types() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER estimate_pricing_validate_types BEFORE INSERT OR UPDATE ON public.mcp_estimate_pricing
  FOR EACH ROW EXECUTE FUNCTION mcp_private.validate_estimate_pricing_types();
