-- Rollback for 20261105120000_athena_portal_pay_apps.sql.
-- 1. Put mcp_portal_view and mcp_portal_decide back as 20261104200100_athena_portal_choice_stage.sql defined them
--    (re-run its two CREATE OR REPLACE FUNCTION blocks), and mcp_portal_list back as
--    20261104170000_athena_customer_portal.sql defined it (re-run that block). Shared pay applications then drop off
--    the customer page; their decisions stay in mcp_portal_decisions.
-- 2. Drop the share function and the private helpers.
-- 3. Shared pay application items and their decisions are KEPT: they are the customer's record. The kind check is
--    narrowed back only when none exist (commented; run only with Marshall's word).
DROP FUNCTION IF EXISTS public.mcp_portal_share_pay_app(uuid, uuid, text, integer, date);
DROP FUNCTION IF EXISTS mcp_private.portal_pay_app_view_check(jsonb);
DROP FUNCTION IF EXISTS mcp_private.portal_pay_app_view(jsonb, jsonb);
DROP FUNCTION IF EXISTS mcp_private.portal_pay_app_open(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS mcp_private.portal_pay_app_label(text);
-- ALTER TABLE public.mcp_portal_items DROP CONSTRAINT mcp_portal_items_kind_check;
-- ALTER TABLE public.mcp_portal_items ADD CONSTRAINT mcp_portal_items_kind_check CHECK (kind IN ('change_order', 'selection'));
