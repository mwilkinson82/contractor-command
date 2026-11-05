-- Rollback for 20261105181000_athena_portal_messages.sql: removes client messages on the customer page.
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.mcp_job_message_reply(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.mcp_job_messages_list(uuid);
DROP FUNCTION IF EXISTS public.mcp_portal_decision_job(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.mcp_portal_messages(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.mcp_portal_message_post(uuid, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS mcp_private.portal_message_client_json(public.mcp_portal_messages);
DROP FUNCTION IF EXISTS mcp_private.portal_item_label(uuid);
DROP TABLE IF EXISTS public.mcp_portal_messages;
