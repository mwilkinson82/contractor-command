CREATE TABLE public.mcp_profiles (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  company_name text NOT NULL,
  trades text[] NOT NULL DEFAULT '{}',
  roles jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  job_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE TABLE public.mcp_lookaheads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  start_date date,
  end_date date,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  provided_inputs text[] NOT NULL DEFAULT '{}',
  missing_inputs text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  category text NOT NULL,
  trade text NOT NULL DEFAULT 'general',
  prompt text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('confirm','list')),
  required_inputs text[] NOT NULL DEFAULT '{}',
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  is_placeholder boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);
CREATE TABLE public.mcp_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  lookahead_id uuid NOT NULL REFERENCES public.mcp_lookaheads(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  check_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('answered','unknown','skipped_missing_inputs')),
  response text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lookahead_id, check_key)
);
CREATE TABLE public.mcp_open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  lookahead_id uuid NOT NULL REFERENCES public.mcp_lookaheads(id) ON DELETE CASCADE,
  origin_lookahead_id uuid NOT NULL REFERENCES public.mcp_lookaheads(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  check_version integer NOT NULL,
  trade text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  action text NOT NULL,
  detail text,
  owner text NOT NULL DEFAULT 'unknown',
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  carry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE TABLE public.mcp_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_id uuid NOT NULL REFERENCES public.mcp_open_items(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('opened','carried_forward','resolved')),
  lookahead_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_item_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_id uuid NOT NULL REFERENCES public.mcp_open_items(id) ON DELETE CASCADE,
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mcp_carry_forwards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_id uuid NOT NULL REFERENCES public.mcp_open_items(id) ON DELETE CASCADE,
  from_lookahead_id uuid NOT NULL REFERENCES public.mcp_lookaheads(id) ON DELETE CASCADE,
  to_lookahead_id uuid NOT NULL REFERENCES public.mcp_lookaheads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, to_lookahead_id)
);
CREATE TABLE public.mcp_usage (
  user_id uuid NOT NULL,
  period text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  usage_limit integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);
CREATE TABLE public.mcp_workflow_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  event_type text NOT NULL CHECK (event_type IN ('failure','missing_question')),
  tool text NOT NULL,
  lookahead_id uuid,
  check_key text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.mcp_profiles, public.mcp_jobs, public.mcp_lookaheads, public.mcp_answers, public.mcp_open_items TO authenticated;
GRANT SELECT, INSERT ON public.mcp_item_events, public.mcp_item_evidence, public.mcp_carry_forwards, public.mcp_workflow_log TO authenticated;
GRANT SELECT ON public.mcp_usage, public.mcp_checklist_items TO authenticated;
GRANT ALL ON public.mcp_profiles, public.mcp_jobs, public.mcp_lookaheads, public.mcp_checklist_items, public.mcp_answers, public.mcp_open_items, public.mcp_item_events, public.mcp_item_evidence, public.mcp_carry_forwards, public.mcp_usage, public.mcp_workflow_log TO service_role;

ALTER TABLE public.mcp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_lookaheads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_open_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_item_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_carry_forwards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_workflow_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows" ON public.mcp_profiles FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows" ON public.mcp_jobs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows" ON public.mcp_lookaheads FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows" ON public.mcp_answers FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own rows" ON public.mcp_open_items FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own read" ON public.mcp_item_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own append" ON public.mcp_item_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own read" ON public.mcp_item_evidence FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own append" ON public.mcp_item_evidence FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own read" ON public.mcp_carry_forwards FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own append" ON public.mcp_carry_forwards FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own read" ON public.mcp_workflow_log FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own append" ON public.mcp_workflow_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own read" ON public.mcp_usage FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "active checks" ON public.mcp_checklist_items FOR SELECT TO authenticated USING (active);

CREATE OR REPLACE FUNCTION public.mcp_usage_hit(_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _p text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
  _row public.mcp_usage;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.mcp_usage (user_id, period, used, usage_limit) VALUES (_uid, _p, 0, _limit) ON CONFLICT DO NOTHING;
  UPDATE public.mcp_usage SET used = used + 1, updated_at = now()
    WHERE user_id = _uid AND period = _p AND used < usage_limit RETURNING * INTO _row;
  IF NOT FOUND THEN
    SELECT * INTO _row FROM public.mcp_usage WHERE user_id = _uid AND period = _p;
    RETURN jsonb_build_object('allowed', false, 'used', _row.used, 'limit', _row.usage_limit, 'period', _p);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'used', _row.used, 'limit', _row.usage_limit, 'period', _p);
END $$;
REVOKE ALL ON FUNCTION public.mcp_usage_hit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_usage_hit(integer) TO authenticated;

INSERT INTO public.mcp_checklist_items (key, version, category, trade, prompt, rule_type, required_inputs, severity, position, is_placeholder) VALUES
 ('placeholder_crews', 1, 'Manpower', 'general', 'PLACEHOLDER: Is every crew in the lookahead confirmed with a headcount for each day?', 'confirm', ARRAY['crews','lookahead_dates'], 'high', 10, true),
 ('placeholder_submittals', 1, 'Submittals', 'general', 'PLACEHOLDER: List any pending submittals that gate work in this window (or say none).', 'list', ARRAY['submittal_log'], 'high', 20, true),
 ('placeholder_rfis', 1, 'RFIs', 'general', 'PLACEHOLDER: List any open RFIs that block work in this window (or say none).', 'list', ARRAY['rfi_log'], 'high', 30, true),
 ('placeholder_inspections', 1, 'Inspections', 'general', 'PLACEHOLDER: Are all inspections needed in this window requested?', 'confirm', ARRAY['inspection_list'], 'medium', 40, true),
 ('placeholder_deliveries', 1, 'Materials', 'general', 'PLACEHOLDER: Are all deliveries needed in this window confirmed with a date?', 'confirm', ARRAY['deliveries'], 'medium', 50, true),
 ('placeholder_predecessors', 1, 'Logic', 'general', 'PLACEHOLDER: List any activities scheduled to start before their predecessors finish (or say none).', 'list', ARRAY['schedule_export'], 'high', 60, true);