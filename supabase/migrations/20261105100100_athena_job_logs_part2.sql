-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena job logs, part 2 of 4: claims, inspections and owner decisions tables.
-- Needs 20261105100000_athena_job_logs_part1 first. The four parts together are the former
-- 20261105100000_athena_job_logs.sql, split only to make each file smaller to
-- apply; no statement changed.
-- Rollback (all four parts): supabase/rollbacks/20261105100000_athena_job_logs.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 3. Job logs: claims, inspections, owner decisions.
CREATE TABLE IF NOT EXISTS public.mcp_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 40),
  claim_type text NOT NULL CHECK (claim_type IN ('delay','extension_of_time','delay_damages','acceleration','disruption','other')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 12000),
  status text NOT NULL CHECK (status IN ('in_preparation','submitted','pending_review','under_review','reviewed','resolved','rejected','withdrawn')),
  money_claimed_cents bigint NOT NULL DEFAULT 0 CHECK (money_claimed_cents >= 0),
  money_awarded_cents bigint NOT NULL DEFAULT 0 CHECK (money_awarded_cents >= 0),
  time_claimed_days integer NOT NULL DEFAULT 0 CHECK (time_claimed_days BETWEEN 0 AND 3650),
  time_awarded_days integer NOT NULL DEFAULT 0 CHECK (time_awarded_days BETWEEN 0 AND 3650),
  submitted_on date,
  resolved_on date,
  outcome text CHECK (length(outcome) <= 4000),
  owner_name text CHECK (length(owner_name) <= 120),
  change_order_id uuid REFERENCES public.mcp_submittals(id) ON DELETE SET NULL,
  exposure_ref text CHECK (length(exposure_ref) <= 300),
  delay_event_id uuid REFERENCES public.mcp_delay_events(id) ON DELETE SET NULL,
  claim_item_id uuid REFERENCES public.mcp_open_items(id) ON DELETE SET NULL,
  source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  record_version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_claims_job_number ON public.mcp_claims (job_id, lower(number));
CREATE TABLE IF NOT EXISTS public.mcp_claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.mcp_claims(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('submitted','received','reviewed','meeting','returned_for_revision','resubmitted','resolved','other')),
  event_date date,
  revision_number integer NOT NULL DEFAULT 0 CHECK (revision_number BETWEEN 0 AND 99),
  note text CHECK (length(note) <= 4000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_claim_events_claim ON public.mcp_claim_events (claim_id, event_date);
CREATE TABLE IF NOT EXISTS public.mcp_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (length(btrim(inspection_type)) BETWEEN 1 AND 120),
  authority text CHECK (length(authority) <= 200),
  location text CHECK (length(location) <= 200),
  inspector text CHECK (length(inspector) <= 120),
  responsible_party text CHECK (length(responsible_party) <= 120),
  status text NOT NULL CHECK (status IN ('planned','requested','scheduled','passed','failed','partial','cancelled')),
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','partial','cancelled')),
  requested_on date,
  scheduled_on date,
  completed_on date,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 99),
  reinspection_required boolean NOT NULL DEFAULT false,
  cost_impact_cents bigint NOT NULL DEFAULT 0,
  schedule_impact_weeks numeric CHECK (schedule_impact_weeks BETWEEN -520 AND 520),
  notes text CHECK (length(notes) <= 4000),
  corrective_action text CHECK (length(corrective_action) <= 4000),
  parent_id uuid REFERENCES public.mcp_inspections(id) ON DELETE SET NULL,
  risk_ref text CHECK (length(risk_ref) <= 300),
  source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  record_version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_inspections_job ON public.mcp_inspections (job_id, scheduled_on);
CREATE TABLE IF NOT EXISTS public.mcp_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 40),
  decision text NOT NULL CHECK (length(btrim(decision)) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK (status IN ('open','in_progress','decided','withdrawn')),
  owner_name text CHECK (length(owner_name) <= 120),
  owner_email text CHECK (owner_email IS NULL OR (length(owner_email) <= 320 AND owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  due_on date,
  impact text CHECK (length(impact) <= 2000),
  decided_on date,
  outcome text CHECK (length(outcome) <= 4000),
  notes text CHECK (length(notes) <= 4000),
  change_order_id uuid REFERENCES public.mcp_submittals(id) ON DELETE SET NULL,
  exposure_ref text CHECK (length(exposure_ref) <= 300),
  -- A selection on the job's selection board (mcp_private.residential_selection_boards
  -- body.selections[].id). Checked when written; the board is never changed here.
  selection_id uuid,
  source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  record_version integer NOT NULL DEFAULT 1,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_decisions_job_number ON public.mcp_decisions (job_id, lower(number));
CREATE TABLE IF NOT EXISTS public.mcp_job_log_operations (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  digest text NOT NULL,
  log text NOT NULL,
  record_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, request_id)
);

-- Writes only through mcp_job_log_record. Direct reads: full job scope (these
-- logs carry money); Supers read inspections, without cost, through
-- mcp_job_log_rows.
ALTER TABLE public.mcp_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_log_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_claims, public.mcp_claim_events, public.mcp_inspections, public.mcp_decisions, public.mcp_job_log_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_claims, public.mcp_claim_events, public.mcp_inspections, public.mcp_decisions TO authenticated;
GRANT ALL ON public.mcp_claims, public.mcp_claim_events, public.mcp_inspections, public.mcp_decisions, public.mcp_job_log_operations TO service_role;
DROP POLICY IF EXISTS "claims read full scope" ON public.mcp_claims;
CREATE POLICY "claims read full scope" ON public.mcp_claims FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "claim events read full scope" ON public.mcp_claim_events;
CREATE POLICY "claim events read full scope" ON public.mcp_claim_events FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "inspections read full scope" ON public.mcp_inspections;
CREATE POLICY "inspections read full scope" ON public.mcp_inspections FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));
DROP POLICY IF EXISTS "decisions read full scope" ON public.mcp_decisions;
CREATE POLICY "decisions read full scope" ON public.mcp_decisions FOR SELECT TO authenticated USING (coalesce(public.mcp_job_scope(job_id) = 'full', false));

