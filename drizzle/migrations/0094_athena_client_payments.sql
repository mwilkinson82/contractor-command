-- Client payments: a contractor's customer pays an approved pay application from the client page, by card or bank,
-- through Stripe Connect. The contractor's own Stripe account (connected to Athena's platform account) is the
-- merchant of record: each payment is a direct charge on it, Athena's fee is the application fee, and the money
-- never sits with Athena. Stripe ids live here; card and bank details never reach Athena.
--
-- Only the app server writes payments, from Stripe events it re-reads from Stripe itself. A paid payment is booked
-- as a billing receipt on the job and applied to the pay application when its billing record can take it; a refund
-- reverses that. Connecting and settings are the company owner's.
--
-- Wire and check payments arrive outside Athena. A member with full job access records them on a submitted or
-- certified pay application; each is booked the same way (receipt, applied to the pay application) with no Athena
-- fee, and the client page counts it. No bank or wire details are stored or shown.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS mcp_private;

-- One row per company: its connected Stripe account per mode and which payment methods its customers may use.
CREATE TABLE IF NOT EXISTS public.mcp_company_payments (
  company_id uuid PRIMARY KEY REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  account_test text CHECK (account_test ~ '^acct_[A-Za-z0-9]{6,64}$'),
  account_live text CHECK (account_live ~ '^acct_[A-Za-z0-9]{6,64}$'),
  status_test text NOT NULL DEFAULT 'not_connected' CHECK (status_test IN ('not_connected', 'action_required', 'under_review', 'restricted', 'ready')),
  status_live text NOT NULL DEFAULT 'not_connected' CHECK (status_live IN ('not_connected', 'action_required', 'under_review', 'restricted', 'ready')),
  card_enabled boolean NOT NULL DEFAULT true,
  bank_enabled boolean NOT NULL DEFAULT true,
  card_max_cents bigint NOT NULL DEFAULT 2500000 CHECK (card_max_cents BETWEEN 100 AND 100000000),
  connected_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (mode = 'test' OR (account_live IS NOT NULL AND status_live = 'ready'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_company_payments_account_test ON public.mcp_company_payments (account_test) WHERE account_test IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_company_payments_account_live ON public.mcp_company_payments (account_live) WHERE account_live IS NOT NULL;

-- One row per Stripe Checkout session a customer opened for a pay application.
CREATE TABLE IF NOT EXISTS public.mcp_portal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.mcp_portal_items(id) ON DELETE CASCADE,
  access_id uuid NOT NULL REFERENCES public.mcp_portal_access(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  checkout_session_id text NOT NULL UNIQUE CHECK (checkout_session_id ~ '^cs_[A-Za-z0-9_]{6,200}$'),
  payment_intent_id text UNIQUE CHECK (payment_intent_id ~ '^pi_[A-Za-z0-9_]{6,200}$'),
  charge_id text CHECK (charge_id ~ '^(ch|py)_[A-Za-z0-9_]{6,200}$'),
  method text CHECK (method IN ('card', 'us_bank_account')),
  methods text[] NOT NULL CHECK (methods <@ ARRAY['card', 'us_bank_account']::text[] AND cardinality(methods) BETWEEN 1 AND 2),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0 AND fee_cents < amount_cents),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded')),
  refunded_cents bigint NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  receipt_id uuid REFERENCES public.mcp_billing_receipts(id),
  allocation_id uuid REFERENCES public.mcp_billing_allocations(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('paid', 'refunded', 'partially_refunded') OR (paid_at IS NOT NULL AND payment_intent_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mcp_portal_payments_item ON public.mcp_portal_payments (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_portal_payments_job ON public.mcp_portal_payments (job_id, created_at DESC);
-- At most one live (open, processing or paid) payment per shared pay application.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_portal_payments_one_active ON public.mcp_portal_payments (item_id)
  WHERE status IN ('open', 'processing', 'paid', 'partially_refunded');

-- Stripe events already handled, so a retried delivery books nothing twice.
CREATE TABLE IF NOT EXISTS public.mcp_stripe_connect_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9_]{6,200}$'),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  livemode boolean NOT NULL,
  account_id text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Wire and check payments recorded by the contractor's team on a pay application. Reference is the wire reference
-- or check number as the team typed it. A mistake is voided, which reverses its booking; nothing is deleted.
CREATE TABLE IF NOT EXISTS public.mcp_recorded_payments (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.mcp_billing_invoices(id),
  method text NOT NULL CHECK (method IN ('wire', 'check')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 9000000000000),
  received_on date NOT NULL,
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 80),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  receipt_id uuid NOT NULL REFERENCES public.mcp_billing_receipts(id),
  allocation_id uuid NOT NULL REFERENCES public.mcp_billing_allocations(id),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text CHECK (void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 1 AND 500),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS mcp_recorded_payments_invoice ON public.mcp_recorded_payments (invoice_id, received_on DESC);
-- The same wire or check can't be recorded twice on a job.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_recorded_payments_reference
  ON public.mcp_recorded_payments (job_id, method, lower(btrim(reference))) WHERE voided_at IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_company_payments','mcp_portal_payments','mcp_stripe_connect_events','mcp_recorded_payments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------- helpers ----------

CREATE OR REPLACE FUNCTION mcp_private.client_payments_json(p public.mcp_company_payments, _can_manage boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('can_manage', _can_manage,
    'mode', coalesce(p.mode, 'test'),
    'test', jsonb_build_object('connected', p.account_test IS NOT NULL, 'status', coalesce(p.status_test, 'not_connected')),
    'live', jsonb_build_object('connected', p.account_live IS NOT NULL, 'status', coalesce(p.status_live, 'not_connected')),
    'ready', coalesce(CASE WHEN p.mode = 'live' THEN p.status_live = 'ready' ELSE p.status_test = 'ready' END, false),
    'card_enabled', coalesce(p.card_enabled, true), 'bank_enabled', coalesce(p.bank_enabled, true),
    'card_max_cents', coalesce(p.card_max_cents, 2500000))
$$;
REVOKE ALL ON FUNCTION mcp_private.client_payments_json(public.mcp_company_payments, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- What the customer has paid on one shared item, as the page shows it.
CREATE OR REPLACE FUNCTION mcp_private.portal_payment_json(p public.mcp_portal_payments) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('item_id', p.item_id, 'status', p.status, 'method', p.method, 'amount_cents', p.amount_cents,
    'refunded_cents', p.refunded_cents, 'paid_at', p.paid_at, 'test', p.mode = 'test', 'updated_at', p.updated_at)
$$;
REVOKE ALL ON FUNCTION mcp_private.portal_payment_json(public.mcp_portal_payments) FROM PUBLIC, anon, authenticated, service_role;

-- Whether the signed-in user owns the company. Money settings are the owner's.
CREATE OR REPLACE FUNCTION mcp_private.client_payments_owner(_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.mcp_company_members
    WHERE company_id = _company AND user_id = auth.uid() AND role = 'owner')
$$;
REVOKE ALL ON FUNCTION mcp_private.client_payments_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------- members ----------

-- The company's client payment setup. Any member reads it; only an owner may change it. Stripe account ids stay
-- server side.
CREATE OR REPLACE FUNCTION public.mcp_client_payments_get(_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_company_payments;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR NOT public.mcp_is_company_member(_company) THEN RAISE EXCEPTION 'MCP_BAD:Not a member of this company.'; END IF;
  SELECT * INTO p FROM public.mcp_company_payments WHERE company_id = _company;
  RETURN mcp_private.client_payments_json(p, mcp_private.client_payments_owner(_company));
END $$;
REVOKE ALL ON FUNCTION public.mcp_client_payments_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_client_payments_get(uuid) TO authenticated;

-- An owner chooses which ways customers may pay and the largest card payment.
CREATE OR REPLACE FUNCTION public.mcp_client_payments_settings(_company uuid, _card boolean, _bank boolean, _card_max_cents bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_company_payments;
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT mcp_private.client_payments_owner(_company) THEN RAISE EXCEPTION 'MCP_BAD:Only a company owner can change client payments.'; END IF;
  IF _card IS NULL OR _bank IS NULL OR NOT (_card OR _bank) THEN RAISE EXCEPTION 'MCP_BAD:Keep at least one way to pay.'; END IF;
  IF _card_max_cents IS NULL OR _card_max_cents NOT BETWEEN 100 AND 100000000 THEN RAISE EXCEPTION 'MCP_BAD:Card limit must be between $1 and $1,000,000.'; END IF;
  SELECT * INTO p FROM public.mcp_company_payments WHERE company_id = _company FOR UPDATE;
  IF p.company_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Connect payments first.'; END IF;
  UPDATE public.mcp_company_payments SET card_enabled = _card, bank_enabled = _bank, card_max_cents = _card_max_cents, updated_at = now()
   WHERE company_id = _company RETURNING * INTO p;
  RETURN mcp_private.client_payments_json(p, true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_client_payments_settings(uuid, boolean, boolean, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_client_payments_settings(uuid, boolean, boolean, bigint) TO authenticated;

-- Client payments on one job, newest first, for the board. Full job access only.
CREATE OR REPLACE FUNCTION public.mcp_job_payments_list(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  j := mcp_private.portal_full_job(_job);
  RETURN coalesce((SELECT jsonb_agg(mcp_private.portal_payment_json(p) || jsonb_build_object('id', p.id, 'label', mcp_private.portal_item_label(p.item_id),
      'fee_cents', p.fee_cents, 'customer', a.name, 'created_at', p.created_at) ORDER BY p.created_at DESC)
    FROM public.mcp_portal_payments p JOIN public.mcp_portal_access a ON a.id = p.access_id
    WHERE p.job_id = j.id AND p.status <> 'expired'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_payments_list(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_job_payments_list(uuid) TO authenticated;

-- ---------- the app server only ----------

-- The company's row with its Stripe account ids, for the app server after it checked the caller is an owner.
CREATE OR REPLACE FUNCTION public.mcp_client_payments_server_get(_company uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('company_id', c.id, 'company', c.name, 'mode', coalesce(p.mode, 'test'),
    'account_test', p.account_test, 'account_live', p.account_live,
    'status_test', coalesce(p.status_test, 'not_connected'), 'status_live', coalesce(p.status_live, 'not_connected'))
  FROM public.mcp_companies c LEFT JOIN public.mcp_company_payments p ON p.company_id = c.id WHERE c.id = _company
$$;
REVOKE ALL ON FUNCTION public.mcp_client_payments_server_get(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_client_payments_server_get(uuid) TO service_role;

-- Saves the connected account the app server created or re-read for an owner. An account belongs to one company.
CREATE OR REPLACE FUNCTION public.mcp_client_payments_account_save(_company uuid, _mode text, _account text, _status text, _by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_company_payments;
BEGIN
  IF _mode NOT IN ('test', 'live') THEN RAISE EXCEPTION 'MCP_BAD:Unknown payment mode.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = _by AND role = 'owner') THEN
    RAISE EXCEPTION 'MCP_BAD:Only a company owner can connect payments.';
  END IF;
  INSERT INTO public.mcp_company_payments (company_id, connected_by) VALUES (_company, _by) ON CONFLICT (company_id) DO NOTHING;
  SELECT * INTO p FROM public.mcp_company_payments WHERE company_id = _company FOR UPDATE;
  IF (_mode = 'test' AND p.account_test IS NOT NULL AND p.account_test <> _account)
     OR (_mode = 'live' AND p.account_live IS NOT NULL AND p.account_live <> _account) THEN
    RAISE EXCEPTION 'MCP_BAD:This company already has a connected % account.', _mode;
  END IF;
  IF _mode = 'test' THEN
    UPDATE public.mcp_company_payments SET account_test = _account, status_test = _status, updated_at = now() WHERE company_id = _company RETURNING * INTO p;
  ELSE
    UPDATE public.mcp_company_payments SET account_live = _account, status_live = _status, updated_at = now() WHERE company_id = _company RETURNING * INTO p;
  END IF;
  RETURN mcp_private.client_payments_json(p, true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_client_payments_account_save(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_client_payments_account_save(uuid, text, text, text, uuid) TO service_role;

-- Stripe told us an account's readiness changed (account.updated). A live account that stops being ready takes the
-- company back off live, so no customer is sent to a checkout that can't take money.
CREATE OR REPLACE FUNCTION public.mcp_client_payments_account_status(_account text, _livemode boolean, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_company_payments;
BEGIN
  IF _livemode THEN
    UPDATE public.mcp_company_payments SET status_live = _status,
      mode = CASE WHEN _status = 'ready' THEN mode ELSE 'test' END, updated_at = now()
     WHERE account_live = _account RETURNING * INTO p;
  ELSE
    UPDATE public.mcp_company_payments SET status_test = _status, updated_at = now() WHERE account_test = _account RETURNING * INTO p;
  END IF;
  RETURN CASE WHEN p.company_id IS NULL THEN jsonb_build_object('status', 'unknown_account')
    ELSE jsonb_build_object('status', 'ok', 'company_id', p.company_id) END;
END $$;
REVOKE ALL ON FUNCTION public.mcp_client_payments_account_status(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_client_payments_account_status(text, boolean, text) TO service_role;

-- An owner switches the company to live payments (or back to test). Live needs a ready live account.
CREATE OR REPLACE FUNCTION public.mcp_client_payments_set_mode(_company uuid, _mode text, _by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_company_payments;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = _by AND role = 'owner') THEN
    RAISE EXCEPTION 'MCP_BAD:Only a company owner can change payments.';
  END IF;
  SELECT * INTO p FROM public.mcp_company_payments WHERE company_id = _company FOR UPDATE;
  IF p.company_id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Connect payments first.'; END IF;
  IF _mode = 'live' AND (p.account_live IS NULL OR p.status_live <> 'ready') THEN
    RAISE EXCEPTION 'MCP_BAD:Finish Stripe''s live setup before turning on live payments.';
  END IF;
  IF _mode NOT IN ('test', 'live') THEN RAISE EXCEPTION 'MCP_BAD:Unknown payment mode.'; END IF;
  UPDATE public.mcp_company_payments SET mode = _mode, updated_at = now() WHERE company_id = _company RETURNING * INTO p;
  RETURN mcp_private.client_payments_json(p, true);
END $$;
REVOKE ALL ON FUNCTION public.mcp_client_payments_set_mode(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_client_payments_set_mode(uuid, text, uuid) TO service_role;

-- Payment state of every shared item on the customer's page, so the page can show Pay, Processing or Paid.
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
      WHERE i.job_id = a.job_id AND i.kind = 'pay_app' AND i.withdrawn_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_payments_state(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_payments_state(uuid, text) TO service_role;

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
  IF it.id IS NULL OR it.kind <> 'pay_app' THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT * INTO d FROM public.mcp_portal_decisions WHERE item_id = it.id;
  IF d.decision IS DISTINCT FROM 'approved' THEN RETURN jsonb_build_object('status', 'not_approved'); END IF;
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

-- Keeps the Checkout session the app server opened. An older open session for the same item is closed first: the
-- app server expires it at Stripe before calling this.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_opened(_item uuid, _access uuid, _mode text, _account text, _session text,
  _methods text[], _amount_cents bigint, _fee_cents bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it public.mcp_portal_items; p public.mcp_portal_payments;
BEGIN
  SELECT * INTO it FROM public.mcp_portal_items WHERE id = _item AND kind = 'pay_app' FOR UPDATE;
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

-- Claims a Stripe event once. 'fresh' and 'retry' mean process it; 'done' means it was handled; 'busy' means another
-- delivery is handling it now (Stripe retries).
CREATE OR REPLACE FUNCTION public.mcp_stripe_connect_event_claim(_event text, _type text, _livemode boolean, _account text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.mcp_stripe_connect_events;
BEGIN
  INSERT INTO public.mcp_stripe_connect_events (event_id, event_type, livemode, account_id) VALUES (_event, _type, _livemode, _account)
  ON CONFLICT (event_id) DO NOTHING RETURNING * INTO e;
  IF e.event_id IS NOT NULL THEN RETURN 'fresh'; END IF;
  SELECT * INTO e FROM public.mcp_stripe_connect_events WHERE event_id = _event FOR UPDATE;
  IF e.status = 'processed' THEN RETURN 'done'; END IF;
  IF e.claimed_at > now() - interval '5 minutes' THEN RETURN 'busy'; END IF;
  UPDATE public.mcp_stripe_connect_events SET claimed_at = now() WHERE event_id = _event;
  RETURN 'retry';
END $$;
REVOKE ALL ON FUNCTION public.mcp_stripe_connect_event_claim(text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_stripe_connect_event_claim(text, text, boolean, text) TO service_role;

-- Marks a claimed event handled, or lets it go so Stripe's retry can try again.
CREATE OR REPLACE FUNCTION public.mcp_stripe_connect_event_finish(_event text, _processed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF _processed THEN
    UPDATE public.mcp_stripe_connect_events SET status = 'processed', processed_at = now() WHERE event_id = _event;
  ELSE
    DELETE FROM public.mcp_stripe_connect_events WHERE event_id = _event AND status = 'processing';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mcp_stripe_connect_event_finish(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_stripe_connect_event_finish(text, boolean) TO service_role;

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
    SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = it.ref_id AND job_id = p.job_id AND kind = 'pay_application';
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

-- A refund made in Stripe (charge.refunded): _refunded_total_cents is Stripe's running total for the charge. Only
-- the new part is reversed: first off the pay application, then off the receipt. Repeats change nothing.
CREATE OR REPLACE FUNCTION public.mcp_portal_pay_refunded(_payment_intent text, _account text, _refunded_total_cents bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.mcp_portal_payments; cp public.mcp_company_payments; delta bigint; left_on_alloc bigint; j public.mcp_jobs;
BEGIN
  SELECT * INTO p FROM public.mcp_portal_payments WHERE payment_intent_id = _payment_intent FOR UPDATE;
  IF p.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown_payment'); END IF;
  IF p.account_id <> _account THEN RAISE EXCEPTION 'MCP_BAD:Payment account does not match.'; END IF;
  IF p.status NOT IN ('paid', 'partially_refunded', 'refunded') THEN RETURN jsonb_build_object('status', 'not_paid_yet'); END IF;
  IF _refunded_total_cents IS NULL OR _refunded_total_cents < 0 OR _refunded_total_cents > p.amount_cents THEN
    RAISE EXCEPTION 'MCP_BAD:Refund total out of range.';
  END IF;
  delta := _refunded_total_cents - p.refunded_cents;
  IF delta <= 0 THEN RETURN jsonb_build_object('status', 'unchanged', 'payment_id', p.id); END IF;
  SELECT * INTO cp FROM public.mcp_company_payments WHERE company_id = p.company_id;
  IF p.allocation_id IS NOT NULL THEN
    SELECT a.amount_cents - coalesce((SELECT sum(r.amount_cents) FROM public.mcp_billing_allocations r WHERE r.reversal_of = a.id), 0)
      INTO left_on_alloc FROM public.mcp_billing_allocations a WHERE a.id = p.allocation_id;
    IF least(delta, left_on_alloc) > 0 THEN
      INSERT INTO public.mcp_billing_allocations (id, job_id, receipt_id, invoice_id, amount_cents, reversal_of, effective_date, source, recorded_by)
      SELECT gen_random_uuid(), job_id, receipt_id, invoice_id, least(delta, left_on_alloc), id, current_date, 'Stripe refund on ' || _payment_intent, cp.connected_by
        FROM public.mcp_billing_allocations WHERE id = p.allocation_id;
    END IF;
  END IF;
  IF p.receipt_id IS NOT NULL THEN
    INSERT INTO public.mcp_billing_receipt_reversals (id, job_id, receipt_id, amount_cents, effective_date, source, recorded_by)
    VALUES (gen_random_uuid(), p.job_id, p.receipt_id, delta, current_date, 'Stripe refund on ' || _payment_intent, cp.connected_by);
  END IF;
  UPDATE public.mcp_portal_payments SET refunded_cents = _refunded_total_cents,
    status = CASE WHEN _refunded_total_cents = amount_cents THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now()
   WHERE id = p.id RETURNING * INTO p;
  INSERT INTO public.mcp_portal_events (access_id, job_id, kind, detail)
  VALUES (p.access_id, p.job_id, 'payment_refunded', jsonb_build_object('item', p.item_id, 'payment', p.id, 'refunded_cents', delta));
  SELECT * INTO j FROM public.mcp_jobs WHERE id = p.job_id;
  RETURN jsonb_build_object('status', 'changed', 'payment_id', p.id, 'payment_status', p.status, 'refunded_cents', delta,
    'refunded_total_cents', p.refunded_cents, 'job_id', p.job_id, 'job_number', j.job_number, 'job_name', j.name,
    'item_id', p.item_id, 'label', mcp_private.portal_item_label(p.item_id),
    'customer', (SELECT name FROM public.mcp_portal_access WHERE id = p.access_id), 'amount_cents', p.amount_cents, 'test', p.mode = 'test');
END $$;
REVOKE ALL ON FUNCTION public.mcp_portal_pay_refunded(text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_pay_refunded(text, text, bigint) TO service_role;

-- ---------- wire and check payments the team records ----------

-- The full-access check for recording payments, with its own message.
CREATE OR REPLACE FUNCTION mcp_private.recorded_payments_job(_job uuid) RETURNS public.mcp_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF auth.uid() IS NULL OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Recording payments needs full access to the job.';
  END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION mcp_private.recorded_payments_job(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A pay application's billing position and every payment on it: what's due, what's been applied, what's left,
-- the wire and check payments recorded (voided ones included, marked), and payments made on the client page.
CREATE OR REPLACE FUNCTION public.mcp_pay_app_payments(_job uuid, _application uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; inv public.mcp_billing_invoices; v public.mcp_billing_invoice_versions; applied bigint; credits bigint; pending bigint;
BEGIN
  j := mcp_private.recorded_payments_job(_job);
  SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = _application AND job_id = j.id AND kind = 'pay_application';
  IF inv.id IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  SELECT * INTO v FROM public.mcp_billing_invoice_versions WHERE invoice_id = inv.id ORDER BY version DESC LIMIT 1;
  applied := coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END)
    FROM public.mcp_billing_allocations WHERE invoice_id = inv.id), 0);
  credits := public.mcp_billing_posted_credits(j.id, inv.id, NULL)::bigint;
  -- A bank payment from the client page that hasn't cleared isn't applied yet, but it will be.
  pending := coalesce((SELECT sum(p.amount_cents) FROM public.mcp_portal_payments p JOIN public.mcp_portal_items i ON i.id = p.item_id
    WHERE i.ref_id = inv.id AND p.job_id = j.id AND p.status = 'processing'), 0);
  RETURN jsonb_build_object('status', 'ok', 'application_id', inv.id, 'number', inv.document_number, 'state', v.status,
    'can_record', v.status IN ('submitted', 'certified'),
    'net_due_cents', v.net_due_cents, 'credits_cents', credits, 'applied_cents', applied, 'pending_cents', pending,
    'remaining_cents', greatest(v.net_due_cents - credits - applied - pending, 0),
    'recorded', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'method', r.method, 'amount_cents', r.amount_cents,
        'received_on', r.received_on, 'reference', r.reference, 'note', r.note, 'recorded_at', r.recorded_at,
        'recorded_by', coalesce(nullif(btrim(m.display_name), ''), 'A team member'), 'voided', r.voided_at IS NOT NULL,
        'void_reason', r.void_reason) ORDER BY r.received_on DESC, r.recorded_at DESC)
      FROM public.mcp_recorded_payments r LEFT JOIN public.mcp_company_members m ON m.company_id = r.company_id AND m.user_id = r.recorded_by
      WHERE r.invoice_id = inv.id AND r.job_id = j.id), '[]'::jsonb),
    'online', coalesce((SELECT jsonb_agg(mcp_private.portal_payment_json(p) ORDER BY p.created_at DESC)
      FROM public.mcp_portal_payments p JOIN public.mcp_portal_items i ON i.id = p.item_id
      WHERE i.ref_id = inv.id AND p.job_id = j.id AND p.status NOT IN ('open', 'expired')), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.mcp_pay_app_payments(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_pay_app_payments(uuid, uuid) TO authenticated;

-- Records a wire or check the contractor received on a submitted or certified pay application: a billing receipt on
-- the job, applied to the pay application. Partial payments are fine; more than what's left is refused. _id is the
-- caller's request id, so a retry returns the same payment instead of recording it twice. No Athena fee.
CREATE OR REPLACE FUNCTION public.mcp_pay_app_record_payment(_job uuid, _application uuid, _id uuid, _method text,
  _amount_cents bigint, _received_on date, _reference text, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; inv public.mcp_billing_invoices; v public.mcp_billing_invoice_versions; r public.mcp_recorded_payments;
  rid uuid := gen_random_uuid(); aid uuid := gen_random_uuid(); left_cents bigint; word text; ref text := btrim(coalesce(_reference, ''));
  note text := nullif(btrim(coalesce(_note, '')), '');
BEGIN
  j := mcp_private.recorded_payments_job(_job);
  IF _id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:A request id is required.'; END IF;
  SELECT * INTO r FROM public.mcp_recorded_payments WHERE id = _id;
  IF r.id IS NOT NULL THEN
    IF r.job_id <> j.id OR r.invoice_id IS DISTINCT FROM _application OR r.method IS DISTINCT FROM _method
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
  SELECT * INTO inv FROM public.mcp_billing_invoices WHERE id = _application AND job_id = j.id AND kind = 'pay_application' FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That pay application isn''t on this job.'; END IF;
  SELECT * INTO v FROM public.mcp_billing_invoice_versions WHERE invoice_id = inv.id ORDER BY version DESC LIMIT 1;
  IF v.status NOT IN ('submitted', 'certified') THEN RAISE EXCEPTION 'MCP_BAD:Record payments on a submitted or certified pay application.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_recorded_payments WHERE job_id = j.id AND method = _method AND lower(btrim(reference)) = lower(ref) AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:%', CASE WHEN _method = 'check' THEN 'That check number is already recorded on this job.' ELSE 'That wire reference is already recorded on this job.' END;
  END IF;
  left_cents := v.net_due_cents - public.mcp_billing_posted_credits(j.id, inv.id, NULL)::bigint
    - coalesce((SELECT sum(CASE WHEN reversal_of IS NULL THEN amount_cents ELSE -amount_cents END) FROM public.mcp_billing_allocations WHERE invoice_id = inv.id), 0)
    - coalesce((SELECT sum(p.amount_cents) FROM public.mcp_portal_payments p JOIN public.mcp_portal_items i ON i.id = p.item_id
        WHERE i.ref_id = inv.id AND p.job_id = j.id AND p.status = 'processing'), 0);
  IF _amount_cents > left_cents THEN
    RAISE EXCEPTION 'MCP_BAD:That''s more than the % left on this pay application.', to_char(greatest(left_cents, 0) / 100.0, 'FM$999,999,999,990.00');
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
    'remaining_cents', greatest(left_cents - _amount_cents, 0));
END $$;
REVOKE ALL ON FUNCTION public.mcp_pay_app_record_payment(uuid, uuid, uuid, text, bigint, date, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_pay_app_record_payment(uuid, uuid, uuid, text, bigint, date, text, text) TO authenticated;

-- Voids a recorded payment entered by mistake: takes it back off the pay application and the receipt. The record
-- stays, marked voided with the reason. Voiding twice changes nothing.
CREATE OR REPLACE FUNCTION public.mcp_pay_app_void_payment(_job uuid, _payment uuid, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.mcp_jobs; r public.mcp_recorded_payments; left_on_alloc bigint; reason text := btrim(coalesce(_reason, ''));
BEGIN
  j := mcp_private.recorded_payments_job(_job);
  SELECT * INTO r FROM public.mcp_recorded_payments WHERE id = _payment AND job_id = j.id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That payment isn''t on this job.'; END IF;
  IF r.voided_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'ok', 'id', r.id, 'already_voided', true); END IF;
  IF length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'MCP_BAD:Say why this payment is being removed.'; END IF;
  SELECT a.amount_cents - coalesce((SELECT sum(x.amount_cents) FROM public.mcp_billing_allocations x WHERE x.reversal_of = a.id), 0)
    INTO left_on_alloc FROM public.mcp_billing_allocations a WHERE a.id = r.allocation_id;
  IF left_on_alloc > 0 THEN
    INSERT INTO public.mcp_billing_allocations (id, job_id, receipt_id, invoice_id, amount_cents, reversal_of, effective_date, source, recorded_by)
    SELECT gen_random_uuid(), job_id, receipt_id, invoice_id, left_on_alloc, id, current_date, 'Voided: ' || reason, auth.uid()
      FROM public.mcp_billing_allocations WHERE id = r.allocation_id;
  END IF;
  INSERT INTO public.mcp_billing_receipt_reversals (id, job_id, receipt_id, amount_cents, effective_date, source, recorded_by)
  SELECT gen_random_uuid(), j.id, r.receipt_id, b.amount_cents - coalesce((SELECT sum(x.amount_cents) FROM public.mcp_billing_receipt_reversals x WHERE x.receipt_id = b.id), 0),
    current_date, 'Voided: ' || reason, auth.uid()
    FROM public.mcp_billing_receipts b WHERE b.id = r.receipt_id
     AND b.amount_cents > coalesce((SELECT sum(x.amount_cents) FROM public.mcp_billing_receipt_reversals x WHERE x.receipt_id = b.id), 0);
  UPDATE public.mcp_recorded_payments SET voided_at = now(), voided_by = auth.uid(), void_reason = reason WHERE id = r.id;
  RETURN jsonb_build_object('status', 'ok', 'id', r.id, 'already_voided', false);
END $$;
REVOKE ALL ON FUNCTION public.mcp_pay_app_void_payment(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_pay_app_void_payment(uuid, uuid, text) TO authenticated;
