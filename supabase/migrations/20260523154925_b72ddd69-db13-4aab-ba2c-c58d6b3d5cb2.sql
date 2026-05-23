
REVOKE EXECUTE ON FUNCTION public.ensure_default_calendar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_calendar(uuid) TO authenticated;
