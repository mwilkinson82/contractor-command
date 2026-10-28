-- STAGED PROPOSAL ONLY. Coordinator must create an ordered migration after
-- billing evidence and financial originals, review permissions and run advisors.
-- No data changes. One SELECT observes all included relations in one MVCC snapshot.
-- Standard CREATE INDEX can block writes; coordinator must review size, locking,
-- existing index names and deployment strategy before generating the migration.
CREATE INDEX mcp_billing_allocations_job_reconciliation_idx ON public.mcp_billing_allocations(job_id);
CREATE INDEX mcp_billing_receipt_reversals_job_reconciliation_idx ON public.mcp_billing_receipt_reversals(job_id);
CREATE INDEX mcp_billing_documents_job_reconciliation_idx ON public.mcp_billing_documents(job_id);
CREATE FUNCTION public.mcp_billing_reconciliation_snapshot(_job uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.mcp_assert_active();
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Billing evidence requires full project access.';
  END IF;
  WITH
  j AS MATERIALIZED (SELECT id, company_id FROM public.mcp_jobs WHERE id = _job AND public.mcp_job_scope(_job) = 'full'),
  inv AS MATERIALIZED (SELECT id,job_id,company_id,document_number,kind,credit_for FROM public.mcp_billing_invoices WHERE job_id = _job LIMIT 5001),
  ver AS MATERIALIZED (SELECT invoice_id,job_id,version,status,net_due_cents,source,reason FROM public.mcp_billing_invoice_versions WHERE job_id = _job LIMIT 5001),
  rec AS MATERIALIZED (SELECT id,job_id,company_id,amount_cents,source FROM public.mcp_billing_receipts WHERE job_id = _job LIMIT 5001),
  alloc AS MATERIALIZED (SELECT id,job_id,receipt_id,invoice_id,amount_cents,reversal_of,source FROM public.mcp_billing_allocations WHERE job_id = _job LIMIT 5001),
  rev AS MATERIALIZED (SELECT id,job_id,receipt_id,amount_cents,source FROM public.mcp_billing_receipt_reversals WHERE job_id = _job LIMIT 5001),
  docs AS MATERIALIZED (SELECT id,job_id,company_id FROM public.mcp_billing_documents WHERE job_id = _job LIMIT 5001),
  links AS MATERIALIZED (SELECT document_id,job_id,invoice_id,invoice_version,receipt_id FROM public.mcp_billing_document_links WHERE job_id = _job LIMIT 5001),
  version_groups AS MATERIALIZED (SELECT invoice_id,jsonb_agg(to_jsonb(v) ORDER BY version DESC) AS versions FROM ver v GROUP BY invoice_id),
  bounded AS (SELECT (SELECT count(*) FROM inv) <= 5000 AND (SELECT count(*) FROM ver) <= 5000
    AND (SELECT count(*) FROM rec) <= 5000 AND (SELECT count(*) FROM alloc) <= 5000
    AND (SELECT count(*) FROM rev) <= 5000 AND (SELECT count(*) FROM docs) <= 5000
    AND (SELECT count(*) FROM links) <= 5000
    -- Count UTF-8 source bytes before JSON aggregation. Never truncate evidence.
    AND (SELECT coalesce(sum(octet_length(document_number)),0) FROM inv)
      + (SELECT coalesce(sum(coalesce(octet_length(source),0)+coalesce(octet_length(reason),0)),0) FROM ver)
      + (SELECT coalesce(sum(octet_length(source)),0) FROM rec)
      + (SELECT coalesce(sum(octet_length(source)),0) FROM alloc)
      + (SELECT coalesce(sum(octet_length(source)),0) FROM rev) <= 1048576 AS complete)
  SELECT jsonb_build_object('snapshot_version',1,'job_id',j.id,'company_id',j.company_id,
    'complete',bounded.complete,
    'billing', CASE WHEN bounded.complete THEN jsonb_build_object('currency','USD',
      'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object('versions',
        coalesce(g.versions,'[]'::jsonb)) ORDER BY i.id) FROM inv i LEFT JOIN version_groups g ON g.invoice_id=i.id),'[]'::jsonb),
      'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM rec r),'[]'::jsonb),
      'allocations',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM alloc a),'[]'::jsonb),
      'receipt_reversals',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM rev r),'[]'::jsonb)) END,
    'originals', CASE WHEN bounded.complete THEN jsonb_build_object(
      'documents',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM docs d),'[]'::jsonb),
      'links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.document_id,l.invoice_id,l.invoice_version,l.receipt_id) FROM links l),'[]'::jsonb)) END)
  INTO result FROM j CROSS JOIN bounded;
  IF result IS NULL THEN RAISE EXCEPTION 'MCP_NO_JOB'; END IF;
  -- A separate final envelope cap includes fixed metadata/JSON escaping overhead.
  IF octet_length(result::text)>2097152 THEN
    RETURN jsonb_build_object('snapshot_version',1,'job_id',result->'job_id','company_id',result->'company_id',
      'complete',false,'billing',NULL,'originals',NULL);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mcp_billing_reconciliation_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_billing_reconciliation_snapshot(uuid) TO authenticated;
