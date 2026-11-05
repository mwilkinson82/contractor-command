-- Good, Better, Best: customer choices follow the job's contract stage, and customers never get product links.
--
-- * gbb_job_under_contract: a job is under contract once it has a known contract value (job setup facts:
--   contract_value, contract_amount, original_contract, contract_sum or contract). This is the same fact
--   contract_terms and the billing tools read.
-- * mcp_selection_proposal_share_open reports the stage so the customer sees "change order" only when it is one.
--   The customer page functions follow in 20261104200100_athena_portal_choice_stage.sql.
-- * gbb_customer_proposal: the customer view drops product_url (contractors mark up materials; a maker or store
--   page would show the customer a lower price) and requires an https product photo on every option.
-- Plain SQL for Lovable to apply. Every function is CREATE OR REPLACE with its existing signature and grants.

CREATE OR REPLACE FUNCTION mcp_private.gbb_job_under_contract(_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mcp_job_facts f
     WHERE f.job_id = _job AND f.status = 'known'
       AND f.module IN ('contract', 'budget', 'job', 'setup')
       AND f.key IN ('contract_value', 'contract_amount', 'original_contract', 'contract_sum', 'contract')
       AND f.value IS NOT NULL AND f.value <> 'null'::jsonb
       AND btrim(f.value #>> '{}') ~ '[1-9]');
$$;
REVOKE ALL ON FUNCTION mcp_private.gbb_job_under_contract(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
      IF length(btrim(opt->>'description')) = 0 OR opt->'price_cents' = 'null'::jsonb OR opt->'price_reviewed_on' = 'null'::jsonb
         OR coalesce(opt->>'photo_url', '') !~ '^https://' THEN
        missing := array_append(missing, (item->>'title') || ' (' || tier || ')');
      END IF;
    END LOOP;
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'MCP_BAD:Proposal is not ready. Missing, unreviewed or without a product photo: %', array_to_string(missing[1:10], ', ');
  END IF;

  FOREACH tier IN ARRAY ARRAY['good','better','best'] LOOP
    delta := 0;
    FOR item IN SELECT value FROM jsonb_array_elements(_body->'selections') LOOP
      delta := delta + mcp_private.gbb_extended(item->'quantity', item->'options'->tier->'price_cents')
                     - mcp_private.gbb_extended(item->'quantity', item->'options'->base_tier->'price_cents');
    END LOOP;
    total := (p->>'base_price_cents')::numeric + delta;
    IF total < 0 OR total > 999999999999 OR abs(delta) > 999999999999 THEN
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
        'photo_url', opt->'photo_url',
        'difference_cents', round(mcp_private.gbb_extended(item->'quantity', opt->'price_cents')
                                - mcp_private.gbb_extended(item->'quantity', item->'options'->base_tier->'price_cents'))));
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
REVOKE ALL ON FUNCTION mcp_private.gbb_customer_proposal(jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;

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
    'board_version', s.board_version, 'proposal', s.proposal,
    'under_contract', mcp_private.gbb_job_under_contract(s.job_id));
END $$;
REVOKE ALL ON FUNCTION public.mcp_selection_proposal_share_open(text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_selection_proposal_share_open(text) TO anon, authenticated;
