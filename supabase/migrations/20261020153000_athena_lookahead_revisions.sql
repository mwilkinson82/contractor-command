-- Athena 0.7.3: lookahead revisions. Additive only: no drops, no deletes, no changed columns.
-- Re-running lookahead setup for the same job and window adds a revision (Rev 0, Rev 1, ...) of the SAME lookahead.

-- Current revision number on the lookahead (Rev 0 for every existing lookahead).
ALTER TABLE public.mcp_lookaheads ADD COLUMN IF NOT EXISTS current_rev integer NOT NULL DEFAULT 0;

-- Which revision of its lookahead added an item (null = added before revisions existed, or not on a lookahead).
ALTER TABLE public.mcp_open_items ADD COLUMN IF NOT EXISTS lookahead_rev integer;

-- Every revision, append-only.
CREATE TABLE IF NOT EXISTS public.mcp_lookahead_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookahead_id uuid NOT NULL REFERENCES public.mcp_lookaheads(id) ON DELETE CASCADE,
  rev integer NOT NULL CHECK (rev >= 0),
  parent_revision_id uuid REFERENCES public.mcp_lookahead_revisions(id),
  -- 'schedule' = window generated from a connected schedule tool; 'pm' = given by the PM.
  source text NOT NULL DEFAULT 'pm' CHECK (source IN ('schedule', 'pm')),
  -- Which tool, when source = 'schedule'. Same values as the planned job_settings.schedule_tool.
  schedule_tool text CHECK (schedule_tool IN ('overwatch', 'buildertrend', 'procore', 'other', 'unknown')),
  start_date date,
  end_date date,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,            -- what this revision sent
  effective_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the full inputs in force after this revision
  provided_inputs text[] NOT NULL DEFAULT '{}'::text[],
  missing_inputs text[] NOT NULL DEFAULT '{}'::text[],
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lookahead_id, rev),
  CHECK (source = 'schedule' OR schedule_tool IS NULL)
);
CREATE INDEX IF NOT EXISTS mcp_lookahead_revisions_lookahead_idx ON public.mcp_lookahead_revisions (lookahead_id, rev);

ALTER TABLE public.mcp_lookahead_revisions ENABLE ROW LEVEL SECURITY;
-- Access follows the parent lookahead (its own RLS applies inside the subquery). No UPDATE/DELETE policy: append-only.
DROP POLICY IF EXISTS "revision read via lookahead" ON public.mcp_lookahead_revisions;
CREATE POLICY "revision read via lookahead" ON public.mcp_lookahead_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_lookaheads l WHERE l.id = lookahead_id));
DROP POLICY IF EXISTS "revision insert via lookahead" ON public.mcp_lookahead_revisions;
CREATE POLICY "revision insert via lookahead" ON public.mcp_lookahead_revisions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.mcp_lookaheads l WHERE l.id = lookahead_id));
GRANT SELECT, INSERT ON public.mcp_lookahead_revisions TO authenticated;
GRANT ALL ON public.mcp_lookahead_revisions TO service_role;

-- Backfill Rev 0 from each existing lookahead's current row (setup containers included; harmless).
INSERT INTO public.mcp_lookahead_revisions (lookahead_id, rev, source, start_date, end_date, inputs, effective_inputs, provided_inputs, missing_inputs, user_id, created_at)
SELECT l.id, 0, 'pm', l.start_date, l.end_date, l.inputs, l.inputs, l.provided_inputs, l.missing_inputs, l.user_id, l.created_at
FROM public.mcp_lookaheads l
ON CONFLICT (lookahead_id, rev) DO NOTHING;

-- Items already on a member lookahead were added at Rev 0.
UPDATE public.mcp_open_items i SET lookahead_rev = 0
FROM public.mcp_lookaheads l
WHERE i.lookahead_id = l.id AND i.lookahead_rev IS NULL AND coalesce(l.inputs->>'kind', '') <> 'setup';
