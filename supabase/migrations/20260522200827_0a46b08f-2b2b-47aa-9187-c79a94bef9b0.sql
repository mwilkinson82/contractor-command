-- Calendar config on schedules
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS work_days smallint NOT NULL DEFAULT 31, -- bitmask Mon=1,Tue=2,Wed=4,Thu=8,Fri=16,Sat=32,Sun=64; default 1+2+4+8+16=31 (Mon-Fri)
  ADD COLUMN IF NOT EXISTS holidays jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Baselines
CREATE TABLE IF NOT EXISTS public.schedule_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  project_start_date date,
  work_days smallint NOT NULL DEFAULT 31,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_baselines_schedule_id
  ON public.schedule_baselines(schedule_id);

ALTER TABLE public.schedule_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manages schedule baselines"
ON public.schedule_baselines FOR ALL
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "own schedule baselines all"
ON public.schedule_baselines FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.schedules s
  WHERE s.id = schedule_baselines.schedule_id AND s.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.schedules s
  WHERE s.id = schedule_baselines.schedule_id AND s.user_id = auth.uid()
));

CREATE TRIGGER trg_schedule_baselines_updated_at
BEFORE UPDATE ON public.schedule_baselines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();