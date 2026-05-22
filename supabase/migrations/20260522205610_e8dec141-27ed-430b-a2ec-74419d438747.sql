ALTER TABLE public.schedule_tasks
  ADD COLUMN IF NOT EXISTS budget_cost numeric,
  ADD COLUMN IF NOT EXISTS actual_cost numeric,
  ADD COLUMN IF NOT EXISTS resource_name text,
  ADD COLUMN IF NOT EXISTS resource_units_per_day numeric;