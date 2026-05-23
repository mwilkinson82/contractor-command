
ALTER TABLE public.schedule_calendars
  ADD CONSTRAINT schedule_calendars_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_tasks
  ADD CONSTRAINT schedule_tasks_calendar_id_fkey
  FOREIGN KEY (calendar_id) REFERENCES public.schedule_calendars(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_calendars_one_default_per_schedule
  ON public.schedule_calendars(schedule_id) WHERE is_default;

CREATE OR REPLACE FUNCTION public.ensure_default_calendar(_schedule_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_work smallint;
  v_holidays jsonb;
BEGIN
  SELECT id INTO v_id FROM public.schedule_calendars
    WHERE schedule_id = _schedule_id AND is_default
    LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT work_days, holidays INTO v_work, v_holidays
    FROM public.schedules WHERE id = _schedule_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.schedule_calendars
    (schedule_id, name, work_days, holidays, is_default, position)
  VALUES
    (_schedule_id, 'Project default', COALESCE(v_work, 31::smallint),
     COALESCE(v_holidays, '[]'::jsonb), true, 0)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.id FROM public.schedules s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.schedule_calendars c
      WHERE c.schedule_id = s.id AND c.is_default
    )
  LOOP
    PERFORM public.ensure_default_calendar(r.id);
  END LOOP;
END $$;
