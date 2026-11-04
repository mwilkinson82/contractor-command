-- Good/Better/Best selections and proposals, part 4 of 5: the customer view.
-- Builds the only data a customer ever sees, from whitelisted fields. Cost,
-- margin, assumptions, internal notes and the base-price basis never leave.
-- Mirrors customerProposal in src/lib/selections/proposal.ts. Safe to rerun.

CREATE OR REPLACE FUNCTION mcp_private.gbb_extended(_qty jsonb, _unit jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN _unit IS NULL OR _unit = 'null'::jsonb THEN NULL
    ELSE round((_qty #>> '{}')::numeric * (_unit #>> '{}')::numeric) END
$$;

-- Returns the customer view for a ready board, or raises with what is missing.
CREATE OR REPLACE FUNCTION mcp_private.gbb_customer_proposal(_body jsonb, _version bigint) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE p jsonb := _body->'proposal'; item jsonb; opt jsonb; tier text; base_tier text; delta numeric;
  total numeric; packages jsonb := '[]'::jsonb; selections jsonb := '[]'::jsonb; options jsonb; missing text[] := '{}';
BEGIN
  PERFORM mcp_private.validate_residential_selection_board(_body);
  base_tier := p->>'base_tier';
  IF _body->'currency' = 'null'::jsonb THEN missing := array_append(missing, 'currency'); END IF;
  IF length(btrim(p->>'title')) = 0 THEN missing := array_append(missing, 'title'); END IF;
  IF p->'base_price_cents' = 'null'::jsonb OR p->'base_reviewed_on' = 'null'::jsonb THEN missing := array_append(missing, 'reviewed base price'); END IF;
  IF jsonb_array_length(_body->'selections') = 0 THEN missing := array_append(missing, 'selections'); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      IF length(btrim(opt->>'description')) = 0 OR opt->'price_cents' = 'null'::jsonb OR opt->'price_reviewed_on' = 'null'::jsonb THEN
        missing := array_append(missing, (item->>'title') || ' (' || tier || ')');
      END IF;
    END LOOP;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Proposal is not ready. Missing or unreviewed: %', array_to_string(missing[1:10], ', ');
  END IF;

  FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
    delta := 0;
    FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
      delta := delta + mcp_private.gbb_extended(item->'quantity', item->'options'->tier->'price_cents')
                     - mcp_private.gbb_extended(item->'quantity', item->'options'->base_tier->'price_cents');
    END LOOP;
    total := (p->>'base_price_cents')::numeric + delta;
    IF total < 0 OR total > 9007199254740991 OR abs(delta) > 9007199254740991 THEN
      RAISE EXCEPTION 'MCP_BAD:A package total is out of range.';
    END IF;
    packages := packages || jsonb_build_array(jsonb_build_object('tier', tier, 'total_cents', total, 'difference_cents', delta));
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    options := '{}'::jsonb;
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      options := options || jsonb_build_object(tier, jsonb_build_object(
        'description', opt->'description', 'manufacturer', opt->'manufacturer', 'model', opt->'model',
        'specifications', opt->'specifications', 'included', opt->'included',
        'source_url', opt->'source_url', 'photo_url', opt->'photo_url'));
    END LOOP;
    selections := selections || jsonb_build_array(jsonb_build_object('id', item->'id', 'title', item->'title',
      'quantity', item->'quantity', 'unit', item->'unit', 'options', options));
  END LOOP;

  RETURN jsonb_build_object(
    'currency', _body->'currency', 'title', p->'title', 'intro', p->'intro', 'terms', p->'terms',
    'valid_until', p->'valid_until', 'base_tier', p->'base_tier', 'packages', packages, 'selections', selections,
    'accepted', CASE WHEN jsonb_typeof(_body->'accepted') = 'object' AND (_body->'accepted'->>'board_version')::bigint = _version
      THEN jsonb_build_object('tier', _body->'accepted'->'tier', 'recorded_on', _body->'accepted'->'recorded_on') END);
END $$;
REVOKE ALL ON FUNCTION mcp_private.gbb_extended(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mcp_private.gbb_customer_proposal(jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
