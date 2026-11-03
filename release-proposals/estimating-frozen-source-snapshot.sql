-- LOCAL PROPOSAL ONLY. Requires estimating-quote-coverage.sql and the reader
-- volatility correction. Three new authenticated EXECUTE grants below require
-- specific authorization/security review before any Lovable migration.
-- This captures source facts, not a certified bid or authorization to post.
CREATE TABLE mcp_private.estimate_snapshot_review (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor uuid NOT NULL,
  source_version bigint NOT NULL,
  source_data jsonb NOT NULL,
  source_sha256 text NOT NULL,
  saved_id uuid,
  PRIMARY KEY(job_id, request_id)
);
CREATE TABLE mcp_private.estimate_source_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor uuid NOT NULL,
  source_version bigint NOT NULL,
  source_data jsonb NOT NULL,
  source_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(job_id,request_id)
);
REVOKE ALL ON mcp_private.estimate_snapshot_review, mcp_private.estimate_source_snapshot FROM PUBLIC, anon, authenticated;

CREATE FUNCTION mcp_private.estimate_source_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  -- A project deletion retains the existing cascade semantics.
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.mcp_jobs WHERE id=OLD.job_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MCP_BAD:Saved source snapshots cannot be changed.';
END $$;
REVOKE ALL ON FUNCTION mcp_private.estimate_source_snapshot_immutable() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER estimate_source_snapshot_immutable BEFORE UPDATE OR DELETE ON mcp_private.estimate_source_snapshot
FOR EACH ROW EXECUTE FUNCTION mcp_private.estimate_source_snapshot_immutable();

CREATE FUNCTION public.mcp_estimate_snapshot_review(_job uuid,_request uuid,_expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cid uuid; ver bigint; r mcp_private.estimate_snapshot_review; data jsonb; hash text; quotes jsonb;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  IF _request IS NULL OR _expected_version IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Choose a request and current estimate version.'; END IF;
  ver:=mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  SELECT * INTO r FROM mcp_private.estimate_snapshot_review WHERE job_id=_job AND request_id=_request;
  IF FOUND THEN
    IF r.actor IS DISTINCT FROM auth.uid() OR r.company_id IS DISTINCT FROM cid OR r.source_version<>_expected_version THEN
      RAISE EXCEPTION 'MCP_BAD:This request identifies a different review.';
    END IF;
    RETURN jsonb_build_object('status',CASE WHEN r.saved_id IS NULL THEN 'review' ELSE 'saved' END,'request',_request,'snapshot_id',r.saved_id,'source_version',r.source_version,'current',r.source_version=ver,'sha256',r.source_sha256,'snapshot',r.source_data);
  END IF;
  IF ver<>_expected_version THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh before reviewing.'; END IF;
  data:=public.mcp_estimate_coverage_snapshot(_job);
  quotes:=coalesce(data->'bid'->'pricing'->'quotes','[]'::jsonb);
  IF jsonb_typeof(quotes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'MCP_BAD:Saved quotes need review.'; END IF;
  IF jsonb_array_length(quotes)>0 AND coalesce((data->'selection'->>'current')::boolean,false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'MCP_BAD:Review current quote coverage first.';
  END IF;
  hash:=encode(sha256(convert_to(data::text,'UTF8')),'hex');
  INSERT INTO mcp_private.estimate_snapshot_review(job_id,company_id,request_id,actor,source_version,source_data,source_sha256)
    VALUES(_job,cid,_request,auth.uid(),ver,data,hash);
  RETURN jsonb_build_object('status','review','request',_request,'snapshot_id',NULL,'source_version',ver,'current',true,'sha256',hash,'snapshot',data);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_snapshot_review(uuid,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_snapshot_review(uuid,uuid,bigint) TO authenticated;

CREATE FUNCTION public.mcp_estimate_snapshot_save(_job uuid,_request uuid,_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cid uuid; ver bigint; r mcp_private.estimate_snapshot_review; saved_snapshot uuid;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  IF _confirmed IS DISTINCT FROM true OR auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Confirm the reviewed source snapshot first.'; END IF;
  ver:=mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  SELECT * INTO r FROM mcp_private.estimate_snapshot_review WHERE job_id=_job AND request_id=_request;
  IF NOT FOUND OR r.actor IS DISTINCT FROM auth.uid() OR r.company_id IS DISTINCT FROM cid THEN RAISE EXCEPTION 'MCP_BAD:Review this source snapshot first.'; END IF;
  IF r.saved_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','saved','request',_request,'snapshot_id',r.saved_id,'source_version',r.source_version,'current',r.source_version=ver,'sha256',r.source_sha256);
  END IF;
  IF ver<>r.source_version THEN RAISE EXCEPTION 'MCP_BAD:Estimate changed. Refresh and review again.'; END IF;
  INSERT INTO mcp_private.estimate_source_snapshot(job_id,company_id,request_id,actor,source_version,source_data,source_sha256)
    VALUES(_job,cid,_request,r.actor,r.source_version,r.source_data,r.source_sha256) RETURNING id INTO saved_snapshot;
  UPDATE mcp_private.estimate_snapshot_review SET saved_id=saved_snapshot WHERE job_id=_job AND request_id=_request;
  RETURN jsonb_build_object('status','saved','request',_request,'snapshot_id',saved_snapshot,'source_version',r.source_version,'current',true,'sha256',r.source_sha256);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_snapshot_save(uuid,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_snapshot_save(uuid,uuid,boolean) TO authenticated;

CREATE FUNCTION public.mcp_estimate_snapshot_read(_job uuid,_snapshot uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cid uuid; ver bigint; s mcp_private.estimate_source_snapshot;
BEGIN
  cid:=public.mcp_estimate_guard(_job);
  ver:=mcp_private.estimate_lock(_job);
  cid:=public.mcp_estimate_guard(_job);
  SELECT * INTO s FROM mcp_private.estimate_source_snapshot WHERE job_id=_job AND id=_snapshot AND company_id=cid;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Source snapshot not found for this job.'; END IF;
  RETURN jsonb_build_object('snapshot_id',s.id,'source_version',s.source_version,'current',s.source_version=ver,'sha256',s.source_sha256,'snapshot',s.source_data,'saved_by',s.actor,'created_at',s.created_at);
END $$;
REVOKE ALL ON FUNCTION public.mcp_estimate_snapshot_read(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_snapshot_read(uuid,uuid) TO authenticated;
