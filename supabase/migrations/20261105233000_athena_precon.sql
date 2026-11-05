-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105220000_athena_payment_proofs.sql. Needs the job contracts (20261105170000_athena_job_contracts.sql),
-- billing evidence (20261101120001_athena_project_billing_evidence.sql) and the project record
-- (20261029120000_athena_submittal_record_page.sql: mcp_project_record_add).
--
-- Pre-construction agreements.
-- Before: a job in Athena started at the estimate. A residential GC who sells a pre-construction agreement (a fee to
-- get the owner's ideas drawn by an architect or draftsman, guide the design, and then estimate the real drawings)
-- had nowhere to keep it: not the fee build-up, not the terms, not where the job stood in design.
-- After:
--   * public.mcp_precon_agreements: at most one per job, and only on jobs that start with pre-con. Holds the design
--     partner and their fee and duration, an optional markup on that fee, the contractor's own time as lines of
--     hours at one hourly rate, the price (computed here, never typed), what the owner gets (client-facing list),
--     billing (in full at signing, or half at signing and half at final drawings), that the owner owns the
--     drawings, and an optional credit of the fee toward the construction contract within N days of final
--     drawings. Then where it stands: sent, signed (by whom, how), final drawings approved, hours used, and the
--     outcome (won: the owner hired the contractor; lost: the owner took the drawings elsewhere).
--   * The agreement's own invoices are ordinary billing invoices on the job (mcp_billing_invoices, kind invoice),
--     linked here by id; a credit toward the construction contract is an ordinary posted billing credit
--     (kind credit) against a construction invoice or pay application, linked here too. Nothing new is billed here.
--   * Read with mcp_precon_get; written only by mcp_precon_save (terms, before signing) and mcp_precon_step (where
--     it stands). Full and contract job access read and write; a Super sees nothing. Every step lands in the
--     project record.
--   * The fee build-up (design cost, markup, hours, rate) is the contractor's; no client-facing function reads it.
-- Rollback: supabase/rollbacks/20261105233000_athena_precon.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS mcp_private;

-- 1. The agreement.
CREATE TABLE IF NOT EXISTS public.mcp_precon_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.mcp_jobs(id),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'closed')),
  design_partner text CHECK (design_partner IS NULL OR (design_partner = btrim(design_partner) AND length(design_partner) BETWEEN 1 AND 200)),
  design_role text CHECK (design_role IS NULL OR design_role IN ('architect', 'draftsman', 'engineer', 'designer', 'other')),
  design_fee_cents bigint NOT NULL DEFAULT 0 CHECK (design_fee_cents BETWEEN 0 AND 100000000000),
  design_days integer CHECK (design_days IS NULL OR design_days BETWEEN 1 AND 1000),
  design_markup_bps integer NOT NULL DEFAULT 0 CHECK (design_markup_bps BETWEEN 0 AND 10000),
  hourly_rate_cents bigint NOT NULL DEFAULT 0 CHECK (hourly_rate_cents BETWEEN 0 AND 10000000),
  time_lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(time_lines) = 'array' AND jsonb_array_length(time_lines) <= 20),
  includes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(includes) = 'array' AND jsonb_array_length(includes) <= 12),
  billing text NOT NULL DEFAULT 'split' CHECK (billing IN ('full', 'split')),
  owner_owns_drawings boolean NOT NULL DEFAULT true,
  credit boolean NOT NULL DEFAULT false,
  credit_days integer CHECK (credit_days IS NULL OR credit_days BETWEEN 1 AND 730),
  price_cents bigint NOT NULL DEFAULT 0 CHECK (price_cents BETWEEN 0 AND 200000000000),
  hours_used numeric(8,2) NOT NULL DEFAULT 0 CHECK (hours_used BETWEEN 0 AND 100000),
  sent_on date,
  signed_on date,
  signed_name text CHECK (signed_name IS NULL OR length(btrim(signed_name)) BETWEEN 1 AND 200),
  signed_via text CHECK (signed_via IS NULL OR signed_via IN ('client_page', 'paper', 'email')),
  drawings_approved_on date,
  outcome text CHECK (outcome IS NULL OR outcome IN ('won', 'lost')),
  closed_on date,
  invoice_ids uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(invoice_ids) <= 12),
  credit_invoice_id uuid REFERENCES public.mcp_billing_invoices(id),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (credit = (credit_days IS NOT NULL)),
  CHECK ((status IN ('signed', 'closed')) OR (signed_on IS NULL AND drawings_approved_on IS NULL)),
  CHECK ((signed_on IS NULL) = (signed_name IS NULL)),
  CHECK ((status = 'closed') = (outcome IS NOT NULL) AND (outcome IS NULL) = (closed_on IS NULL)),
  CHECK (drawings_approved_on IS NULL OR signed_on IS NULL OR drawings_approved_on >= signed_on)
);
COMMENT ON TABLE public.mcp_precon_agreements IS 'Pre-construction agreement on a job: fee build-up, terms, and where pre-con stands. Written only by mcp_precon_save and mcp_precon_step.';
COMMENT ON COLUMN public.mcp_precon_agreements.time_lines IS 'The contractor''s own time: [{label, hours, note}] priced at hourly_rate_cents. Contractor-only.';
COMMENT ON COLUMN public.mcp_precon_agreements.includes IS 'What the owner gets, in the contractor''s words, for the client page: an array of short strings.';
COMMENT ON COLUMN public.mcp_precon_agreements.invoice_ids IS 'The agreement''s own invoices on the job (mcp_billing_invoices, kind invoice).';
COMMENT ON COLUMN public.mcp_precon_agreements.credit_invoice_id IS 'The posted billing credit that applied the pre-con fee to the construction contract.';

ALTER TABLE public.mcp_precon_agreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_precon_agreements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_precon_agreements TO service_role;

-- 2. Helpers.
-- The job, after the membership gate and the role check. Full and contract access only.
CREATE OR REPLACE FUNCTION mcp_private.precon_job(_job uuid) RETURNS public.mcp_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sc text; j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN
    RAISE EXCEPTION 'MCP_BAD:Pre-construction needs full or contract access to the job. Your role can''t see it.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_job(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The price, from the build-up: design fee plus its markup, plus every time line at the hourly rate. Whole cents,
-- each part rounded half up.
CREATE OR REPLACE FUNCTION mcp_private.precon_parts(_fee bigint, _markup_bps integer, _rate bigint, _lines jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH t AS (
    SELECT coalesce(sum((x->>'hours')::numeric), 0) AS hours FROM jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) x
  ), p AS (
    SELECT round(_fee * _markup_bps / 10000.0)::bigint AS markup, round(t.hours * _rate)::bigint AS time_cents, t.hours FROM t
  )
  SELECT jsonb_build_object('design_cents', _fee, 'markup_cents', p.markup, 'hours', p.hours, 'time_cents', p.time_cents,
    'price_cents', _fee + p.markup + p.time_cents) FROM p
$$;
REVOKE ALL ON FUNCTION mcp_private.precon_parts(bigint, integer, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Where the job stands: agreement (draft or sent), design (signed), estimate (final drawings approved), proposal
-- (a prime contract is drafted or sent), contract (the prime contract is signed), closed (the owner took the
-- drawings elsewhere).
CREATE OR REPLACE FUNCTION mcp_private.precon_phase(a public.mcp_precon_agreements) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE prime text;
BEGIN
  IF a.outcome = 'lost' THEN RETURN 'closed'; END IF;
  SELECT status INTO prime FROM public.mcp_job_contracts WHERE job_id = a.job_id AND kind = 'prime' AND status <> 'void' LIMIT 1;
  IF prime = 'signed' OR a.outcome = 'won' THEN RETURN 'contract'; END IF;
  IF prime IN ('draft', 'sent') THEN RETURN 'proposal'; END IF;
  IF a.drawings_approved_on IS NOT NULL THEN RETURN 'estimate'; END IF;
  IF a.status = 'signed' THEN RETURN 'design'; END IF;
  RETURN 'agreement';
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_phase(public.mcp_precon_agreements) FROM PUBLIC, anon, authenticated, service_role;

-- One linked billing invoice: its number, latest status and amount, and what has been paid or credited on it.
CREATE OR REPLACE FUNCTION mcp_private.precon_invoice_json(_job uuid, _invoice uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', i.id, 'number', i.document_number, 'kind', i.kind, 'status', v.status,
    'invoice_date', v.invoice_date, 'net_due_cents', v.net_due_cents,
    'paid_cents', coalesce((SELECT sum(CASE WHEN a.reversal_of IS NULL THEN a.amount_cents ELSE -a.amount_cents END)
      FROM public.mcp_billing_allocations a WHERE a.invoice_id = i.id AND a.job_id = _job), 0),
    'credited_cents', public.mcp_billing_posted_credits(_job, i.id, NULL)::bigint,
    'credit_for', i.credit_for)
  FROM public.mcp_billing_invoices i
  JOIN LATERAL (SELECT * FROM public.mcp_billing_invoice_versions x WHERE x.invoice_id = i.id ORDER BY x.version DESC LIMIT 1) v ON true
  WHERE i.id = _invoice AND i.job_id = _job
$$;
REVOKE ALL ON FUNCTION mcp_private.precon_invoice_json(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The agreement as members read it, with the price parts, the installments, the phase, the credit window and the
-- linked invoices.
CREATE OR REPLACE FUNCTION mcp_private.precon_json(a public.mcp_precon_agreements) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parts jsonb; invs jsonb; first_cents bigint;
BEGIN
  parts := mcp_private.precon_parts(a.design_fee_cents, a.design_markup_bps, a.hourly_rate_cents, a.time_lines);
  first_cents := CASE WHEN a.billing = 'full' THEN a.price_cents ELSE (a.price_cents + 1) / 2 END;
  SELECT coalesce(jsonb_agg(mcp_private.precon_invoice_json(a.job_id, x) ORDER BY o), '[]'::jsonb) INTO invs
    FROM unnest(a.invoice_ids) WITH ORDINALITY u(x, o) WHERE mcp_private.precon_invoice_json(a.job_id, x) IS NOT NULL;
  RETURN jsonb_build_object(
    'id', a.id, 'job_id', a.job_id, 'version', a.version, 'status', a.status, 'phase', mcp_private.precon_phase(a),
    'design_partner', a.design_partner, 'design_role', a.design_role, 'design_fee_cents', a.design_fee_cents,
    'design_days', a.design_days, 'design_markup_bps', a.design_markup_bps, 'hourly_rate_cents', a.hourly_rate_cents,
    'time_lines', a.time_lines, 'includes', a.includes, 'billing', a.billing, 'owner_owns_drawings', a.owner_owns_drawings,
    'credit', a.credit, 'credit_days', a.credit_days,
    'credit_until', CASE WHEN a.credit AND a.drawings_approved_on IS NOT NULL THEN a.drawings_approved_on + a.credit_days END,
    'price_cents', a.price_cents, 'parts', parts,
    'installments', CASE WHEN a.billing = 'full'
      THEN jsonb_build_array(jsonb_build_object('when', 'signing', 'amount_cents', a.price_cents))
      ELSE jsonb_build_array(jsonb_build_object('when', 'signing', 'amount_cents', first_cents),
        jsonb_build_object('when', 'final_drawings', 'amount_cents', a.price_cents - first_cents)) END,
    'hours_used', a.hours_used, 'sent_on', a.sent_on, 'signed_on', a.signed_on, 'signed_name', a.signed_name,
    'signed_via', a.signed_via, 'drawings_approved_on', a.drawings_approved_on, 'outcome', a.outcome, 'closed_on', a.closed_on,
    'invoices', invs,
    'credit_invoice', CASE WHEN a.credit_invoice_id IS NULL THEN NULL ELSE mcp_private.precon_invoice_json(a.job_id, a.credit_invoice_id) END,
    'note', a.note, 'updated_at', a.updated_at);
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_json(public.mcp_precon_agreements) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Read. A job with no pre-con returns status none.
CREATE OR REPLACE FUNCTION public.mcp_precon_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_precon_agreements;
BEGIN
  j := mcp_private.precon_job(_job);
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE job_id = j.id;
  IF a.id IS NULL THEN
    RETURN jsonb_build_object('status', 'none', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name);
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'agreement', mcp_private.precon_json(a));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_get(uuid) TO authenticated;

-- 4. Save the terms: create (expected_version 0) or update the draft or sent agreement against the version the
-- member loaded. Only the fields present change. Once signed, the terms are fixed; a change is a new agreement.
CREATE OR REPLACE FUNCTION public.mcp_precon_save(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; cur public.mcp_precon_agreements; nxt public.mcp_precon_agreements; ev integer; bad text;
  l jsonb; parts jsonb; n integer := 0; h numeric; s text;
  allowed constant text[] := ARRAY['expected_version', 'design_partner', 'design_role', 'design_fee_cents', 'design_days',
    'design_markup_bps', 'hourly_rate_cents', 'time_lines', 'includes', 'billing', 'credit', 'credit_days', 'note'];
BEGIN
  j := mcp_private.precon_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR octet_length(_p::text) > 20000 THEN
    RAISE EXCEPTION 'MCP_BAD:The agreement details are missing or too large.';
  END IF;
  SELECT string_agg(x, ', ' ORDER BY x) INTO bad FROM jsonb_object_keys(_p) x WHERE x <> ALL (allowed);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Athena doesn''t keep % on a pre-construction agreement.', replace(bad, '_', ' '); END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'MCP_BAD:Send the version you loaded (0 for a new agreement).';
  END IF;
  ev := (_p->>'expected_version')::integer;
  PERFORM pg_advisory_xact_lock(hashtext(j.id::text || ':precon'));
  SELECT * INTO cur FROM public.mcp_precon_agreements WHERE job_id = j.id FOR UPDATE;
  IF cur.id IS NULL THEN
    IF ev <> 0 THEN RAISE EXCEPTION 'MCP_BAD:This job has no pre-construction agreement yet. Start one with version 0.'; END IF;
    cur.job_id := j.id; cur.company_id := j.company_id; cur.status := 'draft'; cur.version := 0;
    cur.design_fee_cents := 0; cur.design_markup_bps := 0; cur.hourly_rate_cents := 0; cur.time_lines := '[]'::jsonb;
    cur.includes := '[]'::jsonb; cur.billing := 'split'; cur.owner_owns_drawings := true; cur.credit := false;
    cur.hours_used := 0; cur.invoice_ids := '{}'::uuid[];
  ELSE
    IF ev <> cur.version THEN
      RAISE EXCEPTION 'MCP_BAD:The agreement changed since you loaded it (now version %). Load it again.', cur.version;
    END IF;
    IF cur.status NOT IN ('draft', 'sent') THEN
      RAISE EXCEPTION 'MCP_BAD:The agreement is signed, so its terms are fixed. Agree any change with the owner first.';
    END IF;
  END IF;
  nxt := cur;

  IF _p ? 'design_partner' THEN
    IF jsonb_typeof(_p->'design_partner') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'MCP_BAD:Write the design partner''s name as text.'; END IF;
    s := nullif(btrim(coalesce(_p->>'design_partner', '')), '');
    IF length(s) > 200 THEN RAISE EXCEPTION 'MCP_BAD:Keep the design partner''s name to 200 characters.'; END IF;
    nxt.design_partner := s;
  END IF;
  IF _p ? 'design_role' THEN
    IF coalesce(_p->>'design_role', '') NOT IN ('', 'architect', 'draftsman', 'engineer', 'designer', 'other') THEN
      RAISE EXCEPTION 'MCP_BAD:The design partner is an architect, draftsman, engineer, designer or other.';
    END IF;
    nxt.design_role := nullif(_p->>'design_role', '');
  END IF;
  IF _p ? 'design_fee_cents' THEN
    IF jsonb_typeof(_p->'design_fee_cents') <> 'number' OR (_p->>'design_fee_cents')::numeric <> trunc((_p->>'design_fee_cents')::numeric)
       OR (_p->>'design_fee_cents')::numeric NOT BETWEEN 0 AND 100000000000 THEN
      RAISE EXCEPTION 'MCP_BAD:Enter the design fee in whole cents.';
    END IF;
    nxt.design_fee_cents := (_p->>'design_fee_cents')::bigint;
  END IF;
  IF _p ? 'design_days' THEN
    IF jsonb_typeof(_p->'design_days') NOT IN ('number', 'null') OR (_p->>'design_days')::numeric <> trunc((_p->>'design_days')::numeric)
       OR (_p->>'design_days')::numeric NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'MCP_BAD:Enter the design duration in whole days, 1 to 1000.';
    END IF;
    nxt.design_days := (_p->>'design_days')::integer;
  END IF;
  IF _p ? 'design_markup_bps' THEN
    IF jsonb_typeof(_p->'design_markup_bps') <> 'number' OR (_p->>'design_markup_bps')::numeric <> trunc((_p->>'design_markup_bps')::numeric)
       OR (_p->>'design_markup_bps')::numeric NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION 'MCP_BAD:The markup on the design fee is 0%% to 100%%.';
    END IF;
    nxt.design_markup_bps := (_p->>'design_markup_bps')::integer;
  END IF;
  IF _p ? 'hourly_rate_cents' THEN
    IF jsonb_typeof(_p->'hourly_rate_cents') <> 'number' OR (_p->>'hourly_rate_cents')::numeric <> trunc((_p->>'hourly_rate_cents')::numeric)
       OR (_p->>'hourly_rate_cents')::numeric NOT BETWEEN 0 AND 10000000 THEN
      RAISE EXCEPTION 'MCP_BAD:Enter your hourly rate in whole cents.';
    END IF;
    nxt.hourly_rate_cents := (_p->>'hourly_rate_cents')::bigint;
  END IF;
  IF _p ? 'time_lines' THEN
    IF jsonb_typeof(_p->'time_lines') <> 'array' OR jsonb_array_length(_p->'time_lines') > 20 THEN
      RAISE EXCEPTION 'MCP_BAD:List your time as up to 20 lines of hours.';
    END IF;
    nxt.time_lines := '[]'::jsonb;
    FOR l IN SELECT value FROM jsonb_array_elements(_p->'time_lines') LOOP
      n := n + 1;
      IF jsonb_typeof(l) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN ('label', 'hours', 'note'))
         OR jsonb_typeof(l->'label') <> 'string' OR length(btrim(l->>'label')) NOT BETWEEN 1 AND 120
         OR jsonb_typeof(l->'hours') <> 'number' OR (l->>'hours')::numeric <= 0 OR (l->>'hours')::numeric > 2000
         OR (l->>'hours')::numeric * 4 <> trunc((l->>'hours')::numeric * 4)
         OR (l ? 'note' AND jsonb_typeof(l->'note') NOT IN ('string', 'null'))
         OR length(coalesce(l->>'note', '')) > 300 THEN
        RAISE EXCEPTION 'MCP_BAD:Time line % needs a short label and hours in quarter hours (up to 2000).', n;
      END IF;
      h := (l->>'hours')::numeric;
      nxt.time_lines := nxt.time_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('label', btrim(l->>'label'),
        'hours', h, 'note', nullif(btrim(coalesce(l->>'note', '')), ''))));
    END LOOP;
  END IF;
  IF _p ? 'includes' THEN
    IF jsonb_typeof(_p->'includes') <> 'array' OR jsonb_array_length(_p->'includes') > 12
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(_p->'includes') x WHERE jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 200) THEN
      RAISE EXCEPTION 'MCP_BAD:List what the owner gets as up to 12 short lines.';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(btrim(x #>> '{}'))), '[]'::jsonb) INTO nxt.includes FROM jsonb_array_elements(_p->'includes') x;
  END IF;
  IF _p ? 'billing' THEN
    IF coalesce(_p->>'billing', '') NOT IN ('full', 'split') THEN
      RAISE EXCEPTION 'MCP_BAD:Bill the agreement in full at signing (full) or half at signing and half at final drawings (split).';
    END IF;
    nxt.billing := _p->>'billing';
  END IF;
  IF _p ? 'credit' THEN
    IF jsonb_typeof(_p->'credit') <> 'boolean' THEN RAISE EXCEPTION 'MCP_BAD:Say whether the fee is credited if the owner hires you.'; END IF;
    nxt.credit := (_p->>'credit')::boolean;
    IF NOT nxt.credit THEN nxt.credit_days := NULL; END IF;
  END IF;
  IF _p ? 'credit_days' AND nxt.credit THEN
    IF jsonb_typeof(_p->'credit_days') <> 'number' OR (_p->>'credit_days')::numeric <> trunc((_p->>'credit_days')::numeric)
       OR (_p->>'credit_days')::numeric NOT BETWEEN 1 AND 730 THEN
      RAISE EXCEPTION 'MCP_BAD:The credit window is 1 to 730 days after final drawings.';
    END IF;
    nxt.credit_days := (_p->>'credit_days')::integer;
  END IF;
  IF nxt.credit AND nxt.credit_days IS NULL THEN nxt.credit_days := 90; END IF;
  IF _p ? 'note' THEN
    IF jsonb_typeof(_p->'note') NOT IN ('string', 'null') OR length(coalesce(_p->>'note', '')) > 2000 THEN
      RAISE EXCEPTION 'MCP_BAD:Keep the note to 2000 characters.';
    END IF;
    nxt.note := nullif(btrim(coalesce(_p->>'note', '')), '');
  END IF;

  parts := mcp_private.precon_parts(nxt.design_fee_cents, nxt.design_markup_bps, nxt.hourly_rate_cents, nxt.time_lines);
  nxt.price_cents := (parts->>'price_cents')::bigint;
  IF nxt.price_cents > 200000000000 THEN RAISE EXCEPTION 'MCP_BAD:That agreement price is out of range.'; END IF;

  IF cur.id IS NULL THEN
    INSERT INTO public.mcp_precon_agreements (job_id, company_id, status, design_partner, design_role, design_fee_cents, design_days,
      design_markup_bps, hourly_rate_cents, time_lines, includes, billing, owner_owns_drawings, credit, credit_days, price_cents,
      note, version, created_by, updated_by)
    VALUES (j.id, j.company_id, 'draft', nxt.design_partner, nxt.design_role, nxt.design_fee_cents, nxt.design_days,
      nxt.design_markup_bps, nxt.hourly_rate_cents, nxt.time_lines, nxt.includes, nxt.billing, true, nxt.credit, nxt.credit_days,
      nxt.price_cents, nxt.note, 1, auth.uid(), auth.uid())
    RETURNING * INTO nxt;
    PERFORM public.mcp_project_record_add(j.id, 'precon_started', 'Pre-construction agreement started',
      'Pre-construction agreement drafted at ' || to_char(nxt.price_cents / 100.0, 'FM$999,999,999,990.00') || '.',
      NULL, NULL, 'mcp_precon_agreements', nxt.id, '{}'::jsonb, 'user', NULL, NULL);
  ELSE
    UPDATE public.mcp_precon_agreements SET design_partner = nxt.design_partner, design_role = nxt.design_role,
      design_fee_cents = nxt.design_fee_cents, design_days = nxt.design_days, design_markup_bps = nxt.design_markup_bps,
      hourly_rate_cents = nxt.hourly_rate_cents, time_lines = nxt.time_lines, includes = nxt.includes, billing = nxt.billing,
      credit = nxt.credit, credit_days = nxt.credit_days, price_cents = nxt.price_cents, note = nxt.note,
      version = cur.version + 1, updated_by = auth.uid(), updated_at = now()
    WHERE id = cur.id RETURNING * INTO nxt;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'agreement', mcp_private.precon_json(nxt));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_save(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_save(uuid, jsonb) TO authenticated;

-- 5. Move the agreement along, against the version the member loaded:
--   sent              {on}                         the agreement went to the owner
--   signed            {on, name, via}              the owner signed (client_page, paper or email)
--   drawings_approved {on}                         the owner approved the final drawings
--   hours             {hours}                      hours used so far against the agreement (a total, not an addition)
--   link_invoice      {invoice_id}                 an agreement invoice on this job (kind invoice)
--   link_credit       {invoice_id}                 the posted credit (kind credit) that applied the fee
--   won | lost        {on}                         close pre-con: the owner hired you, or took the drawings elsewhere
--   reopen            {}                           undo a close
CREATE OR REPLACE FUNCTION public.mcp_precon_step(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_precon_agreements; act text; d date; tz text; today date; inv public.mcp_billing_invoices;
  title text; summary text; ev integer; nm text; via text; hrs numeric; money text;
BEGIN
  j := mcp_private.precon_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR octet_length(_p::text) > 4000 THEN RAISE EXCEPTION 'MCP_BAD:The step details are missing.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('action', 'expected_version', 'on', 'name', 'via', 'hours', 'invoice_id')) THEN
    RAISE EXCEPTION 'MCP_BAD:That step has details Athena doesn''t use.';
  END IF;
  act := _p->>'action';
  IF act IS NULL OR act NOT IN ('sent', 'signed', 'drawings_approved', 'hours', 'link_invoice', 'link_credit', 'won', 'lost', 'reopen') THEN
    RAISE EXCEPTION 'MCP_BAD:Choose a step: sent, signed, drawings_approved, hours, link_invoice, link_credit, won, lost or reopen.';
  END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Send the version you loaded.'; END IF;
  ev := (_p->>'expected_version')::integer;
  tz := coalesce(nullif(j.time_zone, ''), 'UTC');
  today := (now() AT TIME ZONE tz)::date;
  BEGIN
    d := coalesce(nullif(_p->>'on', '')::date, today);
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'MCP_BAD:Write the date as YYYY-MM-DD.';
  END;
  IF d > today + 1 OR d < today - 3650 THEN RAISE EXCEPTION 'MCP_BAD:That date is out of range.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(j.id::text || ':precon'));
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE job_id = j.id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This job has no pre-construction agreement.'; END IF;
  IF ev <> a.version THEN RAISE EXCEPTION 'MCP_BAD:The agreement changed since you loaded it (now version %). Load it again.', a.version; END IF;
  IF a.status = 'closed' AND act NOT IN ('reopen', 'link_credit', 'hours') THEN
    RAISE EXCEPTION 'MCP_BAD:Pre-construction is closed on this job. Reopen it first.';
  END IF;
  money := to_char(a.price_cents / 100.0, 'FM$999,999,999,990.00');

  IF act = 'sent' THEN
    IF a.status <> 'draft' AND a.status <> 'sent' THEN RAISE EXCEPTION 'MCP_BAD:The agreement is already signed.'; END IF;
    IF a.price_cents <= 0 THEN RAISE EXCEPTION 'MCP_BAD:Price the agreement before sending it.'; END IF;
    UPDATE public.mcp_precon_agreements SET status = 'sent', sent_on = d WHERE id = a.id;
    title := 'Pre-construction agreement sent'; summary := 'Agreement for ' || money || ' sent to the owner.';
  ELSIF act = 'signed' THEN
    IF a.status NOT IN ('draft', 'sent') THEN RAISE EXCEPTION 'MCP_BAD:The agreement is already signed.'; END IF;
    IF a.price_cents <= 0 THEN RAISE EXCEPTION 'MCP_BAD:Price the agreement before it''s signed.'; END IF;
    nm := btrim(coalesce(_p->>'name', ''));
    via := coalesce(nullif(_p->>'via', ''), 'paper');
    IF length(nm) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'MCP_BAD:Who signed the agreement?'; END IF;
    IF via NOT IN ('client_page', 'paper', 'email') THEN RAISE EXCEPTION 'MCP_BAD:Signed on the client page, on paper or by email?'; END IF;
    IF a.sent_on IS NOT NULL AND d < a.sent_on THEN RAISE EXCEPTION 'MCP_BAD:The signing date is before the agreement was sent.'; END IF;
    UPDATE public.mcp_precon_agreements SET status = 'signed', signed_on = d, signed_name = nm, signed_via = via,
      sent_on = coalesce(sent_on, d) WHERE id = a.id;
    title := 'Pre-construction agreement signed'; summary := nm || ' signed the ' || money || ' agreement (' || replace(via, '_', ' ') || ').';
  ELSIF act = 'drawings_approved' THEN
    IF a.status <> 'signed' THEN RAISE EXCEPTION 'MCP_BAD:The agreement isn''t signed yet.'; END IF;
    IF d < a.signed_on THEN RAISE EXCEPTION 'MCP_BAD:Final drawings can''t be approved before the agreement was signed.'; END IF;
    UPDATE public.mcp_precon_agreements SET drawings_approved_on = d WHERE id = a.id;
    title := 'Final drawings approved'; summary := 'The owner approved the final drawings. The estimate starts from this set.';
  ELSIF act = 'hours' THEN
    IF jsonb_typeof(_p->'hours') <> 'number' OR (_p->>'hours')::numeric < 0 OR (_p->>'hours')::numeric > 100000
       OR (_p->>'hours')::numeric * 4 <> trunc((_p->>'hours')::numeric * 4) THEN
      RAISE EXCEPTION 'MCP_BAD:Enter the total hours used so far, in quarter hours.';
    END IF;
    hrs := (_p->>'hours')::numeric;
    UPDATE public.mcp_precon_agreements SET hours_used = hrs WHERE id = a.id;
  ELSIF act IN ('link_invoice', 'link_credit') THEN
    BEGIN
      SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = nullif(_p->>'invoice_id', '')::uuid AND job_id = j.id;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'MCP_BAD:That invoice ID isn''t valid.';
    END;
    IF inv.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That invoice isn''t on this job.'; END IF;
    IF act = 'link_invoice' THEN
      IF inv.kind <> 'invoice' THEN RAISE EXCEPTION 'MCP_BAD:Link the agreement''s own invoice, not a pay application or credit.'; END IF;
      IF inv.id = ANY (a.invoice_ids) THEN
        RETURN jsonb_build_object('status', 'ok', 'already', true, 'agreement', mcp_private.precon_json(a));
      END IF;
      IF cardinality(a.invoice_ids) >= 12 THEN RAISE EXCEPTION 'MCP_BAD:An agreement holds up to 12 invoices.'; END IF;
      UPDATE public.mcp_precon_agreements SET invoice_ids = invoice_ids || inv.id WHERE id = a.id;
      title := 'Pre-construction invoice ' || inv.document_number; summary := 'Invoice ' || inv.document_number || ' added to the pre-construction agreement.';
    ELSE
      IF NOT a.credit THEN RAISE EXCEPTION 'MCP_BAD:This agreement has no credit toward the construction contract.'; END IF;
      IF inv.kind <> 'credit' THEN RAISE EXCEPTION 'MCP_BAD:Link the posted credit itself.'; END IF;
      IF a.credit_invoice_id IS NOT NULL AND a.credit_invoice_id <> inv.id THEN
        RAISE EXCEPTION 'MCP_BAD:The pre-con credit is already applied as %.', (SELECT document_number FROM public.mcp_billing_invoices WHERE id = a.credit_invoice_id);
      END IF;
      UPDATE public.mcp_precon_agreements SET credit_invoice_id = inv.id WHERE id = a.id;
      title := 'Pre-construction credit applied'; summary := 'The pre-construction fee was credited to the construction contract (' || inv.document_number || ').';
    END IF;
  ELSIF act IN ('won', 'lost') THEN
    IF a.status <> 'signed' THEN RAISE EXCEPTION 'MCP_BAD:Close pre-con once the agreement is signed.'; END IF;
    UPDATE public.mcp_precon_agreements SET status = 'closed', outcome = act, closed_on = d WHERE id = a.id;
    title := CASE WHEN act = 'won' THEN 'Pre-construction won' ELSE 'Pre-construction closed' END;
    summary := CASE WHEN act = 'won' THEN 'The owner hired us to build.' ELSE 'The owner kept the drawings and isn''t building with us.' END;
  ELSIF act = 'reopen' THEN
    IF a.status <> 'closed' THEN RETURN jsonb_build_object('status', 'ok', 'already', true, 'agreement', mcp_private.precon_json(a)); END IF;
    UPDATE public.mcp_precon_agreements SET status = 'signed', outcome = NULL, closed_on = NULL WHERE id = a.id;
    title := 'Pre-construction reopened'; summary := 'Pre-construction was reopened on this job.';
  END IF;

  UPDATE public.mcp_precon_agreements SET version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = a.id
    RETURNING * INTO a;
  IF title IS NOT NULL THEN
    PERFORM public.mcp_project_record_add(j.id, 'precon_' || act, title, summary, NULL, NULL, 'mcp_precon_agreements', a.id,
      jsonb_build_object('action', act, 'on', d), 'user', NULL, NULL);
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'agreement', mcp_private.precon_json(a));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_step(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_step(uuid, jsonb) TO authenticated;
