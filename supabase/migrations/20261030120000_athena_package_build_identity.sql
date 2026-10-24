-- STAGED ONLY: apply through the existing Lovable Cloud release after approval.
-- Keep immutable PDFs and receipt history. A build reserves a number; only a successful
-- save changes the current package, so a failed download/render/upload cannot supersede it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_transmittals
  ADD COLUMN package_submittal_id uuid REFERENCES public.mcp_submittals(id),
  ADD COLUMN package_fingerprint text;
ALTER TABLE public.mcp_submittal_packages
  ADD COLUMN transmittal_id uuid REFERENCES public.mcp_transmittals(id);

-- Recover only the number actually printed by the old builder. Never renumber or rewrite
-- historical PDFs, and never guess an older package's number from today's submittal row.
UPDATE public.mcp_submittal_packages p SET transmittal_id = t.id
FROM public.mcp_transmittals t
WHERE t.job_id = p.job_id
  AND t.number::text = substring(p.filename FROM '-R[0-9]+-T([0-9]+)-[0-9]{4}-[0-9]{2}-[0-9]{2}\.pdf$');

CREATE FUNCTION public.mcp_submittal_package_reserve(_job uuid, _submittal uuid, _fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ctx jsonb; s public.mcp_submittals; j public.mcp_jobs; t public.mcp_transmittals; tid uuid; n int;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_job_scope(_job),'none') <> 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Full job access is required.';
  END IF;
  PERFORM 1 FROM public.mcp_jobs WHERE id = _job FOR UPDATE;
  ctx := public.mcp_submittal_package_context(_job, _submittal);
  IF (ctx->>'is_current')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'MCP_BAD:Use the latest revision from the living log.';
  END IF;
  IF _fingerprint IS DISTINCT FROM ctx->>'fingerprint' THEN
    RAISE EXCEPTION 'MCP_BAD:The package changed; read it again before building.';
  END IF;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = _submittal;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT * INTO t FROM public.mcp_transmittals WHERE id = s.transmittal_id;
  -- The first build may use the number allocated when the submittal was created.
  -- Any further reservation, including concurrent rebuilds, takes a fresh job-wide number.
  IF t.package_submittal_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.mcp_submittal_packages WHERE submittal_id = s.id
  ) THEN
    tid := t.id; n := t.number;
    UPDATE public.mcp_transmittals SET package_submittal_id = s.id,
      package_fingerprint = _fingerprint WHERE id = tid;
  ELSE
    SELECT coalesce(max(number),0)+1 INTO n FROM public.mcp_transmittals WHERE job_id = _job;
    INSERT INTO public.mcp_transmittals(company_id,job_id,number,to_name,to_email,subject,cover_note,
      package_submittal_id,package_fingerprint)
    VALUES(j.company_id,_job,n,t.to_name,t.to_email,t.subject,t.cover_note,s.id,_fingerprint)
    RETURNING id INTO tid;
  END IF;
  RETURN ctx || jsonb_build_object('build_transmittal_id',tid,'transmittal_number',n);
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_package_reserve(uuid,uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_package_reserve(uuid,uuid,text) TO authenticated;

-- Keep the existing writer and its source-storage, access, link, date and receipt checks.
-- Guard every patch so an unexpected live definition rolls the entire migration back.
DO $patch$
DECLARE definition text; revised text; old text; replacement text;
BEGIN
  definition := pg_get_functiondef('public.mcp_submittal_package_write(uuid,uuid,text,jsonb)'::regprocedure);
  old := 'artifact public.mcp_submittal_packages;';
  replacement := 'artifact public.mcp_submittal_packages; build_transmittal public.mcp_transmittals; expected_filename text;';
  revised := replace(definition,old,replacement);
  IF revised = definition THEN RAISE EXCEPTION 'Package writer declaration changed'; END IF;
  definition := revised;
  old := $old$ELSIF _action='save' THEN$old$;
  replacement := $new$ELSIF _action='save' THEN
  IF _p->>'fingerprint' IS DISTINCT FROM ctx->>'fingerprint' THEN
    RAISE EXCEPTION 'MCP_BAD:The package changed while building; build it again.';
  END IF;
  IF nullif(_p->>'transmittal_id','') IS NULL THEN
    -- Keep the deployed first-build path working during Cloud migration -> publication.
    -- An old builder cannot assign a new number to an already-rendered rebuild PDF.
    IF EXISTS (SELECT 1 FROM public.mcp_submittal_packages WHERE submittal_id = s.id) THEN
      RAISE EXCEPTION 'MCP_BAD:Refresh Athena tools and rebuild with the updated package builder.';
    END IF;
    UPDATE public.mcp_transmittals SET package_submittal_id = s.id,
      package_fingerprint = ctx->>'fingerprint' WHERE id = s.transmittal_id;
    SELECT * INTO build_transmittal FROM public.mcp_transmittals WHERE id = s.transmittal_id;
  ELSE
    SELECT * INTO build_transmittal FROM public.mcp_transmittals
      WHERE id = nullif(_p->>'transmittal_id','')::uuid AND job_id = _job
        AND company_id = j.company_id AND package_submittal_id = s.id;
  END IF;
  IF build_transmittal.id IS NULL OR build_transmittal.package_fingerprint IS DISTINCT FROM ctx->>'fingerprint'
     OR EXISTS (SELECT 1 FROM public.mcp_submittal_packages WHERE transmittal_id = build_transmittal.id) THEN
    RAISE EXCEPTION 'MCP_BAD:Reserve a fresh package transmittal before building.';
  END IF;
  expected_filename := 'Submittal-' || regexp_replace(s.number,'[^A-Za-z0-9-]','-','g')
    || '-R' || s.revision::text || '-T' || build_transmittal.number::text || '-' || (ctx->>'today') || '.pdf';
  IF _p->>'filename' IS DISTINCT FROM expected_filename THEN
    RAISE EXCEPTION 'MCP_BAD:The filename must match this package transmittal.';
  END IF;
  UPDATE public.mcp_submittals SET transmittal_id = build_transmittal.id, updated_at = now() WHERE id = s.id;
  ctx := public.mcp_submittal_package_context(_job,s.id);
  _p := jsonb_set(_p,'{fingerprint}',ctx->'fingerprint');$new$;
  revised := replace(definition,old,replacement);
  IF revised = definition THEN RAISE EXCEPTION 'Package save branch changed'; END IF;
  definition := revised;
  revised := replace(definition,
    'INSERT INTO public.mcp_submittal_packages(id,company_id,job_id,submittal_id,fingerprint,',
    'INSERT INTO public.mcp_submittal_packages(id,company_id,job_id,submittal_id,transmittal_id,fingerprint,');
  IF revised = definition THEN RAISE EXCEPTION 'Package insert columns changed'; END IF;
  definition := revised;
  revised := replace(definition,
    $old$VALUES(pid,j.company_id,_job,s.id,ctx->>'fingerprint',$old$,
    $new$VALUES(pid,j.company_id,_job,s.id,build_transmittal.id,ctx->>'fingerprint',$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Package insert values changed'; END IF;
  EXECUTE revised;
END $patch$;

DO $patch$
DECLARE definition text; revised text;
BEGIN
  definition := pg_get_functiondef('public.mcp_submittal_record_get(uuid,text)'::regprocedure);
  revised := replace(definition,
    $old$'id', p.id, 'submittal_id', p.submittal_id, 'revision', s.revision, 'filename', p.filename, 'path', p.path,$old$,
    $new$'id', p.id, 'submittal_id', p.submittal_id, 'revision', s.revision, 'filename', p.filename, 'path', p.path,
      'transmittal_id', p.transmittal_id,
      'transmittal_number', (SELECT number FROM public.mcp_transmittals WHERE id = p.transmittal_id),
      'is_current', p.submittal_id = cur.id AND p.fingerprint =
        (public.mcp_submittal_package_context(_job,cur.id)->>'fingerprint'),$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Package record fields changed'; END IF;
  definition := revised;
  revised := replace(definition,
    'FROM public.mcp_transmittals t JOIN public.mcp_submittals s ON s.transmittal_id = t.id',
    'FROM public.mcp_transmittals t JOIN public.mcp_submittals s ON s.transmittal_id = t.id OR EXISTS (SELECT 1 FROM public.mcp_submittal_packages p WHERE p.submittal_id = s.id AND p.transmittal_id = t.id)');
  IF revised = definition THEN RAISE EXCEPTION 'Record transmittal history changed'; END IF;
  EXECUTE revised;
END $patch$;

-- The live log link must show the same current package as the chat log, rather than
-- dropping back to the original rows-only page. The existing rows/context gates stay in place.
CREATE OR REPLACE FUNCTION public.mcp_submittal_page(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE payload jsonb; row jsonb; ctx jsonb; artifact jsonb; rows jsonb := '[]'::jsonb;
BEGIN
  payload := public.mcp_submittal_rows(_job);
  FOR row IN SELECT value FROM jsonb_array_elements(payload->'submittals') LOOP
    ctx := public.mcp_submittal_package_context(_job,(row->>'id')::uuid);
    artifact := ctx->'package';
    IF artifact->>'revoked_at' IS NOT NULL THEN artifact := NULL; END IF;
    rows := rows || jsonb_build_array(row || jsonb_build_object(
      'has_package', EXISTS(SELECT 1 FROM public.mcp_submittal_packages WHERE submittal_id = (row->>'id')::uuid),
      'built_package', CASE WHEN artifact->>'id' IS NOT NULL THEN jsonb_build_object(
        'id',artifact->>'id','filename',artifact->>'filename','page_count',artifact->'page_count',
        'cover_date',artifact->>'cover_date','sent_at',artifact->>'sent_at') END,
      'submission_sent_at', CASE WHEN artifact->>'id' IS NOT NULL THEN artifact->>'sent_at'
        ELSE (SELECT max(sent_at)::text FROM public.mcp_submittal_packages WHERE submittal_id = (row->>'id')::uuid) END));
  END LOOP;
  RETURN payload || jsonb_build_object('page','submittals','job_id',_job,'submittals',rows);
END $$;

DO $patch$
DECLARE definition text; revised text; marker text;
BEGIN
  definition := pg_get_functiondef('public.mcp_report_page_stamp(text,uuid,uuid)'::regprocedure);
  marker := $old$|| '|' || coalesce((SELECT count(*)::text FROM public.mcp_transmittals WHERE job_id = _job), '0')$old$;
  revised := replace(definition,marker,marker || $new$
      || '|' || coalesce((SELECT count(*)::text || '|' || coalesce(max(sent_at)::text,'') || '|' || coalesce(max(revoked_at)::text,'') FROM public.mcp_submittal_packages WHERE job_id = _job),'0')$new$);
  IF revised = definition THEN RAISE EXCEPTION 'Submittal log stamp changed'; END IF;
  EXECUTE revised;
END $patch$;
COMMIT;
