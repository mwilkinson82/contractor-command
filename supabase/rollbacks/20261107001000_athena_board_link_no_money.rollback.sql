-- Rollback for 20261107001000_athena_board_link_no_money: the four link openers back under their own names, as they were.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regprocedure('public.mcp_board_link_open_full(text,uuid,text)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.mcp_board_link_open(text, uuid, text);
    ALTER FUNCTION public.mcp_board_link_open_full(text, uuid, text) RENAME TO mcp_board_link_open;
  END IF;
  IF to_regprocedure('public.mcp_change_log_open_full(text,uuid)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.mcp_change_log_open(text, uuid);
    ALTER FUNCTION public.mcp_change_log_open_full(text, uuid) RENAME TO mcp_change_log_open;
  END IF;
  IF to_regprocedure('public.mcp_request_log_open_full(text,uuid,text)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.mcp_request_log_open(text, uuid, text);
    ALTER FUNCTION public.mcp_request_log_open_full(text, uuid, text) RENAME TO mcp_request_log_open;
  END IF;
  IF to_regprocedure('public.mcp_submittal_record_open_full(text,uuid,text)') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.mcp_submittal_record_open(text, uuid, text);
    ALTER FUNCTION public.mcp_submittal_record_open_full(text, uuid, text) RENAME TO mcp_submittal_record_open;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.mcp_board_link_open(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_change_log_open(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_request_log_open(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_submittal_record_open(text, uuid, text) TO anon, authenticated;
DROP FUNCTION IF EXISTS mcp_private.board_redact_money(jsonb);
