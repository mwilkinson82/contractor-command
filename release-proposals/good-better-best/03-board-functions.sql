-- Good/Better/Best selections and proposals, part 3 of 5: read and save a board.
-- Safe to rerun. Estimating access (full or contract scope) can read and save.
-- A save can't set or clear the recorded customer choice; only part 5 can.

CREATE OR REPLACE FUNCTION mcp_private.gbb_empty_board() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'currency', NULL,
    'proposal', jsonb_build_object('title', '', 'intro', '', 'base_price_cents', NULL, 'base_tier', 'good',
      'base_reviewed_on', NULL, 'base_basis', '', 'valid_until', NULL, 'terms', ''),
    'selections', '[]'::jsonb,
    'accepted', NULL)
$$;
REVOKE ALL ON FUNCTION mcp_private.gbb_empty_board() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_residential_selections_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  SELECT jsonb_build_object('version', version, 'board', body, 'updated_at', updated_at, 'scope', public.mcp_job_scope(_job))
    INTO result FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  RETURN coalesce(result, jsonb_build_object('version', 0, 'board', mcp_private.gbb_empty_board(), 'updated_at', NULL,
    'scope', public.mcp_job_scope(_job)));
END $$;
REVOKE ALL ON FUNCTION public.mcp_residential_selections_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_residential_selections_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_residential_selections_save(_job uuid, _expected_version bigint, _board jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE version_now bigint; body_now jsonb; cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF auth.uid() IS NULL OR _expected_version IS NULL OR _expected_version < 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Read the board version before saving.';
  END IF;
  PERFORM mcp_private.validate_residential_selection_board(_board);
  PERFORM pg_advisory_xact_lock(hashtextextended('residential-selections:' || _job::text, 0));
  IF public.mcp_estimate_guard(_job) IS DISTINCT FROM cid THEN RAISE EXCEPTION 'MCP_NO_ACCESS'; END IF;
  SELECT version, body INTO version_now, body_now FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  IF coalesce(version_now, 0) <> _expected_version THEN
    RAISE EXCEPTION 'MCP_BAD:Selections changed. Refresh before saving.';
  END IF;
  IF (_board->'accepted') IS DISTINCT FROM coalesce(body_now->'accepted', 'null'::jsonb) THEN
    RAISE EXCEPTION 'MCP_BAD:A save can''t change the recorded customer choice.';
  END IF;
  INSERT INTO mcp_private.residential_selection_boards(job_id, version, body, updated_by)
    VALUES (_job, _expected_version + 1, _board, auth.uid())
    ON CONFLICT (job_id) DO UPDATE SET version = excluded.version, body = excluded.body,
      updated_by = excluded.updated_by, updated_at = now();
  INSERT INTO mcp_private.residential_selection_board_history(job_id, version, action, body, updated_by)
    VALUES (_job, _expected_version + 1, 'save', _board, auth.uid());
  RETURN jsonb_build_object('version', _expected_version + 1, 'board', _board, 'scope', public.mcp_job_scope(_job));
END $$;
REVOKE ALL ON FUNCTION public.mcp_residential_selections_save(uuid, bigint, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_residential_selections_save(uuid, bigint, jsonb) TO authenticated;
