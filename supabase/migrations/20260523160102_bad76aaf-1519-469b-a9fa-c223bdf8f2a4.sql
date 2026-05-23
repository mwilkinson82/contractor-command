CREATE OR REPLACE FUNCTION public.ensure_default_calendar(_schedule_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_work smallint;
  v_holidays jsonb;
BEGIN
  -- Authorization: caller must be admin or a member/owner of this schedule.
  -- SECURITY DEFINER bypasses RLS, so we enforce access explicitly here.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.is_schedule_member(_schedule_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized for schedule %', _schedule_id USING ERRCODE = '42501';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.ensure_default_calendar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_calendar(uuid) TO authenticated;