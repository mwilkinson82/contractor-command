-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena account page: one company profile that clients see (Marshall, Nov 4 2026).
-- Before: the account page saved the logo, name and address to the old Contractor Circle `companies` record, which
--   pay apps, proposals, client pages and emails never read. Athena's own record (mcp_companies) had no address.
-- After: mcp_companies gets an optional address, and mcp_company_brand_save accepts it alongside the logo, license,
--   contact, phone and website it already takes. Same Owner check, membership gate, https logo rule, grants and audit.
-- Additive only: one nullable column. No existing row changes.
ALTER TABLE public.mcp_companies ADD COLUMN IF NOT EXISTS address text;

CREATE OR REPLACE FUNCTION public.mcp_company_brand_save(_company uuid, _p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_member_role(_company), '') <> 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company Owner can change the company profile.'; END IF;
  IF _p ? 'logo_url' AND nullif(btrim(_p->>'logo_url'), '') IS NOT NULL AND btrim(_p->>'logo_url') !~* '^https://' THEN
    RAISE EXCEPTION 'MCP_BAD:The logo link must start with https://.';
  END IF;
  IF _p ? 'address' AND length(coalesce(_p->>'address', '')) > 300 THEN
    RAISE EXCEPTION 'MCP_BAD:Keep the address under 300 characters.';
  END IF;
  UPDATE public.mcp_companies SET
    logo_url = CASE WHEN _p ? 'logo_url' THEN nullif(btrim(_p->>'logo_url'), '') ELSE logo_url END,
    license_number = CASE WHEN _p ? 'license_number' THEN nullif(btrim(_p->>'license_number'), '') ELSE license_number END,
    contact_name = CASE WHEN _p ? 'contact_name' THEN nullif(btrim(_p->>'contact_name'), '') ELSE contact_name END,
    contact_phone = CASE WHEN _p ? 'contact_phone' THEN nullif(btrim(_p->>'contact_phone'), '') ELSE contact_phone END,
    website = CASE WHEN _p ? 'website' THEN nullif(btrim(_p->>'website'), '') ELSE website END,
    address = CASE WHEN _p ? 'address' THEN nullif(btrim(_p->>'address'), '') ELSE address END,
    updated_at = now()
  WHERE id = _company;
  PERFORM public.mcp_audit(_company, NULL, 'onboarding', 'company_brand_update', _company::text);
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_company_brand_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_company_brand_save(uuid, jsonb) TO authenticated;
