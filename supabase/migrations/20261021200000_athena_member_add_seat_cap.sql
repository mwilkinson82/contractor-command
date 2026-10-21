-- Athena 0.8.16.2: onboarding add_member (mcp_member_add) now respects the seat cap, like team_invite.
-- Only NEW people count against the cap; re-adding an existing member (role/name update) is always allowed.
-- Companies already over the cap keep everyone (nothing is removed); they just can't add more until under it.
-- Also logs before/after to mcp_team_audit. NOT APPLIED.
CREATE OR REPLACE FUNCTION public.mcp_member_add(_company uuid, _email text, _display_name text, _role text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid; b jsonb; u jsonb; lim int; used int;
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_member_role(_company), '') <> 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company Owner can add members.'; END IF;
  IF _role NOT IN ('owner','pm','all_access') THEN RAISE EXCEPTION 'MCP_BAD:role must be owner, pm or all_access.'; END IF;
  IF NOT public.mcp_role_allowed(_company, _role) THEN RAISE EXCEPTION 'MCP_BAD:Your plan doesn''t include that role. Upgrading adds it.'; END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF uid IS NULL THEN RAISE EXCEPTION 'MCP_BAD:No account with that email. They need to sign in once first.'; END IF;
  b := public.mcp_team_snapshot(_company, uid);
  IF b IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mcp_team_seats:' || _company::text));
    u := public.mcp_seat_usage(_company);
    lim := (u->>'limit')::int; used := (u->>'members')::int + (u->>'pending')::int;
    IF lim IS NOT NULL AND used >= lim THEN RAISE EXCEPTION 'MCP_SEAT_LIMIT:%:%', used, lim; END IF;
  END IF;
  INSERT INTO public.mcp_company_members (company_id, user_id, display_name, role) VALUES (_company, uid, btrim(_display_name), _role)
    ON CONFLICT (company_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role;
  PERFORM public.mcp_audit(_company, NULL, 'onboarding', 'member_add', uid::text);
  PERFORM public.mcp_team_log(_company, uid, lower(btrim(_email)), CASE WHEN b IS NULL THEN 'member_add' ELSE 'update' END, b, public.mcp_team_snapshot(_company, uid));
  RETURN uid;
END $function$;
