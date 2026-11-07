-- Board links never send job money. A job board link opened in a browser that isn't signed in (an AI's own
-- browser, or anyone who has the link) used to receive the same feed a signed-in member reads, dollar figures
-- included, and the page only hid them. Now the database drops them before anything leaves:
-- * mcp_private.board_redact_money(jsonb): a copy with money fields removed (contract totals, amounts, costs, prices,
--   budgets, billed, payments, retainage, held, margin, fees, revenue, values, sell, cents) and every dollar figure in
--   text taken out ("(... $20,000 held)" goes entirely, a loose "$9,500" becomes "an amount").
-- * mcp_board_link_open: the IOR and billing forecast are denied through a link; every other page is redacted.
-- * mcp_change_log_open: change orders are money, so a link alone is denied. Signed-in members read them as before.
-- * mcp_request_log_open (RFIs, RFCs) and mcp_submittal_record_open: redacted.
-- The original functions keep their exact bodies under *_full names, callable by no client role. Signed-in members
-- read money through their own membership-checked reads, which this does not touch.
-- Plain SQL for Lovable to apply. Rollback: supabase/rollbacks/20261107001000_athena_board_link_no_money.rollback.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS mcp_private;

CREATE OR REPLACE FUNCTION mcp_private.board_redact_money(_v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  amt constant text := '-?\$[[:space:]]?[0-9][0-9,]*(\.[0-9]+)?([[:space:]]?[kKmM]\M)?';
  money_key constant text := '^(contract_(total|value|amount|sum)|amount|.*_amount|.*_amounts|cost|.*_cost|cost_.*|price|.*_price|budget.*|.*_budget|billed.*|.*_billed|payments?|.*_payments?|retainage.*|.*_retainage|held|.*_held|margin.*|.*_margin|fee|.*_fee|fees|revenue.*|value_.*|.*_value|sell|.*_sell|.*_cents)$';
  k text; v jsonb; t text; acc jsonb;
BEGIN
  IF _v IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(_v)
    WHEN 'string' THEN
      t := _v #>> '{}';
      IF position('$' IN t) = 0 THEN RETURN _v; END IF;
      t := regexp_replace(t, '[[:space:]]*\([^()<>]*' || amt || '[^()<>]*\)', '', 'g');
      t := regexp_replace(t, amt, 'an amount', 'g');
      RETURN to_jsonb(btrim(t));
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(mcp_private.board_redact_money(e) ORDER BY i), '[]'::jsonb) INTO acc
        FROM jsonb_array_elements(_v) WITH ORDINALITY AS a(e, i);
      RETURN acc;
    WHEN 'object' THEN
      acc := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(_v) LOOP
        IF k ~* money_key AND (jsonb_typeof(v) = 'number'
             OR (jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^[[:space:]]*-?\$?[0-9,.]+[[:space:]]*$')) THEN
          CONTINUE;
        END IF;
        acc := acc || jsonb_build_object(k, mcp_private.board_redact_money(v));
      END LOOP;
      RETURN acc;
    ELSE
      RETURN _v;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION mcp_private.board_redact_money(jsonb) FROM PUBLIC, anon, authenticated;

-- Keep each original under a *_full name (once), callable by no client role.
DO $$
BEGIN
  IF to_regprocedure('public.mcp_board_link_open_full(text,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.mcp_board_link_open(text, uuid, text) RENAME TO mcp_board_link_open_full;
  END IF;
  IF to_regprocedure('public.mcp_change_log_open_full(text,uuid)') IS NULL THEN
    ALTER FUNCTION public.mcp_change_log_open(text, uuid) RENAME TO mcp_change_log_open_full;
  END IF;
  IF to_regprocedure('public.mcp_request_log_open_full(text,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.mcp_request_log_open(text, uuid, text) RENAME TO mcp_request_log_open_full;
  END IF;
  IF to_regprocedure('public.mcp_submittal_record_open_full(text,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.mcp_submittal_record_open(text, uuid, text) RENAME TO mcp_submittal_record_open_full;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mcp_board_link_open_full(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_change_log_open_full(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_request_log_open_full(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_submittal_record_open_full(text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_board_link_open(_token_hash text, _job uuid, _page text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE res jsonb;
BEGIN
  -- Money pages never open through a link; the page asks the viewer to sign in instead.
  IF _page IN ('ior', 'payapp') THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  res := public.mcp_board_link_open_full(_token_hash, _job, _page);
  IF res->>'status' = 'ok' THEN
    res := jsonb_set(res, '{payload}', coalesce(mcp_private.board_redact_money(res->'payload'), 'null'::jsonb));
  END IF;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.mcp_board_link_open(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_change_log_open(_token_hash text, _job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Change orders are money: a link alone never opens them. Members read the log signed in.
  RETURN jsonb_build_object('status', 'denied', 'payload', NULL);
END $$;
REVOKE ALL ON FUNCTION public.mcp_change_log_open(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_change_log_open(text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_request_log_open(_token_hash text, _job uuid, _kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE res jsonb;
BEGIN
  res := public.mcp_request_log_open_full(_token_hash, _job, _kind);
  IF res->>'status' = 'ok' THEN
    res := jsonb_set(res, '{payload}', coalesce(mcp_private.board_redact_money(res->'payload'), 'null'::jsonb));
  END IF;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.mcp_request_log_open(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_request_log_open(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_submittal_record_open(_token_hash text, _job uuid, _number text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE res jsonb;
BEGIN
  res := public.mcp_submittal_record_open_full(_token_hash, _job, _number);
  IF res->>'status' = 'ok' THEN
    res := jsonb_set(res, '{payload}', coalesce(mcp_private.board_redact_money(res->'payload'), 'null'::jsonb));
  END IF;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.mcp_submittal_record_open(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_record_open(text, uuid, text) TO anon, authenticated;
