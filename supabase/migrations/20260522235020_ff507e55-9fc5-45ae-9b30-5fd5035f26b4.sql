
CREATE TABLE public.schedule_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  name text NOT NULL,
  work_days smallint NOT NULL DEFAULT 31,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_calendars_schedule ON public.schedule_calendars(schedule_id);

-- Only one default per schedule
CREATE UNIQUE INDEX idx_schedule_calendars_default
  ON public.schedule_calendars(schedule_id)
  WHERE is_default;

ALTER TABLE public.schedule_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manages schedule calendars"
  ON public.schedule_calendars FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "members manage schedule calendars"
  ON public.schedule_calendars FOR ALL
  USING (is_schedule_member(schedule_id, auth.uid()))
  WITH CHECK (is_schedule_member(schedule_id, auth.uid()));

CREATE TRIGGER update_schedule_calendars_updated_at
  BEFORE UPDATE ON public.schedule_calendars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-activity calendar assignment (null = use project default)
ALTER TABLE public.schedule_tasks
  ADD COLUMN calendar_id uuid;

-- Backfill: one default calendar per existing schedule from its current settings
INSERT INTO public.schedule_calendars (schedule_id, name, work_days, holidays, is_default, position)
SELECT id, 'Standard', work_days, holidays, true, 0
FROM public.schedules;
