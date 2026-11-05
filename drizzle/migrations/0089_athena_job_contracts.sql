-- Managed Lovable Cloud proposal. No standalone transaction wrapper.
-- Plain SQL for Lovable to apply; nothing in this repo applies it. Apply after
-- 20261105150000_athena_gbb_change_terms.sql. Needs the purchase order chain (drizzle
-- 0035_accounting_purchase_orders: mcp_project_parties, mcp_purchase_orders) and the
-- saved document originals (20261031120000_athena_file_upload: mcp_contract_documents.id, mcp_spec_documents).
--
-- Job contracts: every contract on a job in one record.
-- Before: Athena kept the job's prime contract text (mcp_contract_documents, one per job) and purchase orders, but
-- no list of the job's contracts: who each one is with, what it covers, its value, whether it was sent or signed,
-- and where the signed copy is. A member couldn't drop a subcontract into chat and have it kept on the job.
-- After:
--   * public.mcp_job_contracts: one row per contract on a job. Kind prime (with the client), subcontract,
--     supplier (supplier agreement or PO) or other; who it is with (counterparty, optionally the job's saved
--     subcontractor/supplier and purchase order, both on the same job); title, the trade/scope it covers (tag),
--     cost code, value in cents, status draft | sent | signed | void with the sent and signed dates, the saved
--     original (document_id), how it reached Athena (source) and a note. At most one prime that isn't void per job.
--     Two contracts with the same subcontractor are allowed (a second scope, a later phase), so there is no other
--     unique rule.
--   * public.mcp_job_contract_versions: an immutable snapshot of every saved version, with the reason.
--   * Written only through mcp_job_contract_save (create, or update against the version the member loaded, with a
--     reason); read through mcp_job_contract_rows, or directly under RLS. Full and contract job access read and
--     write; a Super sees nothing. The save returns the contract id with its previous and new status, so the
--     server can send a notice when a contract becomes sent or signed. Athena records what the member said;
--     nothing is sent or added to the project record from here.
-- Rollback: supabase/rollbacks/20261105170000_athena_job_contracts.rollback.sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. The contracts and their versions.
CREATE TABLE IF NOT EXISTS public.mcp_job_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  kind text NOT NULL CHECK (kind IN ('prime', 'subcontract', 'supplier', 'other')),
  counterparty text NOT NULL CHECK (counterparty = btrim(counterparty) AND length(counterparty) BETWEEN 1 AND 200),
  party_id uuid REFERENCES public.mcp_project_parties(id),
  po_id uuid REFERENCES public.mcp_purchase_orders(id),
  title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
  tag text CHECK (tag IS NULL OR length(tag) BETWEEN 1 AND 200),
  cost_code text CHECK (cost_code IS NULL OR length(cost_code) BETWEEN 1 AND 60),
  value_cents bigint CHECK (value_cents IS NULL OR value_cents >= 0),
  status text NOT NULL CHECK (status IN ('draft', 'sent', 'signed', 'void')),
  sent_on date,
  signed_on date,
  document_id uuid,
  source text NOT NULL CHECK (source IN ('chat', 'upload', 'client_page', 'signing_page', 'proposal', 'purchase_order')),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'prime' OR (party_id IS NULL AND po_id IS NULL)),
  CHECK (status IN ('sent', 'signed', 'void') OR (sent_on IS NULL AND signed_on IS NULL)),
  CHECK (status IN ('signed', 'void') OR signed_on IS NULL),
  CHECK (signed_on IS NULL OR sent_on IS NULL OR signed_on >= sent_on),
  CHECK (source <> 'purchase_order' OR po_id IS NOT NULL)
);
COMMENT ON TABLE public.mcp_job_contracts IS 'Every contract on a job: prime, subcontracts, supplier agreements/POs, other. Written only by mcp_job_contract_save.';
COMMENT ON COLUMN public.mcp_job_contracts.tag IS 'The trade or scope the contract covers, as the member names it.';
COMMENT ON COLUMN public.mcp_job_contracts.document_id IS 'The saved original on this job: mcp_contract_documents.id (the job''s prime contract) or mcp_spec_documents.id. No single table holds every contract original, so this is a plain uuid checked by mcp_job_contract_save.';
COMMENT ON COLUMN public.mcp_job_contracts.source IS 'How the contract reached Athena: chat, upload, client_page, signing_page, proposal or purchase_order.';
CREATE INDEX IF NOT EXISTS mcp_job_contracts_job_idx ON public.mcp_job_contracts (job_id, kind, created_at);
-- At most one live prime contract per job. A voided prime stays on the record beside its replacement.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_job_contracts_one_prime_idx ON public.mcp_job_contracts (job_id)
  WHERE kind = 'prime' AND status <> 'void';

CREATE TABLE IF NOT EXISTS public.mcp_job_contract_versions (
  contract_id uuid NOT NULL REFERENCES public.mcp_job_contracts(id),
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, version)
);
COMMENT ON TABLE public.mcp_job_contract_versions IS 'Immutable snapshot of each saved version of a job contract, with the reason for the change.';
DROP TRIGGER IF EXISTS mcp_job_contract_versions_immutable ON public.mcp_job_contract_versions;
CREATE TRIGGER mcp_job_contract_versions_immutable BEFORE UPDATE OR DELETE ON public.mcp_job_contract_versions
  FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

ALTER TABLE public.mcp_job_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_job_contract_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job contracts read by contract scope" ON public.mcp_job_contracts;
CREATE POLICY "job contracts read by contract scope" ON public.mcp_job_contracts FOR SELECT TO authenticated
  USING (coalesce(public.mcp_job_scope(job_id) IN ('full', 'contract'), false));
DROP POLICY IF EXISTS "job contract versions read by contract scope" ON public.mcp_job_contract_versions;
CREATE POLICY "job contract versions read by contract scope" ON public.mcp_job_contract_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_job_contracts c
    WHERE c.id = contract_id AND coalesce(public.mcp_job_scope(c.job_id) IN ('full', 'contract'), false)));
REVOKE ALL ON public.mcp_job_contracts, public.mcp_job_contract_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_job_contracts, public.mcp_job_contract_versions TO authenticated;
GRANT ALL ON public.mcp_job_contracts, public.mcp_job_contract_versions TO service_role;

-- 2. Save one contract: create (no contract_id) or update (contract_id + expected_version + reason).
-- On update, only the fields present in _p change; a field sent as null is cleared.
CREATE OR REPLACE FUNCTION public.mcp_job_contract_save(_job uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sc text; j public.mcp_jobs; cur public.mcp_job_contracts; nxt public.mcp_job_contracts;
  upd boolean; cid uuid; ev integer; why text; tz text; today date; bad text; k text;
  pp public.mcp_project_parties; po public.mcp_purchase_orders; other_prime text;
  changed boolean := true;
  texts constant text[] := ARRAY['kind','counterparty','title','tag','cost_code','status','source','note','reason','contract_id','party_id','po_id','document_id','sent_on','signed_on'];
  allowed constant text[] := ARRAY['contract_id','expected_version','kind','counterparty','party_id','po_id','title','tag','cost_code','value_cents','status','sent_on','signed_on','document_id','source','note','reason'];
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:Contracts need full or contract access to the job. Your role can''t save them.'; END IF;
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' OR octet_length(_p::text) > 20000 THEN
    RAISE EXCEPTION 'MCP_BAD:The contract details are missing or too large.';
  END IF;
  SELECT string_agg(x, ', ' ORDER BY x) INTO bad FROM jsonb_object_keys(_p) x WHERE x <> ALL (allowed);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'MCP_BAD:Athena doesn''t keep % on a contract.', replace(bad, '_', ' '); END IF;
  FOREACH k IN ARRAY texts LOOP
    IF _p ? k AND jsonb_typeof(_p->k) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'MCP_BAD:The contract''s % must be written as text.', replace(k, '_', ' ');
    END IF;
  END LOOP;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  tz := coalesce(nullif(j.time_zone, ''), 'UTC');
  today := (now() AT TIME ZONE tz)::date;
  -- One writer per job at a time, so the one-prime rule and versions stay exact.
  PERFORM pg_advisory_xact_lock(hashtext(_job::text || ':job_contracts'));

  BEGIN
    cid := nullif(_p->>'contract_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MCP_BAD:That contract ID isn''t valid. Pick the contract from the job''s contract list.';
  END;
  upd := cid IS NOT NULL;
  why := nullif(btrim(coalesce(_p->>'reason', '')), '');
  IF length(why) > 500 THEN RAISE EXCEPTION 'MCP_BAD:Keep the reason for the change to 500 characters.'; END IF;
  IF _p ? 'expected_version' AND jsonb_typeof(_p->'expected_version') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION 'MCP_BAD:The version you loaded must be a number.';
  END IF;

  IF upd THEN
    SELECT * INTO cur FROM public.mcp_job_contracts WHERE id = cid AND job_id = _job FOR UPDATE;
    IF cur.id IS NULL THEN RAISE EXCEPTION 'MCP_BAD:That contract isn''t on this job. Nothing changed.'; END IF;
    IF coalesce(_p->>'expected_version', '') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'MCP_BAD:Load the contract first. An update needs the version you loaded (now v%).', cur.version;
    END IF;
    ev := (_p->>'expected_version')::integer;
    IF ev <> cur.version THEN
      RAISE EXCEPTION 'MCP_BAD:This contract changed since you loaded it (now v%). Load it again and update that version.', cur.version;
    END IF;
    IF why IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Say why the contract is changing. The reason is kept with the new version.'; END IF;
    nxt := cur;
  ELSE
    IF nullif(_p->>'expected_version', '') IS NOT NULL THEN
      RAISE EXCEPTION 'MCP_BAD:A new contract has no version yet. To change a saved one, give its contract ID.';
    END IF;
    nxt.id := gen_random_uuid();
    nxt.job_id := _job;
    nxt.company_id := j.company_id;
    nxt.version := 1;
    nxt.created_by := auth.uid();
    nxt.created_at := now();
    nxt.status := 'draft';
    nxt.source := 'chat';
  END IF;

  -- Fields. On create every field is read; on update only the ones sent.
  IF NOT upd OR _p ? 'kind' THEN nxt.kind := lower(nullif(btrim(coalesce(_p->>'kind', '')), '')); END IF;
  IF nxt.kind IS NULL OR nxt.kind NOT IN ('prime', 'subcontract', 'supplier', 'other') THEN
    RAISE EXCEPTION 'MCP_BAD:Say what kind of contract this is: prime (with the client), subcontract, supplier, or other.';
  END IF;
  IF NOT upd OR _p ? 'counterparty' THEN nxt.counterparty := nullif(btrim(coalesce(_p->>'counterparty', '')), ''); END IF;
  IF nxt.counterparty IS NULL THEN RAISE EXCEPTION 'MCP_BAD:Say who the contract is with.'; END IF;
  IF length(nxt.counterparty) > 200 THEN RAISE EXCEPTION 'MCP_BAD:Keep who the contract is with to 200 characters.'; END IF;
  IF NOT upd OR _p ? 'title' THEN nxt.title := nullif(btrim(coalesce(_p->>'title', '')), ''); END IF;
  IF length(nxt.title) > 200 THEN RAISE EXCEPTION 'MCP_BAD:Keep the contract title to 200 characters.'; END IF;
  IF NOT upd OR _p ? 'tag' THEN nxt.tag := nullif(btrim(coalesce(_p->>'tag', '')), ''); END IF;
  IF length(nxt.tag) > 200 THEN RAISE EXCEPTION 'MCP_BAD:Keep the trade or scope tag to 200 characters.'; END IF;
  IF NOT upd OR _p ? 'cost_code' THEN nxt.cost_code := nullif(btrim(coalesce(_p->>'cost_code', '')), ''); END IF;
  IF length(nxt.cost_code) > 60 THEN RAISE EXCEPTION 'MCP_BAD:Keep the cost code to 60 characters.'; END IF;
  IF NOT upd OR _p ? 'note' THEN nxt.note := nullif(btrim(coalesce(_p->>'note', '')), ''); END IF;
  IF length(nxt.note) > 2000 THEN RAISE EXCEPTION 'MCP_BAD:Keep the note to 2,000 characters.'; END IF;
  IF _p ? 'status' THEN nxt.status := lower(nullif(btrim(coalesce(_p->>'status', '')), '')); END IF;
  IF nxt.status IS NULL OR nxt.status NOT IN ('draft', 'sent', 'signed', 'void') THEN
    RAISE EXCEPTION 'MCP_BAD:A contract''s status is draft, sent, signed or void.';
  END IF;
  IF _p ? 'source' THEN nxt.source := lower(nullif(btrim(coalesce(_p->>'source', '')), '')); END IF;
  IF nxt.source IS NULL OR nxt.source NOT IN ('chat', 'upload', 'client_page', 'signing_page', 'proposal', 'purchase_order') THEN
    RAISE EXCEPTION 'MCP_BAD:Say how the contract reached Athena: chat, upload, client page, signing page, proposal or purchase order.';
  END IF;
  IF NOT upd OR _p ? 'value_cents' THEN
    IF _p->'value_cents' IS NULL OR jsonb_typeof(_p->'value_cents') = 'null' THEN nxt.value_cents := NULL;
    ELSIF jsonb_typeof(_p->'value_cents') = 'number' AND (_p->>'value_cents') ~ '^[0-9]{1,15}$' THEN nxt.value_cents := (_p->>'value_cents')::bigint;
    ELSE RAISE EXCEPTION 'MCP_BAD:A contract value is a whole number of cents, 0 or more.';
    END IF;
  END IF;
  BEGIN
    IF NOT upd OR _p ? 'sent_on' THEN nxt.sent_on := nullif(_p->>'sent_on', '')::date; END IF;
    IF NOT upd OR _p ? 'signed_on' THEN nxt.signed_on := nullif(_p->>'signed_on', '')::date; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'MCP_BAD:Write the sent and signed dates as YYYY-MM-DD.';
  END;
  BEGIN
    IF NOT upd OR _p ? 'party_id' THEN nxt.party_id := nullif(_p->>'party_id', '')::uuid; END IF;
    IF NOT upd OR _p ? 'po_id' THEN nxt.po_id := nullif(_p->>'po_id', '')::uuid; END IF;
    IF NOT upd OR _p ? 'document_id' THEN nxt.document_id := nullif(_p->>'document_id', '')::uuid; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MCP_BAD:A subcontractor, purchase order or document ID isn''t valid. Pick it from the job''s saved records.';
  END;

  -- Dates follow the status, and none is later than today on the job.
  IF nxt.sent_on > today OR nxt.signed_on > today THEN RAISE EXCEPTION 'MCP_BAD:A sent or signed date can''t be in the future.'; END IF;
  IF nxt.status = 'draft' AND (nxt.sent_on IS NOT NULL OR nxt.signed_on IS NOT NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:A draft has no sent or signed date. Mark it sent or signed, or leave the dates out.';
  END IF;
  IF nxt.status = 'sent' AND nxt.signed_on IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_BAD:A signed date means the contract is signed. Mark it signed, or leave the signed date out.';
  END IF;
  IF nxt.signed_on < nxt.sent_on THEN RAISE EXCEPTION 'MCP_BAD:The signed date is before the sent date. Check both dates.'; END IF;

  -- Links stay on this job.
  IF nxt.kind = 'prime' AND (nxt.party_id IS NOT NULL OR nxt.po_id IS NOT NULL) THEN
    RAISE EXCEPTION 'MCP_BAD:The prime contract is with the client. It doesn''t link to a subcontractor, supplier or purchase order.';
  END IF;
  IF nxt.po_id IS NOT NULL THEN
    SELECT * INTO po FROM public.mcp_purchase_orders WHERE id = nxt.po_id;
    IF po.id IS NULL OR po.job_id <> _job THEN RAISE EXCEPTION 'MCP_BAD:That purchase order isn''t on this job.'; END IF;
    IF nxt.party_id IS NULL THEN nxt.party_id := po.party_id;
    ELSIF nxt.party_id <> po.party_id THEN RAISE EXCEPTION 'MCP_BAD:That purchase order is with a different subcontractor or supplier.';
    END IF;
  END IF;
  IF nxt.party_id IS NOT NULL THEN
    SELECT * INTO pp FROM public.mcp_project_parties WHERE id = nxt.party_id;
    IF pp.id IS NULL OR pp.job_id <> _job THEN RAISE EXCEPTION 'MCP_BAD:That subcontractor or supplier isn''t on this job.'; END IF;
  END IF;
  IF nxt.source = 'purchase_order' AND nxt.po_id IS NULL THEN
    RAISE EXCEPTION 'MCP_BAD:A contract that came from a purchase order needs that purchase order.';
  END IF;
  IF nxt.document_id IS NOT NULL AND (NOT upd OR _p ? 'document_id' OR _p ? 'kind') THEN
    IF EXISTS (SELECT 1 FROM public.mcp_contract_documents d WHERE d.id = nxt.document_id AND d.job_id = _job) THEN
      IF nxt.kind <> 'prime' THEN
        RAISE EXCEPTION 'MCP_BAD:The job''s saved contract document is the prime contract. Link it to the prime contract only.';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.mcp_spec_documents d WHERE d.id = nxt.document_id AND d.job_id = _job) THEN
      RAISE EXCEPTION 'MCP_BAD:That document isn''t saved on this job. Save the original first, then link it.';
    END IF;
  END IF;

  IF nxt.kind = 'prime' AND nxt.status <> 'void' THEN
    SELECT c.counterparty INTO other_prime FROM public.mcp_job_contracts c
     WHERE c.job_id = _job AND c.kind = 'prime' AND c.status <> 'void' AND c.id <> nxt.id LIMIT 1;
    IF other_prime IS NOT NULL THEN
      RAISE EXCEPTION 'MCP_BAD:This job already has a prime contract with %. Update that one, or void it first.', other_prime;
    END IF;
  END IF;

  IF upd THEN
    changed := (to_jsonb(nxt) - 'version' - 'updated_by' - 'updated_at') IS DISTINCT FROM (to_jsonb(cur) - 'version' - 'updated_by' - 'updated_at');
    IF NOT changed THEN
      RETURN to_jsonb(cur) - 'company_id' || jsonb_build_object('contract_id', cur.id, 'changed', false,
        'previous_status', cur.status, 'status_changed', false);
    END IF;
    nxt.version := cur.version + 1;
    nxt.updated_by := auth.uid();
    nxt.updated_at := now();
  ELSE
    nxt.updated_at := nxt.created_at;
  END IF;

  BEGIN
    IF upd THEN
      UPDATE public.mcp_job_contracts SET
        kind = nxt.kind, counterparty = nxt.counterparty, party_id = nxt.party_id, po_id = nxt.po_id,
        title = nxt.title, tag = nxt.tag, cost_code = nxt.cost_code, value_cents = nxt.value_cents,
        status = nxt.status, sent_on = nxt.sent_on, signed_on = nxt.signed_on, document_id = nxt.document_id,
        source = nxt.source, note = nxt.note, version = nxt.version, updated_by = nxt.updated_by, updated_at = nxt.updated_at
      WHERE id = nxt.id;
    ELSE
      INSERT INTO public.mcp_job_contracts (
        id, job_id, company_id, kind, counterparty, party_id, po_id, title, tag, cost_code, value_cents,
        status, sent_on, signed_on, document_id, source, note, version, created_by, created_at, updated_by, updated_at
      ) VALUES (
        nxt.id, nxt.job_id, nxt.company_id, nxt.kind, nxt.counterparty, nxt.party_id, nxt.po_id, nxt.title, nxt.tag,
        nxt.cost_code, nxt.value_cents, nxt.status, nxt.sent_on, nxt.signed_on, nxt.document_id, nxt.source, nxt.note,
        nxt.version, nxt.created_by, nxt.created_at, NULL, nxt.updated_at
      );
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'MCP_BAD:This job already has a prime contract. Update that one, or void it first.';
  END;
  INSERT INTO public.mcp_job_contract_versions (contract_id, version, snapshot, reason, recorded_by)
    VALUES (nxt.id, nxt.version, to_jsonb(nxt) - 'company_id', why, auth.uid());

  -- The caller sends any notice (sent / signed) from the previous and new status; nothing is sent from here.
  RETURN to_jsonb(nxt) - 'company_id' || jsonb_build_object('contract_id', nxt.id, 'changed', true,
    'previous_status', CASE WHEN upd THEN cur.status END, 'status_changed', NOT upd OR cur.status IS DISTINCT FROM nxt.status);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_contract_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_contract_save(uuid, jsonb) TO authenticated;

-- 3. Read the job's contracts: prime first, then subcontracts, supplier contracts, other; oldest first in each.
CREATE OR REPLACE FUNCTION public.mcp_job_contract_rows(_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sc text; j public.mcp_jobs; recs jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  sc := public.mcp_job_scope(_job);
  IF sc IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  IF sc NOT IN ('full', 'contract') THEN RAISE EXCEPTION 'MCP_BAD:Contracts need full or contract access to the job. Your role can''t see them.'; END IF;
  SELECT * INTO j FROM public.mcp_jobs WHERE id = _job;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'counterparty', c.counterparty,
      'party_id', c.party_id, 'party_name', p.name, 'po_id', c.po_id, 'po_number', o.number,
      'title', c.title, 'tag', c.tag, 'cost_code', c.cost_code, 'value_cents', c.value_cents,
      'status', c.status, 'sent_on', c.sent_on, 'signed_on', c.signed_on, 'document_id', c.document_id,
      'source', c.source, 'note', c.note, 'version', c.version,
      'created_at', c.created_at, 'updated_at', c.updated_at)
    ORDER BY array_position(ARRAY['prime', 'subcontract', 'supplier', 'other'], c.kind), c.created_at, c.id), '[]'::jsonb)
    INTO recs
    FROM public.mcp_job_contracts c
    LEFT JOIN public.mcp_project_parties p ON p.id = c.party_id
    LEFT JOIN public.mcp_purchase_orders o ON o.id = c.po_id
   WHERE c.job_id = _job;
  RETURN jsonb_build_object('job_id', j.id, 'job_number', j.job_number, 'job_name', j.name, 'contracts', recs);
END $$;
REVOKE ALL ON FUNCTION public.mcp_job_contract_rows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_job_contract_rows(uuid) TO authenticated;
