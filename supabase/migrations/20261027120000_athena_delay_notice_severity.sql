-- Carry category and check_key so a delay-notice obligation can be classified
-- from the task, not only from its title. Same rows, signature, and privileges.
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
    'check_key', i.check_key
  ) ORDER BY coalesce(i.needed_by, i.due_date) NULLS LAST), '[]'::jsonb)
  FROM public.mcp_open_items i
  WHERE i.job_id = _job AND i.status = 'open' AND (NOT _super OR coalesce(i.internal_only, false) = false)
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_report_open_items(uuid, boolean) FROM anon, authenticated, public;
