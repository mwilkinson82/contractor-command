-- Harden the scheduler schema added during the CPM workbench build.
-- Keep this additive/idempotent because Lovable Cloud may already have applied
-- the preceding scheduler migrations. Constraints are added NOT VALID so any
-- experimental rows already in Cloud do not block deployment; new writes are
-- still checked.

DO $$
BEGIN
  ALTER TABLE public.schedules
    ADD CONSTRAINT schedules_work_days_valid CHECK (work_days BETWEEN 0 AND 127) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedules
    ADD CONSTRAINT schedules_holidays_is_array CHECK (jsonb_typeof(holidays) = 'array') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedules
    ADD CONSTRAINT schedules_annotations_is_array CHECK (jsonb_typeof(annotations) = 'array') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_tasks
    ADD CONSTRAINT schedule_tasks_budget_cost_nonnegative CHECK (budget_cost IS NULL OR budget_cost >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_tasks
    ADD CONSTRAINT schedule_tasks_actual_cost_nonnegative CHECK (actual_cost IS NULL OR actual_cost >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_tasks
    ADD CONSTRAINT schedule_tasks_resource_units_nonnegative CHECK (resource_units_per_day IS NULL OR resource_units_per_day >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_baselines
    ADD CONSTRAINT schedule_baselines_work_days_valid CHECK (work_days BETWEEN 0 AND 127) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_baselines
    ADD CONSTRAINT schedule_baselines_holidays_is_array CHECK (jsonb_typeof(holidays) = 'array') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_baselines
    ADD CONSTRAINT schedule_baselines_tasks_is_array CHECK (jsonb_typeof(tasks) = 'array') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_baselines
    ADD CONSTRAINT schedule_baselines_dependencies_is_array CHECK (jsonb_typeof(dependencies) = 'array') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.schedule_members
    ADD CONSTRAINT schedule_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- This helper is not currently used by the app or RLS policies. Avoid exposing
-- a public SECURITY DEFINER function as a callable API surface.
REVOKE EXECUTE ON FUNCTION public.is_schedule_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_schedule_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_schedule_member(uuid, uuid) FROM authenticated;
