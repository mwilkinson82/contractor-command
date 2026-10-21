-- STAGED — DO NOT RUN without Marshall's go. Reviewer demo: keep job 2701 (Harbor Point) dates current.
-- Idempotent: shifts every 2701 date by a whole number of weeks so the latest saved CPM data date lands on the
-- Monday of the current week. Run twice on the same week → second run shifts 0 days (no-op).
-- UPDATE only. No inserts, no deletes. Touches job 323a040a-7ed1-4726-8f6a-da13fdb5a0eb only.
-- Jobs 2799, 2801, 2803, 2804 are hard-excluded by the guard below.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.shift_iso(j jsonb, d int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN (SELECT coalesce(jsonb_object_agg(k, pg_temp.shift_iso(v, d)), '{}'::jsonb) FROM jsonb_each(j) e(k, v))
    WHEN 'array'  THEN (SELECT coalesce(jsonb_agg(pg_temp.shift_iso(v, d) ORDER BY i), '[]'::jsonb) FROM jsonb_array_elements(j) WITH ORDINALITY a(v, i))
    WHEN 'string' THEN CASE WHEN j #>> '{}' ~ '^\d{4}-\d{2}-\d{2}$' THEN to_jsonb(((j #>> '{}')::date + d)::text) ELSE j END
    ELSE j END
$$;

CREATE TEMP TABLE _s ON COMMIT DROP AS
SELECT j.id AS job_id,
       (((date_trunc('week', current_date)::date - max(r.data_date)) / 7) * 7)::int AS delta
  FROM public.mcp_jobs j JOIN public.mcp_living_reports r ON r.job_id = j.id
 WHERE j.id = '323a040a-7ed1-4726-8f6a-da13fdb5a0eb' AND j.job_number = '2701'
 GROUP BY j.id;

DO $$ BEGIN
  IF (SELECT count(*) FROM _s) <> 1 THEN RAISE EXCEPTION 'job 2701 anchor not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_jobs WHERE id = (SELECT job_id FROM _s) AND job_number IN ('2799','2801','2803','2804'))
    THEN RAISE EXCEPTION 'guard: protected job'; END IF;
  RAISE NOTICE 'shift days: %', (SELECT delta FROM _s);
END $$;

UPDATE public.mcp_jobs SET contract_completion_date = contract_completion_date + s.delta FROM _s s WHERE id = s.job_id AND s.delta <> 0;
UPDATE public.mcp_job_deadlines SET fixed_date = fixed_date + s.delta, trigger_date = trigger_date + s.delta FROM _s s WHERE job_id = s.job_id AND s.delta <> 0;
UPDATE public.mcp_delay_events SET start_date = start_date + s.delta FROM _s s WHERE job_id = s.job_id AND s.delta <> 0;
UPDATE public.mcp_lookaheads SET start_date = start_date + s.delta, end_date = end_date + s.delta FROM _s s WHERE job_id = s.job_id AND s.delta <> 0;
UPDATE public.mcp_lookahead_revisions lr SET start_date = lr.start_date + s.delta, end_date = lr.end_date + s.delta
  FROM _s s, public.mcp_lookaheads l WHERE lr.lookahead_id = l.id AND l.job_id = s.job_id AND s.delta <> 0;
UPDATE public.mcp_open_items SET needed_by = needed_by + s.delta, due_date = due_date + s.delta, waiting_since = waiting_since + s.delta
  FROM _s s WHERE job_id = s.job_id AND s.delta <> 0;
UPDATE public.mcp_living_reports SET data_date = data_date + s.delta, data = pg_temp.shift_iso(data, s.delta)
  FROM _s s WHERE job_id = s.job_id AND s.delta <> 0;

SELECT delta AS shifted_days FROM _s;
ROLLBACK;  -- dry run by default. Change to COMMIT only after Marshall says go.
