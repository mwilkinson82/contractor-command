-- Rollback for 20261105161000_athena_submittal_replies.sql: removes reviewer return links and kept submittal
-- replies. Submittal statuses and history already written from replies stay as they are. Files stored under
-- <company>/<job>/returns/ in the athena-submittals bucket are not deleted by this rollback.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.mcp_submittal_replies_list(uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_confirm(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_files(uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_email(text, text, text, text, text, text, text, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_page_submit(text, uuid, text, text, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS mcp_private.submittal_reply_files_ok(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_page_try(text);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_page_open(text);
DROP FUNCTION IF EXISTS public.mcp_submittal_reply_link_issue(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS mcp_private.submittal_reply_json(public.mcp_submittal_responses);
DROP FUNCTION IF EXISTS mcp_private.submittal_reply_history(public.mcp_submittals, text, text, jsonb);
DROP FUNCTION IF EXISTS mcp_private.submittal_reply_find(text);
DROP FUNCTION IF EXISTS mcp_private.submittal_reply_label(text);
DROP FUNCTION IF EXISTS mcp_private.submittal_reply_status(text);
DROP TABLE IF EXISTS public.mcp_submittal_responses;
DROP TABLE IF EXISTS public.mcp_submittal_reply_links;
