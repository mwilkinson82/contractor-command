-- UNREGISTERED LOCAL PROPOSAL. Requires explicit release approval and supported Lovable verification.
CREATE INDEX CONCURRENTLY mcp_billing_receipt_reversals_job_reconciliation_idx ON public.mcp_billing_receipt_reversals(job_id);
