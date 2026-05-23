-- 1) Atomic replace of a schedule's tasks + dependencies inside a single
--    transaction (server function previously did delete-then-insert with no
--    rollback — a failed insert could wipe activities).
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
GRANT EXECUTE ON FUNCTION public.replace_schedule_graph(uuid, jsonb, jsonb) TO authenticated, service_role;

-- 2) Bring schedule_baselines RLS in line with other scheduler tables
--    (members + admin, not just the owner).
DROP POLICY IF EXISTS "own schedule baselines all" ON public.schedule_baselines;
CREATE POLICY "members manage schedule baselines"
  ON public.schedule_baselines
  FOR ALL
  USING (public.is_schedule_member(schedule_id, auth.uid()))
  WITH CHECK (public.is_schedule_member(schedule_id, auth.uid()));
