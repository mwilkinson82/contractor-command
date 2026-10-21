-- Athena estimating bid walkthrough. Additive only: new tables and new functions.
-- Does not alter the takeoff, gap, or verdict tables. Same job scope as those tables
-- (full or contract). Super is rejected. Members can read. Writes go through the functions.
-- NOT APPLIED until this migration is reviewed.

CREATE TABLE IF NOT EXISTS public.mcp_estimate_pricing (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  labor jsonb NOT NULL DEFAULT '[]'::jsonb,
  material jsonb NOT NULL DEFAULT '[]'::jsonb,
  quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_general_conditions (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  start_date date,
  finish_date date,
  duration_days integer,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  ref text NOT NULL CHECK (ref ~ '^R-[0-9]+$'),
  kind text NOT NULL CHECK (kind IN ('consultants','testing','arborist','specialty_report','permits','special_safety','site_safety','scheduler','security')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  source_type text NOT NULL CHECK (source_type IN ('sheet','spec','contract')),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 80),
  citation text NOT NULL CHECK (length(btrim(citation)) BETWEEN 1 AND 500),
  placement text NOT NULL DEFAULT 'own_line' CHECK (placement IN ('gc','own_line')),
  amount numeric,
  confirmed boolean NOT NULL DEFAULT false,
  excluded boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, ref)
);
CREATE INDEX IF NOT EXISTS mcp_estimate_requirements_job_idx ON public.mcp_estimate_requirements (job_id, ref);

CREATE TABLE IF NOT EXISTS public.mcp_estimate_bids (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  overhead_pct numeric,
  profit_pct numeric,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (overhead_pct IS NULL OR overhead_pct >= 0),
  CHECK (profit_pct IS NULL OR profit_pct >= 0)
);

ALTER TABLE public.mcp_estimate_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_general_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_estimate_bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimate pricing read by contract scope" ON public.mcp_estimate_pricing;
CREATE POLICY "estimate pricing read by contract scope" ON public.mcp_estimate_pricing FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate gc read by contract scope" ON public.mcp_estimate_general_conditions;
CREATE POLICY "estimate gc read by contract scope" ON public.mcp_estimate_general_conditions FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate requirements read by contract scope" ON public.mcp_estimate_requirements;
CREATE POLICY "estimate requirements read by contract scope" ON public.mcp_estimate_requirements FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "estimate bid read by contract scope" ON public.mcp_estimate_bids;
CREATE POLICY "estimate bid read by contract scope" ON public.mcp_estimate_bids FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));

REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_pricing FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_general_conditions FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_requirements FROM anon, authenticated, public;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_estimate_bids FROM anon, authenticated, public;
GRANT SELECT ON public.mcp_estimate_pricing, public.mcp_estimate_general_conditions, public.mcp_estimate_requirements, public.mcp_estimate_bids TO authenticated;
GRANT ALL ON public.mcp_estimate_pricing, public.mcp_estimate_general_conditions, public.mcp_estimate_requirements, public.mcp_estimate_bids TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_estimate_bid_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; p public.mcp_estimate_pricing; g public.mcp_estimate_general_conditions; b public.mcp_estimate_bids; req jsonb;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  SELECT * INTO p FROM public.mcp_estimate_pricing WHERE job_id = _job;
  SELECT * INTO g FROM public.mcp_estimate_general_conditions WHERE job_id = _job;
  SELECT * INTO b FROM public.mcp_estimate_bids WHERE job_id = _job;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'ref', ref, 'kind', kind, 'label', label, 'source_type', source_type, 'source_ref', source_ref,
    'citation', citation, 'placement', placement, 'amount', amount, 'confirmed', confirmed, 'excluded', excluded
  ) ORDER BY ref), '[]'::jsonb) INTO req
  FROM public.mcp_estimate_requirements WHERE job_id = _job AND active;
  RETURN jsonb_build_object(
    'company_id', cid,
    'pricing', CASE WHEN p.job_id IS NULL THEN NULL ELSE jsonb_build_object('labor', p.labor, 'material', p.material, 'quotes', p.quotes, 'rate_sources', p.rate_sources) END,
    'general_conditions', CASE WHEN g.job_id IS NULL THEN NULL ELSE jsonb_build_object('start_date', g.start_date, 'finish_date', g.finish_date, 'duration_days', g.duration_days, 'lines', g.lines) END,
    'requirements', req,
    'bid', CASE WHEN b.job_id IS NULL THEN NULL ELSE jsonb_build_object('overhead_pct', b.overhead_pct, 'profit_pct', b.profit_pct) END
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_bid_get(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_bid_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_pricing_save(_job uuid, _labor jsonb, _material jsonb, _quotes jsonb, _sources jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  INSERT INTO public.mcp_estimate_pricing (job_id, company_id, labor, material, quotes, rate_sources)
  VALUES (_job, cid, coalesce(_labor, '[]'::jsonb), coalesce(_material, '[]'::jsonb), coalesce(_quotes, '[]'::jsonb), coalesce(_sources, '[]'::jsonb))
  ON CONFLICT (job_id) DO UPDATE SET
    labor = CASE WHEN _labor IS NULL THEN public.mcp_estimate_pricing.labor ELSE EXCLUDED.labor END,
    material = CASE WHEN _material IS NULL THEN public.mcp_estimate_pricing.material ELSE EXCLUDED.material END,
    quotes = CASE WHEN _quotes IS NULL THEN public.mcp_estimate_pricing.quotes ELSE EXCLUDED.quotes END,
    rate_sources = CASE WHEN _sources IS NULL THEN public.mcp_estimate_pricing.rate_sources ELSE EXCLUDED.rate_sources END,
    updated_by = auth.uid(),
    updated_at = now();
  RETURN jsonb_build_object('saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_pricing_save(uuid, jsonb, jsonb, jsonb, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_pricing_save(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_gc_save(_job uuid, _start date, _finish date, _days integer, _lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _days IS NOT NULL AND _days < 1 THEN RAISE EXCEPTION 'MCP_BAD:Schedule duration has to be at least one day. Nothing was saved.'; END IF;
  INSERT INTO public.mcp_estimate_general_conditions (job_id, company_id, start_date, finish_date, duration_days, lines)
  VALUES (_job, cid, _start, _finish, _days, coalesce(_lines, '[]'::jsonb))
  ON CONFLICT (job_id) DO UPDATE SET
    start_date = EXCLUDED.start_date, finish_date = EXCLUDED.finish_date, duration_days = EXCLUDED.duration_days,
    lines = EXCLUDED.lines, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_gc_save(uuid, date, date, integer, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_gc_save(uuid, date, date, integer, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_requirements_save(_job uuid, _items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; it jsonb; n int := 0;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF jsonb_typeof(coalesce(_items, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'MCP_BAD:Send the requirement list. Nothing was saved.'; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) LOOP
    IF coalesce(it->>'ref', '') !~ '^R-[0-9]+$' THEN RAISE EXCEPTION 'MCP_BAD:Each requirement needs a number. Nothing was saved.'; END IF;
    IF length(btrim(coalesce(it->>'citation', ''))) < 1 OR length(btrim(coalesce(it->>'source_ref', ''))) < 1 THEN
      RAISE EXCEPTION 'MCP_BAD:Each requirement cites a sheet, a spec section, or a contract clause. Nothing was saved.';
    END IF;
    INSERT INTO public.mcp_estimate_requirements (
      job_id, company_id, ref, kind, label, source_type, source_ref, citation, placement, amount, confirmed, excluded, active
    ) VALUES (
      _job, cid, it->>'ref', it->>'kind', left(btrim(it->>'label'), 200), it->>'source_type', left(btrim(it->>'source_ref'), 80),
      left(btrim(it->>'citation'), 500), coalesce(nullif(it->>'placement', ''), 'own_line'),
      CASE WHEN it->>'amount' IS NULL OR it->>'amount' = '' THEN NULL ELSE (it->>'amount')::numeric END,
      coalesce((it->>'confirmed')::boolean, false), coalesce((it->>'excluded')::boolean, false), true
    )
    ON CONFLICT (job_id, ref) DO UPDATE SET
      kind = EXCLUDED.kind, label = EXCLUDED.label, source_type = EXCLUDED.source_type, source_ref = EXCLUDED.source_ref,
      citation = EXCLUDED.citation, placement = EXCLUDED.placement, amount = EXCLUDED.amount,
      confirmed = EXCLUDED.confirmed, excluded = EXCLUDED.excluded, active = true;
    n := n + 1;
  END LOOP;
  UPDATE public.mcp_estimate_requirements r SET active = false
  WHERE r.job_id = _job AND r.active
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) i WHERE i->>'ref' = r.ref);
  RETURN jsonb_build_object('saved', n);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_requirements_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_requirements_save(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_estimate_bid_save(_job uuid, _overhead numeric, _profit numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF _overhead IS NOT NULL AND _overhead < 0 OR _profit IS NOT NULL AND _profit < 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Overhead and profit can''t be negative. Nothing was saved.';
  END IF;
  INSERT INTO public.mcp_estimate_bids (job_id, company_id, overhead_pct, profit_pct)
  VALUES (_job, cid, _overhead, _profit)
  ON CONFLICT (job_id) DO UPDATE SET overhead_pct = EXCLUDED.overhead_pct, profit_pct = EXCLUDED.profit_pct, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('saved', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_estimate_bid_save(uuid, numeric, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_estimate_bid_save(uuid, numeric, numeric) TO authenticated;
