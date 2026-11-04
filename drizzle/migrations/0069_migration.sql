-- Good/Better/Best selections and proposals, part 1 of 5: private tables.
-- Plain SQL for Lovable to apply. Safe to rerun. Apply parts 1 to 5 in order.
-- Nothing here touches contracts, budgets, billing, SOVs or accounting.
CREATE SCHEMA IF NOT EXISTS mcp_private;

-- One board per job. body holds currency, proposal, selections and accepted.
CREATE TABLE IF NOT EXISTS mcp_private.residential_selection_boards (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every saved version, so nothing on a board changes without a record.
CREATE TABLE IF NOT EXISTS mcp_private.residential_selection_board_history (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('save', 'record_choice')),
  body jsonb NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, version)
);

-- Customer share links. proposal is the frozen customer view built in SQL from
-- whitelisted fields only; it never holds cost, margin, assumptions or notes.
CREATE TABLE IF NOT EXISTS mcp_private.selection_proposal_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  board_version bigint NOT NULL CHECK (board_version > 0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  proposal jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS selection_proposal_shares_job_idx ON mcp_private.selection_proposal_shares (job_id);

REVOKE ALL ON mcp_private.residential_selection_boards FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON mcp_private.residential_selection_board_history FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON mcp_private.selection_proposal_shares FROM PUBLIC, anon, authenticated, service_role;