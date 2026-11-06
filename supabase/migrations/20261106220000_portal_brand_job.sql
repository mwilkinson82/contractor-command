-- Customer sign-in page identifies who it belongs to: mcp_portal_brand also gives the job number and name for the
-- access link, alongside the contractor's name and logo, so a signed-out customer sees their contractor and project
-- before entering their email. Only for a live (not revoked) access; never the invitee's email. Service role only.
CREATE OR REPLACE FUNCTION public.mcp_portal_brand(_access uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('name', co.name, 'logo_url', co.logo_url,
    'job_number', CASE WHEN a.revoked_at IS NULL THEN j.job_number END,
    'job_name', CASE WHEN a.revoked_at IS NULL THEN j.name END)
  FROM public.mcp_portal_access a
  JOIN public.mcp_companies co ON co.id = a.company_id
  JOIN public.mcp_jobs j ON j.id = a.job_id
  WHERE a.id = _access;
$$;
REVOKE ALL ON FUNCTION public.mcp_portal_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_portal_brand(uuid) TO service_role;
