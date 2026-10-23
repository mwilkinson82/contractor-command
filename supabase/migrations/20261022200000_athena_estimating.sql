-- Athena estimating: takeoffs, takeoff lines, gap items, estimator verdicts, and the intake/review setup.
-- Additive. NOT APPLIED. Apply only after review.
-- Reads use the same job scope as the other mcp_* tables. Estimating and contracts (scope contract)
-- and full-access roles can read and, through these functions, write. A super's scope is not included.
-- No direct writes: members have SELECT only. The functions are SECURITY DEFINER.

CREATE TABLE IF NOT EXISTS public.mcp_estimate_setup (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  role text CHECK (role IS NULL OR role IN ('gc', 'self_performer')),
  trades jsonb NOT NULL DEFAULT '[]'::jsonb,
  bid_due date,
  delivery_method text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  sub_bids jsonb NOT NULL DEFAULT '[]'::jsonb,
  workbook_note text,
  in_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  out_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  doc_review jsonb,
  summary jsonb,
  summary_version integer,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_takeoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  revision text,
  scales jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);
CREATE INDEX IF NOT EXISTS mcp_estimate_takeoffs_job_idx ON public.mcp_estimate_takeoffs (job_id, version DESC);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_takeoff_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  takeoff_id uuid NOT NULL REFERENCES public.mcp_estimate_takeoffs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no >= 1),
  item text NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 200),
  material text,
  qty numeric,
  unit text,
  range_text text,
  measure_type text CHECK (measure_type IS NULL OR measure_type IN ('count', 'linear', 'area', 'volume')),
  sheet text NOT NULL CHECK (length(btrim(sheet)) BETWEEN 1 AND 80),
  detail text,
  spec_section text,
  basis text NOT NULL CHECK (basis IN ('measured', 'deduced')),
  math text NOT NULL CHECK (length(btrim(math)) BETWEEN 1 AND 1000),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  markup_ref text,
  location_text text,
  missing_input text,
  exclusion text,
  checklist_key text,
  element text,
  trade text,
  note text,
  inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (takeoff_id, line_no),
  CHECK (qty IS NOT NULL OR nullif(btrim(coalesce(missing_input, '')), '') IS NOT NULL OR nullif(btrim(coalesce(exclusion, '')), '') IS NOT NULL),
  CHECK (qty IS NULL OR basis <> 'deduced' OR length(btrim(math)) > 0),
  CHECK (missing_input IS NULL OR missing_input !~* 'vendor|shop[[:space:]]*drawings?'),
  CHECK (num_nonnulls(nullif(btrim(coalesce(missing_input, '')), ''), nullif(btrim(coalesce(exclusion, '')), '')) <= 1)
);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_gap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  ref text NOT NULL CHECK (ref ~ '^G-[0-9]+$'),
  kind text NOT NULL CHECK (kind IN ('seen', 'verify')),
  category text NOT NULL CHECK (category IN ('missing_on_drawings', 'conflict', 'scale_or_dimension', 'scope_seam', 'allowance_or_alternate')),
  severity text NOT NULL CHECK (severity IN ('hard', 'soft', 'cannot_know')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  reasoning text NOT NULL CHECK (length(btrim(reasoning)) BETWEEN 1 AND 2000),
  sheet text NOT NULL CHECK (length(btrim(sheet)) BETWEEN 1 AND 80),
  detail text,
  spec_section text NOT NULL CHECK (length(btrim(spec_section)) BETWEEN 1 AND 80),
  holds_bid boolean NOT NULL DEFAULT false,
  qty numeric,
  unit text,
  element text,
  line_no integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, ref)
);
CREATE INDEX IF NOT EXISTS mcp_estimate_gap_items_job_idx ON public.mcp_estimate_gap_items (job_id, ref);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('line', 'gap')),
  line_no integer,
  gap_ref text,
  item_text text NOT NULL CHECK (length(btrim(item_text)) BETWEEN 1 AND 200),
  mark text NOT NULL CHECK (mark IN ('relevant', 'not_relevant', 'good_catch')),
  note text,
  corrected_qty numeric,
  owner text,
  marked_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((item_kind = 'line' AND line_no IS NOT NULL AND gap_ref IS NULL) OR (item_kind = 'gap' AND gap_ref IS NOT NULL AND line_no IS NULL)),
  CHECK (mark <> 'not_relevant' OR nullif(btrim(coalesce(note, '')), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS mcp_estimate_verdicts_job_idx ON public.mcp_estimate_verdicts (job_id, created_at);
CREATE INDEX IF NOT EXISTS mcp_estimate_verdicts_company_idx ON public.mcp_estimate_verdicts (company_id, created_at DESC);

ALTER TABLE public.mcp_estimate_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_takeoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_takeoff_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_gap_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_verdicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimate setup read by contract scope" ON public.mcp_estimate_setup;
CREATE POLICY "estimate setup read by contract scope" ON public.mcp_estimate_setup FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate takeoff read by contract scope" ON public.mcp_estimate_takeoffs;
CREATE POLICY "estimate takeoff read by contract scope" ON public.mcp_estimate_takeoffs FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate line read by contract scope" ON public.mcp_estimate_takeoff_lines;
CREATE POLICY "estimate line read by contract scope" ON public.mcp_estimate_takeoff_lines FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate gap read by contract scope" ON public.mcp_estimate_gap_items;
CREATE POLICY "estimate gap read by contract scope" ON public.mcp_estimate_gap_items FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate verdict read by contract scope" ON public.mcp_estimate_verdicts;
CREATE POLICY "estimate verdict read by contract scope" ON public.mcp_estimate_verdicts FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));

REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_setup FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_takeoffs FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_takeoff_lines FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_gap_items FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_verdicts FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_estimate_setup, public.mcp_estimate_takeoffs, public.mcp_estimate_takeoff_lines, public.mcp_estimate_gap_items, public.mcp_estimate_verdicts TO authenticated;
GRANT ALL ON public.mcp_estimate_setup, public.mcp_estimate_takeoffs, public.mcp_estimate_takeoff_lines, public.mcp_estimate_gap_items, public.mcp_estimate_verdicts TO service_role;

-- Scope gate shared by the write functions. Null scope is "no job". Super is rejected.
CREATE OR REPLACE FUNCTION public.mcp_estimate_guard(_job uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; cid uuid;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:This needs access to the estimate. Your role can''t see it.'; END IF;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  IF cid IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  RETURN cid;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_guard(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_guard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_setup_save(_job uuid, _patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _patch ? 'role' AND coalesce(_patch->>'role', '') NOT IN ('gc', 'self_performer') THEN
    RAISE EXCEPTION 'MCP_BAD:Role is general contractor or self-performer. Nothing was saved.';
  END IF;
  INSERT INTO public.mcp_estimate_setup (job_id, company_id, role, trades, bid_due, delivery_method, documents, sub_bids, workbook_note, in_scope, out_scope, assumptions, doc_review, summary, summary_version)
  VALUES (
    _job, cid,
    CASE WHEN _patch ? 'role' THEN _patch->>'role' ELSE NULL END,
    CASE WHEN _patch ? 'trades' THEN _patch->'trades' ELSE '[]'::jsonb END,
    CASE WHEN _patch ? 'bid_due' THEN nullif(_patch->>'bid_due', '')::date ELSE NULL END,
    CASE WHEN _patch ? 'delivery_method' THEN nullif(_patch->>'delivery_method', '') ELSE NULL END,
    CASE WHEN _patch ? 'documents' THEN _patch->'documents' ELSE '[]'::jsonb END,
    CASE WHEN _patch ? 'sub_bids' THEN _patch->'sub_bids' ELSE '[]'::jsonb END,
    CASE WHEN _patch ? 'workbook_note' THEN nullif(_patch->>'workbook_note', '') ELSE NULL END,
    CASE WHEN _patch ? 'in_scope' THEN _patch->'in_scope' ELSE '[]'::jsonb END,
    CASE WHEN _patch ? 'out_scope' THEN _patch->'out_scope' ELSE '[]'::jsonb END,
    CASE WHEN _patch ? 'assumptions' THEN _patch->'assumptions' ELSE '[]'::jsonb END,
    CASE WHEN _patch ? 'doc_review' THEN _patch->'doc_review' ELSE NULL END,
    CASE WHEN _patch ? 'summary' THEN _patch->'summary' ELSE NULL END,
    CASE WHEN _patch ? 'summary_version' THEN nullif(_patch->>'summary_version', '')::int ELSE NULL END
  )
  ON CONFLICT (job_id) DO UPDATE SET
    role = CASE WHEN _patch ? 'role' THEN EXCLUDED.role ELSE public.mcp_estimate_setup.role END,
    trades = CASE WHEN _patch ? 'trades' THEN EXCLUDED.trades ELSE public.mcp_estimate_setup.trades END,
    bid_due = CASE WHEN _patch ? 'bid_due' THEN EXCLUDED.bid_due ELSE public.mcp_estimate_setup.bid_due END,
    delivery_method = CASE WHEN _patch ? 'delivery_method' THEN EXCLUDED.delivery_method ELSE public.mcp_estimate_setup.delivery_method END,
    documents = CASE WHEN _patch ? 'documents' THEN EXCLUDED.documents ELSE public.mcp_estimate_setup.documents END,
    sub_bids = CASE WHEN _patch ? 'sub_bids' THEN EXCLUDED.sub_bids ELSE public.mcp_estimate_setup.sub_bids END,
    workbook_note = CASE WHEN _patch ? 'workbook_note' THEN EXCLUDED.workbook_note ELSE public.mcp_estimate_setup.workbook_note END,
    in_scope = CASE WHEN _patch ? 'in_scope' THEN EXCLUDED.in_scope ELSE public.mcp_estimate_setup.in_scope END,
    out_scope = CASE WHEN _patch ? 'out_scope' THEN EXCLUDED.out_scope ELSE public.mcp_estimate_setup.out_scope END,
    assumptions = CASE WHEN _patch ? 'assumptions' THEN EXCLUDED.assumptions ELSE public.mcp_estimate_setup.assumptions END,
    doc_review = CASE WHEN _patch ? 'doc_review' THEN EXCLUDED.doc_review ELSE public.mcp_estimate_setup.doc_review END,
    summary = CASE WHEN _patch ? 'summary' THEN EXCLUDED.summary ELSE public.mcp_estimate_setup.summary END,
    summary_version = CASE WHEN _patch ? 'summary_version' THEN EXCLUDED.summary_version ELSE public.mcp_estimate_setup.summary_version END,
    updated_by = auth.uid(),
    updated_at = now();
  RETURN jsonb_build_object('saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_setup_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_setup_save(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; sc text; t public.mcp_estimate_takeoffs; s public.mcp_estimate_setup;
  lines jsonb; gaps jsonb; verdicts jsonb; acc jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:This needs access to the estimate. Your role can''t see it.'; END IF;
  SELECT * INTO s FROM public.mcp_estimate_setup WHERE job_id = _job;
  SELECT * INTO t FROM public.mcp_estimate_takeoffs WHERE job_id = _job ORDER BY version DESC LIMIT 1;
  SELECT company_id INTO cid FROM public.mcp_jobs WHERE id = _job;
  IF t.id IS NULL THEN lines := '[]'::jsonb; ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'line_no', line_no, 'item', item, 'material', material, 'qty', qty, 'unit', unit, 'range_text', range_text,
      'measure_type', measure_type, 'sheet', sheet, 'detail', detail, 'spec_section', spec_section, 'basis', basis,
      'math', math, 'confidence', confidence, 'markup_ref', markup_ref, 'location_text', location_text,
      'missing_input', missing_input, 'exclusion', exclusion, 'checklist_key', checklist_key, 'element', element,
      'trade', trade, 'note', note, 'inputs', inputs
    ) ORDER BY line_no), '[]'::jsonb) INTO lines
    FROM public.mcp_estimate_takeoff_lines WHERE takeoff_id = t.id;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'ref', ref, 'kind', kind, 'category', category, 'severity', severity, 'title', title, 'reasoning', reasoning,
    'sheet', sheet, 'detail', detail, 'spec_section', spec_section, 'holds_bid', holds_bid, 'qty', qty, 'unit', unit,
    'element', element, 'line_no', line_no
  ) ORDER BY ref), '[]'::jsonb) INTO gaps
  FROM public.mcp_estimate_gap_items WHERE job_id = _job AND active;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'item_kind', item_kind, 'line_no', line_no, 'gap_ref', gap_ref, 'item_text', item_text, 'mark', mark,
    'note', note, 'corrected_qty', corrected_qty, 'owner', owner, 'created_at', created_at
  ) ORDER BY created_at), '[]'::jsonb) INTO verdicts
  FROM (SELECT * FROM public.mcp_estimate_verdicts WHERE job_id = _job ORDER BY created_at DESC LIMIT 500) v;
  SELECT jsonb_build_object(
    'relevant', count(*) FILTER (WHERE mark = 'relevant'),
    'not_relevant', count(*) FILTER (WHERE mark = 'not_relevant'),
    'good_catch', count(*) FILTER (WHERE mark = 'good_catch'),
    'calls', count(*)
  ) INTO acc
  FROM public.mcp_estimate_verdicts vd
  JOIN public.mcp_jobs j ON j.id = vd.job_id
  WHERE j.company_id = cid AND public.mcp_job_scope(vd.job_id) IN ('full', 'contract');
  RETURN jsonb_build_object(
    'scope', sc,
    'setup', CASE WHEN s.job_id IS NULL THEN NULL ELSE jsonb_build_object(
      'role', s.role, 'trades', s.trades, 'bid_due', s.bid_due, 'delivery_method', s.delivery_method,
      'documents', s.documents, 'sub_bids', s.sub_bids, 'workbook_note', s.workbook_note,
      'in_scope', s.in_scope, 'out_scope', s.out_scope, 'assumptions', s.assumptions,
      'doc_review', s.doc_review, 'summary', s.summary, 'summary_version', s.summary_version
    ) END,
    'takeoff', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('version', t.version, 'revision', t.revision, 'scales', t.scales, 'lines', lines) END,
    'gaps', gaps,
    'verdicts', verdicts,
    'accuracy', acc
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_get(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_takeoff_save(_job uuid, _revision text, _scales jsonb, _lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; ver integer; tid uuid; ln jsonb; n int := 0;
  basis text; qty numeric; missing text; excl text; math text; sheet text;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) < 1 THEN
    RAISE EXCEPTION 'MCP_BAD:Send at least one takeoff line. Nothing was saved.';
  END IF;
  IF jsonb_array_length(_lines) > 400 THEN RAISE EXCEPTION 'MCP_BAD:That takeoff is over 400 lines. Nothing was saved.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('estimate-takeoff:' || _job::text));
  SELECT coalesce(max(version), 0) + 1 INTO ver FROM public.mcp_estimate_takeoffs WHERE job_id = _job;
  INSERT INTO public.mcp_estimate_takeoffs (job_id, company_id, version, revision, scales)
  VALUES (_job, cid, ver, nullif(btrim(coalesce(_revision, '')), ''), coalesce(_scales, '[]'::jsonb))
  RETURNING id INTO tid;
  FOR ln IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    basis := ln->>'basis';
    qty := CASE WHEN ln->>'qty' IS NULL OR ln->>'qty' = '' THEN NULL ELSE (ln->>'qty')::numeric END;
    missing := nullif(btrim(coalesce(ln->>'missing_input', '')), '');
    excl := nullif(btrim(coalesce(ln->>'exclusion', '')), '');
    math := btrim(coalesce(ln->>'math', ''));
    sheet := btrim(coalesce(ln->>'sheet', ''));
    IF basis NOT IN ('measured', 'deduced') THEN RAISE EXCEPTION 'MCP_BAD:Each quantity is MEASURED or DEDUCED. Nothing was saved.'; END IF;
    IF sheet = '' THEN RAISE EXCEPTION 'MCP_BAD:Each line cites a sheet. Nothing was saved.'; END IF;
    IF qty IS NULL AND missing IS NULL AND excl IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Name the one input that is missing. Nothing was saved.'; END IF;
    IF missing IS NOT NULL AND excl IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:A line is a blank or an exclusion, not both. Nothing was saved.'; END IF;
    IF missing IS NOT NULL AND missing ~* 'vendor|shop[[:space:]]*drawings?' THEN
      RAISE EXCEPTION 'MCP_BAD:A vendor or shop-drawing note is not a reason to leave this blank. Nothing was saved.';
    END IF;
    IF basis = 'deduced' AND qty IS NOT NULL AND math = '' THEN RAISE EXCEPTION 'MCP_BAD:A DEDUCED quantity shows its math. Nothing was saved.'; END IF;
    IF qty IS NOT NULL AND qty < 0 THEN RAISE EXCEPTION 'MCP_BAD:A quantity can''t be negative. Nothing was saved.'; END IF;
    INSERT INTO public.mcp_estimate_takeoff_lines (
      takeoff_id, job_id, line_no, item, material, qty, unit, range_text, measure_type, sheet, detail, spec_section,
      basis, math, confidence, markup_ref, location_text, missing_input, exclusion, checklist_key, element, trade, note, inputs
    ) VALUES (
      tid, _job, (ln->>'line_no')::int, left(btrim(ln->>'item'), 200), nullif(ln->>'material', ''), qty, nullif(ln->>'unit', ''),
      nullif(ln->>'range_text', ''), nullif(ln->>'measure_type', ''), left(sheet, 80), nullif(ln->>'detail', ''), nullif(ln->>'spec_section', ''),
      basis, left(math, 1000), coalesce(nullif(ln->>'confidence', ''), 'medium'), nullif(ln->>'markup_ref', ''), nullif(ln->>'location_text', ''),
      missing, excl, nullif(ln->>'checklist_key', ''), nullif(ln->>'element', ''), nullif(ln->>'trade', ''), nullif(ln->>'note', ''),
      coalesce(ln->'inputs', '[]'::jsonb)
    );
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('version', ver, 'lines', n);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_takeoff_save(uuid, text, jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_takeoff_save(uuid, text, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_gaps_save(_job uuid, _items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; it jsonb; n int := 0;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF jsonb_typeof(_items) <> 'array' THEN RAISE EXCEPTION 'MCP_BAD:Send the gap list. Nothing was saved.'; END IF;
  IF jsonb_array_length(_items) > 300 THEN RAISE EXCEPTION 'MCP_BAD:That gap list is over 300 items. Nothing was saved.'; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF coalesce(it->>'ref', '') !~ '^G-[0-9]+$' THEN RAISE EXCEPTION 'MCP_BAD:Each gap needs a number. Nothing was saved.'; END IF;
    IF length(btrim(coalesce(it->>'reasoning', ''))) < 1 OR length(btrim(coalesce(it->>'sheet', ''))) < 1 OR length(btrim(coalesce(it->>'spec_section', ''))) < 1 THEN
      RAISE EXCEPTION 'MCP_BAD:Each gap cites the sheet, the spec section and the reasoning. Nothing was saved.';
    END IF;
    INSERT INTO public.mcp_estimate_gap_items (
      job_id, company_id, ref, kind, category, severity, title, reasoning, sheet, detail, spec_section, holds_bid, qty, unit, element, line_no, active
    ) VALUES (
      _job, cid, it->>'ref', it->>'kind', it->>'category', it->>'severity', left(btrim(it->>'title'), 200), left(btrim(it->>'reasoning'), 2000),
      left(btrim(it->>'sheet'), 80), nullif(it->>'detail', ''), left(btrim(it->>'spec_section'), 80), coalesce((it->>'holds_bid')::boolean, false),
      CASE WHEN it->>'qty' IS NULL OR it->>'qty' = '' THEN NULL ELSE (it->>'qty')::numeric END,
      nullif(it->>'unit', ''), nullif(it->>'element', ''),
      CASE WHEN it->>'line_no' IS NULL OR it->>'line_no' = '' THEN NULL ELSE (it->>'line_no')::int END,
      true
    )
    ON CONFLICT (job_id, ref) DO UPDATE SET
      kind = EXCLUDED.kind, category = EXCLUDED.category, severity = EXCLUDED.severity, title = EXCLUDED.title,
      reasoning = EXCLUDED.reasoning, sheet = EXCLUDED.sheet, detail = EXCLUDED.detail, spec_section = EXCLUDED.spec_section,
      holds_bid = EXCLUDED.holds_bid, qty = EXCLUDED.qty, unit = EXCLUDED.unit, element = EXCLUDED.element, line_no = EXCLUDED.line_no, active = true;
    n := n + 1;
  END LOOP;
  UPDATE public.mcp_estimate_gap_items g SET active = false
  WHERE g.job_id = _job AND g.active
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_items) i WHERE i->>'ref' = g.ref)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_estimate_verdicts v WHERE v.job_id = _job AND v.gap_ref = g.ref);
  RETURN jsonb_build_object('saved', n);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_gaps_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_gaps_save(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_verdict_save(
  _job uuid, _kind text, _line_no integer, _gap text, _item text, _mark text, _note text, _qty numeric, _owner text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _mark NOT IN ('relevant', 'not_relevant', 'good_catch') THEN RAISE EXCEPTION 'MCP_BAD:The mark is relevant, not relevant or good catch. Nothing was changed.'; END IF;
  IF _mark = 'not_relevant' AND nullif(btrim(coalesce(_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Say why this is not relevant. Nothing was changed.';
  END IF;
  IF _kind = 'line' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.mcp_estimate_takeoff_lines l
      JOIN public.mcp_estimate_takeoffs t ON t.id = l.takeoff_id
      WHERE t.job_id = _job AND l.line_no = _line_no AND l.item = _item
        AND t.version = (SELECT max(version) FROM public.mcp_estimate_takeoffs WHERE job_id = _job)
    ) THEN RAISE EXCEPTION 'MCP_BAD:That line is not on the current takeoff. Nothing was changed.'; END IF;
  ELSIF _kind = 'gap' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mcp_estimate_gap_items WHERE job_id = _job AND ref = _gap AND active) THEN
      RAISE EXCEPTION 'MCP_BAD:That gap is not on this estimate. Nothing was changed.';
    END IF;
  ELSE
    RAISE EXCEPTION 'MCP_BAD:Mark a takeoff line or a gap. Nothing was changed.';
  END IF;
  INSERT INTO public.mcp_estimate_verdicts (job_id, company_id, item_kind, line_no, gap_ref, item_text, mark, note, corrected_qty, owner)
  VALUES (_job, cid, _kind, CASE WHEN _kind = 'line' THEN _line_no END, CASE WHEN _kind = 'gap' THEN _gap END, left(btrim(_item), 200), _mark, nullif(btrim(coalesce(_note, '')), ''), _qty, nullif(btrim(coalesce(_owner, '')), ''));
  RETURN jsonb_build_object('saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_verdict_save(uuid, text, integer, text, text, text, text, numeric, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_verdict_save(uuid, text, integer, text, text, text, text, numeric, text) TO authenticated;
