-- Once a job has a numeric official SOV, line dollars cannot move except through
-- change-order execution, which already requires an approved change order.
-- A draft copy is a separate module and is not checked here.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_job_facts DROP CONSTRAINT mcp_job_facts_module_check;
ALTER TABLE public.mcp_job_facts ADD CONSTRAINT mcp_job_facts_module_check
  CHECK (module IN ('scope','contract','handoff','budget','sov','sov_draft','warranty'));

CREATE OR REPLACE FUNCTION public.mcp_assert_sov_total(_job uuid, _facts jsonb, _fee numeric) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_fee numeric;
  next_fee numeric;
  old_any boolean := false;
  line_changed boolean := false;
  old_base bigint := 0;
  old_change bigint := 0;
  new_base bigint := 0;
  new_change bigint := 0;
  old_contract bigint;
  new_contract bigint;
BEGIN
  SELECT sov_fee_pct INTO current_fee FROM public.mcp_jobs WHERE id = _job;
  next_fee := coalesce(_fee, current_fee);

  WITH existing AS (
    SELECT key, value FROM public.mcp_job_facts WHERE job_id = _job AND module = 'sov'
  ), incoming AS (
    SELECT f.key,
      CASE
        WHEN f.value IS NULL OR f.value = 'null'::jsonb OR f.value = '"unknown"'::jsonb OR f.value = '""'::jsonb OR f.value = '"na"'::jsonb THEN NULL
        ELSE f.value
      END AS value
    FROM jsonb_each(coalesce(_facts, '{}'::jsonb)) f
    WHERE _facts IS NOT NULL AND length(f.key) <= 120
  ), merged AS (
    SELECT e.key, CASE WHEN _facts IS NULL OR length(e.key) > 120 OR NOT (_facts ? e.key) THEN e.value ELSE i.value END AS value
    FROM existing e
    LEFT JOIN incoming i ON i.key = e.key
    UNION ALL
    SELECT i.key, i.value FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.key = i.key)
  ),   old_cents AS (
    SELECT key,
      CASE WHEN value IS NOT NULL AND jsonb_typeof(value) = 'object' AND jsonb_typeof(value->'billable_value') = 'number'
        THEN round((value->>'billable_value')::numeric * 100)::bigint END AS amount,
      value IS NOT NULL AND jsonb_typeof(value) = 'object' AND value ? 'executed_change_order'
        AND coalesce((value->>'fee_included')::boolean, false) AS is_change
    FROM existing
  ), new_cents AS (
    SELECT key,
      CASE WHEN value IS NOT NULL AND jsonb_typeof(value) = 'object' AND jsonb_typeof(value->'billable_value') = 'number'
        THEN round((value->>'billable_value')::numeric * 100)::bigint END AS amount,
      value IS NOT NULL AND jsonb_typeof(value) = 'object' AND value ? 'executed_change_order'
        AND coalesce((value->>'fee_included')::boolean, false) AS is_change
    FROM merged
  ), compared AS (
    SELECT coalesce(o.key, n.key) AS key, o.amount AS old_amount, n.amount AS new_amount
    FROM old_cents o FULL OUTER JOIN new_cents n ON n.key = o.key
  )
  SELECT
    EXISTS (SELECT 1 FROM old_cents WHERE amount IS NOT NULL),
    EXISTS (SELECT 1 FROM compared WHERE old_amount IS DISTINCT FROM new_amount),
    coalesce((SELECT sum(amount) FROM old_cents WHERE amount IS NOT NULL AND NOT is_change), 0),
    coalesce((SELECT sum(amount) FROM old_cents WHERE amount IS NOT NULL AND is_change), 0),
    coalesce((SELECT sum(amount) FROM new_cents WHERE amount IS NOT NULL AND NOT is_change), 0),
    coalesce((SELECT sum(amount) FROM new_cents WHERE amount IS NOT NULL AND is_change), 0)
  INTO old_any, line_changed, old_base, old_change, new_base, new_change;

  IF NOT old_any THEN RETURN; END IF;
  IF current_fee IS NOT NULL AND current_fee >= 0 AND current_fee < 100 THEN
    old_contract := round(old_base / (1 - current_fee / 100))::bigint + old_change;
  END IF;
  IF next_fee IS NOT NULL AND next_fee >= 0 AND next_fee < 100 THEN
    new_contract := round(new_base / (1 - next_fee / 100))::bigint + new_change;
  END IF;
  IF line_changed OR (old_contract IS NOT NULL AND new_contract IS DISTINCT FROM old_contract) THEN
    RAISE EXCEPTION 'MCP_BAD:SOV changes only by approved change order. Nothing was saved.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mcp_set_facts(_job uuid, _module text, _facts jsonb, _source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE k text; v jsonb; st text; known text[] := '{}'; unk text[] := '{}'; sc text;
BEGIN
  sc := public.mcp_assert_job_scope(_job);
  IF _module NOT IN ('scope','contract','handoff','budget','sov','sov_draft','warranty') THEN RAISE EXCEPTION 'MCP_BAD:bad module'; END IF;
  IF sc = 'contract' AND _module <> 'contract' THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF _source NOT IN ('document','member_answer','company_default') THEN RAISE EXCEPTION 'MCP_BAD:bad source'; END IF;
  IF _module = 'sov' THEN PERFORM public.mcp_assert_sov_total(_job, _facts, NULL); END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(_facts, '{}'::jsonb)) LOOP
    IF length(k) > 120 THEN CONTINUE; END IF;
    st := CASE WHEN v IS NULL OR v = 'null'::jsonb OR v = '"unknown"'::jsonb OR v = '""'::jsonb THEN 'unknown'
               WHEN v = '"na"'::jsonb THEN 'na' ELSE 'known' END;
    INSERT INTO public.mcp_job_facts (job_id, module, key, value, status, source, internal_only)
      VALUES (_job, _module, k, CASE WHEN st = 'known' THEN v END, st, _source, _module IN ('budget','handoff'))
      ON CONFLICT (job_id, module, key) DO UPDATE SET value = EXCLUDED.value, status = EXCLUDED.status, source = EXCLUDED.source,
        internal_only = EXCLUDED.internal_only, updated_by = auth.uid(), updated_at = now();
    IF st = 'unknown' THEN unk := unk || k; ELSE known := known || k; END IF;
  END LOOP;
  PERFORM public.mcp_audit_job(_job, 'intake', 'facts_' || _module, NULL);
  RETURN jsonb_build_object('known', to_jsonb(known), 'unknown', to_jsonb(unk));
END $function$;

COMMIT;
