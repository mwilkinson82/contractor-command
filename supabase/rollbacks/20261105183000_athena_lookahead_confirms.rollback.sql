-- Rollback for 20261105183000_athena_lookahead_confirms.sql: removes look-ahead date confirmation requests and their
-- functions. Job notices they recorded stay on the job.
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.mcp_lookahead_confirm_respond(text, text, date, text, text, text, text);
DROP FUNCTION IF EXISTS public.mcp_lookahead_confirm_open(text);
DROP FUNCTION IF EXISTS mcp_private.lookahead_confirm_public(public.mcp_lookahead_confirms);
DROP FUNCTION IF EXISTS public.mcp_lookahead_confirm_cancel(uuid, uuid);
DROP FUNCTION IF EXISTS public.mcp_lookahead_confirms_list(uuid, uuid);
DROP FUNCTION IF EXISTS public.mcp_lookahead_confirm_email_result(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.mcp_lookahead_confirm_create(uuid, uuid, uuid, text, text, text, text, text, text, date, date, text, timestamptz);
DROP FUNCTION IF EXISTS mcp_private.lookahead_confirm_sender(uuid);
DROP FUNCTION IF EXISTS mcp_private.lookahead_confirm_json(public.mcp_lookahead_confirms);
DROP FUNCTION IF EXISTS mcp_private.lookahead_confirm_state(public.mcp_lookahead_confirms);
DROP TABLE IF EXISTS public.mcp_lookahead_confirms;
