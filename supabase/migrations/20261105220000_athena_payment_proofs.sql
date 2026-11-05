-- Proof of payment for supplier bills and expenses: a check image, wire confirmation or remittance
-- attached to one recorded payment. The file is stored privately in athena-financial-documents by the
-- app server; these rows only record which file belongs to which payment, with its size and SHA-256.
-- Attaching follows the same rule as recording the payment (company owner or AP, full job access).
-- Anyone with full job access can see and download the proof. Rows are immutable once linked.
-- Proof is a document the team attached; it never verifies a bank transfer.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mcp_cost_payment_proofs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id),
  job_id uuid NOT NULL REFERENCES public.mcp_jobs(id),
  record_id uuid NOT NULL REFERENCES public.mcp_cost_submissions(id),
  payment_id uuid NOT NULL,
  shared boolean NOT NULL,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 180 AND filename !~ '[/\\]' AND filename NOT IN ('.', '..')),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  storage_path text NOT NULL UNIQUE,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (payment_id, sha256),
  CHECK (storage_path = company_id::text || '/' || job_id::text || '/' || id::text || '/' || filename)
);
CREATE INDEX IF NOT EXISTS mcp_cost_payment_proofs_job ON public.mcp_cost_payment_proofs (job_id, record_id);
ALTER TABLE public.mcp_cost_payment_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_cost_payment_proofs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mcp_cost_payment_proofs TO service_role;
DROP TRIGGER IF EXISTS mcp_cost_payment_proofs_immutable ON public.mcp_cost_payment_proofs;
CREATE TRIGGER mcp_cost_payment_proofs_immutable BEFORE UPDATE OR DELETE ON public.mcp_cost_payment_proofs
  FOR EACH ROW EXECUTE FUNCTION public.mcp_block_change();

-- Which payment a proof may attach to: the payment must belong to the bill, and the bill must sit on
-- this job with every allocated job in full scope (the same visibility rule as mcp_cost_submission_read).
CREATE OR REPLACE FUNCTION public.mcp_cost_payment_proof_scope(_job uuid, _record uuid, _payment uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.mcp_cost_submissions; is_shared boolean;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
  SELECT * INTO r FROM public.mcp_cost_submissions WHERE id = _record;
  IF NOT FOUND
    OR public.mcp_job_scope(r.anchor_job_id) IS DISTINCT FROM 'full'
    OR NOT (r.anchor_job_id = _job OR EXISTS (
      SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') a
      WHERE v.record_id = r.id AND (a->>'job_id')::uuid = _job))
    OR EXISTS (
      SELECT 1 FROM public.mcp_cost_submission_versions v CROSS JOIN LATERAL jsonb_array_elements(v.facts->'allocations') a
      WHERE v.record_id = r.id AND public.mcp_job_scope((a->>'job_id')::uuid) IS DISTINCT FROM 'full')
  THEN RAISE EXCEPTION 'MCP_BAD:That bill is not available on this project.'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_cost_payment_evidence e WHERE e.id = _payment AND e.record_id = _record) THEN is_shared := false;
  ELSIF EXISTS (SELECT 1 FROM public.mcp_cost_shared_allocations a WHERE a.payment_id = _payment AND a.record_id = _record) THEN is_shared := true;
  ELSE RAISE EXCEPTION 'MCP_BAD:That payment is not recorded on this bill.'; END IF;
  RETURN jsonb_build_object('company_id', r.company_id, 'job_id', _job, 'record_id', _record, 'payment_id', _payment,
    'shared', is_shared, 'can_attach', public.mcp_cost_accounting_authorized(r.company_id));
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_proof_scope(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_payment_proof_scope(uuid, uuid, uuid) TO authenticated;

-- Link a file the app server already stored. Re-checks scope and authority, and that the object exists.
CREATE OR REPLACE FUNCTION public.mcp_cost_payment_proof_link(_job uuid, _record uuid, _payment uuid, _id uuid,
  _filename text, _mime text, _size integer, _sha256 text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb; path text; rec public.mcp_cost_payment_proofs;
BEGIN
  s := public.mcp_cost_payment_proof_scope(_job, _record, _payment);
  IF NOT (s->>'can_attach')::boolean THEN RAISE EXCEPTION 'MCP_BAD:Only the company owner or accounts payable can attach payment proof.'; END IF;
  path := (s->>'company_id') || '/' || _job::text || '/' || _id::text || '/' || _filename;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'athena-financial-documents' AND name = path)
  THEN RAISE EXCEPTION 'MCP_BAD:The proof file is not stored.'; END IF;
  SELECT * INTO rec FROM public.mcp_cost_payment_proofs WHERE payment_id = _payment AND sha256 = _sha256;
  IF FOUND THEN RETURN to_jsonb(rec) - 'storage_path'; END IF;
  INSERT INTO public.mcp_cost_payment_proofs (id, company_id, job_id, record_id, payment_id, shared, filename, mime_type, storage_path, size_bytes, sha256, linked_by)
  VALUES (_id, (s->>'company_id')::uuid, _job, _record, _payment, (s->>'shared')::boolean, _filename, _mime, path, _size, _sha256, auth.uid())
  RETURNING * INTO rec;
  RETURN to_jsonb(rec) - 'storage_path';
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_proof_link(uuid, uuid, uuid, uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_payment_proof_link(uuid, uuid, uuid, uuid, text, text, integer, text) TO authenticated;

-- Proofs for one bill, without storage paths.
CREATE OR REPLACE FUNCTION public.mcp_cost_payment_proof_list(_job uuid, _record uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'payment_id', p.payment_id, 'filename', p.filename,
      'mime_type', p.mime_type, 'size_bytes', p.size_bytes, 'linked_at', p.linked_at) ORDER BY p.linked_at), '[]'::jsonb)
    INTO result FROM public.mcp_cost_payment_proofs p
    WHERE p.record_id = _record
      AND public.mcp_job_scope(p.job_id) = 'full'
      AND (p.job_id = _job OR EXISTS (SELECT 1 FROM public.mcp_cost_submissions r2 WHERE r2.id = _record AND r2.anchor_job_id = _job))
      AND EXISTS (SELECT 1 FROM public.mcp_cost_submissions r WHERE r.id = _record AND public.mcp_job_scope(r.anchor_job_id) = 'full');
  RETURN jsonb_build_object('proofs', result, 'can_attach', coalesce((SELECT public.mcp_cost_accounting_authorized(j.company_id) FROM public.mcp_jobs j WHERE j.id = _job), false));
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_proof_list(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_payment_proof_list(uuid, uuid) TO authenticated;

-- One proof with its storage path and fingerprint, for the app server's verified download.
CREATE OR REPLACE FUNCTION public.mcp_cost_payment_proof_get(_job uuid, _id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE rec public.mcp_cost_payment_proofs;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'MCP_BAD:Full project access required.'; END IF;
  SELECT * INTO rec FROM public.mcp_cost_payment_proofs p
    WHERE p.id = _id AND public.mcp_job_scope(p.job_id) = 'full'
      AND (p.job_id = _job OR p.record_id IN (SELECT r.id FROM public.mcp_cost_submissions r WHERE r.anchor_job_id = _job));
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:That proof is not available on this project.'; END IF;
  RETURN to_jsonb(rec);
END $$;
REVOKE ALL ON FUNCTION public.mcp_cost_payment_proof_get(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_cost_payment_proof_get(uuid, uuid) TO authenticated;
