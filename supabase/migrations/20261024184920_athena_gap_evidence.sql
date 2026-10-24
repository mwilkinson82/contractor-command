-- Add evidence to the existing gap record. Legacy rows remain unrated rather
-- than acquiring invented confidence or a claimed measurement basis.
ALTER TABLE public.mcp_estimate_gap_items
  ADD COLUMN confidence text CHECK (confidence IN ('high', 'medium', 'low')),
  ADD COLUMN evidence_basis text CHECK (evidence_basis IN ('seen', 'measured', 'assumed'));

-- Preserve the deployed access guards and unrelated fixes in both RPCs.
-- Exact anchors fail closed if the live function has drifted.
DO $migration$
DECLARE f text; old text; updated text;
BEGIN
  SELECT pg_get_functiondef('public.mcp_estimate_gaps_save(uuid,jsonb)'::regprocedure) INTO f;
  old := 'element, line_no, active';
  IF strpos(f, old) = 0 THEN RAISE EXCEPTION 'Gap save column anchor changed'; END IF;
  updated := replace(f, old, 'element, line_no, confidence, evidence_basis, active');
  old := E'CASE WHEN it->>''line_no'' IS NULL OR it->>''line_no'' = '''' THEN NULL ELSE (it->>''line_no'')::int END,\n      true';
  IF strpos(updated, old) = 0 THEN RAISE EXCEPTION 'Gap save value anchor changed'; END IF;
  updated := replace(updated, old, E'CASE WHEN it->>''line_no'' IS NULL OR it->>''line_no'' = '''' THEN NULL ELSE (it->>''line_no'')::int END,\n      nullif(it->>''confidence'', ''''), nullif(it->>''evidence_basis'', ''''), true');
  old := 'line_no = EXCLUDED.line_no, active = true';
  IF strpos(updated, old) = 0 THEN RAISE EXCEPTION 'Gap update anchor changed'; END IF;
  updated := replace(updated, old, 'line_no = EXCLUDED.line_no, confidence = EXCLUDED.confidence, evidence_basis = EXCLUDED.evidence_basis, active = true');
  EXECUTE updated;

  SELECT pg_get_functiondef('public.mcp_estimate_get(uuid)'::regprocedure) INTO f;
  old := '''element'', element, ''line_no'', line_no';
  IF strpos(f, old) = 0 THEN RAISE EXCEPTION 'Gap read anchor changed'; END IF;
  EXECUTE replace(f, old, old || ', ''confidence'', confidence, ''evidence_basis'', evidence_basis');

  SELECT pg_get_functiondef('public.mcp_takeoff_get(uuid)'::regprocedure) INTO f;
  old := '''gaps'',coalesce(legacy->''gaps'',''[]''::jsonb)';
  IF strpos(f, old) = 0 THEN RAISE EXCEPTION 'Takeoff document scope anchor changed'; END IF;
  EXECUTE replace(f, old, old || ',''document_scope'',coalesce(legacy->''setup''->''doc_review''->''scope_requirements'',''[]''::jsonb)');
END $migration$;
