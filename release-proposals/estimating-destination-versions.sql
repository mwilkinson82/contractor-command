-- LOCAL UNAPPLIED PROPOSAL. Requires the reviewed official SOV lock and existing
-- change-order tables. Two new guarded authenticated EXECUTE grants and private
-- draft metadata require specific access review before Lovable installation.
-- Preserve the existing financial records and accounting review workflows.

-- Check source dependencies before making even an additive schema change.
DO $$
DECLARE facts_source text; terms_source text;
BEGIN
  SELECT prosrc INTO facts_source FROM pg_proc
    WHERE oid='public.mcp_set_facts(uuid,text,jsonb,text)'::regprocedure;
  SELECT prosrc INTO terms_source FROM pg_proc
    WHERE oid='public.mcp_job_sov_terms(uuid,numeric,text)'::regprocedure;
  IF md5(facts_source) IS DISTINCT FROM 'dff1cd538a5bfa4ceaf9bc254155b3c8' OR
    md5(terms_source) IS DISTINCT FROM '91858a96b1392ad9e72454ad81689e1c' OR
    to_regclass('public.mcp_change_orders') IS NULL OR to_regclass('public.mcp_submittals') IS NULL THEN
    RAISE EXCEPTION 'Destination source dependencies differ from the reviewed SOV/accounting baseline. Reconcile before installation.';
  END IF;
END $$;

-- Job rows are visible to field and contract-only roles. Keep new draft financial
-- terms off that public row; only the full-job guarded RPCs may read them.
CREATE TABLE mcp_private.estimate_destination_draft_terms (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  fee_pct numeric(7,4) CHECK (fee_pct IS NULL OR (fee_pct >= 0 AND fee_pct < 100)),
  basis text
);
ALTER TABLE mcp_private.estimate_destination_draft_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mcp_private.estimate_destination_draft_terms FROM PUBLIC,anon,authenticated;

CREATE TABLE mcp_private.estimate_destination_revision (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0
);
CREATE TABLE mcp_private.estimate_destination_write_ticket (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  transaction_id bigint NOT NULL,
  actor uuid NOT NULL,
  PRIMARY KEY(job_id,transaction_id)
);
REVOKE ALL ON mcp_private.estimate_destination_revision,
  mcp_private.estimate_destination_write_ticket FROM PUBLIC,anon,authenticated;

-- Existing accounting writers already hold the job row. Triggers never acquire
-- a company lock after that row; public entry points acquire company then job.
CREATE FUNCTION mcp_private.estimate_destination_lock(_job uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE version_now bigint;
BEGIN
  PERFORM 1 FROM public.mcp_jobs WHERE id=_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Destination job is unavailable.'; END IF;
  INSERT INTO mcp_private.estimate_destination_revision(job_id) VALUES(_job)
    ON CONFLICT DO NOTHING;
  SELECT version INTO version_now FROM mcp_private.estimate_destination_revision
    WHERE job_id=_job FOR UPDATE;
  IF version_now>9007199254740991 THEN
    RAISE EXCEPTION 'MCP_BAD:Destination revision requires review.';
  END IF;
  RETURN version_now;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_destination_lock(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mcp_private.estimate_destination_access(_job uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cid uuid; version_now bigint;
BEGIN
  IF public.mcp_assert_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_NO_JOB';
  END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id=_job;
  PERFORM 1 FROM public.mcp_companies WHERE id=cid FOR UPDATE;
  version_now:=mcp_private.estimate_destination_lock(_job);
  IF public.mcp_assert_job_scope(_job) IS DISTINCT FROM 'full' OR
    cid IS DISTINCT FROM (SELECT company_id FROM public.mcp_jobs WHERE id=_job) THEN
    RAISE EXCEPTION 'MCP_NO_JOB';
  END IF;
  RETURN version_now;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_destination_access(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mcp_private.estimate_sov_flag_shape(_value jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF jsonb_typeof(_value) IS DISTINCT FROM 'object' THEN RETURN; END IF;
  IF _value ? 'fee_included' AND jsonb_typeof(_value->'fee_included') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'MCP_BAD:SOV fee_included must be a boolean. Review the saved change-order evidence.';
  END IF;
  IF _value ? 'executed_change_order' AND (
    jsonb_typeof(_value->'executed_change_order') IS DISTINCT FROM 'string' OR
    coalesce(_value->>'executed_change_order','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'MCP_BAD:SOV executed_change_order must identify the exact saved change order.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_sov_flag_shape(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mcp_private.estimate_sov_source(
  _job uuid,_module text,_key text,_value jsonb,_client boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE reference_value jsonb; change_record jsonb; has_change boolean;
BEGIN
  PERFORM mcp_private.estimate_sov_flag_shape(_value);
  SELECT value INTO reference_value FROM public.mcp_job_facts
    WHERE job_id=_job AND module=CASE WHEN _module='sov_draft' THEN 'sov' ELSE _module END AND key=_key;
  has_change:=coalesce(_value ? 'executed_change_order',false);
  IF (_client OR _module='sov_draft') AND
    (has_change OR coalesce(reference_value ? 'executed_change_order',false)) AND (
      NOT coalesce(reference_value ? 'executed_change_order',false) OR
      _value->'executed_change_order' IS DISTINCT FROM reference_value->'executed_change_order' OR
      _value->'fee_included' IS DISTINCT FROM reference_value->'fee_included' OR
      _value->'billable_value' IS DISTINCT FROM reference_value->'billable_value') THEN
    RAISE EXCEPTION 'MCP_BAD:Preserve the exact existing official change-order amount and source. Executed changes cannot be invented by a destination save.';
  END IF;
  IF NOT has_change THEN RETURN; END IF;
  SELECT details INTO change_record FROM public.mcp_change_orders
    WHERE job_id=_job AND submittal_id=(_value->>'executed_change_order')::uuid;
  -- The real execution writer inserts its SOV line while the source is approved,
  -- then marks that source executed later in the same transaction.
  IF change_record IS NULL OR coalesce(change_record->>'state','') NOT IN ('approved','executed') OR
    jsonb_typeof(change_record->'total_cents') IS DISTINCT FROM 'number' OR
    jsonb_typeof(_value->'billable_value') IS DISTINCT FROM 'number' OR
    _value->'fee_included' IS DISTINCT FROM 'true'::jsonb OR
    (change_record->>'total_cents')::numeric<>trunc((change_record->>'total_cents')::numeric) OR
    abs((change_record->>'total_cents')::numeric)>9000000000000 OR
    (_value->>'billable_value')::numeric*100 IS DISTINCT FROM (change_record->>'total_cents')::numeric THEN
    RAISE EXCEPTION 'MCP_BAD:The executed SOV line must match its saved approved change-order source and price.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_sov_source(uuid,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mcp_private.estimate_destination_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j uuid; old_row jsonb; new_row jsonb; protected_edit boolean:=false;
  authorized boolean; relevant boolean:=true;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  j:=coalesce((new_row->>'job_id')::uuid,(old_row->>'job_id')::uuid);
  IF TG_TABLE_NAME='mcp_jobs' THEN
    j:=(new_row->>'id')::uuid;
    relevant:=ROW(OLD.company_id,OLD.sov_fee_pct,OLD.sov_basis)
      IS DISTINCT FROM ROW(NEW.company_id,NEW.sov_fee_pct,NEW.sov_basis);
    protected_edit:=
      (OLD.sov_fee_pct IS NOT NULL AND OLD.sov_fee_pct IS DISTINCT FROM NEW.sov_fee_pct) OR
      (OLD.sov_basis IS NOT NULL AND OLD.sov_basis IS DISTINCT FROM NEW.sov_basis);
  ELSIF TG_TABLE_NAME='estimate_destination_draft_terms' THEN
    IF TG_OP='UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
      RAISE EXCEPTION 'MCP_BAD:Draft terms cannot be moved between jobs.';
    END IF;
    protected_edit:=true;
  ELSIF TG_TABLE_NAME='mcp_job_facts' THEN
    relevant:=coalesce(new_row->>'module','') IN ('budget','sov','sov_draft','contract') OR
      coalesce(old_row->>'module','') IN ('budget','sov','sov_draft','contract');
    IF TG_OP<>'INSERT' AND (
      coalesce(old_row->>'module','') IN ('budget','sov','sov_draft') OR
      coalesce(new_row->>'module','') IN ('budget','sov','sov_draft')) THEN
      protected_edit:=TG_OP='DELETE' OR
        (old_row-'updated_at'-'updated_by') IS DISTINCT FROM (new_row-'updated_at'-'updated_by');
    END IF;
    IF relevant AND TG_OP='UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
      RAISE EXCEPTION 'MCP_BAD:Destination facts cannot be moved between jobs.';
    END IF;
  ELSIF TG_OP='UPDATE' AND old_row->>'job_id' IS DISTINCT FROM new_row->>'job_id' THEN
    RAISE EXCEPTION 'MCP_BAD:Destination source history cannot be moved between jobs.';
  END IF;
  IF NOT relevant OR old_row IS NOT DISTINCT FROM new_row THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  -- Preserve existing project deletion cascades; no live project deletion is
  -- performed by these APIs, and no version survives a deleted project.
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE id=j) THEN RETURN OLD; END IF;
  PERFORM mcp_private.estimate_destination_lock(j);
  SELECT EXISTS(SELECT 1 FROM mcp_private.estimate_destination_write_ticket
    WHERE job_id=j AND transaction_id=txid_current() AND actor=auth.uid()) INTO authorized;
  IF TG_TABLE_NAME='mcp_job_facts' AND TG_OP<>'DELETE' AND
    new_row->>'module' IN ('sov','sov_draft') THEN
    PERFORM mcp_private.estimate_sov_source(j,new_row->>'module',new_row->>'key',new_row->'value',authorized);
  END IF;
  IF protected_edit AND NOT authorized THEN
    RAISE EXCEPTION 'MCP_BAD:Read the destination version and use a version-checked save. Nothing was changed.';
  END IF;
  UPDATE mcp_private.estimate_destination_revision SET version=version+1 WHERE job_id=j;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_destination_changed() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER estimate_destination_facts BEFORE INSERT OR UPDATE OR DELETE ON public.mcp_job_facts
  FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_destination_changed();
CREATE TRIGGER estimate_destination_terms BEFORE UPDATE OF company_id,sov_fee_pct,sov_basis ON public.mcp_jobs
  FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_destination_changed();
CREATE TRIGGER estimate_destination_draft_terms BEFORE INSERT OR UPDATE OR DELETE ON mcp_private.estimate_destination_draft_terms
  FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_destination_changed();
CREATE TRIGGER estimate_destination_changes BEFORE INSERT OR UPDATE OR DELETE ON public.mcp_change_orders
  FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_destination_changed();
-- Submittal identity/revision changes can make an older approved CO non-current.
-- Conservatively version all submittal changes on the selected job.
CREATE TRIGGER estimate_destination_change_sources BEFORE INSERT OR UPDATE OR DELETE ON public.mcp_submittals
  FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_destination_changed();

-- Keep the installed official-SOV and accounting implementations as private
-- delegates. CREATE OR REPLACE below retains public owner/signature/ACL.
DO $$
DECLARE definition text; source text;
BEGIN
  SELECT pg_get_functiondef(oid),prosrc INTO definition,source
    FROM pg_proc WHERE oid='public.mcp_set_facts(uuid,text,jsonb,text)'::regprocedure;
  IF md5(source)<>'dff1cd538a5bfa4ceaf9bc254155b3c8' OR
    position('mcp_assert_sov_total' IN source)=0 OR position('sov_draft' IN source)=0 THEN
    RAISE EXCEPTION 'Installed fact writer drifted from the reviewed official SOV lock. Reconcile the source before destination versioning.';
  END IF;
  EXECUTE replace(definition,'FUNCTION public.mcp_set_facts(',
    'FUNCTION mcp_private.estimate_destination_set_facts_base(');
  REVOKE ALL ON FUNCTION mcp_private.estimate_destination_set_facts_base(uuid,text,jsonb,text)
    FROM PUBLIC,anon,authenticated;
  SELECT pg_get_functiondef(oid),prosrc INTO definition,source
    FROM pg_proc WHERE oid='public.mcp_job_sov_terms(uuid,numeric,text)'::regprocedure;
  IF md5(source)<>'91858a96b1392ad9e72454ad81689e1c' OR position('mcp_assert_sov_total' IN source)=0 THEN
    RAISE EXCEPTION 'Installed SOV terms drifted from the reviewed guard. Reconcile the source before destination versioning.';
  END IF;
  EXECUTE replace(definition,'FUNCTION public.mcp_job_sov_terms(',
    'FUNCTION mcp_private.estimate_destination_sov_terms_base(');
  REVOKE ALL ON FUNCTION mcp_private.estimate_destination_sov_terms_base(uuid,numeric,text)
    FROM PUBLIC,anon,authenticated;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_set_facts(_job uuid,_module text,_facts jsonb,_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; v jsonb; status_next text; value_next jsonb; old public.mcp_job_facts;
  additions jsonb:='{}'; known text[]:='{}'; unknown_keys text[]:='{}';
BEGIN
  -- Existing contract-basis accounting has its own exact-context review protocol.
  -- Preserve that path; its facts still advance destination revision by trigger.
  IF _module NOT IN ('budget','sov','sov_draft') THEN
    RETURN mcp_private.estimate_destination_set_facts_base(_job,_module,_facts,_source);
  END IF;
  PERFORM mcp_private.estimate_destination_access(_job);
  IF jsonb_typeof(coalesce(_facts,'{}'::jsonb)) IS DISTINCT FROM 'object' OR
    _source NOT IN ('document','member_answer','company_default') THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid destination facts or source.';
  END IF;
  FOR k,v IN SELECT * FROM jsonb_each(coalesce(_facts,'{}'::jsonb)) LOOP
    IF length(k)>120 THEN CONTINUE; END IF;
    IF _module IN ('sov','sov_draft') THEN
      PERFORM mcp_private.estimate_sov_source(_job,_module,k,v,true);
    END IF;
    status_next:=CASE WHEN v IS NULL OR v IN ('null'::jsonb,'"unknown"'::jsonb,'""'::jsonb) THEN 'unknown'
      WHEN v='"na"'::jsonb THEN 'na' ELSE 'known' END;
    value_next:=CASE WHEN status_next='known' THEN v ELSE NULL END;
    SELECT * INTO old FROM public.mcp_job_facts WHERE job_id=_job AND module=_module AND key=k;
    IF FOUND THEN
      IF old.value IS DISTINCT FROM value_next OR old.status IS DISTINCT FROM status_next OR
        old.source IS DISTINCT FROM _source THEN
        RAISE EXCEPTION 'MCP_BAD:Read the destination version and use a version-checked save. Nothing was changed.';
      END IF;
    ELSE additions:=additions||jsonb_build_object(k,v);
    END IF;
    IF status_next='unknown' THEN unknown_keys:=unknown_keys||k; ELSE known:=known||k; END IF;
  END LOOP;
  PERFORM mcp_private.estimate_destination_set_facts_base(_job,_module,additions,_source);
  RETURN jsonb_build_object('known',to_jsonb(known),'unknown',to_jsonb(unknown_keys));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_job_sov_terms(_job uuid,_fee_pct numeric,_basis text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM mcp_private.estimate_destination_access(_job);
  IF _fee_pct IS NOT NULL AND (_fee_pct<0 OR _fee_pct>=100 OR round(_fee_pct,4)<>_fee_pct) THEN
    RAISE EXCEPTION 'MCP_BAD:Fee percent must be at least zero, under 100, and use at most four decimal places.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
  IF (_fee_pct IS NOT NULL AND j.sov_fee_pct IS NOT NULL AND _fee_pct IS DISTINCT FROM j.sov_fee_pct) OR
    (nullif(btrim(_basis),'') IS NOT NULL AND j.sov_basis IS NOT NULL AND btrim(_basis) IS DISTINCT FROM j.sov_basis) THEN
    RAISE EXCEPTION 'MCP_BAD:Read the destination version and use a version-checked save. Nothing was changed.';
  END IF;
  PERFORM mcp_private.estimate_destination_sov_terms_base(_job,_fee_pct,_basis);
END $$;

CREATE FUNCTION public.mcp_estimate_destination_snapshot(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE version_now bigint; j public.mcp_jobs; draft mcp_private.estimate_destination_draft_terms;
  facts jsonb; changes jsonb; fact jsonb;
BEGIN
  version_now:=mcp_private.estimate_destination_access(_job);
  SELECT * INTO j FROM public.mcp_jobs WHERE id=_job;
  SELECT * INTO draft FROM mcp_private.estimate_destination_draft_terms WHERE job_id=_job;
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.module,f.key),'[]') INTO facts
    FROM public.mcp_job_facts f WHERE job_id=_job AND module IN ('budget','sov','sov_draft','contract');
  FOR fact IN SELECT f FROM jsonb_array_elements(facts) f WHERE f->>'module' IN ('sov','sov_draft') LOOP
    PERFORM mcp_private.estimate_sov_flag_shape(fact->'value');
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('source',to_jsonb(s)) ORDER BY c.submittal_id),'[]') INTO changes
    FROM public.mcp_change_orders c JOIN public.mcp_submittals s ON s.id=c.submittal_id WHERE c.job_id=_job;
  IF public.mcp_assert_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  RETURN jsonb_build_object(
    'version',version_now,'company_id',j.company_id,'job_id',_job,
    'budget',coalesce((SELECT jsonb_object_agg(f->>'key',f->'value') FROM jsonb_array_elements(facts) f WHERE f->>'module'='budget'),'{}'),
    'sov',coalesce((SELECT jsonb_object_agg(f->>'key',f->'value') FROM jsonb_array_elements(facts) f WHERE f->>'module'='sov'),'{}'),
    'sov_draft',coalesce((SELECT jsonb_object_agg(f->>'key',f->'value') FROM jsonb_array_elements(facts) f WHERE f->>'module'='sov_draft'),'{}'),
    'terms',jsonb_build_object('fee_pct',j.sov_fee_pct,'basis',j.sov_basis),
    'draft_terms',jsonb_build_object('fee_pct',draft.fee_pct,'basis',draft.basis),
    'official_locked',EXISTS(SELECT 1 FROM public.mcp_job_facts f WHERE f.job_id=_job AND f.module='sov' AND jsonb_typeof(f.value->'billable_value')='number'),
    'contract',coalesce((SELECT jsonb_agg(f) FROM jsonb_array_elements(facts) f WHERE f->>'module'='contract'),'[]'),
    'fact_sources',facts,'changes',changes,'capabilities',jsonb_build_object('destination_cas',true));
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_destination_snapshot(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_destination_snapshot(uuid) TO authenticated;

CREATE FUNCTION public.mcp_estimate_destination_save(
  _job uuid,_expected_version bigint,
  _budget jsonb DEFAULT NULL,_sov jsonb DEFAULT NULL,_sov_draft jsonb DEFAULT NULL,
  _fee_pct numeric DEFAULT NULL,_basis text DEFAULT NULL,
  _draft_fee_pct numeric DEFAULT NULL,_draft_basis text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE version_now bigint; patch jsonb;
BEGIN
  version_now:=mcp_private.estimate_destination_access(_job);
  IF _expected_version IS NULL OR _expected_version<>version_now THEN
    RAISE EXCEPTION 'MCP_BAD:Destination changed. Read and review the current version.';
  END IF;
  FOREACH patch IN ARRAY ARRAY[_budget,_sov,_sov_draft] LOOP
    IF patch IS NOT NULL AND (jsonb_typeof(patch) IS DISTINCT FROM 'object' OR octet_length(patch::text)>1048576) THEN
      RAISE EXCEPTION 'MCP_BAD:Destination patches must be objects below 1 MB.';
    END IF;
  END LOOP;
  IF _fee_pct IS NOT NULL AND (_fee_pct<0 OR _fee_pct>=100 OR round(_fee_pct,4)<>_fee_pct) THEN
    RAISE EXCEPTION 'MCP_BAD:Fee percent must be at least zero, under 100, and use at most four decimal places.';
  END IF;
  IF _draft_fee_pct IS NOT NULL AND (_draft_fee_pct<0 OR _draft_fee_pct>=100 OR round(_draft_fee_pct,4)<>_draft_fee_pct) THEN
    RAISE EXCEPTION 'MCP_BAD:Draft fee percent must be at least zero, under 100, and use at most four decimal places.';
  END IF;
  INSERT INTO mcp_private.estimate_destination_write_ticket(job_id,transaction_id,actor)
    VALUES(_job,txid_current(),auth.uid());
  IF _fee_pct IS NOT NULL OR _basis IS NOT NULL THEN
    PERFORM mcp_private.estimate_destination_sov_terms_base(_job,_fee_pct,_basis);
  END IF;
  IF _budget IS NOT NULL THEN PERFORM mcp_private.estimate_destination_set_facts_base(_job,'budget',_budget,'member_answer'); END IF;
  IF _sov IS NOT NULL THEN PERFORM mcp_private.estimate_destination_set_facts_base(_job,'sov',_sov,'member_answer'); END IF;
  IF _sov_draft IS NOT NULL THEN PERFORM mcp_private.estimate_destination_set_facts_base(_job,'sov_draft',_sov_draft,'member_answer'); END IF;
  IF _draft_fee_pct IS NOT NULL OR _draft_basis IS NOT NULL THEN
    -- The job/revision lock already serializes creation and correction. Avoid an
    -- upsert's speculative INSERT trigger so a no-op keeps the same revision.
    IF EXISTS(SELECT 1 FROM mcp_private.estimate_destination_draft_terms WHERE job_id=_job) THEN
      UPDATE mcp_private.estimate_destination_draft_terms
        SET fee_pct=coalesce(_draft_fee_pct,fee_pct),
          basis=coalesce(nullif(btrim(_draft_basis),''),basis) WHERE job_id=_job;
    ELSE
      INSERT INTO mcp_private.estimate_destination_draft_terms(job_id,fee_pct,basis)
        VALUES(_job,_draft_fee_pct,nullif(btrim(_draft_basis),''));
    END IF;
  END IF;
  DELETE FROM mcp_private.estimate_destination_write_ticket
    WHERE job_id=_job AND transaction_id=txid_current() AND actor=auth.uid();
  RETURN public.mcp_estimate_destination_snapshot(_job);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_destination_save(uuid,bigint,jsonb,jsonb,jsonb,numeric,text,numeric,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_destination_save(uuid,bigint,jsonb,jsonb,jsonb,numeric,text,numeric,text) TO authenticated;
