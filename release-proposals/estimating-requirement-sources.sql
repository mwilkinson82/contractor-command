-- LOCAL UNAPPLIED PROPOSAL. Requires quote coverage, GC/requirements CAS and
-- the existing contract/spec upload schema. No new RPC or EXECUTE grant.
-- Apply only through the reviewed Lovable lane in one transaction.
DO $$
DECLARE source text; requirements text; freeze_review text; freeze_save text;
BEGIN
  SELECT prosrc INTO source FROM pg_proc
    WHERE oid='public.mcp_estimate_coverage_snapshot(uuid)'::regprocedure;
  SELECT prosrc INTO requirements FROM pg_proc WHERE oid='public.mcp_estimate_requirements_save(uuid,jsonb)'::regprocedure;
  SELECT prosrc INTO freeze_review FROM pg_proc WHERE oid='public.mcp_estimate_snapshot_review(uuid,uuid,bigint)'::regprocedure;
  SELECT prosrc INTO freeze_save FROM pg_proc WHERE oid='public.mcp_estimate_snapshot_save(uuid,uuid,boolean)'::regprocedure;
  IF md5(source) IS DISTINCT FROM '6e881a6a0b31eb36d8bec8605032c125'
    OR md5(requirements) IS DISTINCT FROM 'ffa7263c0a311974b403504ee6d174a7'
    OR md5(freeze_review) IS DISTINCT FROM 'bf0bf89fd6f87890748d50ef1e9ec19c'
    OR md5(freeze_save) IS DISTINCT FROM 'e60cefd6a9232ca0f99a35b4b5244b42'
    OR to_regclass('public.mcp_spec_documents') IS NULL
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='mcp_contract_documents' AND column_name='file_sha256')
    OR to_regprocedure('mcp_private.estimate_gc_requirements_cas_marker()') IS NULL THEN
    RAISE EXCEPTION 'Requirement source dependencies differ from the reviewed baseline. Reconcile before installation.';
  END IF;
END $$;

CREATE TABLE mcp_private.estimate_requirement_scan (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  source_sha256 text NOT NULL,
  source_version bigint NOT NULL,
  actor uuid NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  invalidated boolean NOT NULL DEFAULT false
);
REVOKE ALL ON mcp_private.estimate_requirement_scan FROM PUBLIC,anon,authenticated;

CREATE FUNCTION mcp_private.estimate_requirement_sources(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE body text; body_hash text; clauses jsonb; documents jsonb; manifest jsonb; setup_inputs jsonb;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  IF public.mcp_can_access_contract(_job) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'MCP_NO_JOB';
  END IF;
  -- The existing coverage reader already holds estimate_lock. The helper is
  -- private and cannot be called directly by an authenticated/anonymous role.
  SELECT d.body,encode(sha256(convert_to(d.body,'UTF8')),'hex') INTO body,body_hash
    FROM public.mcp_contract_documents d WHERE d.job_id=_job;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'section',c.section,'source',c.source,
    'text_sha256',encode(sha256(convert_to(c.verbatim_text,'UTF8')),'hex'),
    'current_document_body_sha256',body_hash,
    'matches_current_document',CASE WHEN body IS NULL THEN NULL ELSE
      length(public.mcp_clause_norm(c.verbatim_text))>0 AND
      position(public.mcp_clause_norm(c.verbatim_text) IN public.mcp_clause_norm(body))>0 END
  ) ORDER BY c.id),'[]') INTO clauses
    FROM public.mcp_contract_clauses c WHERE c.job_id=_job;
  SELECT coalesce(jsonb_agg(q.provenance ORDER BY q.kind,q.id),'[]') INTO documents FROM (
    SELECT 'contract' AS kind,d.id,
      jsonb_build_object('kind','contract','id',d.id,
        'body_sha256',encode(sha256(convert_to(d.body,'UTF8')),'hex'),
        'declared_body_sha256',d.body_sha256,
        'declared_file_sha256',d.file_sha256) AS provenance
      FROM public.mcp_contract_documents d WHERE d.job_id=_job
    UNION ALL
    SELECT 'spec',d.id,
      jsonb_build_object('kind','spec','id',d.id,
        'body_sha256',encode(sha256(convert_to(d.body,'UTF8')),'hex'),
        'declared_body_sha256',d.body_sha256,
        'declared_file_sha256',d.file_sha256)
      FROM public.mcp_spec_documents d WHERE d.job_id=_job
  ) q;
  SELECT jsonb_build_object('role',s.role,'documents',s.documents,'doc_review',s.doc_review)
    INTO setup_inputs FROM public.mcp_estimate_setup s WHERE s.job_id=_job;
  setup_inputs:=coalesce(setup_inputs,jsonb_build_object('role',NULL,'documents','[]'::jsonb,'doc_review',NULL));
  manifest:=jsonb_build_object('schema',1,'clauses',clauses,'documents',documents,
    'setup_input_sha256',encode(sha256(convert_to(setup_inputs::text,'UTF8')),'hex'));
  RETURN manifest||jsonb_build_object('sha256',encode(sha256(convert_to(manifest::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_requirement_sources(uuid) FROM PUBLIC,anon,authenticated;

-- Covers the canonical clause saver, contract/spec upload writer and existing
-- service-role direct writes without changing any caller's privileges.
CREATE FUNCTION mcp_private.estimate_requirement_source_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j uuid;
BEGIN
  j:=CASE WHEN TG_OP='DELETE' THEN OLD.job_id ELSE NEW.job_id END;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE id=j) THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN
    IF OLD.job_id::text<NEW.job_id::text THEN
      PERFORM mcp_private.estimate_lock(OLD.job_id); PERFORM mcp_private.estimate_lock(NEW.job_id);
    ELSE
      PERFORM mcp_private.estimate_lock(NEW.job_id); PERFORM mcp_private.estimate_lock(OLD.job_id);
    END IF;
    UPDATE mcp_private.estimate_revision SET version=version+1 WHERE job_id IN (OLD.job_id,NEW.job_id);
    RETURN NEW;
  END IF;
  PERFORM mcp_private.estimate_lock(j);
  UPDATE mcp_private.estimate_revision SET version=version+1 WHERE job_id=j;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_requirement_source_changed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER estimate_requirement_source_changed BEFORE INSERT OR UPDATE OR DELETE
  ON public.mcp_contract_clauses FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_requirement_source_changed();
CREATE TRIGGER estimate_requirement_source_changed BEFORE INSERT OR UPDATE OR DELETE
  ON public.mcp_contract_documents FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_requirement_source_changed();
CREATE TRIGGER estimate_requirement_source_changed BEFORE INSERT OR UPDATE OR DELETE
  ON public.mcp_spec_documents FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_requirement_source_changed();

-- Delegate preserves the reviewed row/CAS behavior. The public replacement
-- keeps its original identity/ACL and binds scan evidence under the same lock.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc
    WHERE oid='public.mcp_estimate_requirements_save(uuid,jsonb)'::regprocedure;
  EXECUTE replace(definition,'FUNCTION public.mcp_estimate_requirements_save(',
    'FUNCTION mcp_private.estimate_requirements_save_source_base(');
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_requirements_save_source_base(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_requirements_save(_job uuid,_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ver bigint; after_ver bigint; manifest jsonb; old_scan mcp_private.estimate_requirement_scan;
  changed boolean; result jsonb; refs jsonb; source_hash text;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  ver:=mcp_private.estimate_lock(_job);
  PERFORM public.mcp_estimate_guard(_job);
  IF jsonb_typeof(_items)='object' THEN
    manifest:=mcp_private.estimate_requirement_sources(_job); source_hash:=manifest->>'sha256';
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'documents') d WHERE d->>'body_sha256' IS DISTINCT FROM d->>'declared_body_sha256') OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'clauses') c WHERE c->>'source'='document' AND c->'matches_current_document' IS DISTINCT FROM 'true'::jsonb) THEN
      RAISE EXCEPTION 'MCP_BAD:Re-review saved document text and verified clauses against the current contract before scanning.';
    END IF;
    IF jsonb_typeof(_items->'source_sha256') IS DISTINCT FROM 'string' OR _items->>'source_sha256' IS DISTINCT FROM source_hash OR
      jsonb_typeof(_items->'items') IS DISTINCT FROM 'array' OR
      jsonb_typeof(_items->'reviewed_confirmations') IS DISTINCT FROM 'array' OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(_items->'reviewed_confirmations') r WHERE jsonb_typeof(r)<>'string') THEN
      RAISE EXCEPTION 'MCP_BAD:Read the current requirement sources and explicitly review confirmations before saving.';
    END IF;
    refs:=_items->'reviewed_confirmations';
    IF (SELECT count(*) FROM jsonb_array_elements(refs))<>(SELECT count(DISTINCT r) FROM jsonb_array_elements(refs) r) OR
      EXISTS(SELECT 1 FROM jsonb_array_elements_text(refs) ref WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(_items->'items') r WHERE r->>'ref'=ref AND (r->'confirmed'='true'::jsonb OR r->'excluded'='true'::jsonb))) THEN
      RAISE EXCEPTION 'MCP_BAD:Each explicit confirmation must identify one confirmed requirement.';
    END IF;
    SELECT * INTO old_scan FROM mcp_private.estimate_requirement_scan WHERE job_id=_job;
    changed:=NOT FOUND OR old_scan.invalidated OR old_scan.source_sha256 IS DISTINCT FROM source_hash;
    IF changed AND EXISTS(SELECT 1 FROM jsonb_array_elements(_items->'items') r
      WHERE (r->'confirmed'='true'::jsonb OR r->'excluded'='true'::jsonb) AND NOT refs ? (r->>'ref')) THEN
      RAISE EXCEPTION 'MCP_BAD:Requirement sources changed. Retain prices for review and explicitly reconfirm affected requirements.';
    END IF;
    IF changed AND EXISTS(SELECT 1 FROM public.mcp_estimate_requirements r
      WHERE r.job_id=_job AND r.active AND (r.confirmed OR r.excluded) AND
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(_items->'items') i WHERE i->>'ref'=r.ref)) THEN
      RAISE EXCEPTION 'MCP_BAD:Requirement sources changed. Include saved requirements and review their confirmations before saving.';
    END IF;
    result:=mcp_private.estimate_requirements_save_source_base(_job,_items);
    IF changed THEN
      INSERT INTO mcp_private.estimate_requirement_scan(job_id,source_sha256,source_version,actor)
        VALUES(_job,source_hash,ver,auth.uid()) ON CONFLICT(job_id) DO UPDATE SET
          source_sha256=excluded.source_sha256,source_version=excluded.source_version,
          actor=excluded.actor,scanned_at=clock_timestamp(),invalidated=false;
      UPDATE mcp_private.estimate_revision SET version=version+1 WHERE job_id=_job;
    END IF;
  ELSE
    result:=mcp_private.estimate_requirements_save_source_base(_job,_items);
    SELECT version INTO after_ver FROM mcp_private.estimate_revision WHERE job_id=_job;
    IF after_ver<>ver THEN UPDATE mcp_private.estimate_requirement_scan SET invalidated=true WHERE job_id=_job; END IF;
  END IF;
  SELECT version INTO after_ver FROM mcp_private.estimate_revision WHERE job_id=_job;
  RETURN result||jsonb_build_object('version',after_ver);
END $$;

-- Existing saved evidence remains readable. New freezes require a completed
-- current source scan; this is not a contract award or pricing attestation.
CREATE FUNCTION mcp_private.estimate_requirement_snapshot_current(_data jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT coalesce(_data->'capabilities'->'requirement_sources'='true'::jsonb AND
    _data->'requirement_scan'->'current'='true'::jsonb AND
    _data->'requirement_scan'->>'source_sha256'=_data->'requirement_sources'->>'sha256',false)
$$;
REVOKE ALL ON FUNCTION mcp_private.estimate_requirement_snapshot_current(jsonb) FROM PUBLIC,anon,authenticated;
DO $$
DECLARE original text; definition text; changed text;
BEGIN
  SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc
    WHERE oid='public.mcp_estimate_snapshot_review(uuid,uuid,bigint)'::regprocedure;
  changed:=replace(original,'data:=public.mcp_estimate_coverage_snapshot(_job);',
    'data:=public.mcp_estimate_coverage_snapshot(_job); IF NOT mcp_private.estimate_requirement_snapshot_current(data) THEN RAISE EXCEPTION ''MCP_BAD:Scan and review current requirement sources before freezing a new estimate.''; END IF;');
  IF changed IS NOT DISTINCT FROM original THEN RAISE EXCEPTION 'Unexpected source review shape.'; END IF;
  EXECUTE replace(definition,original,changed);
  SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc
    WHERE oid='public.mcp_estimate_snapshot_save(uuid,uuid,boolean)'::regprocedure;
  changed:=replace(original,'IF ver<>r.source_version THEN',
    'IF NOT mcp_private.estimate_requirement_snapshot_current(r.source_data) THEN RAISE EXCEPTION ''MCP_BAD:Scan and review current requirement sources before freezing a new estimate.''; END IF; IF ver<>r.source_version THEN');
  IF changed IS NOT DISTINCT FROM original THEN RAISE EXCEPTION 'Unexpected source save shape.'; END IF;
  EXECUTE replace(definition,original,changed);
END $$;

-- Activate the capability only after every dependency and freeze guard exists.
DO $$
DECLARE original text; definition text; changed text;
BEGIN
  SELECT prosrc,pg_get_functiondef(oid) INTO original,definition FROM pg_proc
    WHERE oid='public.mcp_estimate_coverage_snapshot(uuid)'::regprocedure;
  IF md5(original) IS DISTINCT FROM '6e881a6a0b31eb36d8bec8605032c125' THEN
    RAISE EXCEPTION 'Coverage reader drifted. Reconcile before enabling source capability.';
  END IF;
  changed:=replace(original,
    'DECLARE v bigint; selected mcp_private.estimate_quote_selection;',
    'DECLARE v bigint; selected mcp_private.estimate_quote_selection; requirement_sources jsonb;');
  changed:=replace(changed,'SELECT * INTO selected FROM mcp_private.estimate_quote_selection WHERE job_id=_job;',
    'requirement_sources:=mcp_private.estimate_requirement_sources(_job); SELECT * INTO selected FROM mcp_private.estimate_quote_selection WHERE job_id=_job;');
  changed:=replace(changed,
    'to_regprocedure(''mcp_private.estimate_gc_requirements_cas_marker()'') IS NOT NULL),',
    'to_regprocedure(''mcp_private.estimate_gc_requirements_cas_marker()'') IS NOT NULL,''requirement_sources'',true),''requirement_sources'',requirement_sources,''requirement_scan'',coalesce((SELECT jsonb_build_object(''source_sha256'',r.source_sha256,''source_version'',r.source_version,''current'',NOT r.invalidated AND r.source_sha256=requirement_sources->>''sha256'') FROM mcp_private.estimate_requirement_scan r WHERE r.job_id=_job),jsonb_build_object(''source_sha256'',NULL,''source_version'',NULL,''current'',false)),');
  IF changed IS NOT DISTINCT FROM original THEN
    RAISE EXCEPTION 'Coverage reader shape differs. Source protocol was not enabled.';
  END IF;
  -- pg_get_functiondef is CREATE OR REPLACE: existing OID, owner, ACL,
  -- volatility, search_path and before/after-lock source guards stay intact.
  EXECUTE replace(definition,original,changed);
END $$;

