-- Preserve existing item identities and show already-saved follow-up details
-- to full-scope members only. No records or access policies are changed.
CREATE OR REPLACE FUNCTION public.mcp_report_open_items(_job uuid, _super boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'action', i.action,
    'owner', coalesce(i.accountable, i.owner),
    'due', coalesce(i.needed_by, i.due_date),
    'type', coalesce(i.item_type, i.kind),
    'severity', i.severity,
    'category', i.category,
    'check_key', i.check_key,
    'next_action', CASE WHEN _super OR public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN NULL ELSE i.next_action END
  ) ORDER BY coalesce(i.needed_by, i.due_date) NULLS LAST), '[]'::jsonb)
  FROM public.mcp_open_items i
  WHERE i.job_id = _job AND i.status = 'open' AND (NOT _super OR coalesce(i.internal_only, false) = false)
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_open_items(uuid, boolean) FROM anon, authenticated, public;
