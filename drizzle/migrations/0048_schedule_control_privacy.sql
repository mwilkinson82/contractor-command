-- LOCAL PROPOSAL ONLY. No managed ordinal is reserved and this has not run remotely.
-- Prerequisite: existing Athena living-report functions. Apply through the sole
-- controller's supported managed migration workflow before saving controlled
-- schedules with private event/source provenance. No table, row, role or grant changes.
-- Preserve function signature, volatility, owner and existing ACLs.
CREATE OR REPLACE FUNCTION public.mcp_living_strip_money(_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT (_data - 'billing' - 'ior' - 'kpis' - 'contract_total')
      || jsonb_build_object('activities', coalesce((
        SELECT jsonb_agg(a - 'value' - 'billable_value' ORDER BY ord)
        FROM jsonb_array_elements(coalesce(_data->'activities', '[]'::jsonb)) WITH ORDINALITY AS rows(a, ord)
      ), '[]'::jsonb)) AS data
  ), control AS (
    SELECT data, data->'schedule_control' AS sc FROM base
  ), public_control AS (
    SELECT data, CASE WHEN jsonb_typeof(sc) = 'object' THEN
      (sc - 'analysis' - 'baselines')
      || CASE WHEN jsonb_typeof(sc->'analysis') = 'object' THEN
        jsonb_build_object('analysis', (sc->'analysis')
          - 'description' - 'source_refs' - 'assumptions' - 'before_activities')
        ELSE '{}'::jsonb END
      || CASE WHEN jsonb_typeof(sc->'baselines') = 'array' THEN
        jsonb_build_object('baselines', coalesce((
          SELECT jsonb_agg((b - 'activities') || jsonb_build_object('activities', coalesce((
            SELECT jsonb_agg(a - 'value' - 'billable_value' - 'actual_cost' - 'budget_cost' ORDER BY activity_ord)
            FROM jsonb_array_elements(coalesce(b->'activities', '[]'::jsonb)) WITH ORDINALITY AS activities(a, activity_ord)
          ), '[]'::jsonb)) ORDER BY baseline_ord)
          FROM jsonb_array_elements(sc->'baselines') WITH ORDINALITY AS baselines(b, baseline_ord)
        ), '[]'::jsonb)) ELSE '{}'::jsonb END
      ELSE sc END AS sc
    FROM control
  )
  SELECT CASE WHEN jsonb_typeof(sc) = 'object'
    THEN data || jsonb_build_object('schedule_control', sc) ELSE data END
  FROM public_control
$$;
