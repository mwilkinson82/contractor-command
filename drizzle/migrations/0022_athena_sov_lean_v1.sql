-- Athena SOV lean v1 (migration 0022, after 0021_athena_verbatim_contract_clauses): company logo link + footer fields, job fee % and basis document.
-- Additive only: new nullable columns and two owner/full-scope RPCs. No existing rows change.
ALTER TABLE public.mcp_companies
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.mcp_jobs
  ADD COLUMN IF NOT EXISTS sov_fee_pct numeric(7,4) CHECK (sov_fee_pct IS NULL OR (sov_fee_pct >= 0 AND sov_fee_pct < 100)),
  ADD COLUMN IF NOT EXISTS sov_basis text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mcp_company_brand_save(_company uuid, _p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_member_role(_company), '') <> 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company Owner can change the SOV logo and footer.'; END IF;
  IF _p ? 'logo_url' AND nullif(btrim(_p->>'logo_url'), '') IS NOT NULL AND btrim(_p->>'logo_url') !~* '^https://' THEN
    RAISE EXCEPTION 'MCP_BAD:The logo link must start with https://.';
  END IF;
  UPDATE public.mcp_companies SET
    logo_url = CASE WHEN _p ? 'logo_url' THEN nullif(btrim(_p->>'logo_url'), '') ELSE logo_url END,
    license_number = CASE WHEN _p ? 'license_number' THEN nullif(btrim(_p->>'license_number'), '') ELSE license_number END,
    contact_name = CASE WHEN _p ? 'contact_name' THEN nullif(btrim(_p->>'contact_name'), '') ELSE contact_name END,
    contact_phone = CASE WHEN _p ? 'contact_phone' THEN nullif(btrim(_p->>'contact_phone'), '') ELSE contact_phone END,
    website = CASE WHEN _p ? 'website' THEN nullif(btrim(_p->>'website'), '') ELSE website END,
    updated_at = now()
  WHERE id = _company;
  PERFORM public.mcp_audit(_company, NULL, 'onboarding', 'company_brand_update', _company::text);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_company_brand_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_company_brand_save(uuid, jsonb) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mcp_job_sov_terms(_job uuid, _fee_pct numeric, _basis text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.mcp_assert_job_scope(_job) <> 'full' THEN RAISE EXCEPTION 'MCP_BAD:Your role can''t change the SOV terms.'; END IF;
  IF _fee_pct IS NOT NULL AND (_fee_pct < 0 OR _fee_pct >= 100) THEN RAISE EXCEPTION 'MCP_BAD:The fee percent must be at least 0 and under 100.'; END IF;
  UPDATE public.mcp_jobs SET
    sov_fee_pct = coalesce(_fee_pct, sov_fee_pct),
    sov_basis = coalesce(nullif(btrim(_basis), ''), sov_basis),
    updated_at = now()
  WHERE id = _job;
  PERFORM public.mcp_audit_job(_job, 'intake', 'sov_terms_set', NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_job_sov_terms(uuid, numeric, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_job_sov_terms(uuid, numeric, text) TO authenticated;
