-- Local proposal only. Apply after estimating-quote-coverage.sql and the
-- estimating reader volatility correction, never directly to a managed DB.
-- Preserve both existing public signatures, owners, ACLs and role checks.
-- Versioned callers send {"expected_version":number,"lines":[...]} for GC
-- or {"expected_version":number,"items":[...]} for requirements. Legacy
-- arrays can create, repeat or add, but may not overwrite or omit saved facts.

CREATE OR REPLACE FUNCTION public.mcp_estimate_gc_save(_job uuid,_start date,_finish date,_days integer,_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; ver bigint; expected bigint; data jsonb; prior public.mcp_estimate_general_conditions;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  ver:=mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  IF jsonb_typeof(_lines)='object' THEN
    IF jsonb_typeof(_lines->'expected_version') IS DISTINCT FROM 'number'
       OR coalesce(_lines->>'expected_version','') !~ '^(0|[1-9][0-9]{0,15})$'
       OR jsonb_typeof(_lines->'lines') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'MCP_BAD:Read the current version and send valid general conditions. Nothing was saved.';
    END IF;
    expected:=(_lines->>'expected_version')::bigint;
    IF expected<>ver THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh general conditions before saving.'; END IF;
    data:=_lines->'lines';
  ELSIF _lines IS NULL OR jsonb_typeof(_lines)='array' THEN
    data:=coalesce(_lines,'[]'::jsonb);
  ELSE
    RAISE EXCEPTION 'MCP_BAD:Send valid general conditions. Nothing was saved.';
  END IF;
  IF _days IS NOT NULL AND _days<1 THEN RAISE EXCEPTION 'MCP_BAD:Schedule duration has to be at least one day. Nothing was saved.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(data) x WHERE jsonb_typeof(x)<>'object' OR coalesce(btrim(x->>'key'),'') NOT IN ('trailer','office','cad','water','supplies','supervision'))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(data) x GROUP BY x->>'key' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'MCP_BAD:General condition keys must be present and unique. Nothing was saved.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(data) x WHERE
      (x ? 'confirmed' AND jsonb_typeof(x->'confirmed') IS DISTINCT FROM 'boolean') OR
      (x ? 'amount' AND jsonb_typeof(x->'amount') NOT IN ('number','null')) OR
      (x ? 'qty' AND jsonb_typeof(x->'qty') NOT IN ('number','null')) OR
      (x ? 'rate' AND jsonb_typeof(x->'rate') NOT IN ('number','null')) OR
      CASE WHEN jsonb_typeof(x->'amount')='number' THEN (x->>'amount')::numeric<0 ELSE false END OR
      CASE WHEN jsonb_typeof(x->'qty')='number' THEN (x->>'qty')::numeric<0 ELSE false END OR
      CASE WHEN jsonb_typeof(x->'rate')='number' THEN (x->>'rate')::numeric<0 ELSE false END
  ) THEN RAISE EXCEPTION 'MCP_BAD:General conditions need nonnegative numbers and boolean confirmation. Nothing was saved.'; END IF;
  SELECT * INTO prior FROM public.mcp_estimate_general_conditions WHERE job_id=_job;
  IF expected IS NULL AND prior.job_id IS NOT NULL THEN
    IF (prior.start_date IS NOT NULL AND prior.start_date IS DISTINCT FROM _start)
      OR (prior.finish_date IS NOT NULL AND prior.finish_date IS DISTINCT FROM _finish)
      OR (prior.duration_days IS NOT NULL AND prior.duration_days IS DISTINCT FROM _days)
      OR jsonb_typeof(prior.lines) IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM (SELECT value,count(*) AS n FROM jsonb_array_elements(prior.lines) GROUP BY value) o
        LEFT JOIN (SELECT value,count(*) AS n FROM jsonb_array_elements(data) GROUP BY value) n ON n.value=o.value
        WHERE coalesce(n.n,0)<o.n
      ) THEN
      RAISE EXCEPTION 'MCP_BAD:Existing general conditions changed or were removed. Refresh and use version-checked saving. Nothing was saved.';
    END IF;
  END IF;
  IF prior.job_id IS NOT NULL AND prior.start_date IS NOT DISTINCT FROM _start
     AND prior.finish_date IS NOT DISTINCT FROM _finish AND prior.duration_days IS NOT DISTINCT FROM _days
     AND prior.lines=data THEN RETURN jsonb_build_object('saved',true,'version',ver); END IF;
  INSERT INTO public.mcp_estimate_general_conditions(job_id,company_id,start_date,finish_date,duration_days,lines)
  VALUES(_job,cid,_start,_finish,_days,data)
  ON CONFLICT(job_id) DO UPDATE SET start_date=excluded.start_date,finish_date=excluded.finish_date,
    duration_days=excluded.duration_days,lines=excluded.lines,updated_by=auth.uid(),updated_at=now();
  SELECT version INTO ver FROM mcp_private.estimate_revision WHERE job_id=_job;
  RETURN jsonb_build_object('saved',true,'version',ver);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_estimate_requirements_save(_job uuid,_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; ver bigint; expected bigint; data jsonb; it jsonb; n int:=0; current_row record; incoming jsonb;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  ver:=mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  IF jsonb_typeof(_items)='object' THEN
    IF jsonb_typeof(_items->'expected_version') IS DISTINCT FROM 'number'
       OR coalesce(_items->>'expected_version','') !~ '^(0|[1-9][0-9]{0,15})$'
       OR jsonb_typeof(_items->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'MCP_BAD:Read the current version and send valid requirements. Nothing was saved.';
    END IF;
    expected:=(_items->>'expected_version')::bigint;
    IF expected<>ver THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh requirements before saving.'; END IF;
    data:=_items->'items';
  ELSIF _items IS NULL OR jsonb_typeof(_items)='array' THEN
    data:=coalesce(_items,'[]'::jsonb);
  ELSE
    RAISE EXCEPTION 'MCP_BAD:Send valid requirements. Nothing was saved.';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(data) i GROUP BY i->>'ref' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'MCP_BAD:Requirement references must be unique. Nothing was saved.';
  END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(data) LOOP
    IF jsonb_typeof(it)<>'object' OR coalesce(it->>'ref','') !~ '^R-[0-9]+$' THEN RAISE EXCEPTION 'MCP_BAD:Each requirement needs a number. Nothing was saved.'; END IF;
    IF length(btrim(coalesce(it->>'citation','')))<1 OR length(btrim(coalesce(it->>'source_ref','')))<1 THEN
      RAISE EXCEPTION 'MCP_BAD:Each requirement cites a sheet, a spec section, or a contract clause. Nothing was saved.';
    END IF;
    IF length(btrim(coalesce(it->>'kind','')))<1 OR length(btrim(it->>'kind'))>80 THEN
      RAISE EXCEPTION 'MCP_BAD:Name the requirement category, or use other with a description. Nothing was saved.';
    END IF;
    IF lower(btrim(it->>'kind'))='other' AND length(btrim(coalesce(it->>'description','')))<1 THEN
      RAISE EXCEPTION 'MCP_BAD:A requirement marked other needs a description. Nothing was saved.';
    END IF;
    IF (it ? 'confirmed' AND jsonb_typeof(it->'confirmed') IS DISTINCT FROM 'boolean') OR
       (it ? 'excluded' AND jsonb_typeof(it->'excluded') IS DISTINCT FROM 'boolean') OR
       (it ? 'amount' AND jsonb_typeof(it->'amount') NOT IN ('number','null')) OR
       (CASE WHEN jsonb_typeof(it->'amount')='number' THEN (it->>'amount')::numeric<0 ELSE false END) THEN
      RAISE EXCEPTION 'MCP_BAD:Requirement amounts need nonnegative numbers and confirmations need booleans. Nothing was saved.';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.mcp_estimate_requirements r
    JOIN jsonb_array_elements(data) i ON i->>'ref'=r.ref
    WHERE r.job_id=_job AND r.active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'MCP_BAD:An inactive requirement cannot be reused without a reviewed reactivation workflow. Nothing was saved.';
  END IF;
  IF expected IS NULL THEN
    FOR current_row IN SELECT * FROM public.mcp_estimate_requirements WHERE job_id=_job AND active LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(data) WHERE value->>'ref'=current_row.ref;
      IF incoming IS NULL THEN CONTINUE; END IF;
      IF jsonb_build_object('kind',left(btrim(incoming->>'kind'),80),
           'description',nullif(left(btrim(coalesce(incoming->>'description','')),200),''),
           'label',left(btrim(incoming->>'label'),200),'source_type',incoming->>'source_type',
           'source_ref',left(btrim(incoming->>'source_ref'),80),'citation',left(btrim(incoming->>'citation'),500),
           'placement',coalesce(nullif(incoming->>'placement',''),'own_line'),
           'amount',CASE WHEN incoming->>'amount' IS NULL OR incoming->>'amount'='' THEN NULL ELSE (incoming->>'amount')::numeric END,
           'confirmed',coalesce((incoming->>'confirmed')::boolean,false),'excluded',coalesce((incoming->>'excluded')::boolean,false))
         IS DISTINCT FROM jsonb_build_object('kind',current_row.kind,'description',current_row.description,'label',current_row.label,
           'source_type',current_row.source_type,'source_ref',current_row.source_ref,'citation',current_row.citation,
           'placement',current_row.placement,'amount',current_row.amount,'confirmed',current_row.confirmed,'excluded',current_row.excluded) THEN
        RAISE EXCEPTION 'MCP_BAD:Existing requirements changed or were removed. Refresh and use version-checked saving. Nothing was saved.';
      END IF;
    END LOOP;
  END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(data) LOOP
    -- Skip identical rows before INSERT: BEFORE INSERT version triggers would
    -- otherwise advance the estimate even when ON CONFLICT is a no-op.
    SELECT * INTO current_row FROM public.mcp_estimate_requirements WHERE job_id=_job AND ref=it->>'ref';
    IF FOUND AND current_row.active AND
       jsonb_build_object('kind',left(btrim(it->>'kind'),80),
         'description',nullif(left(btrim(coalesce(it->>'description','')),200),''),
         'label',left(btrim(it->>'label'),200),'source_type',it->>'source_type',
         'source_ref',left(btrim(it->>'source_ref'),80),'citation',left(btrim(it->>'citation'),500),
         'placement',coalesce(nullif(it->>'placement',''),'own_line'),
         'amount',CASE WHEN it->>'amount' IS NULL OR it->>'amount'='' THEN NULL ELSE (it->>'amount')::numeric END,
         'confirmed',coalesce((it->>'confirmed')::boolean,false),'excluded',coalesce((it->>'excluded')::boolean,false))
       = jsonb_build_object('kind',current_row.kind,'description',current_row.description,'label',current_row.label,
         'source_type',current_row.source_type,'source_ref',current_row.source_ref,'citation',current_row.citation,
         'placement',current_row.placement,'amount',current_row.amount,'confirmed',current_row.confirmed,'excluded',current_row.excluded) THEN
      n:=n+1;
      CONTINUE;
    END IF;
    INSERT INTO public.mcp_estimate_requirements(job_id,company_id,ref,kind,description,label,source_type,source_ref,citation,placement,amount,confirmed,excluded,active)
    VALUES(_job,cid,it->>'ref',left(btrim(it->>'kind'),80),nullif(left(btrim(coalesce(it->>'description','')),200),''),left(btrim(it->>'label'),200),it->>'source_type',left(btrim(it->>'source_ref'),80),
      left(btrim(it->>'citation'),500),coalesce(nullif(it->>'placement',''),'own_line'),
      CASE WHEN it->>'amount' IS NULL OR it->>'amount'='' THEN NULL ELSE (it->>'amount')::numeric END,
      coalesce((it->>'confirmed')::boolean,false),coalesce((it->>'excluded')::boolean,false),true)
    ON CONFLICT(job_id,ref) DO UPDATE SET kind=excluded.kind,description=excluded.description,label=excluded.label,source_type=excluded.source_type,
      source_ref=excluded.source_ref,citation=excluded.citation,placement=excluded.placement,amount=excluded.amount,confirmed=excluded.confirmed,
      excluded=excluded.excluded,active=true;
    n:=n+1;
  END LOOP;
  -- Omission never changes an existing requirement. Explicit excluded=true is
  -- the supported scoped decision; historical inactive rows stay intact.
  SELECT version INTO ver FROM mcp_private.estimate_revision WHERE job_id=_job;
  RETURN jsonb_build_object('saved',n,'version',ver);
END $$;

-- Install only after both replacements above have succeeded. The existing
-- snapshot checks the marker's existence; it is not an exposed callable API.
CREATE FUNCTION mcp_private.estimate_gc_requirements_cas_marker() RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_gc_requirements_cas_marker() FROM PUBLIC,anon,authenticated;
