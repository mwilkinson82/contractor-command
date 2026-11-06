-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after 20261106120000_athena_precon.sql.
--
-- Owners sign pre-construction agreements on the client page.
-- Before: a pre-con agreement went to the owner outside Athena (paper or email), the member told Athena who signed,
-- and its payments were only "in full at signing" or "half at signing, half at final drawings".
-- After:
--   * Each agreement carries its own terms from the contractor: any number of payments (up to 12), each with an
--     amount and when it's due (when the owner signs, when they approve the final drawings, on a date, or at a step
--     the contractor names, such as "when you approve the schematic design"), the contractor's own extra terms (up
--     to 10 lines), and whether Athena's standard construction line is shown. Saved with mcp_precon_terms_save.
--     An agreement with no payments keeps its old billing (full or split), so nothing saved before changes.
--   * mcp_precon_portal_send puts the agreement on the owner's client page (portal kind precon_agreement) as a
--     whitelisted view: what they get, the designer, the price, the payments and the terms. Never the fee build-up.
--   * mcp_portal_precon_sign (server only) is the owner's signature or decline. Signing needs the owner's
--     agreement to do business electronically (the exact consent words are stored), a fresh emailed code, their
--     typed name and the signature statement. It marks the agreement signed on the client page, writes the full
--     signature record to the project record, and puts payment 1 on their page when it's due at signing.
--   * A change to the terms after sending takes the agreement off the client page (a trigger; a declined one stays as the owner's record), so a signature only
--     ever counts for the version the owner saw. The contractor shares the new version again.
--   * Pay by check: on a pre-con bill the owner can tell the contractor they're paying by check
--     (mcp_portal_check_request, server only); the contractor sets the pickup date, time, place and who collects
--     it (mcp_precon_check_pickup), and the owner sees it on their page. The check itself is recorded as before
--     (recorded check and wire payments), and the bill then shows paid.
--   * mcp_precon_invoice_share bills by the agreement's own payments.
-- Rollback: supabase/rollbacks/20261106130000_athena_precon_signing.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS mcp_private;

-- 1. The agreement's own terms, and where it is on the client page.
ALTER TABLE public.mcp_precon_agreements ADD COLUMN IF NOT EXISTS payments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.mcp_precon_agreements ADD COLUMN IF NOT EXISTS own_terms jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.mcp_precon_agreements ADD COLUMN IF NOT EXISTS construction_line boolean NOT NULL DEFAULT true;
ALTER TABLE public.mcp_precon_agreements ADD COLUMN IF NOT EXISTS portal_item_id uuid REFERENCES public.mcp_portal_items(id) ON DELETE SET NULL;
ALTER TABLE public.mcp_precon_agreements ADD COLUMN IF NOT EXISTS signed_decision_id uuid REFERENCES public.mcp_portal_decisions(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_precon_agreements'::regclass AND conname = 'mcp_precon_agreements_payments_check') THEN
    ALTER TABLE public.mcp_precon_agreements ADD CONSTRAINT mcp_precon_agreements_payments_check
      CHECK (jsonb_typeof(payments) = 'array' AND jsonb_array_length(payments) <= 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_precon_agreements'::regclass AND conname = 'mcp_precon_agreements_own_terms_check') THEN
    ALTER TABLE public.mcp_precon_agreements ADD CONSTRAINT mcp_precon_agreements_own_terms_check
      CHECK (jsonb_typeof(own_terms) = 'array' AND jsonb_array_length(own_terms) <= 10);
  END IF;
END $$;
COMMENT ON COLUMN public.mcp_precon_agreements.payments IS 'The owner''s payments, in order: [{amount_cents, due (signing | final_drawings | date | step), on (date), when (the step, in the contractor''s words)}]. Empty: billing full or split applies.';
COMMENT ON COLUMN public.mcp_precon_agreements.own_terms IS 'The contractor''s own extra terms, shown to the owner word for word: an array of up to 10 sentences.';
COMMENT ON COLUMN public.mcp_precon_agreements.construction_line IS 'Show Athena''s standard line that building needs its own construction contract.';
COMMENT ON COLUMN public.mcp_precon_agreements.portal_item_id IS 'The agreement as shared on the client page now, if it is there.';
COMMENT ON COLUMN public.mcp_precon_agreements.signed_decision_id IS 'The owner''s signature on the client page.';

-- 2. The client page: a pre-con agreement item, a signed decision, and the consent words kept with it.
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.mcp_portal_items'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%change_order%' LOOP
    EXECUTE format('ALTER TABLE public.mcp_portal_items DROP CONSTRAINT %I', c);
  END LOOP;
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.mcp_portal_decisions'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%chosen%' LOOP
    EXECUTE format('ALTER TABLE public.mcp_portal_decisions DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.mcp_portal_items ADD CONSTRAINT mcp_portal_items_kind_check
  CHECK (kind IN ('change_order', 'selection', 'pay_app', 'work_order', 'service_invoice', 'precon_agreement'));
ALTER TABLE public.mcp_portal_decisions ADD CONSTRAINT mcp_portal_decisions_decision_check
  CHECK (decision IN ('approved', 'declined', 'chosen', 'signed'));
ALTER TABLE public.mcp_portal_decisions ADD COLUMN IF NOT EXISTS consent text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_portal_decisions'::regclass AND conname = 'mcp_portal_decisions_consent_check') THEN
    ALTER TABLE public.mcp_portal_decisions ADD CONSTRAINT mcp_portal_decisions_consent_check
      CHECK (consent IS NULL OR length(btrim(consent)) BETWEEN 1 AND 1500);
  END IF;
END $$;
COMMENT ON COLUMN public.mcp_portal_decisions.consent IS 'The exact words the customer agreed to before signing electronically.';

-- 3. Paying a pre-con bill by check: the owner's note, then the pickup the contractor sets.
CREATE TABLE IF NOT EXISTS public.mcp_portal_check_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES public.mcp_portal_items(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  access_id uuid REFERENCES public.mcp_portal_access(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  requested_at timestamptz,
  pickup_on date,
  pickup_window text CHECK (pickup_window IS NULL OR length(btrim(pickup_window)) BETWEEN 1 AND 60),
  pickup_place text CHECK (pickup_place IS NULL OR length(btrim(pickup_place)) BETWEEN 1 AND 200),
  pickup_by text CHECK (pickup_by IS NULL OR length(btrim(pickup_by)) BETWEEN 1 AND 120),
  pickup_set_at timestamptz,
  pickup_set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((pickup_on IS NULL) = (pickup_set_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mcp_portal_check_requests_job ON public.mcp_portal_check_requests (job_id);
COMMENT ON TABLE public.mcp_portal_check_requests IS 'An owner paying a client page bill by check, and the pickup the contractor set. Written only by mcp_portal_check_request and mcp_precon_check_pickup.';
ALTER TABLE public.mcp_portal_check_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_portal_check_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_portal_check_requests TO service_role;

-- 4. The payments, in order: the agreement's own, or the old full or split billing when it has none.
CREATE OR REPLACE FUNCTION mcp_private.precon_schedule(a public.mcp_precon_agreements) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE first_cents bigint;
BEGIN
  IF jsonb_array_length(coalesce(a.payments, '[]'::jsonb)) > 0 THEN
    RETURN (SELECT jsonb_agg(jsonb_build_object('index', o, 'amount_cents', (x->>'amount_cents')::bigint, 'due', x->>'due',
        'on', x->>'on', 'when', x->>'when') ORDER BY o)
      FROM jsonb_array_elements(a.payments) WITH ORDINALITY e(x, o));
  END IF;
  IF a.billing = 'full' THEN
    RETURN jsonb_build_array(jsonb_build_object('index', 1, 'amount_cents', a.price_cents, 'due', 'signing', 'on', NULL, 'when', NULL));
  END IF;
  first_cents := (a.price_cents + 1) / 2;
  RETURN jsonb_build_array(
    jsonb_build_object('index', 1, 'amount_cents', first_cents, 'due', 'signing', 'on', NULL, 'when', NULL),
    jsonb_build_object('index', 2, 'amount_cents', a.price_cents - first_cents, 'due', 'final_drawings', 'on', NULL, 'when', NULL));
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_schedule(public.mcp_precon_agreements) FROM PUBLIC, anon, authenticated, service_role;

-- When a payment is due, as the owner reads it after the amount: "when you sign", "on December 1, 2026".
CREATE OR REPLACE FUNCTION mcp_private.precon_due_words(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p->>'due' WHEN 'signing' THEN 'when you sign'
    WHEN 'final_drawings' THEN 'when you approve the final drawings'
    WHEN 'date' THEN 'on ' || trim(to_char((p->>'on')::date, 'FMMonth FMDD, YYYY'))
    ELSE coalesce(p->>'when', 'as agreed') END
$$;
REVOKE ALL ON FUNCTION mcp_private.precon_due_words(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- What the owner sees on the client page: a strict whitelist, never the fee build-up.
CREATE OR REPLACE FUNCTION mcp_private.precon_portal_view(a public.mcp_precon_agreements, j public.mcp_jobs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'title', 'Pre-construction agreement · ' || j.name,
    'price_cents', a.price_cents,
    'design_partner', a.design_partner, 'design_role', a.design_role, 'design_days', a.design_days,
    'includes', a.includes,
    'payments', (SELECT jsonb_agg(jsonb_build_object('index', (x->>'index')::int, 'amount_cents', (x->>'amount_cents')::bigint,
        'due', x->>'due', 'on', x->>'on', 'when', x->>'when') ORDER BY (x->>'index')::int)
      FROM jsonb_array_elements(mcp_private.precon_schedule(a)) x),
    'owner_owns_drawings', a.owner_owns_drawings,
    'credit_days', CASE WHEN a.credit THEN a.credit_days END,
    'own_terms', a.own_terms,
    'construction_line', a.construction_line)
$$;
REVOKE ALL ON FUNCTION mcp_private.precon_portal_view(public.mcp_precon_agreements, public.mcp_jobs) FROM PUBLIC, anon, authenticated, service_role;

-- 5. A change to the terms after sending takes the agreement off the client page, and so does a signature that
-- came some other way (paper or email). The owner only ever signs the version they see.
CREATE OR REPLACE FUNCTION mcp_private.precon_portal_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.portal_item_id IS NOT NULL AND NEW.portal_item_id IS NOT DISTINCT FROM OLD.portal_item_id AND (
       (OLD.status = 'sent' AND NEW.status = 'signed' AND NEW.signed_decision_id IS NULL)
    OR (NEW.status IN ('draft', 'sent') AND (
         NEW.design_partner, NEW.design_role, NEW.design_days, NEW.includes, NEW.billing, NEW.owner_owns_drawings,
         NEW.credit, NEW.credit_days, NEW.price_cents, NEW.payments, NEW.own_terms, NEW.construction_line)
       IS DISTINCT FROM (
         OLD.design_partner, OLD.design_role, OLD.design_days, OLD.includes, OLD.billing, OLD.owner_owns_drawings,
         OLD.credit, OLD.credit_days, OLD.price_cents, OLD.payments, OLD.own_terms, OLD.construction_line))) THEN
    UPDATE public.mcp_portal_items SET withdrawn_at = now(), withdrawn_by = auth.uid()
     WHERE id = OLD.portal_item_id AND withdrawn_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions d WHERE d.item_id = OLD.portal_item_id);
    NEW.portal_item_id := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_portal_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS mcp_precon_portal_guard ON public.mcp_precon_agreements;
CREATE TRIGGER mcp_precon_portal_guard BEFORE UPDATE ON public.mcp_precon_agreements
  FOR EACH ROW EXECUTE FUNCTION mcp_private.precon_portal_guard();

-- 6. The agreement as members read it: as in 20261106120000, plus its payments, own terms, where it is on the
-- client page, the owner's signature record and any check pickups.
CREATE OR REPLACE FUNCTION mcp_private.precon_json(a public.mcp_precon_agreements) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE parts jsonb; invs jsonb; sched jsonb; portal jsonb; sig jsonb; checks jsonb;
BEGIN
  parts := mcp_private.precon_parts(a.design_fee_cents, a.design_markup_bps, a.hourly_rate_cents, a.time_lines);
  sched := mcp_private.precon_schedule(a);
  SELECT coalesce(jsonb_agg(mcp_private.precon_invoice_json(a.job_id, x) ORDER BY o), '[]'::jsonb) INTO invs
    FROM unnest(a.invoice_ids) WITH ORDINALITY u(x, o) WHERE mcp_private.precon_invoice_json(a.job_id, x) IS NOT NULL;
  SELECT jsonb_build_object('item_id', i.id, 'shared_at', i.shared_at, 'due_on', i.due_on, 'fingerprint', i.fingerprint,
      'decision', (SELECT jsonb_build_object('decision', d.decision, 'typed_name', d.typed_name, 'decided_at', d.decided_at, 'note', d.note)
        FROM public.mcp_portal_decisions d WHERE d.item_id = i.id))
    INTO portal FROM public.mcp_portal_items i WHERE i.id = a.portal_item_id;
  SELECT jsonb_build_object('decision_id', d.id, 'typed_name', d.typed_name, 'email', d.email, 'decided_at', d.decided_at,
      'code_verified', d.code_verified, 'ip', d.ip, 'user_agent', d.user_agent, 'consent', d.consent, 'statement', d.statement,
      'fingerprint', d.fingerprint)
    INTO sig FROM public.mcp_portal_decisions d WHERE d.id = a.signed_decision_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('invoice_id', i.ref_id, 'item_id', c.item_id, 'requested_at', c.requested_at,
      'note', c.note, 'pickup_on', c.pickup_on, 'pickup_window', c.pickup_window, 'pickup_place', c.pickup_place,
      'pickup_by', c.pickup_by) ORDER BY c.created_at), '[]'::jsonb)
    INTO checks FROM public.mcp_portal_check_requests c JOIN public.mcp_portal_items i ON i.id = c.item_id
   WHERE c.job_id = a.job_id AND i.ref_id = ANY (a.invoice_ids);
  RETURN jsonb_build_object(
    'id', a.id, 'job_id', a.job_id, 'version', a.version, 'status', a.status, 'phase', mcp_private.precon_phase(a),
    'design_partner', a.design_partner, 'design_role', a.design_role, 'design_fee_cents', a.design_fee_cents,
    'design_days', a.design_days, 'design_markup_bps', a.design_markup_bps, 'hourly_rate_cents', a.hourly_rate_cents,
    'time_lines', a.time_lines, 'includes', a.includes, 'billing', a.billing, 'owner_owns_drawings', a.owner_owns_drawings,
    'credit', a.credit, 'credit_days', a.credit_days,
    'credit_until', CASE WHEN a.credit AND a.drawings_approved_on IS NOT NULL THEN a.drawings_approved_on + a.credit_days END,
    'price_cents', a.price_cents, 'parts', parts,
    'installments', (SELECT jsonb_agg(jsonb_build_object('when', x->>'due', 'amount_cents', (x->>'amount_cents')::bigint,
        'on', x->>'on', 'step', x->>'when', 'words', mcp_private.precon_due_words(x)) ORDER BY (x->>'index')::int)
      FROM jsonb_array_elements(sched) x),
    'payments', a.payments, 'own_terms', a.own_terms, 'construction_line', a.construction_line,
    'hours_used', a.hours_used, 'sent_on', a.sent_on, 'signed_on', a.signed_on, 'signed_name', a.signed_name,
    'signed_via', a.signed_via, 'drawings_approved_on', a.drawings_approved_on, 'outcome', a.outcome, 'closed_on', a.closed_on,
    'invoices', invs,
    'credit_change', CASE WHEN a.credit_change_id IS NULL THEN NULL ELSE mcp_private.precon_change_json(a.job_id, a.credit_change_id) END,
    'contract_sov', mcp_private.precon_has_sov(a.job_id),
    'portal', portal, 'signature', sig, 'checks', checks,
    'note', a.note, 'updated_at', a.updated_at);
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_json(public.mcp_precon_agreements) FROM PUBLIC, anon, authenticated, service_role;

-- 7. Save the terms the contractor gave Athena: payments, own terms, the construction line. Draft or sent only,
-- against the version the member loaded. The payments must add up to the price. _p: {expected_version, payments,
-- own_terms, construction_line}; only the fields present change.
CREATE OR REPLACE FUNCTION public.mcp_precon_terms_save(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_precon_agreements; pays jsonb; terms jsonb; cl boolean; x jsonb; n integer := 0;
  total bigint := 0; due text; s text; d date;
BEGIN
  j := mcp_private.precon_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR octet_length(_p::text) > 20000
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('expected_version', 'payments', 'own_terms', 'construction_line')) THEN
    RAISE EXCEPTION 'MCP_BAD:Send the payments, your own terms or the construction line, and the version you loaded.';
  END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Send the version you loaded.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(j.id::text || ':precon'));
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE job_id = j.id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This job has no pre-construction agreement. Start one first.'; END IF;
  IF (_p->>'expected_version')::integer <> a.version THEN
    RAISE EXCEPTION 'MCP_BAD:The agreement changed since you loaded it (now version %). Load it again.', a.version;
  END IF;
  IF a.status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'MCP_BAD:The agreement is signed, so its terms are fixed. Agree any change with the owner first.';
  END IF;
  pays := a.payments; terms := a.own_terms; cl := a.construction_line;
  IF _p ? 'payments' THEN
    IF jsonb_typeof(_p->'payments') <> 'array' OR jsonb_array_length(_p->'payments') > 12 THEN
      RAISE EXCEPTION 'MCP_BAD:List the owner''s payments, up to 12.';
    END IF;
    pays := '[]'::jsonb;
    FOR x IN SELECT value FROM jsonb_array_elements(_p->'payments') LOOP
      n := n + 1;
      IF jsonb_typeof(x) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('amount_cents', 'due', 'on', 'when'))
         OR jsonb_typeof(x->'amount_cents') <> 'number' OR (x->>'amount_cents')::numeric <> trunc((x->>'amount_cents')::numeric)
         OR (x->>'amount_cents')::numeric NOT BETWEEN 1 AND 200000000000 THEN
        RAISE EXCEPTION 'MCP_BAD:Payment % needs an amount in whole cents.', n;
      END IF;
      due := x->>'due';
      IF due IS NULL OR due NOT IN ('signing', 'final_drawings', 'date', 'step') THEN
        RAISE EXCEPTION 'MCP_BAD:Payment % is due when the owner signs (signing), approves the final drawings (final_drawings), on a date (date), or at a step you name (step).', n;
      END IF;
      d := NULL; s := NULL;
      IF due = 'date' THEN
        BEGIN
          d := (x->>'on')::date;
        EXCEPTION WHEN others THEN RAISE EXCEPTION 'MCP_BAD:Write payment %''s date as YYYY-MM-DD.', n;
        END;
        IF d IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Payment % needs its date.', n; END IF;
      ELSIF x ? 'on' AND x->'on' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'MCP_BAD:Only a payment due on a date takes a date (payment %).', n;
      END IF;
      IF due = 'step' THEN
        s := btrim(coalesce(x->>'when', ''));
        IF length(s) NOT BETWEEN 3 AND 120 OR s !~* '^(when|after|once|at|before) ' THEN
          RAISE EXCEPTION 'MCP_BAD:Say when payment % is due in a few words the owner reads after the amount, like "when you approve the schematic design".', n;
        END IF;
        s := lower(left(s, 1)) || substr(s, 2);
        s := regexp_replace(s, '[.;,]+$', '');
      ELSIF x ? 'when' AND x->'when' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'MCP_BAD:Only a payment due at a step you name takes words for when (payment %).', n;
      END IF;
      total := total + (x->>'amount_cents')::bigint;
      pays := pays || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('amount_cents', (x->>'amount_cents')::bigint,
        'due', due, 'on', d, 'when', s)));
    END LOOP;
    IF n > 0 AND total <> a.price_cents THEN
      RAISE EXCEPTION 'MCP_BAD:The payments add up to %, and the agreement price is %. Make them match.',
        to_char(total / 100.0, 'FM$999,999,999,990.00'), to_char(a.price_cents / 100.0, 'FM$999,999,999,990.00');
    END IF;
  END IF;
  IF _p ? 'own_terms' THEN
    IF jsonb_typeof(_p->'own_terms') <> 'array' OR jsonb_array_length(_p->'own_terms') > 10
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(_p->'own_terms') t WHERE jsonb_typeof(t) <> 'string' OR length(btrim(t #>> '{}')) NOT BETWEEN 1 AND 600) THEN
      RAISE EXCEPTION 'MCP_BAD:List your own terms as up to 10 sentences, each up to 600 characters.';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(btrim(t #>> '{}')) ORDER BY o), '[]'::jsonb) INTO terms
      FROM jsonb_array_elements(_p->'own_terms') WITH ORDINALITY e(t, o);
  END IF;
  IF _p ? 'construction_line' THEN
    IF jsonb_typeof(_p->'construction_line') <> 'boolean' THEN RAISE EXCEPTION 'MCP_BAD:Say whether to show the construction line.'; END IF;
    cl := (_p->>'construction_line')::boolean;
  END IF;
  UPDATE public.mcp_precon_agreements SET payments = pays, own_terms = terms, construction_line = cl,
    version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = a.id RETURNING * INTO a;
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'agreement', mcp_private.precon_json(a), 'portal_customers', mcp_private.service_recipients(j.id));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_terms_save(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_terms_save(uuid, jsonb) TO authenticated;

-- 8. Put the agreement on the owner's client page to sign. Full job access (the client page needs it). Withdraws an
-- earlier version, marks the agreement sent. _p: {expected_version, due_on (sign by)}.
CREATE OR REPLACE FUNCTION public.mcp_precon_portal_send(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_precon_agreements; due date; today date; v jsonb; it public.mcp_portal_items; total bigint;
BEGIN
  j := mcp_private.portal_full_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('expected_version', 'due_on')) THEN
    RAISE EXCEPTION 'MCP_BAD:Send the version you loaded and, if you like, a sign-by date.';
  END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Send the version you loaded.'; END IF;
  today := (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date;
  BEGIN
    due := nullif(_p->>'due_on', '')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'MCP_BAD:Write the sign-by date as YYYY-MM-DD.';
  END;
  IF due IS NOT NULL AND (due < today OR due > today + 366) THEN RAISE EXCEPTION 'MCP_BAD:Use a sign-by date from today to a year out.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(j.id::text || ':precon'));
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE job_id = j.id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This job has no pre-construction agreement.'; END IF;
  IF (_p->>'expected_version')::integer <> a.version THEN
    RAISE EXCEPTION 'MCP_BAD:The agreement changed since you loaded it (now version %). Load it again.', a.version;
  END IF;
  IF a.status NOT IN ('draft', 'sent') THEN RAISE EXCEPTION 'MCP_BAD:The agreement is already signed. Nothing was sent.'; END IF;
  IF a.price_cents <= 0 THEN RAISE EXCEPTION 'MCP_BAD:Price the agreement before sending it. Nothing was sent.'; END IF;
  SELECT coalesce(sum((x->>'amount_cents')::bigint), 0) INTO total FROM jsonb_array_elements(mcp_private.precon_schedule(a)) x;
  IF total <> a.price_cents THEN
    RAISE EXCEPTION 'MCP_BAD:The payments add up to %, and the agreement price is %. Fix the payments first. Nothing was sent.',
      to_char(total / 100.0, 'FM$999,999,999,990.00'), to_char(a.price_cents / 100.0, 'FM$999,999,999,990.00');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_portal_access WHERE job_id = j.id AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:Nobody has a client page on this job yet. Invite the owner first. Nothing was sent.';
  END IF;
  IF a.portal_item_id IS NOT NULL THEN
    UPDATE public.mcp_portal_items SET withdrawn_at = now(), withdrawn_by = auth.uid()
     WHERE id = a.portal_item_id AND withdrawn_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.mcp_portal_decisions d WHERE d.item_id = a.portal_item_id);
  END IF;
  v := mcp_private.precon_portal_view(a, j);
  INSERT INTO public.mcp_portal_items (company_id, job_id, kind, ref_id, ref_version, view, fingerprint, due_on, shared_by)
  VALUES (j.company_id, j.id, 'precon_agreement', a.id, a.version + 1, v, mcp_private.portal_fingerprint(v), due, auth.uid())
  RETURNING * INTO it;
  UPDATE public.mcp_precon_agreements SET status = 'sent', sent_on = coalesce(sent_on, today), portal_item_id = it.id,
    version = version + 1, updated_by = auth.uid(), updated_at = now() WHERE id = a.id RETURNING * INTO a;
  PERFORM public.mcp_project_record_add(j.id, 'precon_portal_send', 'Pre-construction agreement sent to the client page',
    'Agreement for ' || to_char(a.price_cents / 100.0, 'FM$999,999,999,990.00') || ' sent to the owner''s client page to sign'
      || CASE WHEN due IS NOT NULL THEN ', sign by ' || to_char(due, 'FMMonth FMDD, YYYY') ELSE '' END || '.',
    NULL, NULL, 'mcp_precon_agreements', a.id, jsonb_build_object('portal_item', it.id, 'fingerprint', it.fingerprint, 'version', a.version), 'user', NULL, NULL);
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'item_id', it.id, 'label', v->>'title', 'due_on', due, 'fingerprint', it.fingerprint,
    'recipients', mcp_private.service_recipients(j.id), 'agreement', mcp_private.precon_json(a));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_portal_send(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_portal_send(uuid, jsonb) TO authenticated;

-- 9. Bill the next payment: books PC-<job>-<n> and puts it on the client page as a bill (portal kind
-- service_invoice). Used by mcp_precon_invoice_share and by the owner's signature (payment 1 due at signing).
CREATE OR REPLACE FUNCTION mcp_private.precon_bill_next(_a public.mcp_precon_agreements, j public.mcp_jobs, _due date)
RETURNS public.mcp_portal_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_precon_agreements := _a; sched jsonb; issued integer; total integer; idx integer; pay jsonb; amt bigint;
  num text; v jsonb; it public.mcp_portal_items; inc text; money text; parts_text text; words text; plan text;
BEGIN
  IF a.status NOT IN ('signed', 'closed') THEN RAISE EXCEPTION 'MCP_BAD:The owner hasn''t signed the agreement yet. Nothing was billed.'; END IF;
  IF a.price_cents <= 0 THEN RAISE EXCEPTION 'MCP_BAD:Price the agreement first. Nothing was billed.'; END IF;
  sched := mcp_private.precon_schedule(a);
  total := jsonb_array_length(sched);
  SELECT count(*) INTO issued FROM unnest(a.invoice_ids) x
    WHERE (SELECT v2.status FROM public.mcp_billing_invoice_versions v2 WHERE v2.invoice_id = x ORDER BY v2.version DESC LIMIT 1) IS DISTINCT FROM 'void';
  IF issued >= total THEN RAISE EXCEPTION 'MCP_BAD:Every payment is already billed. Nothing was billed.'; END IF;
  idx := issued + 1;
  pay := sched->(idx - 1);
  amt := (pay->>'amount_cents')::bigint;
  words := mcp_private.precon_due_words(pay);
  IF pay->>'due' = 'final_drawings' AND a.drawings_approved_on IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:Payment % is due when the owner approves the final drawings, and they aren''t approved yet. Nothing was billed.', idx;
  END IF;
  num := 'PC-' || j.job_number || '-' || idx;
  WHILE EXISTS (SELECT 1 FROM public.mcp_billing_invoices WHERE job_id = j.id AND lower(document_number) = lower(num)) LOOP
    num := num || 'R';
    IF length(num) > 60 THEN RAISE EXCEPTION 'MCP_BAD:Too many invoices with that number on this job.'; END IF;
  END LOOP;
  money := regexp_replace(to_char(a.price_cents / 100.0, 'FM$999,999,999,990.00'), '\.00$', '');
  SELECT nullif(string_agg(x, ' · ' ORDER BY o), '') INTO inc FROM jsonb_array_elements_text(a.includes) WITH ORDINALITY e(x, o);
  parts_text := CASE WHEN total = 1 THEN 'Pre-construction agreement'
    ELSE 'Pre-construction agreement, payment ' || idx || ' of ' || total || ' (' || words || ')' END;
  plan := CASE WHEN total = 1 THEN 'paid ' || words || '.'
    ELSE 'paid in ' || total || ' payments. This is payment ' || idx || ', due ' || words || '.' END;
  v := jsonb_build_object('number', num, 'stage', 'bill',
    'title', CASE WHEN total = 1 THEN 'Pre-construction · ' || j.name ELSE 'Pre-construction payment ' || idx || ' of ' || total || ' · ' || j.name END,
    'work_order', 'Pre-construction agreement',
    'site_address', NULL,
    'issue', left('Design and pre-construction for ' || j.name
      || CASE WHEN a.design_days IS NOT NULL THEN ', with about ' || a.design_days || ' days of design' ELSE '' END
      || '. The agreement totals ' || money || ', ' || plan, 2000),
    'lines', jsonb_build_array(jsonb_build_object('description', parts_text, 'detail', inc, 'amount_cents', amt)),
    'signoff', NULL,
    'totals', jsonb_build_object('subtotal_cents', amt, 'credit_cents', 0, 'current_due_cents', amt),
    'note', CASE WHEN a.owner_owns_drawings THEN 'You own the drawings.' ELSE '' END
      || CASE WHEN a.credit THEN CASE WHEN a.owner_owns_drawings THEN ' ' ELSE '' END || 'If you hire us to build within '
        || a.credit_days || ' days of the final drawings, the full ' || money || ' is credited to the construction contract.' ELSE '' END);
  IF v->>'note' = '' THEN v := jsonb_set(v, '{note}', 'null'::jsonb); END IF;
  it := mcp_private.service_invoice_share(j, num, 'Pre-construction agreement, payment ' || idx || ' of ' || total, amt, amt, v, _due);
  UPDATE public.mcp_precon_agreements SET invoice_ids = invoice_ids || it.ref_id, version = version + 1, updated_by = auth.uid(),
    updated_at = now() WHERE id = a.id;
  PERFORM public.mcp_project_record_add(j.id, 'precon_invoice_share', 'Pre-construction invoice ' || num,
    'Invoice ' || num || ' for ' || to_char(amt / 100.0, 'FM$999,999,999,990.00') || ' sent to the client page.',
    NULL, NULL, 'mcp_billing_invoices', it.ref_id, jsonb_build_object('amount_cents', amt, 'portal_item', it.id, 'payment', idx), 'user', NULL, NULL);
  RETURN it;
END $$;
REVOKE ALL ON FUNCTION mcp_private.precon_bill_next(public.mcp_precon_agreements, public.mcp_jobs, date) FROM PUBLIC, anon, authenticated, service_role;

-- As in 20261106120000, billing by the agreement's own payments. _p: {expected_version, due_on}.
CREATE OR REPLACE FUNCTION public.mcp_precon_invoice_share(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; a public.mcp_precon_agreements; due date; it public.mcp_portal_items;
BEGIN
  j := mcp_private.precon_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('expected_version', 'due_on')) THEN
    RAISE EXCEPTION 'MCP_BAD:That invoice has details Athena doesn''t use.';
  END IF;
  IF jsonb_typeof(_p->'expected_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Send the version you loaded.'; END IF;
  BEGIN
    due := nullif(_p->>'due_on', '')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'MCP_BAD:Write the due date as YYYY-MM-DD.';
  END;
  PERFORM pg_advisory_xact_lock(hashtext(j.id::text || ':precon'));
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE job_id = j.id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:This job has no pre-construction agreement.'; END IF;
  IF (_p->>'expected_version')::integer <> a.version THEN
    RAISE EXCEPTION 'MCP_BAD:The agreement changed since you loaded it (now version %). Load it again.', a.version;
  END IF;
  it := mcp_private.precon_bill_next(a, j, due);
  SELECT * INTO a FROM public.mcp_precon_agreements WHERE id = a.id;
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'item_id', it.id, 'invoice_id', it.ref_id, 'number', it.view->>'number', 'label', it.view->>'title',
    'amount_cents', (it.view->'totals'->>'current_due_cents')::bigint, 'due_on', it.due_on,
    'recipients', mcp_private.service_recipients(j.id), 'agreement', mcp_private.precon_json(a));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_invoice_share(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_invoice_share(uuid, jsonb) TO authenticated;

-- 10. The owner signs or declines on the client page (server only). Signing: their consent to do business
-- electronically, a fresh emailed code, their typed name and the statement. The decision, the agreement and the
-- project record move together; payment 1 goes on their page when it's due at signing (a billing hiccup never
-- undoes the signature: it's logged and the contractor bills it from Athena).
CREATE OR REPLACE FUNCTION public.mcp_portal_precon_sign(_access uuid, _session_hash text, _item uuid, _decision text,
  _code_hash text, _typed_name text, _consent text, _statement text, _fingerprint text, _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; chk text := 'not_needed'; did uuid; j public.mcp_jobs;
  ag public.mcp_precon_agreements; stamp timestamptz := now(); today date; bill public.mcp_portal_items; first jsonb;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL FOR UPDATE;
  IF it.id IS NULL OR it.kind <> 'precon_agreement' OR EXISTS (SELECT 1 FROM public.mcp_portal_decisions x WHERE x.item_id = it.id) THEN
    RETURN jsonb_build_object('status', 'not_open');
  END IF;
  IF _fingerprint IS DISTINCT FROM it.fingerprint THEN RETURN jsonb_build_object('status', 'changed'); END IF;
  IF _decision IS NULL OR _decision NOT IN ('signed', 'declined')
     OR length(btrim(coalesce(_typed_name, ''))) NOT BETWEEN 2 AND 120 OR length(btrim(coalesce(_statement, ''))) NOT BETWEEN 1 AND 1000
     OR length(coalesce(_note, '')) > 2000
     OR (_decision = 'signed' AND length(btrim(coalesce(_consent, ''))) NOT BETWEEN 1 AND 1500) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO ag FROM public.mcp_precon_agreements WHERE id = it.ref_id AND job_id = a.job_id FOR UPDATE;
  IF ag.id IS NULL OR ag.portal_item_id IS DISTINCT FROM it.id OR ag.status <> 'sent' THEN RETURN jsonb_build_object('status', 'changed'); END IF;
  IF _decision = 'signed' THEN
    chk := mcp_private.portal_code_check(a.id, 'decide', it.id, _code_hash);
    IF chk <> 'ok' THEN RETURN jsonb_build_object('status', chk); END IF;
  END IF;
  today := (stamp AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date;
  INSERT INTO public.mcp_portal_decisions (item_id, access_id, decision, choice, typed_name, statement, consent, fingerprint, note, email,
    code_verified, ip, user_agent, decided_at)
  VALUES (it.id, a.id, _decision, NULL, btrim(_typed_name), btrim(_statement), CASE WHEN _decision = 'signed' THEN btrim(_consent) END,
    it.fingerprint, nullif(btrim(coalesce(_note, '')), ''), a.email, chk = 'ok', left(_ip, 100), left(_user_agent, 400), stamp)
  RETURNING id INTO did;
  IF _decision = 'signed' THEN
    UPDATE public.mcp_precon_agreements SET status = 'signed', signed_on = today, signed_name = left(btrim(_typed_name), 200),
      signed_via = 'client_page', signed_decision_id = did, sent_on = coalesce(sent_on, today),
      version = version + 1, updated_by = a.created_by, updated_at = stamp
     WHERE id = ag.id RETURNING * INTO ag;
    PERFORM public.mcp_project_record_add(j.id, 'precon_signed', 'Pre-construction agreement signed on the client page',
      btrim(_typed_name) || ' <' || a.email || '> signed the ' || to_char(ag.price_cents / 100.0, 'FM$999,999,999,990.00')
        || ' pre-construction agreement on the client page, confirmed with a code emailed to them.',
      btrim(_typed_name), a.email, 'mcp_portal_decisions', did,
      jsonb_build_object('decision_id', did, 'typed_name', btrim(_typed_name), 'email', a.email, 'signed_at', stamp,
        'code_verified', chk = 'ok', 'ip', left(_ip, 100), 'user_agent', left(_user_agent, 400), 'consent', btrim(_consent),
        'statement', btrim(_statement), 'fingerprint', it.fingerprint, 'view', it.view, 'portal_item', it.id), 'user', NULL, NULL);
    first := mcp_private.precon_schedule(ag)->0;
    IF first->>'due' = 'signing' AND cardinality(ag.invoice_ids) = 0 THEN
      BEGIN
        bill := mcp_private.precon_bill_next(ag, j, NULL);
      EXCEPTION WHEN OTHERS THEN
        bill := NULL;
        INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
        VALUES (a.id, a.job_id, 'precon_bill_failed', jsonb_build_object('item', it.id, 'reason', left(SQLERRM, 200)), left(_ip, 100), left(_user_agent, 400));
      END;
    END IF;
  ELSE
    PERFORM public.mcp_project_record_add(j.id, 'precon_declined', 'Pre-construction agreement declined on the client page',
      btrim(_typed_name) || ' <' || a.email || '> declined the pre-construction agreement on the client page.'
        || CASE WHEN nullif(btrim(coalesce(_note, '')), '') IS NOT NULL THEN ' Their note: ' || left(btrim(_note), 1500) ELSE '' END,
      btrim(_typed_name), a.email, 'mcp_portal_decisions', did,
      jsonb_build_object('decision_id', did, 'fingerprint', it.fingerprint, 'portal_item', it.id), 'user', NULL, NULL);
  END IF;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'decided', jsonb_build_object('item', it.id, 'decision', _decision, 'decision_id', did), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'decision_id', did, 'decided_at', stamp, 'customer', a.name, 'customer_email', a.email,
    'job_id', j.id, 'job_name', j.name, 'job_number', j.job_number, 'pm_email', j.pm_email, 'pm_name', j.pm_name,
    'label', it.view->>'title', 'signed_on', CASE WHEN _decision = 'signed' THEN today END,
    'bill', CASE WHEN bill.id IS NULL THEN NULL ELSE jsonb_build_object('item_id', bill.id, 'number', bill.view->>'number',
      'amount_cents', (bill.view->'totals'->>'current_due_cents')::bigint) END);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_precon_sign(uuid, text, uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_precon_sign(uuid, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;

-- Is this client page bill one of a pre-con agreement's? Only those offer Pay by check for now.
CREATE OR REPLACE FUNCTION mcp_private.portal_check_ok(_item public.mcp_portal_items) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _item.kind = 'service_invoice'
    AND EXISTS (SELECT 1 FROM public.mcp_precon_agreements p WHERE p.job_id = _item.job_id AND _item.ref_id = ANY (p.invoice_ids))
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_check_ok(public.mcp_portal_items) FROM PUBLIC, anon, authenticated, service_role;

-- 11. The owner says they're paying a pre-con bill by check (server only). Tells the contractor through the job
-- notice the page server records; asking again only updates the note.
CREATE OR REPLACE FUNCTION public.mcp_portal_check_request(_access uuid, _session_hash text, _item uuid, _note text, _ip text, _user_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.mcp_portal_access; st text; it public.mcp_portal_items; j public.mcp_jobs; r public.mcp_portal_check_requests; again boolean;
BEGIN
  SELECT * INTO a FROM public.mcp_portal_access WHERE id = _access;
  IF a.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF (mcp_private.portal_session(a.id, _session_hash)).id IS NULL THEN RETURN jsonb_build_object('status', 'signed_out'); END IF;
  st := mcp_private.portal_state(a);
  IF st <> 'ok' THEN RETURN jsonb_build_object('status', st); END IF;
  IF length(coalesce(_note, '')) > 1000 THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND job_id = a.job_id AND withdrawn_at IS NULL;
  IF it.id IS NULL OR NOT mcp_private.portal_check_ok(it) OR NOT mcp_private.service_invoice_open(it.job_id, it.ref_id, it.ref_version) THEN
    RETURN jsonb_build_object('status', 'not_open');
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = a.job_id;
  SELECT * INTO r FROM public.mcp_portal_check_requests WHERE item_id = it.id FOR UPDATE;
  again := r.id IS NOT NULL AND r.requested_at IS NOT NULL;
  IF r.id IS NULL THEN
    INSERT INTO public.mcp_portal_check_requests (item_id, job_id, company_id, access_id, note, requested_at)
    VALUES (it.id, it.job_id, it.company_id, a.id, nullif(btrim(coalesce(_note, '')), ''), now()) RETURNING * INTO r;
  ELSE
    UPDATE public.mcp_portal_check_requests SET note = coalesce(nullif(btrim(coalesce(_note, '')), ''), note),
      requested_at = coalesce(requested_at, now()), access_id = a.id WHERE id = r.id RETURNING * INTO r;
  END IF;
  PERFORM public.mcp_project_record_add(j.id, 'precon_check_request', 'Owner paying ' || (it.view->>'number') || ' by check',
    a.name || ' <' || a.email || '> said on the client page they''re paying invoice ' || (it.view->>'number') || ', '
      || to_char((it.view->'totals'->>'current_due_cents')::bigint / 100.0, 'FM$999,999,999,990.00') || ', by check.'
      || CASE WHEN r.note IS NOT NULL THEN ' Their note: ' || r.note ELSE '' END,
    a.name, a.email, 'mcp_portal_check_requests', r.id, jsonb_build_object('portal_item', it.id, 'invoice_id', it.ref_id), 'user', NULL, NULL);
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail, ip, user_agent)
  VALUES (a.id, a.job_id, 'check_request', jsonb_build_object('item', it.id, 'request', r.id), left(_ip, 100), left(_user_agent, 400));
  RETURN jsonb_build_object('status', 'ok', 'request_id', r.id, 'again', again, 'job_id', j.id, 'job_number', j.job_number,
    'job_name', j.name, 'customer', a.name, 'customer_email', a.email, 'pm_email', j.pm_email, 'number', it.view->>'number',
    'label', it.view->>'title', 'amount_cents', (it.view->'totals'->>'current_due_cents')::bigint, 'note', r.note);
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_check_request(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_check_request(uuid, text, uuid, text, text, text) TO service_role;

-- 12. The contractor sets when they'll collect the check, against a pre-con bill on the client page (whether or not
-- the owner asked first). _p: {invoice_id, on, window, place, by}.
CREATE OR REPLACE FUNCTION public.mcp_precon_check_pickup(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; ag public.mcp_precon_agreements; it public.mcp_portal_items; r public.mcp_portal_check_requests;
  d date; today date; win text; place text; who text; inv uuid;
BEGIN
  j := mcp_private.precon_job(_job);
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_p) k WHERE k NOT IN ('invoice_id', 'on', 'window', 'place', 'by')) THEN
    RAISE EXCEPTION 'MCP_BAD:Send the invoice, the pickup date and, if you like, the time, place and who collects it.';
  END IF;
  today := (now() AT TIME ZONE coalesce(nullif(j.time_zone, ''), 'America/Chicago'))::date;
  BEGIN
    inv := (_p->>'invoice_id')::uuid;
    d := (_p->>'on')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'MCP_BAD:Send the invoice ID and the pickup date as YYYY-MM-DD.';
  END;
  IF inv IS NULL OR d IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Send the invoice and the pickup date.'; END IF;
  IF d < today OR d > today + 366 THEN RAISE EXCEPTION 'MCP_BAD:Pick a pickup date from today to a year out.'; END IF;
  win := nullif(btrim(coalesce(_p->>'window', '')), '');
  place := nullif(btrim(coalesce(_p->>'place', '')), '');
  who := nullif(btrim(coalesce(_p->>'by', '')), '');
  IF length(win) > 60 OR length(place) > 200 OR length(who) > 120 THEN
    RAISE EXCEPTION 'MCP_BAD:Keep the time to 60 characters, the place to 200 and the name to 120.';
  END IF;
  SELECT * INTO ag FROM public.mcp_precon_agreements WHERE job_id = j.id;
  IF ag.id IS NULL OR NOT (inv = ANY (ag.invoice_ids)) THEN RAISE EXCEPTION 'MCP_BAD:That invoice isn''t one of this job''s pre-construction invoices.'; END IF;
  SELECT * INTO it FROM public.mcp_portal_items WHERE job_id = j.id AND kind = 'service_invoice' AND ref_id = inv AND withdrawn_at IS NULL
   ORDER BY shared_at DESC LIMIT 1;
  IF it.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That invoice isn''t on the client page.'; END IF;
  IF NOT mcp_private.service_invoice_open(it.job_id, it.ref_id, it.ref_version) THEN
    RAISE EXCEPTION 'MCP_BAD:That invoice is paid or closed, so there''s no check to collect.';
  END IF;
  INSERT INTO public.mcp_portal_check_requests (item_id, job_id, company_id, pickup_on, pickup_window, pickup_place, pickup_by, pickup_set_at, pickup_set_by)
  VALUES (it.id, j.id, j.company_id, d, win, place, who, now(), auth.uid())
  ON CONFLICT (item_id) DO UPDATE SET pickup_on = EXCLUDED.pickup_on, pickup_window = EXCLUDED.pickup_window,
    pickup_place = EXCLUDED.pickup_place, pickup_by = EXCLUDED.pickup_by, pickup_set_at = EXCLUDED.pickup_set_at,
    pickup_set_by = EXCLUDED.pickup_set_by
  RETURNING * INTO r;
  PERFORM public.mcp_project_record_add(j.id, 'precon_check_pickup', 'Check pickup set for ' || (it.view->>'number'),
    'Check for invoice ' || (it.view->>'number') || ' to be collected on ' || to_char(d, 'FMDay, FMMonth FMDD, YYYY')
      || coalesce(', ' || win, '') || coalesce(', at ' || place, '') || coalesce(', by ' || who, '') || '.',
    NULL, NULL, 'mcp_portal_check_requests', r.id, jsonb_build_object('portal_item', it.id, 'invoice_id', inv), 'user', NULL, NULL);
  RETURN jsonb_build_object('status', 'ok', 'job_id', j.id, 'job_number', j.job_number, 'job_name', j.name,
    'number', it.view->>'number', 'label', it.view->>'title', 'amount_cents', (it.view->'totals'->>'current_due_cents')::bigint,
    'pickup_on', r.pickup_on, 'pickup_window', r.pickup_window, 'pickup_place', r.pickup_place, 'pickup_by', r.pickup_by,
    'recipients', mcp_private.service_recipients(j.id), 'agreement', mcp_private.precon_json(ag));
END $$;
REVOKE ALL ON FUNCTION public.mcp_precon_check_pickup(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_precon_check_pickup(uuid, jsonb) TO authenticated;

-- 13. Labels and the page: as in 20261106110000, plus the pre-con agreement while it is the one on the client page
-- and still waiting to be signed (or once decided), and the bills that take a check with any pickup set.
CREATE OR REPLACE FUNCTION mcp_private.portal_item_label(_item uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN i.kind = 'change_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind = 'pay_app' THEN mcp_private.portal_pay_app_label(i.view->>'number')
    WHEN i.kind = 'work_order' THEN (i.view->>'number') || ' · ' || (i.view->>'title')
    WHEN i.kind IN ('service_invoice', 'precon_agreement') THEN i.view->>'title' ELSE i.view->'proposal'->>'title' END
    FROM public.mcp_portal_items i WHERE i.id = _item
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_item_label(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
          OR (i.kind = 'service_invoice' AND mcp_private.service_invoice_open(i.job_id, i.ref_id, i.ref_version))
          OR (i.kind = 'precon_agreement' AND EXISTS (SELECT 1 FROM public.mcp_precon_agreements p WHERE p.id = i.ref_id
                AND p.job_id = i.job_id AND p.portal_item_id = i.id AND p.status = 'sent')))), '[]'::jsonb),
    'check_items', coalesce((SELECT jsonb_agg(i.id) FROM public.mcp_portal_items i
        WHERE i.job_id = a.job_id AND i.withdrawn_at IS NULL AND mcp_private.portal_check_ok(i)), '[]'::jsonb),
    'checks', coalesce((SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'requested_at', c.requested_at, 'note', c.note,
          'pickup_on', c.pickup_on, 'pickup_window', c.pickup_window, 'pickup_place', c.pickup_place, 'pickup_by', c.pickup_by))
        FROM public.mcp_portal_check_requests c JOIN public.mcp_portal_items i ON i.id = c.item_id
       WHERE c.job_id = a.job_id AND i.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_view(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_view(uuid, text, text, text) TO service_role;
