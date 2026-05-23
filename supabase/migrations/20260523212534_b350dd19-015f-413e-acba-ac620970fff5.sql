-- Phase 3.1 follow-up: repo cleanliness pass
--
-- 1) Restore EXECUTE on public.is_schedule_member to roles that need it.
--    A prior hardening migration (20260522230640_harden_scheduler_schema.sql)
--    revoked EXECUTE on this helper from authenticated. RLS policies on
--    schedule_baselines, schedule_calendars, activity_code_types,
--    activity_code_values, task_activity_codes, wbs_nodes, schedule_members
--    all call public.is_schedule_member(...) from a USING / WITH CHECK clause,
--    which requires the calling role (authenticated) to have EXECUTE on the
--    function. Without this grant, those policies effectively deny all access
--    to legitimate signed-in users.
--
--    is_schedule_member is SECURITY DEFINER, STABLE, and performs a single
--    bounded membership lookup, so granting EXECUTE to authenticated is safe.
REVOKE ALL ON FUNCTION public.is_schedule_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_schedule_member(uuid, uuid)
  TO authenticated, service_role;

-- 2) replace_schedule_graph: add calendar integrity guard.
--    Each task may have calendar_id = NULL, or a calendar_id that belongs to
--    the SAME schedule. A task referencing a calendar from a different
--    schedule must abort the entire replacement (transactional rollback).
CREATE OR REPLACE FUNCTION public.replace_schedule_graph(
  _schedule_id uuid,
  _tasks jsonb,
  _dependencies jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_ids text[];
  v_dep record;
  v_bad_calendar uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.is_schedule_member(_schedule_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized for schedule %', _schedule_id USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_tasks) <> 'array' OR jsonb_typeof(_dependencies) <> 'array' THEN
    RAISE EXCEPTION 'tasks and dependencies must be JSON arrays';
  END IF;

  -- Validate dep references inside the txn so a bad payload aborts everything.
  SELECT array_agg(t->>'task_id') INTO v_task_ids
  FROM jsonb_array_elements(_tasks) AS t;

  FOR v_dep IN SELECT * FROM jsonb_array_elements(_dependencies) AS d LOOP
    IF NOT ((v_dep.value->>'from_task_id') = ANY(v_task_ids))
       OR NOT ((v_dep.value->>'to_task_id') = ANY(v_task_ids)) THEN
      RAISE EXCEPTION 'Dependency references missing task: % -> %',
        v_dep.value->>'from_task_id', v_dep.value->>'to_task_id';
    END IF;
  END LOOP;

  -- Calendar integrity guard: each task.calendar_id (if not null) must point
  -- at a schedule_calendars row belonging to _schedule_id. A foreign calendar
  -- aborts the whole replace.
  SELECT NULLIF(t->>'calendar_id','')::uuid INTO v_bad_calendar
  FROM jsonb_array_elements(_tasks) AS t
  WHERE NULLIF(t->>'calendar_id','') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.schedule_calendars c
      WHERE c.id = NULLIF(t->>'calendar_id','')::uuid
        AND c.schedule_id = _schedule_id
    )
  LIMIT 1;

  IF v_bad_calendar IS NOT NULL THEN
    RAISE EXCEPTION
      'Task calendar_id % does not belong to schedule %',
      v_bad_calendar, _schedule_id
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.schedule_dependencies WHERE schedule_id = _schedule_id;
  DELETE FROM public.schedule_tasks WHERE schedule_id = _schedule_id;

  INSERT INTO public.schedule_tasks (
    schedule_id, task_id, name, duration, wbs, description, percent_complete,
    budget_cost, actual_cost, resource_name, resource_units_per_day,
    start_no_earlier_than, calendar_id, position
  )
  SELECT
    _schedule_id,
    t->>'task_id',
    t->>'name',
    COALESCE((t->>'duration')::int, 0),
    NULLIF(t->>'wbs',''),
    NULLIF(t->>'description',''),
    NULLIF(t->>'percent_complete','')::numeric,
    NULLIF(t->>'budget_cost','')::numeric,
    NULLIF(t->>'actual_cost','')::numeric,
    NULLIF(t->>'resource_name',''),
    NULLIF(t->>'resource_units_per_day','')::numeric,
    NULLIF(t->>'start_no_earlier_than','')::date,
    NULLIF(t->>'calendar_id','')::uuid,
    COALESCE((t->>'position')::int, 0)
  FROM jsonb_array_elements(_tasks) AS t;

  INSERT INTO public.schedule_dependencies (
    schedule_id, from_task_id, to_task_id, type, lag
  )
  SELECT
    _schedule_id,
    d->>'from_task_id',
    d->>'to_task_id',
    COALESCE((d->>'type')::public.scheduler_dep_type, 'FS'::public.scheduler_dep_type),
    COALESCE((d->>'lag')::int, 0)
  FROM jsonb_array_elements(_dependencies) AS d;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_schedule_graph(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_schedule_graph(uuid, jsonb, jsonb)
  TO authenticated, service_role;