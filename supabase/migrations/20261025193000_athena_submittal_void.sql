-- Void keeps the submittal row. Any status can be marked void. It is never deleted.
-- Who (auth.uid), when (the event time), and the reason stay on the project record.
-- A write requires confirmed true and a reason. The tool still asks yes or no first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'public.mcp_submittals'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%not_started%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%void%';
  IF cname IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      WHERE con.conrelid = 'public.mcp_submittals'::regclass
        AND pg_get_constraintdef(con.oid) LIKE '%''void''%'
    ) THEN
      RAISE EXCEPTION 'Submittal status check not found.';
    END IF;
  ELSE
    EXECUTE format('ALTER TABLE public.mcp_submittals DROP CONSTRAINT %I', cname);
    ALTER TABLE public.mcp_submittals
      ADD CONSTRAINT mcp_submittals_status_check
      CHECK (status IN (
        'not_started', 'in_prep', 'submitted', 'in_review', 'approved', 'approved_as_noted',
        'revise_and_resubmit', 'rejected', 'closed', 'void'
      ));
  END IF;
END $$;

DO $patch$
DECLARE definition text; revised text;
BEGIN
  definition := pg_get_functiondef('public.mcp_submittal_log(uuid,text,jsonb)'::regprocedure);
  revised := replace(definition,
    'IF _action NOT IN (''add'', ''update'', ''resubmit'', ''import'') THEN RAISE EXCEPTION ''MCP_BAD:Use add, update, resubmit, or import. Nothing was saved.''; END IF;',
    'IF _action NOT IN (''add'', ''update'', ''resubmit'', ''import'', ''void'') THEN RAISE EXCEPTION ''MCP_BAD:Use add, update, resubmit, import, or void. Nothing was saved.''; END IF;');
  IF revised = definition THEN RAISE EXCEPTION 'Submittal log actions changed; review the void action.'; END IF;
  definition := revised;
  revised := replace(definition,
    'IF _action = ''import'' THEN',
    $void$IF _action = 'void' THEN
    IF coalesce(_payload->>'confirmed', '') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'MCP_BAD:Confirm before voiding a submittal. Nothing was changed.'; END IF;
    reason := nullif(btrim(coalesce(_payload->>'reason', '')), '');
    IF reason IS NULL OR length(reason) < 3 OR length(reason) > 500 THEN RAISE EXCEPTION 'MCP_BAD:A reason is required. Nothing was changed.'; END IF;
    sid := nullif(_payload->>'submittal_id', '')::uuid;
    IF sid IS NOT NULL THEN
      SELECT * INTO cur FROM public.mcp_submittals WHERE id = sid AND job_id = _job;
    ELSE
      num := nullif(btrim(coalesce(_payload->>'number', '')), '');
      IF num IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Name the submittal. Nothing was changed.'; END IF;
      rev := nullif(_payload->>'revision', '')::int;
      SELECT * INTO cur FROM public.mcp_submittals
        WHERE job_id = _job AND lower(number) = lower(num) AND (rev IS NULL OR revision = rev)
        ORDER BY revision DESC, id DESC LIMIT 1;
    END IF;
    IF cur.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That submittal is not on this job. Nothing was changed.'; END IF;
    IF cur.status = 'void' THEN RAISE EXCEPTION 'MCP_BAD:That submittal is already void. Nothing was changed.'; END IF;
    UPDATE public.mcp_submittals SET status = 'void', updated_at = now() WHERE id = cur.id;
    PERFORM public.mcp_project_record_add(
      _job, 'submittal_voided',
      'Submittal ' || cur.number || ' revision ' || cur.revision::text,
      'Status Void. Reason: ' || reason || '.',
      cur.ball_in_court_name, NULL, 'mcp_submittals', cur.id,
      jsonb_build_object('number', cur.number, 'revision', cur.revision, 'status', 'void', 'prior_status', cur.status, 'reason', reason, 'voided_by', auth.uid()),
      'user');
    RETURN public.mcp_submittal_rows(_job) || jsonb_build_object('saved_id', cur.id, 'outcome', 'voided', 'status', 'void', 'reason', reason, 'number', cur.number, 'revision', cur.revision, 'title', cur.title);
  END IF;
  IF _action = 'import' THEN$void$);
  IF revised = definition THEN RAISE EXCEPTION 'Submittal log import marker changed; review the void action.'; END IF;
  EXECUTE revised;
END $patch$;

DO $patch$
DECLARE definition text; revised text;
BEGIN
  IF to_regprocedure('public.mcp_submittal_chase_rows(uuid)') IS NULL THEN
    RETURN;
  END IF;
  definition := pg_get_functiondef('public.mcp_submittal_chase_rows(uuid)'::regprocedure);
  IF position('status IS DISTINCT FROM ''void''' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position('WHERE job_id=_job ORDER BY lower(btrim(number)),revision DESC,id DESC' IN definition) > 0 THEN
    revised := replace(definition, 'WHERE job_id=_job ORDER BY lower(btrim(number)),revision DESC,id DESC', 'WHERE job_id=_job AND status IS DISTINCT FROM ''void'' ORDER BY lower(btrim(number)),revision DESC,id DESC');
  ELSIF position('WHERE job_id = _job' IN definition) > 0 THEN
    revised := replace(definition, 'WHERE job_id = _job', 'WHERE job_id = _job AND status IS DISTINCT FROM ''void''');
  ELSE
    RAISE EXCEPTION 'Chase reader changed; review the void filter.';
  END IF;
  IF revised = definition THEN RAISE EXCEPTION 'Chase reader changed; review the void filter.'; END IF;
  EXECUTE revised;
END $patch$;

COMMIT;
