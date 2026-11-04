-- Good/Better/Best selections and proposals, part 5 of 5: record a customer
-- choice and share the customer view. Safe to rerun.
-- Only full-scope job members (not estimating-only or field roles) can record
-- a choice or share prices with a customer. Recording a choice updates only the
-- selections board; it never changes a contract, budget, SOV, billing or
-- accounting record, and it never writes the estimate.

CREATE OR REPLACE FUNCTION mcp_private.gbb_full_scope(_job uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF public.mcp_job_scope(_job) IS DISTINCT FROM 'full' THEN
    RAISE EXCEPTION 'MCP_BAD:Only a member with full job access can do this.';
  END IF;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION mcp_private.gbb_full_scope(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_residential_selections_record_choice(
  _job uuid, _expected_version bigint, _tier text, _recorded_on date, _evidence text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cid uuid; version_now bigint; body_now jsonb; view jsonb; total numeric; body_new jsonb; next bigint;
BEGIN
  cid := mcp_private.gbb_full_scope(_job);
  IF auth.uid() IS NULL OR _expected_version IS NULL OR _expected_version < 1 THEN
    RAISE EXCEPTION 'MCP_BAD:Read the board version before recording a choice.';
  END IF;
  IF _tier IS NULL OR _tier NOT IN ('good','better','best') THEN RAISE EXCEPTION 'MCP_BAD:Choose Good, Better or Best.'; END IF;
  IF _evidence IS NULL OR length(btrim(_evidence)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'MCP_BAD:Say how the customer made this choice.';
  END IF;
  IF _recorded_on IS NULL OR _recorded_on NOT BETWEEN current_date - 1 AND current_date + 1 THEN
    RAISE EXCEPTION 'MCP_BAD:A choice is recorded on today''s date.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('residential-selections:' || _job::text, 0));
  IF mcp_private.gbb_full_scope(_job) IS DISTINCT FROM cid THEN RAISE EXCEPTION 'MCP_NO_ACCESS'; END IF;
  SELECT version, body INTO version_now, body_now FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  IF version_now IS DISTINCT FROM _expected_version THEN
    RAISE EXCEPTION 'MCP_BAD:Selections changed. Refresh before recording a choice.';
  END IF;
  view := mcp_private.gbb_customer_proposal(body_now, version_now);
  SELECT (x->>'total_cents')::numeric INTO total FROM jsonb_array_elements(view->'packages') x WHERE x->>'tier' = _tier;
  next := version_now + 1;
  body_new := jsonb_set(body_now, '{selections}', coalesce((SELECT jsonb_agg(jsonb_set(s, '{selected}', to_jsonb(_tier)) ORDER BY o)
    FROM jsonb_array_elements(body_now->'selections') WITH ORDINALITY AS t(s, o)), '[]'::jsonb));
  body_new := jsonb_set(body_new, '{accepted}', jsonb_build_object('tier', _tier, 'board_version', next, 'total_cents', total,
    'recorded_on', to_char(_recorded_on, 'YYYY-MM-DD'), 'recorded_by', auth.uid(), 'evidence', btrim(_evidence)));
  UPDATE mcp_private.residential_selection_boards SET version = next, body = body_new, updated_by = auth.uid(), updated_at = now()
    WHERE job_id = _job;
  INSERT INTO mcp_private.residential_selection_board_history(job_id, version, action, body, updated_by)
    VALUES (_job, next, 'record_choice', body_new, auth.uid());
  RETURN jsonb_build_object('version', next, 'board', body_new, 'scope', 'full');
END $$;
REVOKE ALL ON FUNCTION public.mcp_residential_selections_record_choice(uuid, bigint, text, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_residential_selections_record_choice(uuid, bigint, text, date, text) TO authenticated;

-- Freezes the customer view of the current board version behind a share token.
CREATE OR REPLACE FUNCTION public.mcp_selection_proposal_share_create(
  _job uuid, _expected_version bigint, _token_hash text, _expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE cid uuid; version_now bigint; body_now jsonb; view jsonb; nid uuid;
BEGIN
  cid := mcp_private.gbb_full_scope(_job);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'MCP_NO_ACCESS'; END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'MCP_BAD:Invalid share token.'; END IF;
  IF _expires_at IS NULL OR _expires_at <= now() OR _expires_at > now() + interval '90 days 1 hour' THEN
    RAISE EXCEPTION 'MCP_BAD:Links last 1 to 90 days.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('residential-selections:' || _job::text, 0));
  SELECT version, body INTO version_now, body_now FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  IF version_now IS NULL OR version_now IS DISTINCT FROM _expected_version THEN
    RAISE EXCEPTION 'MCP_BAD:Selections changed. Refresh and preview before sharing.';
  END IF;
  view := mcp_private.gbb_customer_proposal(body_now, version_now);
  INSERT INTO mcp_private.selection_proposal_shares(job_id, company_id, board_version, token_hash, proposal, created_by, expires_at)
    VALUES (_job, cid, version_now, _token_hash, view, auth.uid(), _expires_at) RETURNING id INTO nid;
  RETURN jsonb_build_object('id', nid, 'board_version', version_now, 'expires_at', _expires_at, 'proposal', view);
END $$;
REVOKE ALL ON FUNCTION public.mcp_selection_proposal_share_create(uuid, bigint, text, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_selection_proposal_share_create(uuid, bigint, text, timestamptz) TO authenticated;

-- Turns a link off: the member who made it, or an owner or leader of that company.
CREATE OR REPLACE FUNCTION public.mcp_selection_proposal_share_revoke(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r mcp_private.selection_proposal_shares;
BEGIN
  PERFORM public.mcp_assert_active();
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM mcp_private.selection_proposal_shares WHERE token_hash = _token_hash;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  IF r.created_by IS DISTINCT FROM auth.uid() AND NOT public.mcp_is_company_leader(r.company_id) THEN RETURN NULL; END IF;
  UPDATE mcp_private.selection_proposal_shares SET revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid())
    WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'board_version', r.board_version);
END $$;
REVOKE ALL ON FUNCTION public.mcp_selection_proposal_share_revoke(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_selection_proposal_share_revoke(text) TO authenticated;

-- Public (anon): hash in, the frozen customer view out. Expired, turned-off or
-- unknown links return NULL.
CREATE OR REPLACE FUNCTION public.mcp_selection_proposal_share_open(_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s mcp_private.selection_proposal_shares; job_name text; company_name text;
BEGIN
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM mcp_private.selection_proposal_shares
    WHERE token_hash = _token_hash AND revoked_at IS NULL AND expires_at > now();
  IF s.id IS NULL THEN RETURN NULL; END IF;
  UPDATE mcp_private.selection_proposal_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = s.id;
  SELECT name INTO job_name FROM public.mcp_jobs WHERE id = s.job_id;
  SELECT name INTO company_name FROM public.mcp_companies WHERE id = s.company_id;
  RETURN jsonb_build_object('company', company_name, 'job_name', job_name, 'expires_at', s.expires_at,
    'board_version', s.board_version, 'proposal', s.proposal);
END $$;
REVOKE ALL ON FUNCTION public.mcp_selection_proposal_share_open(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_selection_proposal_share_open(text) TO anon, authenticated;
