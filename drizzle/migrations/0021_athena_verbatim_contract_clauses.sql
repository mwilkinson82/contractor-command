-- 0021: contract clauses stored verbatim, one row per clause.
-- A clause is "document" only when its text appears exactly in the stored contract text (ignoring whitespace and
-- markdown); otherwise it is "unverified". Days, day type and trigger are parsed from the clause's own text.

-- The contract text as uploaded (needed to verify clauses and to re-extract later). Full job access only.
CREATE TABLE public.mcp_contract_documents (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  name text NOT NULL,
  body text NOT NULL,
  body_sha256 text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mcp_contract_documents TO authenticated;
GRANT ALL ON public.mcp_contract_documents TO service_role;
ALTER TABLE public.mcp_contract_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract documents read by contract scope" ON public.mcp_contract_documents FOR SELECT TO authenticated
  USING (public.mcp_can_access_contract(job_id));

CREATE TABLE public.mcp_contract_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  section text NOT NULL CHECK (length(section) BETWEEN 1 AND 40),
  heading text CHECK (heading IS NULL OR length(heading) <= 200),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('delay_notice','claim_notice','nonpayment_notice','cure_notice','schedule_disagreement','other')),
  verbatim_text text NOT NULL CHECK (length(verbatim_text) BETWEEN 1 AND 10000),
  n_days int,
  day_type text CHECK (day_type IS NULL OR day_type IN ('calendar','business','working')),
  trigger_desc text,
  parse_source text NOT NULL DEFAULT 'clause_text' CHECK (parse_source IN ('clause_text','none')),
  source text NOT NULL CHECK (source IN ('document','unverified')),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, section)
);
GRANT SELECT ON public.mcp_contract_clauses TO authenticated;
GRANT ALL ON public.mcp_contract_clauses TO service_role;
ALTER TABLE public.mcp_contract_clauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contract clauses read by contract scope" ON public.mcp_contract_clauses FOR SELECT TO authenticated
  USING (public.mcp_can_access_contract(job_id));

-- Comparison form: markdown marks, curly quotes/dashes and whitespace runs ignored; wording and case kept.
CREATE OR REPLACE FUNCTION public.mcp_clause_norm(_s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    translate(regexp_replace(coalesce(_s, ''), '[*_`#>]+', '', 'g'), '‘’“”–—', '''''""--'),
    '\s+', ' ', 'g'))
$$;

-- Save the contract text (optional) and clauses. Returns each clause with its verified source.
CREATE OR REPLACE FUNCTION public.mcp_clauses_save(_job uuid, _doc jsonb, _clauses jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sc text; j public.mcp_jobs; body text; c jsonb; txt text; src text; out jsonb := '[]'::jsonb; sec text;
BEGIN
  sc := public.mcp_assert_job_scope(_job);
  IF sc NOT IN ('full','contract') THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF _doc IS NOT NULL AND nullif(btrim(_doc->>'body'), '') IS NOT NULL THEN
    INSERT INTO public.mcp_contract_documents (job_id, company_id, name, body, body_sha256)
    VALUES (_job, j.company_id, left(coalesce(nullif(btrim(_doc->>'name'), ''), 'contract'), 300), _doc->>'body', encode(sha256(convert_to(_doc->>'body', 'UTF8')), 'hex'))
    ON CONFLICT (job_id) DO UPDATE SET name = EXCLUDED.name, body = EXCLUDED.body, body_sha256 = EXCLUDED.body_sha256, updated_at = now(), created_by = auth.uid();
  END IF;
  SELECT d.body INTO body FROM public.mcp_contract_documents d WHERE d.job_id = _job;
  FOR c IN SELECT value FROM jsonb_array_elements(coalesce(_clauses, '[]'::jsonb)) LOOP
    txt := btrim(c->>'text');
    sec := btrim(c->>'section');
    IF txt IS NULL OR txt = '' OR sec IS NULL OR sec = '' THEN RAISE EXCEPTION 'MCP_BAD:each clause needs section and text'; END IF;
    src := CASE WHEN body IS NOT NULL AND length(public.mcp_clause_norm(txt)) > 0
                 AND position(public.mcp_clause_norm(txt) IN public.mcp_clause_norm(body)) > 0 THEN 'document' ELSE 'unverified' END;
    INSERT INTO public.mcp_contract_clauses (job_id, company_id, section, heading, category, verbatim_text, n_days, day_type, trigger_desc, parse_source, source)
    VALUES (_job, j.company_id, sec, nullif(btrim(c->>'heading'), ''), coalesce(nullif(c->>'category', ''), 'other'), txt,
      nullif(c->>'n_days', '')::int, nullif(c->>'day_type', ''), nullif(c->>'trigger_desc', ''),
      CASE WHEN nullif(c->>'n_days', '') IS NULL AND nullif(c->>'trigger_desc', '') IS NULL THEN 'none' ELSE 'clause_text' END, src)
    ON CONFLICT (job_id, section) DO UPDATE SET heading = EXCLUDED.heading, category = EXCLUDED.category, verbatim_text = EXCLUDED.verbatim_text,
      n_days = EXCLUDED.n_days, day_type = EXCLUDED.day_type, trigger_desc = EXCLUDED.trigger_desc, parse_source = EXCLUDED.parse_source,
      source = EXCLUDED.source, updated_at = now(), created_by = auth.uid();
    out := out || jsonb_build_object('section', sec, 'source', src);
  END LOOP;
  PERFORM public.mcp_audit_job(_job, 'intake', 'contract_clauses_save', NULL);
  RETURN jsonb_build_object('clauses', out, 'has_document', body IS NOT NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_clauses_save(uuid, jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_clauses_save(uuid, jsonb, jsonb) TO authenticated;
