-- Approval submittals stay on the submittal log, the hosted submittal page, and the board.
-- RFI, RFC, and change-order rows stay on their own readers. The shared transmittal
-- sequence is unchanged. Apply after the request and change-order package migrations.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE definition text; revised text;
BEGIN
  definition := pg_get_functiondef('public.mcp_submittal_rows_before_packages(uuid)'::regprocedure);
  revised := replace(definition,
    'WHERE sub.job_id = _job',
    'WHERE sub.job_id = _job AND sub.package_purpose = ''approval''');
  IF revised = definition THEN RAISE EXCEPTION 'Submittal log reader changed; review the approval filter.'; END IF;
  EXECUTE revised;
END $patch$;

-- Hosted submittal page freshness counts approval rows and their packages only.
-- The job-wide transmittal count stays, so the shared T-number sequence is not rewritten.
DO $patch$
DECLARE definition text; revised text;
BEGIN
  definition := pg_get_functiondef('public.mcp_report_page_stamp(text,uuid,uuid)'::regprocedure);
  revised := replace(definition,
    'FROM public.mcp_submittals WHERE job_id = _job',
    'FROM public.mcp_submittals WHERE job_id = _job AND package_purpose = ''approval''');
  IF revised = definition THEN RAISE EXCEPTION 'Submittal page stamp changed; review the approval count.'; END IF;
  definition := revised;
  revised := replace(definition,
    'FROM public.mcp_submittal_package_items WHERE job_id = _job',
    'FROM public.mcp_submittal_package_items p WHERE p.job_id = _job AND EXISTS (SELECT 1 FROM public.mcp_submittals s WHERE s.id = p.submittal_id AND s.package_purpose = ''approval'')');
  IF revised = definition THEN RAISE EXCEPTION 'Submittal piece stamp changed; review the approval count.'; END IF;
  definition := revised;
  revised := replace(definition,
    'FROM public.mcp_submittal_packages WHERE job_id = _job',
    'FROM public.mcp_submittal_packages p WHERE p.job_id = _job AND EXISTS (SELECT 1 FROM public.mcp_submittals s WHERE s.id = p.submittal_id AND s.package_purpose = ''approval'')');
  IF revised = definition THEN RAISE EXCEPTION 'Submittal package stamp changed; review the approval count.'; END IF;
  EXECUTE revised;
END $patch$;

-- Spec-section and required-piece guards already exempt RFI and RFC. A PCO uses the same exemption.
-- The short list is not a prefix of the longer one, so a guard that already names change_order is left as written.
DO $patch$
DECLARE r record; definition text; revised text;
  old text := 'NOT IN (''rfi'',''rfc'')';
  new text := 'NOT IN (''rfi'',''rfc'',''change_order'')';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS routine
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('mcp_submittal_spec_required', 'mcp_submittal_package_write', 'mcp_submittal_delivery')
  LOOP
    definition := pg_get_functiondef(r.routine);
    IF position(old IN definition) = 0 THEN CONTINUE; END IF;
    revised := replace(definition, old, new);
    IF revised = definition THEN RAISE EXCEPTION 'Spec or required-piece guard changed in %', r.routine; END IF;
    EXECUTE revised;
  END LOOP;
END $patch$;
