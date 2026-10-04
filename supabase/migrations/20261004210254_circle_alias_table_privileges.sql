-- Correct hosted default table grants without changing any other role or object.
-- REVOKE ALL also removes newer privileges (for example MAINTAIN).
REVOKE ALL PRIVILEGES ON TABLE public.circle_source_aliases, public.circle_source_alias_history, public.circle_owner_grant_history FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.circle_source_aliases TO service_role;
GRANT SELECT, INSERT ON TABLE public.circle_source_alias_history, public.circle_owner_grant_history TO service_role;
