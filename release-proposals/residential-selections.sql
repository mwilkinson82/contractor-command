-- PRIVATE REVIEW PROPOSAL ONLY. Do not install without security, concurrency,
-- product and migration review. This does not provide a share link or UI.
CREATE TABLE mcp_private.residential_selection_boards (
  job_id uuid PRIMARY KEY REFERENCES public.mcp_jobs(id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON mcp_private.residential_selection_boards FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION mcp_private.validate_residential_selection_board(_body jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE item jsonb; opt jsonb; tier text; amount jsonb; price_field text; url_field text; parsed_date date; ids text[] := '{}'; id text;
BEGIN
  IF jsonb_typeof(_body) IS DISTINCT FROM 'object' OR _body - ARRAY['selections','currency'] <> '{}'::jsonb
     OR NOT _body ?& ARRAY['selections','currency']
     OR (_body->'currency' <> 'null'::jsonb AND (jsonb_typeof(_body->'currency') <> 'string' OR _body->>'currency' !~ '^[A-Z]{3}$'))
     OR jsonb_typeof(_body->'selections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(_body->'selections') > 500 OR octet_length(_body::text) > 500000 THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid selections board.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR item - ARRAY['id','title','decision_due','allowance_cents','options','selected','notes'] <> '{}'::jsonb
       OR NOT item ?& ARRAY['id','title','decision_due','allowance_cents','options','selected','notes']
       OR jsonb_typeof(item->'id') <> 'string'
       OR (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(item->'title') <> 'string' OR length(btrim(item->>'title')) NOT BETWEEN 1 AND 160
       OR jsonb_typeof(item->'notes') <> 'string' OR length(item->>'notes') > 2000
       OR jsonb_typeof(item->'options') IS DISTINCT FROM 'object'
       OR (item->'options') - ARRAY['good','better','best'] <> '{}'::jsonb
       OR NOT (item->'options') ?& ARRAY['good','better','best'] THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid selection.';
    END IF;
    id := lower(item->>'id');
    IF id = ANY(ids) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate selection ID.'; END IF;
    ids := array_append(ids, id);
    IF item->'decision_due' <> 'null'::jsonb THEN
      IF jsonb_typeof(item->'decision_due') <> 'string' OR item->>'decision_due' !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid decision date.';
      END IF;
      BEGIN
        parsed_date := (item->>'decision_due')::date;
        IF to_char(parsed_date,'YYYY-MM-DD') <> item->>'decision_due' THEN RAISE EXCEPTION 'invalid'; END IF;
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'MCP_BAD:Invalid decision date.';
      END;
    END IF;
    IF item->'selected' <> 'null'::jsonb AND (jsonb_typeof(item->'selected') <> 'string' OR item->>'selected' NOT IN ('good','better','best')) THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid selected option.';
    END IF;
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      IF jsonb_typeof(opt) IS DISTINCT FROM 'object' OR opt - ARRAY['description','cost_cents','price_cents','specifications','source_url','photo_url'] <> '{}'::jsonb
         OR NOT opt ?& ARRAY['description','cost_cents','price_cents','specifications','source_url','photo_url']
         OR jsonb_typeof(opt->'description') <> 'string' OR length(opt->>'description') > 500
         OR jsonb_typeof(opt->'specifications') <> 'string' OR length(opt->>'specifications') > 2000 THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid selection option.';
      END IF;
      IF item->>'selected' = tier AND length(btrim(opt->>'description')) = 0 THEN
        RAISE EXCEPTION 'MCP_BAD:The selected option needs a description.';
      END IF;
      FOREACH price_field IN ARRAY ARRAY['cost_cents','price_cents'] LOOP
        amount := opt->price_field;
        IF amount <> 'null'::jsonb AND (jsonb_typeof(amount) <> 'number' OR amount::text !~ '^(0|[1-9][0-9]{0,11})$') THEN
          RAISE EXCEPTION 'MCP_BAD:Invalid option amount.';
        END IF;
      END LOOP;
      FOREACH url_field IN ARRAY ARRAY['source_url','photo_url'] LOOP
        IF opt->url_field <> 'null'::jsonb AND (jsonb_typeof(opt->url_field) <> 'string' OR length(opt->>url_field) > 2048 OR opt->>url_field !~ '^https://[^/?#[:space:]]+') THEN
          RAISE EXCEPTION 'MCP_BAD:Invalid source URL.';
        END IF;
      END LOOP;
    END LOOP;
    amount := item->'allowance_cents';
    IF amount <> 'null'::jsonb AND (jsonb_typeof(amount) <> 'number' OR amount::text !~ '^(0|[1-9][0-9]{0,11})$') THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid allowance.';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION mcp_private.validate_residential_selection_board(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.mcp_residential_selections_get(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.mcp_estimate_guard(_job);
  SELECT jsonb_build_object('version', version, 'board', body, 'updated_at', updated_at)
    INTO result FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  RETURN coalesce(result, jsonb_build_object('version', 0, 'board', jsonb_build_object('currency', NULL, 'selections', '[]'::jsonb), 'updated_at', NULL));
END $$;
REVOKE ALL ON FUNCTION public.mcp_residential_selections_get(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_residential_selections_get(uuid) TO authenticated;

CREATE FUNCTION public.mcp_residential_selections_save(_job uuid, _expected_version bigint, _board jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE version_now bigint; cid uuid;
BEGIN
  cid := public.mcp_estimate_guard(_job);
  IF auth.uid() IS NULL OR _expected_version IS NULL OR _expected_version < 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Read the board version before saving.';
  END IF;
  PERFORM mcp_private.validate_residential_selection_board(_board);
  PERFORM pg_advisory_xact_lock(hashtextextended('residential-selections:' || _job::text, 0));
  IF public.mcp_estimate_guard(_job) IS DISTINCT FROM cid THEN RAISE EXCEPTION 'MCP_NO_ACCESS'; END IF;
  SELECT version INTO version_now FROM mcp_private.residential_selection_boards WHERE job_id = _job;
  IF coalesce(version_now, 0) <> _expected_version THEN
    RAISE EXCEPTION 'MCP_BAD:Selections changed. Refresh before saving.';
  END IF;
  INSERT INTO mcp_private.residential_selection_boards(job_id, version, body, updated_by)
    VALUES (_job, _expected_version + 1, _board, auth.uid())
    ON CONFLICT (job_id) DO UPDATE SET version = excluded.version, body = excluded.body,
      updated_by = excluded.updated_by, updated_at = now();
  RETURN jsonb_build_object('version', _expected_version + 1, 'board', _board);
END $$;
REVOKE ALL ON FUNCTION public.mcp_residential_selections_save(uuid,bigint,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_residential_selections_save(uuid,bigint,jsonb) TO authenticated;
