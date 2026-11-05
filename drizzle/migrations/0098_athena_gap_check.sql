-- Gap check (Nov 6, 2026): the estimator answers each gap one at a time, in chat or on the live board
-- at /r/job/<id>/gap-check: "I'm carrying it", "It's covered elsewhere", "I understand, qualify it" or
-- "Ask an RFI before bid". Answers live in mcp_estimate_gap_answers, one row per gap, replaced on change.
-- mcp_estimate_get and mcp_estimate_gaps_save keep their signatures and add the new gap fields and the answer.
-- The read functions are VOLATILE for the same reason as release-proposals/estimating-member-read-transactions.sql.
-- Backward compatible: old callers still work; new columns are nullable or defaulted.

ALTER TABLE public.mcp_estimate_gap_items
  ADD COLUMN IF NOT EXISTS question text CHECK (question IS NULL OR length(question) <= 500),
  ADD COLUMN IF NOT EXISTS conditional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS condition_text text CHECK (condition_text IS NULL OR length(condition_text) <= 500),
  ADD COLUMN IF NOT EXISTS exposure_low numeric CHECK (exposure_low IS NULL OR exposure_low >= 0),
  ADD COLUMN IF NOT EXISTS exposure_high numeric CHECK (exposure_high IS NULL OR exposure_high >= 0),
  ADD COLUMN IF NOT EXISTS schedule_activity text CHECK (schedule_activity IS NULL OR length(schedule_activity) <= 200),
  ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array');

CREATE TABLE IF NOT EXISTS public.mcp_estimate_gap_answers (
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  gap_ref text NOT NULL CHECK (gap_ref ~ '^G-[0-9]+$'),
  answer text NOT NULL CHECK (answer IN ('carrying', 'covered', 'understood', 'rfi')),
  amount numeric CHECK (amount IS NULL OR amount >= 0),
  covered_by text CHECK (covered_by IS NULL OR covered_by IN ('takeoff_line', 'general_conditions', 'sub_quote', 'owner_in_writing', 'other')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  qualification text CHECK (qualification IS NULL OR length(qualification) <= 1000),
  question text CHECK (question IS NULL OR length(question) <= 1000),
  source text NOT NULL DEFAULT 'chat' CHECK (source IN ('chat', 'board', 'walkthrough', 'excel')),
  answered_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, gap_ref),
  CHECK (answer <> 'carrying' OR amount IS NOT NULL),
  CHECK (answer <> 'covered' OR (covered_by IS NOT NULL AND nullif(btrim(coalesce(note, '')), '') IS NOT NULL)),
  CHECK (answer <> 'understood' OR nullif(btrim(coalesce(qualification, note, '')), '') IS NOT NULL),
  CHECK (answer <> 'rfi' OR nullif(btrim(coalesce(question, '')), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS mcp_estimate_gap_answers_company_idx ON public.mcp_estimate_gap_answers (company_id, updated_at DESC);

ALTER TABLE public.mcp_estimate_gap_answers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate gap answer read by contract scope" ON public.mcp_estimate_gap_answers;
CREATE POLICY "estimate gap answer read by contract scope" ON public.mcp_estimate_gap_answers FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
REVOKE ALL ON public.mcp_estimate_gap_answers FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_gap_answers FROM authenticated;
GRANT SELECT ON public.mcp_estimate_gap_answers TO authenticated;
GRANT ALL ON public.mcp_estimate_gap_answers TO service_role;

-- VOLATILE, not STABLE: the member gate takes row locks, and PostgREST runs STABLE RPCs read-only.
CREATE OR REPLACE FUNCTION public.mcp_estimate_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
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
    'ref', g.ref, 'kind', g.kind, 'category', g.category, 'severity', g.severity, 'title', g.title, 'reasoning', g.reasoning,
    'sheet', g.sheet, 'detail', g.detail, 'spec_section', g.spec_section, 'holds_bid', g.holds_bid, 'qty', g.qty, 'unit', g.unit,
    'element', g.element, 'line_no', g.line_no,
    'question', g.question, 'conditional', g.conditional, 'condition_text', g.condition_text,
    'exposure_low', g.exposure_low, 'exposure_high', g.exposure_high, 'schedule_activity', g.schedule_activity,
    'citations', g.citations,
    'answer', CASE WHEN a.gap_ref IS NULL THEN NULL ELSE jsonb_build_object(
      'answer', a.answer, 'amount', a.amount, 'covered_by', a.covered_by, 'note', a.note,
      'qualification', a.qualification, 'question', a.question, 'source', a.source, 'updated_at', a.updated_at
    ) END
  ) ORDER BY g.ref), '[]'::jsonb) INTO gaps
  FROM public.mcp_estimate_gap_items g
  LEFT JOIN public.mcp_estimate_gap_answers a ON a.job_id = g.job_id AND a.gap_ref = g.ref
  WHERE g.job_id = _job AND g.active;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'item_kind', item_kind, 'line_no', item_text, 'gap_ref', gap_ref, 'item_text', item_text, 'mark', mark,
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
      job_id, company_id, ref, kind, category, severity, title, reasoning, sheet, detail, spec_section, holds_bid, qty, unit, element, line_no, active,
      question, conditional, condition_text, exposure_low, exposure_high, schedule_activity, citations
    ) VALUES (
      _job, cid, it->>'ref', it->>'kind', it->>'category', it->>'severity', left(btrim(it->>'title'), 200), left(btrim(it->>'reasoning'), 2000),
      left(btrim(it->>'sheet'), 80), nullif(it->>'detail', ''), left(btrim(it->>'spec_section'), 80), coalesce((it->>'holds_bid')::boolean, false),
      CASE WHEN it->>'qty' IS NULL OR it->>'qty' = '' THEN NULL ELSE (it->>'qty')::numeric END,
      nullif(it->>'unit', ''), nullif(it->>'element', ''),
      CASE WHEN it->>'line_no' IS NULL OR it->>'line_no' = '' THEN NULL ELSE (it->>'line_no')::int END,
      true,
      left(nullif(btrim(coalesce(it->>'question', '')), ''), 500),
      coalesce((it->>'conditional')::boolean, false),
      left(nullif(btrim(coalesce(it->>'condition_text', '')), ''), 500),
      CASE WHEN coalesce(it->>'exposure_low', '') = '' THEN NULL ELSE greatest((it->>'exposure_low')::numeric, 0) END,
      CASE WHEN coalesce(it->>'exposure_high', '') = '' THEN NULL ELSE greatest((it->>'exposure_high')::numeric, 0) END,
      left(nullif(btrim(coalesce(it->>'schedule_activity', '')), ''), 200),
      CASE WHEN jsonb_typeof(it->'citations') = 'array' THEN it->'citations' ELSE '[]'::jsonb END
    )
    ON CONFLICT (job_id, ref) DO UPDATE SET
      kind = EXCLUDED.kind, category = EXCLUDED.category, severity = EXCLUDED.severity, title = EXCLUDED.title,
      reasoning = EXCLUDED.reasoning, sheet = EXCLUDED.sheet, detail = EXCLUDED.detail, spec_section = EXCLUDED.spec_section,
      holds_bid = EXCLUDED.holds_bid, qty = EXCLUDED.qty, unit = EXCLUDED.unit, element = EXCLUDED.element, line_no = EXCLUDED.line_no, active = true,
      question = EXCLUDED.question, conditional = EXCLUDED.conditional, condition_text = EXCLUDED.condition_text,
      exposure_low = EXCLUDED.exposure_low, exposure_high = EXCLUDED.exposure_high,
      schedule_activity = EXCLUDED.schedule_activity, citations = EXCLUDED.citations;
    n := n + 1;
  END LOOP;
  UPDATE public.mcp_estimate_gap_items g SET active = false
  WHERE g.job_id = _job AND g.active
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_items) i WHERE i->>'ref' = g.ref)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_estimate_verdicts v WHERE v.job_id = _job AND v.gap_ref = g.ref)
    AND NOT EXISTS (SELECT 1 FROM public.mcp_estimate_gap_answers a WHERE a.job_id = _job AND a.gap_ref = g.ref);
  RETURN jsonb_build_object('saved', n);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_gaps_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_gaps_save(uuid, jsonb) TO authenticated;

-- One answer per gap. Same rules the chat and the board check, so neither can save a half answer.
-- A conditional gap (owner's panel "if capacity allows") can't be marked covered by "somewhere else":
-- the owner can refuse on load, so it's carried, qualified, asked, or the owner agreed in writing.
CREATE OR REPLACE FUNCTION public.mcp_estimate_gap_answer_save(
  _job uuid, _gap text, _answer text, _amount numeric, _covered_by text, _note text, _qualification text, _question text, _source text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; g public.mcp_estimate_gap_items; n text; q text; rq text;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  SELECT * INTO g FROM public.mcp_estimate_gap_items WHERE job_id = _job AND ref = _gap AND active;
  IF g.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That gap is not on this estimate. Nothing was changed.'; END IF;
  IF _answer IS NULL OR _answer NOT IN ('carrying', 'covered', 'understood', 'rfi') THEN
    RAISE EXCEPTION 'MCP_BAD:Answer carrying, covered, understood or RFI. Nothing was changed.';
  END IF;
  IF coalesce(_source, 'chat') NOT IN ('chat', 'board', 'walkthrough', 'excel') THEN
    RAISE EXCEPTION 'MCP_BAD:Unknown answer source. Nothing was changed.';
  END IF;
  n := left(nullif(btrim(coalesce(_note, '')), ''), 1000);
  q := left(nullif(btrim(coalesce(_qualification, '')), ''), 1000);
  rq := left(nullif(btrim(coalesce(_question, '')), ''), 1000);
  IF _answer = 'carrying' AND (_amount IS NULL OR _amount < 0) THEN
    RAISE EXCEPTION 'MCP_BAD:Say what you''re carrying for it, in dollars. Nothing was changed.';
  END IF;
  IF _answer = 'covered' THEN
    IF _covered_by IS NULL OR _covered_by NOT IN ('takeoff_line', 'general_conditions', 'sub_quote', 'owner_in_writing', 'other') THEN
      RAISE EXCEPTION 'MCP_BAD:Say where it''s covered: a takeoff line, general conditions, a sub quote or the owner in writing. Nothing was changed.';
    END IF;
    IF n IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Name the line, quote or letter that covers it. Nothing was changed.'; END IF;
    IF g.conditional AND _covered_by = 'other' THEN
      RAISE EXCEPTION 'MCP_BAD:The note only lets you use the owner''s power if they agree, and they can say no on load. Carry the fallback, qualify it, ask an RFI, or get the owner to confirm it in writing. Nothing was changed.';
    END IF;
  END IF;
  IF _answer = 'understood' AND coalesce(q, n) IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Give the line that goes in the proposal as a qualification. Nothing was changed.';
  END IF;
  IF _answer = 'rfi' AND rq IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Write the RFI question you''re sending. Nothing was changed.';
  END IF;
  INSERT INTO public.mcp_estimate_gap_answers AS a (job_id, company_id, gap_ref, answer, amount, covered_by, note, qualification, question, source, answered_by, updated_at)
  VALUES (
    _job, cid, _gap, _answer,
    CASE WHEN _answer = 'carrying' THEN _amount END,
    CASE WHEN _answer = 'covered' THEN _covered_by END,
    n,
    CASE WHEN _answer = 'understood' THEN coalesce(q, n) END,
    CASE WHEN _answer = 'rfi' THEN rq END,
    coalesce(_source, 'chat'), auth.uid(), now()
  )
  ON CONFLICT (job_id, gap_ref) DO UPDATE SET
    answer = EXCLUDED.answer, amount = EXCLUDED.amount, covered_by = EXCLUDED.covered_by, note = EXCLUDED.note,
    qualification = EXCLUDED.qualification, question = EXCLUDED.question, source = EXCLUDED.source,
    answered_by = EXCLUDED.answered_by, updated_at = now();
  RETURN jsonb_build_object('saved', true, 'ref', _gap, 'answer', _answer);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_gap_answer_save(uuid, text, text, numeric, text, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_gap_answer_save(uuid, text, text, numeric, text, text, text, text, text) TO authenticated;

-- Move a card back to "To answer".
CREATE OR REPLACE FUNCTION public.mcp_estimate_gap_answer_clear(_job uuid, _gap text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; k int;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  DELETE FROM public.mcp_estimate_gap_answers WHERE job_id = _job AND gap_ref = _gap;
  GET DIAGNOSTICS k = ROW_COUNT;
  RETURN jsonb_build_object('cleared', k > 0, 'ref', _gap);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_gap_answer_clear(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_gap_answer_clear(uuid, text) TO authenticated;

-- The live board: every active gap with its answer and its latest estimator mark. The page polls this;
-- 'stamp' changes whenever an answer or a mark changes, so the page only redraws when something moved.
CREATE OR REPLACE FUNCTION public.mcp_estimate_gap_board(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; gaps jsonb; stamp text;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:This needs access to the estimate. Your role can''t see it.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'ref', g.ref, 'kind', g.kind, 'category', g.category, 'severity', g.severity, 'title', g.title, 'reasoning', g.reasoning,
    'sheet', g.sheet, 'detail', g.detail, 'spec_section', g.spec_section, 'holds_bid', g.holds_bid,
    'question', g.question, 'conditional', g.conditional, 'condition_text', g.condition_text,
    'exposure_low', g.exposure_low, 'exposure_high', g.exposure_high, 'schedule_activity', g.schedule_activity,
    'citations', g.citations,
    'answer', CASE WHEN a.gap_ref IS NULL THEN NULL ELSE jsonb_build_object(
      'answer', a.answer, 'amount', a.amount, 'covered_by', a.covered_by, 'note', a.note,
      'qualification', a.qualification, 'question', a.question, 'source', a.source, 'updated_at', a.updated_at
    ) END,
    'verdict', (
      SELECT jsonb_build_object('mark', v.mark, 'note', v.note, 'corrected_qty', v.corrected_qty, 'owner', v.owner)
      FROM public.mcp_estimate_verdicts v
      WHERE v.job_id = _job AND v.item_kind = 'gap' AND v.gap_ref = g.ref
      ORDER BY v.created_at DESC LIMIT 1
    )
  ) ORDER BY g.ref), '[]'::jsonb) INTO gaps
  FROM public.mcp_estimate_gap_items g
  LEFT JOIN public.mcp_estimate_gap_answers a ON a.job_id = g.job_id AND a.gap_ref = g.ref
  WHERE g.job_id = _job AND g.active;
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.mcp_estimate_gap_items WHERE job_id = _job AND active),
    (SELECT max(updated_at) FROM public.mcp_estimate_gap_answers WHERE job_id = _job),
    (SELECT count(*) FROM public.mcp_estimate_gap_answers WHERE job_id = _job),
    (SELECT max(created_at) FROM public.mcp_estimate_verdicts WHERE job_id = _job AND item_kind = 'gap'),
    (SELECT max(created_at) FROM public.mcp_estimate_gap_items WHERE job_id = _job)
  ) INTO stamp;
  RETURN jsonb_build_object(
    'job_number', j.job_number, 'job_name', j.name,
    'company', (SELECT name FROM public.mcp_companies WHERE id = j.company_id),
    'scope', sc, 'gaps', gaps, 'stamp', stamp
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_gap_board(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_gap_board(uuid) TO authenticated;
