-- Good/Better/Best selections and proposals, part 2 of 5: board validation.
-- Mirrors src/lib/selections/model.ts so a direct RPC call can't store a board
-- the app would reject. Safe to rerun.

CREATE OR REPLACE FUNCTION mcp_private.gbb_is_text(_v jsonb, _max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT _v IS NOT NULL AND jsonb_typeof(_v) = 'string' AND length(_v #>> '{}') <= _max
$$;

CREATE OR REPLACE FUNCTION mcp_private.gbb_is_cents(_v jsonb, _max bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT _v IS NOT NULL AND (_v = 'null'::jsonb OR (jsonb_typeof(_v) = 'number'
    AND (_v #>> '{}') ~ '^(0|[1-9][0-9]{0,11})$' AND (_v #>> '{}')::numeric <= _max))
$$;

CREATE OR REPLACE FUNCTION mcp_private.gbb_is_date(_v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE d date;
BEGIN
  IF _v IS NULL THEN RETURN false; END IF;
  IF _v = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(_v) <> 'string' OR (_v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
  d := (_v #>> '{}')::date;
  RETURN to_char(d, 'YYYY-MM-DD') = (_v #>> '{}');
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION mcp_private.gbb_is_url(_v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT _v IS NOT NULL AND (_v = 'null'::jsonb OR (jsonb_typeof(_v) = 'string'
    AND length(_v #>> '{}') <= 2048 AND (_v #>> '{}') ~ '^https://[^/?#[:space:]]+[^[:space:]]*$'))
$$;

CREATE OR REPLACE FUNCTION mcp_private.validate_residential_selection_board(_body jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE item jsonb; opt jsonb; p jsonb; tier text; bullet jsonb; ids text[] := '{}'; id text; q numeric;
BEGIN
  IF jsonb_typeof(_body) IS DISTINCT FROM 'object'
     OR _body - ARRAY['currency','proposal','selections','accepted'] <> '{}'::jsonb
     OR NOT _body ?& ARRAY['currency','proposal','selections','accepted']
     OR (_body->'currency' <> 'null'::jsonb AND (jsonb_typeof(_body->'currency') <> 'string' OR _body->>'currency' !~ '^[A-Z]{3}$'))
     OR jsonb_typeof(_body->'selections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(_body->'selections') > 100
     OR (_body->'accepted' <> 'null'::jsonb AND jsonb_typeof(_body->'accepted') <> 'object')
     OR octet_length(_body::text) > 1000000 THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid selections board.';
  END IF;

  p := _body->'proposal';
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR p - ARRAY['title','intro','base_price_cents','base_tier','base_reviewed_on','base_basis','valid_until','terms'] <> '{}'::jsonb
     OR NOT p ?& ARRAY['title','intro','base_price_cents','base_tier','base_reviewed_on','base_basis','valid_until','terms']
     OR NOT mcp_private.gbb_is_text(p->'title', 160) OR NOT mcp_private.gbb_is_text(p->'intro', 1200)
     OR NOT mcp_private.gbb_is_text(p->'base_basis', 300) OR NOT mcp_private.gbb_is_text(p->'terms', 2000)
     OR jsonb_typeof(p->'base_tier') IS DISTINCT FROM 'string' OR p->>'base_tier' NOT IN ('good','better','best') THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid proposal details.';
  END IF;
  IF NOT mcp_private.gbb_is_cents(p->'base_price_cents', 999999999999) THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid base price.';
  END IF;
  IF NOT mcp_private.gbb_is_date(p->'base_reviewed_on') OR NOT mcp_private.gbb_is_date(p->'valid_until') THEN
    RAISE EXCEPTION 'MCP_BAD:Invalid proposal date.';
  END IF;
  IF p->'base_reviewed_on' <> 'null'::jsonb AND p->'base_price_cents' = 'null'::jsonb THEN
    RAISE EXCEPTION 'MCP_BAD:A base price must be set before it can be marked reviewed.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR item - ARRAY['id','title','decision_due','allowance_cents','quantity','unit','estimate_line_ref','options','selected','notes'] <> '{}'::jsonb
       OR NOT item ?& ARRAY['id','title','decision_due','allowance_cents','quantity','unit','estimate_line_ref','options','selected','notes']
       OR jsonb_typeof(item->'id') <> 'string'
       OR (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT mcp_private.gbb_is_text(item->'title', 160) OR length(btrim(item->>'title')) = 0
       OR NOT mcp_private.gbb_is_text(item->'notes', 2000)
       OR NOT mcp_private.gbb_is_text(item->'unit', 20) OR length(btrim(item->>'unit')) = 0
       OR (item->'estimate_line_ref' <> 'null'::jsonb AND (jsonb_typeof(item->'estimate_line_ref') <> 'string' OR item->>'estimate_line_ref' !~ '^T-[1-9][0-9]{0,5}$'))
       OR jsonb_typeof(item->'options') IS DISTINCT FROM 'object'
       OR (item->'options') - ARRAY['good','better','best'] <> '{}'::jsonb
       OR NOT (item->'options') ?& ARRAY['good','better','best'] THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid selection.';
    END IF;
    id := lower(item->>'id');
    IF id = ANY(ids) THEN RAISE EXCEPTION 'MCP_BAD:Duplicate selection ID.'; END IF;
    ids := array_append(ids, id);
    IF jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity.'; END IF;
    q := (item->>'quantity')::numeric;
    IF q <= 0 OR q > 1000000 OR q <> round(q, 3) THEN RAISE EXCEPTION 'MCP_BAD:Invalid quantity.'; END IF;
    IF NOT mcp_private.gbb_is_date(item->'decision_due') THEN RAISE EXCEPTION 'MCP_BAD:Invalid decision date.'; END IF;
    IF NOT mcp_private.gbb_is_cents(item->'allowance_cents', 999999999999) THEN RAISE EXCEPTION 'MCP_BAD:Invalid allowance.'; END IF;
    IF item->'selected' <> 'null'::jsonb AND (jsonb_typeof(item->'selected') <> 'string' OR item->>'selected' NOT IN ('good','better','best')) THEN
      RAISE EXCEPTION 'MCP_BAD:Invalid selected option.';
    END IF;
    FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
      opt := item->'options'->tier;
      IF jsonb_typeof(opt) IS DISTINCT FROM 'object'
         OR opt - ARRAY['description','manufacturer','model','specifications','included','source_url','photo_url','found_price_cents','found_at','found_on','cost_cents','price_cents','price_reviewed_on','assumptions'] <> '{}'::jsonb
         OR NOT opt ?& ARRAY['description','manufacturer','model','specifications','included','source_url','photo_url','found_price_cents','found_at','found_on','cost_cents','price_cents','price_reviewed_on','assumptions']
         OR NOT mcp_private.gbb_is_text(opt->'description', 500) OR NOT mcp_private.gbb_is_text(opt->'manufacturer', 120)
         OR NOT mcp_private.gbb_is_text(opt->'model', 120) OR NOT mcp_private.gbb_is_text(opt->'specifications', 2000)
         OR NOT mcp_private.gbb_is_text(opt->'assumptions', 1000) OR NOT mcp_private.gbb_is_text(opt->'found_at', 160)
         OR jsonb_typeof(opt->'included') IS DISTINCT FROM 'array' OR jsonb_array_length(opt->'included') > 12 THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid selection option.';
      END IF;
      FOR bullet IN SELECT value FROM jsonb_array_elements(opt->'included') LOOP
        IF NOT mcp_private.gbb_is_text(bullet, 160) OR length(btrim(bullet #>> '{}')) = 0 THEN
          RAISE EXCEPTION 'MCP_BAD:Invalid included item.';
        END IF;
      END LOOP;
      IF NOT mcp_private.gbb_is_cents(opt->'cost_cents', 100000000000) OR NOT mcp_private.gbb_is_cents(opt->'price_cents', 100000000000)
         OR NOT mcp_private.gbb_is_cents(opt->'found_price_cents', 100000000000) THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid option amount.';
      END IF;
      IF NOT mcp_private.gbb_is_url(opt->'source_url') OR NOT mcp_private.gbb_is_url(opt->'photo_url') THEN
        RAISE EXCEPTION 'MCP_BAD:Invalid source URL.';
      END IF;
      IF NOT mcp_private.gbb_is_date(opt->'price_reviewed_on') OR NOT mcp_private.gbb_is_date(opt->'found_on') THEN RAISE EXCEPTION 'MCP_BAD:Invalid review date.'; END IF;
      IF opt->'price_reviewed_on' <> 'null'::jsonb AND opt->'price_cents' = 'null'::jsonb THEN
        RAISE EXCEPTION 'MCP_BAD:A price must be set before it can be marked reviewed.';
      END IF;
      IF item->>'selected' = tier AND length(btrim(opt->>'description')) = 0 THEN
        RAISE EXCEPTION 'MCP_BAD:The selected option needs a description.';
      END IF;
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION mcp_private.gbb_is_text(jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mcp_private.gbb_is_cents(jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mcp_private.gbb_is_date(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mcp_private.gbb_is_url(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mcp_private.validate_residential_selection_board(jsonb) FROM PUBLIC, anon, authenticated, service_role;
