-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Stage only. Plain SQL for Lovable to apply; nothing in this repo applies it.
--
-- Service calls, work orders and contract types. Needs the customer page chain through
-- 20261105181000_athena_portal_messages.sql and 20261105190000_athena_client_payments.sql first.
--
-- Before: every Athena job was a project job, with no record of its contract type, and there was no way to take a
-- service call, charge its fee, get a work order approved or bill the work.
-- After:
--   * mcp_jobs.contract_type records how a project job is priced: lump sum, unit price, cost plus or time and
--     material. It is a label for the job board and the reports; it never limits what the job can do, so a lump sum
--     job can still carry a unit price, T&M or hourly change order.
--   * mcp_change_order_pricing records how each change order is priced (lump sum, unit price, T&M or hourly), on any
--     job whatever its contract type. The change order's own lines and total are unchanged.
--   * mcp_jobs.job_kind marks a service call ('service') apart from a project job ('project', the default). A service
--     call is a light job: no SOV, CPM or project setup, but the same job access, client page, billing records and
--     payments as any job.
--   * mcp_service_rates: each company's service call fee (and whether it is credited toward the repair), T&M labor
--     rate, plain hourly rate, overtime multiplier and material markup.
--   * mcp_service_calls: the call itself (customer, site, issue, urgency, tech, arrival window, fee, findings).
--   * mcp_work_orders: the priced work order, by unit price, T&M or hourly. Totals are always worked out here from
--     quantities, hours and rates, never taken from the caller. A T&M or hourly work order can carry a not-to-exceed
--     amount; the actual bill can't go over it. Revising a sent or approved work order makes a new version that
--     needs the customer's approval again.
--   * The client page takes two new kinds: 'work_order' (approve with a fresh emailed code, or decline, exactly like a
--     change order) and 'service_invoice' (the service call fee or the final bill, paid by card or bank through the
--     contractor's own Stripe account, or recorded as a wire or check). A paid service invoice is booked as a billing
--     receipt applied to its billing invoice, as a pay application is.
--   * The final bill credits the service call fee when the company credits it and the fee was paid, so the fee plus
--     the bill equal the work.
-- Grants follow 0077: member functions are for authenticated only, client page functions stay service_role only,
-- and the private helpers are callable by nobody.
-- Rollback: supabase/rollbacks/20261105230000_athena_service_calls.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS mcp_private;

-- ---------- jobs: kind and contract type ----------

ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS job_kind text NOT NULL DEFAULT 'project';
ALTER TABLE public.mcp_jobs ADD COLUMN IF NOT EXISTS contract_type text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_jobs'::regclass AND conname = 'mcp_jobs_job_kind_check') THEN
    ALTER TABLE public.mcp_jobs ADD CONSTRAINT mcp_jobs_job_kind_check CHECK (job_kind IN ('project', 'service'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_jobs'::regclass AND conname = 'mcp_jobs_contract_type_check') THEN
    ALTER TABLE public.mcp_jobs ADD CONSTRAINT mcp_jobs_contract_type_check
      CHECK (contract_type IS NULL OR contract_type IN ('lump_sum', 'unit_price', 'cost_plus', 'time_and_material'));
  END IF;
END $$;

-- ---------- tables ----------

CREATE TABLE IF NOT EXISTS public.mcp_service_rates (
  company_id uuid PRIMARY KEY REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents BETWEEN 0 AND 1000000),
  fee_credit boolean NOT NULL DEFAULT true,
  labor_rate_cents bigint CHECK (labor_rate_cents IS NULL OR labor_rate_cents BETWEEN 1 AND 100000),
  hourly_rate_cents bigint CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents BETWEEN 1 AND 100000),
  overtime_bps integer NOT NULL DEFAULT 15000 CHECK (overtime_bps BETWEEN 10000 AND 30000),
  markup_bps integer NOT NULL DEFAULT 0 CHECK (markup_bps BETWEEN 0 AND 10000),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_service_calls (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 99999999),
  request_id uuid NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 1 AND 120),
  customer_phone text CHECK (customer_phone IS NULL OR length(btrim(customer_phone)) BETWEEN 3 AND 40),
  customer_email text CHECK (customer_email IS NULL OR (customer_email = lower(customer_email) AND length(customer_email) <= 320
    AND customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  site_address text NOT NULL CHECK (length(btrim(site_address)) BETWEEN 1 AND 300),
  issue text NOT NULL CHECK (length(btrim(issue)) BETWEEN 1 AND 2000),
  urgency text NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'soon', 'emergency')),
  tech_name text CHECK (tech_name IS NULL OR length(btrim(tech_name)) BETWEEN 1 AND 120),
  window_start timestamptz,
  window_end timestamptz,
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents BETWEEN 0 AND 1000000),
  fee_credit boolean NOT NULL DEFAULT true,
  fee_invoice_id uuid REFERENCES public.mcp_billing_invoices(id),
  findings text CHECK (findings IS NULL OR length(btrim(findings)) BETWEEN 1 AND 4000),
  recommendation text CHECK (recommendation IS NULL OR length(btrim(recommendation)) BETWEEN 1 AND 4000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number),
  CHECK (window_start IS NULL OR window_end IS NULL OR window_start < window_end)
);

CREATE TABLE IF NOT EXISTS public.mcp_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_service_calls(job_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (length(number) BETWEEN 1 AND 40),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  basis text NOT NULL CHECK (basis IN ('unit_price', 'time_and_material', 'hourly')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 1 AND 4000),
  rates jsonb NOT NULL,
  lines jsonb NOT NULL,
  estimate_cents bigint NOT NULL CHECK (estimate_cents >= 0),
  cap_cents bigint CHECK (cap_cents IS NULL OR cap_cents > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'sent', 'approved', 'declined', 'done', 'billed')),
  decision jsonb,
  actual_lines jsonb,
  actual_cents bigint CHECK (actual_cents IS NULL OR actual_cents >= 0),
  signoff jsonb,
  bill_invoice_id uuid REFERENCES public.mcp_billing_invoices(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, number),
  CHECK (cap_cents IS NULL OR cap_cents >= estimate_cents),
  CHECK (state NOT IN ('done', 'billed') OR (actual_cents IS NOT NULL AND signoff IS NOT NULL)),
  CHECK ((state = 'billed') = (bill_invoice_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mcp_work_orders_job ON public.mcp_work_orders (job_id, created_at);

CREATE TABLE IF NOT EXISTS public.mcp_change_order_pricing (
  submittal_id uuid PRIMARY KEY REFERENCES public.mcp_submittals(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('lump_sum', 'unit_price', 'time_and_material', 'hourly')),
  set_by uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_change_order_pricing_job ON public.mcp_change_order_pricing (job_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_service_rates','mcp_service_calls','mcp_work_orders','mcp_change_order_pricing'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------- client page kinds ----------

DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.mcp_portal_items'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%change_order%' LOOP
    EXECUTE format('ALTER TABLE public.mcp_portal_items DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.mcp_portal_items ADD CONSTRAINT mcp_portal_items_kind_check
  CHECK (kind IN ('change_order', 'selection', 'pay_app', 'work_order', 'service_invoice'));

-- ---------- helpers (private) ----------

CREATE OR REPLACE FUNCTION mcp_private.service_money(_cents numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN _cents < 0 THEN '-' ELSE '' END || to_char(abs(_cents) / 100.0, 'FM$999,999,999,990.00')
$$;
REVOKE ALL ON FUNCTION mcp_private.service_money(numeric) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.service_basis_label(_basis text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE _basis WHEN 'unit_price' THEN 'Unit price' WHEN 'time_and_material' THEN 'Time and material'
    WHEN 'hourly' THEN 'Hourly labor' WHEN 'lump_sum' THEN 'Lump sum' WHEN 'cost_plus' THEN 'Cost plus' END
$$;
REVOKE ALL ON FUNCTION mcp_private.service_basis_label(text) FROM PUBLIC, anon, authenticated, service_role;

-- A service call the caller can run: active member, full access to the job, and the job is a service call.
CREATE OR REPLACE FUNCTION mcp_private.service_job(_job uuid) RETURNS public.mcp_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Service calls need full access to the job.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  IF j.job_kind IS DISTINCT FROM 'service' OR NOT EXISTS (SELECT 1 FROM public.mcp_service_calls WHERE job_id = _job) THEN
    RAISE EXCEPTION 'MCP_BAD:That job isn''t a service call.';
  END IF;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION mcp_private.service_job(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- True while this version is still the service invoice's current, submitted or certified version on this job.
CREATE OR REPLACE FUNCTION mcp_private.service_invoice_open(_job uuid, _invoice uuid, _version bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_billing_invoices inv
      JOIN public.mcp_billing_invoice_versions v ON v.invoice_id = inv.id
     WHERE inv.id = _invoice AND inv.job_id = _job AND inv.kind = 'invoice' AND v.version = _version
       AND v.status IN ('submitted', 'certified')
       AND v.version = (SELECT max(x.version) FROM public.mcp_billing_invoice_versions x WHERE x.invoice_id = _invoice))
$$;
REVOKE ALL ON FUNCTION mcp_private.service_invoice_open(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Where a service invoice stands: what's due, applied, credited, pending (a bank payment on its way) and left.
CREATE OR REPLACE FUNCTION mcp_private.service_invoice_position(_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv public.mcp_billing_invoices; v public.mcp_billing_invoice_versions; applied bigint; credits bigint; pending bigint;
BEGIN
  SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = _invoice;
  IF inv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM public.mcp_billing_invoice_versions WHERE invoice_id = inv.id ORDER BY version DESC LIMIT 1;
  applied := coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END)
    FROM public.mcp_billing_allocations WHERE invoice_id = inv.id), 0);
  credits := public.mcp_billing_posted_credits(inv.job_id, inv.id, NULL)::bigint;
  pending := coalesce((SELECT sum(p.amount_cents) FROM public.mcp_portal_payments p JOIN public.mcp_portal_items i ON i.id = p.item_id
    WHERE i.kind = 'service_invoice' AND i.ref_id = inv.id AND p.job_id = inv.job_id AND p.status = 'processing'), 0);
  RETURN jsonb_build_object('invoice_id', inv.id, 'number', inv.document_number, 'state', v.status, 'version', v.version,
    'net_due_cents', v.net_due_cents, 'applied_cents', applied, 'credits_cents', credits, 'pending_cents', pending,
    'remaining_cents', greatest(v.net_due_cents - credits - applied - pending, 0),
    'paid', v.status <> 'void' AND v.net_due_cents - credits - applied <= 0,
    'item_id', (SELECT i.id FROM public.mcp_portal_items i WHERE i.kind = 'service_invoice' AND i.ref_id = inv.id
       AND i.withdrawn_at IS NULL ORDER BY i.shared_at DESC LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION mcp_private.service_invoice_position(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The company's service rates, or the defaults when none are saved yet.
CREATE OR REPLACE FUNCTION mcp_private.service_rates_json(_company uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('saved', r.company_id IS NOT NULL, 'fee_cents', coalesce(r.fee_cents, 0), 'fee_credit', coalesce(r.fee_credit, true),
    'labor_rate_cents', r.labor_rate_cents, 'hourly_rate_cents', r.hourly_rate_cents,
    'overtime_bps', coalesce(r.overtime_bps, 15000), 'markup_bps', coalesce(r.markup_bps, 0), 'updated_at', r.updated_at)
    FROM (SELECT 1) one LEFT JOIN public.mcp_service_rates r ON r.company_id = _company
$$;
REVOKE ALL ON FUNCTION mcp_private.service_rates_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Prices work order lines. Every amount is worked out here from quantities, hours and rates.
--   unit_price:        item lines (description, quantity, unit, unit_rate_cents): quantity x rate.
--   time_and_material: labor lines (description, hours, overtime) at the labor rate (overtime at the multiplier),
--                      material lines (description, quantity, unit, unit_cost_cents) at cost, plus the markup on
--                      materials.
--   hourly:            labor lines at the plain hourly rate (overtime at the multiplier).
CREATE OR REPLACE FUNCTION mcp_private.service_price(_basis text, _lines jsonb, _rates jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE ln jsonb; out_lines jsonb := '[]'::jsonb; k text; q numeric; rate numeric; amt numeric; ot boolean;
  labor numeric := 0; material numeric := 0; items numeric := 0; markup numeric := 0; d text; u text; detail text;
  lr numeric := nullif(_rates->>'labor_rate_cents', '')::numeric; hr numeric := nullif(_rates->>'hourly_rate_cents', '')::numeric;
  otb numeric := coalesce(nullif(_rates->>'overtime_bps', '')::numeric, 15000); mb numeric := coalesce(nullif(_rates->>'markup_bps', '')::numeric, 0);
BEGIN
  IF _basis NOT IN ('unit_price', 'time_and_material', 'hourly') THEN RAISE EXCEPTION 'MCP_BAD:Price the work order by unit price, time and material, or hourly.'; END IF;
  IF jsonb_typeof(_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(_lines) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'MCP_BAD:A work order needs 1 to 60 lines.';
  END IF;
  FOR ln IN SELECT value FROM jsonb_array_elements(_lines) LOOP
    k := ln->>'kind'; d := btrim(coalesce(ln->>'description', ''));
    IF jsonb_typeof(ln) IS DISTINCT FROM 'object' OR length(d) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'MCP_BAD:Each line needs a description.'; END IF;
    IF (_basis = 'unit_price' AND k IS DISTINCT FROM 'item') OR (_basis = 'time_and_material' AND k NOT IN ('labor', 'material'))
       OR (_basis = 'hourly' AND k IS DISTINCT FROM 'labor') OR k IS NULL THEN
      RAISE EXCEPTION 'MCP_BAD:%', CASE _basis WHEN 'unit_price' THEN 'A unit price work order takes item lines only.'
        WHEN 'hourly' THEN 'An hourly work order takes labor lines only.' ELSE 'A time and material work order takes labor and material lines.' END;
    END IF;
    IF k = 'labor' THEN
      IF jsonb_typeof(ln->'hours') IS DISTINCT FROM 'number' OR (ln->>'hours')::numeric <= 0 OR (ln->>'hours')::numeric > 1000
         OR (ln->>'hours')::numeric * 100 <> trunc((ln->>'hours')::numeric * 100) THEN
        RAISE EXCEPTION 'MCP_BAD:Labor lines need hours, more than 0 and up to 1,000, to two decimals.';
      END IF;
      q := (ln->>'hours')::numeric; ot := coalesce((ln->>'overtime')::boolean, false);
      rate := CASE WHEN _basis = 'hourly' THEN hr ELSE lr END;
      IF rate IS NULL THEN
        RAISE EXCEPTION 'MCP_BAD:%', CASE WHEN _basis = 'hourly' THEN 'Set the company''s hourly labor rate first.' ELSE 'Set the company''s T&M labor rate first.' END;
      END IF;
      IF ot THEN rate := round(rate * otb / 10000); END IF;
      amt := round(q * rate); labor := labor + amt;
      detail := trim_scale(q)::text || ' hr x ' || mcp_private.service_money(rate) || '/hr' || CASE WHEN ot THEN ' (overtime)' ELSE '' END;
      out_lines := out_lines || jsonb_build_array(jsonb_build_object('kind', 'labor', 'description', d, 'hours', q, 'overtime', ot,
        'rate_cents', rate::bigint, 'amount_cents', amt::bigint, 'detail', detail));
    ELSE
      IF jsonb_typeof(ln->'quantity') IS DISTINCT FROM 'number' OR (ln->>'quantity')::numeric <= 0 OR (ln->>'quantity')::numeric > 1000000
         OR (ln->>'quantity')::numeric * 1000 <> trunc((ln->>'quantity')::numeric * 1000) THEN
        RAISE EXCEPTION 'MCP_BAD:Item and material lines need a quantity, more than 0, to three decimals.';
      END IF;
      q := (ln->>'quantity')::numeric; u := left(nullif(btrim(coalesce(ln->>'unit', '')), ''), 20);
      rate := nullif(ln->>(CASE WHEN k = 'item' THEN 'unit_rate_cents' ELSE 'unit_cost_cents' END), '')::numeric;
      IF rate IS NULL OR rate < 0 OR rate > 100000000 OR rate <> trunc(rate) THEN
        RAISE EXCEPTION 'MCP_BAD:%', CASE WHEN k = 'item' THEN 'Item lines need a unit price in whole cents.' ELSE 'Material lines need a unit cost in whole cents.' END;
      END IF;
      amt := round(q * rate);
      IF k = 'item' THEN items := items + amt; ELSE material := material + amt; END IF;
      detail := trim_scale(q)::text || coalesce(' ' || u, '') || ' x ' || mcp_private.service_money(rate) || CASE WHEN k = 'material' THEN ' at cost' ELSE '' END;
      out_lines := out_lines || jsonb_build_array(jsonb_build_object('kind', k, 'description', d, 'quantity', q, 'unit', u,
        CASE WHEN k = 'item' THEN 'unit_rate_cents' ELSE 'unit_cost_cents' END, rate::bigint, 'amount_cents', amt::bigint, 'detail', detail));
    END IF;
  END LOOP;
  IF _basis = 'time_and_material' AND material > 0 AND mb > 0 THEN markup := round(material * mb / 10000); END IF;
  IF labor + material + items + markup > 9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:That total is out of range.'; END IF;
  RETURN jsonb_build_object('lines', out_lines, 'labor_cents', labor::bigint, 'material_cents', material::bigint,
    'items_cents', items::bigint, 'markup_cents', markup::bigint, 'markup_bps', CASE WHEN _basis = 'time_and_material' THEN mb::int END,
    'total_cents', (labor + material + items + markup)::bigint);
END $$;
REVOKE ALL ON FUNCTION mcp_private.service_price(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- What the customer reads under a work order: how it's billed and the limit.
CREATE OR REPLACE FUNCTION mcp_private.service_terms(_basis text, _rates jsonb, _estimate bigint, _cap bigint, _fee bigint, _credit boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE _basis
      WHEN 'unit_price' THEN 'Priced per item: you pay the unit prices shown for what is installed.'
      WHEN 'time_and_material' THEN 'Billed for the actual time at ' || mcp_private.service_money((_rates->>'labor_rate_cents')::numeric)
        || '/hr and materials at cost' || CASE WHEN coalesce((_rates->>'markup_bps')::numeric, 0) > 0
          THEN ' plus ' || trim_scale(round((_rates->>'markup_bps')::numeric / 100, 2))::text || '%' ELSE '' END || '.'
      ELSE 'Billed for the actual time at ' || mcp_private.service_money((_rates->>'hourly_rate_cents')::numeric) || '/hr.' END
    || CASE WHEN _cap IS NOT NULL THEN ' The bill won''t go over ' || mcp_private.service_money(_cap) || ' without your approval.'
       WHEN _basis <> 'unit_price' THEN ' This is an estimate; the bill is for the actual time.' ELSE '' END
    || CASE WHEN _credit AND _fee > 0 THEN ' The ' || mcp_private.service_money(_fee) || ' service call fee you paid is credited toward this work.' ELSE '' END
$$;
REVOKE ALL ON FUNCTION mcp_private.service_terms(text, jsonb, bigint, bigint, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- The customer's view of a work order: a whitelist built field by field. No internal rates beyond the ones the
-- customer is billed at, no member ids.
CREATE OR REPLACE FUNCTION mcp_private.service_work_order_view(w public.mcp_work_orders, c public.mcp_service_calls, _credit bigint)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('number', w.number, 'title', w.title, 'basis', w.basis, 'basis_label', mcp_private.service_basis_label(w.basis),
    'scope', w.scope, 'findings', c.findings, 'site_address', c.site_address,
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', l->>'kind', 'description', l->>'description', 'detail', l->>'detail',
        'amount_cents', (l->>'amount_cents')::bigint) ORDER BY o) FROM jsonb_array_elements(w.lines->'lines') WITH ORDINALITY x(l, o)), '[]'::jsonb),
    'totals', jsonb_build_object('labor_cents', (w.lines->>'labor_cents')::bigint, 'material_cents', (w.lines->>'material_cents')::bigint,
      'items_cents', (w.lines->>'items_cents')::bigint, 'markup_cents', (w.lines->>'markup_cents')::bigint,
      'estimate_cents', w.estimate_cents, 'cap_cents', w.cap_cents, 'fee_credit_cents', _credit),
    'terms', mcp_private.service_terms(w.basis, w.rates, w.estimate_cents, w.cap_cents, _credit, _credit > 0))
$$;
REVOKE ALL ON FUNCTION mcp_private.service_work_order_view(public.mcp_work_orders, public.mcp_service_calls, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Books a submitted billing invoice for a service call and shares it on the client page. Returns the portal item.
CREATE OR REPLACE FUNCTION mcp_private.service_invoice_share(_job public.mcp_jobs, _number text, _source text, _gross bigint, _net bigint,
  _view jsonb, _due_on date) RETURNS public.mcp_portal_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE iid uuid := gen_random_uuid(); it public.mcp_portal_items; today date;
BEGIN
  today := (now() AT TIME ZONE coalesce(nullif(_job.time_zone, ''), 'America/Chicago'))::date;
  IF _due_on IS NOT NULL AND (_due_on < today OR _due_on > today + 366) THEN RAISE EXCEPTION 'MCP_BAD:Use a due date from today to a year out.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_billing_invoices WHERE job_id = _job.id AND lower(btrim(document_number)) = lower(btrim(_number))) THEN
    RAISE EXCEPTION 'MCP_BAD:Invoice % is already on this job.', _number;
  END IF;
  INSERT INTO public.mcp_billing_invoices (id, job_id, company_id, document_number, kind, created_by)
  VALUES (iid, _job.id, _job.company_id, _number, 'invoice', auth.uid());
  INSERT INTO public.mcp_billing_invoice_versions (invoice_id, job_id, version, status, invoice_date, effective_date, source,
    gross_cents, withheld_cents, released_cents, net_due_cents, recorded_by)
  VALUES (iid, _job.id, 1, 'submitted', today, today, _source, _gross, 0, 0, _net, auth.uid());
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (_job.company_id, _job.id, 'service_invoice', iid, 1, _view, mcp_private.portal_fingerprint(_view), _due_on, auth.uid())
  RETURNING * INTO it;
  RETURN it;
END $$;
REVOKE ALL ON FUNCTION mcp_private.service_invoice_share(public.mcp_jobs, text, text, bigint, bigint, jsonb, date) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mcp_private.service_recipients(_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('access_id', id, 'email', email, 'name', name)), '[]'::jsonb)
    FROM public.mcp_portal_access WHERE job_id = _job AND revoked_at IS NULL
$$;
REVOKE ALL ON FUNCTION mcp_private.service_recipients(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- member functions: contract type and change order pricing ----------

-- Sets or clears a job's contract type. A label only: it never limits which change orders the job can carry.
CREATE OR REPLACE FUNCTION public.mcp_job_contract_type_set(_job uuid, _contract_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; t text := nullif(btrim(coalesce(_contract_type, '')), '');
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Setting the contract type needs full access to the job.';
  END IF;
  IF t IS NOT NULL AND t NOT IN ('lump_sum', 'unit_price', 'cost_plus', 'time_and_material') THEN
    RAISE EXCEPTION 'MCP_BAD:Choose lump sum, unit price, cost plus or time and material.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job FOR UPDATE;
  IF j.job_kind = 'service' THEN RAISE EXCEPTION 'MCP_BAD:A service call is priced on each work order, not by contract type.'; END IF;
  IF j.contract_type IS DISTINCT FROM t THEN
    UPDATE public.mcp_jobs SET contract_type = t, updated_at = now() WHERE id = _job;
    PERFORM public.mcp_project_record_add(_job, 'contract_type_set', coalesce('Contract type: ' || mcp_private.service_basis_label(t), 'Contract type cleared'),
      'Contract type recorded on the job.', NULL, NULL, 'mcp_jobs', _job,
      jsonb_build_object('contract_type', t, 'was', j.contract_type), 'user');
  END IF;
  RETURN jsonb_build_object('job_id', _job, 'job_number', j.job_number, 'contract_type', t,
    'label', mcp_private.service_basis_label(t), 'changed', j.contract_type IS DISTINCT FROM t);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_contract_type_set(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_contract_type_set(uuid, text) TO authenticated;

-- A job's kind and contract type, for anyone who can see the job.
CREATE OR REPLACE FUNCTION public.mcp_job_terms(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That job isn''t yours to see.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN jsonb_build_object('job_id', j.id, 'job_kind', j.job_kind, 'contract_type', j.contract_type,
    'contract_type_label', mcp_private.service_basis_label(j.contract_type));
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_terms(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_terms(uuid) TO authenticated;

-- Records how a change order is priced: lump sum, unit price, T&M or hourly. Any job can carry any of these,
-- whatever its own contract type.
CREATE OR REPLACE FUNCTION public.mcp_change_order_pricing_set(_job uuid, _submittal uuid, _basis text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.mcp_submittals;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Change order pricing needs full access to the job.';
  END IF;
  IF _basis IS NULL OR _basis NOT IN ('lump_sum', 'unit_price', 'time_and_material', 'hourly') THEN
    RAISE EXCEPTION 'MCP_BAD:Price the change order as lump sum, unit price, time and material, or hourly.';
  END IF;
  SELECT * INTO s FROM public.mcp_submittals WHERE id = _submittal AND job_id = _job AND package_purpose = 'change_order';
  IF s.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.mcp_change_orders WHERE submittal_id = s.id) THEN
    RAISE EXCEPTION 'MCP_BAD:That change order isn''t on this job.';
  END IF;
  INSERT INTO public.mcp_change_order_pricing (submittal_id, job_id, basis, set_by) VALUES (s.id, _job, _basis, auth.uid())
  ON CONFLICT (submittal_id) DO UPDATE SET basis = EXCLUDED.basis, set_by = EXCLUDED.set_by, set_at = now();
  RETURN jsonb_build_object('submittal_id', s.id, 'number', s.number, 'basis', _basis, 'label', mcp_private.service_basis_label(_basis));
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_order_pricing_set(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_change_order_pricing_set(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_change_order_pricing_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Change order pricing needs full access to the job.';
  END IF;
  RETURN coalesce((SELECT jsonb_object_agg(p.submittal_id::text, p.basis) FROM public.mcp_change_order_pricing p WHERE p.job_id = _job), '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_order_pricing_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_change_order_pricing_list(uuid) TO authenticated;

-- ---------- member functions: service rates ----------

CREATE OR REPLACE FUNCTION public.mcp_service_rates_get(_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  RETURN mcp_private.service_rates_json(_company)
    || jsonb_build_object('can_edit', EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role IN ('owner', 'all_access')));
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_rates_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_rates_get(uuid) TO authenticated;

-- Saves the service rates. Keys left out keep their saved value. Owner or all-access members only.
CREATE OR REPLACE FUNCTION public.mcp_service_rates_save(_company uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_service_rates; k text; n numeric;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role IN ('owner', 'all_access')) THEN
    RAISE EXCEPTION 'MCP_BAD:Only the company owner or an all-access member can set service rates.';
  END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) x
       WHERE x NOT IN ('fee_cents', 'fee_credit', 'labor_rate_cents', 'hourly_rate_cents', 'overtime_bps', 'markup_bps')) THEN
    RAISE EXCEPTION 'MCP_BAD:Unknown service rate.';
  END IF;
  FOREACH k IN ARRAY ARRAY['fee_cents', 'labor_rate_cents', 'hourly_rate_cents', 'overtime_bps', 'markup_bps'] LOOP
    IF _p ? k AND _p->k <> 'null'::jsonb THEN
      IF jsonb_typeof(_p->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Rates are whole numbers.'; END IF;
      n := (_p->>k)::numeric;
      IF n <> trunc(n) THEN RAISE EXCEPTION 'MCP_BAD:Rates are whole cents or basis points.'; END IF;
    END IF;
  END LOOP;
  IF _p ? 'fee_credit' AND jsonb_typeof(_p->'fee_credit') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'MCP_BAD:fee_credit is true or false.'; END IF;
  INSERT INTO public.mcp_service_rates (company_id, updated_by) VALUES (_company, auth.uid()) ON CONFLICT (company_id) DO NOTHING;
  BEGIN
    UPDATE public.mcp_service_rates SET
      fee_cents = CASE WHEN _p ? 'fee_cents' THEN coalesce((_p->>'fee_cents')::bigint, 0) ELSE fee_cents END,
      fee_credit = CASE WHEN _p ? 'fee_credit' THEN (_p->>'fee_credit')::boolean ELSE fee_credit END,
      labor_rate_cents = CASE WHEN _p ? 'labor_rate_cents' THEN (_p->>'labor_rate_cents')::bigint ELSE labor_rate_cents END,
      hourly_rate_cents = CASE WHEN _p ? 'hourly_rate_cents' THEN (_p->>'hourly_rate_cents')::bigint ELSE hourly_rate_cents END,
      overtime_bps = CASE WHEN _p ? 'overtime_bps' THEN coalesce((_p->>'overtime_bps')::int, 15000) ELSE overtime_bps END,
      markup_bps = CASE WHEN _p ? 'markup_bps' THEN coalesce((_p->>'markup_bps')::int, 0) ELSE markup_bps END,
      updated_by = auth.uid(), updated_at = now()
     WHERE company_id = _company RETURNING * INTO r;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'MCP_BAD:Keep the fee up to $10,000, labor rates from $0.01 to $1,000 an hour, overtime from 1x to 3x and markup up to 100%%.';
  END;
  RETURN mcp_private.service_rates_json(_company) || jsonb_build_object('can_edit', true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_rates_save(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_rates_save(uuid, jsonb) TO authenticated;

-- ---------- member functions: service calls ----------

-- Where a call stands, in the order the work moves, with the one next step.
CREATE OR REPLACE FUNCTION mcp_private.service_call_json(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_service_calls; j public.mcp_jobs; fee jsonb; wos jsonb; w public.mcp_work_orders; bill jsonb; stage text; nxt text;
  tz text;
BEGIN
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  tz := coalesce(nullif(j.time_zone, ''), 'America/Chicago');
  fee := CASE WHEN c.fee_invoice_id IS NOT NULL THEN mcp_private.service_invoice_position(c.fee_invoice_id) END;
  SELECT * INTO w FROM public.mcp_work_orders WHERE job_id = _job ORDER BY created_at DESC LIMIT 1;
  bill := CASE WHEN w.bill_invoice_id IS NOT NULL THEN mcp_private.service_invoice_position(w.bill_invoice_id) END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'version', x.version, 'basis', x.basis,
      'basis_label', mcp_private.service_basis_label(x.basis), 'title', x.title, 'scope', x.scope, 'state', x.state,
      'rates', x.rates, 'estimate', x.lines, 'estimate_cents', x.estimate_cents, 'cap_cents', x.cap_cents,
      'decision', x.decision, 'actual', x.actual_lines, 'actual_cents', x.actual_cents, 'signoff', x.signoff,
      'bill', CASE WHEN x.bill_invoice_id IS NOT NULL THEN mcp_private.service_invoice_position(x.bill_invoice_id) END,
      'item_id', (SELECT i.id FROM public.mcp_portal_items i WHERE i.kind = 'work_order' AND i.ref_id = x.id AND i.ref_version = x.version
         AND i.withdrawn_at IS NULL ORDER BY i.shared_at DESC LIMIT 1),
      'updated_at', x.updated_at) ORDER BY x.created_at), '[]'::jsonb)
    INTO wos FROM public.mcp_work_orders x WHERE x.job_id = _job;
  stage := CASE
    WHEN c.status = 'cancelled' THEN 'cancelled'
    WHEN c.status = 'closed' THEN 'closed'
    WHEN bill IS NOT NULL AND (bill->>'paid')::boolean THEN 'paid'
    WHEN w.state = 'billed' THEN 'billed'
    WHEN w.state = 'done' THEN 'work_done'
    WHEN w.state = 'approved' THEN 'approved'
    WHEN w.state = 'declined' THEN 'declined'
    WHEN w.state = 'sent' THEN 'work_order_sent'
    WHEN w.state = 'draft' THEN 'work_order_draft'
    WHEN c.findings IS NOT NULL THEN 'diagnosed'
    WHEN fee IS NOT NULL AND (fee->>'paid')::boolean THEN 'fee_paid'
    WHEN fee IS NOT NULL THEN 'fee_requested'
    WHEN c.tech_name IS NOT NULL AND c.window_start IS NOT NULL THEN 'scheduled'
    ELSE 'new' END;
  nxt := CASE stage
    WHEN 'new' THEN CASE WHEN c.fee_cents > 0 THEN 'Assign a tech and arrival window, then send the ' || mcp_private.service_money(c.fee_cents) || ' service call fee to the customer.'
      ELSE 'Assign a tech and an arrival window.' END
    WHEN 'scheduled' THEN CASE WHEN c.fee_cents > 0 THEN 'Send the ' || mcp_private.service_money(c.fee_cents) || ' service call fee to the customer''s client page.'
      ELSE 'Record what the tech found on site.' END
    WHEN 'fee_requested' THEN 'Waiting on the customer to pay the service call fee. Record a check or wire if they pay another way.'
    WHEN 'fee_paid' THEN 'Record what the tech found, then write the work order.'
    WHEN 'diagnosed' THEN 'Write the work order: unit price, time and material, or hourly.'
    WHEN 'work_order_draft' THEN 'Send ' || w.number || ' to the customer to approve.'
    WHEN 'work_order_sent' THEN 'Waiting on the customer to approve ' || w.number || '. They can also sign on site.'
    WHEN 'declined' THEN 'The customer declined ' || w.number || '. Revise it and send it again, or close the call.'
    WHEN 'approved' THEN 'Do the work, then log the actual ' || CASE w.basis WHEN 'unit_price' THEN 'items' WHEN 'hourly' THEN 'hours' ELSE 'time and materials' END || ' and the customer''s sign-off.'
    WHEN 'work_done' THEN 'Send the bill for ' || w.number || ' to the customer.'
    WHEN 'billed' THEN 'Waiting on the customer to pay. Record a check or wire if they pay another way.'
    WHEN 'paid' THEN 'Paid in full. Close the call.'
    ELSE NULL END;
  RETURN jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'job_name', j.name, 'company_id', j.company_id,
    'number', c.number, 'version', c.version, 'status', c.status, 'stage', stage, 'next_step', nxt,
    'customer', jsonb_build_object('name', c.customer_name, 'phone', c.customer_phone, 'email', c.customer_email),
    'site_address', c.site_address, 'issue', c.issue, 'urgency', c.urgency, 'tech_name', c.tech_name,
    'window_start', c.window_start, 'window_end', c.window_end, 'time_zone', tz,
    'fee_cents', c.fee_cents, 'fee_credit', c.fee_credit, 'fee', fee,
    'findings', c.findings, 'recommendation', c.recommendation, 'work_orders', wos,
    'portal_customers', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', a.id, 'name', a.name, 'email', a.email,
        'last_seen_at', a.last_seen_at) ORDER BY a.created_at) FROM public.mcp_portal_access a WHERE a.job_id = _job AND a.revoked_at IS NULL), '[]'::jsonb),
    'created_at', c.created_at, 'updated_at', c.updated_at);
END $$;
REVOKE ALL ON FUNCTION mcp_private.service_call_json(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Takes a service call: makes a light job numbered SC-<n> for it, unrestricted, with the caller as its PM. The
-- caller's request id makes a retry return the same call.
CREATE OR REPLACE FUNCTION public.mcp_service_call_create(_company uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE rid uuid; c public.mcp_service_calls; rates jsonb; n int; made jsonb; jid uuid; tries int := 0; nm text; tz text;
  email text := nullif(lower(btrim(coalesce(_p->>'customer_email', ''))), ''); ws timestamptz; we timestamptz;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MCP_BAD:Invalid service call.'; END IF;
  rid := nullif(_p->>'request_id', '')::uuid;
  IF rid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request id is required.'; END IF;
  SELECT * INTO c FROM public.mcp_service_calls WHERE request_id = rid;
  IF c.job_id IS NOT NULL THEN
    IF c.company_id <> _company OR c.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'MCP_BAD:This request was already used.'; END IF;
    RETURN mcp_private.service_call_json(c.job_id) || jsonb_build_object('already_created', true);
  END IF;
  IF length(btrim(coalesce(_p->>'customer_name', ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Who is the customer?'; END IF;
  IF length(btrim(coalesce(_p->>'site_address', ''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'MCP_BAD:Where is the service call?'; END IF;
  IF length(btrim(coalesce(_p->>'issue', ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'MCP_BAD:What''s the problem the customer called about?'; END IF;
  IF email IS NOT NULL AND (length(email) > 320 OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'MCP_BAD:That customer email doesn''t look right.';
  END IF;
  ws := nullif(_p->>'window_start', '')::timestamptz; we := nullif(_p->>'window_end', '')::timestamptz;
  IF ws IS NOT NULL AND we IS NOT NULL AND ws >= we THEN RAISE EXCEPTION 'MCP_BAD:The arrival window ends before it starts.'; END IF;
  tz := nullif(btrim(coalesce(_p->>'time_zone', '')), '');
  IF tz IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN RAISE EXCEPTION 'MCP_BAD:Unknown time zone.'; END IF;
  rates := mcp_private.service_rates_json(_company);
  -- Serialize numbering per company.
  PERFORM pg_advisory_xact_lock(hashtextextended('mcp_service_calls:' || _company::text, 0));
  SELECT coalesce(max(number), 1000) + 1 INTO n FROM public.mcp_service_calls WHERE company_id = _company;
  nm := left(btrim(_p->>'customer_name') || ' service call', 120);
  LOOP
    made := public.mcp_job_create(_company, 'SC-' || n, nm, NULL);
    EXIT WHEN (made->>'duplicate')::boolean IS NOT TRUE;
    n := n + 1; tries := tries + 1;
    IF tries > 50 THEN RAISE EXCEPTION 'MCP_BAD:Couldn''t find a free service call number.'; END IF;
  END LOOP;
  jid := (made->>'job_id')::uuid;
  UPDATE public.mcp_jobs j SET job_kind = 'service', time_zone = coalesce(tz, j.time_zone),
    pm_user_id = auth.uid(), pm_name = (SELECT m.display_name FROM public.mcp_company_members m WHERE m.company_id = _company AND m.user_id = auth.uid()),
    pm_email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), updated_at = now()
   WHERE j.id = jid;
  INSERT INTO public.mcp_service_calls (job_id, company_id, number, request_id, customer_name, customer_phone, customer_email, site_address,
    issue, urgency, tech_name, window_start, window_end, fee_cents, fee_credit, created_by)
  VALUES (jid, _company, n, rid, btrim(_p->>'customer_name'), nullif(btrim(coalesce(_p->>'customer_phone', '')), ''), email,
    btrim(_p->>'site_address'), btrim(_p->>'issue'), coalesce(nullif(_p->>'urgency', ''), 'routine'),
    nullif(btrim(coalesce(_p->>'tech_name', '')), ''), ws, we,
    coalesce(nullif(_p->>'fee_cents', '')::bigint, (rates->>'fee_cents')::bigint),
    coalesce((_p->>'fee_credit')::boolean, (rates->>'fee_credit')::boolean), auth.uid());
  PERFORM public.mcp_project_record_add(jid, 'service_call_create', 'Service call SC-' || n, 'Service call taken.', NULL, NULL,
    'mcp_service_calls', jid, jsonb_build_object('number', n), 'user');
  RETURN mcp_private.service_call_json(jid) || jsonb_build_object('already_created', false);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'MCP_BAD:Check the service call details: urgency is routine, soon or emergency, and the fee is up to $10,000.';
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_call_create(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_call_create(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_service_call_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM mcp_private.service_job(_job);
  RETURN mcp_private.service_call_json(_job);
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_call_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_call_get(uuid) TO authenticated;

-- The company's service calls the caller can open, newest first. _status: open (default), closed, cancelled or all.
CREATE OR REPLACE FUNCTION public.mcp_service_calls_list(_company uuid, _status text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE st text := coalesce(nullif(_status, ''), 'open');
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_NO_COMPANY'; END IF;
  IF st NOT IN ('open', 'closed', 'cancelled', 'all') THEN RAISE EXCEPTION 'MCP_BAD:List open, closed, cancelled or all calls.'; END IF;
  RETURN jsonb_build_object('calls', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'number')::int DESC) FROM (
      SELECT jsonb_build_object('job_id', s->>'job_id', 'job_number', s->>'job_number', 'number', s->'number', 'stage', s->>'stage',
        'status', s->>'status', 'customer', s->'customer'->>'name', 'site_address', s->>'site_address', 'urgency', s->>'urgency',
        'tech_name', s->>'tech_name', 'window_start', s->>'window_start', 'next_step', s->>'next_step') AS x
      FROM (SELECT mcp_private.service_call_json(c.job_id) AS s FROM public.mcp_service_calls c
             WHERE c.company_id = _company AND (st = 'all' OR c.status = st) AND public.mcp_job_scope(c.job_id) = 'full'
             ORDER BY c.number DESC LIMIT 200) q) q2), '[]'::jsonb),
    'rates', mcp_private.service_rates_json(_company));
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_calls_list(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_calls_list(uuid, text) TO authenticated;

-- Changes a call's details. Keys left out stay as they are; a key sent as null clears it where it can be cleared.
CREATE OR REPLACE FUNCTION public.mcp_service_call_update(_job uuid, _expected_version integer, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; c public.mcp_service_calls; email text; ws timestamptz; we timestamptz;
BEGIN
  j := mcp_private.service_job(_job);
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('customer_name', 'customer_phone',
       'customer_email', 'site_address', 'issue', 'urgency', 'tech_name', 'window_start', 'window_end', 'fee_cents', 'fee_credit',
       'findings', 'recommendation', 'status')) THEN
    RAISE EXCEPTION 'MCP_BAD:Unknown service call field.';
  END IF;
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job FOR UPDATE;
  IF _expected_version IS NOT NULL AND _expected_version <> c.version THEN RAISE EXCEPTION 'MCP_BAD:The service call changed; read it again first.'; END IF;
  IF (_p ? 'fee_cents' OR _p ? 'fee_credit') AND c.fee_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_BAD:The fee was already sent to the customer, so it can''t change here.';
  END IF;
  IF c.status <> 'open' AND NOT (_p ? 'status' AND _p->>'status' = 'open') THEN RAISE EXCEPTION 'MCP_BAD:Reopen the call before changing it.'; END IF;
  email := CASE WHEN _p ? 'customer_email' THEN nullif(lower(btrim(coalesce(_p->>'customer_email', ''))), '') ELSE c.customer_email END;
  ws := CASE WHEN _p ? 'window_start' THEN nullif(_p->>'window_start', '')::timestamptz ELSE c.window_start END;
  we := CASE WHEN _p ? 'window_end' THEN nullif(_p->>'window_end', '')::timestamptz ELSE c.window_end END;
  BEGIN
    UPDATE public.mcp_service_calls SET
      customer_name = CASE WHEN _p ? 'customer_name' THEN btrim(_p->>'customer_name') ELSE customer_name END,
      customer_phone = CASE WHEN _p ? 'customer_phone' THEN nullif(btrim(coalesce(_p->>'customer_phone', '')), '') ELSE customer_phone END,
      customer_email = email,
      site_address = CASE WHEN _p ? 'site_address' THEN btrim(_p->>'site_address') ELSE site_address END,
      issue = CASE WHEN _p ? 'issue' THEN btrim(_p->>'issue') ELSE issue END,
      urgency = CASE WHEN _p ? 'urgency' THEN _p->>'urgency' ELSE urgency END,
      tech_name = CASE WHEN _p ? 'tech_name' THEN nullif(btrim(coalesce(_p->>'tech_name', '')), '') ELSE tech_name END,
      window_start = ws, window_end = we,
      fee_cents = CASE WHEN _p ? 'fee_cents' THEN coalesce((_p->>'fee_cents')::bigint, 0) ELSE fee_cents END,
      fee_credit = CASE WHEN _p ? 'fee_credit' THEN coalesce((_p->>'fee_credit')::boolean, true) ELSE fee_credit END,
      findings = CASE WHEN _p ? 'findings' THEN nullif(btrim(coalesce(_p->>'findings', '')), '') ELSE findings END,
      recommendation = CASE WHEN _p ? 'recommendation' THEN nullif(btrim(coalesce(_p->>'recommendation', '')), '') ELSE recommendation END,
      status = CASE WHEN _p ? 'status' THEN _p->>'status' ELSE status END,
      version = version + 1, updated_at = now()
     WHERE job_id = _job;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'MCP_BAD:Check the service call details: name, site and issue can''t be blank, the email must look right, urgency is routine, soon or emergency, and the arrival window must end after it starts.';
  END;
  IF _p ? 'status' AND _p->>'status' IS DISTINCT FROM c.status THEN
    PERFORM public.mcp_project_record_add(_job, 'service_call_' || (_p->>'status'), 'Service call SC-' || c.number,
      'Service call marked ' || (_p->>'status') || '.', NULL, NULL, 'mcp_service_calls', _job, jsonb_build_object('status', _p->>'status'), 'user');
  END IF;
  RETURN mcp_private.service_call_json(_job);
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_call_update(uuid, integer, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_call_update(uuid, integer, jsonb) TO authenticated;

-- Sends the service call fee to the client page: a submitted billing invoice SC-<n>-FEE the customer can pay.
CREATE OR REPLACE FUNCTION public.mcp_service_fee_request(_job uuid, _due_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; c public.mcp_service_calls; v jsonb; it public.mcp_portal_items; num text;
BEGIN
  j := mcp_private.service_job(_job);
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job FOR UPDATE;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'MCP_BAD:This call is %.', c.status; END IF;
  IF c.fee_cents <= 0 THEN RAISE EXCEPTION 'MCP_BAD:This call has no service call fee.'; END IF;
  IF c.fee_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:The service call fee was already sent.'; END IF;
  num := 'SC-' || c.number || '-FEE';
  v := jsonb_build_object('number', num, 'stage', 'fee', 'title', 'Service call fee · SC-' || c.number, 'work_order', NULL,
    'site_address', c.site_address, 'issue', c.issue,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Service call: diagnose ' || left(c.issue, 200), 'detail', NULL, 'amount_cents', c.fee_cents)),
    'signoff', NULL,
    'totals', jsonb_build_object('subtotal_cents', c.fee_cents, 'credit_cents', 0, 'current_due_cents', c.fee_cents),
    'note', CASE WHEN c.fee_credit THEN 'This fee is credited toward the repair if you go ahead with the work.' ELSE NULL END);
  it := mcp_private.service_invoice_share(j, num, 'Service call SC-' || c.number || ' fee', c.fee_cents, c.fee_cents, v, _due_on);
  UPDATE public.mcp_service_calls SET fee_invoice_id = it.ref_id, version = version + 1, updated_at = now() WHERE job_id = _job;
  PERFORM public.mcp_project_record_add(_job, 'service_fee_request', 'Service call fee ' || num, 'Service call fee sent to the client page.',
    NULL, NULL, 'mcp_billing_invoices', it.ref_id, jsonb_build_object('amount_cents', c.fee_cents, 'portal_item', it.id), 'user');
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'service_invoice', 'invoice_id', it.ref_id, 'number', num,
    'label', v->>'title', 'amount_cents', c.fee_cents, 'due_on', it.due_on, 'view', v, 'fingerprint', it.fingerprint,
    'recipients', mcp_private.service_recipients(_job), 'call', mcp_private.service_call_json(_job));
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_fee_request(uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_fee_request(uuid, date) TO authenticated;

-- ---------- member functions: work orders ----------

-- Writes or revises a work order. Totals are priced here at the company's current rates. Revising one that was sent,
-- approved or declined makes a new version back in draft: the customer approves it again.
CREATE OR REPLACE FUNCTION public.mcp_work_order_save(_job uuid, _work_order uuid, _expected_version integer, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; c public.mcp_service_calls; w public.mcp_work_orders; r jsonb; rt jsonb; priced jsonb; cap bigint;
  basis text := _p->>'basis'; cnt int; num text;
BEGIN
  j := mcp_private.service_job(_job);
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('basis', 'title', 'scope', 'lines', 'cap_cents')) THEN
    RAISE EXCEPTION 'MCP_BAD:Unknown work order field.';
  END IF;
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job FOR UPDATE;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'MCP_BAD:This call is %.', c.status; END IF;
  IF length(btrim(coalesce(_p->>'title', ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Give the work order a short title.'; END IF;
  IF length(btrim(coalesce(_p->>'scope', ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'MCP_BAD:Describe the work the customer is approving.'; END IF;
  IF _p ? 'cap_cents' AND _p->'cap_cents' <> 'null'::jsonb AND (jsonb_typeof(_p->'cap_cents') IS DISTINCT FROM 'number'
     OR (_p->>'cap_cents')::numeric <> trunc((_p->>'cap_cents')::numeric) OR (_p->>'cap_cents')::numeric <= 0 OR (_p->>'cap_cents')::numeric > 9000000000000) THEN
    RAISE EXCEPTION 'MCP_BAD:The not-to-exceed amount is whole cents above zero.';
  END IF;
  cap := nullif(_p->>'cap_cents', '')::bigint;
  r := mcp_private.service_rates_json(j.company_id);
  rt := jsonb_build_object('labor_rate_cents', r->'labor_rate_cents', 'hourly_rate_cents', r->'hourly_rate_cents',
    'overtime_bps', r->'overtime_bps', 'markup_bps', r->'markup_bps');
  priced := mcp_private.service_price(basis, _p->'lines', rt);
  IF cap IS NOT NULL AND cap < (priced->>'total_cents')::bigint THEN
    RAISE EXCEPTION 'MCP_BAD:The not-to-exceed amount is below the % estimate.', mcp_private.service_money((priced->>'total_cents')::numeric);
  END IF;
  IF _work_order IS NULL THEN
    SELECT count(*) INTO cnt FROM public.mcp_work_orders WHERE job_id = _job;
    num := 'WO-' || c.number || CASE WHEN cnt > 0 THEN '-' || (cnt + 1) ELSE '' END;
    INSERT INTO public.mcp_work_orders (job_id, company_id, number, basis, title, scope, rates, lines, estimate_cents, cap_cents, created_by)
    VALUES (_job, j.company_id, num, basis, btrim(_p->>'title'), btrim(_p->>'scope'), rt, priced, (priced->>'total_cents')::bigint, cap, auth.uid())
    RETURNING * INTO w;
    PERFORM public.mcp_project_record_add(_job, 'work_order_create', num || ' · ' || w.title, 'Work order written.', NULL, NULL,
      'mcp_work_orders', w.id, jsonb_build_object('basis', basis, 'estimate_cents', w.estimate_cents, 'cap_cents', cap), 'user');
  ELSE
    SELECT * INTO w FROM public.mcp_work_orders WHERE id = _work_order AND job_id = _job FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That work order isn''t on this call.'; END IF;
    IF _expected_version IS NOT NULL AND _expected_version <> w.version THEN RAISE EXCEPTION 'MCP_BAD:The work order changed; read it again first.'; END IF;
    IF w.state IN ('done', 'billed') THEN RAISE EXCEPTION 'MCP_BAD:The work on % is logged, so it can''t be revised. Write a new work order for more work.', w.number; END IF;
    IF w.state <> 'draft' THEN
      UPDATE public.mcp_portal_items i SET withdrawn_at = now(), withdrawn_by = auth.uid()
       WHERE i.kind = 'work_order' AND i.ref_id = w.id AND i.withdrawn_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id);
    END IF;
    UPDATE public.mcp_work_orders SET basis = _p->>'basis', title = btrim(_p->>'title'), scope = btrim(_p->>'scope'), rates = rt,
      lines = priced, estimate_cents = (priced->>'total_cents')::bigint, cap_cents = cap,
      version = CASE WHEN state = 'draft' THEN version ELSE version + 1 END, state = 'draft', decision = NULL,
      actual_lines = NULL, actual_cents = NULL, updated_at = now()
     WHERE id = w.id RETURNING * INTO w;
    PERFORM public.mcp_project_record_add(_job, 'work_order_revise', w.number || ' · ' || w.title, 'Work order revised; it needs the customer''s approval again.',
      NULL, NULL, 'mcp_work_orders', w.id, jsonb_build_object('version', w.version, 'estimate_cents', w.estimate_cents, 'cap_cents', cap), 'user');
  END IF;
  RETURN jsonb_build_object('work_order_id', w.id, 'number', w.number, 'version', w.version, 'state', w.state,
    'estimate', w.lines, 'estimate_cents', w.estimate_cents, 'cap_cents', w.cap_cents, 'call', mcp_private.service_call_json(_job));
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'MCP_BAD:Check the work order: a title up to 120 characters, the scope, and a not-to-exceed amount at or above the estimate.';
END $$;
REVOKE ALL ON FUNCTION public.mcp_work_order_save(uuid, uuid, integer, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_work_order_save(uuid, uuid, integer, jsonb) TO authenticated;

-- The fee credit the customer would get on the final bill: the paid fee, once per call, when the company credits it.
CREATE OR REPLACE FUNCTION mcp_private.service_fee_credit(_job uuid, _work_order uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.mcp_service_calls; pos jsonb;
BEGIN
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job;
  IF NOT c.fee_credit OR c.fee_invoice_id IS NULL OR c.fee_cents <= 0 THEN RETURN 0; END IF;
  pos := mcp_private.service_invoice_position(c.fee_invoice_id);
  IF NOT coalesce((pos->>'paid')::boolean, false) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_work_orders w JOIN public.mcp_portal_items i ON i.kind = 'service_invoice' AND i.ref_id = w.bill_invoice_id
              WHERE w.job_id = _job AND w.id <> _work_order AND coalesce((i.view->'totals'->>'credit_cents')::bigint, 0) > 0) THEN
    RETURN 0;
  END IF;
  RETURN c.fee_cents;
END $$;
REVOKE ALL ON FUNCTION mcp_private.service_fee_credit(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Sends a work order to the client page for the customer to approve with an emailed code, or decline.
CREATE OR REPLACE FUNCTION public.mcp_work_order_send(_job uuid, _work_order uuid, _expected_version integer, _due_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; c public.mcp_service_calls; w public.mcp_work_orders; v jsonb; it public.mcp_portal_items; today date;
BEGIN
  j := mcp_private.service_job(_job);
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'MCP_BAD:This call is %.', c.status; END IF;
  SELECT * INTO w FROM public.mcp_work_orders WHERE id = _work_order AND job_id = _job FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That work order isn''t on this call.'; END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> w.version THEN RAISE EXCEPTION 'MCP_BAD:The work order changed; read it again first.'; END IF;
  IF w.state NOT IN ('draft', 'sent') THEN RAISE EXCEPTION 'MCP_BAD:% is already %.', w.number, w.state; END IF;
  today := (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date;
  IF _due_on IS NOT NULL AND (_due_on < today OR _due_on > today + 366) THEN RAISE EXCEPTION 'MCP_BAD:Use an approve-by date from today to a year out.'; END IF;
  v := mcp_private.service_work_order_view(w, c, mcp_private.service_fee_credit(_job, w.id));
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (j.company_id, _job, 'work_order', w.id, w.version, v, mcp_private.portal_fingerprint(v), _due_on, auth.uid())
  ON CONFLICT (kind, ref_id, ref_version) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL, due_on = EXCLUDED.due_on,
    view = EXCLUDED.view, fingerprint = EXCLUDED.fingerprint, shared_at = now()
  RETURNING * INTO it;
  UPDATE public.mcp_work_orders SET state = 'sent', updated_at = now() WHERE id = w.id;
  PERFORM public.mcp_project_record_add(_job, 'work_order_send', w.number || ' · ' || w.title, 'Work order sent to the client page for approval.',
    NULL, NULL, 'mcp_work_orders', w.id, jsonb_build_object('version', w.version, 'portal_item', it.id, 'fingerprint', it.fingerprint), 'user');
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'work_order', 'work_order_id', w.id, 'version', w.version, 'number', w.number,
    'label', w.number || ' · ' || w.title, 'due_on', it.due_on, 'view', v, 'fingerprint', it.fingerprint,
    'recipients', mcp_private.service_recipients(_job), 'call', mcp_private.service_call_json(_job));
END $$;
REVOKE ALL ON FUNCTION public.mcp_work_order_send(uuid, uuid, integer, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_work_order_send(uuid, uuid, integer, date) TO authenticated;

-- The customer approved the work order on site, signing on the tech's device. Records who signed and who recorded it;
-- an open client page copy is taken back.
CREATE OR REPLACE FUNCTION public.mcp_work_order_approve_on_site(_job uuid, _work_order uuid, _expected_version integer, _signed_name text, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; w public.mcp_work_orders; nm text := btrim(coalesce(_signed_name, '')); stamp timestamptz := now();
BEGIN
  j := mcp_private.service_job(_job);
  SELECT * INTO w FROM public.mcp_work_orders WHERE id = _work_order AND job_id = _job FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That work order isn''t on this call.'; END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> w.version THEN RAISE EXCEPTION 'MCP_BAD:The work order changed; read it again first.'; END IF;
  IF w.state NOT IN ('draft', 'sent', 'declined') THEN RAISE EXCEPTION 'MCP_BAD:% is already %.', w.number, w.state; END IF;
  IF length(nm) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Enter the name the customer signed with.'; END IF;
  IF length(coalesce(_note, '')) > 2000 THEN RAISE EXCEPTION 'MCP_BAD:Keep the note under 2,000 characters.'; END IF;
  UPDATE public.mcp_portal_items i SET withdrawn_at = stamp, withdrawn_by = auth.uid()
   WHERE i.kind = 'work_order' AND i.ref_id = w.id AND i.withdrawn_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id);
  UPDATE public.mcp_work_orders SET state = 'approved', updated_at = stamp,
    decision = jsonb_build_object('decision', 'approved', 'by', nm, 'at', stamp, 'channel', 'on_site', 'recorded_by', auth.uid(),
      'reference', 'Signed on site, version ' || w.version, 'note', nullif(btrim(coalesce(_note, '')), ''))
   WHERE id = w.id;
  PERFORM public.mcp_project_record_add(_job, 'work_order_approve_on_site', w.number || ' · ' || w.title,
    'Customer approved the work order on site; the team member recorded the signature.', NULL, NULL, 'mcp_work_orders', w.id,
    jsonb_build_object('version', w.version, 'signed_name', nm), 'user');
  RETURN mcp_private.service_call_json(_job);
END $$;
REVOKE ALL ON FUNCTION public.mcp_work_order_approve_on_site(uuid, uuid, integer, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_work_order_approve_on_site(uuid, uuid, integer, text, text) TO authenticated;

-- Logs the actual work on an approved work order, priced at the work order's own rates. With _p.done the
-- customer's sign-off name is required and the work order is ready to bill. A T&M or hourly bill can't go over the
-- not-to-exceed amount the customer approved.
CREATE OR REPLACE FUNCTION public.mcp_work_order_log(_job uuid, _work_order uuid, _expected_version integer, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; w public.mcp_work_orders; priced jsonb; done boolean; nm text; stamp timestamptz := now();
BEGIN
  j := mcp_private.service_job(_job);
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) x WHERE x NOT IN ('lines', 'done', 'signoff_name', 'signoff_note')) THEN
    RAISE EXCEPTION 'MCP_BAD:Unknown work log field.';
  END IF;
  SELECT * INTO w FROM public.mcp_work_orders WHERE id = _work_order AND job_id = _job FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That work order isn''t on this call.'; END IF;
  IF _expected_version IS NOT NULL AND _expected_version <> w.version THEN RAISE EXCEPTION 'MCP_BAD:The work order changed; read it again first.'; END IF;
  IF w.state NOT IN ('approved', 'done') THEN
    RAISE EXCEPTION 'MCP_BAD:%', CASE WHEN w.state = 'billed' THEN w.number || ' is already billed.' ELSE 'The customer hasn''t approved ' || w.number || ' yet.' END;
  END IF;
  priced := mcp_private.service_price(w.basis, _p->'lines', w.rates);
  IF w.cap_cents IS NOT NULL AND (priced->>'total_cents')::bigint > w.cap_cents THEN
    RAISE EXCEPTION 'MCP_BAD:That''s % , over the % the customer approved. Send a revised work order for the extra first.',
      mcp_private.service_money((priced->>'total_cents')::numeric), mcp_private.service_money(w.cap_cents);
  END IF;
  done := coalesce((_p->>'done')::boolean, false);
  nm := btrim(coalesce(_p->>'signoff_name', ''));
  IF done AND length(nm) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'MCP_BAD:Enter the name the customer signed off with.'; END IF;
  IF length(coalesce(_p->>'signoff_note', '')) > 2000 THEN RAISE EXCEPTION 'MCP_BAD:Keep the note under 2,000 characters.'; END IF;
  UPDATE public.mcp_work_orders SET actual_lines = priced, actual_cents = (priced->>'total_cents')::bigint,
    state = CASE WHEN done THEN 'done' ELSE 'approved' END,
    signoff = CASE WHEN done THEN jsonb_build_object('name', nm, 'at', stamp, 'recorded_by', auth.uid(),
      'note', nullif(btrim(coalesce(_p->>'signoff_note', '')), '')) END,
    updated_at = stamp
   WHERE id = w.id RETURNING * INTO w;
  IF done THEN
    PERFORM public.mcp_project_record_add(_job, 'work_order_done', w.number || ' · ' || w.title, 'Work logged and signed off by the customer.',
      NULL, NULL, 'mcp_work_orders', w.id, jsonb_build_object('actual_cents', w.actual_cents, 'signed_name', nm), 'user');
  END IF;
  RETURN jsonb_build_object('work_order_id', w.id, 'number', w.number, 'state', w.state, 'actual', w.actual_lines,
    'actual_cents', w.actual_cents, 'estimate_cents', w.estimate_cents, 'cap_cents', w.cap_cents, 'call', mcp_private.service_call_json(_job));
END $$;
REVOKE ALL ON FUNCTION public.mcp_work_order_log(uuid, uuid, integer, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_work_order_log(uuid, uuid, integer, jsonb) TO authenticated;

-- Bills a signed-off work order: a submitted billing invoice INV-<n> for the actual work, less the paid service call
-- fee when the company credits it, shared on the client page to pay.
CREATE OR REPLACE FUNCTION public.mcp_service_bill(_job uuid, _work_order uuid, _due_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; c public.mcp_service_calls; w public.mcp_work_orders; credit bigint; net bigint; v jsonb; it public.mcp_portal_items;
  num text; lines jsonb; tz text;
BEGIN
  j := mcp_private.service_job(_job);
  SELECT * INTO c FROM public.mcp_service_calls WHERE job_id = _job FOR UPDATE;
  SELECT * INTO w FROM public.mcp_work_orders WHERE id = _work_order AND job_id = _job FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That work order isn''t on this call.'; END IF;
  IF w.state = 'billed' THEN RAISE EXCEPTION 'MCP_BAD:% is already billed.', w.number; END IF;
  IF w.state <> 'done' THEN RAISE EXCEPTION 'MCP_BAD:Log the work and the customer''s sign-off on % first.', w.number; END IF;
  tz := coalesce(nullif(j.time_zone, ''), 'America/Chicago');
  credit := least(mcp_private.service_fee_credit(_job, w.id), w.actual_cents);
  net := w.actual_cents - credit;
  num := regexp_replace(w.number, '^WO-', 'INV-');
  SELECT coalesce(jsonb_agg(jsonb_build_object('description', l->>'description', 'detail', l->>'detail', 'amount_cents', (l->>'amount_cents')::bigint) ORDER BY o), '[]'::jsonb)
    INTO lines FROM jsonb_array_elements(w.actual_lines->'lines') WITH ORDINALITY x(l, o);
  IF (w.actual_lines->>'markup_cents')::bigint > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('description', 'Markup on materials',
      'detail', trim_scale(round((w.actual_lines->>'markup_bps')::numeric / 100, 2))::text || '% of ' || mcp_private.service_money((w.actual_lines->>'material_cents')::numeric),
      'amount_cents', (w.actual_lines->>'markup_cents')::bigint));
  END IF;
  v := jsonb_build_object('number', num, 'stage', 'bill', 'title', 'Invoice ' || num, 'work_order', w.number,
    'site_address', c.site_address, 'issue', w.title, 'lines', lines,
    'signoff', jsonb_build_object('name', w.signoff->>'name', 'date', ((w.signoff->>'at')::timestamptz AT TIME ZONE tz)::date),
    'totals', jsonb_build_object('subtotal_cents', w.actual_cents, 'credit_cents', credit, 'current_due_cents', net),
    'note', CASE WHEN credit > 0 THEN 'Your ' || mcp_private.service_money(credit) || ' service call fee is credited.' END);
  it := mcp_private.service_invoice_share(j, num, 'Service call SC-' || c.number || ' work order ' || w.number, w.actual_cents, net, v, _due_on);
  UPDATE public.mcp_work_orders SET state = 'billed', bill_invoice_id = it.ref_id, updated_at = now() WHERE id = w.id;
  PERFORM public.mcp_project_record_add(_job, 'service_bill', 'Invoice ' || num, 'Service bill sent to the client page.', NULL, NULL,
    'mcp_billing_invoices', it.ref_id, jsonb_build_object('work_order', w.number, 'amount_cents', w.actual_cents, 'credit_cents', credit,
      'due_cents', net, 'portal_item', it.id), 'user');
  RETURN jsonb_build_object('item_id', it.id, 'kind', 'service_invoice', 'invoice_id', it.ref_id, 'number', num, 'label', v->>'title',
    'amount_cents', w.actual_cents, 'credit_cents', credit, 'due_cents', net, 'due_on', it.due_on, 'view', v, 'fingerprint', it.fingerprint,
    'recipients', mcp_private.service_recipients(_job), 'call', mcp_private.service_call_json(_job));
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_bill(uuid, uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_bill(uuid, uuid, date) TO authenticated;

-- Records a wire or check on a service invoice (the fee or the bill), as mcp_pay_app_record_payment does for a pay
-- application: a billing receipt applied to the invoice, no Athena fee. Void a mistake with mcp_pay_app_void_payment.
CREATE OR REPLACE FUNCTION public.mcp_service_record_payment(_job uuid, _invoice uuid, _id uuid, _method text,
  _amount_cents bigint, _received_on date, _reference text, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; inv public.mcp_billing_invoices; v public.mcp_billing_invoice_versions; r public.mcp_recorded_payments;
  rid uuid := gen_random_uuid(); aid uuid := gen_random_uuid(); left_cents bigint; word text; ref text := btrim(coalesce(_reference, ''));
  note text := nullif(btrim(coalesce(_note, '')), '');
BEGIN
  j := mcp_private.service_job(_job);
  IF _id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request id is required.'; END IF;
  SELECT * INTO r FROM public.mcp_recorded_payments WHERE id = _id;
  IF r.id IS NOT NULL THEN
    IF r.job_id <> j.id OR r.invoice_id IS DISTINCT FROM _invoice OR r.method IS DISTINCT FROM _method
       OR r.amount_cents IS DISTINCT FROM _amount_cents OR r.received_on IS DISTINCT FROM _received_on OR r.reference IS DISTINCT FROM ref THEN
      RAISE EXCEPTION 'MCP_BAD:This request was already used for a different payment.';
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'id', r.id, 'already_recorded', true);
  END IF;
  IF _method IS NULL OR _method NOT IN ('wire', 'check') THEN RAISE EXCEPTION 'MCP_BAD:Choose wire or check.'; END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 OR _amount_cents > 9000000000000 THEN RAISE EXCEPTION 'MCP_BAD:Enter the amount received.'; END IF;
  IF _received_on IS NULL OR _received_on > current_date + 1 OR _received_on < current_date - 3650 THEN
    RAISE EXCEPTION 'MCP_BAD:Enter the date the money arrived.';
  END IF;
  IF length(ref) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'MCP_BAD:%', CASE WHEN _method = 'check' THEN 'Enter the check number.' ELSE 'Enter the wire reference.' END;
  END IF;
  IF note IS NOT NULL AND length(note) > 500 THEN RAISE EXCEPTION 'MCP_BAD:Keep the note under 500 characters.'; END IF;
  SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = _invoice AND job_id = j.id AND kind = 'invoice' FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That invoice isn''t on this service call.'; END IF;
  SELECT * INTO v FROM public.mcp_billing_invoice_versions WHERE invoice_id = inv.id ORDER BY version DESC LIMIT 1;
  IF v.status NOT IN ('submitted', 'certified') THEN RAISE EXCEPTION 'MCP_BAD:Record payments on a sent invoice.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_recorded_payments WHERE job_id = j.id AND method = _method AND lower(btrim(reference)) = lower(ref) AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:%', CASE WHEN _method = 'check' THEN 'That check number is already recorded on this call.' ELSE 'That wire reference is already recorded on this call.' END;
  END IF;
  left_cents := (mcp_private.service_invoice_position(inv.id)->>'remaining_cents')::bigint;
  IF _amount_cents > left_cents THEN
    RAISE EXCEPTION 'MCP_BAD:That''s more than the % left on %.', mcp_private.service_money(greatest(left_cents, 0)), inv.document_number;
  END IF;
  word := CASE WHEN _method = 'check' THEN 'Check ' ELSE 'Wire ' END;
  INSERT INTO public.mcp_billing_receipts (id, job_id, company_id, receipt_date, source, amount_cents, recorded_by)
  VALUES (rid, j.id, j.company_id, _received_on, word || ref || ' for ' || inv.document_number || ' (recorded ' || right(_id::text, 12) || ')',
    _amount_cents, auth.uid());
  INSERT INTO public.mcp_billing_allocations (id, job_id, receipt_id, invoice_id, amount_cents, effective_date, source, recorded_by)
  VALUES (aid, j.id, rid, inv.id, _amount_cents, _received_on, word || ref, auth.uid());
  INSERT INTO public.mcp_recorded_payments (id, company_id, job_id, invoice_id, method, amount_cents, received_on, reference, note,
    receipt_id, allocation_id, recorded_by)
  VALUES (_id, j.company_id, j.id, inv.id, _method, _amount_cents, _received_on, ref, note, rid, aid, auth.uid());
  RETURN jsonb_build_object('status', 'ok', 'id', _id, 'already_recorded', false,
    'remaining_cents', greatest(left_cents - _amount_cents, 0), 'call', mcp_private.service_call_json(_job));
END $$;
REVOKE ALL ON FUNCTION public.mcp_service_record_payment(uuid, uuid, uuid, text, bigint, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_service_record_payment(uuid, uuid, uuid, text, bigint, date, text, text) TO authenticated;

-- ---------- client page functions, with the service kinds added ----------
-- The name the customer reads for a shared item, the same words as mcp_portal_list.
CREATE OR REPLACE FUNCTION mcp_private.portal_item_label(_item uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(i.view->>'number')
    WHEN i.kind = 'work_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'service_invoice' THEN i.view->>'title' ELSE i.view->'proposal'->>'title' END
    FROM public.mcp_portal_items i WHERE i.id = _item
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_item_label(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- As in 20261105120000, plus service work orders and invoices, labelled the same way the page labels them.
CREATE OR REPLACE FUNCTION public.mcp_portal_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  j := mcp_private.portal_full_job(_job);
  RETURN jsonb_build_object(
    'job_number', j.job_number, 'job_name', j.name,
    'customers', coalesce((SELECT jsonb_agg(jsonb_build_object('access_id', a.id, 'email', a.email, 'name', a.name,
        'invited_at', a.created_at, 'invite_expires_at', a.invite_expires_at, 'last_seen_at', a.last_seen_at, 'revoked_at', a.revoked_at)
        ORDER BY a.created_at) FROM public.mcp_portal_access a WHERE a.job_id = _job), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'kind', i.kind,
        'label', mcp_private.portal_item_label(i.id),
        'shared_at', i.shared_at, 'withdrawn_at', i.withdrawn_at, 'fingerprint', i.fingerprint,
        'decision', (SELECT jsonb_build_object('decision', x.decision, 'choice', x.choice, 'typed_name', x.typed_name, 'email', x.email,
            'decided_at', x.decided_at, 'note', x.note, 'reference', 'Customer page decision ' || x.id)
          FROM public.mcp_portal_decisions x WHERE x.item_id = i.id))
        ORDER BY i.shared_at DESC) FROM public.mcp_portal_items i WHERE i.job_id = _job), '[]'::jsonb),
    'updates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'week_of', u.week_of, 'title', u.title, 'posted_at', u.created_at) ORDER BY u.week_of DESC)
        FROM public.mcp_portal_updates u WHERE u.job_id = _job AND u.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_portal_list(uuid) TO authenticated;

-- As in 20261105120000, plus service work orders still out for approval at that version and service invoices still
-- open at that version.
CREATE OR REPLACE FUNCTION public.mcp_portal_view(_access uuid, _session_hash text, _ip text, _user_agent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; s public.mcp_portal_sessions; st text; j public.mcp_jobs; co public.mcp_companies; cpm jsonb;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  s := mcp_private.portal_session(a.id, _session_hash);
  IF s.id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF s.last_seen_at IS NULL OR s.last_seen_at < now() - interval '10 minutes' THEN
    UPDATE public.mcp_portal_sessions SET last_seen_at = now() WHERE id = s.id;
    UPDATE public.mcp_portal_access SET last_seen_at = now() WHERE id = a.id;
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, ip, user_agent) VALUES (a.id, a.job_id, 'viewed', left(_ip, 100), left(_user_agent, 400));
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO co FROM public.mcp_companies WHERE id = a.company_id;
  SELECT r.data INTO cpm FROM public.mcp_living_reports r WHERE r.job_id = a.job_id AND r.report_type = 'cpm' ORDER BY r.version DESC LIMIT 1;
  RETURN jsonb_build_object(
    'status', 'ok',
    'customer', jsonb_build_object('name', a.name, 'email', a.email),
    'contractor', jsonb_build_object('name', co.name, 'pm_name', j.pm_name, 'pm_title', j.pm_title, 'pm_email', j.pm_email),
    'job', jsonb_build_object('number', j.job_number, 'name', j.name, 'completion_date', j.contract_completion_date,
      'under_contract', mcp_private.gbb_job_under_contract(j.id), 'kind', j.job_kind,
      'today', (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date),
    'updates', coalesce((SELECT jsonb_agg(x ORDER BY x->>'week_of' DESC) FROM (
        SELECT jsonb_build_object('week_of', u.week_of, 'title', u.title, 'body', u.body) AS x
        FROM public.mcp_portal_updates u WHERE u.job_id = a.job_id AND u.withdrawn_at IS NULL ORDER BY u.week_of DESC, u.created_at DESC LIMIT 12) q), '[]'::jsonb),
    'dailies', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (
        SELECT jsonb_build_object('date', d.report_date, 'weather', d.weather, 'manpower', d.manpower,
          'work', coalesce((SELECT jsonb_agg(w.work ORDER BY w.line_no) FROM public.mcp_daily_work_lines w WHERE w.daily_id = d.id), '[]'::jsonb)) AS x
        FROM public.mcp_daily_reports d WHERE d.job_id = a.job_id ORDER BY d.report_date DESC LIMIT 10) q), '[]'::jsonb),
    'photos', coalesce((SELECT jsonb_agg(x ORDER BY x->>'taken_on' DESC) FROM (
        SELECT jsonb_build_object('id', p.id, 'taken_on', p.taken_on, 'area', p.area, 'work', p.work, 'storage_path', p.storage_path) AS x
        FROM public.mcp_progress_photos p WHERE p.job_id = a.job_id AND p.client_safe AND p.removed_at IS NULL
        ORDER BY p.taken_on DESC, p.created_at DESC LIMIT 60) q), '[]'::jsonb),
    'milestones', coalesce((SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
        SELECT jsonb_build_object('name', m->>'name',
          'date', coalesce(nullif(m->>'actual_finish', ''), nullif(m->>'finish', ''), nullif(m->>'actual_start', ''), nullif(m->>'start', '')),
          'done', (nullif(m->>'actual_finish', '') IS NOT NULL OR coalesce(nullif(m->>'pct_complete', '')::numeric, 0) >= 100)) AS x
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cpm->'activities') = 'array' THEN cpm->'activities' ELSE '[]'::jsonb END) m
        WHERE (m->>'activity_type' IN ('milestone-start', 'milestone-finish') OR (m->>'duration' ~ '^-?[0-9.]+$' AND (m->>'duration')::numeric = 0))
          AND length(btrim(coalesce(m->>'name', ''))) > 0
          AND coalesce(nullif(m->>'actual_finish', ''), nullif(m->>'finish', ''), nullif(m->>'actual_start', ''), nullif(m->>'start', '')) IS NOT NULL
        LIMIT 40) q), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'shared_on', (i.shared_at AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date,
          'due_on', i.due_on, 'fingerprint', i.fingerprint, 'view', i.view,
          'decision', (SELECT jsonb_build_object('decision', x.decision, 'choice', x.choice, 'typed_name', x.typed_name, 'decided_at', x.decided_at,
              'note', x.note, 'code_verified', x.code_verified) FROM public.mcp_portal_decisions x WHERE x.item_id = i.id))
        ORDER BY i.shared_at DESC)
      FROM public.mcp_portal_items i WHERE i.job_id = a.job_id AND i.withdrawn_at IS NULL
        -- An undecided item shows only while it still matches the record; an edit hides it until it is shared again.
        AND (EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = i.id)
          OR (i.kind = 'change_order' AND EXISTS (SELECT 1 FROM public.mcp_change_orders c WHERE c.submittal_id = i.ref_id
                AND (c.details->>'record_version')::bigint = i.ref_version AND c.details->>'state' = 'priced'))
          OR (i.kind = 'selection' AND EXISTS (SELECT 1 FROM mcp_private.residential_selection_boards b WHERE b.job_id = i.job_id
                AND b.version = i.ref_version AND jsonb_typeof(b.body->'accepted') IS DISTINCT FROM 'object'))
          OR (i.kind = 'pay_app' AND mcp_private.portal_pay_app_open(i.job_id, i.ref_id, i.ref_version))
          OR (i.kind = 'work_order' AND EXISTS (SELECT 1 FROM public.mcp_work_orders w WHERE w.id = i.ref_id AND w.job_id = i.job_id
                AND w.version = i.ref_version AND w.state = 'sent'))
          OR (i.kind = 'service_invoice' AND mcp_private.service_invoice_open(i.job_id, i.ref_id, i.ref_version)))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_view(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_view(uuid, text, text, text) TO service_role;

-- As in 20261105150000, plus approve (fresh emailed code) or decline on a service work order. The decision moves
-- that exact version of the work order to approved or declined; a service invoice is paid, never decided.
CREATE OR REPLACE FUNCTION public.mcp_portal_decide(_access uuid, _session_hash text, _item uuid, _decision text, _choice text,
  _code_hash text, _typed_name text, _statement text, _fingerprint text, _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; chk text := 'not_needed'; did uuid; j public.mcp_jobs;
  s public.mcp_submittals; c public.mcp_change_orders; d jsonb; ev jsonb; co_count int; evidence text; stamp timestamptz := now();
  under boolean := false; diff numeric; seq int; tn int; tid uuid; tier_name text; pco text; pco_id uuid; sel_title text;
  pkg jsonb; days int := 0; added numeric := 0; base_name text; cur text; time_text text; co_lines jsonb; co_no text;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL FOR UPDATE;
  IF it.id IS NULL OR EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = it.id) THEN RETURN jsonb_build_object('status', 'not_open'); END IF;
  IF _fingerprint IS DISTINCT FROM it.fingerprint THEN RETURN jsonb_build_object('status', 'changed'); END IF;
  IF NOT ((it.kind IN ('change_order', 'pay_app', 'work_order') AND _decision IN ('approved', 'declined') AND _choice IS NULL)
       OR (it.kind = 'selection' AND _decision = 'chosen' AND _choice IN ('good', 'better', 'best'))) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF length(btrim(coalesce(_typed_name, ''))) NOT BETWEEN 2 AND 120 OR length(btrim(coalesce(_statement, ''))) NOT BETWEEN 1 AND 1000
     OR length(coalesce(_note, '')) > 2000 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF _decision IN ('approved', 'chosen') THEN
    chk := mcp_private.portal_code_check(a.id, 'decide', it.id, _code_hash);
    IF chk <> 'ok' THEN RETURN jsonb_build_object('status', chk); END IF;
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  BEGIN
    INSERT INTO public.mcp_portal_decisions (item_id, access_id, decision, choice, typed_name, statement, fingerprint, note, email, code_verified, ip, user_agent, decided_at)
    VALUES (it.id, a.id, _decision, _choice, btrim(_typed_name), btrim(_statement), it.fingerprint, nullif(btrim(coalesce(_note, '')), ''), a.email,
      chk = 'ok', left(_ip, 100), left(_user_agent, 400), stamp)
    RETURNING id INTO did;
    IF it.kind = 'change_order' THEN
      SELECT * INTO s FROM public.mcp_submittals WHERE id = it.ref_id AND job_id = a.job_id FOR UPDATE;
      SELECT * INTO c FROM public.mcp_change_orders WHERE submittal_id = it.ref_id FOR UPDATE;
      d := c.details;
      IF s.id IS NULL OR c.submittal_id IS NULL OR (d->>'record_version')::bigint IS DISTINCT FROM it.ref_version OR d->>'state' IS DISTINCT FROM 'priced'
         OR EXISTS (SELECT 1 FROM public.mcp_submittals x WHERE x.job_id = a.job_id AND x.number = s.number AND x.revision > s.revision) THEN
        RAISE EXCEPTION 'MCP_PORTAL_CHANGED';
      END IF;
      ev := jsonb_build_object('by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
        'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint,
        'email_code_verified', chk = 'ok');
      d := d || jsonb_build_object('state', CASE WHEN _decision = 'approved' THEN 'approved' ELSE 'rejected' END, 'decision', ev);
      IF _decision = 'approved' THEN
        SELECT coalesce(max(substring(details->>'co_number' FROM '[0-9]+$')::int), 0) + 1 INTO co_count
          FROM public.mcp_change_orders WHERE job_id = a.job_id AND details->>'co_number' ~ '^CO-[0-9]{1,8}$';
        d := d || jsonb_build_object('co_number', 'CO-' || lpad(co_count::text, greatest(3, length(co_count::text)), '0'));
      END IF;
      d := jsonb_set(d, '{record_version}', to_jsonb((d->>'record_version')::int + 1));
      UPDATE public.mcp_change_orders SET details = d, updated_at = now() WHERE submittal_id = s.id;
      UPDATE public.mcp_submittals SET status = 'in_review', returned_on = (stamp AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'UTC'))::date,
        ball_in_court = 'gc', updated_at = now() WHERE id = s.id;
      INSERT INTO public.mcp_change_history (submittal_id, job_id, record_version, action, snapshot, actor_id)
      VALUES (s.id, a.job_id, (d->>'record_version')::int, CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'reject' END, d, a.created_by);
      PERFORM public.mcp_project_record_add(a.job_id, 'change_order_' || CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'reject' END,
        s.number || ' · ' || s.title, 'Customer decision recorded on the customer page; commercial details require full job access.',
        NULL, NULL, 'mcp_submittals', s.id, jsonb_build_object('submittal_id', s.id, 'state', d->>'state', 'portal_decision', did), 'user');
    ELSIF it.kind = 'pay_app' THEN
      -- The customer's approval is recorded as their decision on exactly this frozen version. It does not certify the
      -- application, post billing or record a payment; the contractor records the actual certificate as before.
      IF NOT mcp_private.portal_pay_app_open(a.job_id, it.ref_id, it.ref_version) THEN RAISE EXCEPTION 'MCP_PORTAL_CHANGED'; END IF;
      PERFORM public.mcp_project_record_add(a.job_id, 'pay_application_customer_' || CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'decline' END,
        mcp_private.portal_pay_app_label(it.view->>'number'),
        'Customer decision recorded on the customer page. The pay application, its certificate and billing are unchanged.',
        NULL, NULL, 'mcp_payment_applications', it.ref_id,
        jsonb_build_object('application_id', it.ref_id, 'version', it.ref_version, 'decision', _decision, 'portal_decision', did,
          'fingerprint', it.fingerprint), 'user');
    ELSIF it.kind = 'work_order' THEN
      UPDATE public.mcp_work_orders w SET state = CASE WHEN _decision = 'approved' THEN 'approved' ELSE 'declined' END,
        decision = jsonb_build_object('decision', _decision, 'by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
          'reference', 'Customer page decision ' || did, 'fingerprint', it.fingerprint, 'email_code_verified', chk = 'ok',
          'note', nullif(btrim(coalesce(_note, '')), '')),
        updated_at = stamp
       WHERE w.id = it.ref_id AND w.job_id = a.job_id AND w.version = it.ref_version AND w.state = 'sent';
      IF NOT FOUND THEN RAISE EXCEPTION 'MCP_PORTAL_CHANGED'; END IF;
      PERFORM public.mcp_project_record_add(a.job_id, 'work_order_customer_' || CASE WHEN _decision = 'approved' THEN 'approve' ELSE 'decline' END,
        (it.view->>'number') || ' · ' || (it.view->>'title'),
        'Customer decision on the work order recorded on the client page.', NULL, NULL, 'mcp_work_orders', it.ref_id,
        jsonb_build_object('work_order_id', it.ref_id, 'version', it.ref_version, 'decision', _decision, 'portal_decision', did,
          'fingerprint', it.fingerprint), 'user');
    ELSE
      evidence := left('Chosen on the customer page by ' || btrim(_typed_name) || ' <' || a.email || '> with an emailed code. Decision '
        || did || ', fingerprint ' || it.fingerprint || '.', 500);
      PERFORM public.mcp_residential_selections_record_choice(a.job_id, it.ref_version, _choice, current_date, evidence);
      -- Under contract, a package that changes the price or the time is a change order, and the customer's
      -- signed choice approves it: the signed difference (products plus any added cost) and the stated time.
      -- Before a contract there is no change order; the signed choice sets the proposal price.
      under := mcp_private.gbb_job_under_contract(a.job_id);
      SELECT x INTO pkg FROM jsonb_array_elements(it.view->'proposal'->'packages') x WHERE x->>'tier' = _choice;
      diff := (pkg->>'difference_cents')::numeric;
      days := coalesce((pkg->>'schedule_days')::int, 0);
      added := coalesce((pkg->>'added_cents')::numeric, 0);
      IF under AND (coalesce(diff, 0) <> 0 OR days > 0) THEN
        tier_name := initcap(_choice);
        base_name := initcap(it.view->'proposal'->>'base_tier');
        cur := coalesce(it.view->'proposal'->>'currency', '');
        sel_title := left(coalesce(nullif(btrim(it.view->'proposal'->>'title'), ''), 'Selections'), 150);
        time_text := CASE WHEN days > 0 THEN 'The additional time necessary for this change is ' || days || CASE WHEN days = 1 THEN ' day.' ELSE ' days.' END
          ELSE 'No additional time is necessary for this change.' END;
        -- One line per selection whose product changes, plus the added cost, so the lines add up to the signed total.
        SELECT coalesce(jsonb_agg(jsonb_build_object('category', 'material',
            'description', left((sl->>'title') || ': ' || tier_name || ' · ' || coalesce(nullif(btrim(concat_ws(' ', sl->'options'->_choice->>'manufacturer', sl->'options'->_choice->>'model')), ''), sl->'options'->_choice->>'description'), 1000),
            'quantity', (sl->>'quantity')::numeric, 'unit', sl->>'unit',
            'source', 'Signed package choice, customer page decision ' || did,
            'amount_cents', (sl->'options'->_choice->>'difference_cents')::numeric)), '[]'::jsonb)
          INTO co_lines
          FROM jsonb_array_elements(it.view->'proposal'->'selections') sl
         WHERE coalesce((sl->'options'->_choice->>'difference_cents')::numeric, 0) <> 0;
        IF added <> 0 THEN
          co_lines := co_lines || jsonb_build_array(jsonb_build_object('category', 'other',
            'description', left(coalesce(nullif(btrim(pkg->>'added_note'), ''), 'Added cost for the ' || tier_name || ' package'), 1000),
            'source', 'Signed package choice, customer page decision ' || did, 'amount_cents', added));
        END IF;
        SELECT coalesce(max(substring(number FROM '[0-9]+$')::int), 0) + 1 INTO seq FROM public.mcp_submittals WHERE job_id = a.job_id AND number ~ '^PCO-[0-9]{1,8}$';
        SELECT coalesce(max(substring(details->>'co_number' FROM '[0-9]+$')::int), 0) + 1 INTO co_count
          FROM public.mcp_change_orders WHERE job_id = a.job_id AND details->>'co_number' ~ '^CO-[0-9]{1,8}$';
        SELECT coalesce(max(number), 0) + 1 INTO tn FROM public.mcp_transmittals WHERE job_id = a.job_id;
        INSERT INTO public.mcp_transmittals (company_id, job_id, number) VALUES (j.company_id, a.job_id, tn) RETURNING id INTO tid;
        INSERT INTO public.mcp_submittals (company_id, job_id, number, revision, transmittal_id, spec_section, title, submittal_type, status, ball_in_court, source, required, package_purpose, required_by, returned_on)
        VALUES (j.company_id, a.job_id, 'PCO-' || lpad(seq::text, greatest(3, length(seq::text)), '0'), 0, tid, '', left(tier_name || ' package: ' || sel_title, 200),
          'other', 'in_review', 'gc', 'user', true, 'change_order', NULL, (stamp AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'UTC'))::date) RETURNING * INTO s;
        ev := jsonb_build_object('by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
          'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint,
          'email_code_verified', chk = 'ok');
        d := jsonb_build_object('state', 'approved', 'record_version', 1, 'origin', 'owner',
          'co_number', 'CO-' || lpad(co_count::text, greatest(3, length(co_count::text)), '0'),
          'condition', 'The customer chose the ' || tier_name || ' package for ' || sel_title || ' on the customer page and signed it with an emailed code.',
          'scope', 'Change from the ' || base_name || ' package to ' || tier_name || ' for ' || sel_title || ', approved by the customer for '
            || CASE WHEN diff < 0 THEN '-' ELSE '+' END || to_char(abs(diff) / 100, 'FM999,999,999,990.00') || ' ' || cur || '. ' || time_text,
          'references', jsonb_build_array(jsonb_build_object('kind', 'condition', 'citation', 'Customer page decision ' || did || ' (' || tier_name || ', fingerprint ' || it.fingerprint || ')')),
          'recipient_name', to_jsonb(a.name), 'recipient_email', to_jsonb(a.email), 'due_date', NULL, 'owner_number', NULL,
          'schedule_days', days, 'lines', co_lines, 'total_cents', diff, 'decision', ev,
          'customer_choice', jsonb_build_object('tier', _choice, 'difference_cents', diff, 'schedule_days', days, 'added_cents', added,
            'by', btrim(_typed_name) || ' <' || a.email || '>', 'at', stamp,
            'reference', 'Customer page decision ' || did, 'channel', 'customer_page', 'fingerprint', it.fingerprint, 'email_code_verified', chk = 'ok'));
        INSERT INTO public.mcp_change_orders (submittal_id, job_id, details) VALUES (s.id, a.job_id, d);
        INSERT INTO public.mcp_change_history (submittal_id, job_id, record_version, action, snapshot, actor_id)
        VALUES (s.id, a.job_id, 1, 'approve', d, a.created_by);
        PERFORM public.mcp_project_record_add(a.job_id, 'change_order_approve', s.number || ' · ' || s.title,
          'Customer approved the change order by choosing a package on the customer page; commercial details require full job access.',
          NULL, NULL, 'mcp_submittals', s.id, jsonb_build_object('submittal_id', s.id, 'state', 'approved', 'portal_decision', did), 'user');
        pco := s.number; pco_id := s.id; co_no := d->>'co_number';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
    VALUES (a.id, a.job_id, 'decision_refused', jsonb_build_object('item', it.id, 'reason', left(SQLERRM, 200)), left(_ip, 100), left(_user_agent, 400));
    RETURN jsonb_build_object('status', 'changed');
  END;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'decided', jsonb_build_object('item', it.id, 'decision', _decision, 'choice', _choice, 'decision_id', did), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'decision_id', did, 'decided_at', stamp, 'customer', a.name, 'customer_email', a.email,
    'job_name', j.name, 'job_number', j.job_number, 'pm_email', j.pm_email, 'pm_name', j.pm_name,
    'under_contract', under, 'difference_cents', diff, 'schedule_days', CASE WHEN it.kind = 'selection' THEN days END,
    'change_order_number', pco, 'change_order_id', pco_id, 'co_number', co_no,
    'label', CASE WHEN it.kind = 'change_order' THEN (it.view->>'number') || ' · ' || (it.view->>'title')
      WHEN it.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(it.view->>'number')
      WHEN it.kind = 'work_order' THEN (it.view->>'number') || ' · ' || (it.view->>'title') ELSE it.view->'proposal'->>'title' END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_decide(uuid, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;

-- As in 20261105190000, with wire and check payments counted on service invoices too.
CREATE OR REPLACE FUNCTION public.mcp_portal_payments_state(_access uuid, _session_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; cp public.mcp_company_payments;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL OR (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = a.company_id;
  RETURN jsonb_build_object('status', 'ok',
    'accepting', coalesce(CASE WHEN cp.mode = 'live' THEN cp.status_live = 'ready' ELSE cp.status_test = 'ready' END, false),
    'test', coalesce(cp.mode, 'test') = 'test',
    'card', coalesce(cp.card_enabled, false), 'bank', coalesce(cp.bank_enabled, false), 'card_max_cents', coalesce(cp.card_max_cents, 0),
    'payments', coalesce((SELECT jsonb_agg(mcp_private.portal_payment_json(p) ORDER BY p.created_at DESC)
      FROM public.mcp_portal_payments p WHERE p.access_id IN (SELECT x.id FROM public.mcp_portal_access x WHERE x.job_id = a.job_id)
        AND p.status <> 'expired'), '[]'::jsonb),
    -- Wire and check payments the team recorded, per shared pay application: the total and the latest one.
    'recorded', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'amount_cents', r.total,
        'method', r.method, 'received_on', r.received_on) ORDER BY i.shared_at DESC)
      FROM public.mcp_portal_items i
      JOIN LATERAL (SELECT sum(x.amount_cents) AS total,
          CASE WHEN count(DISTINCT x.method) > 1 THEN 'mixed' ELSE min(x.method) END AS method, max(x.received_on) AS received_on
        FROM public.mcp_recorded_payments x WHERE x.invoice_id = i.ref_id AND x.job_id = i.job_id AND x.voided_at IS NULL) r ON r.total IS NOT NULL
      WHERE i.job_id = a.job_id AND i.kind IN ('pay_app', 'service_invoice') AND i.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_payments_state(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_payments_state(uuid, text) TO service_role;

-- As in 20261105190000, and a service invoice (a service call fee or a service bill) can be paid without a decision:
-- the customer approved the work order, and the fee is the price of the visit.
-- The customer asks to pay an approved pay application. Returns what the app server needs to open a Checkout
-- session on the contractor's account, or why it can't. An open session that can still be used is returned as is.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_start(_access uuid, _session_hash text, _item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; d public.mcp_portal_decisions;
  cp public.mcp_company_payments; j public.mcp_jobs; c public.mcp_companies; p public.mcp_portal_payments; due bigint; acct text;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL FOR UPDATE;
  IF it.id IS NULL OR it.kind NOT IN ('pay_app', 'service_invoice') THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO d FROM public.mcp_portal_decisions WHERE item_id = it.id;
  IF it.kind = 'service_invoice' AND NOT mcp_private.service_invoice_open(it.job_id, it.ref_id, it.ref_version) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF it.kind = 'pay_app' AND d.decision IS DISTINCT FROM 'approved' THEN RETURN jsonb_build_object('status', 'not_approved'); END IF;
  due := nullif(it.view->'totals'->>'current_due_cents', '')::bigint
    - coalesce((SELECT sum(amount_cents) FROM public.mcp_recorded_payments
                 WHERE invoice_id = it.ref_id AND job_id = it.job_id AND voided_at IS NULL), 0);
  IF due IS NULL OR due <= 0 THEN RETURN jsonb_build_object('status', 'nothing_due'); END IF;
  SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = a.company_id;
  acct := CASE WHEN cp.mode = 'live' THEN cp.account_live ELSE cp.account_test END;
  IF acct IS NULL OR (CASE WHEN cp.mode = 'live' THEN cp.status_live ELSE cp.status_test END) <> 'ready' THEN
    RETURN jsonb_build_object('status', 'not_accepting');
  END IF;
  SELECT * INTO p FROM public.mcp_portal_payments WHERE item_id = it.id AND status IN ('open', 'processing', 'paid', 'partially_refunded');
  IF p.status IN ('processing', 'paid', 'partially_refunded') THEN RETURN jsonb_build_object('status', 'already_paid', 'payment', mcp_private.portal_payment_json(p)); END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO c FROM public.mcp_companies WHERE id = a.company_id;
  RETURN jsonb_build_object('status', 'ok', 'company_id', a.company_id, 'job_id', a.job_id, 'item_id', it.id, 'access_id', a.id,
    'mode', cp.mode, 'account_id', acct, 'amount_cents', due, 'email', a.email, 'customer', a.name,
    'label', mcp_private.portal_item_label(it.id), 'job_number', j.job_number, 'job_name', j.name, 'company', c.name,
    'card', cp.card_enabled AND due <= cp.card_max_cents, 'bank', cp.bank_enabled,
    'open_session', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('checkout_session_id', p.checkout_session_id,
      'methods', to_jsonb(p.methods), 'amount_cents', p.amount_cents, 'mode', p.mode, 'account_id', p.account_id, 'created_at', p.created_at) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_start(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_start(uuid, text, uuid) TO service_role;

-- As in 20261105190000, for service invoices too.
-- Keeps the Checkout session the app server opened. An older open session for the same item is closed first: the
-- app server expires it at Stripe before calling this.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_opened(_item uuid, _access uuid, _mode text, _account text, _session text,
  _methods text[], _amount_cents bigint, _fee_cents bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it public.mcp_portal_items; p public.mcp_portal_payments;
BEGIN
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND kind IN ('pay_app', 'service_invoice') FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Unknown pay application.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_portal_payments WHERE item_id = _item AND status IN ('processing', 'paid', 'partially_refunded')) THEN
    RAISE EXCEPTION 'MCP_BAD:This pay application is already paid.';
  END IF;
  UPDATE public.mcp_portal_payments SET status = 'expired', updated_at = now() WHERE item_id = _item AND status = 'open';
  INSERT INTO public.mcp_portal_payments (company_id, job_id, item_id, access_id, mode, account_id, checkout_session_id, methods, amount_cents, fee_cents)
  VALUES (it.company_id, it.job_id, it.id, _access, _mode, _account, _session, _methods, _amount_cents, _fee_cents) RETURNING * INTO p;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (_access, it.job_id, 'payment_started', jsonb_build_object('item', it.id, 'payment', p.id, 'amount_cents', _amount_cents, 'mode', _mode));
  RETURN jsonb_build_object('status', 'ok', 'payment_id', p.id);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_opened(uuid, uuid, text, text, text, text[], bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_opened(uuid, uuid, text, text, text, text[], bigint, bigint) TO service_role;

-- As in 20261105190000; a paid service invoice is applied to its own billing invoice the same way.
-- A Checkout session moved on, as the app server re-read it from Stripe: processing (a bank payment on its way),
-- paid, failed or expired. Paid books the money on the job: a billing receipt, applied to the pay application when
-- its billing record is submitted or certified and still has that much due. Repeats change nothing.
-- _amount_cents is what the customer paid (Stripe's amount_total); it must match the session's amount.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_update(_session text, _account text, _status text, _payment_intent text,
  _charge text, _method text, _amount_cents bigint, _fee_cents bigint, _paid_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_portal_payments; it public.mcp_portal_items; cp public.mcp_company_payments; j public.mcp_jobs;
  inv public.mcp_billing_invoices; v public.mcp_billing_invoice_versions; was text; rid uuid; aid uuid; applied bigint; label text;
BEGIN
  IF _status NOT IN ('processing', 'paid', 'failed', 'expired') THEN RAISE EXCEPTION 'MCP_BAD:Unknown payment status.'; END IF;
  SELECT * INTO p FROM public.mcp_portal_payments WHERE checkout_session_id = _session FOR UPDATE;
  IF p.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown_session'); END IF;
  IF p.account_id <> _account THEN RAISE EXCEPTION 'MCP_BAD:Payment account does not match.'; END IF;
  was := p.status;
  -- Final states don't move back; a refund has its own function.
  IF was IN ('paid', 'refunded', 'partially_refunded') OR (was IN ('failed', 'expired') AND _status <> 'paid')
     OR (was = 'processing' AND _status = 'processing') OR was = _status THEN
    RETURN jsonb_build_object('status', 'unchanged', 'payment_id', p.id, 'payment_status', was);
  END IF;
  IF _status IN ('processing', 'paid') THEN
    IF _payment_intent IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A paid session needs its payment.'; END IF;
    IF _amount_cents IS DISTINCT FROM p.amount_cents THEN RAISE EXCEPTION 'MCP_BAD:Paid amount does not match the session.'; END IF;
  END IF;
  -- An expired session that still got paid (a late bank payment) takes the item's active slot back.
  IF _status = 'paid' AND was IN ('failed', 'expired') THEN
    UPDATE public.mcp_portal_payments SET status = 'expired', updated_at = now() WHERE item_id = p.item_id AND id <> p.id AND status = 'open';
    IF EXISTS (SELECT 1 FROM public.mcp_portal_payments WHERE item_id = p.item_id AND id <> p.id AND status IN ('processing', 'paid', 'partially_refunded')) THEN
      RAISE EXCEPTION 'MCP_BAD:This pay application was paid twice; refund one of the payments in Stripe.';
    END IF;
  END IF;
  UPDATE public.mcp_portal_payments SET status = _status,
    payment_intent_id = coalesce(_payment_intent, payment_intent_id), charge_id = coalesce(_charge, charge_id),
    method = coalesce(_method, method), fee_cents = coalesce(_fee_cents, fee_cents),
    paid_at = CASE WHEN _status = 'paid' THEN coalesce(_paid_at, now()) ELSE paid_at END, updated_at = now()
   WHERE id = p.id RETURNING * INTO p;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = p.item_id;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = p.job_id;
  label := mcp_private.portal_item_label(it.id);
  IF _status = 'paid' THEN
    SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = p.company_id;
    rid := gen_random_uuid();
    INSERT INTO public.mcp_billing_receipts (id, job_id, company_id, receipt_date, source, amount_cents, recorded_by)
    VALUES (rid, p.job_id, p.company_id, (p.paid_at AT TIME ZONE 'UTC')::date,
      'Client page payment ' || p.payment_intent_id || CASE WHEN p.mode = 'test' THEN ' (Stripe test mode)' ELSE '' END || ' for ' || coalesce(label, 'pay application'),
      p.amount_cents, cp.connected_by);
    -- Apply it to the pay application's billing record when that record can take it.
    SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = it.ref_id AND job_id = p.job_id
      AND ((it.kind = 'pay_app' AND kind = 'pay_application') OR (it.kind = 'service_invoice' AND kind = 'invoice'));
    IF inv.id IS NOT NULL THEN
      SELECT * INTO v FROM public.mcp_billing_invoice_versions WHERE invoice_id = inv.id ORDER BY version DESC LIMIT 1;
      applied := coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id = inv.id), 0);
      IF v.status IN ('submitted', 'certified') AND v.net_due_cents - public.mcp_billing_posted_credits(p.job_id, inv.id, NULL) - applied >= p.amount_cents THEN
        aid := gen_random_uuid();
        INSERT INTO public.mcp_billing_allocations (id, job_id, receipt_id, invoice_id, amount_cents, effective_date, source, recorded_by)
        VALUES (aid, p.job_id, rid, inv.id, p.amount_cents, (p.paid_at AT TIME ZONE 'UTC')::date, 'Client page payment ' || p.payment_intent_id, cp.connected_by);
      END IF;
    END IF;
    UPDATE public.mcp_portal_payments SET receipt_id = rid, allocation_id = aid WHERE id = p.id RETURNING * INTO p;
  END IF;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (p.access_id, p.job_id, 'payment_' || _status, jsonb_build_object('item', p.item_id, 'payment', p.id, 'amount_cents', p.amount_cents));
  RETURN jsonb_build_object('status', 'changed', 'payment_id', p.id, 'payment_status', p.status, 'was', was,
    'job_id', p.job_id, 'job_number', j.job_number, 'job_name', j.name, 'item_id', p.item_id, 'label', label,
    'customer', (SELECT name FROM public.mcp_portal_access WHERE id = p.access_id), 'amount_cents', p.amount_cents,
    'method', p.method, 'test', p.mode = 'test', 'applied', p.allocation_id IS NOT NULL, 'booked', p.receipt_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_update(text, text, text, text, text, text, bigint, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_update(text, text, text, text, text, text, bigint, bigint, timestamptz) TO service_role;
