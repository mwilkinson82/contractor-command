-- Stage only. Apply through the existing Lovable Cloud managed migration flow.
--
-- Athena first-run setup: the kinds of work a company does (Marshall, Nov 5 2026).
-- Before: the company profile only knew commercial, public or residential, so Athena asked every new job
--   the same generic questions and had no way to know a company does unit price, pre-con, service calls,
--   union or prevailing wage work.
-- After: mcp_companies.work_profile holds the answers to the first-run questions, and
--   mcp_company_work_profile_save saves them. Same Owner check, membership gate, grants and audit as the
--   company profile. Other features read the profile; nothing else depends on it in SQL.
--
-- work_profile keys (each optional; a missing key means not answered yet or skipped):
--   markets        text array: public_low_bid, private_commercial, residential_renovation, custom_homes
--   pricing        text array: lump_sum, cost_plus, gmp, time_and_material
--   regions        text array: states or areas they usually work in, as typed (up to 20)
--   shop           open_shop | union_shop | both
--   wage_rules     text array: prevailing_wage, pla (empty array = neither)
--   unit_price     yes | no
--   preconstruction yes | no
--   service_calls  yes | no
--   skipped        text array of question keys the member chose to skip
--   answered_at    set by this function on every save
-- A save merges: keys sent replace their saved value, keys not sent keep theirs, a JSON null removes one.
-- When markets is saved, work_types (commercial, public, residential) follows it so existing defaults keep working.
-- Additive only: one column with an empty default. No existing row changes.
-- No BEGIN or COMMIT: the Lovable migration tool runs the file in its own transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mcp_companies ADD COLUMN IF NOT EXISTS work_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.mcp_companies.work_profile IS 'First-run kinds-of-work answers (markets, pricing, regions, shop, wage_rules, unit_price, preconstruction, service_calls, skipped, answered_at). Missing key = not answered.';

CREATE OR REPLACE FUNCTION public.mcp_company_work_profile_save(_company uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text; v jsonb; cur jsonb; nxt jsonb; el text; n int;
  allowed jsonb := jsonb_build_object(
    'markets', '["public_low_bid","private_commercial","residential_renovation","custom_homes"]'::jsonb,
    'pricing', '["lump_sum","cost_plus","gmp","time_and_material"]'::jsonb,
    'wage_rules', '["prevailing_wage","pla"]'::jsonb,
    'skipped', '["markets","pricing","regions","shop","wage_rules","unit_price","preconstruction","service_calls"]'::jsonb
  );
BEGIN
  PERFORM public.mcp_assert_active();
  IF coalesce(public.mcp_member_role(_company), '') <> 'owner' THEN RAISE EXCEPTION 'MCP_BAD:Only a company Owner can change the company profile.'; END IF;
  IF _p IS NULL OR jsonb_typeof(_p) <> 'object' THEN RAISE EXCEPTION 'MCP_BAD:Send the answers as an object.'; END IF;
  SELECT work_profile INTO cur FROM public.mcp_companies WHERE id = _company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MCP_BAD:Company not found.'; END IF;
  nxt := coalesce(cur, '{}'::jsonb);
  FOR k, v IN SELECT key, value FROM jsonb_each(_p) LOOP
    IF k NOT IN ('markets','pricing','regions','shop','wage_rules','unit_price','preconstruction','service_calls','skipped') THEN
      RAISE EXCEPTION 'MCP_BAD:Unknown kinds-of-work answer: %', k;
    END IF;
    IF v = 'null'::jsonb THEN nxt := nxt - k; CONTINUE; END IF;
    IF k IN ('markets','pricing','wage_rules','skipped') THEN
      IF jsonb_typeof(v) <> 'array' THEN RAISE EXCEPTION 'MCP_BAD:% must be a list.', k; END IF;
      FOR el IN SELECT jsonb_array_elements_text(v) LOOP
        IF NOT (allowed->k) ? el THEN RAISE EXCEPTION 'MCP_BAD:% can''t include %.', k, el; END IF;
      END LOOP;
      v := (SELECT coalesce(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements_text(v) x);
    ELSIF k = 'regions' THEN
      IF jsonb_typeof(v) <> 'array' THEN RAISE EXCEPTION 'MCP_BAD:regions must be a list.'; END IF;
      SELECT count(*) INTO n FROM jsonb_array_elements(v);
      IF n > 20 THEN RAISE EXCEPTION 'MCP_BAD:Name up to 20 states or areas.'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR length(btrim(e #>> '{}')) NOT BETWEEN 1 AND 80) THEN
        RAISE EXCEPTION 'MCP_BAD:Each state or area must be 1 to 80 characters.';
      END IF;
      v := (SELECT coalesce(jsonb_agg(btrim(e #>> '{}')), '[]'::jsonb) FROM jsonb_array_elements(v) e);
    ELSIF k = 'shop' THEN
      IF v NOT IN ('"open_shop"'::jsonb, '"union_shop"'::jsonb, '"both"'::jsonb) THEN RAISE EXCEPTION 'MCP_BAD:shop must be open_shop, union_shop or both.'; END IF;
    ELSE
      IF v NOT IN ('"yes"'::jsonb, '"no"'::jsonb) THEN RAISE EXCEPTION 'MCP_BAD:% must be yes or no.', k; END IF;
    END IF;
    nxt := nxt || jsonb_build_object(k, v);
  END LOOP;
  -- An answered question is no longer skipped.
  IF nxt ? 'skipped' THEN
    nxt := jsonb_set(nxt, '{skipped}', (SELECT coalesce(jsonb_agg(s ORDER BY s), '[]'::jsonb) FROM jsonb_array_elements_text(nxt->'skipped') s WHERE NOT nxt ? s));
  END IF;
  nxt := nxt || jsonb_build_object('answered_at', to_jsonb(now()));
  UPDATE public.mcp_companies SET
    work_profile = nxt,
    work_types = CASE WHEN _p ? 'markets' AND jsonb_typeof(_p->'markets') = 'array' THEN ARRAY(
      SELECT DISTINCT w FROM (
        SELECT CASE m WHEN 'public_low_bid' THEN 'public' WHEN 'private_commercial' THEN 'commercial' ELSE 'residential' END AS w
        FROM jsonb_array_elements_text(_p->'markets') m
      ) t ORDER BY w) ELSE work_types END,
    updated_at = now()
  WHERE id = _company;
  PERFORM public.mcp_audit(_company, NULL, 'onboarding', 'company_work_profile_update', _company::text);
  RETURN nxt;
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_company_work_profile_save(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_company_work_profile_save(uuid, jsonb) TO authenticated;
