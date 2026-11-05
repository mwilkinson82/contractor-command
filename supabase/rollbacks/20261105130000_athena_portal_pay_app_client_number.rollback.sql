-- Rollback for 20261105130000_athena_portal_pay_app_client_number.sql: puts back the five-argument share function
-- from 20261105120000_athena_portal_pay_apps.sql. Shared items keep the names they were shared under.
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date, text);
DROP FUNCTION IF EXISTS mcp_private.portal_pay_app_plain(text);
-- Then re-run the mcp_portal_share_pay_app section of 20261105120000_athena_portal_pay_apps.sql.
