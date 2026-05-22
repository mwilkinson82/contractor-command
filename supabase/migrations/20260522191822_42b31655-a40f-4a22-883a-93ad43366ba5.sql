-- Dependency type enum
CREATE TYPE public.scheduler_dep_type AS ENUM ('FS', 'SS', 'FF', 'SF');

-- Schedules
CREATE TABLE public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  project_start_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedules_user ON public.schedules(user_id);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own schedules all" ON public.schedules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin manages schedules" ON public.schedules
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_schedules_updated
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tasks (rows scoped to a schedule)
CREATE TABLE public.schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL, -- engine-facing id ("A100")
  name TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0 CHECK (duration >= 0),
  wbs TEXT,
  description TEXT,
  percent_complete NUMERIC(5,2) CHECK (percent_complete IS NULL OR (percent_complete >= 0 AND percent_complete <= 100)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, task_id)
);

CREATE INDEX idx_schedule_tasks_schedule ON public.schedule_tasks(schedule_id);

ALTER TABLE public.schedule_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own schedule tasks all" ON public.schedule_tasks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid())
  );

CREATE POLICY "admin manages schedule tasks" ON public.schedule_tasks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_schedule_tasks_updated
  BEFORE UPDATE ON public.schedule_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Dependencies
CREATE TABLE public.schedule_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  type public.scheduler_dep_type NOT NULL DEFAULT 'FS',
  lag INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_task_id <> to_task_id),
  UNIQUE (schedule_id, from_task_id, to_task_id, type)
);

CREATE INDEX idx_schedule_deps_schedule ON public.schedule_dependencies(schedule_id);

ALTER TABLE public.schedule_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own schedule deps all" ON public.schedule_dependencies
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id AND s.user_id = auth.uid())
  );

CREATE POLICY "admin manages schedule deps" ON public.schedule_dependencies
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_schedule_deps_updated
  BEFORE UPDATE ON public.schedule_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
