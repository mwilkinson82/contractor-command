-- WBS nodes: hierarchical breakdown structure per schedule
CREATE TABLE public.wbs_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.wbs_nodes(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wbs_nodes_schedule ON public.wbs_nodes(schedule_id);
CREATE INDEX idx_wbs_nodes_parent ON public.wbs_nodes(parent_id);

ALTER TABLE public.wbs_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members manage wbs nodes" ON public.wbs_nodes FOR ALL
  USING (public.is_schedule_member(schedule_id, auth.uid()))
  WITH CHECK (public.is_schedule_member(schedule_id, auth.uid()));
CREATE POLICY "admin manages wbs nodes" ON public.wbs_nodes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_wbs_nodes_updated BEFORE UPDATE ON public.wbs_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Activity code types (Phase, Area, Trade, Responsibility, etc.)
CREATE TABLE public.activity_code_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, name)
);
CREATE INDEX idx_act_code_types_schedule ON public.activity_code_types(schedule_id);

ALTER TABLE public.activity_code_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage code types" ON public.activity_code_types FOR ALL
  USING (public.is_schedule_member(schedule_id, auth.uid()))
  WITH CHECK (public.is_schedule_member(schedule_id, auth.uid()));
CREATE POLICY "admin manages code types" ON public.activity_code_types FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_act_code_types_updated BEFORE UPDATE ON public.activity_code_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Activity code values (enum-like entries under a type)
CREATE TABLE public.activity_code_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type_id UUID NOT NULL REFERENCES public.activity_code_types(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  description TEXT,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_id, code)
);
CREATE INDEX idx_act_code_values_type ON public.activity_code_values(type_id);

ALTER TABLE public.activity_code_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage code values" ON public.activity_code_values FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.activity_code_types t
    WHERE t.id = activity_code_values.type_id
      AND public.is_schedule_member(t.schedule_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.activity_code_types t
    WHERE t.id = activity_code_values.type_id
      AND public.is_schedule_member(t.schedule_id, auth.uid())
  ));
CREATE POLICY "admin manages code values" ON public.activity_code_values FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_act_code_values_updated BEFORE UPDATE ON public.activity_code_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-task code assignments (M:N task → value)
CREATE TABLE public.task_activity_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  type_id UUID NOT NULL REFERENCES public.activity_code_types(id) ON DELETE CASCADE,
  value_id UUID NOT NULL REFERENCES public.activity_code_values(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, task_id, type_id)
);
CREATE INDEX idx_tac_schedule_task ON public.task_activity_codes(schedule_id, task_id);
CREATE INDEX idx_tac_value ON public.task_activity_codes(value_id);

ALTER TABLE public.task_activity_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage task codes" ON public.task_activity_codes FOR ALL
  USING (public.is_schedule_member(schedule_id, auth.uid()))
  WITH CHECK (public.is_schedule_member(schedule_id, auth.uid()));
CREATE POLICY "admin manages task codes" ON public.task_activity_codes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Wire schedule_tasks to WBS nodes (optional FK)
ALTER TABLE public.schedule_tasks ADD COLUMN IF NOT EXISTS wbs_node_id UUID
  REFERENCES public.wbs_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_wbs_node ON public.schedule_tasks(wbs_node_id);

-- Extend constraint types on schedule_tasks
ALTER TABLE public.schedule_tasks ADD COLUMN IF NOT EXISTS finish_no_later_than DATE;
ALTER TABLE public.schedule_tasks ADD COLUMN IF NOT EXISTS constraint_type TEXT;
-- constraint_type values: 'SNET','SNLT','FNET','FNLT','MSO','MFO','ALAP' (validated app-side)
